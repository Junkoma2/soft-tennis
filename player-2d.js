/**
 * ソフトテニス プレイヤー 2D 描画モジュール【完全実装版】
 *
 * 骨格ベースの高精度描画・運動連鎖・ショット別アニメーション完全実装
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
 * スケルトンポーズ計算【完全実装】
 * ======================================================== */

function calcSkeletonPose(pl, swingK) {
  const isFront = pl === front || pl === cpuFront;
  const isServe = pl.pose === "serve" || pl.pose === "toss";
  const isSwinging = pl.pose === "swing";
  const isRecover = pl.pose === "recover";
  const isReady = pl.pose === "ready" || pl.pose === "idle" || pl.pose === "prep";
  const isVolley = pl.pose === "volley";

  const swingPhase = isSwinging ? calcSwingPhase(pl, swingK) : null;
  const isForehand = pl.swingSide === "fore";
  const isLeftHanded = pl.stats.handed === "left";

  // デフォルト値
  let skeleton = {
    pelvisRotation: 0,
    spineRotation: 0,
    chestRotation: 0,
    neckRotation: 0,
    torsoLean: 0,
    shoulderRotationR: 0,
    elbowBendR: 0.1,
    wristAngleR: 0,
    shoulderRotationL: 0,
    elbowBendL: 0.1,
    wristAngleL: 0,
    hipRotationR: 0,
    kneeBendR: 0.15,
    ankleAngleR: 0,
    hipRotationL: 0,
    kneeBendL: 0.15,
    ankleAngleL: 0,
    weightShift: 0,
    stanceWidth: 0.28,
    crouch: 0.15,
    leadFootPlant: 0,
    foreWrap: 0,
    shoulderWidth: 0.18,
    hipWidth: 0.14,
  };

  // === 前衛専用：常に低い構え ===
  skeleton.crouch = isFront ? 0.22 : 0.10;
  skeleton.torsoLean = isFront ? 0.28 : 0.12;
  skeleton.kneeBendR = isFront ? 0.25 : 0.15;
  skeleton.kneeBendL = isFront ? 0.25 : 0.15;

  // === READY / IDLE / PREP ===
  // ラケットは腰に下げず、胸〜顔の高さに構える（いつでもボレーできる姿勢）。
  // 利き腕でラケットヘッドを高く保ち、反対の手で軽く支える両手構え。
  if (isReady) {
    if (isFront) {
      // 前衛：常に低い構え（深い膝曲げ・前傾・低重心）
      skeleton.kneeBendR = 0.32;
      skeleton.kneeBendL = 0.32;
      skeleton.crouch = 0.30;
      skeleton.torsoLean = 0.32;
    } else {
      // 後衛：やや高めだが直立はしない
      skeleton.kneeBendR = 0.20;
      skeleton.kneeBendL = 0.20;
      skeleton.crouch = 0.16;
      skeleton.torsoLean = 0.18;
    }
    // ラケットを持つ腕：上腕を軽く前へ、肘を曲げてラケットヘッドを高く
    skeleton.shoulderRotationR = -0.28;
    skeleton.elbowBendR = 0.42;
    skeleton.wristAngleR = -0.18;
    // 支える腕：体の前で軽く添える
    skeleton.shoulderRotationL = -0.20;
    skeleton.elbowBendL = 0.40;
    skeleton.wristAngleL = -0.10;
    return skeleton;
  }

  // === VOLLEY ===
  if (isVolley) {
    const isRightArm = (isForehand && !isLeftHanded) || (!isForehand && isLeftHanded);
    skeleton.kneeBendR = 0.25;
    skeleton.kneeBendL = 0.25;
    skeleton.torsoLean = 0.30;
    skeleton.pelvisRotation = isForehand ? 0.1 : -0.1;
    skeleton.chestRotation = isForehand ? 0.15 : -0.15;

    if (isRightArm) {
      skeleton.shoulderRotationR = -0.25;
      skeleton.elbowBendR = 0.45;
      skeleton.wristAngleR = 0.15;
    } else {
      skeleton.shoulderRotationL = -0.25;
      skeleton.elbowBendL = 0.45;
      skeleton.wristAngleL = 0.15;
    }
    return skeleton;
  }

  // === SERVE ===
  if (isServe) {
    const toss = pl.pose === "toss";
    if (toss) {
      skeleton.shoulderRotationR = isLeftHanded ? 0.2 : -0.15;
      skeleton.elbowBendR = isLeftHanded ? 0.35 : 0.12;
      skeleton.shoulderRotationL = isLeftHanded ? 0.15 : 0.4;
      skeleton.wristAngleR = isLeftHanded ? 0.1 : 0;
    } else {
      skeleton.pelvisRotation = 0.35;
      skeleton.spineRotation = 0.4;
      skeleton.chestRotation = 0.6;
      skeleton.neckRotation = 0.25;
      skeleton.shoulderRotationR = isLeftHanded ? 0.2 : -0.5;
      skeleton.elbowBendR = isLeftHanded ? 0.25 : 0.55;
      skeleton.wristAngleR = isLeftHanded ? 0.2 : 0.4;
      skeleton.shoulderRotationL = isLeftHanded ? 0.1 : 0.2;
      skeleton.kneeBendR = 0.35;
      skeleton.hipRotationR = 0.2;
    }
    return skeleton;
  }

  // === SWING（フェーズベース：運動連鎖完全実装） ===
  if (isSwinging && swingPhase) {
    const { name, t } = swingPhase;
    const isRightArm = (isForehand && !isLeftHanded) || (!isForehand && isLeftHanded);

    // === 運動連鎖の遅延パラメータ ===
    const delayPelvis = 0.0;
    const delaySpine = 0.05;
    const delayChest = 0.10;
    const delayShoulder = 0.15;
    const delayElbow = 0.20;
    const delayWrist = 0.25;

    const getDelayedT = (baseT, delay) => Math.max(0, Math.min(1, (baseT - delay) / (1 - delay)));

    if (name === "TAKEBACK") {
      const tPelvis = getDelayedT(t, delayPelvis);
      const tSpine = getDelayedT(t, delaySpine);
      const tChest = getDelayedT(t, delayChest);
      const tShoulder = getDelayedT(t, delayShoulder);
      const tElbow = getDelayedT(t, delayElbow);

      skeleton.pelvisRotation = tPelvis * (isForehand ? 0.20 : -0.15);
      skeleton.spineRotation = tSpine * (isForehand ? 0.15 : -0.12);
      skeleton.chestRotation = tChest * (isForehand ? 0.30 : -0.25);
      skeleton.neckRotation = tChest * (isForehand ? 0.12 : -0.10);

      if (isRightArm) {
        skeleton.shoulderRotationR = -tShoulder * 0.45;
        skeleton.elbowBendR = 0.2 + tElbow * 0.18;
        skeleton.wristAngleR = tElbow * 0.2;
      } else {
        skeleton.shoulderRotationL = -tShoulder * 0.45;
        skeleton.elbowBendL = 0.2 + tElbow * 0.18;
        skeleton.wristAngleL = tElbow * 0.2;
      }

      skeleton.weightShift = -t * 0.20;
      skeleton.hipRotationL = -t * 0.12;
      skeleton.hipRotationR = t * 0.08;
      skeleton.kneeBendL = 0.25 - t * 0.08;
      skeleton.kneeBendR = 0.25 + t * 0.05;
    }
    else if (name === "STEP_AND_LOAD") {
      const tPelvis = getDelayedT(t, delayPelvis);
      const tSpine = getDelayedT(t, delaySpine);
      const tChest = getDelayedT(t, delayChest);
      const tShoulder = getDelayedT(t, delayShoulder);
      const tElbow = getDelayedT(t, delayElbow);

      skeleton.pelvisRotation = (isForehand ? 0.20 : -0.15) + tPelvis * (isForehand ? 0.15 : -0.12);
      skeleton.spineRotation = (isForehand ? 0.15 : -0.12) + tSpine * (isForehand ? 0.20 : -0.18);
      skeleton.chestRotation = (isForehand ? 0.30 : -0.25) + tChest * (isForehand ? 0.35 : -0.32);
      skeleton.neckRotation = (isForehand ? 0.12 : -0.10) + tChest * (isForehand ? 0.08 : -0.08);

      if (isRightArm) {
        skeleton.shoulderRotationR = -0.45 + tShoulder * 0.25;
        skeleton.elbowBendR = 0.38 + tElbow * 0.12;
        skeleton.wristAngleR = 0.2 + tElbow * 0.10;
      } else {
        skeleton.shoulderRotationL = -0.45 + tShoulder * 0.25;
        skeleton.elbowBendL = 0.38 + tElbow * 0.12;
        skeleton.wristAngleL = 0.2 + tElbow * 0.10;
      }

      skeleton.weightShift = -0.20 + t * 0.35;
      skeleton.leadFootPlant = t * 0.60;
      skeleton.hipRotationL = -0.12 + t * 0.18;
      skeleton.hipRotationR = 0.08 + t * 0.15;
      skeleton.kneeBendL = 0.17 - t * 0.05;
      skeleton.kneeBendR = 0.30 + t * 0.05;
    }
    else if (name === "IMPACT") {
      const tChest = getDelayedT(t, delayChest);
      const tShoulder = getDelayedT(t, delayShoulder);
      const tElbow = getDelayedT(t, delayElbow);

      skeleton.pelvisRotation = isForehand ? 0.35 : -0.27;
      skeleton.spineRotation = isForehand ? 0.35 : -0.30;
      skeleton.chestRotation = isForehand ? 0.65 : -0.57;
      skeleton.neckRotation = isForehand ? 0.20 : -0.18;

      if (isRightArm) {
        skeleton.shoulderRotationR = -0.20 + tShoulder * 0.05;
        skeleton.elbowBendR = 0.50 + tElbow * 0.08;
        skeleton.wristAngleR = 0.30;
      } else {
        skeleton.shoulderRotationL = -0.20 + tShoulder * 0.05;
        skeleton.elbowBendL = 0.50 + tElbow * 0.08;
        skeleton.wristAngleL = 0.30;
      }

      skeleton.weightShift = 0.15 + t * 0.10;
      skeleton.leadFootPlant = 0.60 + t * 0.30;
      skeleton.hipRotationL = 0.06;
      skeleton.hipRotationR = 0.23;
      skeleton.kneeBendL = 0.12;
      skeleton.kneeBendR = 0.35;
    }
    else if (name === "FOLLOW_THROUGH") {
      const tChest = getDelayedT(t, delayChest);
      const tShoulder = getDelayedT(t, delayShoulder);
      const tWrist = getDelayedT(t, delayWrist);

      skeleton.pelvisRotation = isForehand ? 0.35 - t * 0.05 : -0.27 + t * 0.05;
      skeleton.spineRotation = isForehand ? 0.35 - t * 0.08 : -0.30 + t * 0.08;
      skeleton.chestRotation = isForehand ? 0.65 - t * 0.15 : -0.57 + t * 0.15;
      skeleton.neckRotation = isForehand ? 0.20 : -0.18;

      if (isRightArm) {
        skeleton.shoulderRotationR = -0.15 + tShoulder * 0.35;
        skeleton.elbowBendR = 0.58 - t * 0.12;
        skeleton.wristAngleR = 0.30 - tWrist * 0.25;
        skeleton.foreWrap = t * 0.90;
      } else {
        skeleton.shoulderRotationL = -0.15 + tShoulder * 0.35;
        skeleton.elbowBendL = 0.58 - t * 0.12;
        skeleton.wristAngleL = 0.30 - tWrist * 0.25;
        skeleton.foreWrap = t * 0.90;
      }

      skeleton.weightShift = 0.25;
      skeleton.leadFootPlant = 0.90;
      skeleton.hipRotationL = 0.06 - t * 0.03;
      skeleton.hipRotationR = 0.23 - t * 0.05;
    }
    else if (name === "RECOVERY") {
      skeleton.pelvisRotation *= (1 - t);
      skeleton.spineRotation *= (1 - t);
      skeleton.chestRotation *= (1 - t);
      skeleton.neckRotation *= (1 - t);

      if (isRightArm) {
        skeleton.shoulderRotationR = 0.20 * (1 - t);
        skeleton.elbowBendR = 0.46 * (1 - t) + 0.15 * t;
        skeleton.foreWrap = 0.90 * (1 - t);
      } else {
        skeleton.shoulderRotationL = 0.20 * (1 - t);
        skeleton.elbowBendL = 0.46 * (1 - t) + 0.15 * t;
        skeleton.foreWrap = 0.90 * (1 - t);
      }

      skeleton.weightShift = 0.25 * (1 - t);
      skeleton.leadFootPlant = 0.90 * (1 - t);
      skeleton.hipRotationL *= (1 - t);
      skeleton.hipRotationR *= (1 - t);
      skeleton.kneeBendL = 0.12 + (isFront ? 0.13 : 0.03) * t;
      skeleton.kneeBendR = 0.35 - (0.10 + (isFront ? 0.00 : -0.05)) * t;
    }
  }

  // === RECOVER ===
  if (isRecover) {
    skeleton.pelvisRotation = 0;
    skeleton.spineRotation = 0;
    skeleton.chestRotation = 0;
    skeleton.shoulderRotationR = isForehand ? -0.15 : 0;
    skeleton.shoulderRotationL = isForehand ? 0 : -0.15;
    skeleton.elbowBendR = isForehand ? 0.20 : 0.12;
    skeleton.elbowBendL = isForehand ? 0.12 : 0.20;
    skeleton.weightShift = 0;
    skeleton.leadFootPlant = 0;
    skeleton.kneeBendR = isFront ? 0.25 : 0.15;
    skeleton.kneeBendL = isFront ? 0.25 : 0.15;
  }

  return skeleton;
}

/* ========================================================
 * 関節ワールド座標計算【完全実装】
 * ======================================================== */

function calcSkeletonWorldPos(skeleton, basePx, basePy, facing, s, isLeftHanded) {
  const joints = {};

  // 寸法（スケール s に対して）
  // 人体比率：頭を大きめ・首を長め・胴体を長めにしてソフトテニス選手らしく
  const torsoH = 0.30 * s;
  const shoulderW = skeleton.shoulderWidth * s;
  const hipW = skeleton.hipWidth * s;
  const neckH = 0.072 * s;
  const headR = 0.112 * s;

  const armU = 0.16 * s;
  const armF = 0.15 * s;
  const wristH = 0.035 * s;
  const handR = 0.04 * s;

  const legU = 0.19 * s;
  const legL = 0.18 * s;
  const footW = 0.05 * s;

  // 骨盤
  joints.pelvis = {
    x: basePx + skeleton.weightShift * 0.08 * s,
    y: basePy,
  };

  // 脊椎（遅延した回転を反映）
  const spineY = joints.pelvis.y - torsoH * 0.3;
  joints.spine = {
    x: basePx + skeleton.spineRotation * 0.08 * s * facing,
    y: spineY - skeleton.crouch * 0.05 * s,
  };

  const chestY = joints.pelvis.y - torsoH * 0.75;
  joints.chest = {
    x: basePx + skeleton.chestRotation * 0.10 * s * facing,
    y: chestY - skeleton.crouch * 0.08 * s + skeleton.torsoLean * 0.03 * s,
  };

  // 頸部
  const neckY = joints.chest.y - neckH;
  joints.neck = {
    x: basePx + skeleton.neckRotation * 0.08 * s * facing,
    y: neckY,
  };

  // 頭
  joints.head = {
    x: joints.neck.x + skeleton.neckRotation * 0.06 * s * facing,
    y: neckY - headR * 1.1,
  };

  // 右腕（5点：肩→肘→手首→手→ラケット）
  const shoulderRx = joints.chest.x + shoulderW * facing;
  const shoulderRy = joints.chest.y + 0.02 * s;
  joints.shoulderR = { x: shoulderRx, y: shoulderRy };

  const shoulderAngleR = skeleton.shoulderRotationR + skeleton.chestRotation * 0.2;
  const elbowRx = shoulderRx + armU * Math.cos(shoulderAngleR * Math.PI) * facing;
  const elbowRy = shoulderRy + armU * Math.sin(shoulderAngleR * Math.PI * 0.5);
  joints.elbowR = { x: elbowRx, y: elbowRy };

  const elbowAngleR = shoulderAngleR + skeleton.elbowBendR * Math.PI * 0.8;
  const wristRx = elbowRx + armF * Math.cos(elbowAngleR * Math.PI) * facing;
  const wristRy = elbowRy + armF * Math.sin(elbowAngleR * Math.PI * 0.5);
  joints.wristR = { x: wristRx, y: wristRy };

  joints.handR = {
    x: wristRx + Math.cos(elbowAngleR * Math.PI) * 0.02 * s * facing,
    y: wristRy - wristH,
  };

  const racketAngleR = elbowAngleR + skeleton.wristAngleR * Math.PI * 0.8 + skeleton.foreWrap * Math.PI * 0.4;
  joints.racketR = {
    x: wristRx + Math.cos(racketAngleR * Math.PI) * 0.12 * s * facing,
    y: wristRy - Math.sin(racketAngleR * Math.PI * 0.8) * 0.16 * s,
  };

  // 左腕（5点）
  const shoulderLx = joints.chest.x - shoulderW * facing;
  const shoulderLy = joints.chest.y + 0.02 * s;
  joints.shoulderL = { x: shoulderLx, y: shoulderLy };

  const shoulderAngleL = skeleton.shoulderRotationL + skeleton.chestRotation * 0.2;
  const elbowLx = shoulderLx - armU * Math.cos(shoulderAngleL * Math.PI) * facing;
  const elbowLy = shoulderLy + armU * Math.sin(shoulderAngleL * Math.PI * 0.5);
  joints.elbowL = { x: elbowLx, y: elbowLy };

  const elbowAngleL = shoulderAngleL + skeleton.elbowBendL * Math.PI * 0.8;
  const wristLx = elbowLx - armF * Math.cos(elbowAngleL * Math.PI) * facing;
  const wristLy = elbowLy + armF * Math.sin(elbowAngleL * Math.PI * 0.5);
  joints.wristL = { x: wristLx, y: wristLy };

  joints.handL = {
    x: wristLx - Math.cos(elbowAngleL * Math.PI) * 0.02 * s * facing,
    y: wristLy - wristH,
  };

  // 右脚（4点：股→膝→足首→足）
  const hipRx = joints.pelvis.x + hipW * facing + skeleton.leadFootPlant * 0.12 * s * facing;
  const hipRy = joints.pelvis.y + 0.02 * s;
  joints.hipR = { x: hipRx, y: hipRy };

  const kneeRx = hipRx + legU * 0.35 * Math.sin(skeleton.hipRotationR * Math.PI) * facing;
  const kneeRy = hipRy + legU * (1 - skeleton.kneeBendR * 0.3);
  joints.kneeR = { x: kneeRx, y: kneeRy };

  const ankleRx = kneeRx + legL * 0.35 * Math.sin(skeleton.hipRotationR * Math.PI * 0.6) * facing;
  const ankleRy = kneeRy + legL * (1 - skeleton.kneeBendR * 0.2);
  joints.ankleR = { x: ankleRx, y: ankleRy };

  joints.footR = { x: ankleRx, y: ankleRy + footW };

  // 左脚（4点）
  const hipLx = joints.pelvis.x - hipW * facing + skeleton.leadFootPlant * 0.12 * s * facing;
  const hipLy = joints.pelvis.y + 0.02 * s;
  joints.hipL = { x: hipLx, y: hipLy };

  const kneeLx = hipLx - legU * 0.35 * Math.sin(skeleton.hipRotationL * Math.PI) * facing;
  const kneeLy = hipLy + legU * (1 - skeleton.kneeBendL * 0.3);
  joints.kneeL = { x: kneeLx, y: kneeLy };

  const ankleLx = kneeLx - legL * 0.35 * Math.sin(skeleton.hipRotationL * Math.PI * 0.6) * facing;
  const ankleLy = kneeLy + legL * (1 - skeleton.kneeBendL * 0.2);
  joints.ankleL = { x: ankleLx, y: ankleLy };

  joints.footL = { x: ankleLx, y: ankleLy + footW };

  // 左利き対応：ラケットを反転
  if (isLeftHanded) {
    [joints.racketR, joints.racketL] = [joints.racketL, joints.racketR];
  }

  return joints;
}

/* ========================================================
 * 描画ヘルパー
 * ======================================================== */

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

function drawCircle(x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/* ========================================================
 * 部位描画関数
 * ======================================================== */

function drawShadow(basePx, basePy, s) {
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(basePx, basePy + 0.01 * s, 0.36 * s, 0.11 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTorso(joints, skeleton, s, skinColor) {
  const shoulderW = skeleton.shoulderWidth * s;
  const hipW = skeleton.hipWidth * s;

  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.moveTo(joints.pelvis.x - hipW, joints.pelvis.y);
  ctx.lineTo(joints.pelvis.x + hipW, joints.pelvis.y);
  ctx.lineTo(joints.chest.x + shoulderW, joints.chest.y - 0.04 * s);
  ctx.lineTo(joints.chest.x - shoulderW, joints.chest.y - 0.04 * s);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawHead(joints, skeleton, s, skinColor) {
  const headR = 0.112 * s;
  drawCircle(joints.head.x, joints.head.y, headR, skinColor);

  // 髪
  ctx.fillStyle = "rgba(40,30,20,0.8)";
  ctx.beginPath();
  ctx.arc(joints.head.x, joints.head.y - headR * 0.25, headR * 0.92, 0, Math.PI, true);
  ctx.fill();

  // 目
  const eyeY = joints.head.y - headR * 0.15;
  const eyeDx = headR * 0.3;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.beginPath();
  ctx.arc(joints.head.x - eyeDx, eyeY, headR * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(joints.head.x + eyeDx, eyeY, headR * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

function drawArm(joints, skeleton, s, skinColor, side) {
  const isRight = side === "R";
  const shoulder = isRight ? joints.shoulderR : joints.shoulderL;
  const elbow = isRight ? joints.elbowR : joints.elbowL;
  const wrist = isRight ? joints.wristR : joints.wristL;
  const hand = isRight ? joints.handR : joints.handL;

  // 上腕（筋肉質に太め）
  drawFilledLimb(shoulder.x, shoulder.y, elbow.x, elbow.y, 0.066 * s, skinColor);

  // 前腕
  drawFilledLimb(elbow.x, elbow.y, wrist.x, wrist.y, 0.055 * s, skinColor);

  // 手
  drawCircle(hand.x, hand.y, 0.044 * s, skinColor);
}

function drawLeg(joints, skeleton, s, skinColor, side) {
  const isRight = side === "R";
  const hip = isRight ? joints.hipR : joints.hipL;
  const knee = isRight ? joints.kneeR : joints.kneeL;
  const ankle = isRight ? joints.ankleR : joints.ankleL;
  const foot = isRight ? joints.footR : joints.footL;

  // 大腿（筋肉質に太め）
  drawFilledLimb(hip.x, hip.y, knee.x, knee.y, 0.074 * s, "rgba(100,60,40,0.88)");

  // 下腿
  drawFilledLimb(knee.x, knee.y, ankle.x, ankle.y, 0.064 * s, "rgba(85,50,30,0.88)");

  // 足
  ctx.fillStyle = "rgba(70,35,15,0.9)";
  const footL = 0.05 * s;
  const footH = 0.035 * s;
  ctx.beginPath();
  ctx.ellipse(foot.x, foot.y, footL, footH, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawRacket(joints, skeleton, s, racketColor, isLeftHanded) {
  const hand = isLeftHanded ? joints.handL : joints.handR;
  const racket = isLeftHanded ? joints.racketL : joints.racketR;

  // ハンドル（グリップは長め）
  const angle = Math.atan2(racket.y - hand.y, racket.x - hand.x);
  const frameW = 0.092 * s;
  const frameH = 0.137 * s;
  // ラケット面の中心を手からさらに先へ（グリップを長く見せる）
  const faceCx = racket.x + Math.cos(angle) * frameH * 0.7;
  const faceCy = racket.y + Math.sin(angle) * frameH * 0.7;
  drawFilledLimb(hand.x, hand.y, faceCx, faceCy, 0.026 * s, "#8B5A3C");

  ctx.save();
  ctx.translate(faceCx, faceCy);
  ctx.rotate(angle);

  // フレーム（細めでデカラケ感を避ける）
  ctx.strokeStyle = racketColor;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, frameW, frameH, 0, 0, Math.PI * 2);
  ctx.stroke();

  // ガット（仕上げ）
  ctx.strokeStyle = "rgba(200,200,200,0.5)";
  ctx.lineWidth = 0.6;
  for (let i = -4; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(frameW * (i / 4.5), -frameH);
    ctx.lineTo(frameW * (i / 4.5), frameH);
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

  // 体をボールへ向ける
  const bodyYaw = pl.pose !== "swing" ? bodyYawToBall(pl) : 0;
  if (bodyYaw) ctx.transform(Math.cos(bodyYaw), 0, 0, 1, 0, 0);

  const facing = pl.facing < 0 ? -1 : 1;
  const isLeftHanded = pl.stats.handed === "left";
  const skinColor = pl.skin || "#F1C7A8";
  const shirtColor = pl.color || "#6366F1";
  const racketColor = "#EAB308"; // ラケットフレーム色（共通）

  const skeleton = calcSkeletonPose(pl, pl.swingK || 0);
  const joints = calcSkeletonWorldPos(skeleton, 0, 0, facing, s, isLeftHanded);

  // === 描画順序 ===
  drawShadow(0, 0, s);

  // 脚
  drawLeg(joints, skeleton, s, skinColor, "L");
  drawLeg(joints, skeleton, s, skinColor, "R");

  // 胴体（ユニフォーム色）
  drawTorso(joints, skeleton, s, shirtColor);

  // 頭（肌色）
  drawHead(joints, skeleton, s, skinColor);

  // 腕・ラケット（z-order 制御）。腕は肌色。
  const isFollowThrough = skeleton.foreWrap > 0.4;

  if (facing < 0 && isFollowThrough) {
    // 背面フォロースルー：奥の腕を先に描画
    drawArm(joints, skeleton, s, skinColor, "R");
    drawArm(joints, skeleton, s, skinColor, "L");
    drawRacket(joints, skeleton, s, racketColor, isLeftHanded);
  } else {
    // 通常：手前の腕を先に描画
    drawArm(joints, skeleton, s, skinColor, "L");
    drawArm(joints, skeleton, s, skinColor, "R");
    drawRacket(joints, skeleton, s, racketColor, isLeftHanded);
  }

  const headTop = joints.head.y - 0.112 * s;

  // プレイヤーラベル（頭のすぐ上）
  if (pl.label) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "600 " + Math.max(8, 0.26 * s) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(pl.label, 0, headTop - 0.08 * s);
  }

  // 操作可能表示（ラベルのさらに上）
  if (pl === rallyControlled && pl.pose === "ready") {
    const isBack = pl.swingSide === "back";
    const text = isBack ? "バック" : "フォア";
    const color = isBack ? "#F59E0B" : "#3B82F6";
    const bw = 0.95 * s;
    const by = headTop - 0.5 * s;
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
