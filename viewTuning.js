/**
 * 見た目チューニング値の管理。
 *
 * 開始画面の「表示の調整」パネル（viewTuningPanel.js）から 0〜100 の自然数で
 * 調整し、描画側（player3d.js）はここの換算値を毎フレーム参照する。
 * 内部の実数値（倍率・指数）は上限下限が直感的でないため、画面上は
 * 0〜100（50=標準）に統一し、実レンジへの変換はこのモジュールに閉じ込める。
 * 値は localStorage に保存して次回起動時も引き継ぐ。
 */

export const VIEW_TUNING_DEFS = [
  // min=0のときの実値, max=100のときの実値（50が現在の標準値になるよう設定）
  { key: "charSize",   label: "キャラの大きさ",   min: 1.5, max: 3.5 }, // ビューポート縦係数(VH_K相当)
  { key: "farSize",    label: "奥の選手の拡大",   min: 1.0, max: 0.5 }, // 奥行き縮小指数(0=コートと同率)
  { key: "racketSize", label: "ラケットの大きさ", min: 1.0, max: 1.4 }, // ラケット表示倍率
];

const STORAGE_KEY = "softTennisViewTuning";
const DEFAULT = 50;

export const viewTuning = { charSize: DEFAULT, farSize: DEFAULT, racketSize: DEFAULT };

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  for (const def of VIEW_TUNING_DEFS) {
    if (Number.isFinite(saved[def.key])) viewTuning[def.key] = clamp0to100(saved[def.key]);
  }
} catch (e) { /* localStorage不可・壊れたJSONは標準値のまま */ }

function clamp0to100(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function setViewTuning(key, n) {
  if (!(key in viewTuning) || !Number.isFinite(n)) return;
  viewTuning[key] = clamp0to100(n);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(viewTuning)); } catch (e) { /* 保存不可でも動作に支障なし */ }
}

export function resetViewTuning() {
  for (const def of VIEW_TUNING_DEFS) viewTuning[def.key] = DEFAULT;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(viewTuning)); } catch (e) { /* 同上 */ }
}

// 0〜100 の管理値 → 描画側で使う実数値
export function tunedValue(key) {
  const def = VIEW_TUNING_DEFS.find((d) => d.key === key);
  if (!def) return 1;
  return def.min + (def.max - def.min) * (viewTuning[key] / 100);
}
