/**
 * 3D キャラのポーズ定義と補間
 *
 * 各ポーズは関節ごとの回転角（度）。limb ピボットは既定で -y（下）を向くので、
 * rotation.x が正 = 先端が後ろ(-z)へ / 負 = 前(+z, カメラ側)へ動く。
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
    rootLift: -0.15,                     // 重心を落とす
    chest:     { x: 16, y: 0,  z: 0 },   // 前傾 ~16°
    head:      { x: -6, y: 0,  z: 0 },   // 前傾しても視線は前
    // 両腕を高く前へ。abduction(z)は小さく抑え、両手を中央へ寄せて顔〜胸の前で構える。
    shoulderR: { x: 82, y: 0,  z: 10 },  // 上腕を高く前へ
    elbowR:    { x: -104, y: 0, z: 0 },  // 肘を深く曲げ、ヘッドを顔の高さへ
    handR:     { x: -12, y: 0, z: 0 },
    shoulderL: { x: 80, y: 0,  z: -12 }, // 左手をグリップへ添える
    elbowL:    { x: -108, y: 0, z: 0 },
    hipR:      { x: 32, y: 0,  z: 0 },   // 股関節を曲げる
    kneeR:     { x: -62, y: 0, z: 0 },   // 膝を曲げる
    footR:     { x: 32, y: 0,  z: 0 },
    hipL:      { x: 32, y: 0,  z: 0 },
    kneeL:     { x: -62, y: 0, z: 0 },
    footL:     { x: 32, y: 0,  z: 0 },
  },

  // フォアボレーのテイクバック：右肩を少し引き、ラケットを右耳後方へ。
  // 左手で軽く支える。体は横向きになりすぎず、次の踏み込みに入れる低い姿勢。
  forehandVolleyTakeback: {
    rootLift: -0.15,                     // 構えと同等に低く
    chest:     { x: 16, y: 20, z: 0 },   // ひねりは控えめ（横向きになりすぎない）
    head:      { x: -4, y: -14, z: 0 },  // 視線はボール（正面寄り）
    shoulderR: { x: -26, y: 0, z: 24 },  // 右肩を少し引き上げる
    elbowR:    { x: -116, y: 0, z: 0 },  // ラケットを右耳後方へ
    handR:     { x: -18, y: 0, z: 0 },
    shoulderL: { x: 56, y: 8, z: -24 },  // 左手で軽く支える
    elbowL:    { x: -92, y: 0, z: 0 },
    hipR:      { x: 34, y: 0, z: 0 },    // 踏み込みに入れる低い構え
    kneeR:     { x: -66, y: 0, z: 0 },
    footR:     { x: 32, y: 0, z: 0 },
    hipL:      { x: 36, y: 0, z: 0 },
    kneeL:     { x: -68, y: 0, z: 0 },
    footL:     { x: 32, y: 0, z: 0 },
  },

  // ===== フォアハンド・ストローク（水平に振り抜く「びんた」） =====
  // 体のひねり(chest.y)で、肩の高さに保った腕＝ラケットを水平に薙ぎ払う。
  // takeback(右へ大きくコイル) → contact(正面で腕を伸ばす) → follow(左へ振り抜く)。
  forehandTakeback: {
    rootLift: -0.12,
    chest:     { x: 10, y: 50,  z: 0 },   // 右へコイル（+y で右腕が後ろ -z へ）
    head:      { x: -2, y: -36, z: 0 },   // 視線はボール（正面）
    shoulderR: { x: 84, y: -6, z: 30 },   // 腕を肩の高さで右後方へ
    elbowR:    { x: -76, y: 0, z: 0 },     // 肘を曲げ、ヘッドを後方へ立てる
    handR:     { x: -16, y: 0, z: 0 },
    shoulderL: { x: 32, y: 0, z: -34 },   // 左腕は前でバランス
    elbowL:    { x: -60, y: 0, z: 0 },
    hipR:      { x: 30, y: 0, z: 0 },      // 体重は後ろ脚(右)
    kneeR:     { x: -58, y: 0, z: 0 },
    footR:     { x: 30, y: 0, z: 0 },
    hipL:      { x: 34, y: 0, z: 0 },
    kneeL:     { x: -64, y: 0, z: 0 },
    footL:     { x: 32, y: 0, z: 0 },
  },
  forehandContact: {
    rootLift: -0.10,
    chest:     { x: 8,  y: 2,  z: 0 },    // 正面まで戻す
    head:      { x: 0,  y: 0,  z: 0 },
    shoulderR: { x: 92, y: 8, z: 12 },    // 腕を前へ伸ばし、肩の高さで打点
    elbowR:    { x: -26, y: 0, z: 0 },     // 肘がほぼ伸びる
    handR:     { x: -6, y: 0, z: 0 },
    shoulderL: { x: 36, y: 0, z: -18 },
    elbowL:    { x: -72, y: 0, z: 0 },
    hipR:      { x: 26, y: 0, z: 0 },      // 体重は前脚(左)へ
    kneeR:     { x: -52, y: 0, z: 0 },
    footR:     { x: 28, y: 0, z: 0 },
    hipL:      { x: 30, y: 0, z: 0 },
    kneeL:     { x: -58, y: 0, z: 0 },
    footL:     { x: 30, y: 0, z: 0 },
  },
  forehandFollow: {
    rootLift: -0.10,
    chest:     { x: 10, y: -48, z: 0 },   // 左へ振り抜き（uncoil）
    head:      { x: 0,  y: 28, z: 0 },
    shoulderR: { x: 80, y: 22, z: -34 },  // 腕が左へ薙ぎ払われる（肩の高さ維持）
    elbowR:    { x: -94, y: 0, z: 0 },     // 左肩越しに巻き取る
    handR:     { x: -16, y: 0, z: 0 },
    shoulderL: { x: 24, y: 0, z: -8 },
    elbowL:    { x: -58, y: 0, z: 0 },
    hipR:      { x: 24, y: 0, z: 0 },
    kneeR:     { x: -50, y: 0, z: 0 },
    footR:     { x: 26, y: 0, z: 0 },
    hipL:      { x: 28, y: 0, z: 0 },
    kneeL:     { x: -56, y: 0, z: 0 },
    footL:     { x: 28, y: 0, z: 0 },
  },

  // ===== バックハンド・ストローク（水平に振り抜く） =====
  // フォアの鏡。左へコイル → 正面 → 右へ振り抜く。
  backhandTakeback: {
    rootLift: -0.12,
    chest:     { x: 10, y: -44, z: 0 },   // 左へコイル
    head:      { x: -2, y: 32, z: 0 },
    shoulderR: { x: 72, y: 0, z: 64 },    // 右腕を体の左前へ引き込む
    elbowR:    { x: -90, y: 0, z: 0 },
    handR:     { x: -14, y: 0, z: 0 },
    shoulderL: { x: 40, y: 0, z: -50 },   // 左手で支える
    elbowL:    { x: -84, y: 0, z: 0 },
    hipR:      { x: 32, y: 0, z: 0 },
    kneeR:     { x: -62, y: 0, z: 0 },
    footR:     { x: 30, y: 0, z: 0 },
    hipL:      { x: 30, y: 0, z: 0 },
    kneeL:     { x: -58, y: 0, z: 0 },
    footL:     { x: 30, y: 0, z: 0 },
  },
  backhandContact: {
    rootLift: -0.10,
    chest:     { x: 8,  y: 0,  z: 0 },
    head:      { x: 0,  y: 0,  z: 0 },
    shoulderR: { x: 88, y: 0, z: 22 },    // 体の前で腕を伸ばす
    elbowR:    { x: -28, y: 0, z: 0 },
    handR:     { x: -6, y: 0, z: 0 },
    shoulderL: { x: 42, y: 0, z: -24 },
    elbowL:    { x: -60, y: 0, z: 0 },
    hipR:      { x: 26, y: 0, z: 0 },
    kneeR:     { x: -52, y: 0, z: 0 },
    footR:     { x: 28, y: 0, z: 0 },
    hipL:      { x: 28, y: 0, z: 0 },
    kneeL:     { x: -54, y: 0, z: 0 },
    footL:     { x: 28, y: 0, z: 0 },
  },
  backhandFollow: {
    rootLift: -0.10,
    chest:     { x: 10, y: 42, z: 0 },    // 右へ振り抜き
    head:      { x: 0,  y: -26, z: 0 },
    shoulderR: { x: 82, y: -12, z: -12 }, // 腕が右へ薙ぎ払われる
    elbowR:    { x: -66, y: 0, z: 0 },
    handR:     { x: -12, y: 0, z: 0 },
    shoulderL: { x: 28, y: 0, z: -10 },
    elbowL:    { x: -54, y: 0, z: 0 },
    hipR:      { x: 24, y: 0, z: 0 },
    kneeR:     { x: -50, y: 0, z: 0 },
    footR:     { x: 26, y: 0, z: 0 },
    hipL:      { x: 26, y: 0, z: 0 },
    kneeL:     { x: -52, y: 0, z: 0 },
    footL:     { x: 26, y: 0, z: 0 },
  },
};

// スイングの3キーフレーム（phase 0..1）。impact がやや早め。
const SWING_KEYS = {
  fore: [
    { p: 0.0, pose: "forehandTakeback" },
    { p: 0.40, pose: "forehandContact" },
    { p: 1.0, pose: "forehandFollow" },
  ],
  back: [
    { p: 0.0, pose: "backhandTakeback" },
    { p: 0.40, pose: "backhandContact" },
    { p: 1.0, pose: "backhandFollow" },
  ],
};

const JOINT_NAMES = [
  "chest", "head", "shoulderR", "elbowR", "handR",
  "shoulderL", "elbowL", "hipR", "kneeR", "footR", "hipL", "kneeL", "footL",
];

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpEuler(jointPose, ea, eb, t) {
  ea = ea || { x: 0, y: 0, z: 0 };
  eb = eb || { x: 0, y: 0, z: 0 };
  jointPose.rotation.set(
    lerp(ea.x, eb.x, t) * D,
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
export function applyPose(joints, poseAName, poseBName, t, baseHipY) {
  const A = POSES[poseAName] || POSES.ready;
  const B = POSES[poseBName] || A;

  for (const name of JOINT_NAMES) {
    if (joints[name]) lerpEuler(joints[name], A[name], B[name], t);
  }

  // 重心（骨盤 y）
  const liftA = A.rootLift || 0;
  const liftB = B.rootLift || 0;
  if (joints.pelvis) {
    joints.pelvis.position.y = (baseHipY || 0.78) + lerp(liftA, liftB, t);
  }
}

/* ========================================================
 * 左手をラケットのグリップへ合わせる簡易2ボーンIK
 * 右手(handR)の位置を chest ローカルで解き、左腕(shoulderL/elbowL)を
 * そこへ届かせる。これで「右手で握り、左手を添える」両手構えになる。
 * ======================================================== */
const _vGrip = new THREE.Vector3();
const _vTarget = new THREE.Vector3();
const _vRoot = new THREE.Vector3();
const _vAim = new THREE.Vector3();
const _vAxis = new THREE.Vector3();
const _vElbowDir = new THREE.Vector3();
const _vx = new THREE.Vector3();
const _vy = new THREE.Vector3();
const _vz = new THREE.Vector3();
const _mBasis = new THREE.Matrix4();
const _POLE = new THREE.Vector3(0, -0.2, 1); // 肘を前下方へ逃がす
const _GRIP_DROP = 0.045;                     // 右手のわずか下（グリップ側）へ添える

function clamp1(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }

export function applyLeftHandGrip(joints, dims, root3D) {
  const { chest, handR, shoulderL, elbowL } = joints;
  if (!chest || !handR || !shoulderL || !elbowL || !dims) return;

  // 右手(グリップ)の現在位置を chest ローカルへ
  root3D.updateMatrixWorld(true);
  handR.getWorldPosition(_vGrip);
  _vTarget.copy(_vGrip);
  chest.worldToLocal(_vTarget);
  _vTarget.y -= _GRIP_DROP;

  // shoulderL は chest の子。chest ローカルで2ボーンIKを解く。
  _vRoot.copy(shoulderL.position);
  _vAim.copy(_vTarget).sub(_vRoot);
  const L1 = dims.upperArm, L2 = dims.foreArm;
  let dist = _vAim.length();
  dist = Math.min((L1 + L2) * 0.999, Math.max(Math.abs(L1 - L2) + 1e-3, dist));
  _vAim.normalize();

  const shoulderAng = Math.acos(clamp1((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
  const elbowAng = Math.acos(clamp1((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2)));

  // 曲げ平面の法線（肘を _POLE 方向へ向ける）
  _vAxis.copy(_vAim).cross(_POLE);
  if (_vAxis.lengthSq() < 1e-6) _vAxis.set(1, 0, 0);
  _vAxis.normalize();

  // 上腕方向：aim を肩角だけ _POLE 側へ持ち上げる
  _vElbowDir.copy(_vAim).applyAxisAngle(_vAxis, shoulderAng);

  // 肩の基底（local -y → elbowDir, local x → axis）
  _vx.copy(_vAxis);
  _vy.copy(_vElbowDir).negate();
  _vz.copy(_vx).cross(_vy).normalize();
  _vx.copy(_vy).cross(_vz).normalize();
  _mBasis.makeBasis(_vx, _vy, _vz);
  shoulderL.quaternion.setFromRotationMatrix(_mBasis);

  // 肘：直線(π)から内側へ曲げる（ヒンジ=local x=axis）
  elbowL.rotation.set(-(Math.PI - elbowAng), 0, 0);
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
export function applySwingPhase(joints, side, phase, baseHipY) {
  const keys = SWING_KEYS[side] || SWING_KEYS.fore;
  let i = 0;
  while (i < keys.length - 1 && phase > keys[i + 1].p) i++;
  const k0 = keys[i];
  const k1 = keys[Math.min(i + 1, keys.length - 1)];
  const span = k1.p - k0.p;
  const t = span > 0 ? (phase - k0.p) / span : 0;
  applyPose(joints, k0.pose, k1.pose, Math.max(0, Math.min(1, t)), baseHipY);
}

/**
 * 状態 pose → 使用する静的ポーズ名（スイング以外）。
 * - prep（ため／テイクバック）: フォア/バックのテイクバック
 * - volley（前衛ボレー）: フォアボレーのテイクバック（両手）
 * - その他（idle/ready/recover）: 構え
 */
export function poseNameForPlayer(pl, isFront) {
  const p = pl && pl.pose;
  if (p === "prep") return pl.swingSide === "back" ? "backhandTakeback" : "forehandTakeback";
  if (p === "volley") return "forehandVolleyTakeback";
  return "ready";
}
