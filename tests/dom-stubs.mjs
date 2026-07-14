// state.js はモジュール読込時に document.getElementById / canvas.getContext /
// localStorage を直接参照する（ブラウザ前提）。Node上でAIロジックのみを検証するため、
// 実際のDOM操作を必要としない最小限のダミーを用意する。見た目・描画は検証対象外。
//
// main.js を実物のままロードするテスト（rally-score-regression.test.mjs）向けに、
// window / requestAnimationFrame / querySelectorAll も最小限スタブしている
// （main.jsのトップレベルでsyncViewport()やwindow.addEventListener("resize", ...)が
// 実行されるため）。
function stubElement() {
  const el = {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {},
    hidden: false,
    textContent: "",
    className: "",
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    setAttribute() {},
    getAttribute() { return null; },
    getContext() {
      return new Proxy({}, {
        get() { return () => {}; },
        set() { return true; },
      });
    },
    getBoundingClientRect() { return { width: 960, height: 540, top: 0, left: 0 }; },
    parentElement: null,
    onclick: null,
    querySelector() { return stubElement(); },
    querySelectorAll() { return []; },
  };
  return el;
}

globalThis.document = {
  getElementById() { return stubElement(); },
  createElement() { return stubElement(); },
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll() { return []; },
};

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};

if (typeof globalThis.performance === "undefined") {
  globalThis.performance = { now: () => Date.now() };
}

if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
  };
}

if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = () => 0;
}
if (typeof globalThis.cancelAnimationFrame === "undefined") {
  globalThis.cancelAnimationFrame = () => {};
}
