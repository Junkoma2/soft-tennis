/**
 * 3D キャラのポーズ定義と補間
 *
 * 各ポーズは関節ごとの回転角（度）。モデルの正面は +z。
 * 胸・頭は Three.js の回転をそのまま使い、下向き(-y)に伸びる手足は適用時に
 * X 回転を反転する。これによりポーズ値では正を「前へ曲げる」として扱える。
 * 右利き前衛・カメラ正対を基準にしている。
 *
 * まずは ready と forehandVolleyTakeback の 2 ポーズ。
 * applyPose() で 2 ポーズ間を滑らかに補間する。
 * 将来 splitStep / impact / followThrough / backVolley / serve 等を
 * POSES に足すだけで拡張できる。
 */

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { TUNING } from "./config.js";

const D = Math.PI / 180;

// rootLift: 骨盤 y のオフセット（負で重心を落とす＝しゃがむ）
export const POSES = {
  // 構え：直立厳禁。膝・股関節を曲げ、約18°前傾し低重心。
  // ラケットは顔の横〜胸の前に高く保ち（腰へ下げない）、左手を軽く添える。
  ready: {
    bodyLean: 8,
    rootLift: -0.06,
    chest:     { x: 0, y: 0,  z: 0 },
    head:      { x: 0, y: 0,  z: 0 },
    // 両腕を高く前へ。abduction(z)は小さく抑え、両手を中央へ寄せて顔〜胸の前で構える。
    shoulderR: { x: 38, y: 4,  z: -26 },
    elbowR:    { x: -48, y: 0, z: 0 },
    handR:     { x: 4, y: 0, z: 0 },
    racket:    { x: 104, y: 0, z: 0 },
    shoulderL: { x: 80, y: 0,  z: -12 }, // 左手をグリップへ添える
    elbowL:    { x: -108, y: 0, z: 0 },
    hipR:      { x: 10, y: 0,  z: 12 },
    kneeR:     { x: -22, y: 0, z: 0 },
    footR:     { x: 20, y: 0,  z: 0 },
    hipL:      { x: 10, y: 0,  z: -12 },
    kneeL:     { x: -22, y: 0, z: 0 },
    footL:     { x: 20, y: 0,  z: 0 },
  },

  rearReady: {
    bodyLean: 8,
    rootLift: -0.08,
    chest:     { x: 0, y: 0, z: 0 },
    head:      { x: 0, y: 0, z: 0 },
    shoulderR: { x: 36, y: 6,  z: -28 },
    elbowR:    { x: -48, y: 0, z: 0 },
    handR:     { x: 4, y: 0, z: 0 },
    racket:    { x: 102, y: 0, z: 0 },
    shoulderL: { x: 46, y: 8,  z: -18 },
    elbowL:    { x: -74, y: 0, z: 0 },
    hipR:      { x: 14, y: 0,  z: 14 },
    kneeR:     { x: -28, y: 0, z: 0 },
    footR:     { x: 26, y: 0,  z: 0 },
    hipL:      { x: 14, y: 0,  z: -14 },
    kneeL:     { x: -28, y: 0, z: 0 },
    footL:     { x: 26, y: 0,  z: 0 },
  },

  // フォアボレーのテイクバック：右肩を少し引き、ラケットを右耳後方へ。
  // 左手で軽く支える。体は横向きになりすぎず、次の踏み込みに入れる低い姿勢。
  forehandVolleyTakeback: {
    bodyLean: 7,
    rootLift: -0.07,
    pelvisTurn: 6,
    chest:     { x: 0, y: 12, z: 0 },
    head:      { x: 0, y: -8, z: 0 },
    shoulderR: { x: 46, y: -4, z: -20 },
    elbowR:    { x: -54, y: 0, z: 0 },
    handR:     { x: -6, y: 0, z: 0 },
    racket:    { x: 92, y: 0, z: 0 },
    shoulderL: { x: 56, y: 8, z: -24 },  // 左手で軽く支える
    elbowL:    { x: -92, y: 0, z: 0 },
    hipR:      { x: 12, y: 0, z: 12 },
    kneeR:     { x: -26, y: 0, z: 0 },
    footR:     { x: 20, y: 0, z: 0 },
    hipL:      { x: 12, y: 0, z: -12 },
    kneeL:     { x: -26, y: 0, z: 0 },
    footL:     { x: 20, y: 0, z: 0 },
  },

  // ===== フォアハンド・ストローク（水平に振り抜く「びんた」） =====
  // 体のひねり(chest.y)で、肩の高さに保った腕＝ラケットを水平に薙ぎ払う。
  // takeback(右へ大きくコイル) → contact(正面で腕を伸ばす) → follow(左へ振り抜く)。
  forehandTakeback: {
    bodyLean: 7,
    rootLift: -0.07,
    rootShiftX: 0.035,
    pelvisTurn: 10,
    chest:     { x: 0, y: 32, z: 0 },
    head:      { x: 0, y: -22, z: 0 },
    shoulderR: { x: 54, y: -14, z: 30 },
    elbowR:    { x: -54, y: 0, z: 0 },
    handR:     { x: -8, y: 0, z: 0 },
    racket:    { x: 92, y: 0, z: 0 },
    shoulderL: { x: 88, y: -8, z: -12 },
    elbowL:    { x: -10, y: 0, z: 0 },
    hipR:      { x: 14, y: 0, z: 14 },
    kneeR:     { x: -30, y: 0, z: 0 },
    footR:     { x: 22, y: 0, z: 0 },
    hipL:      { x: 10, y: 0, z: -14 },
    kneeL:     { x: -22, y: 0, z: 0 },
    footL:     { x: 18, y: 0, z: 0 },
  },

  rearForehandTakeback: {
    bodyLean: 9,
    rootLift: -0.09,
    rootShiftX: 0.055,
    pelvisTurn: 12,
    chest:     { x: 0, y: 42, z: 0 },
    head:      { x: 0, y: -30, z: 0 },
    shoulderR: { x: 54, y: -18, z: 34 },
    elbowR:    { x: -54, y: 0, z: 0 },
    handR:     { x: -8, y: 0, z: 0 },
    racket:    { x: 90, y: 0, z: 0 },
    shoulderL: { x: 96, y: -10, z: -10 },
    elbowL:    { x: -6, y: 0, z: 0 },
    hipR:      { x: 18, y: 0, z: 16 },
    kneeR:     { x: -38, y: 0, z: 0 },
    footR:     { x: 24, y: 0, z: 0 },
    hipL:      { x: 12, y: 0, z: -16 },
    kneeL:     { x: -26, y: 0, z: 0 },
    footL:     { x: 20, y: 0, z: 0 },
  },
  forehandContact: {
    bodyLean: 5,
    rootLift: -0.05,
    rootShiftX: -0.035,
    pelvisTurn: -6,
    chest:     { x: 1, y: -4, z: 0 },
    head:      { x: 0, y: 3, z: 0 },
    shoulderR: { x: 88, y: 12, z: 2 },
    elbowR:    { x: -16, y: 0, z: 0 },
    handR:     { x: 0, y: 0, z: 0 },
    racket:    { x: 82, y: -8, z: -14 },
    shoulderL: { x: 42, y: -10, z: 22 },
    elbowL:    { x: -34, y: 0, z: 0 },
    hipR:      { x: 14, y: 0, z: 12 },
    kneeR:     { x: -28, y: 0, z: 0 },
    footR:     { x: 20, y: 0, z: 0 },
    hipL:      { x: 10, y: 0, z: -12 },
    kneeL:     { x: -20, y: 0, z: 0 },
    footL:     { x: 16, y: 0, z: 0 },
  },

  rearForehandContact: {
    bodyLean: 6,
    rootLift: -0.07,
    rootShiftX: -0.05,
    pelvisTurn: -8,
    chest:     { x: 2, y: -6, z: 0 },
    head:      { x: -1, y: 4, z: 0 },
    shoulderR: { x: 88, y: 14, z: 2 },
    elbowR:    { x: -14, y: 0, z: 0 },
    handR:     { x: 0, y: 0, z: 0 },
    racket:    { x: 80, y: -8, z: -16 },
    shoulderL: { x: 44, y: -12, z: 24 },
    elbowL:    { x: -34, y: 0, z: 0 },
    hipR:      { x: 16, y: 0, z: 12 },
    kneeR:     { x: -30, y: 0, z: 0 },
    footR:     { x: 22, y: 0, z: 0 },
    hipL:      { x: 12, y: 0, z: -14 },
    kneeL:     { x: -24, y: 0, z: 0 },
    footL:     { x: 18, y: 0, z: 0 },
  },
  forehandFollow: {
    bodyLean: 4,
    rootLift: -0.03,
    rootShiftX: -0.05,
    pelvisTurn: -20,
    chest:     { x: 1, y: -38, z: 0 },
    head:      { x: 0, y: 26, z: 0 },
    shoulderR: { x: 76, y: 24, z: -42 },
    elbowR:    { x: -72, y: 0, z: 0 },
    handR:     { x: -16, y: 0, z: 0 },
    racket:    { x: 96, y: -10, z: -20 },
    shoulderL: { x: 34, y: -18, z: 28 },
    elbowL:    { x: -30, y: 0, z: 0 },
    hipR:      { x: 24, y: 0, z: 6 },
    kneeR:     { x: -42, y: 0, z: 0 },
    footR:     { x: 20, y: 0, z: 0 },
    hipL:      { x: 8, y: 0, z: -10 },
    kneeL:     { x: -18, y: 0, z: 0 },
    footL:     { x: 14, y: 0, z: 0 },
  },

  rearForehandFollow: {
    bodyLean: 5,
    rootLift: -0.04,
    rootShiftX: -0.075,
    pelvisTurn: -26,
    chest:     { x: 2, y: -48, z: 0 },
    head:      { x: -1, y: 32, z: 0 },
    shoulderR: { x: 76, y: 28, z: -48 },
    elbowR:    { x: -74, y: 0, z: 0 },
    handR:     { x: -18, y: 0, z: 0 },
    racket:    { x: 98, y: -12, z: -22 },
    shoulderL: { x: 36, y: -20, z: 30 },
    elbowL:    { x: -30, y: 0, z: 0 },
    hipR:      { x: 28, y: 0, z: 6 },
    kneeR:     { x: -48, y: 0, z: 0 },
    footR:     { x: 22, y: 0, z: 0 },
    hipL:      { x: 10, y: 0, z: -12 },
    kneeL:     { x: -20, y: 0, z: 0 },
    footL:     { x: 16, y: 0, z: 0 },
  },

  // ===== バックハンド・ストローク（水平に振り抜く） =====
  // フォアの鏡。左へコイル → 正面 → 右へ振り抜く。
  backhandTakeback: {
    bodyLean: 8,
    rootLift: -0.08,
    rootShiftX: 0.04,
    pelvisTurn: -10,
    chest:     { x: 0, y: -38, z: 0 },
    head:      { x: 0, y: 26, z: 0 },
    shoulderR: { x: 76, y: 4, z: 60 },
    elbowR:    { x: -60, y: 0, z: 0 },
    handR:     { x: -10, y: 0, z: 0 },
    racket:    { x: 88, y: 10, z: 8 },
    shoulderL: { x: 48, y: 10, z: -20 },
    elbowL:    { x: -42, y: 0, z: 0 },
    hipR:      { x: 12, y: 0, z: 14 },
    kneeR:     { x: -26, y: 0, z: 0 },
    footR:     { x: 20, y: 0, z: 0 },
    hipL:      { x: 14, y: 0, z: -14 },
    kneeL:     { x: -30, y: 0, z: 0 },
    footL:     { x: 22, y: 0, z: 0 },
  },
  backhandContact: {
    bodyLean: 6,
    rootLift: -0.06,
    rootShiftX: -0.04,
    pelvisTurn: 6,
    chest:     { x: 1, y: 8, z: 0 },
    head:      { x: 0, y: -5, z: 0 },
    shoulderR: { x: 88, y: -8, z: 18 },
    elbowR:    { x: -18, y: 0, z: 0 },
    handR:     { x: 0, y: 0, z: 0 },
    racket:    { x: 82, y: 8, z: 14 },
    shoulderL: { x: 38, y: 18, z: -24 },
    elbowL:    { x: -30, y: 0, z: 0 },
    hipR:      { x: 10, y: 0, z: 12 },
    kneeR:     { x: -20, y: 0, z: 0 },
    footR:     { x: 16, y: 0, z: 0 },
    hipL:      { x: 14, y: 0, z: -12 },
    kneeL:     { x: -28, y: 0, z: 0 },
    footL:     { x: 20, y: 0, z: 0 },
  },
  backhandFollow: {
    bodyLean: 5,
    rootLift: -0.04,
    rootShiftX: -0.06,
    pelvisTurn: 22,
    chest:     { x: 1, y: 42, z: 0 },
    head:      { x: 0, y: -28, z: 0 },
    shoulderR: { x: 78, y: -18, z: -34 },
    elbowR:    { x: -68, y: 0, z: 0 },
    handR:     { x: -14, y: 0, z: 0 },
    racket:    { x: 96, y: 12, z: 20 },
    shoulderL: { x: 72, y: 22, z: 34 },
    elbowL:    { x: -18, y: 0, z: 0 },
    hipR:      { x: 8, y: 0, z: 10 },
    kneeR:     { x: -18, y: 0, z: 0 },
    footR:     { x: 14, y: 0, z: 0 },
    hipL:      { x: 24, y: 0, z: -6 },
    kneeL:     { x: -42, y: 0, z: 0 },
    footL:     { x: 20, y: 0, z: 0 },
  },
};

// スイングの3キーフレーム（phase 0..1）。impact がやや早め。
const SWING_KEYS = {
  frontFore: [
    { p: 0.0, pose: "forehandTakeback" },
    { p: 0.40, pose: "forehandContact" },
    { p: 1.0, pose: "forehandFollow" },
  ],
  rearFore: [
    { p: 0.0, pose: "rearForehandTakeback" },
    { p: 0.42, pose: "rearForehandContact" },
    { p: 1.0, pose: "rearForehandFollow" },
  ],
  back: [
    { p: 0.0, pose: "backhandTakeback" },
    { p: 0.40, pose: "backhandContact" },
    { p: 1.0, pose: "backhandFollow" },
  ],
};

const JOINT_NAMES = [
  "chest", "head", "shoulderR", "elbowR", "handR", "racket",
  "shoulderL", "elbowL", "hipR", "kneeR", "footR", "hipL", "kneeL", "footL",
];

// 腕と脚のメッシュは各ピボットから local -Y へ伸びる。
// そのため、上向きに連なる胸・頭とは X 回転の前後が逆になる。
// ポーズ定義は「正=前へ曲げる」の感覚で保ち、適用時にだけ反転する。
const DOWNWARD_LIMB_JOINTS = new Set([
  "shoulderR", "shoulderL",
  "hipR", "kneeR", "footR", "hipL", "kneeL", "footL",
]);
const LOWER_BODY_JOINTS = new Set([
  "hipR", "kneeR", "footR", "hipL", "kneeL", "footL",
]);
const RACKET_ARM_JOINTS = new Set([
  "shoulderR", "elbowR", "handR", "racket",
]);

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function smoothstep(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

const _shoeWorld = new THREE.Vector3();

function alignShoesToGround(joints) {
  const { pelvis, leanRoot, shoeR, shoeL } = joints;
  if (!pelvis || !shoeR || !shoeL) return;

  pelvis.updateWorldMatrix(true, true);
  let lowest = Infinity;
  for (const shoe of [shoeR, shoeL]) {
    shoe.getWorldPosition(_shoeWorld);
    lowest = Math.min(lowest, _shoeWorld.y - (shoe.userData.groundRadius || 0));
  }

  // leanRoot の傾きで local Y と world Y に差が出るため補正する。
  const yProjection = leanRoot ? Math.max(0.25, Math.abs(Math.cos(leanRoot.rotation.x))) : 1;
  pelvis.position.y += (0.01 - lowest) / yProjection;
}

function lerpEuler(name, jointPose, ea, eb, t) {
  ea = ea || { x: 0, y: 0, z: 0 };
  eb = eb || { x: 0, y: 0, z: 0 };
  const xSign = DOWNWARD_LIMB_JOINTS.has(name) ? -1 : 1;
  jointPose.rotation.set(
    lerp(ea.x, eb.x, t) * D * xSign,
    lerp(ea.y, eb.y, t) * D,
    lerp(ea.z, eb.z, t) * D
  );
}

/**
 * joints に poseA→poseB を t(0..1) で補間して適用。
 * @param {object} joints createCharacter() の joints
 * @param {string} poseAName
 * @param {string} poseBName
 * @param {number} t
 * @param {number} baseHipY simpleCharacter のデフォルト骨盤 y（0.78）
 */
export function applyPose(joints, poseAName, poseBName, t, baseHipY, timing) {
  const A = POSES[poseAName] || POSES.ready;
  const B = POSES[poseBName] || A;
  const lowerT = timing ? timing.lower : t;
  const torsoT = timing ? timing.torso : t;
  const armT = timing ? timing.arm : t;

  const leanA = A.bodyLean || 0;
  const leanB = B.bodyLean || 0;
  if (joints.leanRoot) joints.leanRoot.rotation.x = lerp(leanA, leanB, torsoT) * D;

  for (const name of JOINT_NAMES) {
    if (!joints[name]) continue;
    const jointT = LOWER_BODY_JOINTS.has(name)
      ? lowerT
      : (RACKET_ARM_JOINTS.has(name) ? armT : torsoT);
    lerpEuler(name, joints[name], A[name], B[name], jointT);
  }

  // 重心（骨盤 y）
  const liftA = A.rootLift || 0;
  const liftB = B.rootLift || 0;
  if (joints.pelvis) {
    joints.pelvis.position.x = lerp(A.rootShiftX || 0, B.rootShiftX || 0, lowerT);
    joints.pelvis.position.y = (baseHipY || 0.78) + lerp(liftA, liftB, lowerT);
    joints.pelvis.rotation.y = lerp(A.pelvisTurn || 0, B.pelvisTurn || 0, lowerT) * D;
  }
  alignShoesToGround(joints);
}

/* ========================================================
 * 左手をラケットのスロート（三角部分）へ合わせる簡易2ボーンIK
 * throat の位置を chest ローカルで解き、左腕(shoulderL/elbowL)を
 * 身体の前からそこへ届かせる。
 * ======================================================== */
const _vGrip = new THREE.Vector3();
const _vTarget = new THREE.Vector3();
const _vRoot = new THREE.Vector3();
const _vAim = new THREE.Vector3();
const _vPole = new THREE.Vector3();
const _vElbowPos = new THREE.Vector3();
const _vUpperDir = new THREE.Vector3();
const _vLowerDir = new THREE.Vector3();
const _vLocalLower = new THREE.Vector3();
const _qShoulderInv = new THREE.Quaternion();
const _DOWN = new THREE.Vector3(0, -1, 0);
const _LEFT_ELBOW_POLE = new THREE.Vector3(-0.86, -0.26, 0.38);

function clamp1(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }

export function applyLeftHandGrip(joints, dims, root3D) {
  const { chest, handR, racketThroat, shoulderL, elbowL } = joints;
  const supportTarget = racketThroat || handR;
  if (!chest || !supportTarget || !shoulderL || !elbowL || !dims) return;

  // ラケットのスロート（三角部分）を chest ローカルへ。
  root3D.updateMatrixWorld(true);
  supportTarget.getWorldPosition(_vGrip);
  _vTarget.copy(_vGrip);
  chest.worldToLocal(_vTarget);
  _vTarget.z += 0.08; // 手と前腕を胴体表面より前へ出す

  // shoulderL は chest の子。肘を身体の外側かつ前方へ逃がして解く。
  _vRoot.copy(shoulderL.position);
  _vAim.copy(_vTarget).sub(_vRoot);
  const L1 = dims.upperArm, L2 = dims.foreArm;
  let dist = _vAim.length();
  dist = Math.min((L1 + L2) * 0.999, Math.max(Math.abs(L1 - L2) + 1e-3, dist));
  _vAim.normalize();

  const shoulderAng = Math.acos(clamp1((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));

  // aim に直交する pole 成分を作り、その方向へ肘を置く。
  _vPole.copy(_LEFT_ELBOW_POLE).sub(_vRoot);
  _vPole.addScaledVector(_vAim, -_vPole.dot(_vAim));
  if (_vPole.lengthSq() < 1e-6) _vPole.set(-1, 0, 1);
  _vPole.normalize();
  _vElbowPos.copy(_vRoot)
    .addScaledVector(_vAim, Math.cos(shoulderAng) * L1)
    .addScaledVector(_vPole, Math.sin(shoulderAng) * L1);

  _vUpperDir.copy(_vElbowPos).sub(_vRoot).normalize();
  _vLowerDir.copy(_vTarget).sub(_vElbowPos).normalize();

  // 上腕・前腕をそれぞれ解いた方向へ向ける。円柱なのでねじりは不要。
  shoulderL.quaternion.setFromUnitVectors(_DOWN, _vUpperDir);
  _qShoulderInv.copy(shoulderL.quaternion).invert();
  _vLocalLower.copy(_vLowerDir).applyQuaternion(_qShoulderInv);
  elbowL.quaternion.setFromUnitVectors(_DOWN, _vLocalLower);
}

/* ========================================================
 * スイング位相（swingT 由来）
 * ======================================================== */

/** swingT(残り時間) → phase 0..1（0=テイクバック開始, 1=振り抜き終了）。 */
export function swingPhaseOf(pl) {
  const dur = (TUNING.tempo && TUNING.tempo.swingDuration) || 0.42;
  return Math.max(0, Math.min(1, 1 - (pl.swingT || 0) / dur));
}

/** phase に応じ、SWING_KEYS の隣接2キーフレームを補間して joints へ適用。 */
export function applySwingPhase(joints, side, phase, baseHipY, isFront) {
  const keys = side === "back"
    ? SWING_KEYS.back
    : (isFront ? SWING_KEYS.frontFore : SWING_KEYS.rearFore);
  let i = 0;
  while (i < keys.length - 1 && phase > keys[i + 1].p) i++;
  const k0 = keys[i];
  const k1 = keys[Math.min(i + 1, keys.length - 1)];
  const span = k1.p - k0.p;
  const t = span > 0 ? (phase - k0.p) / span : 0;
  const clampedT = clamp01(t);
  const torsoDelay = isFront ? 0.04 : 0.08;
  const armDelay = isFront ? 0.11 : (side === "back" ? 0.16 : 0.18);
  // 脚と骨盤を先行させ、胸・肩、最後にラケットが追いつく。
  applyPose(joints, k0.pose, k1.pose, clampedT, baseHipY, {
    lower: smoothstep(clampedT),
    torso: smoothstep((clampedT - torsoDelay) / (1 - torsoDelay)),
    arm: smoothstep((clampedT - armDelay) / (1 - armDelay)),
  });
}

/**
 * 状態 pose → 使用する静的ポーズ名（スイング以外）。
 * - prep（ため／テイクバック）: フォア/バックのテイクバック
 * - volley（前衛ボレー）: フォアボレーのテイクバック（両手）
 * - その他（idle/ready/recover）: 構え
 */
export function poseNameForPlayer(pl, isFront) {
  const p = pl && pl.pose;
  const front = !!isFront;
  if (p === "prep") {
    if (pl.swingSide === "back") return "backhandTakeback";
    return front ? "forehandTakeback" : "rearForehandTakeback";
  }
  if (p === "volley") return front ? "forehandVolleyTakeback" : "rearReady";
  return front ? "ready" : "rearReady";
}
