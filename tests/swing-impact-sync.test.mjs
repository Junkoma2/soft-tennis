// PR #69で導入した「スイングのインパクト姿勢に達したフレームで打球を発生する」
// 状態機械の回帰テスト。animation3d.jsとmatchLoop.jsの本物の実装を読み込み、
// 見た目のキーフレームとゲーム上の打球イベントが同じ位相を使うことを検証する。
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import "./dom-stubs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(here, "stub-loader.mjs")).href, pathToFileURL(here + path.sep).href);

const { TUNING } = await import("../config.js");
const { impactPhaseFor, swingPhaseOf } = await import("../animation3d.js");
const state = await import("../state.js");
const { hitBall, update } = await import("../matchLoop.js");

const { ball, back, front } = state;

function prepareHit(hitter, visualSide) {
  state.setState("menu");
  Object.assign(hitter, {
    x: visualSide === "back" ? 1 : -1,
    y: hitter === front ? -2 : -10,
    pose: "idle",
    swingT: 0,
    recoverT: 0,
    swingSide: visualSide,
    swingSideLocked: true,
    pendingImpact: null,
  });
  Object.assign(ball, {
    x: 0,
    y: hitter.y,
    z: 0.8,
    vx: 0,
    vy: 0,
    vz: -1,
    bounces: 1,
    held: false,
    serving: false,
  });

  hitBall({
    side: "player",
    hitter,
    shot: "drive",
    course: 0,
    contactZ: ball.z,
  });
}

for (const scenario of [
  { name: "前衛フォア", hitter: front, side: "fore", isFront: true },
  { name: "後衛フォア", hitter: back, side: "fore", isFront: false },
  { name: "バック", hitter: back, side: "back", isFront: false },
]) {
  test(`${scenario.name}: インパクト姿勢に達したフレームで打球が発生する`, () => {
    prepareHit(scenario.hitter, scenario.side);

    const impactPhase = impactPhaseFor(scenario.side, scenario.isFront);
    assert.equal(scenario.hitter.pendingImpact.phase, impactPhase,
      "打球イベントがアニメーションのインパクト位相を使う");
    assert.equal(ball.held, true, "スイング開始時点ではボールを手元に保持する");

    const beforeImpact = impactPhase - 0.01;
    update(TUNING.tempo.swingDuration * beforeImpact);
    assert.equal(swingPhaseOf(scenario.hitter) < impactPhase, true,
      "アニメーションがインパクト姿勢の直前にある");
    assert.equal(ball.held, true, "インパクト姿勢の直前では打球を発生しない");

    update(TUNING.tempo.swingDuration * 0.01);
    assert.equal(swingPhaseOf(scenario.hitter) >= impactPhase, true,
      "アニメーションがインパクト姿勢に到達する");
    assert.equal(ball.held, false, "インパクト姿勢への到達と同じフレームで打球を発生する");
    assert.equal(scenario.hitter.pendingImpact, null, "打球イベントは一度だけ消費される");
    assert.equal(ball.lastHitter, "player");
  });
}
