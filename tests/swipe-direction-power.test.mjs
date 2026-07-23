// スワイプ操作の改善（バックログ: 「強くスワイプしたら深く飛んでほしい。方向が多少
// 雑でも打てる範囲でうまく解釈してほしい」）の回帰テスト。
// スワイプの生ベクトル(dx,dy)をそのまま座標へ変換するのではなく、速さ由来の威力(power)を
// (1)方向への信頼度(雑なスワイプほど中心寄りに丸める) (2)深さへの上乗せ(強く振るほど深く飛ぶ)
// の両方に使っていることを、input.js の実物のロジックで検証する。
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import "./dom-stubs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(
  pathToFileURL(path.join(here, "swipe-input-stub-loader.mjs")).href,
  pathToFileURL(here + path.sep).href,
);

const { computeSwipeAim, swipePowerFromMotion } = await import("../input.js");

test("swipePowerFromMotion: 遅い/短いスワイプは威力0、速いスワイプは威力1に近づく", () => {
  // ほぼ動いていない(タップに近い)場合は威力0
  assert.equal(swipePowerFromMotion(2, 200), 0);
  // 非常に速いスワイプ(短時間で大きく移動)は威力の上限1にクランプされる
  assert.equal(swipePowerFromMotion(500, 50), 1);
  // 中間の速さは0と1の間になる
  const mid = swipePowerFromMotion(120, 150);
  assert.ok(mid > 0 && mid < 1, `mid power should be between 0 and 1, got ${mid}`);
});

test("swipePowerFromMotion: 移動距離が同じでも速く振るほど威力が上がる", () => {
  const slow = swipePowerFromMotion(150, 400); // ゆっくり動かした
  const fast = swipePowerFromMotion(150, 100); // 同じ距離を素早く動かした
  assert.ok(fast > slow, `fast swipe power (${fast}) should exceed slow swipe power (${slow})`);
});

test("computeSwipeAim: 威力が高いほど深く(より負のy)飛ぶ", () => {
  const baseX = 0, baseY = -9.0;
  const dx = 50, dy = -80; // 奥へのスワイプ
  const worldPerPxX = 0.02, worldPerPxY = 0.03;

  const weak = computeSwipeAim(baseX, baseY, dx, dy, worldPerPxX, worldPerPxY, 0);
  const strong = computeSwipeAim(baseX, baseY, dx, dy, worldPerPxX, worldPerPxY, 1);

  assert.ok(strong.y < weak.y,
    `strong swipe (power=1, y=${strong.y}) should land deeper than weak swipe (power=0, y=${weak.y})`);
  // 上乗せ量が無視できるほど小さくないこと（実質的な深さの違いを保証する）
  assert.ok(weak.y - strong.y > 0.5, "power differences should meaningfully change depth");
});

test("computeSwipeAim: 威力が低い(雑・弱い)スワイプほど左右のブレを中心寄りに丸める", () => {
  const baseX = 0, baseY = -9.0;
  const dx = 200, dy = -10; // 横方向に大きくブレたスワイプ
  const worldPerPxX = 0.02, worldPerPxY = 0.03;

  const weak = computeSwipeAim(baseX, baseY, dx, dy, worldPerPxX, worldPerPxY, 0);
  const strong = computeSwipeAim(baseX, baseY, dx, dy, worldPerPxX, worldPerPxY, 1);

  const weakLateral = Math.abs(weak.x - baseX);
  const strongLateral = Math.abs(strong.x - baseX);
  assert.ok(weakLateral > 0, "even a weak swipe should still nudge the aim somewhat");
  assert.ok(weakLateral < strongLateral,
    `weak/careless swipe lateral offset (${weakLateral}) should be smaller than a decisive fast swipe (${strongLateral})`);
});

test("computeSwipeAim: dxが0なら威力にかかわらず左右へはブレない", () => {
  const result = computeSwipeAim(0, -9.0, 0, -50, 0.02, 0.03, 0.7);
  assert.equal(result.x, 0);
});
