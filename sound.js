/* ===========================================================
 * 効果音（打球・ミス・得点・ゲーム終了）
 *
 * 追加バイナリ資産を持ち込まず、Web Audio API の合成音のみで鳴らす。
 * ブラウザの自動再生制限を避けるため、AudioContext の生成/再開は
 * unlockAudio()（ユーザー操作起点。main.js の開始ボタンから1回呼ぶ）で行う。
 * 呼び出し側（matchLoop.js/main.js/serve.js）はゲーム進行と無関係な
 * 副作用のみを持つため、鳴らなくても既存の進行には影響しない。
 * =========================================================== */

let ctx = null;

function getCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch (e) {
    ctx = null;
  }
  return ctx;
}

// ユーザー操作（開始ボタン押下）を起点に AudioContext を生成・再開する。
// 以降の再生はこの呼び出しが無いと（特にSafari等で）鳴らないことがある。
export function unlockAudio() {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(function () {});
}

// 単音（サイン波等）を delay 秒後から duration 秒鳴らす。
// freqTo を指定すると周波数を指数的に freqTo までスライドさせる（打撃/ブザー感を出す）。
function playTone(freq, duration, opts) {
  const c = getCtx();
  if (!c || c.state !== "running") return;
  opts = opts || {};
  const delay = opts.delay || 0;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = opts.type || "sine";
  osc.frequency.setValueAtTime(Math.max(1, freq), t0);
  if (opts.freqTo != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqTo), t0 + duration);
  }
  const g = c.createGain();
  const peak = opts.gain != null ? opts.gain : 0.18;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, duration * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// 短いノイズバースト（打球のインパクト感に使う）。
function playNoiseBurst(duration, opts) {
  const c = getCtx();
  if (!c || c.state !== "running") return;
  opts = opts || {};
  const t0 = c.currentTime + (opts.delay || 0);
  const size = Math.max(1, Math.floor(c.sampleRate * duration));
  const buffer = c.createBuffer(1, size, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < size; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / size);
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filt = c.createBiquadFilter();
  filt.type = opts.filterType || "bandpass";
  filt.frequency.value = opts.filterFreq || 1200;
  filt.Q.value = opts.filterQ != null ? opts.filterQ : 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain != null ? opts.gain : 0.22, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(filt).connect(g).connect(c.destination);
  src.start(t0);
}

// 打球成功: 短いインパクト音。スマッシュは鋭く強めの音にする。
export function playHitSound(isSmash) {
  if (isSmash) {
    playNoiseBurst(0.1, { filterType: "highpass", filterFreq: 1800, gain: 0.32 });
    playTone(520, 0.12, { type: "triangle", freqTo: 220, gain: 0.22 });
  } else {
    playNoiseBurst(0.06, { filterType: "bandpass", filterFreq: 1000, gain: 0.16 });
  }
}

// ミス（アウト・ネット・ツーバウンド・フォルト）: 低く短いブザー音。
export function playMissSound() {
  playTone(190, 0.16, { type: "sawtooth", freqTo: 90, gain: 0.13 });
}

// 得点: 明るい2音の上昇チャイム。baseDelay は開始タイミングのオフセット(秒)。
// ミス音(playMissSound)の直後に鳴らして「ミス→得点」の一連の出来事として聴かせる用途を想定。
export function playPointSound(baseDelay) {
  const d = baseDelay || 0;
  playTone(660, 0.12, { type: "sine", gain: 0.2, delay: d });
  playTone(880, 0.16, { type: "sine", gain: 0.2, delay: d + 0.09 });
}

// ゲーム/試合終了: 勝敗で異なる短いファンファーレ。isMatch=true で試合の決着（より長め）。
// baseDelay は開始タイミングのオフセット(秒)。ゲーム獲得時は直前の得点チャイムと
// 重なりすぎないよう、呼び出し側で少し後ろにずらす想定。
export function playGameEndSound(won, isMatch, baseDelay) {
  const d = baseDelay || 0;
  const notes = won ? [660, 784, 988, 1318] : [520, 440, 349];
  const noteDur = isMatch ? 0.26 : 0.2;
  const step = isMatch ? 0.13 : 0.11;
  notes.forEach(function (f, i) {
    playTone(f, noteDur, {
      type: won ? "triangle" : "sine",
      gain: 0.17,
      delay: d + i * step,
    });
  });
}
