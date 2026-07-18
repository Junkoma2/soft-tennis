// デバッグ軌道表示（render.jsのdrawDebugTrajectory）の予測着地点が
// フレームごとにぶれる不具合の回帰テスト。
//
// 背景: 旧実装はrender.js内で固定0.055秒刻み・地面通過時の補間なし・
// magCapハードコード(1.3、実際はTUNING.spin.magCap=1.6)という、実際の
// ボール更新(matchLoop.jsのupdate())とは異なる粗い簡易計算を毎フレーム
// 独自に行っていた。そのため地面通過までのステップ数がフレームごとに
// 切り替わるたびに、最後の1ステップ分（最大で vx/vy × 0.055秒相当）
// 着地点の予測がジャンプし、見た目のちらつきになっていた。
//
// 修正では、実際の更新処理とデバッグ予測の両方が
//   stepBallState()   … 重力・回転による沈み込み・空気抵抗の1ステップ計算
//   bounceCoeffs()/bounceVelocity() … 回転の種類・強さからバウンドの反発/摩擦を計算
//   simulateTrajectory() … 上記2つを使い、地面通過時のx/yを実際の更新処理と
//                          同じ「前フレームの高さで線形補間」する予測積分
// を共有する。このテストは、
//   1. 同じ刻み幅を与えれば予測と実際の更新処理がビット同一の着地点を計算すること
//      （＝同じ計算を使っていること自体の検証）
//   2. 実運用の細かい既定刻み幅で行う予測が、実際の着地点と現実的な許容誤差内で
//      一致すること
//   3. 同一の球筋について、飛行中のどの時刻から予測してもほぼ同じ着地点になる
//      こと（＝フレームごとの着地点ジャンプが解消されていること）
//   4. バウンド係数(bounceCoeffs)がTUNING.spin.magCapを使い、旧render.js実装の
//      ハードコード値(1.3)とは食い違わないこと
// を、通常球・回転球・スマッシュの各球種で検証する。
//
// hit-ball-contact-point.test.mjs / rally-score-regression.test.mjs と同じ方針で、
// matchLoop.js/state.js/config.jsの本物の実装をそのままロードして検証する
// （DOM/描画/AI/入力に依存するファイルのみstub-loader.mjsでスタブする）。
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
const { update, simulateTrajectory, bounceCoeffs } = await import("../matchLoop.js");

const { ball } = state;

function resetBall(init) {
  state.setState("rally");
  Object.assign(
    ball,
    { bounces: 0, held: false, serving: false, lastHitter: "player", flashT: 0, trail: [], flightSink: null },
    init,
  );
}

function snapshotBall() {
  return {
    x: ball.x, y: ball.y, z: ball.z,
    vx: ball.vx, vy: ball.vy, vz: ball.vz,
    spin: ball.spin, spinMag: ball.spinMag,
    flightSink: ball.flightSink ? Object.assign({}, ball.flightSink) : null,
    bounces: ball.bounces,
  };
}

function firstLanding(pts, startBounces) {
  return pts.find((p) => p.bounces === startBounces + 1) || null;
}

// 実際のupdate()をdtStepで繰り返し呼び、次にbounces数が増えた瞬間の(x, y)を返す。
function runToNextBounce(dtStep, maxSteps) {
  const startBounces = ball.bounces;
  const limit = maxSteps || 4000;
  for (let i = 0; i < limit; i++) {
    update(dtStep);
    if (ball.bounces > startBounces) {
      return { x: ball.x, y: ball.y };
    }
  }
  throw new Error("バウンドが検出されないままステップ上限に達した（テスト設定を見直す）");
}

// 通常球(flat)・回転球(drive/slice/drop)・ロブ・スマッシュ、一通りの球種。
const SHOTS = [
  { key: "flat", spin: "flat", spinMag: TUNING.shots.flat.spinMag, speed: TUNING.shots.flat.speed },
  { key: "drive", spin: "drive", spinMag: TUNING.shots.drive.spinMag, speed: TUNING.shots.drive.speed },
  { key: "slice", spin: "slice", spinMag: TUNING.shots.slice.spinMag, speed: TUNING.shots.slice.speed },
  { key: "drop", spin: "slice", spinMag: TUNING.shots.drop.spinMag, speed: TUNING.shots.drop.speed },
  { key: "lob", spin: "flat", spinMag: TUNING.shots.lob.spinMag, speed: TUNING.shots.lob.speed },
  { key: "smash", spin: "drive", spinMag: TUNING.shots.smash.spinMag, speed: TUNING.shots.smash.speed },
];

// 打球後の飛行を模した初期状態。z0=1.1m・vz=4.2m/sは全球種共通にし、
// 水平速度だけ球種ごとの基準speedからスケールする（ネットの上を安全に
// 通過し、ラリー中の打球として現実的な着地になるよう選定）。
function buildInitialBall(shot) {
  const speed = shot.speed;
  return {
    x: 0.8, y: 7.5, z: 1.1,
    vx: speed * 0.18,
    vy: -speed * 0.82,
    vz: 4.2,
    spin: shot.spin,
    spinMag: shot.spinMag,
    flightSink: null,
    bounces: 0,
  };
}

for (const shot of SHOTS) {
  test(`${shot.key}: 同じ刻み幅を与えれば予測(simulateTrajectory)と実際の更新処理(update)は同一の着地点を計算する`, () => {
    const init = buildInitialBall(shot);
    resetBall(init);

    const dtStep = 1 / 60;
    const predicted = simulateTrajectory(snapshotBall(), { physicsDt: dtStep, stride: 1 });
    const landing = firstLanding(predicted, init.bounces);
    assert.ok(landing, "予測が最初のバウンド地点を含む");

    resetBall(init);
    const actual = runToNextBounce(dtStep);

    // 実際の更新処理(update)とsimulateTrajectoryはどちらもstepBallState/
    // bounceCoeffs/bounceVelocityを共有し、地面通過時の補間方法も同じため、
    // 同じ刻み幅を与えれば浮動小数点誤差の範囲でビット同一になるはず。
    assert.ok(Math.abs(landing.x - actual.x) < 1e-6, `x差が大きい: ${landing.x} vs ${actual.x}`);
    assert.ok(Math.abs(landing.y - actual.y) < 1e-6, `y差が大きい: ${landing.y} vs ${actual.y}`);
  });
}

for (const shot of SHOTS) {
  test(`${shot.key}: 実運用の既定刻み幅での予測着地点は、実際の着地点と許容誤差内で一致する`, () => {
    const init = buildInitialBall(shot);
    resetBall(init);

    const predicted = simulateTrajectory(snapshotBall());
    const landing = firstLanding(predicted, init.bounces);
    assert.ok(landing, "予測が最初のバウンド地点を含む");

    resetBall(init);
    const actual = runToNextBounce(1 / 60);

    const err = Math.hypot(landing.x - actual.x, landing.y - actual.y);
    // 実際の更新処理は毎フレームdt(≈1/60秒)刻みの粗い積分のため、より細かい
    // 刻みで積分する予測(既定1/240秒)とは、実際のボール自体が持つフレーム
    // 刻みの積分誤差の分だけ差が生じうる（これは予測側の不具合ではなく、
    // 実際の更新処理自体の離散化誤差。実測でおよそ0.1〜0.35m程度）。
    // それでも旧実装（開始時刻次第で1m超ずれる）とは桁違いに小さいことを
    // 確認するため、0.5mを許容誤差とする。
    assert.ok(err < 0.5, `${shot.key}: 予測着地点と実際の着地点の差が大きすぎる (err=${err.toFixed(4)}m)`);
  });
}

test("バウンド直前まで、フレームごとの予測着地点が前後にジャンプしない（フレームレート変動あり）", () => {
  // 旧不具合の症状は「予測が長い時間をかけて少しずつドリフトする」ことではなく、
  // フレーム間で着地点がジャンプ（ちらつき）することだった（旧実装で実測: 同一球筋・
  // 隣接フレーム間で最大約0.89m）。実際の飛行はフレームdt(≈16〜33ms)の粗い積分の
  // 積み重ねのため、時間が経つほど予測が真の着地点から緩やかにドリフトするのは
  // 正常（実際の更新処理自体の離散化誤差。他のテストで別途検証）。ここでは
  // 「隣接フレーム間の予測着地点の変化量」だけを見て、ジャンプが解消されている
  // ことを検証する。
  for (const shot of SHOTS) {
    const init = buildInitialBall(shot);
    resetBall(init);

    const samples = [];
    samples.push(firstLanding(simulateTrajectory(snapshotBall()), init.bounces));

    // 実際のフレームレート変動(16ms〜33ms程度、rAFの揺れを想定)を模した
    // 可変dtで飛行を進めながら、複数の時刻で予測を取り直す。
    const frameDts = [0.016, 0.033, 0.02, 0.018, 0.025, 0.017, 0.021, 0.016, 0.03, 0.019];
    let i = 0;
    while (ball.bounces === init.bounces) {
      update(frameDts[i % frameDts.length]);
      i++;
      if (ball.bounces === init.bounces) {
        samples.push(firstLanding(simulateTrajectory(snapshotBall()), ball.bounces));
      }
      if (i > 500) throw new Error(`${shot.key}: バウンドが検出されないままステップ上限に達した`);
    }

    assert.ok(samples.length > 5, `${shot.key}: 複数時点のサンプルが取れている`);
    for (let k = 1; k < samples.length; k++) {
      assert.ok(samples[k] && samples[k - 1], `${shot.key}: 予測が着地点を返している`);
      const delta = Math.hypot(samples[k].x - samples[k - 1].x, samples[k].y - samples[k - 1].y);
      // 旧実装は隣接フレーム間で最大約0.89mジャンプすることを確認済み。
      // 新実装は物理的に連続なドリフトのみになるはずなので、1フレームあたりの
      // 変化量は数cm未満に収まる。
      assert.ok(delta < 0.05, `${shot.key}: フレーム${k}で着地点推定がジャンプしている (delta=${delta.toFixed(4)}m)`);
    }
  }
});

test("バウンド係数(bounceCoeffs)はTUNING.spin.magCapを使う（render.js旧実装の1.3ハードコードとは食い違う値）", () => {
  const spinMag = 1.5; // dropのspinMag(1.5)。旧render.js実装はmin(1.3, spinMag)にクランプしていた
  const coeffs = bounceCoeffs("slice", spinMag);

  const sp = TUNING.spin.slice;
  const flat = TUNING.spin.flat;
  const kExpected = Math.min(TUNING.spin.magCap, spinMag); // 実際のhandleBounceと同じ式
  const restitutionExpected = Math.max(0.12, Math.min(0.78, flat.restitution + (sp.restitution - flat.restitution) * kExpected));
  const frictionExpected = Math.max(0.3, Math.min(0.97, flat.friction + (sp.friction - flat.friction) * kExpected));

  assert.ok(Math.abs(coeffs.restitution - restitutionExpected) < 1e-9);
  assert.ok(Math.abs(coeffs.friction - frictionExpected) < 1e-9);

  // TUNING.spin.magCapが1.3より大きい設定になっている前提を確認した上で、
  // 旧render.js実装のハードコード値(1.3)を使うと異なる値になることを示す。
  assert.ok(TUNING.spin.magCap > 1.3, "このテストの前提: TUNING.spin.magCapは1.3より大きい");
  const kOldBuggy = Math.min(1.3, spinMag);
  const restitutionOldBuggy = Math.max(0.12, Math.min(0.78, flat.restitution + (sp.restitution - flat.restitution) * kOldBuggy));
  assert.notEqual(coeffs.restitution, restitutionOldBuggy,
    "TUNING.spin.magCapと旧render.js実装のハードコード値(1.3)は一致しないため、spinMag>1.3では値が変わるはず");
});

test("回帰: 無回転(flat, spinMag=1)の反発係数は規格準拠(restitution≈0.74)のまま変わっていない", () => {
  // AGENTS.md「物理パラメータの基準」: 規格準拠のフラットコートはrestitution≈0.74。
  // 今回の共通化(bounceCoeffs)で実際のバウンド挙動を変えていないことの確認。
  const coeffs = bounceCoeffs("flat", 1);
  assert.ok(Math.abs(coeffs.restitution - 0.74) < 1e-9);
});
