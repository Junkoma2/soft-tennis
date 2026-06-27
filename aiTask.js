import { TUNING, COURT, G } from "./config.js";
import {
  state, ball, front,
  spectatorMode, rallyControlled, partnerAggressiveness,
  cpuFrontPlan, playerFrontPlan,
} from "./state.js";
import {
  predictLanding, predictStrokeContact, predictHighContact, insideCourt, isBackhandFor,
} from "./main.js";
import { moveToward, backDevX, frontDevX, recoverDepthY } from "./aiPositioning.js";

/* ===========================================================
 * ③④⑤ タスク決定と実行
 *
 * 戻り値は統一形式 { kind, x, y, speedMul } に寄せる:
 *   kind  : "hit" | "cover" | "poach" | "advance" | "recover" | "hold"
 *   x, y  : 移動目標（コート座標）
 *   speedMul : 目標速さの倍率
 * executeTask は task の実行（moveToward）だけを担当し、判断ロジックを持たない。
 * 前寄り/後ろ寄りの分岐は front/back という固定クラスではなく、positionBias で
 * 導出した p === ctx.netPlayer / p === ctx.basePlayer で判定する（中立化）。
 * getCpuStyle 用の補助ラベルだけ ctx.role に保持する。
 * =========================================================== */

// p のタスクを決める入口。来球の有無で recover / hit / support に振り分ける。
export function decideTask(p, ctx) {
  const { netPlayer, basePlayer, opponentTeam, situation } = ctx;
  // 自分側がラリー中に打つ番（相手が打った球が来ている）かどうか
  const receivingFromOpponent = state === "rally" && ball.lastHitter === opponentTeam && !ball.serving;

  if (!receivingFromOpponent) {
    // 自陣にボールがある間（自分たちが打った後）は展開に応じた定位置へ戻る = recover
    return decideRecoverTask(p, ctx);
  }

  // 来球がある: 誰が打つか判断する
  const hitter = judgeWhoShouldHit(netPlayer, basePlayer, ctx.side, situation);
  if (p === hitter) {
    return decideHitApproachTask(p, ctx);
  }
  // 自分が打ち手でない: cover / poach / advance / hold のいずれか
  return decideSupportTask(p, ctx);
}

// ⑤ タスク実行: decideTask が決めた目標位置(x,y)へ移動する。
export function executeTask(p, ctx, task, dt) {
  p.aiTaskKind = task.kind; // デバッグ表示用に現在のタスク種別を保持
  moveToward(p, task.x, task.y, ctx.speed * task.speedMul * dt, dt);
}

// ボールの予測打点(x,y,残り時間)を返す。バウンド前/後で予測方法を変えるが、
// 役割（前衛/後衛）には依存しない「ボールが実際にどこへ来るか」だけの予測。
function estimateContactPoint(homeSign) {
  const strokeContact = predictStrokeContact();
  if (ball.bounces >= 1) {
    const cx = strokeContact ? strokeContact.x : ball.x + ball.vx * 0.2;
    const cy = strokeContact ? strokeContact.y : ball.y + ball.vy * 0.2;
    return { x: cx, y: cy, t: strokeContact ? strokeContact.t : 0.25, bounced: true };
  }
  const landing = predictLanding();
  if (landing && landing.y * homeSign > 0 && insideCourt(landing.x, landing.y)) {
    const hc = predictHighContact();
    const contact = strokeContact || hc;
    const hx = contact ? contact.x : landing.x;
    const hy = contact ? contact.y : landing.y + 0.6 * (landing.y >= 0 ? 1 : -1);
    const t = contact ? contact.t : landing.t + (hc ? Math.sqrt(2 * Math.max(0, hc.apexZ) / G) : 0.15);
    return { x: hx, y: hy, t, bounced: false };
  }
  return null;
}

// 指定の打点へ、残り時間内に横移動で間に合うか（速さ・リーチを概算で考慮）。
function canReachHitPoint(p, contactX, contactY, timeToContact, speedMul) {
  const sp = TUNING.move.aiSpeed * (p.stats ? p.stats.speed : 1) * speedMul;
  const dist = Math.hypot(contactX - p.x, contactY - p.y);
  if (timeToContact == null || timeToContact <= 0) return dist <= sp * 0.35;
  return dist <= sp * timeToContact;
}

// 前衛/後衛それぞれが「現実的にこの球を取りに行くべきか」のスコア。
// 高いほど打ち手としてふさわしい。届かない場合は -Infinity。
function shouldTakeBall(role, p, contactX, contactY, timeToContact, situation) {
  const speedMul = role === "front" ? 1.25 : 1.2;
  if (!canReachHitPoint(p, contactX, contactY, timeToContact, speedMul)) return -Infinity;
  const dist = Math.hypot(contactX - p.x, contactY - p.y);
  let score = -dist;
  if (role === "front") {
    if (ball.bounces >= 1) {
      const netDepth = Math.abs(p.y); // ネットからの距離。浅いほどネット際。
      if (netDepth < 2.2) score -= 6.0;       // ネット際からの深追いは強く避ける
      else if (netDepth < 4.0) score -= 2.0;  // 中間位置は中程度のペナルティ（陣形は崩れにくい）
      // 深い位置（ダブル後衛気味/下がり気味）にいるならペナルティなし＝後衛と同等に競う
    }
    // ロブで頭上を抜かれた後など、前衛が下がって処理するのが自然な場面はボーナス
    if (situation.isLob) score += 1.2;
  } else if (ball.bounces >= 1 && Math.abs(p.y) < 3.0) {
    // 後衛が既に大きく前へ出ているときは、深い球を取りに戻るより
    // 前衛に譲る方が自然な場合があるため軽くペナルティ
    score -= 1.0;
  }
  return score;
}

// 誰が打つべきかの判断: 「誰が現実的に到達できて、打つべきか」をスコアで比較する。
// netPlayer(前寄り)は前衛的、basePlayer(後ろ寄り)は後衛的なスコア基準で評価する。
function judgeWhoShouldHit(netPlayer, basePlayer, side, situation) {
  const homeSign = side === "player" ? 1 : -1;
  const contact = estimateContactPoint(homeSign);
  const cx = contact ? contact.x : ball.x;
  const cy = contact ? contact.y : ball.y;
  const t = contact ? contact.t : null;

  const scoreFront = shouldTakeBall("front", netPlayer, cx, cy, t, situation);
  const scoreBack  = shouldTakeBall("back",  basePlayer, cx, cy, t, situation);

  if (scoreFront === -Infinity && scoreBack === -Infinity) {
    // どちらも理論上は届かない: 無理にでも近い方が追う
    const dFront = Math.hypot(cx - netPlayer.x, cy - netPlayer.y);
    const dBack  = Math.hypot(cx - basePlayer.x,  cy - basePlayer.y);
    return dFront <= dBack ? netPlayer : basePlayer;
  }
  return scoreFront >= scoreBack ? netPlayer : basePlayer;
}

// フォア回り込み判定: 後衛の移動目標x（打点予測位置）が利き手と逆側（バック）に
// なりそうなとき、フォアで打てる位置へ積極的に回り込む。来球1球分はラッチ
// （wrapCommitted/wrapTargetX）して立ち位置とフォア/バックを固定し、プルプルを防ぐ。
function foreApproachX(bp, side, ballContactX, approachSpeed, timeToContact) {
  const facingDir = side === "player" ? 1 : -1;
  const handSign = bp.stats && bp.stats.handed === "left" ? -1 : 1;
  const foreDir = facingDir * handSign;

  // 来球1球分はラッチ: 立ち位置とフォア/バックを固定し、毎フレームの再評価による
  // 往復（プルプル）や表示反転（フォアなのにバック）を防ぐ。ただし予測が大きく
  // ズレたら（バウンドのブレ等）解除して立て直す。
  if (bp.wrapCommitted) {
    if (Math.abs(ballContactX - bp.wrapBallX) <= 1.2) return bp.wrapTargetX;
    bp.wrapCommitted = false;
  }

  // 「基本フォアで回り込む」: ボールをフォア側（利き手側）の適正打点で迎えられる立ち位置を第一候補にする。
  const foreLateral = (TUNING.contact && TUNING.contact.idealLateralFore) || 0.85;
  const foreStandX = ballContactX - foreDir * foreLateral;

  let standX, hitSide;
  if (timeToContact != null && timeToContact > 0) {
    const timeNeeded = Math.abs(foreStandX - bp.x) / Math.max(0.1, approachSpeed);
    if (timeNeeded <= timeToContact * 0.9) {
      standX = foreStandX; hitSide = "fore"; // 間に合う→フォアに回り込む
    } else {
      standX = ballContactX; hitSide = "back"; // 間に合わない→正面で迎えてバック
    }
  } else {
    // 残り時間が読めない（バウンド後など）: すでにフォア側ならフォア、そうでなければバック。
    if (isBackhandFor(side, bp, ballContactX)) { standX = ballContactX; hitSide = "back"; }
    else { standX = foreStandX; hitSide = "fore"; }
  }

  bp.wrapCommitted = true;
  bp.wrapTargetX = standX;
  bp.wrapBallX = ballContactX;
  bp.hitSide = hitSide;
  return standX;
}

// 打ち手側の「打つための立ち位置」タスク。前衛/後衛で打点目標の作り方を分ける。
function decideHitApproachTask(p, ctx) {
  const { netPlayer, basePlayer, myTeam, homeSign, speed, situation } = ctx;

  if (p === netPlayer) {
    if (ball.bounces === 0) {
      // front-volley: ネット際の自分の高さ(y)を球が横切るxへ詰める
      const t = Math.abs(ball.vy) > 0.1 ? (p.y - ball.y) / ball.vy : -1;
      const predX = (t > 0 && t < 1.2) ? ball.x + ball.vx * t : ball.x;
      const tx = Math.max(-3.4, Math.min(3.4, predX));
      return { kind: "hit", x: tx, y: p.y, speedMul: 1.25 };
    }
    // front-stroke: 深い打点へ無理に押し込めず、実際の予測打点へ素直に向かう。
    const contact = estimateContactPoint(homeSign);
    const tx = Math.max(-COURT.halfW, Math.min(COURT.halfW, contact ? contact.x : p.x));
    const ty = Math.max(-(COURT.halfL + 1.0), Math.min(COURT.halfL + 1.0, contact ? contact.y : p.y));
    return { kind: "hit", x: tx, y: ty, speedMul: 1.25 };
  }

  // back-stroke / back-lob-cover
  const landing = situation.landingPoint;
  const strokeContact = predictStrokeContact();
  let tx = backDevX(myTeam);
  let ty = homeSign > 0 ? TUNING.pos.backY : -TUNING.pos.backY;
  let timeToContact = null;

  if (ball.bounces >= 1) {
    const cx = strokeContact ? strokeContact.x : ball.x + ball.vx * 0.2;
    const cy = strokeContact ? strokeContact.y : ball.y + ball.vy * 0.2;
    tx = cx;
    ty = homeSign > 0
      ? Math.min(COURT.halfL + 5.0, Math.max(4.5, cy))
      : Math.max(-(COURT.halfL + 5.0), Math.min(-4.5, cy));
    timeToContact = strokeContact ? strokeContact.t : 0.25;
  } else if (landing && landing.y * homeSign > 0 && insideCourt(landing.x, landing.y)) {
    const isLob = situation.isLob && Math.abs(landing.y) > COURT.serviceY;
    const hc = predictHighContact();
    const contact = strokeContact || hc;
    let depth = contact ? Math.abs(contact.y) : Math.abs(landing.y) + 0.6;
    depth = Math.min(COURT.halfL + 5.0, Math.max(Math.abs(landing.y), depth));
    const hx = contact ? contact.x : landing.x;
    const xCap = isLob ? COURT.singlesHalfW + 0.3 : COURT.halfW;
    tx = Math.max(-xCap, Math.min(xCap, hx));
    ty = homeSign > 0 ? depth : -depth;
    timeToContact = contact ? contact.t : landing.t + (hc ? Math.sqrt(2 * Math.max(0, hc.apexZ) / G) : 0.15);
  }

  // フォア回り込み判定（前寄りは上で早期returnしているため、ここは常に後ろ寄り選手）。
  tx = foreApproachX(basePlayer, myTeam, tx, speed * 1.2, timeToContact);
  basePlayer.swingSide = basePlayer.hitSide;
  basePlayer.swingSideLocked = true;
  return { kind: "hit", x: tx, y: ty, speedMul: 1.2 };
}

// 打ち手でない側のタスク: cover / poach / advance / hold を状況とCPU性格から選ぶ。
function decideSupportTask(p, ctx) {
  const { netPlayer, basePlayer, side, myTeam, situation, style, dash } = ctx;

  if (p === netPlayer) {
    // ポーチ判断: チャンス大・危険小・ポーチ好き(bias小)ほど踏み込む。
    const myPlan = (side === "cpu") ? cpuFrontPlan : (spectatorMode ? playerFrontPlan : "base");
    const planWantsPoach = myPlan === "poach";
    const aggr = (side === "player" && !spectatorMode && p === front && rallyControlled !== front)
      ? partnerAggressiveness : style.poachBias;
    const poachDesire = (planWantsPoach ? 0.4 : 0) + aggr * style.aggression +
      situation.chanceLevel * 0.5 - situation.dangerLevel * 0.4 - situation.isLob * style.lobFear * 0.5;

    let frontTargetX = Math.max(-3.0, Math.min(3.0, frontDevX(myTeam)));
    let frontTy = recoverDepthY(myTeam, netPlayer);
    let frontDash = dash;
    let kind = "cover";

    if (poachDesire > 0.15) {
      const t2 = Math.abs(ball.vy) > 0.1 ? (netPlayer.homeY - ball.y) / ball.vy : -1;
      const predX = (t2 > 0) ? ball.x + ball.vx * t2 : ball.x;
      const poachReach = TUNING.ai.poachReach * netPlayer.stats.reach;
      const ownBackSign = basePlayer.x >= 0 ? 1 : -1;
      const frontSide = -ownBackSign;
      const towardMySide = predX * frontSide >= -0.4;
      const lateralPace = Math.abs(ball.vx) + Math.abs(ball.vy) * 0.3;
      const catchable = lateralPace <= TUNING.ai.poachMaxPace;
      if (towardMySide && catchable && Math.abs(predX - netPlayer.x) <= poachReach * 1.5) {
        frontTargetX = Math.max(-3.4, Math.min(3.4, predX));
        frontTy = netPlayer.homeY;
        frontDash = catchable && lateralPace < TUNING.ai.poachMaxPace * 0.6 ? 1.35 : 1.15;
        kind = "poach";
      }
    }

    // ネット際を低く横切る球には、ポーチ判断と独立して「届く範囲だけ」踏み込む（advance）。
    {
      const ownBackSign = basePlayer.x >= 0 ? 1 : -1;
      const frontSide = -ownBackSign;
      const tNet = Math.abs(ball.vy) > 0.1 ? (netPlayer.homeY - ball.y) / ball.vy : -1;
      if (tNet > 0 && tNet < 0.9) {
        const crossX = ball.x + ball.vx * tNet;
        const crossZ = ball.z + ball.vz * tNet - 0.5 * G * tNet * tNet;
        const onMySide = (Math.sign(crossX) === frontSide);
        const reach = TUNING.ai.frontVolleyReach * netPlayer.stats.reach;
        if (onMySide && crossZ < 1.3 && Math.abs(crossX - netPlayer.x) <= reach * 0.9) {
          frontTargetX = Math.max(-3.4, Math.min(3.4, crossX));
          frontTy = netPlayer.homeY;
          frontDash = Math.max(frontDash, 1.15);
          kind = kind === "poach" ? kind : "advance";
        }
      }
    }
    return { kind, x: frontTargetX, y: frontTy, speedMul: frontDash };
  }

  // 後ろ寄り(basePlayer): 打ち手が前寄り選手のときのカバー位置（コース担当に戻る/締める）。
  const retSpeedMul = (side === "cpu" && !spectatorMode) ? 0.8 : dash;
  return {
    kind: "cover",
    x: Math.max(-4.4, Math.min(4.4, backDevX(myTeam))),
    y: state === "rally" ? recoverDepthY(myTeam, basePlayer) : basePlayer.homeY,
    speedMul: retSpeedMul,
  };
}

// recover: 自陣にボールがある間（自分たちが打った直後など）、定位置・コース担当へ戻るタスク。
function decideRecoverTask(p, ctx) {
  const { netPlayer, basePlayer, side, myTeam, homeBackY, dash, myJustServedByFront } = ctx;

  if (p === netPlayer) {
    if (state === "rally") {
      const tx = Math.max(-4.4, Math.min(4.4, frontDevX(myTeam)));
      const retSpeedMul = (side === "cpu" && !spectatorMode) ? 0.8 : dash;
      return { kind: "recover", x: tx, y: recoverDepthY(myTeam, netPlayer), speedMul: retSpeedMul };
    }
    return {
      kind: "recover",
      x: netPlayer.homeX * (basePlayer.x > 0 ? -1 : 1),
      y: netPlayer.homeY,
      speedMul: dash,
    };
  }

  // 後ろ寄り選手は来球対応を抜けたら、フォア回り込みのラッチ（立ち位置・打ち方の確定）を解除する。
  if (basePlayer.wrapCommitted) {
    basePlayer.wrapCommitted = false;
    basePlayer.wrapTargetX = null;
    basePlayer.wrapBallX = null;
    basePlayer.swingSideLocked = false;
  }
  if (state === "rally" && myJustServedByFront) {
    const targetX = netPlayer.x > 0 ? -1.6 : 1.6;
    return { kind: "recover", x: targetX, y: homeBackY * 1.02, speedMul: 1.0 };
  }
  const retSpeedMul = (side === "cpu" && !spectatorMode) ? 0.55 : 1.0;
  return { kind: "recover", x: backDevX(myTeam), y: recoverDepthY(myTeam, basePlayer), speedMul: retSpeedMul };
}
