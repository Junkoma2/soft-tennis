import {
  TUNING, COURT, G,
  POINT_LABELS, POINTS_TO_WIN_GAME, FINAL_GAME_POINTS, GAMES_TO_WIN_MATCH,
  FORMATIONS, PLAYER_X_LIMIT, HIT_REACH, CPU_REACH, VOLLEY_REACH,
  SHOOT_FLAT_Z, CUT_SLICE_DEPTH, SHOT_FAMILY_ORDER, SHOT_FAMILY_META,
  TOSS_RISE_TIME, TOSS_HOLD_TIME, TOSS_BASE_Z, TOSS_APEX_Z,
  IDEAL_HIT_DELAY, LINE_IN_MARGIN, Y_RANGE_BACK, Y_RANGE_FRONT,
  W, H, applyViewport,
} from "./config.js";

import {
  project, unproject, clientToCanvas, clamp01, lerp, roundRect,
} from "./math.js";

import {
  screens, startBtn, retryBtn, canvas, ctx, messageOverlay, messageText,
  playerScoreEl, cpuScoreEl, playerGamesEl, cpuGamesEl, resultTitle, resultDetail,
  hintText, shotControls, chargeBtn, serveCategoryControls,
  aggressionControls, shotSelectControls, moveStick, moveStickKnob,
  formationControls, controlsPanel,
  mouseAim, makeStats, playerStats, cpuStats,
  state, player, cpu, serveFaults, rafId, lastTime, pendingSwing, matchTime,
  setState, setServeFaults, incServeFaults, setRafId, setLastTime, setPendingSwing, setMatchTime, addMatchTime,
  partnerAggressiveness, setPartnerAggressiveness,
  serveType, setServeType,
  serveAimCursor,
  selectedShot, setSelectedShot,
  cpuFrontPlan, playerFrontPlan, setCpuFrontPlan, setPlayerFrontPlan,
  playerPosition, formation, setPlayerPosition, setFormation,
  spectatorMode, setSpectatorMode,
  charge, aim, serveReady,
  receiveDone, setReceiveDone,
  cpuServePlan, setCpuServePlan,
  toss, makePlayer,
  back, front, cpuBack, cpuFront, ball,
  effects, setEffects,
  rallyControlled, pointJustServedByFront, cpuJustServedByFront,
  setRallyControlled, setPointJustServedByFront, setCpuJustServedByFront,
  receiverSideAssign,
  aiServePlan, setAiServePlan,
  lastHitInfo, setLastHitInfo,
  keysWasd, stick,
  spaceHeld, setSpaceHeld,
  ballHittableSince, setBallHittableSince,
  pendingShot, pendingPower, pendingAimX, pendingAimY,
  setPendingShot, setPendingPower, setPendingAimX, setPendingAimY,
  development,
} from "./state.js";

import { draw } from "./render.js";

import {
  serverTeamNow, serverIsSecondOfPair, serverIsFrontPlayer, serveFromRight,
  servePosition, serviceBox, resetServeAimCursor, clampServeAimCursor,
  incomingServeType, serveComesShort, assignReceiverSides, receiverPlayerFor,
  receivePosition, currentServer, playerIsServer, startServe, startToss,
  tossHeight, updateToss, serveContactQuality, playerServeAction,
  launchPlayerServe, pickServePlan, aiStartToss, aiLaunchServe,
  launchServeBall, serveFault, serveTypeForInput,
} from "./serve.js";

import {
  setControlledX, setControlledY, startCharge, updateAimInputs,
  distToBall, canPlayerHit, playerHitBall,
} from "./input.js";

import {
  updatePartner, updateRallyControlledAI, updateCpuBack, updateCpuFront,
  tryReturnAI, cpuTryReturn, partnerTryReturn,
} from "./ai.js";

export function resolveShotKey(family, contactZ, aimY) {
  if (family === "shoot") {
    return (contactZ != null && contactZ >= SHOOT_FLAT_Z) ? "flat" : "drive";
  }
  if (family === "cut") {
    // 狙いが未指定ならデフォルト狙い（深め）= スライス扱い
    const depth = (aimY != null) ? Math.abs(aimY) : TUNING.aim.defaultY;
    return depth >= CUT_SLICE_DEPTH ? "slice" : "drop";
  }
  return "lob";
}

// スマッシュ成立判定: ネット前（前衛域）で打点が高いと、球種選択に関わらず
// スマッシュ（速く鋭い下向きの決め球）になる。hitter のネットからの距離と
// 打点高さ contactZ で判定する。
export function isSmashContact(hitter, contactZ) {
  const sm = TUNING.smash;
  const netDist = Math.abs(hitter.y); // ネット(y=0)からの距離
  return contactZ >= sm.minZ && netDist <= sm.netDist;
}

// 前衛の作戦を確率で抽選（両チーム共通）。
export function pickFrontPlan() {
  const ai = TUNING.ai;
  const r = Math.random();
  if (r < ai.frontPoachChance) return "poach";
  if (r < ai.frontPoachChance + ai.frontGuardStraightChance) return "straight";
  if (r < ai.frontPoachChance + ai.frontGuardStraightChance + ai.frontMiddleChance) return "middle";
  return "base";
}

export function chargeAmount() {
  if (!charge.active) return 0;
  return Math.max(0, Math.min(1, (matchTime - charge.start) / TUNING.charge.maxTime));
}
export function updateMouseAimFromEvent(e) {
  const c = clientToCanvas(e.clientX, e.clientY);
  const w = unproject(c.sx, c.sy);
  if (w) { mouseAim.x = w.x; mouseAim.y = w.y; mouseAim.valid = true; }
}

/* ===========================================================
 * 画面・スコア表示
 * =========================================================== */

export function showScreen(name) {
  Object.values(screens).forEach((s) => (s.hidden = true));
  screens[name].hidden = false;
}

export function showMessage(text) {
  // インプレー（ラリー）中は画面中央の文字を出さない（ボレー/スマッシュ等の告知を抑制）。
  // ポイント/ゲーム/フォルト等は state が rally 以外になってから呼ばれるので表示される。
  if (state === "rally") return;
  messageText.textContent = text;
  messageOverlay.hidden = false;
}

// 操作パネルの表示切替: serve=サーブ設定（オーバー/アンダーのみ） / rally=球種選択
export function setControlMode(mode) {
  const serveMode = mode === "serve";
  if (serveCategoryControls) serveCategoryControls.hidden = !serveMode;
  // 攻守は観戦モードOFF かつ 得点間（サーブ前）にのみ調整可として表示する
  if (aggressionControls) aggressionControls.hidden = !serveMode || spectatorMode;
  shotSelectControls.hidden = serveMode;
  if (chargeBtn) {
    chargeBtn.textContent = serveMode ? "トス / 打つ" : "打つ";
  }
}

export function hideMessage() {
  messageOverlay.hidden = true;
}

export function isFinalGame() {
  return player.games === GAMES_TO_WIN_MATCH - 1 && cpu.games === GAMES_TO_WIN_MATCH - 1;
}

export function pointLabel(points, opponentPoints) {
  if (isFinalGame()) {
    return String(points); // ファイナルゲームは数字表示（7点先取・6-6デュース）
  }
  if (points >= 3 && opponentPoints >= 3) {
    if (points === opponentPoints) return "デュース";
    // デュース以降は常に1点差。劣勢側に実点数（4,5…）や固定の「3」を出すと
    // 点差を誤って読ませるため、アド/劣勢の関係だけを示す。
    return points > opponentPoints ? "アド" : "−";
  }
  return POINT_LABELS[Math.min(points, 3)];
}

export function updateScoreboard() {
  playerScoreEl.textContent = pointLabel(player.points, cpu.points);
  cpuScoreEl.textContent = pointLabel(cpu.points, player.points);
  playerGamesEl.textContent = player.games;
  cpuGamesEl.textContent = cpu.games;
}


/* ===========================================================
 * 試合進行
 * =========================================================== */

export function applyFormation() {
  const f = FORMATIONS[formation] || FORMATIONS["ganko"];
  back.homeX = f.back.x;  back.homeY = f.back.y;
  front.homeX = f.front.x; front.homeY = f.front.y;
}

export function startMatch() {
  player.points = 0; player.games = 0;
  cpu.points = 0; cpu.games = 0;
  setServeFaults(0);
  applyFormation();
  assignReceiverSides();
  setRallyControlled((playerPosition === "front") ? front : back);
  if (controlsPanel) controlsPanel.hidden = spectatorMode;
  if (moveStick) moveStick.hidden = spectatorMode;
  if (spectatorMode) {
    back.label = "後衛";
    front.label = "前衛";
    // 観戦モード: 両チーム同一能力（公平な対戦）
    cpuBack.stats = makeStats();
    cpuFront.stats = makeStats();
  } else {
    // 通常モード: CPU は意図的にやや弱く（プレイヤーが勝ちやすい）
    cpuBack.stats = makeStats({ power: 0.95, control: 0.90 });
    cpuFront.stats = makeStats({ volley: 0.7 });
    back.label = (playerPosition === "back") ? "あなた" : "相方";
    front.label = (playerPosition === "front") ? "あなた" : "相方";
  }
  updateScoreboard();
  showScreen("game");
  // ゲーム画面が表示されてレイアウトが確定してから描画領域に合わせて同期する。
  requestAnimationFrame(syncViewport);
  startServe(true);
}


// 操作キャラは試合を通じて固定（ポジション選択で決まる）。
// 相方の番のサーブはAIが自動で打つ。

export function resetPlayersForPoint() {
  const team = serverTeamNow();
  const frontServes = serverIsFrontPlayer();
  const sp = servePosition(team);
  setPointJustServedByFront((team === "player" && frontServes));
  setCpuJustServedByFront((team === "cpu" && frontServes));

  // 全員いったん定位置へ
  back.x = back.homeX;  back.y = back.homeY;
  front.x = front.homeX; front.y = front.homeY;
  cpuBack.x = cpuBack.homeX; cpuBack.y = cpuBack.homeY;
  cpuFront.x = cpuFront.homeX; cpuFront.y = cpuFront.homeY;

  if (team === "player") {
    const server = frontServes ? front : back;
    server.x = sp.x; server.y = sp.y;
    if (frontServes) {
      // パートナー（後衛）はダブル後衛的にベースライン中央寄りへ
      back.x = -sp.x * 0.5; back.y = Math.max(back.homeY, 11.6);
    }
    // レシーブは「そのサーブが入る側を1ゲーム担当するレシーバー」が受ける
    const rp = receivePosition("cpu");
    const receiver = receiverPlayerFor("cpu");
    receiver.x = rp.x; receiver.y = rp.y;
  } else {
    const server = frontServes ? cpuFront : cpuBack;
    server.x = sp.x; server.y = sp.y;
    if (frontServes) { cpuBack.x = -sp.x * 0.6; cpuBack.y = -11.5; }
    const rp = receivePosition("player");
    const receiver = receiverPlayerFor("player");
    receiver.x = rp.x; receiver.y = rp.y;
  }

  // 前衛は逆サイドに寄る（雁行陣のみ）。サーブする本人はその限りでない。
  // レシーブ役の前衛にはこのサイド寄せを適用しない（レシーブ位置を上書きしてしまうため）。
  const sideSign = serveFromRight() ? 1 : -1;
  const fx = TUNING.pos.frontSideX;
  const receivingTeam = team === "player" ? "cpu" : "player";
  const recv = receiverPlayerFor(receivingTeam);
  if (formation === "ganko" && front !== recv && !(team === "player" && frontServes)) {
    front.x = -fx * sideSign;
  }
  if (cpuFront !== recv && !(team === "cpu" && frontServes)) cpuFront.x = fx * sideSign;

  // レシーブ側チームで、後衛が「そのポイントのレシーバーでない」場合
  // （＝前衛が受ける番）、後衛をホームのセンター(x=0)に残さず、
  // 自分のクロス側（receiverSideAssignのback符号）の後方に構えさせる。
  const halfWX = COURT.singlesHalfW / 2;
  if (receivingTeam === "player" && back !== recv) {
    back.x = receiverSideAssign.player.back * halfWX;
    back.y = TUNING.pos.receiveOverBackY;
  }
  if (receivingTeam === "cpu" && cpuBack !== recv) {
    cpuBack.x = receiverSideAssign.cpu.back * halfWX;
    cpuBack.y = -TUNING.pos.receiveOverBackY;
  }

  ball.vx = 0; ball.vy = 0; ball.vz = 0;
  ball.bounces = 0;
  ball.serving = false;
  ball.spin = "flat";
  ball.spinMag = 1;
  ball.trailColor = "#DFFF4F";
  ball.trail = [];
  setPendingSwing(0);
  charge.active = false;
  charge.source = null;
  serveAimCursor.set = false; // サーブ狙いカーソルは初回参照時にサービスコート中央へ
  setCpuFrontPlan("base");
  setReceiveDone(false);
  serveReady.timer = 0;
  serveReady.still = 0;
  serveReady.ready = false;
  toss.active = false;
  toss.t = 0;
  [back, front, cpuBack, cpuFront].forEach((p) => {
    p.pose = "idle"; p.swingT = 0; p.recoverT = 0;
    p.swingSideLocked = false; p.wrapCommitted = false; p.wrapTargetX = null;
    p.approachTargetX = null;
  });
}


/* ---- 物理: ターゲットに1バウンド目が落ちる初速を球速から逆算 ---- */
export function launchBall(fromX, fromY, fromZ, tx, ty, speed) {
  // ワープ防止: 打者位置(fromX/fromY)へボールを瞬間移動させず、ボールの
  // 「実際の現在位置」から発射する。打球判定はリーチ(HIT_REACH)内で成立する
  // ため、ボールが打者から離れた位置にあるまま代入すると横に飛ぶ＝ワープして
  // 見えた。現在位置を始点にすることで前フレームから連続して遷移する。
  // サーブ構え中などボールが未投入のときは渡された位置にフォールバックする。
  const ballLive = state === "rally" || state === "serve-toss";
  const startX = ballLive ? ball.x : fromX;
  const startY = ballLive ? ball.y : fromY;
  const startZ = ballLive ? Math.max(0.3, ball.z) : fromZ;
  const dist = Math.max(1.0, Math.hypot(tx - startX, ty - startY));
  const T = dist / speed;
  ball.x = startX; ball.y = startY; ball.z = startZ;
  ball.vx = (tx - startX) / T;
  ball.vy = (ty - startY) / T;
  ball.vz = (0.5 * G * T * T - startZ) / T;
  // 球の高さにわずかなランダムブレを加えて自然にする
  ball.vz += (Math.random() - 0.5) * TUNING.jitter.z;
  ball.bounces = 0;
  ball.trail = [];
  ball.originX = startX;
  ball.originY = startY;
  ball.lastHitTime = matchTime;
}

// ネット通過時の高さ（届かない場合はnull）
export function netClearance(fromX, fromY, fromZ, tx, ty, speed) {
  const dist = Math.max(1.0, Math.hypot(tx - fromX, ty - fromY));
  const T = dist / speed;
  const vy = (ty - fromY) / T;
  if (Math.abs(vy) < 0.01) return null;
  const tn = (0 - fromY) / vy;
  if (tn < 0 || tn > T * 1.5) return null;
  const vz = (0.5 * G * T * T - fromZ) / T;
  return fromZ + vz * tn - 0.5 * G * tn * tn;
}

/* ===========================================================
 * 打球（ストローク・ボレー共通）
 *
 * 球種は選択式の5種（TUNING.shots: flat/drive/slice/drop/lob）。
 * プレイヤーの狙いは「着地点カーソル」（aimX/aimY・ワールド座標）で、
 * AIの打球は course（-1..1）で決める。
 *
 * プレイヤーの打球は「実際の打点位置」で球質が決まる:
 *   - 体の横の距離: 詰まるほど引っ張り方向の角度がつかなくなり、
 *     球速も落ちる（方向は消えず、許容角度の幅が狭くなるだけ）
 *   - 前後: 前すぎ=引っ張り強・低弾道、後ろ=流し強・弱い球
 *   - 高さ: 高い=速く低弾道 / 低い=すくい上げで弾道が上がる
 *   - 打点が悪いほど狙いが散らばる（ミスが出る）
 * ためた時間が長いほど鋭い角度を狙え、球速も少し上がる。
 * =========================================================== */


// フォア/バック判定: 利き腕（handedness）基準。
// ソフトテニス（硬式と同様）はフォアハンドを体の正面では打てない。
// 体の正面〜利き手と逆側に来た打点はバックハンド、利き手側に来た打点だけがフォアになる。
//   foreDir: そのヒッターから見て「フォア側」が画面上どちら向きか。
//     右利き: プレイヤー(facing=-1)は画面右(+1)、CPU(facing=1)は画面左(-1)。
//     左利きは利き腕側が反転するため、その鏡像になる（render.jsのforeDir計算と同じ式）。
//   ボールの位置がヒッターから見て foreDir 側に十分はみ出していなければ
//   （＝体の正面〜逆側）バックハンド、foreDir側に出ていればフォアハンド。
export function isBackhandFor(side, hitter, ballX) {
  const facingDir = side === "player" ? 1 : -1;
  const handSign = hitter.stats && hitter.stats.handed === "left" ? -1 : 1;
  const foreDir = facingDir * handSign;
  const diff = (ballX - hitter.x) * foreDir;
  // diff > しきい値（=利き手側に十分はみ出している）のときだけフォア。
  // 体の正面（diffが小さい）・逆側（diffが負）はバックハンド。
  return diff <= 0.1;
}

// 狙い（ワールドx）とヒッターの立ち位置から表示用の呼び名を決める
export function courseLabelFor(hitterX, targetX) {
  const dx = targetX - hitterX;
  if (Math.abs(dx) < 1.2) return "まっすぐ";
  if (Math.abs(hitterX) < 0.6) return dx < 0 ? "左へ！" : "右へ！";
  const isCross = (hitterX > 0) === (dx < 0); // 立ち位置と逆へ打つ=クロス
  return isCross ? "クロス！" : "ストレート！";
}

/* ---- 打点の評価: 横距離・前後・高さ → 角度幅/球速/精度の係数 ---- */
export function evaluateContact(side, hitter, contactZ) {
  const c = TUNING.contact;
  const backhand = isBackhandFor(side, hitter, ball.x);
  const facingDir = side === "player" ? 1 : -1;
  const handSign = hitter.stats && hitter.stats.handed === "left" ? -1 : 1;
  const foreSign = facingDir * handSign;             // フォア側のx方向（利き腕を反映）
  const sideSign = backhand ? -foreSign : foreSign;  // 打点がある側のx方向
  const lateral = (ball.x - hitter.x) * sideSign;    // 体から打点までの横距離(m)
  // フォアはバックより少し体から離れた位置が適正打点（idealLateralFor参照）。
  const idealLateral = backhand ? c.idealLateral : c.idealLateralFore;

  // 詰まり度: 1=適正 〜 0=完全に詰まり
  const cramp = clamp01((lateral - c.minLateral) / (idealLateral - c.minLateral));
  // 泳ぎ度: 打点が遠すぎる（0=問題なし 〜 1=届くだけ）
  const overReach = clamp01((lateral - idealLateral - c.reachSlack) / c.reachRange);

  // 前後: 正=前すぎ（ネット寄り） / 負=後ろすぎ
  const frontDist = (hitter.y - ball.y) * (side === "player" ? 1 : -1);
  const front = Math.max(-1, Math.min(1, (frontDist - c.frontYIdeal) / c.yTolerance));

  // 高さ: 正=高い打点（強打ゾーン） / 負=低い打点（すくい上げ）
  let heightK = 0;
  if (contactZ > c.idealZHigh) heightK = clamp01((contactZ - c.idealZHigh) / 1.0);
  else if (contactZ < c.idealZLow) heightK = -clamp01((c.idealZLow - contactZ) / c.idealZLow);

  // 引っ張り/流しの方向（右利き想定）:
  //   フォアの引っ張り=体の逆側へ（プレイヤーのフォアなら画面左）、流し=打点側へ
  //   左利きはフォア/バックの体の向きが反転するため符号を反転させる（handSignは上で算出済み）
  const pullSign = -sideSign * handSign;
  const flowSign = sideSign * handSign;

  // 角度幅の倍率: 詰まるほど引っ張りはほぼ真っ直ぐのみ、流しは比較的残る
  let pullMul = lerp(c.pullCrampMin, 1, cramp);
  let flowMul = lerp(c.flowCrampMin, 1, cramp);
  // 前すぎ: 引っ張りが強くなり流しの角度がつかない / 後ろ: その逆
  if (front > 0) {
    pullMul = Math.min(1.25, pullMul * (1 + c.frontPullBoost * front));
    flowMul *= 1 - c.frontFlowDrop * front;
  } else if (front < 0) {
    flowMul = Math.min(1.25, flowMul * (1 + c.backFlowBoost * -front));
    pullMul *= 1 - c.backPullDrop * -front;
  }
  // 泳いだら両方向とも角度がつかない
  const reachMul = 1 - c.reachAngleDrop * overReach;
  pullMul *= reachMul;
  flowMul *= reachMul;

  // 球速倍率
  let speedMul = backhand ? c.backhandPower : 1;
  speedMul *= 1 - c.crampSpeedDrop * (1 - cramp);     // 詰まると返すだけの球質
  speedMul *= 1 - c.reachSpeedDrop * overReach;
  if (heightK > 0) speedMul *= 1 + c.highZBonus * heightK;       // 高い打点=速く低弾道
  else if (heightK < 0) speedMul *= 1 - c.lowZLoft * -heightK;   // 低い打点=遅く山なり
  if (front > 0) speedMul *= 1 + c.frontSpeedBoost * front;
  else if (front < 0) speedMul *= 1 - c.backSpeedDrop * -front;

  // 総合品質 → 散らばり（ミス率）
  const overall = cramp
    * (1 - 0.5 * overReach)
    * (1 - 0.25 * Math.abs(front))
    * (1 - 0.2 * Math.abs(heightK));
  const sigma = c.sigmaBase + c.sigmaBad * (1 - overall);

  // 前後ズレで打球が自然に流れる方向（前=引っ張り側 / 後ろ=流し側）
  const driftX = pullSign * c.driftFront * Math.max(0, front)
    + flowSign * c.driftBack * Math.max(0, -front);

  return {
    backhand: backhand, cramp: cramp, overReach: overReach,
    front: front, heightK: heightK,
    pullSign: pullSign, flowSign: flowSign,
    pullMul: pullMul, flowMul: flowMul,
    speedMul: speedMul, sigma: sigma, driftX: driftX, overall: overall,
  };
}


export function hitBall(opts) {
  const side = opts.side;
  const hitter = opts.hitter;
  const stats = hitter.stats;
  const chargeK = Math.max(0, Math.min(1, opts.charge || 0));
  const contactZ = opts.contactZ != null ? opts.contactZ : ball.z;
  // 系統（shoot/cut/lob）が来たら打点高さ・狙いの深さで内部の5種へ振り分ける。
  // カットは着地カーソルの深さで slice/drop が連続的に決まる（ため分岐は廃止）。
  // AIや旧来の直接指定（flat/drive/...）はそのまま使う。
  let shotKey;
  if (SHOT_FAMILY_ORDER.indexOf(opts.shot) >= 0) {
    shotKey = resolveShotKey(opts.shot, contactZ, opts.aimY);
  } else {
    shotKey = TUNING.shots[opts.shot] ? opts.shot : "drive";
  }
  // スマッシュ自動判定: ネット前で高い球を捉えたら球種選択に関わらずスマッシュへ。
  // ロブ選択は意図的な高弾道なので対象外（前衛が高い球をロブで逃がせる）。
  const isSmash = opts.shot !== "lob" && isSmashContact(hitter, contactZ);
  if (isSmash) shotKey = "smash";
  const def = TUNING.shots[shotKey];
  const backhand = isBackhandFor(side, hitter, ball.x);
  const depthDir = side === "player" ? -1 : 1;
  const fromZ = Math.max(0.3, Math.min(contactZ, 2.3));

  let tx, ty, speed, sigma;
  let ev = null;

  if (opts.byPlayer) {
    // プレイヤー操作: 着地点カーソル（aimX/aimY）を狙う。
    // ただし打点品質による角度幅制限がかかり、詰まったときに
    // 鋭い角度を狙っても浅い角度（体の正面寄り）に補正される
    ev = evaluateContact(side, hitter, contactZ);
    const aimX = opts.aimX != null ? opts.aimX : 0;
    const desired = aimX - hitter.x;
    const angleSpan = TUNING.contact.maxAngle
      * (1 + TUNING.charge.angleBonus * chargeK); // ためが長いほど鋭い角度
    const dirSign = desired >= 0 ? 1 : -1;
    const mul = (dirSign === ev.pullSign) ? ev.pullMul : ev.flowMul;
    const maxOffset = angleSpan * mul;
    tx = hitter.x + Math.max(-maxOffset, Math.min(maxOffset, desired)) + ev.driftX;
    ty = opts.aimY != null
      ? Math.max(-(COURT.halfL - 0.4), Math.min(-TUNING.aim.minDepth, opts.aimY))
      : depthDir * (def.depthMin + Math.random() * def.depthRange);
    speed = def.speed * stats.power * ev.speedMul
      * (1 + TUNING.charge.speedBonus * chargeK);
    sigma = ev.sigma / Math.min(Math.max(stats.control, 0.5), 1.3);
  } else {
    // AI: コース(-1..1)からそのまま目標を決める
    const course = Math.max(-1, Math.min(1, opts.course || 0));
    const accuracy = (backhand ? 0.7 : 1.0) * Math.min(stats.control, 1.3);
    tx = course * 3.5;
    sigma = 0.45 + 1.0 * Math.max(0, 1.1 - accuracy);
    speed = def.speed * stats.power * (backhand ? 0.9 : 1.0)
      * (1 + TUNING.charge.speedBonus * chargeK);
    // cpuSpeedScale は廃止（両チーム共通パラメータで対称化済み）
    ty = depthDir * (def.depthMin + Math.random() * def.depthRange);
  }

  // ドロップは横へ散らさずネット際を狙う（プレイヤーはカーソルを尊重）
  if (shotKey === "drop") {
    if (!opts.byPlayer) tx = hitter.x + (tx - hitter.x) * 0.35;
    sigma *= 0.6;
  }

  // 散らばり + 自然なブレ
  tx += (Math.random() - 0.5) * 2 * sigma;
  ty += (Math.random() - 0.5) * 2 * sigma * 0.8 + (Math.random() - 0.5) * 2 * TUNING.jitter.x;
  tx = Math.max(-6.5, Math.min(6.5, tx)); // コート外もあり得る（ミス）

  // CPUは時々凡ミスする（初心者でもポイントが取れる難易度調整）。
  // 観戦モード（AI対AI）では公平性のため無効。
  if (side === "cpu" && !spectatorMode && Math.random() < 0.04) {
    if (Math.random() < 0.5) {
      tx = (tx >= 0 ? 1 : -1) * (COURT.halfW + 0.6 + Math.random() * 1.2); // サイドアウト
    } else {
      ty = depthDir * (COURT.halfL + 0.8 + Math.random() * 1.5);           // ベースラインオーバー
    }
  }

  speed = Math.max(4.0, speed);

  // ネット越えアシスト: 打点が悪いときは補正なし（ネットのリスクが残る）
  const assist = shotKey !== "drop" && (!ev ? true : ev.overall > 0.35);
  if (assist) {
    let tries = 0;
    while (tries < 5) {
      const clr = netClearance(hitter.x, hitter.y, fromZ, tx, ty, speed);
      if (clr === null || clr > COURT.netH + 0.25) break;
      speed *= 0.93;
      tries++;
    }
  }

  ball.spin = def.spin;
  ball.spinMag = def.spinMag;
  ball.trailColor = def.color;
  ball.lastHitter = side;
  ball.serving = false;
  ball.frontChecked = (side === "cpu") ? false : true;
  ball.cpuFrontChecked = (side === "player") ? false : true;
  setReceiveDone(true); // サーブ以外の打球が出た=レシーブ完了（前衛が動き出せる）
  launchBall(hitter.x, hitter.y, fromZ, tx, ty, speed);

  // 打球を受ける側チームの前衛に作戦を抽選する（両チーム対称）。
  // player が打つ→相手(cpu)前衛、cpu が打つ→味方(player)前衛。
  // 味方前衛のポーチは観戦モードでのみ自走（人間モードは partnerAggressiveness 側で制御）。
  if (side === "player") {
    setCpuFrontPlan(pickFrontPlan());
    setPlayerFrontPlan("base");
  } else {
    setCpuFrontPlan("base");
    setPlayerFrontPlan(spectatorMode ? pickFrontPlan() : "base");
  }

  // 見た目（フォア/バックのポーズ・ラケット軌道）は、ready/prep時点で
  // すでに固定済み（swingSideLocked）なら hitter.swingSide を最優先で使う。
  // ここで isBackhandFor を再評価すると、ready固定後にボールが動いて
  // インパクト時の判定が変わり「打つ直前にバックへ転ぶ」ちらつきになるため、
  // 球速/角度計算用の backhand（評価ロジック）とは別に見た目用は再計算しない。
  // ready/prepを経由しないヒッター（AIの前衛/後衛/パートナー等）は
  // ロックされていないので、その場の backhand 判定をそのまま使う。
  const visualSide = hitter.swingSideLocked ? hitter.swingSide : (backhand ? "back" : "fore");
  startSwing(hitter, visualSide);

  // スマッシュは決め球として大きく告知（プレイヤー・AI前衛とも）
  if (isSmash) {
    effects.push({
      type: "text",
      x: hitter.x, y: hitter.y - 0.6, t: 0, ttl: 0.8,
      text: "スマッシュ！",
      color: "#F43F5E",
    });
  }

  setLastHitInfo({
    side: side, shot: shotKey, course: opts.course != null ? opts.course : null,
    aimX: opts.aimX != null ? opts.aimX : null,
    aimY: opts.aimY != null ? opts.aimY : null,
    tx: tx, ty: ty, speed: speed, byPlayer: !!opts.byPlayer,
    contact: ev,
  });

  // 打球時のフィードバック表示（コース + 打点品質）
  if (opts.byPlayer && side === "player" && hitter === rallyControlled) {
    effects.push({
      type: "text",
      x: hitter.x, y: hitter.y, t: 0, ttl: 0.7,
      text: courseLabelFor(hitter.x, tx),
      color: "#10B981",
    });
    let qualityText = null;
    let qualityColor = "#F59E0B";
    if (ev.cramp < 0.35) { qualityText = "詰まった！"; }
    else if (ev.overReach > 0.5) { qualityText = "泳いだ！"; }
    else if (ev.overall > 0.85) { qualityText = "ジャスト！"; qualityColor = "#22C55E"; }
    else if (ev.backhand) { qualityText = "バック"; qualityColor = "#F59E0B"; }
    if (qualityText) {
      effects.push({
        type: "text",
        x: hitter.x, y: hitter.y - 0.9, t: 0, ttl: 0.8,
        text: qualityText,
        color: qualityColor,
      });
    }
  }
}

// このプレイヤーが今すぐ次の打球（スイング/ボレー含む）を打てるかどうか。
// スイング中（pose==="swing"）、またはフォロースルー後の構え直し中（recoverT>0）は打てない。
// プレイヤー操作・AI（味方/相方/CPU）の両方からの打球判定で共通して使う。
export function canSwingNow(p) {
  if (!p) return true;
  return p.pose !== "swing" && !(p.recoverT > 0);
}

export function startSwing(p, side) {
  p.pose = "swing";
  p.swingSide = side;
  p.swingSideLocked = false; // スイング種別は確定済み。以降は固定不要（次のreadyで再ロックされる）
  p.swingT = TUNING.tempo.swingDuration;
  p.recoverT = 0;
}

// 現在速度cur を 目標速度target へ、加速度(accel)/減速度(decel)で dt 秒分だけ近づける。
// 目標へ向かう（加速）か遠ざかる/止める（減速）かでレートを切り替える＝軽い慣性。
export function approachVelocity(cur, target, dt) {
  const accel = TUNING.move.accel;
  const decel = TUNING.move.decel;
  // 目標と同方向に伸ばす（加速）か、0または反対方向へ寄せる（減速）かを判定
  const accelerating = Math.abs(target) > Math.abs(cur) && Math.sign(target) === Math.sign(cur || target);
  const rate = accelerating ? accel : decel;
  const diff = target - cur;
  const maxStep = rate * dt;
  if (Math.abs(diff) <= maxStep) return target;
  return cur + Math.sign(diff) * maxStep;
}

/* ===========================================================
 * 得点処理
 * =========================================================== */

export function awardPoint(toPlayer, reason) {
  if (state === "point" || state === "gameset" || state === "matchend") return;
  if (toPlayer) player.points++;
  else cpu.points++;
  setServeFaults(0);

  const winPts = isFinalGame() ? FINAL_GAME_POINTS : POINTS_TO_WIN_GAME;
  const pP = player.points;
  const cP = cpu.points;
  if (pP >= winPts && pP - cP >= 2) { finishGame(true); return; }
  if (cP >= winPts && cP - pP >= 2) { finishGame(false); return; }

  updateScoreboard();
  setState("point");
  showMessage((toPlayer ? "ポイント！" : "相手のポイント") + (reason ? "\n" + reason : ""));
  setTimeout(function () {
    if (state === "point") startServe(false);
  }, TUNING.tempo.pointDelay);
}

export function finishGame(playerWon) {
  if (playerWon) player.games++;
  else cpu.games++;
  player.points = 0;
  cpu.points = 0;
  updateScoreboard();

  if (player.games >= GAMES_TO_WIN_MATCH || cpu.games >= GAMES_TO_WIN_MATCH) {
    setState("matchend");
    showMessage(playerWon ? "ゲーム獲得！" : "ゲームを落とした");
    setTimeout(function () {
      endMatch(player.games >= GAMES_TO_WIN_MATCH);
    }, TUNING.tempo.gameDelay);
    return;
  }

  setState("gameset");
  // ゲームをまたぐ（サーブ権交代）→ レシーブ受け持ちを再設定
  assignReceiverSides();
  showMessage(playerWon ? "ゲーム獲得！" : "ゲームを落とした");
  setTimeout(function () {
    if (state === "gameset") startServe(true);
  }, TUNING.tempo.gameDelay);
}

export function endMatch(playerWon) {
  cancelAnimationFrame(rafId);
  setRafId(null);
  showScreen("result");
  if (playerWon) {
    resultTitle.textContent = "WIN!";
    resultTitle.className = "result-title is-win";
    resultDetail.textContent = player.games + " - " + cpu.games + " で勝利しました";
  } else {
    resultTitle.textContent = "LOSE...";
    resultTitle.className = "result-title is-lose";
    resultDetail.textContent = player.games + " - " + cpu.games + " で敗れました";
  }
}


/* ===========================================================
 * バウンド・ラリー判定
 * =========================================================== */

// オンザライン（ライン上）はイン。ボール半径＋ライン幅相当の余裕を持たせ、
// 着地点がラインに掛かっていればインと判定する。

export function insideCourt(x, y) {
  return Math.abs(x) <= COURT.halfW + LINE_IN_MARGIN && Math.abs(y) <= COURT.halfL + LINE_IN_MARGIN;
}

export function insideBox(x, y, box) {
  var m = LINE_IN_MARGIN;
  return x >= box.x1 - m && x <= box.x2 + m && y >= box.y1 - m && y <= box.y2 + m;
}

export function handleBounce() {
  ball.z = 0;
  ball.bounces++;
  ball.flashT = 0.22;
  effects.push({ type: "ripple", x: ball.x, y: ball.y, t: 0, ttl: 0.45 });

  const hitterIsPlayer = ball.lastHitter === "player";

  if (ball.bounces === 1) {
    if (ball.serving) {
      const box = serviceBox(ball.lastHitter);
      if (insideBox(ball.x, ball.y, box)) {
        ball.serving = false; // サービスイン → そのままラリーへ
      } else {
        serveFault("サービスコートに入らなかった");
        return;
      }
    } else if (!insideCourt(ball.x, ball.y)) {
      awardPoint(!hitterIsPlayer, hitterIsPlayer ? "アウト" : "相手のアウト");
      return;
    }
  } else if (ball.bounces >= 2) {
    // ツーバウンドはボールが落ちた側のコートのチームが失点
    awardPoint(ball.y < 0, "ツーバウンド");
    return;
  }

  // 反発は回転の種類と強さで変わる:
  //   slice: 止まる・低く滑る / drive: 食い込んで伸びる / flat: 中間
  //   spinMagが大きいほど flat からの差が強調される
  const sp = TUNING.spin[ball.spin] || TUNING.spin.flat;
  const flat = TUNING.spin.flat;
  const k = Math.min(1.3, Math.max(0, ball.spinMag != null ? ball.spinMag : 1));
  const friction = Math.max(0.3, Math.min(0.97, flat.friction + (sp.friction - flat.friction) * k));
  const restitution = Math.max(0.12, Math.min(0.78, flat.restitution + (sp.restitution - flat.restitution) * k));
  ball.vz = -ball.vz * restitution;
  ball.vx *= friction;
  ball.vy *= friction;
}

export function checkNet(prevY, prevZ) {
  if ((prevY > 0) === (ball.y > 0)) return false;
  // ネット面通過時の高さを補間。フレーム終端のball.zではなく、
  // 通過前後の高さを同じ係数で補間しないと、速い・低い球で「越えたのに
  // 落下中だからネット接触」と誤判定される。
  const t = prevY / (prevY - ball.y);
  const zAt = prevZ + (ball.z - prevZ) * t;
  if (zAt < COURT.netH && Math.abs(ball.x) < COURT.halfW + 0.4) {
    const hitterIsPlayer = ball.lastHitter === "player";
    if (ball.serving) {
      serveFault("ネット");
    } else {
      awardPoint(!hitterIsPlayer, hitterIsPlayer ? "ネット" : "相手のネット");
    }
    return true;
  }
  return false;
}

// 現在の速度から次の着地点を予測
export function predictLanding() {
  const vz = ball.vz;
  const z = Math.max(ball.z, 0);
  const t = (vz + Math.sqrt(vz * vz + 2 * G * z)) / G;
  if (!isFinite(t) || t <= 0) return null;
  return { x: ball.x + ball.vx * t, y: ball.y + ball.vy * t, t: t };
}

// バウンド後にボールが最も高くなる点（頂点）を、球種(スピン)の反発・摩擦と
// 速さから予測する。後衛はこの点に構えると最も高い打点で打てる。
//   slice: 反発小→低く滑る（頂点は低く、手前寄り）
//   drive/flat: 反発大→高く弾む（頂点が高く、奥寄り）
export function predictHighContact() {
  const L = predictLanding();
  if (!L) return null;
  const vzLand = Math.abs(ball.vz - G * L.t); // 着地時の落下速度の大きさ
  const sp = TUNING.spin[ball.spin] || TUNING.spin.flat;
  const flat = TUNING.spin.flat;
  const k = Math.min(1.3, Math.max(0, ball.spinMag != null ? ball.spinMag : 1));
  const friction = Math.max(0.3, Math.min(0.97, flat.friction + (sp.friction - flat.friction) * k));
  const restitution = Math.max(0.12, Math.min(0.78, flat.restitution + (sp.restitution - flat.restitution) * k));
  const vzOut = vzLand * restitution;       // バウンド後の上向き初速
  const tApex = vzOut / G;                   // 頂点までの時間
  return {
    x: L.x + ball.vx * friction * tApex,     // 頂点でのx（横速度はバウンドで friction 倍）
    y: L.y + ball.vy * friction * tApex,     // 頂点でのy
    apexZ: (vzOut * vzOut) / (2 * G),         // バウンド頂点の高さ
    landing: L,
  };
}

// フォア/バック表示判定（swingSide）に使う「予測打点のx」。
// その瞬間のball.xだけで判定すると、双方が動く間にしきい値をまたいで
// 毎フレーム反転する（ちらつき）ため、軌道の行き先（バウンド後の頂点）を
// 基準にする。バウンド前は predictHighContact（高い打点で迎える設計）→
// predictLanding の順に使い、どちらも得られなければ ball.x にフォールバックする。
// バウンド後（ball.bounces>=1）は着地点の予測が出しづらいため、現在位置に
// ボールの横移動の向きを少し加味した近い将来位置（0.15秒先）を使う。
export function predictedContactX() {
  if (ball.bounces >= 1) {
    return ball.x + ball.vx * 0.15;
  }
  const hc = predictHighContact();
  if (hc) return hc.x;
  const landing = predictLanding();
  if (landing) return landing.x;
  return ball.x;
}


/* ===========================================================
 * メインループ
 * =========================================================== */

// 現在の移動入力を得る。確定操作: 移動=WASD（左手）専用。
// 狙い（着地カーソル/サーブ狙い）はマウス/スワイプが担当し、移動とは独立。
// スマホは左スティックが常に移動専用（狙いはコート上のスワイプに一本化）。
export function inputVector() {
  let dx = 0, dy = 0;
  if (keysWasd.left) dx -= 1;
  if (keysWasd.right) dx += 1;
  if (keysWasd.up) dy -= 1;   // 上/Wはネット方向（yが減る）
  if (keysWasd.down) dy += 1; // 下/Sは自陣ベースライン方向（yが増える）
  if (stick.active) {
    dx += stick.dx;
    dy += stick.dy; // スティック下方向 = 自陣ベースライン方向
  }
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  return { dx: dx, dy: dy };
}

// サーブ前、サーバー以外の3人（両前衛・レシーバー）が所定位置へ到達したか。
// 各自の目標は AI 移動と同じ定位置。サーバーは既にサーブ位置にいる前提。
export function nonServerPlayersInPosition() {
  const server = currentServer();
  const tol = 0.6; // 到達とみなす許容距離(m)
  // 人が操作するキャラ（rallyControlled）は自由移動なので位置判定の対象外。
  //   サーバー本人も既にサーブ位置にいるので対象外。
  // 残りの AI が自動で定位置へ到達したかだけを見る。
  const targets = [];
  const sideSign = serveFromRight() ? 1 : -1;
  const fx = TUNING.pos.frontSideX;
  const skip = function (p) { return p === server || p === rallyControlled; };
  // レシーブ側のレシーバー（割り当てられた1人）は受け持ち側のレシーブ位置で待つ。
  const recvTeam = serverTeamNow() === "player" ? "cpu" : "player";
  const receiver = receiverPlayerFor(recvTeam);
  const rp = receivePosition(recvTeam);
  if (!skip(receiver)) targets.push({ p: receiver, x: rp.x, y: rp.y });
  // 前衛（レシーバーでなければ）逆サイド寄りの定位置
  if (front !== receiver && !skip(front))       targets.push({ p: front,    x: -fx * sideSign, y: front.homeY });
  if (cpuFront !== receiver && !skip(cpuFront))  targets.push({ p: cpuFront, x: fx * sideSign,  y: cpuFront.homeY });
  return targets.every(function (t) {
    return Math.hypot(t.p.x - t.x, t.p.y - t.y) <= tol;
  });
}

/* ---- サーブ前の全員準備管理（確定セオリー） ----
 * 味方・相手を含む全員（4人）が定位置の準備を整えるまでサーブを始めない。
 *   サーバーは既にサーブ位置。残り3人（両前衛・レシーバー）の到達と、
 *   レシーブ側の静止/猶予を満たして初めて serveReady.ready=true。
 * CPUサーブ: プレイヤー（レシーブ側）が静止し全員整列するまで打たない。
 * 相方サーブ / プレイヤーサーブ: AIの準備時間（aiReady）＋全員整列を待つ。 */
export function updateServeReady(dt) {
  const cfg = TUNING.serveReady;
  serveReady.timer += dt;
  if (serveReady.ready) return;
  const team = serverTeamNow();
  const allInPosition = nonServerPlayersInPosition();
  // maxWait を超えたら整列が崩れていても進める（ハマり防止）
  const timedOut = serveReady.timer >= cfg.maxWait;
  if (team === "cpu") {
    const v = inputVector();
    const moving = v.dx !== 0 || v.dy !== 0 || stick.active;
    serveReady.still = moving ? 0 : serveReady.still + dt;
    const receiverReady = serveReady.still >= cfg.stillTime;
    if (serveReady.timer >= cfg.minShow &&
        ((receiverReady && allInPosition) || timedOut)) {
      serveReady.ready = true;
      hintText.textContent = "全員準備OK！相手がサーブを打つ";
      aiStartToss("cpu");
    }
  } else if (!playerIsServer() || spectatorMode) {
    if ((serveReady.timer >= cfg.aiReady && allInPosition) || timedOut) {
      serveReady.ready = true;
      aiStartToss("player");
    }
  } else {
    if ((serveReady.timer >= cfg.aiReady && allInPosition) || timedOut) {
      serveReady.ready = true;
      hintText.textContent = "全員準備OK。クリックでトス。マウスで狙う場所を指す";
    }
  }
}

export function update(dt) {
  addMatchTime(dt);

  // サーブの構え中: レシーバーの準備が整ってからサーブが始まる
  if (state === "serve-stance") {
    updateServeReady(dt);
  }

  // 移動操作: サーブの構え/トス中は自分がサーバーのときのみ、ラリー中は rallyControlled
  // 観戦モードでは rallyControlled も AI が動かすため人間操作の mover は立てない
  let mover = null;
  if (!spectatorMode) {
    if (state === "serve-stance" || state === "serve-toss") {
      if (playerIsServer()) mover = currentServer();
    } else if (state === "rally") {
      mover = rallyControlled;
    }
  }

  // ため中のマウス/スティック（着地点カーソル）とトス中のマウス（狙い）を反映
  updateAimInputs(dt);

  if (mover) {
    const v = inputVector();
    const charging = charge.active && state === "rally";
    const slow = charging ? TUNING.charge.moveSlow : 1;
    const speed = TUNING.move.playerSpeed * mover.stats.speed * slow;
    const allowY = state !== "serve-toss" && state !== "serve-stance";
    // 目標速度（入力ベクトル*速度）へ軽い加減速で滑らかに追従させる（慣性）。
    // 入力なしの軸は目標0へ減速で止まる。最高速にはすぐ乗る軽さに留める。
    const targetVx = v.dx * speed;
    const targetVy = allowY ? v.dy * speed : 0;
    mover.vx = approachVelocity(mover.vx, targetVx, dt);
    mover.vy = approachVelocity(mover.vy, targetVy, dt);
    if (mover.vx !== 0) setControlledX(mover, mover.x + mover.vx * dt);
    if (allowY && mover.vy !== 0) setControlledY(mover, mover.y + mover.vy * dt);
    // サーブ構え/トス中はセンターライン(x=0)を越えられないよう自分側の半面にクランプする
    // （越えるとルール上不可。CPU側はai.js側で元々越えない実装）
    if (state === "serve-stance" || state === "serve-toss") {
      const margin = 0.05; // ごく小さなマージン（センターにぴたり寄れる程度）
      if (serveFromRight()) {
        mover.x = Math.max(margin, Math.min(COURT.halfW, mover.x));
      } else {
        mover.x = Math.max(-COURT.halfW, Math.min(-margin, mover.x));
      }
    }
    // サーブの構え中はボールがサーバーに追従する（置き去り防止）
    if (state === "serve-stance") {
      ball.x = mover.x;
      ball.y = mover.y;
    }
  }

  [back, front, cpuBack, cpuFront].forEach(function (p) {
    if (p.swingT > 0) {
      p.swingT -= dt;
      if (p.swingT <= 0) {
        p.swingT = 0;
        p.pose = "idle";
        // フォロースルー終了直後は構え直しが完了するまで次の打球を打てない
        // （クールダウン。前衛同士の近距離ボレー応酬を抑える）。
        p.recoverT = TUNING.tempo.swingRecover;
      }
    } else if (p.recoverT > 0) {
      p.recoverT -= dt;
      if (p.recoverT < 0) p.recoverT = 0;
    }
  });

  setEffects(effects.filter(function (ef) {
    ef.t += dt;
    return ef.t < ef.ttl;
  }));
  if (ball.flashT > 0) ball.flashT -= dt;

  // トスの更新（プレイヤー・CPU共通）
  if (state === "serve-toss") {
    updateToss(dt);
  }

  if (state !== "rally") {
    updatePartner(dt);
    updateRallyControlledAI(dt);
    updateCpuBack(dt);
    updateCpuFront(dt);
    return;
  }

  // ボール物理（メートル・秒）
  const prevX = ball.x;
  const prevY = ball.y;
  const prevZ = ball.z;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;
  ball.vz -= G * dt;
  // 飛行中の空気抵抗（弱め）: 速度に比例して水平方向を毎フレーム減衰させ、
  // 飛行が長いほど自然に失速する（ソフトテニス特有の減速感の一部）。
  const drag = Math.max(0, 1 - (TUNING.airDrag || 0) * dt);
  ball.vx *= drag;
  ball.vy *= drag;

  ball.trail.push({ x: ball.x, y: ball.y, z: ball.z });
  if (ball.trail.length > 7) ball.trail.shift();

  if (checkNet(prevY, prevZ)) return;

  if (ball.z <= 0 && ball.vz < 0) {
    // z=0を跨いだフレームの実際の着地点(x,y)を線形補間で求め、
    // 通り過ぎた分の誤差を消してからin/out判定する
    if (prevZ > 0) {
      const t = prevZ / (prevZ - ball.z);
      ball.x = prevX + (ball.x - prevX) * t;
      ball.y = prevY + (ball.y - prevY) * t;
    }
    handleBounce();
    if (state !== "rally") return;
  }

  updatePartner(dt);
  updateRallyControlledAI(dt);
  updateCpuBack(dt);
  updateCpuFront(dt);

  // 予約スイング（アシスト）: 早めに離した直後の猶予内にゾーンへ入れば打つ
  if (pendingSwing > 0) {
    setPendingSwing(pendingSwing - dt);
    if (canPlayerHit(rallyControlled)) playerHitBall(pendingShot, pendingPower, pendingAimX, pendingAimY);
  }

  // 構え・打点タイミングの管理。打点ゾーンに入ったら自動でため開始
  // （離して打つ操作は廃止。WASD移動はため中も常に有効）
  const cp = rallyControlled;
  const hittable = canPlayerHit(cp);
  // ボールがネットを越えて自陣側(y>0)に入ったら、打点リーチに入る前から
  // テイクバック準備（"prep"）に入ってよい（現状より少し早めの準備動作）。
  // 自陣側＝相手が打ったボールが自分のコート側(y>0)に入っている状態。
  const ballCrossedToOwnSide = ball.lastHitter === "cpu" && ball.y > 0;
  if (hittable) {
    if (ballHittableSince < 0) setBallHittableSince(matchTime);
    if (cp.pose !== "swing") {
      // フォア/バックは「ロックされるまでの最初の1回」だけ判定して固定する。
      // pose の値（prep/ready）で判定すると、prepで既に固定済みでも
      // prep→ready遷移の瞬間に再評価されてしまい、ボールが体の正面付近を
      // 横切る間にフォア/バック判定がしきい値をまたいでフリップし、
      // 構え〜スイングの表示が一瞬バックに転ぶちらつきになる。
      // swingSideLocked を見て、ロック済みなら再計算しない。
      // 判定基準はその瞬間のball.xではなく、バウンド後の軌道の行き先
      // （predictedContactX）にする。単純なx比較だけで決めると、ボールが
      // 体の正面付近を横切る間に左右がしきい値をまたいで反転しやすいため。
      if (!cp.swingSideLocked) {
        cp.swingSide = isBackhandFor("player", cp, predictedContactX()) ? "back" : "fore";
        cp.swingSideLocked = true;
      }
      cp.pose = "ready";
    }
    if (!charge.active) startCharge("auto");
  } else {
    setBallHittableSince(-1);
    if (cp.pose === "ready" || cp.pose === "prep") cp.pose = "idle";
    // 観戦モードでは操作キャラも moveAutoAI が動かす＝立ち位置と一体で fore/back を
    // 確定・保持している。ここで二重に swingSide を書くと競合・ちらつくため、
    // 観戦時は見た目のテイクバックだけ行い swingSide は触らない。
    if (!spectatorMode) {
      if (cp.pose === "idle") cp.swingSideLocked = false;
      if (ballCrossedToOwnSide && cp.pose === "idle") {
        // まだ打点リーチには入っていないが、ネットを越えてきたので早めに
        // 準備動作（テイクバック開始）へ入る。打球判定・タイミングには無関係（見た目のみ）。
        // ここで決めたフォア/バックは、続く ready/swing でも上書きせず引き継ぐ
        // （上の hittable 分岐参照）＝一連の構え〜スイングで種別を固定する。
        cp.pose = "prep";
        cp.swingSide = isBackhandFor("player", cp, predictedContactX()) ? "back" : "fore";
        cp.swingSideLocked = true;
      } else if (!ballCrossedToOwnSide && cp.pose === "prep") {
        cp.pose = "idle";
        cp.swingSideLocked = false;
      }
    } else if (ballCrossedToOwnSide && cp.pose === "idle") {
      cp.pose = "prep";
    }
    if (charge.active && charge.source === "auto") {
      charge.active = false;
      charge.source = null;
    }
  }

  // 観戦モードのみ: AIがコース・球種を選んで同じ経路（playerHitBall）でスイングする。
  // 非観戦時は自動スイングしない（廃止）。スイングはプレイヤー入力
  // （PC=クリック / スマホ=スワイプ or タップ）でのみ発動する。ため自体は
  // ゾーンを過ぎても入力が来るまで維持する（chargeAmountは0〜1にクランプ済み）。
  if (spectatorMode && charge.active && hittable && ballHittableSince >= 0 &&
      matchTime - ballHittableSince >= IDEAL_HIT_DELAY) {
    charge.active = false;
    charge.source = null;
    // 観戦モード: 打球は tryReturnAI("player") に委譲（partnerTryReturn経由）
    // ここでは charge のみリセットして二重打球を防ぐ
    setBallHittableSince(-1);
  }

  partnerTryReturn();
  if (state !== "rally") return;
  cpuTryReturn();
  if (state !== "rally") return;

  // 安全網: 大きく場外に出たボール（一般的なコートのサイド/バック余白(ITF推奨)）
  const outX = COURT.halfW + 3.66;
  const outY = COURT.halfL + 6.40;
  const escaping =
    (ball.y > outY && ball.vy > 0) ||
    (ball.y < -outY && ball.vy < 0) ||
    (Math.abs(ball.x) > outX && ball.vx * ball.x > 0);
  if (escaping) {
    const hitterIsPlayer = ball.lastHitter === "player";
    // 一度もバウンドせず場外へ抜けたサーブはフォルト（2本制を維持）。
    // ここで awardPoint すると wide なサーブが即失点になりセカンドサーブが消える。
    if (ball.serving && ball.bounces === 0) serveFault("サービスコートに入らなかった");
    else if (ball.bounces >= 1) awardPoint(ball.y < 0, "ツーバウンド");
    else awardPoint(!hitterIsPlayer, hitterIsPlayer ? "アウト" : "相手のアウト");
  }
}


/* ===========================================================
 * ループ・画面遷移
 * =========================================================== */

export function loop(now) {
  const dt = Math.min((now - lastTime) / 1000 || 0.016, 0.05);
  setLastTime(now);
  update(dt);
  draw();
  setRafId(requestAnimationFrame(loop));
}

startBtn.addEventListener("click", function () {
  startMatch();
  if (!rafId) {
    setLastTime(performance.now());
    setMatchTime(0);
    setRafId(requestAnimationFrame(loop));
  }
});

retryBtn.addEventListener("click", function () {
  showScreen("ready");
  cancelAnimationFrame(rafId);
  setRafId(null);
  setState("ready");
});

// 画面向きに応じてcanvas内部解像度・カメラを同期する（横画面はワイドビュー）。
function syncViewport() {
  // 描画領域＝court-wrap の実ピクセルサイズに合わせる（取得できなければウィンドウ）。
  const wrap = canvas.parentElement;
  let availW = window.innerWidth, availH = window.innerHeight;
  if (wrap) {
    const r = wrap.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) { availW = r.width; availH = r.height; }
  }
  applyViewport(availW, availH);
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  draw();
}
window.addEventListener("resize", syncViewport);
window.addEventListener("orientationchange", syncViewport);
syncViewport();

/* 3D 関連は削除済み */
