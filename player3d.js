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
import { back, front, cpuBack, cpuFront, ball } from "./state.js";
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
const FEET_FRAC = 0.11;  // 足元がビューポート下から何割の位置に出るか
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

function yawForPlayer(pl) {
  if (ball.bounces < 1 || Math.hypot(ball.vx, ball.vy) < 0.2) return baseYawFor(pl);
  const receivingSide = (pl === back || pl === front) ? "player" : "cpu";
  const incomingPlayerSide = ball.lastHitter === "cpu" && ball.vy > 0;
  const incomingCpuSide = ball.lastHitter === "player" && ball.vy < 0;
  if ((receivingSide === "player" && !incomingPlayerSide) ||
      (receivingSide === "cpu" && !incomingCpuSide)) {
    return baseYawFor(pl);
  }
  return Math.atan2(-ball.vx, -ball.vy);
}

function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function smoothYawFor(pl, targetYaw, dt) {
  const m = getMotion(pl);
  if (m.yaw == null) {
    m.yaw = targetYaw;
    return targetYaw;
  }
  const alpha = 1 - Math.exp(-dt * 9);
  m.yaw += angleDelta(m.yaw, targetYaw) * alpha;
  return m.yaw;
}

function applyRunMotion(pl, joints, yaw, dt) {
  if (!joints || pl.pose === "swing") return;
  const vx = pl.vx || 0;
  const vy = pl.vy || 0;
  const speed = Math.hypot(vx, vy);
  if (speed < 0.18) return;

  const m = getMotion(pl);
  m.runPhase += dt * (8 + Math.min(5, speed * 0.9));
  const phase = m.runPhase;
  const amp = Math.min(1, speed / 4.5);
  const stride = Math.sin(phase);
  const counter = Math.sin(phase + Math.PI);

  const forwardX = Math.sin(yaw);
  const forwardY = Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightY = -Math.sin(yaw);
  const forward = vx * forwardX + vy * forwardY;
  const side = vx * rightX + vy * rightY;
  const lateral = Math.abs(side) > Math.abs(forward) * 0.75;
  const sideSign = side >= 0 ? 1 : -1;

  if (joints.pelvis) {
    joints.pelvis.position.y += Math.abs(stride) * 0.035 * amp;
    joints.pelvis.rotation.z += (lateral ? -sideSign * 5 * amp : 0) * D;
  }
  if (joints.leanRoot) {
    joints.leanRoot.rotation.x += (lateral ? 2 : -5) * amp * D;
    joints.leanRoot.rotation.z += (lateral ? -sideSign * 7 * amp : sideSign * 1.5 * amp) * D;
  }

  if (joints.hipR) {
    joints.hipR.rotation.x += (lateral ? 8 : 22) * stride * amp * D;
    joints.hipR.rotation.z += (lateral ? sideSign * 16 * Math.abs(stride) : 0) * amp * D;
  }
  if (joints.hipL) {
    joints.hipL.rotation.x += (lateral ? 8 : 22) * counter * amp * D;
    joints.hipL.rotation.z += (lateral ? sideSign * -16 * Math.abs(counter) : 0) * amp * D;
  }
  if (joints.kneeR) joints.kneeR.rotation.x += -18 * Math.max(0, -stride) * amp * D;
  if (joints.kneeL) joints.kneeL.rotation.x += -18 * Math.max(0, -counter) * amp * D;
  if (joints.footR) joints.footR.rotation.x += 12 * Math.max(0, stride) * amp * D;
  if (joints.footL) joints.footL.rotation.x += 12 * Math.max(0, counter) * amp * D;

  if (joints.shoulderR) joints.shoulderR.rotation.x += (lateral ? 8 * sideSign : -14) * counter * amp * D;
  if (joints.shoulderL) joints.shoulderL.rotation.x += (lateral ? -8 * sideSign : -14) * stride * amp * D;
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
    // カメラ正対：手前側(facing>0)はそのまま、奥側(facing<0)は後ろ向きに
    const renderYaw = smoothYawFor(pl, yawForPlayer(pl), dt);
    char.group.rotation.y = renderYaw;

    if (pl.pose === "swing") {
      // スイング：swingT 由来の phase で takeback→contact→follow を水平に振り抜く
      const side = pl.swingSide === "back" ? "back" : "fore";
      applySwingPhase(char.joints, side, swingPhaseOf(pl), BASE_HIP_Y, isFront);
      pinBlend(pl, side === "back" ? "backhandFollow" : (isFront ? "forehandFollow" : "rearForehandFollow"));
      // 振り抜き中は片手（左手IKは当てない）
    } else {
      const name = poseNameForPlayer(pl, isFront);
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
