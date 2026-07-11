import {
  TUNING, POINT_LABELS, POINTS_TO_WIN_GAME, FINAL_GAME_POINTS, GAMES_TO_WIN_MATCH,
  FORMATIONS, FORMATION_BIAS, W, H, applyViewport,
} from "./config.js";

import { unproject, clientToCanvas } from "./math.js";

import {
  screens, startBtn, retryBtn, canvas, messageOverlay, messageText,
  playerScoreEl, cpuScoreEl, playerGamesEl, cpuGamesEl, resultTitle, resultDetail,
  chargeBtn, serveCategoryControls, aggressionControls,
  moveStick, controlsPanel, mouseAim, makeStats, cpuStats,
  state, player, cpu, rafId,
  setState, setServeFaults, setRafId, setLastTime, setMatchTime,
  playerPosition, formation, spectatorMode, devMode,
  back, front, cpuBack, cpuFront, setRallyControlled,
} from "./state.js";

import { draw } from "./render.js";

import { assignReceiverSides, startServe } from "./serve.js";

// 開始画面の選手ステータス調整パネル（読み込み時にDOMへ生成・配線する副作用import）
import "./playerStatsPanel.js";
// 開始画面の「表示の調整」パネル（同上）
import "./viewTuningPanel.js";

// 試合中ループは matchLoop.js が所有。開始ボタンから loop を起動する。
import { loop } from "./matchLoop.js";


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

// 操作パネルの表示切替: serve=サーブ設定（オーバー/アンダー＋球種） / rally=球種選択
// 球種ボタン（シュート/カット/ロブ）はサーブ時点から常時表示する。サーブの種類選択
// (over/under)には影響しないが、ラリーに入ってすぐ打ち返す球種を事前に選んでおける
// ようにするための表示。押しやすい下部配置はそのまま変えない。
export function setControlMode(mode) {
  const serveMode = mode === "serve";
  if (serveCategoryControls) serveCategoryControls.hidden = !serveMode;
  // 攻守は観戦モードOFF かつ 得点間（サーブ前）にのみ調整可として表示する
  if (aggressionControls) aggressionControls.hidden = !serveMode || spectatorMode;
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
  // 自陣2選手のpositionBiasを陣形から設定（AIの基本位置・ネット志向・ポーチ頻度を連続的に決める）。
  // 相手チームは常に雁行で固定（cpuFront=25 / cpuBack=80。state.jsの初期値のまま）。
  const fb = FORMATION_BIAS[formation] || FORMATION_BIAS["ganko"];
  front.positionBias = fb.front;
  back.positionBias = fb.back;
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
    // 通常モード: CPU は cpuStats（state.js の既定値＋ステータス調整パネルでの編集）を使う。
    // ※ makeStats でその場生成すると、パネルで設定した CPU の能力・新スキルが無視されるため参照を渡す。
    cpuBack.stats = cpuStats.back;
    cpuFront.stats = cpuStats.front;
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
 * ループ・画面遷移
 * =========================================================== */


function beginMatchFromStartButton(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (screens.ready.hidden) return;
  startMatch();
  if (!rafId) {
    setLastTime(performance.now());
    setMatchTime(0);
    setRafId(requestAnimationFrame(loop));
  }
}

startBtn.addEventListener("pointerdown", beginMatchFromStartButton);
startBtn.addEventListener("click", beginMatchFromStartButton);
startBtn.onclick = beginMatchFromStartButton;
window.__softTennisStartReady = true;

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

// 開発モードでなければ開始画面の開発用調整機能（デバッグ表示トグル・選手ステータス調整・
// 表示の調整・パラメータの説明・3Dフォーム確認ページへのリンク）を隠し、通常プレイヤーの
// 開始画面を「操作キャラ・陣形・利き腕・操作方法・試合開始」だけのゲーム画面に見せる。
// 開発モードの有無は state.js の devMode（?dev=1 / localStorage）で決まる。
document.querySelectorAll(".dev-only").forEach((el) => { el.hidden = !devMode; });

/* 3D 関連は削除済み */

