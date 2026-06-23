/**
 * 描画モード切り替えフラグ（2D / 3D）
 *
 * Three.js を読み込まない軽量モジュール。render.js から参照しても
 * 3D 資産はロードされない（実際の 3D 初期化は player3d.js 側で遅延ロード）。
 */

const state = { mode: "2d" }; // "2d" | "3d"

// 初期値：URL ?render=3d または localStorage を尊重
try {
  const params = new URLSearchParams(location.search);
  if (params.get("render") === "3d") state.mode = "3d";
  else if (localStorage.getItem("st_render_mode") === "3d") state.mode = "3d";
} catch (e) { /* SSR等は無視 */ }

export function is3D() {
  return state.mode === "3d";
}

export function getRenderMode() {
  return state.mode;
}

export function setRenderMode(m) {
  state.mode = m === "3d" ? "3d" : "2d";
  try { localStorage.setItem("st_render_mode", state.mode); } catch (e) {}
}
