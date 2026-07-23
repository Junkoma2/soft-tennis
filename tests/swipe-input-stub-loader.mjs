// input.js 自体（テスト対象の本物）はそのままロードしつつ、input.jsが依存する
// 重い連鎖（matchLoop.js→render.js/ai.js等）だけをno-opスタブへ差し替えるための
// 専用ローダー。stub-loader.mjs は input.js 自体もスタブしてしまうため、
// スワイプの狙い計算(computeSwipeAim/swipePowerFromMotion)を実物で検証する
// このテストでは使えず、別ファイルとして用意する。
const STUBS = new Map([
  ["main.js", `
export function updateMouseAimFromEvent() {}
`],
  ["matchLoop.js", `
export function chargeAmount() { return 0; }
export function hitBall() {}
export function canSwingNow() { return true; }
`],
  ["serve.js", `
export function playerServeAction() {}
export function clampServeAimCursor() {}
export function resetServeAimCursor() {}
export function playerIsServer() { return false; }
`],
  ["hit-detection.js", `
export function hitLineInfo() { return { active: false }; }
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
