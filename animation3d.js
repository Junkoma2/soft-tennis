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

const D = Math.PI / 180;

// rootLift: 骨盤 y のオフセット（負で重心を落とす＝しゃがむ）
export const POSES = {
  ready: {
    rootLift: -0.10,
    chest:     { x: 14, y: 0,  z: 0 },
    head:      { x: 4,  y: 0,  z: 0 },
    shoulderR: { x: 72, y: 0,  z: 16 },
    elbowR:    { x: -98, y: 0, z: 0 },
    handR:     { x: -10, y: 0, z: 0 },
    shoulderL: { x: 70, y: 0,  z: -20 },
    elbowL:    { x: -104, y: 0, z: 0 },
    hipR:      { x: 24, y: 0,  z: 0 },
    kneeR:     { x: -50, y: 0, z: 0 },
    footR:     { x: 26, y: 0,  z: 0 },
    hipL:      { x: 24, y: 0,  z: 0 },
    kneeL:     { x: -50, y: 0, z: 0 },
    footL:     { x: 26, y: 0,  z: 0 },
  },

  forehandVolleyTakeback: {
    rootLift: -0.08,
    chest:     { x: 10, y: 30, z: 0 },   // 上体を右へひねる
    head:      { x: 2,  y: -18, z: 0 },  // 視線はボール（正面寄り）
    shoulderR: { x: -34, y: 0, z: 26 },  // 右肩を引き上げる
    elbowR:    { x: -120, y: 0, z: 0 },  // ラケットを右耳後方へ
    handR:     { x: -20, y: 0, z: 0 },
    shoulderL: { x: 54, y: 10, z: -22 }, // 左手で軽く支える
    elbowL:    { x: -88, y: 0, z: 0 },
    hipR:      { x: 22, y: 0, z: 0 },
    kneeR:     { x: -46, y: 0, z: 0 },
    footR:     { x: 24, y: 0, z: 0 },
    hipL:      { x: 26, y: 0, z: 0 },
    kneeL:     { x: -52, y: 0, z: 0 },
    footL:     { x: 24, y: 0, z: 0 },
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

/** 状態 pose 文字列 → 使用するポーズ名（プロトタイプ用の最小マッピング） */
export function poseNameForPlayer(pl) {
  const p = pl && pl.pose;
  if (p === "swing" && pl.swingSide === "fore") return "forehandVolleyTakeback";
  // 将来：volley/serve/back 等をここで分岐
  return "ready";
}
