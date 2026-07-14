// ラリー継続・アウト/ネット判定・得点処理の回帰テスト。
// formation-coverage.test.mjs と同じ手法（本物のロジックをそのままimportして検証。
// dom-stubs.mjs/main-stub-loader.mjsを再利用）を用いる。
//
// 得点処理（awardPoint/pointLabel/finishGame）は main.js が所有し、matchLoop.js の
// handleBounce/checkNet から呼ばれる。この結合を実際の呼び出し経路のまま検証したいため、
// main-stub-loader.mjs では main.js をスタブせず実物をロードする
// （render.js/ai.js/input.js/tutorial.js/playerStatsPanel.js/viewTuningPanel.jsのみスタブ）。
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import "./dom-stubs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(here, "main-stub-loader.mjs")).href, pathToFileURL(here + path.sep).href);

const { COURT } = await import("../config.js");
const state = await import("../state.js");
const { handleBounce, checkNet, insideCourt, isSmashContact } = await import("../matchLoop.js");
const { awardPoint, pointLabel, isFinalGame, finishGame } = await import("../main.js");

const { ball, player, cpu, messageText } = state;

// awardPoint は state==="point"/"gameset"/"matchend" の間は何もしない安全弁を持つため、
// 次のポイント/ゲームをシミュレートするたびに明示的に "rally" へ戻す。
// また awardPoint/finishGame はポイント間の演出のため setTimeout でサーブ再開を予約するが、
// テストでは実タイマーを待たず同期的に検証したいので no-op に差し替える
// （本物のロジック自体は変更せず、周辺の非同期演出だけを無効化する）。
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = () => 0;
test.after(() => { globalThis.setTimeout = realSetTimeout; });

function resetPoint() {
  state.setState("rally");
  player.points = 0; player.games = 0;
  cpu.points = 0; cpu.games = 0;
  ball.bounces = 0;
  ball.serving = false;
  ball.lastHitter = "player";
  ball.x = 0; ball.y = 5.0; ball.z = 0.5;
  ball.vx = 0; ball.vy = 0; ball.vz = -4; // 落下中
  messageText.textContent = "";
}

/* ---- ラリー継続 ---- */

test("ラリー継続: コート内での1バウンド目はポイントを確定させず物理を継続する", () => {
  resetPoint();
  ball.x = 1.0; ball.y = 5.0; // コート内（halfW=5.485, halfL=11.885）
  ball.lastHitter = "player";
  ball.vz = -4; // 落下中

  handleBounce();

  assert.equal(ball.bounces, 1, "バウンド数がインクリメントされる");
  assert.equal(player.points, 0, "ポイントは動かない");
  assert.equal(cpu.points, 0, "ポイントは動かない");
  assert.equal(state.state, "rally", "ラリーが継続する");
  assert.ok(ball.vz > 0, "反発でvzが上向きに反転する");
});

test("ラリー継続: y符号が変わらなければネット通過判定は発生しない", () => {
  resetPoint();
  ball.y = 5.0; // prevYと同符号（自陣側のまま）
  const crossed = checkNet(4.0, 0.5);

  assert.equal(crossed, false);
  assert.equal(player.points, 0);
  assert.equal(cpu.points, 0);
});

test("ラリー継続: ネットを高い位置(netHより高い)で通過すればフォルト/失点にならない", () => {
  resetPoint();
  ball.x = 0; ball.y = -1.0; ball.z = 2.0; // 自陣(正)→相手陣(負)へ、高い位置で通過
  const crossed = checkNet(1.0, 2.0);

  assert.equal(crossed, false, "ネットより高ければフォルトにならない");
  assert.equal(player.points, 0);
  assert.equal(cpu.points, 0);
  assert.equal(state.state, "rally");
});

/* ---- アウト判定 ---- */

test("アウト: プレイヤーの打球がコート外に1バウンド目で落ちるとCPUの得点になる", () => {
  resetPoint();
  ball.lastHitter = "player";
  ball.x = COURT.halfW + 2.0; // サイドライン外
  ball.y = 5.0;

  handleBounce();

  assert.equal(cpu.points, 1, "打った側(player)の失点＝相手(cpu)の得点");
  assert.equal(player.points, 0);
  assert.equal(state.state, "point");
  assert.match(messageText.textContent, /アウト/, "アウトの旨がメッセージに反映される");
});

test("アウト: CPUの打球がコート外に1バウンド目で落ちるとプレイヤーの得点になる", () => {
  resetPoint();
  ball.lastHitter = "cpu";
  ball.x = 0;
  ball.y = -(COURT.halfL + 2.0); // ベースライン外

  handleBounce();

  assert.equal(player.points, 1, "打った側(cpu)の失点＝相手(player)の得点");
  assert.equal(cpu.points, 0);
  assert.match(messageText.textContent, /アウト/);
});

test("ラリー継続との境界: コート内(ライン上マージン込み)は1バウンド目でも失点にならない", () => {
  resetPoint();
  ball.lastHitter = "player";
  ball.x = COURT.halfW; // ライン上（insideCourtはマージン込みでtrue）
  ball.y = COURT.halfL;
  assert.equal(insideCourt(ball.x, ball.y), true, "ライン上はイン");

  handleBounce();

  assert.equal(player.points, 0);
  assert.equal(cpu.points, 0);
  assert.equal(state.state, "rally");
});

/* ---- ネット判定 ---- */

test("ネット: プレイヤーの打球がネットより低く通過するとCPUの得点になる", () => {
  resetPoint();
  ball.lastHitter = "player";
  ball.x = 0; ball.y = -1.0; ball.z = 0.5; // 自陣(正)→相手陣(負)へ、低い位置(netH=1.07未満)で通過
  const crossed = checkNet(1.0, 0.5);

  assert.equal(crossed, true, "ネットに掛かった判定になる");
  assert.equal(cpu.points, 1, "打った側(player)のネット＝相手(cpu)の得点");
  assert.equal(player.points, 0);
  assert.equal(state.state, "point");
  assert.match(messageText.textContent, /ネット/);
});

test("ネット: CPUの打球がネットより低く通過するとプレイヤーの得点になる", () => {
  resetPoint();
  ball.lastHitter = "cpu";
  ball.x = 0;
  ball.y = 1.0; ball.z = 0.5; // 相手側(負)から自陣側(正)へ、低い位置で通過
  const crossed = checkNet(-1.0, 0.5);

  assert.equal(crossed, true);
  assert.equal(player.points, 1, "打った側(cpu)のネット＝相手(player)の得点");
  assert.equal(cpu.points, 0);
  assert.match(messageText.textContent, /ネット/);
});

/* ---- ツーバウンド ---- */

test("ツーバウンド: ボールが落ちた側(cpu陣)の2バウンド目はプレイヤーの得点になる", () => {
  resetPoint();
  ball.bounces = 1; // このhandleBounceで2バウンド目になる
  ball.x = 0; ball.y = -3.0; // cpu陣（y<0）

  handleBounce();

  assert.equal(player.points, 1, "cpu陣で2バウンド＝cpuの返球ミス＝playerの得点");
  assert.equal(cpu.points, 0);
  assert.match(messageText.textContent, /ツーバウンド/);
});

test("ツーバウンド: ボールが落ちた側(player陣)の2バウンド目はCPUの得点になる", () => {
  resetPoint();
  ball.bounces = 1;
  ball.x = 0; ball.y = 3.0; // player陣（y>0）

  handleBounce();

  assert.equal(cpu.points, 1, "player陣で2バウンド＝playerの返球ミス＝cpuの得点");
  assert.equal(player.points, 0);
});

/* ---- スマッシュ判定（対象に含まれる打点高さ/ネット距離の分岐） ---- */

test("スマッシュ判定: ネット際・高い打点はスマッシュ成立", () => {
  const hitter = { y: 0.5 }; // ネット(y=0)に近い前衛域
  assert.equal(isSmashContact(hitter, 2.2), true);
});

test("スマッシュ判定: ベースライン付近・低い打点はスマッシュ不成立", () => {
  const hitter = { y: 10.0 }; // ネットから遠い後衛域
  assert.equal(isSmashContact(hitter, 1.0), false);
});

/* ---- 得点加算（JSTA表記: 0/1/2/3、テニスの15/30/40ではない） ---- */

test("得点加算: 0→1→2→3とJSTA表記で進み、3-3はデュース、2点差でゲームが決まる", () => {
  resetPoint();

  awardPoint(true, "テスト1点目"); // player 0→1
  assert.equal(player.points, 1);
  assert.equal(pointLabel(player.points, cpu.points), "1", "1本目は「1」表記（テニスの15ではない）");

  state.setState("rally");
  awardPoint(true, "テスト2点目"); // player 1→2
  assert.equal(pointLabel(player.points, cpu.points), "2");

  state.setState("rally");
  awardPoint(true, "テスト3点目"); // player 2→3
  assert.equal(pointLabel(player.points, cpu.points), "3", "3本目は「3」表記（テニスの40ではない）");

  // cpuを3まで追いつかせてデュースにする
  state.setState("rally"); awardPoint(false, "cpu1");
  state.setState("rally"); awardPoint(false, "cpu2");
  state.setState("rally"); awardPoint(false, "cpu3");
  assert.equal(player.points, 3);
  assert.equal(cpu.points, 3);
  assert.equal(pointLabel(player.points, cpu.points), "デュース");
  assert.equal(pointLabel(cpu.points, player.points), "デュース");

  // player advantage
  state.setState("rally"); awardPoint(true, "adv");
  assert.equal(pointLabel(player.points, cpu.points), "アド");
  assert.equal(pointLabel(cpu.points, player.points), "−");

  // 2点差になった瞬間にゲームが決まり、ポイントが0-0にリセットされる
  state.setState("rally"); awardPoint(true, "win game");
  assert.equal(player.games, 1, "2点差でゲーム獲得");
  assert.equal(player.points, 0, "ゲーム後はポイントが0-0にリセットされる");
  assert.equal(cpu.points, 0);
  assert.equal(state.state, "gameset");
});

test("得点加算: ファイナルゲーム(2-2)は数字そのまま表示され、デュース表記にならない", () => {
  resetPoint();
  player.games = 2; cpu.games = 2;

  assert.equal(isFinalGame(), true);
  assert.equal(pointLabel(5, 3), "5", "ファイナルゲームはデュース/アドではなく実点数を表示する");
  assert.equal(pointLabel(6, 6), "6", "6-6でも通常ゲームのデュース表記にはならない");
});

test("得点加算: マッチポイントを取ると試合終了状態(matchend)に遷移する", () => {
  resetPoint();
  player.games = 2; cpu.games = 0;

  finishGame(true);

  assert.equal(player.games, 3, "3ゲーム先取でマッチ終了");
  assert.equal(state.state, "matchend");
});
