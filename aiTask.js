import { TUNING, COURT, G } from "./config.js";
import {
  state, ball, front,
  spectatorMode, rallyControlled, partnerAggressiveness,
  cpuFrontPlan, playerFrontPlan, aiDebug,
} from "./state.js";
import {
  predictLanding, predictStrokeContact, predictHighContact, isBackhandFor,
} from "./matchLoop.js";
import { moveToward, coverageGeom, idealPosition, arcApproachTarget, isNetRole } from "./aiPositioning.js";

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
// 選択打点を「得意な打点」へ寄せる重み（移動距離mに対する得意度ボーナスの換算係数）。
// 大きいほどスキル差で選択が変わりやすい。0で純粋な最短移動。
const SEL_SKILL_BONUS = 2.5;

// 候補の打点種別に対応する選手の「うまさ」（air=ボレー / rise=ライジング / descend=通常）。
function hitSkillForCand(p, kind) {
  const s = p.stats || {};
  if (kind === "air") return s.volley != null ? s.volley : 1;
  if (kind === "rise") return s.rising != null ? s.rising : 1;
  return s.stroke != null ? s.stroke : 1;
}

// 来球を「相手が打った瞬間に一度だけ」投影して、打点候補・打ち手・選択打点をラッチする。
// 以降の毎フレームはこのラッチを使う＝予測がぶれない（後衛が下がりながら打つのを防ぐ）。
// 同じ球（ball.lastHitTime 不変）の間は再計算しない。
function updateContactLatch(side, netPlayer, basePlayer, situation) {
  const d = aiDebug[side];
  const opp = side === "cpu" ? "player" : "cpu";
  const incoming = state === "rally" && ball.lastHitter === opp && !ball.serving;
  if (!incoming) {
    d.valid = false; d.hitTime = null;
    netPlayer.dbgOwner = netPlayer.dbgReach = netPlayer.dbgHitter = false;
    basePlayer.dbgOwner = basePlayer.dbgReach = basePlayer.dbgHitter = false;
    return;
  }
  if (d.valid && d.hitTime === ball.lastHitTime) return; // この球で既にラッチ済み

  const homeSign = side === "player" ? 1 : -1;
  const cands = backHitCandidates(homeSign);
  d.air = cands.find((c) => c.kind === "air") || null;
  d.rise = cands.find((c) => c.kind === "rise") || null;
  d.descend = cands.find((c) => c.kind === "descend") || null;

  // 打ち手判定の基準打点: 通常(降下)→ライジング→ノーバウンドの順で代表点を採る。
  const ref = d.descend || d.rise || d.air;
  const cx = ref ? ref.x : ball.x;
  const cy = ref ? ref.y : ball.y;
  const t = ref ? ref.t : null;

  const g = coverageGeom(side);
  const NET_BALL_DEPTH = TUNING.pos.frontY + 2.4;
  const deepBall = Math.abs(cy) > NET_BALL_DEPTH;
  // 「深い球/ロブは前衛ではなく後衛の仕事」の特例は、netPlayerが実際にネット際にいる
  // 陣形（雁行・ダブル前衛）だけに適用する。ダブル後衛のように2人とも後ろ寄りの陣形では
  // この特例を外し、左右ゾーン割り当て(responsibleRole)に委ねる。外さないと深い球は
  // 常にbasePlayer固定になり、netPlayer側の担当ゾーンに来た球を誰も取りに行かず
  // （もしくはbasePlayerが無理に反対側まで追って）取り逃す・両者が寄る原因になる。
  const forceBack = isNetRole(netPlayer) && (situation.isLob || deepBall);
  const mul = (pp) => (pp === netPlayer ? 1.25 : 1.2);
  const owner = forceBack ? basePlayer : (g.responsibleRole(cx, cy) === "net" ? netPlayer : basePlayer);
  const other = owner === netPlayer ? basePlayer : netPlayer;
  const ownerReach = canReachHitPoint(owner, cx, cy, t, mul(owner));
  const otherReach = canReachHitPoint(other, cx, cy, t, mul(other));
  const arrival = (pp) => Math.hypot(cx - pp.x, cy - pp.y) /
    Math.max(0.1, TUNING.move.aiSpeed * (pp.stats ? pp.stats.speed : 1) * mul(pp));
  // ① サービスラインより前の選手は責任範囲・深さに関わらず届く球を取る。両者前なら先に触れる方。
  const netUp = Math.abs(netPlayer.y) < COURT.serviceY && canReachHitPoint(netPlayer, cx, cy, t, mul(netPlayer));
  const baseUp = Math.abs(basePlayer.y) < COURT.serviceY && canReachHitPoint(basePlayer, cx, cy, t, mul(basePlayer));
  let hitter;
  if (netUp && baseUp) hitter = arrival(netPlayer) <= arrival(basePlayer) ? netPlayer : basePlayer;
  else if (netUp) hitter = netPlayer;
  else if (baseUp) hitter = basePlayer;
  else if (forceBack) hitter = basePlayer;
  else if (ownerReach) hitter = owner;
  else if (otherReach) hitter = other;
  else hitter = (Math.hypot(cx - owner.x, cy - owner.y) <= Math.hypot(cx - other.x, cy - other.y)) ? owner : other;

  // 選択打点: 距離（最短移動）に加えて、打ち手が「得意な打点ほど選ばれやすい」よう重み付ける。
  //   cost = 移動距離 − SEL_SKILL_BONUS×(得意度−1)。得意ほどコストが下がり選ばれやすい。
  let sel = null, bestCost = Infinity;
  for (const c of [d.air, d.rise, d.descend]) {
    if (!c) continue;
    const sk = hitSkillForCand(hitter, c.kind);
    const dd = Math.hypot(c.x - hitter.x, c.y - hitter.y);
    const cost = dd - SEL_SKILL_BONUS * (sk - 1);
    if (cost < bestCost) { bestCost = cost; sel = c; }
  }
  d.sel = sel ? { x: sel.x, y: sel.y, t: sel.t, kind: sel.kind }
             : (ref ? { x: ref.x, y: ref.y, t: ref.t, kind: ref.kind } : null);
  d.hitterRole = (hitter === netPlayer) ? "net" : "base";
  d.isLob = situation.isLob;
  d.hitTime = ball.lastHitTime;
  d.valid = true;

  netPlayer.dbgOwner = (owner === netPlayer); basePlayer.dbgOwner = (owner === basePlayer);
  netPlayer.dbgReach = (netPlayer === owner) ? ownerReach : otherReach;
  basePlayer.dbgReach = (basePlayer === owner) ? ownerReach : otherReach;
  netPlayer.dbgHitter = (hitter === netPlayer); basePlayer.dbgHitter = (hitter === basePlayer);
}

export function decideTask(p, ctx) {
  const { netPlayer, basePlayer, opponentTeam, situation } = ctx;
  updateContactLatch(ctx.side, netPlayer, basePlayer, situation);
  // 自分側がラリー中に打つ番（相手が打った球が来ている）かどうか
  const receivingFromOpponent = state === "rally" && ball.lastHitter === opponentTeam && !ball.serving;
  if (!receivingFromOpponent) {
    return decideRecoverTask(p, ctx);
  }
  // ラッチした打ち手を読む（毎フレーム再判定しない）。
  const hitter = aiDebug[ctx.side].hitterRole === "net" ? netPlayer : basePlayer;
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
  // 自陣側へ来る球なら、ワイド/深め（insideCourt外）でも予測打点を返す。
  if (landing && landing.y * homeSign > 0) {
    // 打点は「バウンド後に打てる高さ(z≒1.15m)まで降下した点」(predictStrokeContact)を基準にする。
    // 頂点(predictHighContact)で位置取りすると浅すぎて、後衛が毎回下がりながら打つことになる
    // （ボールは頂点より深い降下点で打てるため）。ただし速い球では降下点がフェンス裏を指すことが
    // あるので、前進距離・最終深さとも上限を付けて後方フェンス走りを防ぐ。
    const sc = predictStrokeContact();
    const ly = Math.abs(landing.y);
    const rawTravel = sc ? Math.abs(sc.y) - ly : 1.2;
    const travelY = Math.max(0.4, Math.min(3.5, rawTravel));                  // 着地→打点の前進(上限3.5m)
    const driftX = sc ? Math.max(-1.5, Math.min(1.5, sc.x - landing.x)) : 0;  // 横ドリフト(上限1.5m)
    const cyAbs = Math.min(COURT.halfL + 0.8, ly + travelY);                  // ベースライン+0.8m以内に制限
    const cy = homeSign > 0 ? cyAbs : -cyAbs;
    const t = sc ? sc.t : landing.t + 0.2;
    return { x: landing.x + driftX, y: cy, t, bounced: false };
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

// 後衛の打点候補（相手の打球後）。homeSign は自陣方向(+1/-1)。
//   air     … バウンド前に打点高さへ降りてくる点（ノーバウンドで捕える）
//   rise    … バウンド後ライジングの最高打点（頂点）
//   descend … 頂点から降下して打てる高さに来た点
// 物理的に自陣側へ来るものだけを返す。呼び出し側が最短移動で届く候補を選ぶ。
function backHitCandidates(homeSign) {
  const out = [];
  const HIT_Z = 1.15; // 快適な打点高さ(m)
  if (ball.bounces === 0) {
    const landing = predictLanding();
    const disc = ball.vz * ball.vz - 2 * G * (HIT_Z - ball.z);
    if (disc >= 0) {
      const tAir = (ball.vz + Math.sqrt(disc)) / G; // 降下してHIT_Zに達する時刻
      if (tAir > 0.05 && (!landing || tAir < landing.t)) {
        const x = ball.x + ball.vx * tAir, y = ball.y + ball.vy * tAir;
        if (y * homeSign > 0) out.push({ x, y, t: tAir, kind: "air" });
      }
    }
  }
  const hc = predictHighContact();
  if (hc && hc.y * homeSign > 0) {
    const tRise = hc.landing ? hc.landing.t + Math.sqrt(2 * Math.max(0, hc.apexZ) / G) : null;
    out.push({ x: hc.x, y: hc.y, t: tRise, kind: "rise" });
  }
  const sc = predictStrokeContact();
  if (sc && sc.y * homeSign > 0) {
    out.push({ x: sc.x, y: sc.y, t: sc.t, kind: "descend" });
  }
  return out;
}

// 打ち手側の「打つための立ち位置」タスク。前衛/後衛で打点目標の作り方を分ける。
function decideHitApproachTask(p, ctx) {
  const { netPlayer, basePlayer, myTeam, homeSign, speed, situation } = ctx;

  if (p === netPlayer) {
    if (ball.bounces === 0 && !situation.isLob) {
      // front-volley: ネット際の自分の高さ(y)を球が横切るxへ詰める
      const t = Math.abs(ball.vy) > 0.1 ? (p.y - ball.y) / ball.vy : -1;
      const predX = (t > 0 && t < 1.2) ? ball.x + ball.vx * t : ball.x;
      const tx = Math.max(-3.4, Math.min(3.4, predX));
      return { kind: "hit", x: tx, y: p.y, speedMul: 1.25 };
    }
    // front-stroke / ロブ対応: ネット際で固まらず、予測打点（バウンド前でも着地/降下点）へ
    // 打たれた瞬間から向かう。深い打点へ無理に押し込めず素直に向かう。
    const contact = estimateContactPoint(homeSign);
    const tx = Math.max(-COURT.halfW, Math.min(COURT.halfW, contact ? contact.x : p.x));
    const ty = Math.max(-(COURT.halfL + 1.0), Math.min(COURT.halfL + 1.0, contact ? contact.y : p.y));
    return { kind: "hit", x: tx, y: ty, speedMul: 1.25 };
  }

  // back-stroke / back-lob-cover
  // 後衛は「ベースラインより1〜2歩後ろ」を基準に構え（backY）、相手の打球後の3つの打点候補
  //   ① ノーバウンド ② バウンド後ライジングの最高打点 ③ 頂点から降下した打点
  // のうち、現在地から最短移動で届く点を選んで打つ。深く構えるので前へ詰めて打つ形になり、
  // 「下がりながら打つ」のを抑える。後方フェンス走りは depthCap で防ぐ。
  // ※ 打点候補と選択は相手の打球時に updateContactLatch で一度だけ確定済み（ぶらさない）。
  let ty, tx, timeToContact = null;
  const sel = aiDebug[myTeam].sel;
  if (sel) {
    const depthCap = COURT.halfL + 2.5;
    tx = sel.x;
    ty = Math.max(-depthCap, Math.min(depthCap, sel.y));
    timeToContact = sel.t;
  } else {
    // ラッチ無し: ベースライン後方の定位置で待つ
    ty = homeSign > 0 ? TUNING.pos.backY : -TUNING.pos.backY;
    tx = coverageGeom(myTeam).zoneCenterX("base", ty);
  }

  // フォア回り込み判定（前寄りは上で早期returnしているため、ここは常に後ろ寄り選手）。
  const contactX = tx; // foreApproachX 前＝ボールの打点x（弧アプローチの中心）
  const contactY = ty;
  const standX = foreApproachX(basePlayer, myTeam, tx, speed * 1.2, timeToContact);
  basePlayer.swingSide = basePlayer.hitSide;
  basePlayer.swingSideLocked = true;
  // 打点へは直線(L字)でなく弧を描いて入る。ただし時間に十分余裕があるときだけ
  // （>0.6s）。余裕が無いのに弧で回り込むと打点に間に合わず空振りするため、間に合わない
  // ／大きく回り込む側は arcApproachTarget 内で直線にフォールバックする。
  let target = { x: standX, y: ty };
  if (timeToContact != null && timeToContact > 0.6) {
    target = arcApproachTarget(basePlayer, contactX, contactY, standX, ty);
  }
  // サイドライン外へ走り込みすぎない上限（フォア回り込み+弧で外へ膨らむのを抑える）。
  const xLimit = COURT.halfW + 0.9;
  target.x = Math.max(-xLimit, Math.min(xLimit, target.x));
  return { kind: "hit", x: target.x, y: target.y, speedMul: 1.2 };
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

    // 定位置はネット担当ゾーン（ストレート側）の理想ポジション。デバッグのリングと同一。
    const frontHome = idealPosition(myTeam, "net");
    let frontTy = frontHome.y;
    let frontTargetX = frontHome.x;
    let frontDash = dash;
    let kind = "cover";

    // ポーチ/ネット詰め(advance)は、netPlayerが実際にネット際にいる陣形（雁行・
    // ダブル前衛）だけで働かせる。ダブル後衛はnetPlayerも後ろ寄りで、
    // netPlayer.homeYが後衛の打点予測とほぼ同じ深さになるため、この特例を外さないと
    // 「後衛が処理する球へ前寄り選手も一緒に飛び出す」＝同じ球へ2人が寄る/重なる原因になる。
    if (isNetRole(netPlayer)) {
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
    }
    return { kind, x: frontTargetX, y: frontTy, speedMul: frontDash };
  }

  // 後ろ寄り(basePlayer): 打ち手が前寄り選手のときのカバー位置。
  // 定位置は後方担当ゾーン（クロス側）の理想ポジション。デバッグのリングと同一。
  const retSpeedMul = (side === "cpu" && !spectatorMode) ? 0.8 : dash;
  if (state === "rally") {
    const home = idealPosition(myTeam, "base");
    return { kind: "cover", x: home.x, y: home.y, speedMul: retSpeedMul };
  }
  return {
    kind: "cover",
    x: Math.max(-4.4, Math.min(4.4, coverageGeom(myTeam).zoneCenterX("base", basePlayer.homeY))),
    y: basePlayer.homeY,
    speedMul: retSpeedMul,
  };
}

// recover: 自陣にボールがある間（自分たちが打った直後など）、定位置・コース担当へ戻るタスク。
function decideRecoverTask(p, ctx) {
  const { netPlayer, basePlayer, side, myTeam, homeBackY, dash, myJustServedByFront } = ctx;

  if (p === netPlayer) {
    if (state === "rally") {
      const home = idealPosition(myTeam, "net");
      const retSpeedMul = (side === "cpu" && !spectatorMode) ? 0.8 : dash;
      return { kind: "recover", x: home.x, y: home.y, speedMul: retSpeedMul };
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
  const home = idealPosition(myTeam, "base");
  return { kind: "recover", x: home.x, y: home.y, speedMul: retSpeedMul };
}
