import { VIEW_TUNING_DEFS, viewTuning, setViewTuning, resetViewTuning } from "./viewTuning.js";

/* ===========================================================
 * 開始画面の「表示の調整」パネル
 *
 * 見た目チューニング値（viewTuning.js）をスライダー＋数値入力で調整する。
 * 画面上はすべて 0〜100 の自然数（50=標準）。実レンジへの換算は
 * viewTuning.js 側に閉じているため、ここでは 0〜100 だけを扱う。
 * 描画側は毎フレーム参照するので、試合中に戻って再調整→即反映できる。
 * =========================================================== */

function buildPanel() {
  const grid = document.getElementById("view-tuning-grid");
  if (!grid) return;

  const inputs = new Map(); // key -> { slider, number }

  VIEW_TUNING_DEFS.forEach((def) => {
    const row = document.createElement("div");
    row.className = "vt-row";

    const label = document.createElement("span");
    label.className = "vt-label";
    label.textContent = def.label;
    row.appendChild(label);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.value = String(viewTuning[def.key]);
    slider.setAttribute("aria-label", def.label);
    row.appendChild(slider);

    const number = document.createElement("input");
    number.type = "number";
    number.className = "vt-number";
    number.min = "0";
    number.max = "100";
    number.step = "1";
    number.value = String(viewTuning[def.key]);
    number.setAttribute("aria-label", `${def.label}（数値）`);
    row.appendChild(number);

    slider.addEventListener("input", () => {
      setViewTuning(def.key, parseInt(slider.value, 10));
      number.value = String(viewTuning[def.key]);
    });
    number.addEventListener("input", () => {
      setViewTuning(def.key, parseInt(number.value, 10));
      slider.value = String(viewTuning[def.key]);
    });
    number.addEventListener("blur", () => {
      number.value = String(viewTuning[def.key]);
    });

    inputs.set(def.key, { slider, number });
    grid.appendChild(row);
  });

  const note = document.createElement("p");
  note.className = "vt-note";
  note.textContent = "0〜100で調整（50=標準）。設定は保存され、次回起動時も引き継がれます。";
  grid.appendChild(note);

  const resetBtn = document.getElementById("view-tuning-reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      resetViewTuning();
      inputs.forEach(({ slider, number }, key) => {
        slider.value = String(viewTuning[key]);
        number.value = String(viewTuning[key]);
      });
    });
  }
}

buildPanel();
