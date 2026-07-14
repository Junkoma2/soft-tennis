// サーブ開始〜インパクトの回帰テスト。
// レシーバー割当・サーブ種別決定・パワー/回転の内部決定(serve.js)、
// 打点ゾーン判定(hit-detection.js)、サーブ開始〜トス〜インパクトの状態遷移
// (matchLoop.js経由のpendingImpact)が壊れていないかを検証する。
//
// formation-coverage.test.mjs と同じ方針で、本物のロジック(serve.js/hit-detection.js/
// state.js/config.js)をそのままimportして検証する（ロジックの再実装はしない）。
// DOM/描画に依存するファイルはNode実行用のスタブ(dom-stubs.mjs/stub-loader.mjs)へ
// 差し替える（main.js/render.js/ai.js/input.jsのみ）。sound.js等の副作用は
// モジュール読込時には走らない（呼び出し関数内でのみwindow.AudioContext等を参照する）
// ため、実物をそのままimportできる。
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import "./dom-stubs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(here, "stub-loader.mjs")).href, pathToFileURL(here + path.sep).href);

const { TOSS_RISE_TIME } = await import("../config.js");
const state = await import("../state.js");
const {
  serverTeamNow, serverIsSecondOfPair, currentServer, playerIsServer,
  assignReceiverSides, receiverPlayerFor, serveTypeForInput,
  startServe, playerServeAction, launchPlayerServe,
} = await import("../serve.js");
const { predictLineContactAtY, hitLineInfo } = await import("../hit-detection.js");

const {
  player, cpu, back, front, cpuBack, cpuFront, ball, toss, serveReady,
  coverageAnchor,
} = state;

function resetMatchCounters() {
  player.games = 0; cpu.games = 0;
  player.points = 0; cpu.points = 0;
  state.setServeFaults(0);
  state.setRallyControlled(back);
  state.setSpectatorMode(false);
  state.setServeCategory("over");
  coverageAnchor.player.set = false;
  coverageAnchor.cpu.set = false;
}

test("サーブ順: ゲーム0-0・ポイント0-0はプレイヤーチームの1人目(後衛)がサーバー", () => {
  resetMatchCounters();
  assert.equal(serverTeamNow(), "player");
  assert.equal(serverIsSecondOfPair(), false, "ペアの1人目(後衛)がまだ番");
  assert.equal(currentServer(), back, "1人目=後衛がサーバー");
  assert.equal(playerIsServer(), true, "rallyControlled(=back)と一致するので自分のサーブ");
});

test("サーブ順: ポイント合計が2進むとペアの2人目(前衛)にサーブが交代する", () => {
  resetMatchCounters();
  player.points = 1; cpu.points = 1; // 合計2 → block=1 → 2人目
  assert.equal(serverIsSecondOfPair(), true);
  assert.equal(currentServer(), front, "2人目=前衛がサーバーに交代している");
});

test("サーブ順: ゲーム合計が奇数のときはCPUチームがサーバー", () => {
  resetMatchCounters();
  player.games = 1; // 合計1（奇数）
  assert.equal(serverTeamNow(), "cpu");
  assert.equal(currentServer(), cpuBack, "CPUチームの1人目(後衛)がサーバー");
});

test("レシーバー割当: 後衛=クロス/前衛=逆クロスで固定し、サーブの対角に応じて担当が入れ替わる", () => {
  resetMatchCounters();
  assignReceiverSides();
  // CPUサーブ・ポイント合計偶数(=サーブは右→対角は自陣左寄りではなくplayer視点の+x側) のとき
  player.points = 0; cpu.points = 0;
  assert.equal(receiverPlayerFor("player"), back, "対角の一致でクロス担当(後衛)がレシーブする");

  player.points = 1; cpu.points = 0; // 合計奇数 → 対角が入れ替わる
  assert.equal(receiverPlayerFor("player"), front, "対角が変わると逆クロス担当(前衛)がレシーブする");
});

test("サーブ種別決定: 事前カテゴリ(over/under)とボタン/Space修飾から4種を一意に決める", () => {
  state.setServeCategory("over");
  assert.equal(serveTypeForInput(0, false), "flat", "オーバー×左クリック=フラット");
  assert.equal(serveTypeForInput(2, false), "slice", "オーバー×右クリック=スライス");
  assert.equal(serveTypeForInput(0, true), "attackCut", "オーバー×Space+左クリック=攻撃的カット");
  assert.equal(serveTypeForInput(2, true), "attackCut", "オーバー×Space+右クリック=攻撃的カット(Space優先)");

  state.setServeCategory("under");
  assert.equal(serveTypeForInput(0, false), "underCut", "アンダー選択中はボタンに関係なく常にアンダーカット");
  assert.equal(serveTypeForInput(2, true), "underCut", "アンダー選択中はSpace修飾があっても常にアンダーカット");
  state.setServeCategory("over");
});

test("サーブ開始: state遷移とプレイヤーチームのサーブではCPUプランを抽選しない", () => {
  resetMatchCounters();
  startServe(true);
  assert.equal(state.state, "serve-stance");
  assert.equal(state.cpuServePlan, null, "プレイヤーチームのサーブは事前抽選しない");
  assert.equal(ball.x, back.x, "ボールがサーバーの手元に置かれる");
  assert.equal(ball.lastHitter, "player");
});

test("サーブ開始: CPUチームのサーブではファースト/セカンドに応じたサーブ種別を事前抽選する", () => {
  resetMatchCounters();
  player.games = 1; // CPUチームのサーブ番にする
  startServe(true);
  assert.equal(state.state, "serve-stance");
  assert.notEqual(state.cpuServePlan, null, "CPUサーブは打つ前にプレイヤーへ見せるため事前抽選される");
  assert.equal(
    ["flat", "slice", "attackCut", "underCut"].includes(state.cpuServePlan.type),
    true,
    "4種のいずれかに決まっている",
  );
});

test("サーブ開始〜トス〜インパクト: プレイヤーサーブの状態遷移が一貫し、インパクトでボールと守備ラッチが確定する", () => {
  resetMatchCounters();
  assignReceiverSides();
  startServe(true);
  assert.equal(state.state, "serve-stance");

  // レシーバー準備完了までトスできない
  serveReady.ready = false;
  playerServeAction(0);
  assert.equal(state.state, "serve-stance", "レシーバー未準備の間はトスへ進まない");

  serveReady.ready = true;
  playerServeAction(0); // 左クリック=トス開始（種類は打つ瞬間まで確定しない）
  assert.equal(state.state, "serve-toss");
  assert.equal(toss.active, true);

  // トスの頂点付近まで進める（updateToss を毎フレーム回す代わりに、トス時間を直接進める）
  toss.t = TOSS_RISE_TIME;
  launchPlayerServe("flat");

  assert.equal(state.state, "rally", "打った瞬間にラリー状態へ遷移する");
  assert.equal(ball.serving, true);
  assert.equal(ball.held, true, "インパクト位相に到達するまではサーバーの手元で保持したまま");
  assert.equal(typeof back.pendingImpact, "object");
  assert.equal(back.pendingImpact.fired, false);
  assert.equal(typeof back.pendingImpact.run, "function");

  // スイングがインパクト位相に到達したフレーム相当の処理を実行する
  back.pendingImpact.run();

  assert.equal(ball.held, false, "インパクトでボールが手元を離れる");
  assert.equal(ball.lastHitter, "player");
  assert.equal(ball.spin, "drive", "flatサーブのspinKindが反映される");
  assert.equal(ball.bounces, 0, "打った直後はまだバウンドしていない");
  assert.equal(
    Math.hypot(ball.vx, ball.vy) > 0,
    true,
    "インパクトで実際の初速が入り、ボールが飛び始める",
  );
  assert.equal(
    coverageAnchor.player.set,
    true,
    "サーブも「打った」一打として守備陣形(coverageAnchor)がラッチされる",
  );
});

test("打点判定: フォア側は懐が広く、同じ横距離でもフォア側は打点内・バック側は打点外になりうる", () => {
  back.x = 0; back.y = 13; back.facing = -1;
  back.role = "back";
  back.stats.handed = "right";
  back.stats.reach = 1.0;

  function setStraightBall(x) {
    Object.assign(ball, {
      lastHitter: "cpu",
      serving: true, // ballComingToSideの補正を切り、ネット正対(baseYaw)基準で判定する
      bounces: 1,
      x, y: 9.0, z: 0.6,
      vx: 0, vy: 4.5, vz: 4.5,
      spin: "flat", spinMag: 1,
      lastHitTime: 1,
    });
  }

  // 右利き後衛(facing=-1)のフォア側は画面x+方向。横1.0mのオフセットはフォア側なら届く。
  setStraightBall(1.0);
  const contactFore = predictLineContactAtY(back.y);
  const infoFore = hitLineInfo(back);
  assert.notEqual(contactFore, null, "打点までの飛行ラインが予測できる");
  assert.equal(infoFore.side, "fore");
  assert.equal(infoFore.active, true, "フォア側の懐(約1.5m)に収まるので打点内");

  // 同じ横1.0mのオフセットでもバック側は懐が狭く(約0.58m)、打点外になる。
  setStraightBall(-1.0);
  const infoBack = hitLineInfo(back);
  assert.equal(infoBack.side, "back");
  assert.equal(infoBack.active, false, "バック側の懐(約0.58m)には収まらないので打点外");
});

test("打点判定: 体の正面付近(オフセットほぼ0)はフォア/バックどちらの定義でも常に打点内", () => {
  back.x = 0; back.y = 13; back.facing = -1;
  back.role = "back";
  back.stats.handed = "right";
  back.stats.reach = 1.0;

  Object.assign(ball, {
    lastHitter: "cpu", serving: true, bounces: 1,
    x: 0, y: 9.0, z: 0.6,
    vx: 0, vy: 4.5, vz: 4.5,
    spin: "flat", spinMag: 1, lastHitTime: 1,
  });

  const info = hitLineInfo(back);
  assert.equal(info.active, true);
  assert.equal(info.distanceX, 0);
});
