// 縦画面での横向き回転案内の回帰テスト。
// rally-score-regression.test.mjs と同じ手法（main.js を実物のままロードし、
// dom-stubs.mjs/main-stub-loader.mjs で周辺のDOM副作用だけをスタブ）を用いる。
// window.innerWidth/innerHeight を差し替えて縦画面/横画面を再現し、
// orientation-guide の表示切替と試合開始タイミングを検証する。
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import "./dom-stubs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(here, "main-stub-loader.mjs")).href, pathToFileURL(here + path.sep).href);

const state = await import("../state.js");
const { shouldWaitForLandscape, beginMatchFromStartButton, continueMatchAfterRotation } = await import("../main.js");

const { screens, orientationGuide } = state;

// awardPoint/finishGame同様、startMatch経由のポイント間演出はsetTimeoutで予約される。
// テストでは実タイマーを待たず同期的に検証したいので no-op に差し替える。
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = () => 0;
test.after(() => { globalThis.setTimeout = realSetTimeout; });

function setViewport(width, height) {
  window.innerWidth = width;
  window.innerHeight = height;
}

function resetReady() {
  state.setState("ready");
  screens.ready.hidden = false;
  screens.game.hidden = true;
  screens.result.hidden = true;
  orientationGuide.hidden = true;
}

test("スマホ縦画面(390x844): 試合開始で回転案内が表示され、試合はまだ始まらない", () => {
  resetReady();
  setViewport(390, 844);

  assert.equal(shouldWaitForLandscape(), true, "幅768px以下・縦長は横向き待ちと判定する");

  beginMatchFromStartButton();

  assert.equal(orientationGuide.hidden, false, "回転案内が表示される");
  assert.equal(screens.game.hidden, true, "試合画面はまだ表示されない");
  assert.equal(screens.ready.hidden, false, "開始画面はまだ表示されたまま");
});

test("縦画面で案内表示後、横向き(844x390)に変わると案内が消えて試合が始まる", () => {
  resetReady();
  setViewport(390, 844);
  beginMatchFromStartButton();
  assert.equal(orientationGuide.hidden, false, "前提: 回転案内が出ている");

  setViewport(844, 390);
  assert.equal(shouldWaitForLandscape(), false, "横向きになれば待ち判定は解除される");

  continueMatchAfterRotation();

  assert.equal(orientationGuide.hidden, true, "横向きになったら案内が消える");
  assert.equal(screens.game.hidden, false, "試合画面が表示される");
});

test("縦画面のままリサイズしても、横向きになるまでは試合を開始しない", () => {
  resetReady();
  setViewport(390, 844);
  beginMatchFromStartButton();

  setViewport(412, 915); // 依然として縦長の別解像度
  continueMatchAfterRotation();

  assert.equal(orientationGuide.hidden, false, "横向きになるまで案内は消えない");
  assert.equal(screens.game.hidden, true, "試合はまだ始まらない");
});

test("PC横長(1280x720)では案内を出さずにすぐ試合を開始する", () => {
  resetReady();
  setViewport(1280, 720);

  assert.equal(shouldWaitForLandscape(), false, "PCの横長は待ち判定にならない");

  beginMatchFromStartButton();

  assert.equal(orientationGuide.hidden, true, "回転案内は出ない");
  assert.equal(screens.game.hidden, false, "試合画面がすぐ表示される");
});
