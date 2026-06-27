import { TUNING, COURT } from "./config.js";
import { back, front, cpuBack, cpuFront, ball, development } from "./state.js";
import { predictLanding } from "./main.js";

/* ===========================================================
 * AI ポジショニング基盤（最下層）
 *
 * 役割（前衛/後衛）やフェーズに依存しない、純粋な
 *   ・移動ユーティリティ（慣性付き moveToward）
 *   ・相手打点の参照
 *   ・クロス/ストレート展開の判定
 *   ・展開に応じた定位置(x)の計算
 *   ・「間に合わない場所」探索（弱点）
 * をまとめる。上位（aiContext/aiTask/aiPhase/ai）はここを参照する。
 * このモジュールは他のAIモジュールに依存しない（循環を避けるため）。
 * =========================================================== */

// 呼び出し側は従来どおり moveToward(p, tx, ty, maxDist) の形のまま使う
// （maxDist = 目標速さ*dt として渡されてくる。呼び出し側は変更不要）。
// 内部では maxDist/dt から目標速さを逆算し、速度(p.vx/p.vy)へ軽い加減速で
// 追従させてから位置を更新する＝慣性。dt は引数で明示的に受け取る。
export function moveToward(p, tx, ty, maxDist, dt) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (dt === undefined || dt <= 0) {
    // dt 未指定の呼び出し（保険）: 従来の直接移動にフォールバック
    if (d < 0.01) return;
    const step = Math.min(d, maxDist);
    p.x += (dx / d) * step;
    p.y += (dy / d) * step;
    return;
  }
  const targetSpeed = maxDist / dt;
  let targetVx = 0, targetVy = 0;
  if (d >= 0.01) {
    // 目標までの距離が今フレームの到達距離以下なら行き過ぎないよう速度を落とす
    const desired = Math.min(targetSpeed, d / dt);
    targetVx = (dx / d) * desired;
    targetVy = (dy / d) * desired;
  }
  p.vx = approachVelocity(p.vx || 0, targetVx, dt);
  p.vy = approachVelocity(p.vy || 0, targetVy, dt);
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

function approachVelocity(cur, target, dt) {
  const accel = TUNING.move.accel;
  const decel = TUNING.move.decel;
  const accelerating = Math.abs(target) > Math.abs(cur) && Math.sign(target) === Math.sign(cur || target);
  const rate = accelerating ? accel : decel;
  const diff = target - cur;
  const maxStep = rate * dt;
  if (Math.abs(diff) <= maxStep) return target;
  return cur + Math.sign(diff) * maxStep;
}

// 相手後衛（＝こちらに打ってくる側）の打点位置を返す。
//   side="cpu": 相手はプレイヤー。side="player": 相手はCPU。
// 相手が打った球が飛来中はその打点(originX)を、こちらの打球が飛行中
// （サーブ含む）は飛んでいる球ではなく相手後衛の現在位置を基準にする。
// （飛行中の自球xを使うと、球がコートを横切るのに合わせて展開判定/定位置が
//   左右に振れてしまうため）。
export function opponentHitterPos(side) {
  if (side === "cpu") {
    // CPUから見た相手＝プレイヤー側
    if (ball.lastHitter === "player") return { x: ball.originX, y: ball.originY };
    const op = basePlayerOf("player");
    return { x: op.x, y: op.y };
  }
  if (ball.lastHitter === "cpu") return { x: ball.originX, y: ball.originY };
  const op = basePlayerOf("cpu");
  return { x: op.x, y: op.y };
}

/* ===========================================================
 * 中立な選手導出（positionBias基準）
 *
 * AI内部は front/back という固定クラスではなく、2選手のうち
 *   positionBiasが小さい方 = netPlayer（前寄り・ネット担当寄り）
 *   positionBiasが大きい方 = basePlayer（後ろ寄り・ベースライン担当寄り）
 * として扱う。雁行では netPlayer=前衛・basePlayer=後衛と一致し従来挙動を保つが、
 * ダブル後衛/前衛では2人のbias差ぶんの自然な前後差として表れる。
 * =========================================================== */
export function teammatesOf(side) { return side === "cpu" ? [cpuFront, cpuBack] : [front, back]; }
export function netPlayerOf(side) {
  const [a, b] = teammatesOf(side);
  return a.positionBias <= b.positionBias ? a : b;
}
export function basePlayerOf(side) {
  const [a, b] = teammatesOf(side);
  return a.positionBias <= b.positionBias ? b : a;
}

// positionBias(0=ネット際〜100=ベースライン)を自陣ネットからの距離yに写像する。
// 雁行アンカー（bias25→frontY, bias80→backY）を通すよう校正し、従来の定位置を再現する。
export function depthFromBias(bias) {
  const FY = TUNING.pos.frontY, BY = TUNING.pos.backY;
  const t = (bias - 25) / (80 - 25);
  return Math.max(1.6, Math.min(BY + 0.5, FY + (BY - FY) * t));
}

// recover（定位置）の符号付きy。基本深さはpositionBiasから決め、前寄り(bias<45)だけ
// 相手後衛の前後動きへ軽く鏡対応する（雁行前衛の従来の振る舞いを保つ）。
// ダブル陣形では2人のbias差ぶんの自然な前後差になる。
export function recoverDepthY(side, p) {
  const homeSign = side === "player" ? 1 : -1;
  const base = depthFromBias(p.positionBias);
  let depth = base;
  if (p.positionBias < 45) {
    const op = opponentHitterPos(side);
    depth += (Math.abs(op.y) - COURT.halfL) * TUNING.pos.frontMirror;
  }
  depth = Math.max(1.6, Math.min(base + 1.8, Math.max(base - 1.8, depth)));
  return homeSign > 0 ? depth : -depth;
}

/* ===========================================================
 * 守備範囲の幾何（インになるシュート軌道）
 *
 * 相手打点 O を起点に、サイドライン×最浅シュート深さ(サービスライン相当)の隅へ
 * 向かう左右端コースと、その二等分(中心線)を返す。デバッグ表示(render)と AI の
 * ポジショニング/担当判定で同じこの幾何を共有する（見た目と挙動を一致させる）。
 *   zoneCenterX("net", y)  … ストレート側ゾーン中央x（ネット担当の理想x）
 *   zoneCenterX("base", y) … クロス側ゾーン中央x（後方担当の理想x）
 * =========================================================== */
export const COVERAGE_SHOOT_MIN_DEPTH = COURT.serviceY;
function covUnit(x, y) { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; }
export function coverageGeom(side) {
  const homeSign = side === "cpu" ? -1 : 1;
  const O = opponentHitterPos(side);
  const Xw = COURT.halfW;
  const yBase = homeSign * COURT.halfL;
  const yMin = homeSign * COVERAGE_SHOOT_MIN_DEPTH;
  const dirL = { x: -Xw - O.x, y: yMin - O.y };
  const dirR = { x:  Xw - O.x, y: yMin - O.y };
  const uL = covUnit(dirL.x, dirL.y), uR = covUnit(dirR.x, dirR.y);
  const dirC = { x: uL.x + uR.x, y: uL.y + uR.y };
  const cl = (x) => Math.max(-Xw, Math.min(Xw, x));
  const xAt = (dir, y) => Math.abs(dir.y) < 1e-6 ? O.x : O.x + (y - O.y) / dir.y * dir.x;
  const straightSign = O.x >= 0 ? 1 : -1;
  const leftX = (y) => cl(xAt(dirL, y));
  const rightX = (y) => cl(xAt(dirR, y));
  const centerX = (y) => cl(xAt(dirC, y));
  const zoneCenterX = (role, y) => {
    const c = centerX(y);
    const straightEdge = straightSign > 0 ? rightX(y) : leftX(y);
    const crossEdge    = straightSign > 0 ? leftX(y)  : rightX(y);
    return role === "net" ? (straightEdge + c) / 2 : (crossEdge + c) / 2;
  };
  return { O, Xw, yBase, homeSign, straightSign, dirL, dirR, dirC, leftX, rightX, centerX, zoneCenterX };
}

// その展開判定で使う「自陣後衛」「自陣前衛」「相手後衛」は、固定クラスではなく
// positionBiasで導出した basePlayer/netPlayer を返す（中立化）。
export function ownBackPlayer(side) { return basePlayerOf(side); }
export function ownFrontPlayer(side) { return netPlayerOf(side); }
export function oppBackPlayer(side) { return basePlayerOf(side === "cpu" ? "player" : "cpu"); }

// 相手の打球がこちらのどのサイドへ向かっているか（着地予測のx符号）。
// 予測できないときは相手打点の符号で代用する。
export function incomingSideSign(side) {
  const incoming = (side === "cpu") ? (ball.lastHitter === "player")
                                    : (ball.lastHitter === "cpu");
  if (incoming) {
    const landing = predictLanding();
    if (landing && Math.abs(landing.x) > 0.2) return landing.x >= 0 ? 1 : -1;
    if (Math.abs(ball.x) > 0.2) return ball.x >= 0 ? 1 : -1;
  }
  const op = opponentHitterPos(side);
  return op.x >= 0 ? 1 : -1;
}

/* ===========================================================
 * クロス/ストレート展開の判定（陣形の動的切替）
 *
 * 判定: 自陣後衛と相手後衛のx符号（コート左右サイド）を比較する。
 *   後衛同士が逆サイド = クロス展開（対角でラリーしている）
 *   後衛同士が同サイド = ストレート展開（自後衛の側へ来ている）
 *   ヒステリシス: 両後衛ともセンター付近（|x|<devHysteresis）のとき切替保留。
 *   ボールの着地予測ではなく後衛の位置関係を軸にして判定を安定させる。
 * =========================================================== */
export function updateDevelopment(side) {
  const ownBackP = ownBackPlayer(side);
  const oppBackP = oppBackPlayer(side);
  const ownBackSign = ownBackP.x >= 0 ? 1 : -1;
  const oppBackSign = oppBackP.x >= 0 ? 1 : -1;
  // 後衛同士が逆サイド=クロス展開、同サイド=ストレート展開
  const raw = (ownBackSign !== oppBackSign) ? "cross" : "straight";
  // ヒステリシス: 両後衛ともセンター付近では切替を保留する
  const hysteresis = TUNING.pos.devHysteresis;
  if (Math.abs(ownBackP.x) < hysteresis && Math.abs(oppBackP.x) < hysteresis) {
    return development[side];
  }
  development[side] = raw;
  return raw;
}

// 展開に応じた前衛のx定位置。
//   クロス: 後衛がいない側（-ownBackSign）のネット前。|x|<=3.0 でクランプ。
//   ストレート: 後衛と同サイドでセンターより内側（線上の内側）。
export function frontDevX(side) {
  const dev = updateDevelopment(side);
  const ownBackSign = ownBackPlayer(side).x >= 0 ? 1 : -1;
  if (dev === "straight") {
    // 同サイドへ並ぶ。相手打点─自センター線上の内側に寄る
    const lineX = frontTheoryX(side, ownFrontPlayer(side).homeY);
    const inside = ownBackSign * TUNING.pos.straightFrontX;
    // 線上の値と「同サイド内側」の中間。センターより内側を保つ
    const x = (lineX + inside) / 2;
    return Math.max(-3.0, Math.min(3.0, x));
  }
  // クロス展開: 後衛のいない側のネット前。隅へ吸い込まれない
  return Math.max(-3.0, Math.min(3.0, -ownBackSign * TUNING.pos.crossFrontX));
}

// 展開に応じた後衛のx定位置。
//   クロス: クロス側の残り範囲の真ん中（既存セオリー）。
//   ストレート: ストレート側ライン担当（同サイドのライン際寄り）。
export function backDevX(side) {
  const dev = updateDevelopment(side);
  if (dev === "straight") {
    const ownBackSign = ownBackPlayer(side).x >= 0 ? 1 : -1;
    return ownBackSign * TUNING.pos.straightBackX;
  }
  return backCrossX(side);
}

// 前衛の定位置（確定セオリー）:
//   「相手後衛の打点 ─ 自コートのセンターマーク」を結んだ線上、ただし
//   気持ち一歩“外側”（利き腕の肩がその線に乗る程度）に立つ。
//   side が守るコートのセンターマークは ±COURT.halfL。
//   frontY はその前衛のネット前定位置y。
export function frontTheoryX(side, frontY) {
  const op = opponentHitterPos(side);
  const cy = side === "cpu" ? -COURT.halfL : COURT.halfL; // 自コートのセンターマーク
  let lineX = 0;
  if (Math.abs(cy - op.y) >= 0.5) {
    // t>1 は op.y が cy を超えた位置（ベースライン外など）なのでクランプして破綻防止
    const t = Math.max(0, Math.min(1, (frontY - op.y) / (cy - op.y)));
    lineX = op.x * (1 - t);
  }
  // 線上から「気持ち一歩外側」へ。外側＝センターラインから離れる向き
  // （線が左側(x<0)なら更に左へ、右側なら更に右へ）。
  const outSign = lineX >= 0 ? 1 : -1;
  // 左利きの前衛は利き腕の肩が逆になるため、外側へ寄る向きを反転させる
  const frontPlayer = netPlayerOf(side);
  const handSign = frontPlayer.stats.handed === "left" ? -1 : 1;
  // コート外への逸脱を防ぐ（シングルスコート幅でクランプ）
  return Math.max(-COURT.singlesHalfW, Math.min(COURT.singlesHalfW,
    lineX + outSign * handSign * TUNING.pos.frontOutsideStep));
}

// 後衛の定位置（確定セオリー）:
//   前提＝前衛がストレート側を守る。後衛はそのストレートレーンを捨て、
//   残ったクロス側範囲の“真ん中”（コート中央ではなくクロス側寄り）に立つ。
export function backCrossX(side) {
  const op = opponentHitterPos(side);
  // 相手から見たストレートは相手打点と同じ符号側。クロスはその反対。
  const straightSign = op.x >= 0 ? 1 : -1;
  // 残ったクロス側範囲（センター0〜サイドライン）の真ん中あたりへ寄る
  return -straightSign * TUNING.pos.backCrossBias;
}

// 互換: 旧名（CPU前衛のセオリーX）
export function cpuFrontTheoryX() {
  return frontTheoryX("cpu", cpuFront.homeY);
}

// 前寄り選手の相手後衛への前後ミラー対応は recoverDepthY 内へ統合した。

/* ===========================================================
 * 「間に合わない場所」狙い（弱点狙い）
 *
 * 相手前衛・後衛それぞれの現在位置から、コート幅を横方向にサンプリングし、
 * 両者とも横移動で追いつけないx座標を探す。tryReturnAI のコース選択に弱く効かせる。
 * =========================================================== */
const OPEN_SPOT_FLIGHT_TIME = 0.85; // 後衛の深いストロークがコートを横切るおおよその時間(秒)
const OPEN_SPOT_SAMPLES = 9;        // サイドライン間のサンプリング数

// 指定x地点に、選手pが飛行時間内に横移動で到達できるか。
function canCoverX(p, x, flightTime) {
  if (!p) return false;
  const speed = TUNING.move.aiSpeed * (p.stats ? p.stats.speed : 1) * 1.2; // 守備反応込みの目安速度
  // 前寄り(bias<50)はボレーリーチ、後ろ寄りはストロークリーチで概算する。
  const reach = ((p.positionBias != null && p.positionBias < 50) ? TUNING.ai.frontVolleyReach : TUNING.ai.backReach) *
    (p.stats ? p.stats.reach : 1);
  const dist = Math.max(0, Math.abs(x - p.x) - reach);
  return dist <= speed * flightTime;
}

// 相手前衛・後衛のどちらも届かないxを探す。見つかれば最も「間に合わなさが大きい」
// （両者の最短到達時間が長い）地点のxを返す。見つからなければnull。
export function findOpenCourseX(oppBack, oppFront) {
  const xMax = COURT.singlesHalfW - 0.2;
  let bestX = null;
  let bestGap = 0;
  for (let i = 0; i < OPEN_SPOT_SAMPLES; i++) {
    const x = -xMax + (2 * xMax) * (i / (OPEN_SPOT_SAMPLES - 1));
    const backOk = canCoverX(oppBack, x, OPEN_SPOT_FLIGHT_TIME);
    const frontOk = canCoverX(oppFront, x, OPEN_SPOT_FLIGHT_TIME);
    if (backOk || frontOk) continue;
    const backGap = Math.abs(x - oppBack.x);
    const frontGap = Math.abs(x - oppFront.x);
    const gap = Math.min(backGap, frontGap);
    if (gap > bestGap) {
      bestGap = gap;
      bestX = x;
    }
  }
  return bestX;
}
