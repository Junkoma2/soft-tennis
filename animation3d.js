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
