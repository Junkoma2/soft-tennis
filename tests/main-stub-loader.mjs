// Node用テストローダー（rally-score-regression.test.mjs専用）。
// stub-loader.mjs との違いは main.js を実物のままロードする点。
// このテストは main.js の awardPoint/pointLabel/finishGame（得点処理・JSTA表記）を
// matchLoop.js の handleBounce/checkNet（ラリー継続・アウト/ネット判定）と結合した
// 実際の呼び出し経路のまま検証したいため、main.js はスタブしない。
// 代わりに描画・入力・チュートリアル・調整パネルなど、DOM操作が重く今回の検証に
// 不要な周辺モジュールだけをno-opスタブへ差し替える。
const STUBS = new Map([
  ["render.js", `
export function draw() {}
export function drawControlLegend() {}
export function drawServeTypeBadge() {}
export function drawHud() {}
export function drawScore() {}
export function drawBackground() {}
export function courtLine() {}
export function drawCourt() {}
export function drawNet() {}
export function drawLandingMarker() {}
export function drawAimCursor() {}
export function drawServeAimCursor() {}
export function drawGroundEffects() {}
export function drawTextEffects() {}
export function drawTimingGauge() {}
export function drawBallShadow() {}
export function drawBall() {}
`],
  ["ai.js", `
export function partnerIsServingNow() { return false; }
export function moveAutoAI() {}
export function updatePartner() {}
export function updateRallyControlledAI() {}
export function updateCpuBack() {}
export function updateCpuFront() {}
export function chooseAiHitForRallyControlled() {}
export function tryReturnAI() {}
export function cpuTryReturn() {}
export function partnerTryReturn() {}
`],
  ["input.js", `
export function setControlledX() {}
export function setControlledY() {}
export function setBackX() {}
export function startCharge() {}
export function attemptSwing() {}
export function shotFamilyForClick() { return "shoot"; }
export function selectShot() {}
export function updateAimInputs() {}
export function setActiveButton() {}
export function stickVectorFromEvent() { return { dx: 0, dy: 0 }; }
export function updateStickKnob() {}
export function ballIncomingToPlayer() { return false; }
export function distToBall() { return 0; }
export function canPlayerHit() { return false; }
export function playerHitBall() {}
`],
  ["tutorial.js", `
export function maybeStartTutorial() {}
`],
  ["playerStatsPanel.js", `
// 開始画面のステータス調整パネル生成（副作用のみ）。テストでは不要。
`],
  ["viewTuningPanel.js", `
// 開始画面の表示調整パネル生成（副作用のみ）。テストでは不要。
`],
]);

export async function resolve(specifier, context, nextResolve) {
  const name = specifier.split("/").pop();
  if (STUBS.has(name)) {
    return { url: `soft-tennis-test-stub:${name}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("soft-tennis-test-stub:")) {
    const name = url.slice("soft-tennis-test-stub:".length);
    return { format: "module", source: STUBS.get(name), shortCircuit: true };
  }
  return nextLoad(url, context);
}
