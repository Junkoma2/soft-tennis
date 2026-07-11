// ダブル後衛(double-back)のAI連携・守備分担の回帰テスト。
// 「同じ球へ2人が寄る」「互いに譲って誰も打たない」「同じ位置へ重なる」
// 「空いたコースを放置する」の再発防止として、雁行陣・ダブル前衛・ダブル後衛それぞれで
// 担当決定(decideTask)とカバー移動が単一のチーム判断として矛盾なく決まることを検証する。
//
// 本物のAIロジック(aiTask.js/aiPositioning.js/aiContext.js/matchLoop.jsの物理予測)を
// そのまま読み込んで検証する（ロジックを再実装してテストしない）。state.js はDOM要素を
// 直接参照するため、Node実行用に最小限のDOMスタブ(dom-stubs.mjs)とモジュールスタブ
// (stub-loader.mjs: main.js/render.js/ai.js/input.jsのみ)を用意している。
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import "./dom-stubs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(here, "stub-loader.mjs")).href, pathToFileURL(here + path.sep).href);

const { FORMATION_BIAS, FORMATIONS } = await import("../config.js");
const state = await import("../state.js");
const { buildCtx, getCpuStyle, evaluateSituation } = await import("../aiContext.js");
const { decideTask } = await import("../aiTask.js");
const { netPlayerOf, basePlayerOf } = await import("../aiPositioning.js");

const { back, front, ball, coverageAnchor, aiDebug, setFormation, setState } = state;

let hitCounter = 0;

// main.js の applyFormation() 相当（本物はDOM副作用込みでスタブ化しているため、
// テストでは陣形テーブルの反映だけを直接行う）。
function applyFormationForTest(name) {
  setFormation(name);
  const f = FORMATIONS[name] || FORMATIONS.ganko;
  front.homeX = f.front.x; front.homeY = f.front.y;
  back.homeX = f.back.x; back.homeY = f.back.y;
  const fb = FORMATION_BIAS[name] || FORMATION_BIAS.ganko;
  front.positionBias = fb.front;
  back.positionBias = fb.back;
}

function resetAiDebug() {
  Object.assign(aiDebug.player, {
    valid: false, hitTime: null, hitterRole: null,
    air: null, rise: null, descend: null, sel: null, isLob: false,
  });
}

function setBall({ x, y, z = 0.6, vx = 0, vy = 0, vz = 4.0, bounces = 1, spin = "flat", spinMag = 1 }) {
  ball.lastHitter = "cpu";
  ball.serving = false;
  ball.bounces = bounces;
  ball.x = x; ball.y = y; ball.z = z;
  ball.vx = vx; ball.vy = vy; ball.vz = vz;
  ball.spin = spin; ball.spinMag = spinMag;
  ball.lastHitTime = ++hitCounter;
}

function setAnchor({ x = 0, y = -9, frontSide }) {
  Object.assign(coverageAnchor.player, { x, y, frontSide, set: true });
}

// aiPhase.updateRallyPhaseAI と同じ手順でctxを組み立てて decideTask を呼ぶ
// （本番の呼び出し経路と同じ引数構成で検証する）。
function runDecide(p) {
  const ctx = buildCtx("player", p);
  ctx.situation = evaluateSituation("player");
  const net = ctx.netPlayer;
  ctx.role = (p === net) ? "front" : "back";
  ctx.style = getCpuStyle(p);
  ctx.dash = 1.0;
  return decideTask(p, ctx);
}

function setupCommon() {
  setState("rally");
  state.setReceiveDone(true);
  resetAiDebug();
}

test("雁行陣: 深い球は後衛(basePlayer)固定のまま（既存挙動を維持）", () => {
  setupCommon();
  applyFormationForTest("ganko");
  front.x = front.homeX; front.y = front.homeY; // 前衛=ネット前
  back.x = back.homeX; back.y = back.homeY;     // 後衛=ベースライン
  setAnchor({ frontSide: 1 });
  // 前衛の目の前(x正側)に来た深い球でも、前衛はネットに残り後衛が処理する。
  setBall({ x: 2.0, y: 6.0, z: 0.6, vx: 0.5, vy: 4.0, vz: 4.5, bounces: 1 });

  const net = netPlayerOf("player");
  const base = basePlayerOf("player");
  const taskNet = runDecide(net);
  const taskBase = runDecide(base);

  assert.equal(taskNet.kind !== "hit", true, "前衛が深い球を直接打ちに行っていない（既存のforceBack挙動）");
  assert.equal(taskBase.kind, "hit", "後衛が深い球を打つ担当になっている");
});

test("ダブル前衛: 深い球(ロブ超え)は引き続きbasePlayerが処理する（既存挙動を維持）", () => {
  setupCommon();
  applyFormationForTest("double-front");
  front.x = front.homeX; front.y = front.homeY;
  back.x = back.homeX; back.y = back.homeY;
  setAnchor({ frontSide: 1 });
  setBall({ x: 1.0, y: 8.0, z: 0.6, vx: 0.3, vy: 4.0, vz: 4.5, bounces: 1 });

  const net = netPlayerOf("player");
  const base = basePlayerOf("player");
  const taskNet = runDecide(net);
  const taskBase = runDecide(base);

  assert.equal(taskNet.kind !== "hit", true, "ダブル前衛のnetPlayerは深い球を追わない");
  assert.equal(taskBase.kind, "hit", "ダブル前衛のbasePlayerが深い球を処理する");
});

test("ダブル後衛: 右側の深い球はゾーン担当(netPlayer)が処理し、basePlayerは反対側のカバーに留まる", () => {
  setupCommon();
  applyFormationForTest("double-back");
  front.x = 2.2; front.y = 13; front.homeY = 13;
  back.x = -2.2; back.y = 13; back.homeY = 13;
  setAnchor({ frontSide: 1 }); // 前寄り選手(netPlayer)がストレート側(右)を担当

  // 右側・深い球。修正前は「深い球=basePlayer固定」で、届かないbasePlayerに
  // 割り当てられ、実際に届くnetPlayerは自分の担当ゾーンへカバーするだけで
  // 誰も取りに行かない/両者が寄る問題が起きていた。
  setBall({ x: 3.0, y: 7.0, z: 0.6, vx: 1.5, vy: 4.0, vz: 4.5, bounces: 1 });

  const net = netPlayerOf("player");
  const base = basePlayerOf("player");
  const taskNet = runDecide(net);
  const taskBase = runDecide(base);

  assert.equal(taskNet.kind, "hit", "実際に届く側(netPlayer)が打ちに行く");
  assert.notEqual(taskBase.kind, "hit", "basePlayerは同じ球を追わない");
  // basePlayerは自陣の反対ゾーン（クロス側=左）のカバーへ戻る＝空いたコースを放置しない
  assert.equal(taskBase.x < 0, true, "basePlayerは自分の担当ゾーン(左)側へカバーしている");
  // 2人の目標が重ならない
  const dist = Math.hypot(taskNet.x - taskBase.x, taskNet.y - taskBase.y);
  assert.equal(dist > 1.0, true, `2人の移動目標が重なっていない (dist=${dist.toFixed(2)})`);
});

test("ダブル後衛: 左側の深い球は反対側のゾーン担当(basePlayer)が処理する（左右対称）", () => {
  setupCommon();
  applyFormationForTest("double-back");
  front.x = 2.2; front.y = 13; front.homeY = 13;
  back.x = -2.2; back.y = 13; back.homeY = 13;
  setAnchor({ frontSide: 1 });

  setBall({ x: -3.0, y: 7.0, z: 0.6, vx: -1.5, vy: 4.0, vz: 4.5, bounces: 1 });

  const net = netPlayerOf("player");
  const base = basePlayerOf("player");
  const taskNet = runDecide(net);
  const taskBase = runDecide(base);

  assert.equal(taskBase.kind, "hit", "左側の深い球はbasePlayerが処理する");
  assert.notEqual(taskNet.kind, "hit", "netPlayerは同じ球を追わない");
});

test("ダブル後衛: netPlayerがヒッターでないとき、深追いのポーチ/ネット詰めで相方の球へ寄らない", () => {
  setupCommon();
  applyFormationForTest("double-back");
  front.x = 1.0; front.y = 13; front.homeY = 13;
  back.x = -1.5; back.y = 13; back.homeY = 13;
  setAnchor({ frontSide: 1 });

  // netPlayer.homeY(=13)を早い時刻・低い高さで横切りつつ、実際の打点は
  // basePlayer側（反対ゾーン）へ流れていく球。前衛役が実在するなら「ネット詰め」
  // 条件(tNet<0.9・低い高さ・reach内)を満たす球だが、ダブル後衛のnetPlayerは
  // 実際にはネット際にいないため、この球に反応してはいけない。
  setBall({ x: 2.0, y: 9.0, z: 0.6, vx: -4.5, vy: 11.43, vz: 3.6, bounces: 1 });

  const net = netPlayerOf("player");
  const base = basePlayerOf("player");
  const taskBase = runDecide(base);
  const taskNet = runDecide(net);

  assert.equal(taskBase.kind, "hit", "basePlayerが単独の打ち手になっている");
  assert.equal(taskNet.kind, "cover", `netPlayerがポーチ/ネット詰めで寄っていない (kind=${taskNet.kind})`);
});

test("雁行陣: 前衛は同条件に近い場面でポーチ/ネット詰めができる（機能を壊していない）", () => {
  setupCommon();
  applyFormationForTest("ganko");
  front.x = 0.8; front.y = front.homeY; // ネット前定位置寄り
  back.x = -0.3; back.y = back.homeY;
  setAnchor({ frontSide: 1 });

  // 浅くバウンドした後に高く跳ね、そのまま深く流れていく球（後衛が最終的に
  // 処理する深い球=forceBackはganko/雁行では従来どおり有効）。前衛のネット際を
  // 低く速く早い時刻で横切るため、ポーチ/ネット詰めの対象になり得る。
  setBall({ x: 0.3, y: 1.0, z: 0.3, vx: 1.0, vy: 9.0, vz: 5.0, bounces: 1 });

  const net = netPlayerOf("player");
  const base = basePlayerOf("player");
  const taskBase = runDecide(base);
  const taskNet = runDecide(net);

  assert.equal(taskBase.kind, "hit", "深い球はganko/雁行では従来どおり後衛が処理する");
  assert.equal(taskNet.kind === "poach" || taskNet.kind === "advance", true,
    `雁行陣の前衛はポーチ/ネット詰めが機能している (kind=${taskNet.kind})`);
});
