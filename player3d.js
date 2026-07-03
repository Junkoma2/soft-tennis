/**
 * 3D プレイヤー描画（プロトタイプ）
 *
 * 既存 2D コートの上に、透明な Three.js オーバーレイを重ね、
 * 各選手を「コート上の投影位置・スケール」に合わせて描く。
 * 固定の斜め上カメラ＋正射影で 2D ゲーム風の見え方にする。
 *
 * 描画はキャラ 1 体を共有し、選手ごとに色とポーズを差し替えて
 * ビューポートを切り替えて 4 回描く（軽量）。
 *
 * 既存ゲームロジック・当たり判定・state には一切触れない。
 */

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { project } from "./math.js";
import { TUNING } from "./config.js";
import { back, front, cpuBack, cpuFront, ball, state } from "./state.js";
import { createCharacter } from "./simpleCharacter3d.js";
import {
  applyPose, poseNameForPlayer, applyLeftHandGrip,
  swingPhaseOf, applySwingPhase,
} from "./animation3d.js";

let renderer = null, scene = null, camera = null, char = null;
let courtCanvas = null, overlay = null;
let initialized = false;
let lastTime = 0;
const BASE_HIP_Y = 0.86; // simpleCharacter3d の hipY と一致させる（脚を伸ばした分）

// 各選手のポーズ補間状態
const blendState = new Map();
function getBlend(pl) {
  let b = blendState.get(pl);
  if (!b) { b = { a: "ready", b: "ready", t: 1 }; blendState.set(pl, b); }
  return b;
}

const motionState = new Map();
function getMotion(pl) {
  let m = motionState.get(pl);
  if (!m) { m = { yaw: null, runPhase: 0 }; motionState.set(pl, m); }
  return m;
}

// 見た目チューニング
const FRUST_H = 2.4;     // カメラが収める縦範囲(m)
const ASPECT = 0.62;     // ビューポート横/縦比
const VH_K = 2.18;       // ビューポート縦 = s * VH_K（キャラを全体的に大きく見せる）
const FEET_FRAC = 0.06;  // 足元がビューポート下から何割の位置に出るか
const D = Math.PI / 180;

export function isReady3D() { return initialized; }

export async function init3D(canvas) {
  if (initialized) return true;
  courtCanvas = canvas;

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(courtCanvas.width, courtCanvas.height, false);
  renderer.autoClear = false;
  renderer.setScissorTest(true);

  overlay = renderer.domElement;
  overlay.id = "court-3d";
  overlay.style.position = "absolute";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "5";
  // 2D コートと同じ場所へ重ねる
  const parent = courtCanvas.parentElement || document.body;
  if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
  parent.appendChild(overlay);
  syncOverlayRect();

  scene = new THREE.Scene();

  // 固定の斜め上カメラ（正射影）
  const half = FRUST_H / 2;
  camera = new THREE.OrthographicCamera(-half * ASPECT, half * ASPECT, half, -half, 0.1, 50);
  camera.position.set(0, 2.0, 3.2);
  camera.lookAt(0, 0.95, 0);

  // ライト
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(2.5, 5, 3.5);
  scene.add(dir);

  // 共有キャラ
  char = createCharacter({});
  scene.add(char.group);

  initialized = true;
  return true;
}

function syncOverlayRect() {
  if (!overlay || !courtCanvas) return;
  overlay.style.left = courtCanvas.offsetLeft + "px";
  overlay.style.top = courtCanvas.offsetTop + "px";
  overlay.style.width = courtCanvas.clientWidth + "px";
  overlay.style.height = courtCanvas.clientHeight + "px";
  if (overlay.width !== courtCanvas.width || overlay.height !== courtCanvas.height) {
    renderer.setSize(courtCanvas.width, courtCanvas.height, false);
  }
}

function setColors(pl) {
  // pl.color = ユニフォーム, pl.skin = 肌
  char.materials.shirt.color.set(pl.color || 0x6366f1);
  char.materials.skin.color.set(pl.skin || 0xf1c7a8);
}

function updateBlend(pl, targetName, dt) {
  const b = getBlend(pl);
  if (targetName !== b.b) { b.a = b.b; b.b = targetName; b.t = 0; }
  b.t = Math.min(1, b.t + dt * 6); // 補間速度
  return b;
}

// スイング中はブレンドを使わずフェーズ駆動で確定するが、抜けた直後に
// フォロースルーから滑らかに構えへ戻れるよう、ブレンド起点を follow に固定。
function pinBlend(pl, name) {
  const b = getBlend(pl);
  b.a = b.b = name; b.t = 1;
}

function baseYawFor(pl) {
  return (pl.facing < 0) ? Math.PI : 0;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// このプレイヤー側に向かって（バウンド前後を問わず）ボールが来ているかどうか。
// 「相手が打った瞬間の受け」に限らず、ラリー中いつでも自分側へ向かう球があれば
// 正対の対象にする（サーブレシーブ限定だった従来のisReceivingIncomingを一般化）。
function ballComingToSide(pl) {
  if (state !== "rally" || ball.serving || Math.hypot(ball.vx, ball.vy) < 0.2) return false;
  const mySide = (pl === back || pl === front) ? "player" : "cpu";
  const towardPlayer = ball.lastHitter === "cpu" && ball.vy > 0;
  const towardCpu = ball.lastHitter === "player" && ball.vy < 0;
  return (mySide === "player" && towardPlayer) || (mySide === "cpu" && towardCpu);
}

// 体の正対先: 通常はネット向き(baseYaw)。自分側へ球が来ている間は、懐（打てる角度）が
// 変わるよう球の来る向きへ少し体を開く。打った瞬間のスイング向きは別途ロックされるため、
// ここでは「構え〜追走」の見た目だけを扱う（打点判定・当たり判定には影響しない）。
function ballFacingYaw(pl) {
  const base = baseYawFor(pl);
  if (!ballComingToSide(pl)) return base;
  const courseYaw = Math.atan2(-ball.vx, -ball.vy);
  return base + clamp(angleDelta(base, courseYaw), -0.6, 0.6);
}

function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

// 進行方向（移動速度ベクトル）を向く角度。遠距離を体を横向きにして走るときに使う。
function travelYaw(vx, vy) {
  return Math.atan2(vx, vy);
}

function smoothYawFor(pl, targetYaw, dt, turnRate) {
  const m = getMotion(pl);
  if (!Number.isFinite(targetYaw)) targetYaw = baseYawFor(pl);
  if (pl.pose === "swing" && Number.isFinite(m.yaw)) return m.yaw;
  if (m.yaw == null) {
    m.yaw = targetYaw;
    return targetYaw;
  }
  const rate = turnRate != null ? turnRate : 9;
  const alpha = 1 - Math.exp(-dt * rate);
  m.yaw += angleDelta(m.yaw, targetYaw) * alpha;
  return m.yaw;
}

// 移動表現を2種に分ける:
//   近距離（低速の横移動）＝サイドステップ … 体の正対(ballFacingYaw)を保ったまま足だけ横に運ぶ
//   遠距離（速い/大きい移動）＝体を横向きにして走る … 進行方向へ体ごとターンして走る
// どちらもmoveToward由来の実速度(pl.vx/vy)で判定するため、実際に足が動いているときだけ発動する
// （静止中に残った速度でアニメだけ動くバグを防ぐ仕組みとは別軸の話）。
function applyRunMotion(pl, joints, yaw, dt) {
  if (!joints || pl.pose === "swing") return;
  if (!Number.isFinite(yaw) || !Number.isFinite(pl.vx) || !Number.isFinite(pl.vy)) return;
  const vx = pl.vx || 0;
  const vy = pl.vy || 0;
  const speed = Math.hypot(vx, vy);
  if (speed < 0.18) return;

  const forwardX = Math.sin(yaw);
  const forwardY = Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightY = -Math.sin(yaw);
  const forward = vx * forwardX + vy * forwardY;
  const side = vx * rightX + vy * rightY;
  const lateral = Math.abs(side) > Math.abs(forward) * 0.75;
  const sideSign = side >= 0 ? 1 : -1;

  // サイドステップか、体を横向きにして走るかを実速度で切り替える（見た目専用）。
  const isRunTurn = lateral && speed > TUNING.move.sidestepMaxSpeed;

  const m = getMotion(pl);
  m.runPhase += dt * (8 + Math.min(5, speed * 0.9));
  const phase = m.runPhase;
  const amp = Math.min(1, speed / 4.5);
  const stride = Math.sin(phase);
  const counter = Math.sin(phase + Math.PI);

  if (joints.pelvis) {
    joints.pelvis.position.y += Math.abs(stride) * 0.025 * amp;
  }
  if (joints.leanRoot) {
    joints.leanRoot.rotation.x += (lateral && !isRunTurn ? 0 : -4) * amp * D;
  }

  if (joints.hipR) {
    joints.hipR.rotation.x += (lateral && !isRunTurn ? 8 : 22) * stride * amp * D;
    joints.hipR.rotation.z += (lateral && !isRunTurn ? sideSign * 16 * Math.abs(stride) : 0) * amp * D;
  }
  if (joints.hipL) {
    joints.hipL.rotation.x += (lateral && !isRunTurn ? 8 : 22) * counter * amp * D;
    joints.hipL.rotation.z += (lateral && !isRunTurn ? sideSign * -16 * Math.abs(counter) : 0) * amp * D;
  }
  if (joints.kneeR) joints.kneeR.rotation.x += -18 * Math.max(0, -stride) * amp * D;
  if (joints.kneeL) joints.kneeL.rotation.x += -18 * Math.max(0, -counter) * amp * D;
  if (joints.footR) joints.footR.rotation.x += 12 * Math.max(0, stride) * amp * D;
  if (joints.footL) joints.footL.rotation.x += 12 * Math.max(0, counter) * amp * D;

  if (joints.shoulderR) joints.shoulderR.rotation.x += (lateral && !isRunTurn ? 8 * sideSign : -14) * counter * amp * D;
  if (joints.shoulderL) joints.shoulderL.rotation.x += (lateral && !isRunTurn ? -8 * sideSign : -14) * stride * amp * D;
}

function poseNameFor3D(pl, isFront) {
  if (pl.pose === "prep" && !ballComingToSide(pl)) {
    return isFront ? "ready" : "rearReady";
  }
  return poseNameForPlayer(pl, isFront);
}

export function render3D() {
  if (!initialized) return;
  syncOverlayRect();

  const now = performance.now();
  const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0.016;
  lastTime = now;

  const W = courtCanvas.width, H = courtCanvas.height;

  // 全面クリア（透明）
  renderer.setViewport(0, 0, W, H);
  renderer.setScissor(0, 0, W, H);
  renderer.clear();

  // 奥→手前（y 昇順で奥、最後に手前を上描き）
  const players = [cpuBack, cpuFront, back, front].slice().sort((a, b) => a.y - b.y);

  for (const pl of players) {
    const g = project(pl.x, pl.y, 0);
    const s = g.s;
    const vh = s * VH_K;
    const vw = vh * ASPECT;
    const vpX = Math.round(g.x - vw / 2);
    const vpYbottom = Math.round((H - g.y) - FEET_FRAC * vh);
    const isFront = (pl === front || pl === cpuFront);

    // 画面外スキップ
    if (vpX + vw < 0 || vpX > W || vpYbottom + vh < 0 || vpYbottom > H) continue;

    setColors(pl);

    // ラケットはモデルの +x 側に付くが、モデルは前方=+z で組まれているため
    // +x は解剖学的な左側。右利きを正しく「右手持ち」にするには X 反転が要る。
    // （左利きは反転なしで +x=左手のまま）
    char.group.scale.x = (pl.stats && pl.stats.handed === "left") ? 1 : -1;
    // 正対先の決定: 通常はボールへ正対（懐/打てる角度が変わるよう常に真正面固定にしない）。
    // ただし遠距離移動で「体を横向きにして走る」ときは、走っている間だけ進行方向を向く
    // （サイドステップ中はボール正対を保ったまま足だけ運ぶ）。
    const vx = pl.vx || 0, vy = pl.vy || 0;
    const moveSpeed = Math.hypot(vx, vy);
    let targetYaw = ballFacingYaw(pl);
    let turnRate = 9;
    if (pl.pose !== "swing" && moveSpeed > TUNING.move.sidestepMaxSpeed) {
      const yawBase = baseYawFor(pl);
      const bf = ballFacingYaw(pl);
      const forward = vx * Math.sin(yawBase) + vy * Math.cos(yawBase);
      const lateralV = vx * Math.cos(yawBase) - vy * Math.sin(yawBase);
      if (Math.abs(lateralV) > Math.abs(forward) * 0.75) {
        targetYaw = travelYaw(vx, vy);
        turnRate = TUNING.move.runTurnSpeed;
      } else {
        targetYaw = bf;
      }
    }
    const renderYaw = smoothYawFor(pl, targetYaw, dt, turnRate);
    char.group.rotation.y = renderYaw;

    if (pl.pose === "swing" && state === "rally" && !ball.serving) {
      // スイング：swingT 由来の phase で takeback→contact→follow を水平に振り抜く
      const side = pl.swingSide === "back" ? "back" : "fore";
      applySwingPhase(char.joints, side, swingPhaseOf(pl), BASE_HIP_Y, isFront);
      pinBlend(pl, side === "back" ? "backhandFollow" : (isFront ? "forehandFollow" : "rearForehandFollow"));
      // 振り抜き中は片手（左手IKは当てない）
    } else {
      const name = poseNameFor3D(pl, isFront);
      const b = updateBlend(pl, name, dt);
      applyPose(char.joints, b.a, b.b, b.t, BASE_HIP_Y);
      // 構え・ボレーのみ左手をグリップへ添える（両手構え）
      if (name === "ready" || name === "rearReady" || name === "forehandVolleyTakeback") {
        applyLeftHandGrip(char.joints, char.group.userData.dims, char.group);
      }
      applyRunMotion(pl, char.joints, renderYaw, dt);
    }

    renderer.setViewport(vpX, vpYbottom, vw, vh);
    renderer.setScissor(vpX, vpYbottom, vw, vh);
    renderer.clearDepth();
    renderer.render(scene, camera);
  }
}

export function setOverlayVisible(v) {
  if (overlay) overlay.style.display = v ? "block" : "none";
}

export function dispose3D() {
  if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
  if (renderer) renderer.dispose();
  renderer = scene = camera = char = overlay = null;
  initialized = false;
  blendState.clear();
  motionState.clear();
}
