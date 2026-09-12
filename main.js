import {
  TUNING, POINT_LABELS, POINTS_TO_WIN_GAME, FINAL_GAME_POINTS, GAMES_TO_WIN_MATCH,
  FORMATIONS, FORMATION_BIAS, W, H, applyViewport,
} from "./config.js";

import { unproject, clientToCanvas } from "./math.js";

import {
  screens, startBtn, retryBtn, canvas, messageOverlay, messageText, orientationGuide,
  playerScoreEl, cpuScoreEl, playerGamesEl, cpuGamesEl, resultTitle, resultDetail,
  chargeBtn, serveCategoryControls, aggressionControls,
  moveStickZone, controlsPanel, mouseAim, makeStats, cpuStats,
  state, player, cpu, rafId,
  setState, setServeFaults, setRafId, setLastTime, setMatchTime,
  playerPosition, formation, spectatorMode, devMode,
  back, front, cpuBack, cpuFront, setRallyControlled,
  ball, effects,
} from "./state.js";

import { draw } from "./render.js";

import { assignReceiverSides, startServe } from "./serve.js";

import { maybeStartTutorial } from "./tutorial.js";

import { unlockAudio, playMissSound, playPointSound, playGameEndSound } from "./sound.js";

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
  if (moveStickZone) moveStickZone.hidden = spectatorMode;
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
  // 最初の1ポイント（試合開始直後）だけ、操作要素を順に説明するチュートリアルを出す。
  // 既に見た/スキップ済みなら何もしない（tutorial.js側でtutorialSeenを見て判定）。
  maybeStartTutorial();
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

  // ミス（アウト/ネット/ツーバウンド等）の演出: 起きた場所に理由を短く表示しつつ
  // 低いブザー音を鳴らし、続けて得点の上昇チャイムを鳴らす（同じ瞬間の2つの出来事）。
  playMissSound();
  playPointSound(0.11);
  if (reason) {
    effects.push({
      type: "text",
      x: ball.x, y: ball.y, t: 0, ttl: 0.7,
      text: reason,
      color: "#94A3B8",
    });
  }

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
  // ゲーム終了（1ゲームの決着）の演出。直前のawardPoint内の得点チャイムと
  // 重なりすぎないよう少し遅らせる。試合そのものの決着はendMatch側で別途鳴らす。
  playGameEndSound(playerWon, false, 0.3);

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
  playGameEndSound(playerWon, true);
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


// 強制横画面化: スマホ幅（768px以下）で縦向きの間は、開始画面・試合画面のどちらも
// #orientation-guide で覆って縦画面仕様の表示を一切見せない。横向きに戻るまで
// 案内を出し続け、試合中に縦へ回転された場合はシミュレーションも一時停止する
// （裏でラリー・スコアが進んでしまうのを防ぐ）。
// PCの縦長ウィンドウ等（幅768px超）は対象外とし、これまで通り常に表示する
// （style.cssの `@media (orientation: portrait) and (min-width: 769px)` が担当）。
let landscapeStartPending = false; // 縦画面で「試合を始める」を押し、横向き待ちになっている間true
let matchPausedForPortrait = false; // 試合中に縦へ回転してループを一時停止した間true
export function isNativeAppRuntime() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}
export function shouldWaitForLandscape() {
  // ネイティブ版はAndroid/iOS側が起動前から横画面へ固定する。WebViewの初期計測が
  // 一瞬だけ縦長でも案内を重ねず、OSの回転完了に任せる。
  if (isNativeAppRuntime()) return false;
  return window.innerWidth <= 768 && window.innerHeight > window.innerWidth;
}

function beginMatch() {
  // 試合が始まる経路（縦画面の待ち解除に限らず、PCの横長ですぐ開始する場合も含む）
  // では毎回クリアしておく。そうしないと、一度縦画面で待ちになった後に別の
  // タイミングで試合が始まった場合、古いpendingフラグが残り続けて次にたまたま
  // 縦→横へ回転しただけで意図せず試合が自動開始してしまう。
  landscapeStartPending = false;
  startMatch();
  if (rafId === null) {
    setLastTime(performance.now());
    setMatchTime(0);
    setRafId(requestAnimationFrame(loop));
  }
}

export function beginMatchFromStartButton(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (screens.ready.hidden) return;
  unlockAudio(); // ユーザー操作起点でAudioContextを解禁（打球/ミス/得点等の効果音用）
  if (shouldWaitForLandscape()) {
    landscapeStartPending = true;
    if (orientationGuide) orientationGuide.hidden = false;
    return;
  }
  beginMatch();
}

// resize/orientationchange・起動直後のたびに呼ぶ、向き判定と案内表示の一元入口。
// - 縦画面（スマホ幅）: 案内を表示する。試合が進行中なら、シミュレーションを止めて
//   一時停止する（進行中でなければ何もしない＝開始画面もこの案内の下に隠れたまま）。
// - 横向きに戻った: 案内を消す。試合開始待ちだった場合は試合を開始し、
//   一時停止中だった場合はループを再開する。
export function continueMatchAfterRotation() {
  if (shouldWaitForLandscape()) {
    if (orientationGuide) orientationGuide.hidden = false;
    if (!screens.game.hidden && rafId !== null && !matchPausedForPortrait) {
      matchPausedForPortrait = true;
      cancelAnimationFrame(rafId);
      setRafId(null);
    }
    return;
  }
  if (orientationGuide) orientationGuide.hidden = true;
  if (landscapeStartPending) {
    landscapeStartPending = false;
    beginMatch();
    return;
  }
  if (matchPausedForPortrait) {
    matchPausedForPortrait = false;
    setLastTime(performance.now()); // 一時停止していた時間ぶんdtが飛ばないようにする
    setRafId(requestAnimationFrame(loop));
  }
}

startBtn.addEventListener("pointerdown", beginMatchFromStartButton);
startBtn.addEventListener("click", beginMatchFromStartButton);
startBtn.onclick = beginMatchFromStartButton;
window.__softTennisStartReady = true;

window.addEventListener("resize", continueMatchAfterRotation);
window.addEventListener("orientationchange", continueMatchAfterRotation);
// 起動直後（開始画面を最初に開いた瞬間）も、縦画面なら即座に案内を出す。
continueMatchAfterRotation();

retryBtn.addEventListener("click", function () {
  showScreen("ready");
  matchPausedForPortrait = false;
  cancelAnimationFrame(rafId);
  setRafId(null);
  setState("ready");
});

// ブラウザの実際の表示可能高さ（アドレスバー等の分を除いた高さ）をCSS変数 --app-vh
// へ反映する。style.css側は `var(--app-vh, 100dvh)` としてこれを優先利用する。
// スマホを横向きにした瞬間はアドレスバーの表示/収縮アニメーションが完了する前に
// resize/orientationchangeが発火する機種があり、dvh単体だと追従が一瞬遅れて画面
// 全体が潰れて見えることがあるため、visualViewport（無ければinnerHeight）の実測値
// で上書きする。
function syncViewportHeight() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-vh", `${h}px`);
}

// 画面向きに応じてcanvas内部解像度・カメラを同期する（横画面はワイドビュー）。
function syncViewport() {
  syncViewportHeight();
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
// 横向き切替直後はブラウザUIの収縮アニメーションが遅れて完了する機種があるため、
// アニメーション後にも再計測して画面の潰れを解消する。
function syncViewportAfterOrientationSettle() {
  syncViewport();
  setTimeout(syncViewport, 120);
  setTimeout(syncViewport, 400);
}
window.addEventListener("resize", syncViewport);
window.addEventListener("orientationchange", syncViewportAfterOrientationSettle);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncViewport);
}
syncViewport();

// 開発モードでなければ開始画面の開発用調整機能（デバッグ表示トグル・選手ステータス調整・
// 表示の調整・パラメータの説明・3Dフォーム確認ページへのリンク）を隠し、通常プレイヤーの
// 開始画面を「操作キャラ・陣形・利き腕・操作方法・試合開始」だけのゲーム画面に見せる。
// 開発モードの有無は state.js の devMode（?dev=1 / localStorage）で決まる。
document.querySelectorAll(".dev-only").forEach((el) => { el.hidden = !devMode; });

/* 3D 関連は削除済み */

