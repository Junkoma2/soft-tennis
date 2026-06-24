/**
 * 3D キャラのポーズ定義と補間
 *
 * 各ポーズは関節ごとの回転角（度）。limb ピボットは既定で -y（下）を向くので、
 * rotation.x が正 = 先端が後ろ(-z)へ / 負 = 前(+z, カメラ側)へ動く。
 * 右利き前衛・カメラ正対を基準にしている（左利きは player3d.js が group を X 反転）。
 *
 * 静的ポーズ（ready / volley / serve など）は applyPose() で前後ポーズ間を補間する。
 * スイングだけは swingT 由来の進行度で takeback→impact→follow の 3 キーフレームを
 * 連続補間し、2D（player-2d.js）と同等の「振る」運動連鎖を出す。
 */

import { TUNING } from "./config.js";

const D = Math.PI / 180;

// rootLift: 骨盤 y のオフセット（負で重心を落とす＝しゃがむ）
export const POSES = {
  // 後衛の構え（やや高め）
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

  // 前衛の構え（深いしゃがみ・前傾・低重心）
  readyFront: {
    rootLift: -0.20,
    chest:     { x: 26, y: 0,  z: 0 },
    head:      { x: -8, y: 0,  z: 0 },  // 前傾しても視線は前
    shoulderR: { x: 76, y: 0,  z: 18 },
    elbowR:    { x: -104, y: 0, z: 0 },
    handR:     { x: -12, y: 0, z: 0 },
    shoulderL: { x: 74, y: 0,  z: -22 },
    elbowL:    { x: -110, y: 0, z: 0 },
    hipR:      { x: 40, y: 0,  z: 0 },
    kneeR:     { x: -78, y: 0, z: 0 },
    footR:     { x: 38, y: 0,  z: 0 },
    hipL:      { x: 40, y: 0,  z: 0 },
    kneeL:     { x: -78, y: 0, z: 0 },
    footL:     { x: 38, y: 0,  z: 0 },
  },

  // フォロースルー後の構え直し（ready 寄り、まだ体が開き気味）
  recover: {
    rootLift: -0.12,
    chest:     { x: 16, y: 12, z: 0 },
    head:      { x: 2,  y: -8, z: 0 },
    shoulderR: { x: 40, y: 0,  z: 20 },
    elbowR:    { x: -86, y: 0, z: 0 },
    handR:     { x: -10, y: 0, z: 0 },
    shoulderL: { x: 58, y: 0,  z: -18 },
    elbowL:    { x: -92, y: 0, z: 0 },
    hipR:      { x: 28, y: 0,  z: 0 },
    kneeR:     { x: -56, y: 0, z: 0 },
    footR:     { x: 28, y: 0,  z: 0 },
    hipL:      { x: 26, y: 0,  z: 0 },
    kneeL:     { x: -54, y: 0, z: 0 },
    footL:     { x: 26, y: 0,  z: 0 },
  },

  // ---- ボレー（前衛が前へ詰めて押さえる）----
  volleyFore: {
    rootLift: -0.14,
    chest:     { x: 22, y: 24, z: 0 },
    head:      { x: 2,  y: -16, z: 0 },
    shoulderR: { x: 18, y: 0,  z: 30 },  // 右肩をやや上げて前へ
    elbowR:    { x: -72, y: 0, z: 0 },
    handR:     { x: -14, y: 0, z: 0 },
    shoulderL: { x: 50, y: 8,  z: -20 },
    elbowL:    { x: -80, y: 0, z: 0 },
    hipR:      { x: 34, y: 0,  z: 0 },
    kneeR:     { x: -64, y: 0, z: 0 },
    footR:     { x: 32, y: 0,  z: 0 },
    hipL:      { x: 36, y: 0,  z: 0 },
    kneeL:     { x: -66, y: 0, z: 0 },
    footL:     { x: 32, y: 0,  z: 0 },
  },
  volleyBack: {
    rootLift: -0.14,
    chest:     { x: 22, y: -22, z: 0 }, // 体を左へ向けバック面で押さえる
    head:      { x: 2,  y: 16, z: 0 },
    shoulderR: { x: 36, y: 0,  z: 40 },
    elbowR:    { x: -64, y: 0, z: 0 },
    handR:     { x: -8,  y: 0, z: 0 },
    shoulderL: { x: 30, y: 0,  z: -34 },
    elbowL:    { x: -70, y: 0, z: 0 },
    hipR:      { x: 36, y: 0,  z: 0 },
    kneeR:     { x: -66, y: 0, z: 0 },
    footR:     { x: 32, y: 0,  z: 0 },
    hipL:      { x: 34, y: 0,  z: 0 },
    kneeL:     { x: -64, y: 0, z: 0 },
    footL:     { x: 32, y: 0,  z: 0 },
  },

  // ---- サーブ ----
  serveToss: {
    rootLift: -0.04,
    chest:     { x: 6,  y: 8,  z: 0 },
    head:      { x: -16, y: 0, z: 0 },  // トスを見上げる
    shoulderR: { x: 40, y: 0,  z: 14 },  // 利き腕（右）はテイクバックへ
    elbowR:    { x: -70, y: 0, z: 0 },
    handR:     { x: -10, y: 0, z: 0 },
    shoulderL: { x: -150, y: 0, z: -10 }, // 左手を高く上げてトス
    elbowL:    { x: -8,  y: 0, z: 0 },
    hipR:      { x: 14, y: 0,  z: 0 },
    kneeR:     { x: -30, y: 0, z: 0 },
    footR:     { x: 16, y: 0,  z: 0 },
    hipL:      { x: 16, y: 0,  z: 0 },
    kneeL:     { x: -32, y: 0, z: 0 },
    footL:     { x: 16, y: 0,  z: 0 },
  },
  serveImpact: {
    rootLift: 0.02,                      // 伸び上がる
    chest:     { x: -16, y: 10, z: 0 },  // 体を反らせる
    head:      { x: -20, y: 0, z: 0 },
    shoulderR: { x: -168, y: 0, z: 8 },  // 右腕を頭上へ振り上げる
    elbowR:    { x: -24, y: 0, z: 0 },
    handR:     { x: -6,  y: 0, z: 0 },
    shoulderL: { x: 30, y: 0,  z: -16 }, // 左腕を引き下ろす
    elbowL:    { x: -60, y: 0, z: 0 },
    hipR:      { x: 8,  y: 0,  z: 0 },
    kneeR:     { x: -18, y: 0, z: 0 },
    footR:     { x: 12, y: 0,  z: 0 },
    hipL:      { x: 10, y: 0,  z: 0 },
    kneeL:     { x: -22, y: 0, z: 0 },
    footL:     { x: 12, y: 0,  z: 0 },
  },

  // ---- フォアハンド・ストローク（takeback → impact → follow）----
  foreTakeback: {
    rootLift: -0.10,
    chest:     { x: 12, y: 34, z: 0 },   // 上体を右へ大きくひねる
    head:      { x: 2,  y: -24, z: 0 },  // 視線はボール
    shoulderR: { x: -30, y: 0, z: 28 },  // 右肩を後方・上へ引く
    elbowR:    { x: -116, y: 0, z: 0 },  // ラケットを右後方へ
    handR:     { x: -22, y: 0, z: 0 },
    shoulderL: { x: 60, y: 14, z: -24 }, // 左手でバランス
    elbowL:    { x: -84, y: 0, z: 0 },
    hipR:      { x: 26, y: 0, z: 0 },
    kneeR:     { x: -54, y: 0, z: 0 },
    footR:     { x: 26, y: 0, z: 0 },
    hipL:      { x: 22, y: 0, z: 0 },
    kneeL:     { x: -48, y: 0, z: 0 },
    footL:     { x: 22, y: 0, z: 0 },
  },
  foreImpact: {
    rootLift: -0.06,
    chest:     { x: 8,  y: 0,  z: 0 },   // 正面へ戻し切る
    head:      { x: 2,  y: 0,  z: 0 },
    shoulderR: { x: 64, y: 0,  z: 10 },  // 右腕を前方・打点へ振り出す
    elbowR:    { x: -28, y: 0, z: 0 },   // 肘が伸びる
    handR:     { x: 4,  y: 0,  z: 0 },
    shoulderL: { x: 40, y: -8, z: -16 },
    elbowL:    { x: -70, y: 0, z: 0 },
    hipR:      { x: 18, y: 0, z: 0 },
    kneeR:     { x: -40, y: 0, z: 0 },
    footR:     { x: 22, y: 0, z: 0 },
    hipL:      { x: 24, y: 0, z: 0 },
    kneeL:     { x: -52, y: 0, z: 0 },
    footL:     { x: 24, y: 0, z: 0 },
  },
  foreFollow: {
    rootLift: -0.08,
    chest:     { x: 10, y: -34, z: 0 },  // 振り抜きで上体が左へ回り切る
    head:      { x: 2,  y: 12, z: 0 },
    shoulderR: { x: 96, y: 0,  z: -28 }, // 右腕が左肩越しへ抜ける
    elbowR:    { x: -84, y: 0, z: 0 },
    handR:     { x: -8,  y: 0, z: 0 },
    shoulderL: { x: 24, y: 0, z: -10 },
    elbowL:    { x: -60, y: 0, z: 0 },
    hipR:      { x: 16, y: 0, z: 0 },
    kneeR:     { x: -38, y: 0, z: 0 },
    footR:     { x: 20, y: 0, z: 0 },
    hipL:      { x: 26, y: 0, z: 0 },
    kneeL:     { x: -54, y: 0, z: 0 },
    footL:     { x: 24, y: 0, z: 0 },
  },

  // ---- バックハンド・ストローク（takeback → impact → follow）----
  backTakeback: {
    rootLift: -0.10,
    chest:     { x: 12, y: -36, z: 0 },  // 上体を左へひねる
    head:      { x: 2,  y: 26, z: 0 },
    shoulderR: { x: 50, y: 0,  z: 54 },  // 右手を左前へ引き込む（両手バック想定）
    elbowR:    { x: -100, y: 0, z: 0 },
    handR:     { x: -16, y: 0, z: 0 },
    shoulderL: { x: 36, y: 0,  z: -48 },
    elbowL:    { x: -96, y: 0, z: 0 },
    hipR:      { x: 22, y: 0, z: 0 },
    kneeR:     { x: -48, y: 0, z: 0 },
    footR:     { x: 24, y: 0, z: 0 },
    hipL:      { x: 26, y: 0, z: 0 },
    kneeL:     { x: -54, y: 0, z: 0 },
    footL:     { x: 24, y: 0, z: 0 },
  },
  backImpact: {
    rootLift: -0.06,
    chest:     { x: 8,  y: 4,  z: 0 },
    head:      { x: 2,  y: -4, z: 0 },
    shoulderR: { x: 70, y: 0,  z: 18 },  // 打点で右腕が体の右前へ開く
    elbowR:    { x: -34, y: 0, z: 0 },
    handR:     { x: 2,  y: 0,  z: 0 },
    shoulderL: { x: 58, y: 0, z: -20 },
    elbowL:    { x: -40, y: 0, z: 0 },
    hipR:      { x: 18, y: 0, z: 0 },
    kneeR:     { x: -40, y: 0, z: 0 },
    footR:     { x: 22, y: 0, z: 0 },
    hipL:      { x: 20, y: 0, z: 0 },
    kneeL:     { x: -44, y: 0, z: 0 },
    footL:     { x: 22, y: 0, z: 0 },
  },
  backFollow: {
    rootLift: -0.08,
    chest:     { x: 10, y: 34, z: 0 },   // 振り抜きで右へ回り切る
    head:      { x: 2,  y: -12, z: 0 },
    shoulderR: { x: 92, y: 0,  z: 36 },  // 右腕が右上へ抜ける
    elbowR:    { x: -52, y: 0, z: 0 },
    handR:     { x: -6,  y: 0, z: 0 },
    shoulderL: { x: 30, y: 0, z: -12 },
    elbowL:    { x: -64, y: 0, z: 0 },
    hipR:      { x: 24, y: 0, z: 0 },
    kneeR:     { x: -50, y: 0, z: 0 },
    footR:     { x: 22, y: 0, z: 0 },
    hipL:      { x: 18, y: 0, z: 0 },
    kneeL:     { x: -40, y: 0, z: 0 },
    footL:     { x: 20, y: 0, z: 0 },
  },
};

// 後方互換（旧名）。volleyFore に統合。
POSES.forehandVolleyTakeback = POSES.volleyFore;

const JOINT_NAMES = [
  "chest", "head", "shoulderR", "elbowR", "handR",
  "shoulderL", "elbowL", "hipR", "kneeR", "footR", "hipL", "kneeL", "footL",
];

// スイングの 3 キーフレームを並べる進行度（0..1）。impact がやや早め。
const SWING_KEYS = {
  fore: [
    { p: 0.0, pose: "foreTakeback" },
    { p: 0.42, pose: "foreImpact" },
    { p: 1.0, pose: "foreFollow" },
  ],
  back: [
    { p: 0.0, pose: "backTakeback" },
    { p: 0.42, pose: "backImpact" },
    { p: 1.0, pose: "backFollow" },
  ],
};

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

/**
 * スイング進行度 phase(0..1) に応じ、SWING_KEYS の隣接 2 キーフレームを
 * 補間して joints へ適用する。2D の運動連鎖と同様、takeback→impact→follow を連続再生。
 */
function applySwingPhase(joints, side, phase, baseHipY) {
  const keys = SWING_KEYS[side] || SWING_KEYS.fore;
  let i = 0;
  while (i < keys.length - 1 && phase > keys[i + 1].p) i++;
  const k0 = keys[i];
  const k1 = keys[Math.min(i + 1, keys.length - 1)];
  const span = k1.p - k0.p;
  const t = span > 0 ? (phase - k0.p) / span : 0;
  applyPose(joints, k0.pose, k1.pose, Math.max(0, Math.min(1, t)), baseHipY);
}

/** state の pose → 静的ポーズ名（スイング以外）。前衛判定は isFront で渡す。 */
export function poseNameForPlayer(pl, isFront) {
  const p = pl && pl.pose;
  if (p === "recover" || (pl && pl.recoverT > 0)) return "recover";
  if (p === "volley") return pl.swingSide === "back" ? "volleyBack" : "volleyFore";
  if (p === "toss") return "serveToss";
  if (p === "serve") return "serveImpact";
  // ready / idle / prep / その他
  return isFront ? "readyFront" : "ready";
}

/**
 * 選手の現在状態を joints に反映する統合エントリ。
 * スイング中はフェーズ駆動で直接確定し、{ swinging:true } を返す。
 * それ以外は静的ポーズ名を返し、呼び出し側が遷移ブレンドする。
 *
 * @returns {{ swinging: boolean, name?: string }}
 */
export function resolvePose(pl, joints, baseHipY, isFront) {
  if (pl && pl.pose === "swing") {
    const dur = (TUNING.tempo && TUNING.tempo.swingDuration) || 0.42;
    const swingT = pl.swingT || 0;
    const phase = Math.max(0, Math.min(1, 1 - swingT / dur));
    const side = pl.swingSide === "back" ? "back" : "fore";
    applySwingPhase(joints, side, phase, baseHipY);
    return { swinging: true };
  }
  return { swinging: false, name: poseNameForPlayer(pl, isFront) };
}
