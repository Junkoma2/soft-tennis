// state.js はモジュール読込時に document.getElementById / canvas.getContext /
// localStorage を直接参照する（ブラウザ前提）。Node上でAIロジックのみを検証するため、
// 実際のDOM操作を必要としない最小限のダミーを用意する。見た目・描画は検証対象外。
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
  };
  return el;
}

globalThis.document = {
  getElementById() { return stubElement(); },
  createElement() { return stubElement(); },
  addEventListener() {},
  removeEventListener() {},
};

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};

if (typeof globalThis.performance === "undefined") {
  globalThis.performance = { now: () => Date.now() };
}
