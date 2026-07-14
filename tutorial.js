import { spectatorMode, tutorialSeen, setTutorialSeen, setTutorialActive } from "./state.js";

/* ===========================================================
 * 段階的チュートリアル（最初の1ポイント用）
 *
 * 移動・狙い・ため・球種・打球可能タイミングを、試合開始直後に順番で説明する。
 * ・スキップ可能。一度最後まで見る/スキップすると、以後は自動表示しない
 *   （state.js の tutorialSeen を localStorage に保存）
 * ・観戦モード（AI対AI）は操作不要のため出さない
 * ・開始画面の「もう一度見る」導線から、次の試合開始時にだけ再表示できる
 * ・表示中は試合シミュレーションを一時停止する（state.js の tutorialActive）。
 *   カードを読んでいる間も裏でラリーが進み続けると、閉じた瞬間にボールが
 *   別の場所へワープしたように見えてしまうため、matchLoop.js側でupdate(dt)自体を止める
 * =========================================================== */

const STEPS = [
  {
    title: "移動",
    body: "WASD（スマホは左下のスティック）で選手を動かします。ため中も自由に動けます。",
  },
  {
    title: "サーブ",
    body: "自分の番のときだけ：クリック（タップ）でトスを上げ、ボールが適正な高さに来たらもう一度クリック（タップ）で打ちます。左クリック=フラット／右クリック=カット。相方や相手のサーブのときは何もしなくて大丈夫です。",
  },
  {
    title: "狙い",
    body: "マウス／スワイプでコースを指定します。コート上のリングが今の狙いです。",
  },
  {
    title: "ため",
    body: "打点ゾーンに入ると自動で「ため」が始まります。足元のリングが大きく・オレンジになるほど強い球で打てます。",
  },
  {
    title: "球種",
    body: "左クリック=シュート／右クリック=カット／Space+クリック=ロブ。スマホは下部のボタンで選びます。",
  },
  {
    title: "打つタイミング",
    body: "足元にリングが出ている間だけ打てます。早すぎ・遅すぎ・距離が届かないときは短いメッセージで理由を知らせます。",
  },
];

let stepIndex = 0;

const overlay = document.getElementById("tutorial-overlay");
const stepLabelEl = document.getElementById("tutorial-step");
const titleEl = document.getElementById("tutorial-title");
const bodyEl = document.getElementById("tutorial-body");
const nextBtn = document.getElementById("tutorial-next-btn");
const skipBtn = document.getElementById("tutorial-skip-btn");
const replayBtn = document.getElementById("tutorial-replay-btn");
const replayNote = document.getElementById("tutorial-replay-note");

function renderStep() {
  const s = STEPS[stepIndex];
  if (stepLabelEl) stepLabelEl.textContent = (stepIndex + 1) + " / " + STEPS.length;
  if (titleEl) titleEl.textContent = s.title;
  if (bodyEl) bodyEl.textContent = s.body;
  if (nextBtn) nextBtn.textContent = (stepIndex === STEPS.length - 1) ? "はじめる" : "次へ";
}

function closeTutorial() {
  if (overlay) overlay.hidden = true;
  setTutorialSeen(true);
  setTutorialActive(false);
}

// 試合開始（最初の1ポイント）から呼ぶ。未視聴かつ観戦モードでない場合だけ表示する。
export function maybeStartTutorial() {
  if (!overlay) return;
  if (spectatorMode) return;
  if (tutorialSeen) return;
  stepIndex = 0;
  renderStep();
  overlay.hidden = false;
  setTutorialActive(true);
}

if (nextBtn) {
  nextBtn.addEventListener("click", function () {
    if (stepIndex >= STEPS.length - 1) { closeTutorial(); return; }
    stepIndex += 1;
    renderStep();
  });
}
if (skipBtn) {
  skipBtn.addEventListener("click", closeTutorial);
}

// 開始画面: チュートリアルをもう一度見るための導線。
// その場では表示せず、フラグを戻すだけ（次の「試合を始める」で自動表示される）。
if (replayBtn) {
  replayBtn.addEventListener("click", function () {
    setTutorialSeen(false);
    if (replayNote) replayNote.hidden = false;
  });
}
