/**
 * ソフトテニス プレイヤー 2D 描画モジュール【大幅改修版】
 *
 * 骨格ベースの高精度描画
 * armAngle 中心の簡易モデルから、
 * 骨格→関節座標→描画 方式へ完全に転換
 *
 * 骨格構造：
 * - 胴体：pelvis → spine → chest → neck → head
 * - 右腕：shoulder → elbow → wrist → hand → racket
 * - 左腕：shoulder → elbow → wrist → hand
 * - 右脚：hip → knee → ankle → foot
 * - 左脚：hip → knee → ankle → foot
 *
 * スイングフェーズ（0.0-1.0 正規化）：
 * 0.00-0.20: TAKEBACK（テイクバック）
 * 0.20-0.45: STEP_AND_LOAD（踏み込み・体重移動）
 * 0.45-0.60: IMPACT（インパクト）
 * 0.60-0.88: FOLLOW_THROUGH（フォロースルー）
 * 0.88-1.00: RECOVERY（リカバリー）
 */

import {
  project, roundRect,
} from "./math.js";

import {
  ctx, ball, matchTime, rallyControlled, state,
  back, front, cpuBack, cpuFront,
} from "./state.js";

import { TUNING } from "./config.js";
import { predictHighContact, predictLanding } from "./main.js";
import { canPlayerHit } from "./input.js";

/* ========================================================
 * 描画用アニメーションキャッシュ
 * ======================================================== */

const moveAnimState = new WeakMap();

function getMoveAnim(pl) {
  let a = moveAnimState.get(pl);
  if (!a) {
    a = { lastX: pl.x, lastY: pl.y, phase: 0, lastNow: performance.now(), splitPhase: 0 };
    moveAnimState.set(pl, a);
  }
  return a;
}

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
 * フェーズ計算
 * ======================================================== */

function calcSwingPhase(pl, swingK) {
  if (!pl.swingDuration) return null;
  const phase = swingK / pl.swingDuration;
  if (phase < 0.0 || phase > 1.0) return null;

  if (phase < 0.20) return { name: "TAKEBACK", phase, t: phase / 0.20 };
  if (phase < 0.45) return { name: "STEP_AND_LOAD", phase, t: (phase - 0.20) / 0.25 };
  if (phase < 0.60) return { name: "IMPACT", phase, t: (phase - 0.45) / 0.15 };
  if (phase < 0.88) return { name: "FOLLOW_THROUGH", phase, t: (phase - 0.60) / 0.28 };
  return { name: "RECOVERY", phase, t: (phase - 0.88) / 0.12 };
}

/* ========================================================
 * スケルトンポーズ計算【核心関数】
 * ========================================================
 *
 * 全関節の角度・曲げ度を計算
 * pl.pose, pl.swingSide, pl.stats.handed を尊重
 * 既存の state 構造は変更しない
 */

function calcSkeletonPose(pl, swingK) {
  const isFront = pl === front || pl === cpuFront;
  const isServe = pl.pose === "serve" || pl.pose === "toss";
  const isSwinging = pl.pose === "swing";
  const isRecover = pl.pose === "recover";
  const isReady = pl.pose === "ready" || pl.pose === "idle";

  const swingPhase = isSwinging ? calcSwingPhase(pl, swingK) : null;
  const isForehand = pl.swingSide === "fore";
  const isLeftHanded = pl.stats.handed === "left";

  // デフォルト値
  let skeleton = {
    // 胴体
    pelvisRotation: 0,
    spineRotation: 0,
    chestRotation: 0,
    neckRotation: 0,
    torsoLean: 0,

    // 右腕
    shoulderRotationR: 0,
    elbowBendR: 0.1,
    wristAngleR: 0,

    // 左腕
    shoulderRotationL: 0,
    elbowBendL: 0.1,
    wristAngleL: 0,

    // 右脚
    hipRotationR: 0,
    kneeBendR: 0.15,
    ankleAngleR: 0,

    // 左脚
    hipRotationL: 0,
    kneeBendL: 0.15,
    ankleAngleL: 0,

    // 全身
    weightShift: 0,
    stanceWidth: 0.28,
    crouch: 0.15,
    leadFootPlant: 0,
    foreWrap: 0,
  };

  // 前衛・後衛共通の基本姿勢
  skeleton.crouch = isFront ? 0.20 : 0.12;
  skeleton.torsoLean = isFront ? 0.25 : 0.15;
  skeleton.kneeBendR = isFront ? 0.22 : 0.18;
  skeleton.kneeBendL = isFront ? 0.22 : 0.18;

  // === READY / IDLE ===
  if (isReady) {
    skeleton.shoulderRotationR = isForehand ? -0.3 : 0;
    skeleton.shoulderRotationL = isForehand ? 0 : -0.3;
    skeleton.elbowBendR = isForehand ? 0.25 : 0.15;
    skeleton.elbowBendL = isForehand ? 0.15 : 0.25;
    return skeleton;
  }

  // === SERVE ===
  if (isServe) {
    const toss = pl.pose === "toss";
    if (toss) {
      skeleton.shoulderRotationR = isLeftHanded ? 0.1 : -0.2;
      skeleton.elbowBendR = isLeftHanded ? 0.3 : 0.1;
      skeleton.shoulderRotationL = isLeftHanded ? 0.5 : 0.1;
    } else {
      // serve swing
      skeleton.pelvisRotation = 0.3;
      skeleton.chestRotation = 0.5;
      skeleton.neckRotation = 0.2;
      skeleton.shoulderRotationR = isLeftHanded ? 0.1 : -0.4;
      skeleton.elbowBendR = isLeftHanded ? 0.2 : 0.4;
      skeleton.wristAngleR = isLeftHanded ? 0.1 : 0.3;
      skeleton.foreWrap = 0;
    }
    return skeleton;
  }

  // === SWING（フェーズベースのアニメーション） ===
  if (isSwinging && swingPhase) {
    const { name, t } = swingPhase;

    // フェーズ共通の基本値
    const isRightArmSwing = (isForehand && !isLeftHanded) || (!isForehand && isLeftHanded);
    const armSide = isRightArmSwing ? "R" : "L";

    if (name === "TAKEBACK") {
      // テイクバック：肩を引く、ラケット耳後方
      skeleton.pelvisRotation = t * 0.15;
      skeleton.chestRotation = t * 0.25;
      skeleton.neckRotation = t * 0.1;

      if (isRightArmSwing) {
        skeleton.shoulderRotationR = -0.4 * t;
        skeleton.elbowBendR = 0.25 + 0.15 * t;
        skeleton.wristAngleR = 0.2 * t;
        skeleton.shoulderRotationL = 0.1 * t;
      } else {
        skeleton.shoulderRotationL = -0.4 * t;
        skeleton.elbowBendL = 0.25 + 0.15 * t;
        skeleton.wristAngleL = 0.2 * t;
        skeleton.shoulderRotationR = 0.1 * t;
      }

      skeleton.weightShift = -0.15 * t;
      skeleton.hipRotationL = -0.1 * t;
      skeleton.hipRotationR = 0.05 * t;
    }
    else if (name === "STEP_AND_LOAD") {
      // 踏み込み・体重移動：前足を出す、体重を前へ
      const prevT = (0.20 / pl.swingDuration) / 0.25;
      skeleton.pelvisRotation = 0.15 + t * 0.2;
      skeleton.chestRotation = 0.25 + t * 0.35;
      skeleton.neckRotation = 0.1 + t * 0.1;

      if (isRightArmSwing) {
        skeleton.shoulderRotationR = -0.4 + t * 0.2;
        skeleton.elbowBendR = 0.4 + t * 0.1;
        skeleton.wristAngleR = 0.2 + t * 0.1;
      } else {
        skeleton.shoulderRotationL = -0.4 + t * 0.2;
        skeleton.elbowBendL = 0.4 + t * 0.1;
        skeleton.wristAngleL = 0.2 + t * 0.1;
      }

      skeleton.weightShift = -0.15 + t * 0.25;
      skeleton.leadFootPlant = t * 0.5;
      skeleton.hipRotationL = -0.1 + t * 0.15;
      skeleton.hipRotationR = 0.05 + t * 0.1;
    }
    else if (name === "IMPACT") {
      // インパクト：最大回転、体重完全に前
      skeleton.pelvisRotation = 0.35;
      skeleton.chestRotation = 0.6;
      skeleton.neckRotation = 0.2;

      if (isRightArmSwing) {
        skeleton.shoulderRotationR = -0.2;
        skeleton.elbowBendR = 0.5 + t * 0.05;
        skeleton.wristAngleR = 0.3;
      } else {
        skeleton.shoulderRotationL = -0.2;
        skeleton.elbowBendL = 0.5 + t * 0.05;
        skeleton.wristAngleL = 0.3;
      }

      skeleton.weightShift = 0.1 + t * 0.1;
      skeleton.leadFootPlant = 0.5 + t * 0.3;
      skeleton.hipRotationL = 0.05;
      skeleton.hipRotationR = 0.15;
    }
    else if (name === "FOLLOW_THROUGH") {
      // フォロースルー：巻き付き、腕が顔の前を通る
      skeleton.pelvisRotation = 0.35;
      skeleton.chestRotation = 0.5 - t * 0.1;
      skeleton.neckRotation = 0.2;

      if (isRightArmSwing) {
        skeleton.shoulderRotationR = -0.1 + t * 0.2;
        skeleton.elbowBendR = 0.55 - t * 0.1;
        skeleton.wristAngleR = 0.3 - t * 0.2;
        skeleton.foreWrap = t * 0.8;
      } else {
        skeleton.shoulderRotationL = -0.1 + t * 0.2;
        skeleton.elbowBendL = 0.55 - t * 0.1;
        skeleton.wristAngleL = 0.3 - t * 0.2;
        skeleton.foreWrap = t * 0.8;
      }

      skeleton.weightShift = 0.2;
      skeleton.leadFootPlant = 0.8;
    }
    else if (name === "RECOVERY") {
      // リカバリー：姿勢を戻す
      skeleton.pelvisRotation = 0.35 * (1 - t);
      skeleton.chestRotation = 0.4 * (1 - t);
      skeleton.neckRotation = 0.2 * (1 - t);

      if (isRightArmSwing) {
        skeleton.shoulderRotationR = 0.1 * (1 - t);
        skeleton.elbowBendR = 0.45 * (1 - t) + 0.15 * t;
        skeleton.foreWrap = 0.8 * (1 - t);
      } else {
        skeleton.shoulderRotationL = 0.1 * (1 - t);
        skeleton.elbowBendL = 0.45 * (1 - t) + 0.15 * t;
        skeleton.foreWrap = 0.8 * (1 - t);
      }

      skeleton.weightShift = 0.2 * (1 - t);
      skeleton.leadFootPlant = 0.8 * (1 - t);
    }
  }

  // === RECOVER ===
  if (isRecover) {
    skeleton.pelvisRotation = 0;
    skeleton.chestRotation = 0;
    skeleton.shoulderRotationR = 0.2;
    skeleton.shoulderRotationL = 0.2;
    skeleton.elbowBendR = 0.2;
    skeleton.elbowBendL = 0.2;
    skeleton.weightShift = 0;
  }

  return skeleton;
}

/* ========================================================
 * 関節ワールド座標計算【新規】
 * ========================================================
 *
 * スケルトンポーズから全関節の絶対座標を計算
 * facing（1=正面, -1=背面）を反映
 */

function calcSkeletonWorldPos(skeleton, basePx, basePy, facing, s) {
  const joints = {};

  // 基準寸法（スケール s に対して）
  const torsoH = 0.25 * s;
  const torsoWH = 0.15 * s;
  const torsoWL = 0.12 * s;
  const neckH = 0.05 * s;
  const headR = 0.09 * s;

  const armU = 0.15 * s;
  const armF = 0.14 * s;
  const wristH = 0.04 * s;
  const handH = 0.05 * s;

  const legU = 0.18 * s;
  const legL = 0.17 * s;
  const footH = 0.06 * s;

  // 胴体中心
  joints.pelvis = {
    x: basePx,
    y: basePy + skeleton.weightShift * 0.05 * s,
  };

  // 脊椎（胴体の列）
  const spineY = joints.pelvis.y - torsoH * 0.3;
  joints.spine = {
    x: basePx + skeleton.spineRotation * 0.05 * s * facing,
    y: spineY,
  };

  const chestY = joints.pelvis.y - torsoH * 0.7;
  joints.chest = {
    x: basePx + skeleton.chestRotation * 0.08 * s * facing,
    y: chestY,
  };

  // 頸部・頭
  const neckY = joints.chest.y - neckH;
  joints.neck = {
    x: basePx + skeleton.neckRotation * 0.08 * s * facing,
    y: neckY,
  };

  joints.head = {
    x: joints.neck.x + skeleton.neckRotation * 0.05 * s * facing,
    y: neckY - headR,
  };

  // 右腕（5点構造）
  const shoulderRx = basePx + torsoWH * facing;
  const shoulderRy = chestY;
  joints.shoulderR = { x: shoulderRx, y: shoulderRy };

  const elbowRx = shoulderRx + armU * Math.cos(skeleton.shoulderRotationR + Math.PI * 0.5) * facing;
  const elbowRy = shoulderRy + armU * Math.sin(skeleton.shoulderRotationR);
  joints.elbowR = { x: elbowRx, y: elbowRy };

  const wristRx = elbowRx + armF * Math.cos(skeleton.shoulderRotationR + skeleton.elbowBendR * Math.PI) * facing;
  const wristRy = elbowRy + armF * Math.sin(skeleton.shoulderRotationR + skeleton.elbowBendR * Math.PI * 0.5);
  joints.wristR = { x: wristRx, y: wristRy };

  joints.handR = { x: wristRx, y: wristRy - wristH };

  const racketAngle = skeleton.wristAngleR + skeleton.foreWrap * Math.PI * 0.3;
  joints.racketR = {
    x: wristRx + 0.1 * s * Math.cos(racketAngle) * facing,
    y: wristRy - 0.15 * s * Math.sin(racketAngle),
  };

  // 左腕（5点構造）
  const shoulderLx = basePx - torsoWH * facing;
  const shoulderLy = chestY;
  joints.shoulderL = { x: shoulderLx, y: shoulderLy };

  const elbowLx = shoulderLx - armU * Math.cos(skeleton.shoulderRotationL + Math.PI * 0.5) * facing;
  const elbowLy = shoulderLy + armU * Math.sin(skeleton.shoulderRotationL);
  joints.elbowL = { x: elbowLx, y: elbowLy };

  const wristLx = elbowLx - armF * Math.cos(skeleton.shoulderRotationL + skeleton.elbowBendL * Math.PI) * facing;
  const wristLy = elbowLy + armF * Math.sin(skeleton.shoulderRotationL + skeleton.elbowBendL * Math.PI * 0.5);
  joints.wristL = { x: wristLx, y: wristLy };

  joints.handL = { x: wristLx, y: wristLy - wristH };

  // 右脚（4点構造）
  const hipRx = basePx + skeleton.stanceWidth * s * 0.5 + skeleton.leadFootPlant * 0.1 * s * facing;
  const hipRy = joints.pelvis.y + 0.01 * s;
  joints.hipR = { x: hipRx, y: hipRy };

  const kneeRx = hipRx + legU * 0.3 * Math.cos(skeleton.hipRotationR) * facing;
  const kneeRy = hipRy + legU;
  joints.kneeR = { x: kneeRx, y: kneeRy };

  const ankleRx = kneeRx + legL * 0.3 * Math.cos(skeleton.hipRotationR + skeleton.ankleAngleR) * facing;
  const ankleRy = kneeRy + legL;
  joints.ankleR = { x: ankleRx, y: ankleRy };

  joints.footR = { x: ankleRx, y: ankleRy + footH * 0.5 };

  // 左脚（4点構造）
  const hipLx = basePx - skeleton.stanceWidth * s * 0.5 + skeleton.leadFootPlant * 0.1 * s * facing;
  const hipLy = joints.pelvis.y + 0.01 * s;
  joints.hipL = { x: hipLx, y: hipLy };

  const kneeLx = hipLx - legU * 0.3 * Math.cos(skeleton.hipRotationL) * facing;
  const kneeLy = hipLy + legU;
  joints.kneeL = { x: kneeLx, y: kneeLy };

  const ankleLx = kneeLx - legL * 0.3 * Math.cos(skeleton.hipRotationL + skeleton.ankleAngleL) * facing;
  const ankleLy = kneeLy + legL;
  joints.ankleL = { x: ankleLx, y: ankleLy };

  joints.footL = { x: ankleLx, y: ankleLy + footH * 0.5 };

  return joints;
}

/* ========================================================
 * 描画ヘルパー
 * ======================================================== */

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

function drawCircle(x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawFilledLimb(fromX, fromY, toX, toY, width, color) {
  ctx.fillStyle = color;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return;
  const angle = Math.atan2(dy, dx);
  ctx.save();
  ctx.translate(fromX, fromY);
  ctx.rotate(angle);
  roundRect(ctx, 0, -width / 2, len, width, width / 2);
  ctx.fill();
  ctx.restore();
}

/* ========================================================
 * 部位描画関数群
 * ======================================================== */

function drawShadow(basePx, basePy, s, skeleton) {
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(basePx, basePy + 0.02 * s, 0.35 * s, 0.1 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTorso(joints, skeleton, s, facing, skinColor) {
  // 逆台形の胴体（肩幅 > 腰幅）
  const shoulderW = 0.18 * s;
  const hipW = 0.14 * s;

  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.moveTo(joints.pelvis.x - hipW * facing, joints.pelvis.y);
  ctx.lineTo(joints.pelvis.x + hipW * facing, joints.pelvis.y);
  ctx.lineTo(joints.chest.x + shoulderW * facing, joints.chest.y - 0.05 * s);
  ctx.lineTo(joints.chest.x - shoulderW * facing, joints.chest.y - 0.05 * s);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawHead(joints, skeleton, s, facing, skinColor) {
  const headR = 0.09 * s;
  drawCircle(joints.head.x, joints.head.y, headR, skinColor);

  // 髪
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.arc(joints.head.x, joints.head.y - headR * 0.3, headR * 0.95, 0, Math.PI, true);
  ctx.fill();

  // 目
  ctx.fillStyle = "rgba(0,0,0,0.8)";
  const eyeY = joints.head.y - headR * 0.2;
  drawCircle(joints.head.x - headR * 0.25 * facing, eyeY, headR * 0.12, "rgba(0,0,0,0.8)");
  drawCircle(joints.head.x + headR * 0.25 * facing, eyeY, headR * 0.12, "rgba(0,0,0,0.8)");
}

function drawArm(joints, skeleton, s, facing, skinColor, side) {
  const isRight = side === "R";
  const shoulder = isRight ? joints.shoulderR : joints.shoulderL;
  const elbow = isRight ? joints.elbowR : joints.elbowL;
  const wrist = isRight ? joints.wristR : joints.wristL;
  const hand = isRight ? joints.handR : joints.handL;

  // 上腕
  drawFilledLimb(shoulder.x, shoulder.y, elbow.x, elbow.y, 0.05 * s, skinColor);

  // 前腕
  drawFilledLimb(elbow.x, elbow.y, wrist.x, wrist.y, 0.04 * s, skinColor);

  // 手
  drawCircle(hand.x, hand.y, 0.035 * s, skinColor);
}

function drawLeg(joints, skeleton, s, facing, skinColor, side) {
  const isRight = side === "R";
  const hip = isRight ? joints.hipR : joints.hipL;
  const knee = isRight ? joints.kneeR : joints.kneeL;
  const ankle = isRight ? joints.ankleR : joints.ankleL;
  const foot = isRight ? joints.footR : joints.footL;

  // 大腿
  drawFilledLimb(hip.x, hip.y, knee.x, knee.y, 0.055 * s, "rgba(100,60,40,0.9)");

  // 下腿
  drawFilledLimb(knee.x, knee.y, ankle.x, ankle.y, 0.05 * s, "rgba(100,60,40,0.9)");

  // 足
  ctx.fillStyle = "rgba(80,40,20,0.9)";
  ctx.beginPath();
  ctx.ellipse(foot.x, foot.y, 0.045 * s, 0.035 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawRacket(joints, skeleton, s, facing, racketColor) {
  const hand = joints.wristR; // 右手で持つと仮定（左利きは別途）
  const racket = joints.racketR;

  // ラケットハンドル
  drawFilledLimb(hand.x, hand.y, racket.x, racket.y, 0.025 * s, "#8B4513");

  // ラケット面
  const frameW = 0.08 * s;
  const frameH = 0.12 * s;
  const angle = Math.atan2(racket.y - hand.y, racket.x - hand.x);

  ctx.save();
  ctx.translate(racket.x, racket.y);
  ctx.rotate(angle);

  // フレーム
  ctx.strokeStyle = racketColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, frameW, frameH, 0, 0, Math.PI * 2);
  ctx.stroke();

  // ガット
  ctx.strokeStyle = "rgba(200,200,200,0.6)";
  ctx.lineWidth = 0.5;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(frameW * (i / 3.5), -frameH);
    ctx.lineTo(frameW * (i / 3.5), frameH);
    ctx.stroke();
  }

  ctx.restore();
}

/* ========================================================
 * メイン描画関数（エクスポート）
 * ======================================================== */

export function drawHumanoid(pl) {
  const g = project(pl.x, pl.y, 0);
  const s = g.s;

  ctx.save();
  ctx.translate(g.x, g.y);

  // 体をボールの方へ向ける（yaw回転）
  const bodyYaw = pl.pose !== "swing" ? bodyYawToBall(pl) : 0;
  if (bodyYaw) ctx.transform(Math.cos(bodyYaw), 0, 0, 1, 0, 0);

  // facing（正面=1, 背面=-1）
  const facing = pl.facing === "backward" ? -1 : 1;

  // スケルトンポーズ計算
  const skeleton = calcSkeletonPose(pl, pl.swingK || 0);

  // 関節座標計算
  const joints = calcSkeletonWorldPos(skeleton, 0, 0, facing, s);

  // 描画順序（z-order制御）
  drawShadow(0, 0, s, skeleton);

  // 脚（背面時も手前）
  drawLeg(joints, skeleton, s, facing, "rgba(100,60,40,0.9)", "L");
  drawLeg(joints, skeleton, s, facing, "rgba(100,60,40,0.9)", "R");

  // 胴体
  drawTorso(joints, skeleton, s, facing, pl.color || "#E8B4A8");

  // 頭
  drawHead(joints, skeleton, s, facing, pl.color || "#E8B4A8");

  // 腕（背面時の奥行き判定）
  const isBackface = facing < 0;
  if (isBackface && skeleton.foreWrap > 0.5) {
    // フォロースルー時は腕が後ろ
    drawArm(joints, skeleton, s, facing, pl.color || "#E8B4A8", "R");
    drawArm(joints, skeleton, s, facing, pl.color || "#E8B4A8", "L");
    drawRacket(joints, skeleton, s, facing, pl.skin || "#FF6B6B");
  } else {
    // 通常は腕が前
    drawArm(joints, skeleton, s, facing, pl.color || "#E8B4A8", "L");
    drawArm(joints, skeleton, s, facing, pl.color || "#E8B4A8", "R");
    drawRacket(joints, skeleton, s, facing, pl.skin || "#FF6B6B");
  }

  // プレイヤーラベル
  if (pl.label) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "600 " + Math.max(8, 0.28 * s) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(pl.label, 0, -0.4 * s);
  }

  // 操作可能表示（controlledプレイヤー）
  if (pl === rallyControlled && pl.pose === "ready") {
    const isBack = pl.swingSide === "back";
    const text = isBack ? "バック" : "フォア";
    const color = isBack ? "#F59E0B" : "#3B82F6";
    const bw = 0.95 * s;
    const by = -0.62 * s;
    ctx.fillStyle = color;
    roundRect(ctx, -bw / 2, by, bw, 0.36 * s, 0.1 * s);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 " + Math.max(8, 0.24 * s) + "px sans-serif";
    ctx.fillText(text, 0, by + 0.26 * s);
  }

  // 打撃可能表示
  if (pl === rallyControlled && state === "rally" && canPlayerHit(pl)) {
    const pulse = 1 + 0.08 * Math.sin(performance.now() / 70);
    ctx.strokeStyle = "rgba(99,102,241,0.9)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.75 * s * pulse, 0.3 * s * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
