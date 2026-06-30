import { playerStats, cpuStats } from "./state.js";

/* ===========================================================
 * 開始画面の選手ステータス調整パネル
 *
 * 各選手の stats を画面で確認し、数値入力で調整できるようにする。stats オブジェクトは
 * 選手(back/front等)の .stats と同一参照なので、ここで書き換えると試合中の挙動へ即反映される。
 * 精度（ブレ）は打点種別ごとに3分割: 通常(stroke) / ライジング(rising) / ボレー(volley)。
 * control はサーブ回転の精度に使う。handed（利き腕）は別UI（利き腕ボタン）で扱う。
 * =========================================================== */

const STAT_DEFS = [
  { key: "power",   label: "打力" },
  { key: "serve",   label: "サーブ" },
  { key: "speed",   label: "足" },
  { key: "reach",   label: "リーチ" },
  { key: "control", label: "サーブ精度" },
  { key: "stroke",  label: "通常" },
  { key: "rising",  label: "ライジング" },
  { key: "volley",  label: "ボレー" },
];

const PLAYER_DEFS = [
  { id: "p-back",  label: "自後衛",   stats: playerStats.back },
  { id: "p-front", label: "自前衛",   stats: playerStats.front },
  { id: "c-back",  label: "相手後衛", stats: cpuStats.back },
  { id: "c-front", label: "相手前衛", stats: cpuStats.front },
];

const MIN = 0.4, MAX = 1.6, STEP = 0.05;

// 標準値（初期値）をスナップショットしておき「標準値に戻す」で復元する。
const DEFAULTS = PLAYER_DEFS.map((p) => STAT_DEFS.map((s) => p.stats[s.key]));

function clampStat(v) {
  if (!Number.isFinite(v)) return 1.0;
  return Math.max(MIN, Math.min(MAX, v));
}

function buildPanel() {
  const grid = document.getElementById("stats-grid");
  if (!grid) return;

  // ヘッダ行（選手名 + 各ステータス名）
  const header = document.createElement("div");
  header.className = "stats-row stats-head";
  header.appendChild(cell("", "stats-rowlabel"));
  STAT_DEFS.forEach((s) => header.appendChild(cell(s.label, "stats-colhead")));
  grid.appendChild(header);

  const inputs = [];
  PLAYER_DEFS.forEach((p, pi) => {
    const row = document.createElement("div");
    row.className = "stats-row";
    row.appendChild(cell(p.label, "stats-rowlabel"));
    const rowInputs = [];
    STAT_DEFS.forEach((s) => {
      const wrap = document.createElement("div");
      wrap.className = "stats-cell";
      const input = document.createElement("input");
      input.type = "number";
      input.min = String(MIN);
      input.max = String(MAX);
      input.step = String(STEP);
      input.value = formatVal(p.stats[s.key]);
      input.setAttribute("aria-label", `${p.label} ${s.label}`);
      input.addEventListener("input", () => {
        const v = clampStat(parseFloat(input.value));
        p.stats[s.key] = v;
      });
      input.addEventListener("blur", () => {
        input.value = formatVal(p.stats[s.key]);
      });
      wrap.appendChild(input);
      row.appendChild(wrap);
      rowInputs.push(input);
    });
    inputs.push(rowInputs);
    grid.appendChild(row);
  });

  const resetBtn = document.getElementById("stats-reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      PLAYER_DEFS.forEach((p, pi) => {
        STAT_DEFS.forEach((s, si) => {
          p.stats[s.key] = DEFAULTS[pi][si];
          inputs[pi][si].value = formatVal(DEFAULTS[pi][si]);
        });
      });
    });
  }
}

function cell(text, className) {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return el;
}

function formatVal(v) {
  // 1.0 / 0.95 のように余分な桁を出さずに表示する
  return (Math.round(v * 100) / 100).toString();
}

buildPanel();
