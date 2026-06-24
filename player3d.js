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
import { back, front, cpuBack, cpuFront } from "./state.js";
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

// 見た目チューニング
const FRUST_H = 2.4;     // カメラが収める縦範囲(m)
const ASPECT = 0.62;     // ビューポート横/縦比
const VH_K = 1.82;       // ビューポート縦 = s * VH_K（キャラを全体的に大きく見せる）
const FEET_FRAC = 0.11;  // 足元がビューポート下から何割の位置に出るか

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

    // 画面外スキップ
    if (vpX + vw < 0 || vpX > W || vpYbottom + vh < 0 || vpYbottom > H) continue;

    setColors(pl);

    // ラケットはモデルの +x 側に付くが、モデルは前方=+z で組まれているため
    // +x は解剖学的な左側。右利きを正しく「右手持ち」にするには X 反転が要る。
    // （左利きは反転なしで +x=左手のまま）
    char.group.scale.x = (pl.stats && pl.stats.handed === "left") ? 1 : -1;
    // カメラ正対：手前側(facing>0)はそのまま、奥側(facing<0)は後ろ向きに
    char.group.rotation.y = (pl.facing < 0) ? Math.PI : 0;

    if (pl.pose === "swing") {
      // スイング：swingT 由来の phase で takeback→contact→follow を水平に振り抜く
      const side = pl.swingSide === "back" ? "back" : "fore";
      applySwingPhase(char.joints, side, swingPhaseOf(pl), BASE_HIP_Y);
      pinBlend(pl, side === "back" ? "backhandFollow" : "forehandFollow");
      // 振り抜き中は片手（左手IKは当てない）
    } else {
      const name = poseNameForPlayer(pl);
      const b = updateBlend(pl, name, dt);
      applyPose(char.joints, b.a, b.b, b.t, BASE_HIP_Y);
      // 構え・ボレーのみ左手をグリップへ添える（両手構え）
      if (name === "ready" || name === "forehandVolleyTakeback") {
        applyLeftHandGrip(char.joints, char.group.userData.dims, char.group);
      }
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
}
