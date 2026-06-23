/**
 * ソフトテニス プレイヤー 2D 描画モジュール（大幅改修版）
 *
 * 簡易2D骨格モデルを使用し、運動連鎖を表現
 * テイクバック → 踏み込み → インパクト → フォロースルー → リカバリー
 *
 * 改修内容：
 * - armAngle 中心から skeleton pose 計算へ
 * - フェーズ分割による自然な動き
 * - 腰 → 胸 → 肩 → 腕 → ラケットの順序付けられた回転
 * - ソフトテニス前衛のフォーム優先
 */

import {
  project, roundRect,
} from "./math.js";

import {
  ctx, ball, matchTime,
  back, front, cpuBack, cpuFront,
} from "./state.js";

import { TUNING } from "./config.js";
import { predictHighContact, predictLanding, canPlayerHit } from "./main.js";

/* ========================================================
 * 描画用アニメーションキャッシュ
 * ======================================================== */

const moveAnimState = new WeakMap();

function getMoveAnim(pl) {
  let a = moveAnimState.get(pl);
  if (!a) {
    a = { lastX: pl.x, lastY: pl.y, phase: 0, lastNow: performance.now() };
    moveAnimState.set(pl, a);
  }
  return a;
}

/**
 * ボール予測打点へのヨー角（正対）
 */
function bodyYawToBall(pl) {
  let tx = ball.x, ty = ball.y;
  const lp = predictHighContact() || predictLanding();
  if (lp) { tx = lp.x; ty = lp.y; }
  const me = project(pl.x, pl.y, 0);
  const tg = project(tx, ty, 0);
  const dxs = tg.x - me.x;
  const depth = Math.max(90, Math.abs(me.y - tg.y) + 110);
  const yaw = Math.atan2(dxs, depth);
  return Math.max(-0.6, Math.min(0.6, yaw));
}

/* ========================================================
 * Skeleton Pose 計算（描画用パラメータ）
 * ======================================================== */

/**
 * スイングフェーズを計算（0.0〜1.0）
 * 0.00-0.20: テイクバック
 * 0.20-0.45: 踏み込み・加速
 * 0.45-0.60: インパクト
 * 0.60-0.88: フォロースルー
 * 0.88-1.00: リカバリー開始
 */
function calcSwingPhase(pl, swingK) {
  if (!(pl.pose === "swing" && pl.swingT > 0)) {
    return null; // スイング中でない
  }
  return swingK; // 0.0〜1.0
}

/**
 * 骨格ポーズを計算
 * @param {Object} pl - プレイヤーオブジェクト
 * @param {number} s - スケール（px/m）
 * @param {number} swingK - スイング進捗（0〜1）
 * @returns {Object} skeleton ポーズパラメータ
 */
function calcSkeletonPose(pl, s, swingK) {
  const isFrontRole = pl === front || pl === cpuFront;
  const swingDir = pl.swingSide === "fore" ? 1 : -1;
  const facingDir = pl.facing === -1 ? 1 : -1;
  const handSign = pl.stats && pl.stats.handed === "left" ? -1 : 1;
  const foreDir = facingDir * handSign;
  const racketDir = foreDir;

  // === 基本パラメータ ===
  const phase = calcSwingPhase(pl, swingK);
  const isSwinging = phase !== null;
  const isServeSwing = pl.pose === "swing" && ball.serving && ball.lastHitter === (pl === back || pl === front ? "player" : "cpu");

  // === スプリットステップ ===
  const isOwnTeam = (pl === back || pl === front) ? "player" : "cpu";
  const sinceHit = matchTime - ball.lastHitTime;
  const splitIntensity = (isOwnTeam !== ball.lastHitter && sinceHit >= 0 && sinceHit < 0.22 && !isSwinging)
    ? Math.sin(sinceHit / 0.22 * Math.PI) * 0.12
    : 0;

  // === 重心・姿勢 ===
  const stanceCrouch = (isFrontRole ? 0.07 : 0.1) + splitIntensity;
  const isReadyPose = (pl.pose === "ready" || pl.pose === "idle") && !(pl.recoverT > 0);

  // === スイング中のパラメータ ===
  let pelvisRotation = 0;   // 腰の回転（度）
  let torsoRotation = 0;    // 胴体の回転（度）
  let shoulderRotation = 0; // 肩の回転（度）
  let armAngle = 0.25;      // 腕角度
  let elbowBend = 0.5;      // 肘の曲げ（0〜1）
  let torsoTwist = 0;       // 胴の捻り（左右）
  let foreWrap = 0;         // フォロースルー巻き付き（0〜1）
  let weightShift = 0;      // 体重移動（-1=後方，0=中央，+1=前方）
  let leadFootPlant = 0;    // 前足の踏み込み（0〜1）

  if (isSwinging && phase !== null) {
    if (isServeSwing) {
      // === サーブ ===
      if (phase < 0.2) {
        // テイクバック：沈み込み
        const t = phase / 0.2;
        armAngle = -2.3 + t * 1.0;
        pelvisRotation = 0;
        torsoRotation = 0;
        shoulderRotation = t * 15;
      } else if (phase < 0.5) {
        // 加速・インパクト準備
        const t = (phase - 0.2) / 0.3;
        armAngle = -1.3 + t * 1.5;
        shoulderRotation = 15 + t * 30;
        weightShift = t * 0.5;
      } else if (phase < 0.8) {
        // フォロースルー
        const t = (phase - 0.5) / 0.3;
        armAngle = 0.2 + t * 1.0;
        shoulderRotation = 45 + t * 30;
        torsoRotation = t * 20;
        weightShift = 0.5 + t * 0.3;
      } else {
        // リカバリー
        const t = (phase - 0.8) / 0.2;
        armAngle = 0.25 * (1 - t) + 0.6 * t;
        shoulderRotation = 75 * (1 - t) + 0 * t;
        weightShift = 0.8 * (1 - t) + 0.3 * t;
      }
    } else {
      // === グラウンドストローク（フォア/バック） ===
      if (phase < 0.2) {
        // テイクバック
        const t = phase / 0.2;
        const takebackAmp = (swingDir === 1 ? 0.15 : 0.08);
        armAngle = -takebackAmp + t * 0.2;
        pelvisRotation = t * (swingDir === 1 ? 20 : 10) * swingDir;
        torsoRotation = t * (swingDir === 1 ? 30 : 15) * swingDir;
        shoulderRotation = t * 40 * swingDir;
        weightShift = -t * 0.3;
      } else if (phase < 0.45) {
        // 踏み込み・加速
        const t = (phase - 0.2) / 0.25;
        const takebackAmp = (swingDir === 1 ? 0.15 : 0.08);
        armAngle = -takebackAmp + (0.2 + t * 1.2);
        pelvisRotation = (swingDir === 1 ? 20 : 10) * (1 - t * 0.3) * swingDir;
        torsoRotation = (swingDir === 1 ? 30 : 15) + t * (swingDir === 1 ? 40 : 20) * swingDir;
        shoulderRotation = 40 + t * 50 * swingDir;
        leadFootPlant = t * 0.8;
        weightShift = -0.3 + t * 0.8;
      } else if (phase < 0.6) {
        // インパクト
        const t = (phase - 0.45) / 0.15;
        armAngle = 1.4 + t * 0.2;
        pelvisRotation = (swingDir === 1 ? 14 : 7) * swingDir;
        torsoRotation = (swingDir === 1 ? 70 : 35) * swingDir;
        shoulderRotation = 90 * swingDir;
        leadFootPlant = 0.8 + t * 0.2;
        weightShift = 0.5 + t * 0.4;
      } else if (phase < 0.88) {
        // フォロースルー
        const t = (phase - 0.6) / 0.28;
        const eased = 1 - Math.pow(1 - t, 2);
        armAngle = 1.6 + eased * (swingDir === 1 ? 1.2 : 0.5);
        pelvisRotation = (swingDir === 1 ? 14 : 7) * swingDir;
        torsoRotation = (swingDir === 1 ? 70 : 35) * (1 - t * 0.3) * swingDir;
        shoulderRotation = 90 * swingDir;
        torsoTwist = eased * (swingDir === 1 ? 0.15 : -0.1) * foreDir;
        if (swingDir === 1) {
          foreWrap = Math.max(0, t - 0.4); // フォア：フォロースルー後半で首に巻き付く
        }
        weightShift = 0.9 * (1 - t * 0.2);
      } else {
        // リカバリー
        const t = (phase - 0.88) / 0.12;
        armAngle = (swingDir === 1 ? 2.8 : 2.1) * (1 - t) + 0.25 * t;
        shoulderRotation = 90 * (1 - t) * swingDir;
        torsoTwist = (swingDir === 1 ? 0.15 : -0.1) * (1 - t) * foreDir;
        foreWrap = (swingDir === 1 ? 1 : 0) * (1 - t);
        weightShift = (0.9 - t * 0.4);
      }
    }
  } else if (pl.recoverT > 0) {
    // === リカバリー（スイング後の戻り） ===
    const recoverK = Math.max(0, Math.min(1, 1 - pl.recoverT / TUNING.tempo.swingRecover));
    const finishAngle = pl.swingSide === "fore" ? 0.95 : 0.85;
    armAngle = finishAngle * (1 - recoverK) + 0.25 * recoverK;
    foreWrap = pl.swingSide === "fore" ? 1 - recoverK : 0;
  } else if (pl.pose === "prep") {
    // === 準備動作（テイクバック開始） ===
    armAngle = pl.swingSide === "back" ? 0.0 : -0.15;
    torsoTwist = (pl.swingSide === "fore" ? -0.055 : 0.045) * foreDir;
    pelvisRotation = pl.swingSide === "fore" ? 5 : -5;
  } else if (pl.pose === "toss") {
    // === トス ===
    armAngle = -2.3;
    shoulderRotation = 20;
  }

  return {
    pelvisRotation,
    torsoRotation,
    shoulderRotation,
    armAngle,
    elbowBend,
    wristAngle: 0,
    weightShift,
    stanceCrouch,
    leadFootPlant,
    foreWrap,
    torsoTwist,
    isReadyPose,
    isFrontRole,
    swingDir,
    foreDir,
    racketDir,
    isServeSwing,
  };
}

/* ========================================================
 * 描画ヘルパー関数
 * ======================================================== */

/**
 * 関節位置を計算（親座標からのオフセット）
 */
function getJointPosition(px, py, angle, distance) {
  return {
    x: px + Math.cos(angle) * distance,
    y: py + Math.sin(angle) * distance,
  };
}

/**
 * 肢体を描画（直線＆円）
 */
function drawLimb(fromX, fromY, toX, toY, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
}

/**
 * 胴体描画
 */
function drawTorso(x, y, skeleton, s) {
  const { stanceCrouch, pelvisRotation, torsoRotation, torsoTwist } = skeleton;
  const torsoHeight = (0.5 - stanceCrouch) * s;
  const torsoWidth = 0.46 * s;
  const torsoTop = y - 1.2 * s + stanceCrouch * s * 0.6;
  const torsoBottom = y - 0.5 * s;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((pelvisRotation + torsoRotation) * Math.PI / 180 * 0.2);

  ctx.fillStyle = skeleton.color;
  roundRect(ctx, -torsoWidth / 2 + torsoTwist * s, torsoTop - y, torsoWidth, torsoHeight, 0.12 * s);
  ctx.fill();

  ctx.restore();
}

/**
 * 頭部描画
 */
function drawHead(x, y, skeleton, s) {
  const headR = 0.23 * s;
  const headCy = y - 1.6 * s;

  ctx.fillStyle = skeleton.skin;
  ctx.beginPath();
  ctx.arc(x, headCy, headR, 0, Math.PI * 2);
  ctx.fill();

  // 髪
  ctx.fillStyle = skeleton.hair || "#3B2A1E";
  if (skeleton.facing === -1) {
    ctx.beginPath();
    ctx.arc(x, headCy, headR, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
  }
}

/**
 * 脚を描画
 */
function drawLegs(x, y, skeleton, s) {
  const legColor = "#1F2937";
  const legWidth = Math.max(1.5, 0.09 * s);
  const legLength = (0.5 - skeleton.stanceCrouch) * s;

  const leftX = x - 0.15 * s - skeleton.leadFootPlant * 0.08 * s;
  const rightX = x + 0.15 * s + skeleton.leadFootPlant * 0.08 * s;
  const feetY = y - 0.02 * s;

  drawLimb(leftX, y, leftX - 0.07 * s, feetY, legWidth, legColor);
  drawLimb(rightX, y, rightX + 0.07 * s, feetY, legWidth, legColor);
}

/**
 * 腕・ラケット描画
 */
function drawArmsAndRacket(x, y, skeleton, s) {
  const { armAngle, foreDir, racketDir, foreWrap, isReadyPose, shoulderRotation } = skeleton;
  const shoulderY = y - 1.08 * s;
  const racketLen = 0.62 * s;
  const armReach = isReadyPose ? 0.13 * s : 0.3 * s;

  // ハンド位置
  const armX = racketDir * Math.cos(armAngle);
  const armY = Math.sin(armAngle);
  let handX = x + racketDir * armReach * Math.abs(Math.cos(armAngle)) + racketDir * 0.06 * s;
  const readyHandDrop = isReadyPose ? 0.32 * s : 0;
  let handY = shoulderY + armReach * armY + readyHandDrop;

  // フォロースルー巻き付き
  if (foreWrap > 0) {
    const w = foreWrap;
    handX = handX * (1 - w) + (x - racketDir * 0.14 * s) * w;
    handY = handY * (1 - w) + (shoulderY - 0.06 * s) * w;
  }

  // 腕描画
  ctx.strokeStyle = skeleton.skin;
  ctx.lineWidth = Math.max(1.5, 0.08 * s);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - racketDir * 0.2 * s, shoulderY);
  ctx.lineTo(handX - racketDir * 0.05 * s, handY - 0.04 * s);
  ctx.stroke();

  // 利き腕
  ctx.beginPath();
  ctx.moveTo(x + racketDir * 0.2 * s, shoulderY);
  ctx.lineTo(handX, handY);
  ctx.stroke();

  // ラケット
  const racketTipX = armX * (1 - foreWrap * 0.55);
  const racketTipY = armY * (1 - foreWrap * 0.95);
  const rx = handX + racketTipX * racketLen * 0.55;
  const ry = handY + racketTipY * racketLen * 0.55;

  const gear = (skeleton.look && skeleton.look.racket) || { frame: "#7C3AED", string: "rgba(255,255,255,0.85)" };
  ctx.strokeStyle = gear.frame;
  ctx.lineWidth = Math.max(1.2, 0.05 * s);
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(rx, ry);
  ctx.stroke();

  // ラケットヘッド
  ctx.fillStyle = gear.frame;
  ctx.beginPath();
  ctx.ellipse(rx, ry, 0.13 * s, 0.17 * s, Math.atan2(racketTipY, racketTipX), 0, Math.PI * 2);
  ctx.fill();
}

/* ========================================================
 * メイン描画関数
 * ======================================================== */

export function drawHumanoid(pl) {
  const g = project(pl.x, pl.y, 0);
  const s = g.s;

  ctx.save();
  ctx.translate(g.x, g.y);

  // === 影 ===
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.34 * s, 0.13 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // === ボディヨー ===
  const bodyYaw = pl.pose !== "swing" ? bodyYawToBall(pl) : 0;
  if (bodyYaw) ctx.transform(Math.cos(bodyYaw), 0, 0, 1, 0, 0);

  // === ステップアニメーション ===
  const anim = getMoveAnim(pl);
  const now = performance.now();
  const animDt = Math.max(0.001, Math.min(0.1, (now - anim.lastNow) / 1000));
  const movedDist = Math.hypot(pl.x - anim.lastX, pl.y - anim.lastY);
  const moveSpeed = movedDist / animDt;
  const isMoving = moveSpeed > 0.15 && pl.pose !== "swing";
  if (isMoving) {
    anim.phase += animDt * Math.min(10, 6 + moveSpeed * 2.2);
  }
  anim.lastX = pl.x; anim.lastY = pl.y; anim.lastNow = now;

  // === Skeleton Pose 計算 ===
  const swingDuration = TUNING.tempo.swingDuration;
  const swingK = (pl.pose === "swing" && pl.swingT > 0)
    ? Math.max(0, Math.min(1, 1 - pl.swingT / swingDuration))
    : 0;

  const skeleton = calcSkeletonPose(pl, s, swingK);
  skeleton.color = pl.color;
  skeleton.skin = pl.skin;
  skeleton.look = pl.look;
  skeleton.facing = pl.facing;

  // === 描画 ===
  drawTorso(0, 0, skeleton, s);
  drawLegs(0, 0, skeleton, s);
  drawHead(0, 0, skeleton, s);
  drawArmsAndRacket(0, 0, skeleton, s);

  // === ラベル ===
  if (pl.label) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "600 " + Math.max(8, 0.28 * s) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(pl.label, 0, -1.6 * s - 0.1 * s);
  }

  // === フォア/バック表示 ===
  if (pl === (pl === back || pl === front ? back || front : null) && pl.pose === "ready") {
    const isBack = pl.swingSide === "back";
    const text = isBack ? "バック" : "フォア";
    const color = isBack ? "#F59E0B" : "#3B82F6";
    const bw = 0.95 * s;
    const by = -1.6 * s - 0.62 * s;
    ctx.fillStyle = color;
    roundRect(ctx, -bw / 2, by, bw, 0.36 * s, 0.1 * s);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 " + Math.max(8, 0.24 * s) + "px sans-serif";
    ctx.fillText(text, 0, by + 0.26 * s);
  }

  ctx.restore();

  // === 操作可能プレイヤーの範囲表示 ===
  if (canPlayerHit && canPlayerHit(pl)) {
    const pr = project(pl.x, pl.y, 0);
    const pulse = 1 + 0.08 * Math.sin(performance.now() / 70);
    ctx.strokeStyle = "rgba(99,102,241,0.9)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(pr.x, pr.y, 0.75 * pr.s * pulse, 0.3 * pr.s * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export { getMoveAnim, bodyYawToBall };
