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

const D = Math.PI / 180;

// rootLift: 骨盤 y のオフセット（負で重心を落とす＝しゃがむ）
export const POSES = {
  // 構え：直立厳禁。膝・股関節を曲げ、約18°前傾し低重心。
  // ラケットは顔の横〜胸の前に高く保ち（腰へ下げない）、左手を軽く添える。
  ready: {
    rootLift: -0.15,                     // 重心を落とす
    chest:     { x: 16, y: 0,  z: 0 },   // 前傾 ~16°
    head:      { x: -6, y: 0,  z: 0 },   // 前傾しても視線は前
    // 右腕は体の右へ少し開いて構える。後方視点（味方は背中向き）でも、
    // 右肘・前腕・グリップが胴の右側に見えて「右手で握っている」と分かるように。
    shoulderR: { x: 68, y: 0,  z: 36 },  // 上腕を右へ開きつつ前へ上げる
    elbowR:    { x: -98, y: 0, z: 0 },   // 肘を曲げ、ラケットを顔〜胸の右前へ
    handR:     { x: -12, y: 0, z: 0 },
    // 左手は IK でグリップへ合わせる（下の applyLeftHandGrip）。初期値は控えめに。
    shoulderL: { x: 64, y: 0,  z: -8 },
    elbowL:    { x: -96, y: 0, z: 0 },
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

/** 状態 pose 文字列 → 使用するポーズ名（プロトタイプ用の最小マッピング） */
export function poseNameForPlayer(pl) {
  const p = pl && pl.pose;
  if (p === "swing" && pl.swingSide === "fore") return "forehandVolleyTakeback";
  // 将来：volley/serve/back 等をここで分岐
  return "ready";
}
