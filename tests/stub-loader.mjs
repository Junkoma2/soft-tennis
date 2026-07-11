// Node用テストローダー: DOM/描画に強く依存し、importするだけで副作用（DOM操作・
// requestAnimationFrame起動・イベント登録）が走るファイルを、テストに必要な分だけの
// no-opスタブへ差し替える。AIロジック本体（aiTask.js/aiPositioning.js/aiContext.js/
// matchLoop.jsの物理予測など）は実物をそのままロードし、実コードでシナリオを検証する。
const STUBS = new Map([
  ["main.js", `
export function awardPoint() {}
export function pointLabel() { return ""; }
export function showMessage() {}
export function hideMessage() {}
export function setControlMode() {}
export function updateMouseAimFromEvent() {}
export function showScreen() {}
export function isFinalGame() { return false; }
export function updateScoreboard() {}
export function applyFormation() {}
export function startMatch() {}
export function endMatch() {}
`],
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
