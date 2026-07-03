import { TUNING, COURT } from "./config.js";
import { back, front, cpuBack, cpuFront, ball, development, coverageAnchor, formation } from "./state.js";
import { predictLanding, netClearance } from "./matchLoop.js";

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

// 打点へ「弧を描いて入る」ためのアプローチ目標点を返す。
//   contact = 打点（ボール予測位置）, stand = 最終立ち位置。
// 選手は打点を中心に距離・角度をできるだけ保ったまま円弧上を回り込み、正しい角度に
// 揃ってから立ち位置へ寄せる。直線で L 字（前後→左右）に入らず、後衛らしく弧を描く。
// 半径(理想打点距離)は徐々に詰める＝スパイラルイン。時間に余裕がないときは呼ばない側で制御。
export function arcApproachTarget(p, contactX, contactY, standX, standY) {
  const R = Math.hypot(standX - contactX, standY - contactY); // 打点からの理想半径
  const pcx = p.x - contactX, pcy = p.y - contactY;
  const dPC = Math.hypot(pcx, pcy);
  if (R < 0.15 || dPC < Math.max(0.2, R * 0.5)) return { x: standX, y: standY };
  const aP = Math.atan2(pcy, pcx);
  const aS = Math.atan2(standY - contactY, standX - contactX);
  let dA = aS - aP;
  while (dA > Math.PI) dA -= 2 * Math.PI;
  while (dA < -Math.PI) dA += 2 * Math.PI;
  // ほぼ正対は直接。大きく回り込む必要がある側（打点の反対側にいる）は弧で遠回りすると
  // 打点をぐるっと回って間に合わず空振りする（ボールが片側に来たときだけ起きる左右非対称の
  // 原因）。その場合も直線で立ち位置へ向かう。弧は中程度の角度調整のときだけ使う。
  if (Math.abs(dA) < 0.2 || Math.abs(dA) > 1.0) return { x: standX, y: standY };
  const stepA = Math.sign(dA) * Math.min(Math.abs(dA), 0.7); // 1フレームの回り込み角上限(rad)
  const aT = aP + stepA;
  const rT = dPC + (R - dPC) * 0.4; // 半径を理想へ徐々に詰める
  return { x: contactX + rT * Math.cos(aT), y: contactY + rT * Math.sin(aT) };
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

// 相手（＝こちらに打ってくる側）の「最後の打点」位置を返す。
//   side="cpu": 相手はプレイヤー。side="player": 相手はCPU。
// 値は coverageAnchor のラッチ（相手が打った瞬間に確定）だけを参照する。
// ラリー中に相手や味方が動いても変わらず、次に相手が打つまで固定される。
//   → 飛行中に展開判定/定位置が左右に振れる問題（責任入れ替わり）を断つ。
// ラッチ未確定（ポイント開始直後など）は相手後衛の現在位置にフォールバックする。
export function opponentHitterPos(side) {
  const a = coverageAnchor[side];
  if (a && a.set) return { x: a.x, y: a.y };
  const op = basePlayerOf(side === "cpu" ? "player" : "cpu");
  return { x: op.x, y: op.y };
}

/* ===========================================================
 * フォーメーション決定（自分たちが返球した瞬間に1回だけ）
 *
 * フォーメーション = 展開 + ポジション + 責任範囲。実体は coverageAnchor の
 *   {x,y(=相手の予測打点O), frontSide(=前衛が守る半面)}。
 * 候補は「クロス展開」「ストレート展開」= frontSide が -1 / +1 の2通り。各候補で
 * 前衛・後衛の目標位置を求め、両者が到達するまでの時間 completionTime =
 * max(前衛到達時間, 後衛到達時間) を計算し、最小の展開を採用する。
 * ＝「前衛・後衛の両方が最も早く守備位置へ入れる展開」を選ぶ（無駄な左右入替を避ける）。
 * =========================================================== */

// frontSide を仮に与えたときの、前衛/後衛それぞれの目標位置(x,y)を返す。
// idealPosition と同じ計算（clamp 込み）を frontSide 指定で行う共通ロジック。
function formationTargets(side, frontSide) {
  const a = coverageAnchor[side];
  const prev = a.frontSide;
  a.frontSide = frontSide;               // この候補の幾何で評価
  const net = netPlayerOf(side), base = basePlayerOf(side);
  const g = coverageGeom(side);
  const netY = recoverDepthY(side, net), baseY = recoverDepthY(side, base);
  const netX = Math.max(-3.4, Math.min(3.4, g.zoneCenterX("net", netY)));
  const baseX = Math.max(-4.4, Math.min(4.4, g.zoneCenterX("base", baseY)));
  a.frontSide = prev;                    // 評価用の一時変更を戻す
  return { net: { x: netX, y: netY, p: net }, base: { x: baseX, y: baseY, p: base } };
}

// 自分たちが返球した瞬間に、次のフォーメーションを決定して保存する（ラリー中唯一の更新点）。
//   side : 返球した側。O = 自分の打球の着地予測（相手が次に打つ位置）。
// クロス/ストレート（frontSide=-1/+1）の2候補から completionTime 最小を選ぶ。
export function updateFormation(side) {
  const landing = predictLanding();
  if (!landing) return; // 着地予測なし: 前回フォーメーションを維持
  const a = coverageAnchor[side];
  a.x = landing.x; a.y = landing.y; a.set = true;

  let bestSide = a.frontSide, bestTime = Infinity;
  for (const fs of [-1, 1]) {
    const t = formationTargets(side, fs);
    const netSpeed = Math.max(0.1, TUNING.move.aiSpeed * (t.net.p.stats ? t.net.p.stats.speed : 1));
    const baseSpeed = Math.max(0.1, TUNING.move.aiSpeed * (t.base.p.stats ? t.base.p.stats.speed : 1));
    const tNet = Math.hypot(t.net.x - t.net.p.x, t.net.y - t.net.p.y) / netSpeed;
    const tBase = Math.hypot(t.base.x - t.base.p.x, t.base.y - t.base.p.y) / baseSpeed;
    const completion = Math.max(tNet, tBase); // 両方が揃った時点で完成
    if (completion < bestTime) { bestTime = completion; bestSide = fs; }
  }
  a.frontSide = bestSide;
}

// 打球イベント時のフック（main.js / serve.js から、打った直後に呼ぶ）。
//   team : 打った側。返球した team 自身のフォーメーションだけをここで更新する。
// 受け手(相手)のフォーメーションは相手が前回返球したときに既に確定済みなので触らない
// （相手が打つ瞬間にフォーメーションを再計算しない、というラリー設計のため）。
export function latchCoverageOnHit(team) {
  updateFormation(team);
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
 * 守備範囲の幾何（左右責任の分割）
 *
 * 相手打点 O（ラッチ済み）から、各サイドラインへ「ネットを越えてインに入る最も
 * 角度のついた軌道」（端コース）を引く。隅の深さは固定ではなく、代表シュートの
 * ネットクリアランス物理から求める（→ shallowestInboundDepth）。その2辺の二等分線
 * ＝中心線で自陣を「ストレート側（ネット担当）」「クロス側（後方担当）」に二分する。
 * デバッグ表示(render)と AI のポジショニング/担当判定が同じこの幾何だけを共有する。
 *   zoneCenterX("net", y)  … ストレート側ゾーン中央x（ネット担当の理想x）
 *   zoneCenterX("base", y) … クロス側ゾーン中央x（後方担当の理想x）
 * =========================================================== */
export const COVERAGE_SHOOT_MIN_DEPTH = COURT.serviceY; // フォールバック用の最浅深さ
const COVERAGE_CONTACT_Z = 0.9;    // 相手打点の代表高さ(m)
const COVERAGE_NET_MARGIN = 0.10;  // ネット上端からの最小クリア余裕(m)
function covUnit(x, y) { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; }

// 相手打点 O から指定サイドライン(sideX)へ向けて、ネットを越えてインに入る最も浅い着地深さ(y)。
// = そのサイドへ角度をつけて打てる限界（端コースの隅）。homeSign は自陣方向(+1/-1)。
// speed は相手が実際に打つ早い球の球速。浅い側から走査し、最初にネットを越える深さを返す。
function shallowestInboundDepth(O, sideX, homeSign, speed) {
  for (let d = 1.0; d <= COURT.halfL; d += 0.2) {
    const ty = homeSign * d;
    const c = netClearance(O.x, O.y, COVERAGE_CONTACT_Z, sideX, ty, speed);
    if (c !== null && c >= COURT.netH + COVERAGE_NET_MARGIN) return ty;
  }
  return homeSign * COVERAGE_SHOOT_MIN_DEPTH;
}

// 守備範囲を決める「相手が実際に打つ早い球」の球速。固定の代表値は使わず、
// 通常ラリーのシュート(drive)球速 × 相手後ろ寄り選手の power から決める（CPUごとに変わる）。
// 遅い球（ショートクロス等）は追いつけるので、早い球の角度だけを守備範囲にする狙い。
function opponentShootSpeed(side) {
  const oppSide = side === "cpu" ? "player" : "cpu";
  const hitter = basePlayerOf(oppSide);
  const power = (hitter && hitter.stats && hitter.stats.power) || 1.0;
  return TUNING.shots.drive.speed * power;
}
// 守備範囲の幾何（単一の真実）。render のデバッグ描画と AI のポジショニングが
// この同じ結果だけを参照する（見た目＝挙動）。
// 外側境界は「相手がインに打てる最も角度のついた軌道」: 相手打点 O から、両サイド
// ライン×最浅シュート深さ(サービスライン相当)の隅へ向かう左右端コース。その内側＝
// インになる球が通り得る範囲。中心線(二等分線)で左右＝二人の責任範囲に分割する。
//   leftX(y)/rightX(y)  … 左端/右端コースの深さyでのx（責任ゾーンの外側境界）。
//   centerX(y)          … 中心線。左右責任の境界。
//   zoneCenterX(role,y) … その役割の責任ゾーン中央＝理想ポジションのx
//                          （ネット担当=ストレート側、後方担当=クロス側の端〜中心線の中点）。
export function coverageGeom(side) {
  const homeSign = side === "cpu" ? -1 : 1;
  const O = opponentHitterPos(side);
  const Xw = COURT.halfW;
  const yBase = homeSign * COURT.halfL;
  // 左右端コースの隅＝各サイドラインへ「ネット越え＋イン」になる最も浅い着地点。
  // O が中央から外れると左右で深さが変わる。代表球速は相手の power 依存（CPUごと）。
  const shootSpeed = opponentShootSpeed(side);
  const leftCornerY = shallowestInboundDepth(O, -Xw, homeSign, shootSpeed);
  const rightCornerY = shallowestInboundDepth(O,  Xw, homeSign, shootSpeed);
  const dirL = { x: -Xw - O.x, y: leftCornerY - O.y };
  const dirR = { x:  Xw - O.x, y: rightCornerY - O.y };
  const uL = covUnit(dirL.x, dirL.y), uR = covUnit(dirR.x, dirR.y);
  const dirC = { x: uL.x + uR.x, y: uL.y + uR.y };
  const cl = (x) => Math.max(-Xw, Math.min(Xw, x));
  const xAt = (dir, y) => Math.abs(dir.y) < 1e-6 ? O.x : O.x + (y - O.y) / dir.y * dir.x;
  // O が乗っているサイド（ストレート側）。展開名/デバッグ用に保持。
  const straightSign = O.x >= 0 ? 1 : -1;
  // フォーメーションが決めた「前衛が守る半面」。未確定時はストレート側を前衛が締める
  // 従来割り当て（前衛=O側ハーフ）にフォールバックする。
  const anchor = coverageAnchor[side];
  const frontSide = (anchor && anchor.set) ? anchor.frontSide : straightSign;
  const leftX = (y) => cl(xAt(dirL, y));
  const rightX = (y) => cl(xAt(dirR, y));
  const centerX = (y) => cl(xAt(dirC, y));
  // 各ハーフ（左=dirL〜dirC / 右=dirC〜dirR）の角度二等分線（1/4角度）。理想ポジション
  // はこのレイ上に置く（x中点ではなく O 起点の角度二等分）。
  const uC = covUnit(dirC.x, dirC.y);
  const dirQuarterL = { x: covUnit(dirL.x, dirL.y).x + uC.x, y: covUnit(dirL.x, dirL.y).y + uC.y };
  const dirQuarterR = { x: covUnit(dirR.x, dirR.y).x + uC.x, y: covUnit(dirR.x, dirR.y).y + uC.y };
  // 前衛は frontSide のハーフ、後衛は逆ハーフを担当する。
  const dirNet  = frontSide < 0 ? dirQuarterL : dirQuarterR;
  const dirBase = frontSide < 0 ? dirQuarterR : dirQuarterL;
  const zoneCenterX = (role, y) => cl(xAt(role === "net" ? dirNet : dirBase, y));
  // 打点(x,y)がどちらのハーフ＝どちらの担当かを返す（責任範囲＝フォーメーションに従う）。
  const responsibleRole = (x, y) => {
    const contactSide = (x - centerX(y)) >= 0 ? 1 : -1;
    return contactSide === frontSide ? "net" : "base";
  };
  return {
    O, Xw, yBase, homeSign, straightSign, frontSide, dirL, dirR, dirC,
    leftX, rightX, centerX, zoneCenterX, responsibleRole,
    leftCornerY, rightCornerY, // 端コースがサイドラインに到達する深さ（折れ点）
  };
}

// 理想ポジション（recover / cover の定位置）。render のリングと AI の移動目標が
// 必ずこの同じ値を参照する。role: "net"（前寄り） / "base"（後ろ寄り）。
//   y は recoverDepthY（展開ラッチ基準）で決め、x はその深さでの zoneCenterX。
export function idealPosition(side, role) {
  const p = role === "net" ? netPlayerOf(side) : basePlayerOf(side);
  const ty = recoverDepthY(side, p);
  const g = coverageGeom(side);
  const xCap = role === "net" ? 3.4 : 4.4;
  let tx = g.zoneCenterX(role, ty);
  // ネット前選手（bias<45＝frontMirrorと同じ閾値）は、相手が打つ瞬間センター側へ寄って
  // 立つ。守備範囲（境界・担当）は不変で、範囲内の立ち位置だけ中心線へ補間する。
  if (role === "net" && p.positionBias < 45) {
    const hug = centerHugAmount(side, tx, ty);
    if (hug > 0) tx += (g.centerX(ty) - tx) * hug;
  }
  tx = Math.max(-xCap, Math.min(xCap, tx));
  return { x: tx, y: ty };
}

// ネット前選手のセンター寄せ量(0〜frontCenterHug)を返す。
//   ・ダブル前衛は0（2人ともネット前でセンターへ寄ると外側が空きすぎるため）。
//     formation は自チーム(player)専用のUI設定。CPUは常に雁行なので判定不要。
//   ・相手打点が近いほど線形に0へ減衰（寄せたぶん自ゾーン側へ戻る反応が間に合わないため）。
//     ON/OFF閾値ではなく減衰にすることで、境界で立ち位置が飛ばない。
function centerHugAmount(side, tx, ty) {
  if (side === "player" && formation === "double-front") return 0;
  const op = opponentHitterPos(side);
  const d = Math.hypot(op.x - tx, op.y - ty);
  const near = TUNING.pos.frontHugNearDist;
  const far = TUNING.pos.frontHugFarDist;
  const t = Math.max(0, Math.min(1, (d - near) / Math.max(0.1, far - near)));
  return TUNING.pos.frontCenterHug * t;
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
 * クロス/ストレート展開（ラッチ済みの状態を読むだけ）
 *
 * 展開は latchCoverageOnHit() が「相手が打った瞬間」にだけ確定し、次に相手が
 * 打つまで development[side] に保持される。ここでは選手位置から再判定しない
 * （移動中に左右責任が入れ替わるのを防ぐため）。
 * =========================================================== */
export function getDevelopment(side) { return development[side]; }

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
