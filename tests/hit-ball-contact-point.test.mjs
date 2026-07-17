// 打球ワープ回帰テスト。
//
// 背景: hitBall() が入力受付時点でボールの座標(ball.x/ball.y)を打者の中心座標
// (hitter.x/hitter.y) へ上書きしていたため、構え〜インパクト待機中のボールが
// 打者の中心へ瞬間移動して見える不具合があった（本来は実際の打点位置に留めて
// おき、インパクト位相に到達したフレームでその打点から発射すべき）。
//
// このテストは、フォア/バック/ボレー/スマッシュ × プレイヤー/AI打球の
// 各経路で、
//   1. 入力受付直前の実際のボール座標(実打点)
//   2. インパクト待機中（hitBall呼び出し後・pendingImpact発火前）
//   3. 発射時（pendingImpact発火の瞬間）
// のボール座標を検証し、(1)〜(3)を通じて打者の中心座標へ書き換えられていない
// こと（実打点が保持され続けること）を確認する。
//
// swing-impact-sync.test.mjs / serve-impact.test.mjs と同じ方針で、
// matchLoop.js の本物の実装をそのままロードして検証する。
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import "./dom-stubs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(here, "stub-loader.mjs")).href, pathToFileURL(here + path.sep).href);

const { TUNING } = await import("../config.js");
const state = await import("../state.js");
const { hitBall } = await import("../matchLoop.js");

const { ball, back, front, cpuBack, cpuFront } = state;

// side/kindごとに打者・ボールの初期状態を作り、フォア/バックの判定
// (isBackhandFor: side=playerはfacingDir=1、side=cpuはfacingDir=-1、
// デフォルト右利きでhandSign=1)に沿うよう、打者中心からのx方向オフセットを選ぶ。
function setupHit({ hitter, side, kind }) {
  state.setState("menu"); // contactYawFor()を常にbaseYaw(回転なし)に固定し、オフセット計算を単純化する

  hitter.x = 1.2;
  hitter.y = side === "player" ? 2.4 : -2.4;
  hitter.pose = "idle";
  hitter.swingT = 0;
  hitter.recoverT = 0;
  hitter.swingSideLocked = false;
  hitter.pendingImpact = null;

  // フォア側になるxオフセットの符号は陣営で反転する（isBackhandFor参照）。
  const foreOffsetSign = side === "player" ? 1 : -1;
  const xOffset = (kind === "back") ? -foreOffsetSign * 0.6 : foreOffsetSign * 0.6;

  const bounces = kind === "volley" ? 0 : 1;
  const contactZ = kind === "smash" ? 2.0 : 0.9;

  Object.assign(ball, {
    x: hitter.x + xOffset,
    y: hitter.y + 0.35, // 打者中心とは異なるy（実打点）にしておく
    z: contactZ,
    vx: 0, vy: 0, vz: bounces === 0 ? 0 : -1, // stroke/smash=降下中、volley=ノーバウンド扱い
    bounces: bounces,
    held: false,
    serving: false,
    lastHitTime: 0,
  });

  return {
    hitter: hitter,
    side: side,
    // 「入力受付直前の実際のボール座標」= 実打点
    preHitBallX: ball.x,
    preHitBallY: ball.y,
  };
}

function callHitBall(side, byPlayer, hitter) {
  if (byPlayer) {
    hitBall({
      hitter: hitter,
      side: side,
      shot: "drive",
      charge: 0,
      aimX: hitter.x + 1.0,
      aimY: -TUNING.aim.minDepth - 2,
      contactZ: ball.z,
      byPlayer: true,
    });
  } else {
    hitBall({
      hitter: hitter,
      side: side,
      shot: "drive",
      course: 0.5,
      contactZ: ball.z,
    });
  }
}

const scenarios = [
  { name: "プレイヤー フォア", hitter: back, side: "player", byPlayer: true, kind: "fore" },
  { name: "プレイヤー バック", hitter: back, side: "player", byPlayer: true, kind: "back" },
  { name: "プレイヤー ボレー", hitter: front, side: "player", byPlayer: true, kind: "volley" },
  { name: "プレイヤー スマッシュ", hitter: front, side: "player", byPlayer: true, kind: "smash" },
  { name: "AI(CPU) フォア", hitter: cpuBack, side: "cpu", byPlayer: false, kind: "fore" },
  { name: "AI(CPU) バック", hitter: cpuBack, side: "cpu", byPlayer: false, kind: "back" },
  { name: "AI(CPU) ボレー", hitter: cpuFront, side: "cpu", byPlayer: false, kind: "volley" },
  { name: "AI(CPU) スマッシュ", hitter: cpuFront, side: "cpu", byPlayer: false, kind: "smash" },
];

for (const scenario of scenarios) {
  test(`${scenario.name}: 打球がヒッターの中心へワープせず、実際の打点から発射される`, () => {
    const setup = setupHit(scenario);
    const { hitter, preHitBallX, preHitBallY } = setup;

    // 前提: テスト設定自体がボールを打者の中心とは異なる位置に置けていること
    assert.notEqual(
      `${preHitBallX},${preHitBallY}`,
      `${hitter.x},${hitter.y}`,
      "テスト設定: 実際の打点は打者の中心座標とは異なる位置にある",
    );

    // (1) 入力受付直前: 実際のボール座標を確認済み(preHitBallX/Y)

    callHitBall(scenario.side, scenario.byPlayer, hitter);

    // (2) インパクト待機中（hitBall呼び出し直後・pendingImpact発火前）
    assert.equal(ball.held, true, "インパクト待機中はボールを保持状態にする");
    assert.equal(typeof hitter.pendingImpact, "object");
    assert.equal(hitter.pendingImpact.fired, false, "この時点ではまだ打球を発生させない");
    assert.equal(ball.x, preHitBallX,
      "待機中のボールxは実際の打点のまま（打者の中心へ書き換えない）");
    assert.equal(ball.y, preHitBallY,
      "待機中のボールyは実際の打点のまま（打者の中心へ書き換えない）");
    assert.notEqual(
      `${ball.x},${ball.y}`,
      `${hitter.x},${hitter.y}`,
      "待機中のボールは打者の中心座標へワープしていない",
    );

    // (3) 発射時（スイングがインパクト位相に到達したフレーム相当）
    // 実際の発火はmatchLoop.jsのupdate()内(pendingImpact監視ループ)がfired/nullの
    // 後始末を行うため、ここではrun()自体（インパクトの瞬間の処理）のみを検証する。
    hitter.pendingImpact.run();

    assert.equal(ball.held, false, "インパクトでボールが手元を離れる");
    assert.equal(hitter.pendingImpact.fired, false,
      "run()自体はfiredを変更しない（後始末はupdate()のpendingImpact監視ループが行う）");
    assert.equal(ball.x, preHitBallX,
      "発射開始位置(x)は保持しておいた実際の打点のまま");
    assert.equal(ball.y, preHitBallY,
      "発射開始位置(y)は保持しておいた実際の打点のまま");
    assert.notEqual(
      `${ball.x},${ball.y}`,
      `${hitter.x},${hitter.y}`,
      "発射時点でも打者の中心座標へワープしていない",
    );
    assert.equal(
      Math.hypot(ball.vx, ball.vy) > 0,
      true,
      "インパクトで実際の初速が入り、ボールが飛び始める",
    );
    assert.equal(ball.lastHitter, scenario.side);
  });
}
