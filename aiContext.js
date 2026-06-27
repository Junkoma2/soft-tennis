import { TUNING } from "./config.js";
import {
  ball, formation, front, back, cpuFront, cpuBack,
  pointJustServedByFront, cpuJustServedByFront,
} from "./state.js";
import { predictLanding } from "./main.js";
import { opponentHitterPos, ownBackPlayer } from "./aiPositioning.js";

/* ===========================================================
 * AI 思考の共通コンテキスト
 *
 *   buildCtx()          : moveAutoAI が毎フレーム作る共通情報の束（ctx）。
 *                         decideTask / executeTask 等へ ctx 1つで渡し、引数を減らす。
 *   getCpuStyle()       : 役割(front/back)の個性パラメータ（formation補正込み）。
 *   evaluateSituation() : 着地予測・球速/高さ・展開からチャンス/危険/ロブを評価。
 * ロジックの分岐は formation/役割で増やさず、これらの値で「らしさ」を表現する。
 * =========================================================== */

// p（移動させる選手）と side から、フェーズ処理・タスク決定が共通で使う情報を作る。
//   ctx = { side, myTeam, opponentTeam, homeSign, homeBackY, myFront, myBack, speed,
//           myJustServedByFront, situation, style, role, dash }
// situation/style/role/dash はラリーフェーズで充填する（serve/receiveでは未使用）。
export function buildCtx(side, p) {
  const myFront = side === "player" ? front : cpuFront;
  const myBack  = side === "player" ? back  : cpuBack;
  const homeSign = side === "player" ? 1 : -1;
  return {
    side,
    myTeam: side,
    opponentTeam: side === "player" ? "cpu" : "player",
    homeSign,
    homeBackY: TUNING.pos.backY * homeSign,
    myFront,
    myBack,
    speed: TUNING.move.aiSpeed * p.stats.speed,
    myJustServedByFront: side === "player" ? pointJustServedByFront : cpuJustServedByFront,
    situation: null,
    style: null,
    role: null,
    dash: 1.0,
  };
}

// role（"front"/"back"）の個性パラメータをformation補正込みで返す。
// 固定の前衛/後衛ではなく「いまそのポジションを担当している側」を渡す。
export function getCpuStyle(role) {
  const base = TUNING.cpuStyle[role];
  const bias = (TUNING.formationBias[formation] && TUNING.formationBias[formation][role]) || {};
  return {
    baseDepth: base.baseDepth + (bias.baseDepthAdd || 0),
    netBias: Math.max(0, Math.min(1, base.netBias + (bias.netBiasAdd || 0))),
    aggression: base.aggression,
    riskTolerance: base.riskTolerance,
    poachBias: base.poachBias,
    lobFear: base.lobFear,
    recoveryBias: base.recoveryBias,
    reaction: base.reaction,
  };
}

// 状況評価: 着地予測・球の高さ/速さ・相手打点から、チャンス/危険/ロブかどうかを判定する。
// side からみた評価（自チームの守備視点）。
export function evaluateSituation(side) {
  const opponentTeam = side === "player" ? "cpu" : "player";
  const op = opponentHitterPos(side);
  const incoming = ball.lastHitter === opponentTeam;
  const landing = incoming ? predictLanding() : null;
  const isLob = ball.spin === "flat" && ball.z > 2.0;
  const ballSpeed = Math.hypot(ball.vx, ball.vy);
  // チャンス度: 浅い・遅い・高い球ほど高い（叩ける/詰められる）
  let chanceLevel = 0;
  if (landing) {
    const depth = Math.abs(landing.y);
    const shallow = Math.max(0, Math.min(1, (9.0 - depth) / 6.0));
    const slow = Math.max(0, Math.min(1, (22.0 - ballSpeed) / 14.0));
    chanceLevel = Math.max(0, Math.min(1, shallow * 0.6 + slow * 0.4));
  }
  // 危険度: 速い・深い・コースが厳しい（サイド際）ほど高い
  let dangerLevel = 0;
  if (landing) {
    const deep = Math.max(0, Math.min(1, (Math.abs(landing.y) - 6.0) / 6.0));
    const fast = Math.max(0, Math.min(1, (ballSpeed - 18.0) / 14.0));
    dangerLevel = Math.max(0, Math.min(1, deep * 0.5 + fast * 0.5));
  }
  // rallyLane: 自陣後衛と相手後衛の位置関係から cross/straight/middle を判定
  const ownBackP = ownBackPlayer(side);
  let rallyLane = "middle";
  if (Math.abs(ownBackP.x) > TUNING.pos.devHysteresis || Math.abs(op.x) > TUNING.pos.devHysteresis) {
    const ownSign = ownBackP.x >= 0 ? 1 : -1;
    const opSign = op.x >= 0 ? 1 : -1;
    rallyLane = ownSign !== opSign ? "cross" : "straight";
  }
  return {
    chanceLevel, dangerLevel, isLob, rallyLane,
    landingPoint: landing,
    ballSpeed, ballHeight: ball.z,
    opponentHitPoint: op,
    incoming,
    netOpportunity: chanceLevel > 0.55 && ball.bounces === 0,
  };
}
