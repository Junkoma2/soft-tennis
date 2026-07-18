// キャラクターの頭部をボール方向へ自然に追従させる機能の回帰テスト。
// geometry.js（角度計算の単一の真実）が返す目標角度・可動域クランプ・
// 頭部トラッキングの有効判定と、player3d.js が使う補間(smoothHeadAngle)を
// 純粋な計算として検証する（描画・THREE.js本体には依存しない）。
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import "./dom-stubs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(here, "stub-loader.mjs")).href, pathToFileURL(here + path.sep).href);

const {
  headYawOffset,
  headPitchOffset,
  headTrackTarget,
  smoothHeadAngle,
} = await import("../geometry.js");
const state = await import("../state.js");

const D = Math.PI / 180;
const HEAD_YAW_MAX = 95 * D;
const HEAD_PITCH_UP_MAX = 55 * D;
const HEAD_PITCH_DOWN_MAX = 40 * D;

test("ボールが左右にあるとき、頭部の目標yawが左右へ符号どおりに振れる", () => {
  const pl = { x: 0, y: 5 };
  const yawRight = headYawOffset(pl, 2, 5, 0);
  const yawLeft = headYawOffset(pl, -2, 5, 0);
  assert.equal(yawRight > 0, true, "右のボールは正のyaw");
  assert.equal(yawLeft < 0, true, "左のボールは負のyaw");
  assert.ok(Math.abs(yawRight + yawLeft) < 1e-9, "左右対称の位置なら符号反転で同じ大きさ");
});

test("プレイヤーとボールが同一地点のときはyawが定まらないため0を返す", () => {
  const pl = { x: 1, y: 2 };
  assert.equal(headYawOffset(pl, 1, 2, 0.3), 0);
});

test("背後のボールでも180度回転させず、上限(HEAD_YAW_MAX)で止める", () => {
  const pl = { x: 0, y: 0 };
  const yaw = headYawOffset(pl, 0, -5, 0); // 体の正対(bodyYaw=0)の真後ろ
  assert.equal(Math.abs(yaw) < Math.PI, true, "180度(π)未満で止まる");
  assert.ok(Math.abs(Math.abs(yaw) - HEAD_YAW_MAX) < 1e-6, "クランプ上限ちょうどで止まる");
});

test("頭上・至近距離のボールは見上げ、クランプ上限を超えない", () => {
  const pitch = headPitchOffset(1.6, 3.0, 0.5);
  assert.equal(pitch < 0, true, "上を見るときはpitchが負");
  assert.equal(pitch >= -HEAD_PITCH_UP_MAX - 1e-9, true, "見上げの上限を超えない");
});

test("足元付近の低いボールは見下ろし、クランプ上限を超えない", () => {
  const pitch = headPitchOffset(1.6, 0.2, 1.0);
  assert.equal(pitch > 0, true, "下を見るときはpitchが正");
  assert.equal(pitch <= HEAD_PITCH_DOWN_MAX + 1e-9, true, "見下げの上限を超えない");
});

test("水平距離がほぼ0（トス直下）でも仰角が発散せず、見上げ上限にクランプされる", () => {
  const pitch = headPitchOffset(1.6, 3.1, 0);
  assert.ok(Math.abs(pitch + HEAD_PITCH_UP_MAX) < 1e-6, "最小距離フォールバックでクランプ上限に張り付く");
});

test("headTrackTarget: ポイント終了などの無効な状態では正面(0,0)・非アクティブを返す", () => {
  state.setState("point");
  Object.assign(state.ball, { x: 3, y: 3, z: 1.0 });
  const target = state.back;
  const result = headTrackTarget(target, 0, 1.6);
  assert.deepEqual(result, { yaw: 0, pitch: 0, active: false });
});

test("headTrackTarget: ラリー中は有効になり、geometry.jsの計算と一致する", () => {
  state.setState("rally");
  const pl = state.back;
  Object.assign(pl, { x: 0, y: 8 });
  Object.assign(state.ball, { x: 2, y: 4, z: 1.2 });
  const result = headTrackTarget(pl, 0, 1.6);
  assert.equal(result.active, true);
  assert.equal(result.yaw, headYawOffset(pl, state.ball.x, state.ball.y, 0));
  const dist = Math.hypot(state.ball.x - pl.x, state.ball.y - pl.y);
  assert.equal(result.pitch, headPitchOffset(1.6, state.ball.z, dist));
});

test("headTrackTarget: ボール座標が無効(NaN)なら非アクティブ", () => {
  state.setState("rally");
  Object.assign(state.ball, { x: NaN, y: 4, z: 1.2 });
  const result = headTrackTarget(state.back, 0, 1.6);
  assert.equal(result.active, false);
});

test("smoothHeadAngle: 急に切り替えず、dt分だけ目標へ近づく（1フレームで到達しない）", () => {
  const next = smoothHeadAngle(0, 1, 0.1, 10);
  assert.equal(next > 0 && next < 1, true, "目標との間の値になる（瞬間反転・過回転しない）");
});

test("smoothHeadAngle: 十分な時間が経てば目標角度へ収束する（正面復帰の確認）", () => {
  let cur = 1.2; // 何らかの向きを向いていた状態
  const target = 0; // 正面へ戻す
  for (let i = 0; i < 200; i++) {
    cur = smoothHeadAngle(cur, target, 1 / 60, 9);
  }
  assert.ok(Math.abs(cur - target) < 1e-4, "十分なフレーム数で正面へ収束する");
});

test("smoothHeadAngle: 収束過程でtargetを飛び越えない（振動しない）", () => {
  let cur = 0;
  const target = 0.8;
  let prevDiff = Math.abs(target - cur);
  for (let i = 0; i < 30; i++) {
    cur = smoothHeadAngle(cur, target, 1 / 60, 9);
    const diff = Math.abs(target - cur);
    assert.equal(diff <= prevDiff, true, "毎フレーム目標との差が単調に縮む");
    prevDiff = diff;
  }
});
