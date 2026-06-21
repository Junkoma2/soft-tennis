import {
  TUNING, COURT, FORMATIONS,
  PLAYER_X_LIMIT, Y_RANGE_BACK, Y_RANGE_FRONT, HIT_REACH, SHOT_FAMILY_ORDER,
} from "./config.js";

import {
  keysWasd, setSpaceHeld, spaceHeld, state, charge, matchTime, aim,
  spectatorMode, rallyControlled, ball,
  setPendingSwing, setPendingShot, setPendingPower, setPendingAimX, setPendingAimY,
  selectedShot, setSelectedShot, shotSelectControls, mouseAim, stick, swipe,
  serveAimCursor, chargeBtn, servePowerControls, serveSpinControls,
  setServePower, setServeSpin, aggressionControls, setPartnerAggressiveness,
  setPlayerPosition, formationControls, setFormation, formation,
  handedControls, setPlayerHanded,
  setSpectatorMode, startBtn, moveStick, moveStickKnob,
  playerPicker, pickerPlayerBack, pickerPlayerFront, pickerCpuBack, pickerCpuFront, playerPosition,
  canvas, back, front, setBallHittableSince, appRoot,
  inputMode, setInputMode, inputModeControls,
} from "./state.js";

import {
  chargeAmount, hitBall, updateMouseAimFromEvent,
} from "./main.js";

import {
  playerServeAction, clampServeAimCursor, resetServeAimCursor, playerIsServer,
} from "./serve.js";

/* ===========================================================
 * プレイヤー操作
 *
 * 確定操作（PC・マウス主体）:
 * - 移動: WASD（左手）専用。矢印キーは廃止。打点ゾーン中も常に移動できる（操作ロックなし）
 * - 狙い: マウス。マウスが指すコート地点へ着地カーソルが追従（ため中もトス/サーブ時も）
 * - 打球: 打点ゾーンに入ると自動でため開始。
 *     左クリック=シュート / 右クリック=カット / Space+クリック=ロブ でその場でスイング
 *   ゾーン手前の早打ちは予約スイング（ゾーン到達時に同じ球種で自動スイング）
 * - サーブ: 左クリックでトス（統一トス）→
 *   適正打点の高さで左クリック=フラットサーブ、右クリック=カットサーブ。
 *   マウスで対角サービスコート内の狙いを指す
 * - スマホ: 左スティックで移動専用。右手はコート上のスワイプで狙い＋打球
 *   （タップ＝デフォルト狙いでスイング、スワイプ＝その方向ベクトルの狙いでスイング）。
 *   球種は下部3ボタンの選択（selectedShot）。サーブはタップでトス/フラットサーブのまま。
 * =========================================================== */


// Space = ロブ修飾キー。押している間にクリックすると球種がロブになる。

// 自由移動できるy方向の範囲（操作キャラクターの役割に応じて変える）


// スマホ: コート上スワイプのタップ/スワイプ判定しきい値（クライアントpx）
const SWIPE_THRESHOLD_PX = 10;
// スワイプ量(画面px・コート幅/全長基準の正規化量)→狙い移動量の感度。TUNINGは変更しない方針のためここで定義。
const SWIPE_AIM_SENSITIVITY = 1.4;

export function setControlledX(p, x) {
  p.x = Math.max(-PLAYER_X_LIMIT, Math.min(PLAYER_X_LIMIT, x));
}

export function setControlledY(p, y) {
  const range = (p === front) ? Y_RANGE_FRONT : Y_RANGE_BACK;
  p.y = Math.max(range.min, Math.min(range.max, y));
}

// 後方互換用（デバッグフックから使用）
export function setBackX(x) { setControlledX(back, x); }

document.addEventListener("keydown", function (e) {
  // 矢印キーは廃止（移動=WASD・狙い=マウスへ移行）。誤スクロール防止のため無害化のみ。
  if (e.code === "ArrowLeft" || e.code === "ArrowRight" ||
      e.code === "ArrowUp" || e.code === "ArrowDown") { e.preventDefault(); return; }
  if (e.code === "KeyA") keysWasd.left = true;
  if (e.code === "KeyD") keysWasd.right = true;
  if (e.code === "KeyW") keysWasd.up = true;
  if (e.code === "KeyS") keysWasd.down = true;

  // 旧球種選択キー（1/2/3）・旧4/5・Q/Eは廃止（無害化）。
  // 球種はマウスボタンで決まる（左=シュート/右=カット/Space+クリック=ロブ）
  if (["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "KeyQ", "KeyE"].indexOf(e.code) >= 0) {
    return;
  }

  // Space = ロブ修飾キー（単独の打球/ため開始キーではない）。
  // 押している間にクリックすると球種がロブになる。
  if (e.code === "Space") {
    e.preventDefault();
    setSpaceHeld(true);
  }
});

document.addEventListener("keyup", function (e) {
  if (e.code === "KeyA") keysWasd.left = false;
  if (e.code === "KeyD") keysWasd.right = false;
  if (e.code === "KeyW") keysWasd.up = false;
  if (e.code === "KeyS") keysWasd.down = false;
  if (e.code === "Space") setSpaceHeld(false);
});

/* ---- ため（チャージ）の開始・自動化 ---- */

// 打点ゾーンに入ったら自動でため開始（離して打つ操作は廃止）。
// WASD移動はため中も常に有効（操作ロックなし）。
export function startCharge(source) {
  if (state !== "rally" || charge.active) return;
  charge.active = true;
  charge.start = matchTime;
  charge.source = source || "auto";
  // カーソルは毎回安全なデフォルト（ミドル深め）から始める。
  // 未操作のままでもこの位置へ打てる
  aim.x = 0;
  aim.y = -TUNING.aim.defaultY;
}

// マウスボタン（左=シュート/右=カット、Space併用でロブ）でスイング。
// ・打点ゾーン内（canPlayerHit）なら即スイング
// ・ゾーン手前で早めにクリックしたときは予約スイング（ゾーン到達時に同じ球種で自動スイング）
export function attemptSwing(family) {
  if (state !== "rally" || spectatorMode) return;
  const power = chargeAmount();
  if (canPlayerHit(rallyControlled)) {
    charge.active = false;
    charge.source = null;
    playerHitBall(family, power, aim.x, aim.y);
  } else if (ballIncomingToPlayer() && distToBall(rallyControlled) < 6.0) {
    setPendingSwing(0.35);
    setPendingShot(family);
    setPendingPower(power);
    setPendingAimX(aim.x);
    setPendingAimY(aim.y);
  }
}

export function shotFamilyForClick(button) {
  if (spaceHeld) return "lob";
  return button === 2 ? "cut" : "shoot";
}

/* ---- 球種の選択（スマホ専用の3ボタンUI。PCはマウスボタンで決まる） ---- */
export function selectShot(family) {
  if (SHOT_FAMILY_ORDER.indexOf(family) < 0) return;
  setSelectedShot(family);
  if (shotSelectControls) {
    shotSelectControls.querySelectorAll(".ctrl-btn").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.shotsel === family);
    });
  }
}

// 狙いの更新: PCはマウスが指すコート地点へ着地カーソルを追従、スマホはコート上のスワイプ。
//   ラリーのため中 → aim（相手コート内にクランプ）
//   サーブのトス前/トス中 → serveAimCursor（対角サービスコート±わずかにクランプ）
export function updateAimInputs(dt) {
  if (spectatorMode) return; // 観戦モードはマウス/スワイプ入力を使わない（全員AI）
  if (state === "rally" && charge.active) {
    const c = TUNING.aim;
    if (swipe.active) {
      // スマホ: コート上のスワイプで決めた狙いを最優先（右手・打球側の指）
      aim.x = swipe.aimX;
      aim.y = swipe.aimY;
    } else if (mouseAim.valid) {
      // マウスが指すコート地点をそのまま狙いに（相手コート＝負のy側へ）
      aim.x = mouseAim.x;
      aim.y = mouseAim.y;
    }
    // 狙いはコート内マージンに収める（アウトは打点の悪さ・散らばり由来のみ）
    aim.x = Math.max(-(COURT.halfW - c.sideMargin), Math.min(COURT.halfW - c.sideMargin, aim.x));
    aim.y = Math.max(-(COURT.halfL - c.depthMargin), Math.min(-c.minDepth, aim.y));
  } else if ((state === "serve-toss" || state === "serve-stance") && playerIsServer()) {
    // サーブの狙い: マウスで対角サービスコート内の着地点を指す（スマホはスティック）
    if (!serveAimCursor.set) resetServeAimCursor();
    const c = TUNING.aim;
    if (mouseAim.valid) {
      serveAimCursor.x = mouseAim.x;
      serveAimCursor.y = mouseAim.y;
    }
    clampServeAimCursor();
  }
}

// スマホ: 打球ボタンはタップでスイング（球種は下部3ボタンの選択）。
// サーブはタップでトス/フラットサーブ（カットサーブはPCのみ・右クリック）。
if (chargeBtn) {
  chargeBtn.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    if (state === "serve-stance" || state === "serve-toss") {
      playerServeAction(0);
      return;
    }
    attemptSwing(selectedShot);
  });
}

// 球種選択ボタン（スマホ用。PCはマウスボタンで球種を決めるため使用しない）
shotSelectControls.addEventListener("click", function (e) {
  const btn = e.target.closest(".ctrl-btn");
  if (!btn) return;
  selectShot(btn.dataset.shotsel);
});

// サーブ設定（パワー / 回転）。種類（フラット/カット）はクリックのボタンで決まる
servePowerControls.addEventListener("click", function (e) {
  const btn = e.target.closest(".ctrl-btn");
  if (!btn) return;
  setServePower(btn.dataset.servePower);
  setActiveButton(servePowerControls, btn);
});

serveSpinControls.addEventListener("click", function (e) {
  const btn = e.target.closest(".ctrl-btn");
  if (!btn) return;
  setServeSpin(btn.dataset.serveSpin);
  setActiveButton(serveSpinControls, btn);
});

// 攻守の割合（相方AIの積極性）
if (aggressionControls) {
  aggressionControls.addEventListener("click", function (e) {
    const btn = e.target.closest(".ctrl-btn");
    if (!btn || btn.dataset.aggression == null) return;
    setPartnerAggressiveness(parseFloat(btn.dataset.aggression));
    setActiveButton(aggressionControls, btn);
  });
}

formationControls.addEventListener("click", function (e) {
  const btn = e.target.closest(".ctrl-btn");
  if (!btn) return;
  setFormation(btn.dataset.formation);
  setActiveButton(formationControls, btn);
  updatePickerPositions();
});

// 利き腕（自チーム）。試合前のみ変更可。デフォルトは右利き（既存挙動と同一）。
if (handedControls) {
  handedControls.addEventListener("click", function (e) {
    const btn = e.target.closest(".ctrl-btn");
    if (!btn || !btn.dataset.handed) return;
    setPlayerHanded(btn.dataset.handed);
    setActiveButton(handedControls, btn);
  });
}

// 操作方法（入力デバイス）の選択。デフォルトはswipe（マウス追従の狙いを無効化し、
// スワイプ/タップ前提のレシーブ・サーブ操作を主役にする）。mouseは従来のPC挙動。
if (inputModeControls) {
  inputModeControls.addEventListener("click", function (e) {
    const btn = e.target.closest(".ctrl-btn");
    if (!btn) return;
    setInputMode(btn.dataset.inputMode);
    setActiveButton(inputModeControls, btn);
  });
}

/* ---- 開始画面: 操作キャラ ピッカー（簡易ミニコート） ----
 * 自チーム（手前）の後衛/前衛マーカーをタップでYOU⇔AI切替。
 * YOUは自チーム内で常に最大1人（片方をYOUにすると他方は自動でAI）。
 * 両方AIなら観戦モード（spectatorMode=true）。
 * 相手チーム（奥）のマーカーは常にAI・タップ不可。 */
// ワールド座標(m)→ミニコート上の位置(%)へマッピング。
// x: -halfW..halfW を 8%..92% に、自陣y(0..halfL)を 50%..92%、
// 相手陣y(0..-halfL)を 50%..8% に対応させる（ネット=50%、コート外周に余白を残す）。
function worldXToPercent(x) {
  const t = (x + COURT.halfW) / (2 * COURT.halfW);
  return 16 + Math.max(0, Math.min(1, t)) * 68;
}
function worldYToPercent(y) {
  const t = Math.max(0, Math.min(1, Math.abs(y) / COURT.halfL));
  const span = 50 - 16; // ネット(50%)からベースライン(16or84%)までの距離
  return y >= 0 ? 50 + t * span : 50 - t * span;
}

// 陣形(formation)に応じて、開始画面ミニコートの4マーカーを定位置へ再配置する。
// FORMATIONSの座標（実試合の初期配置）をそのまま使うと、両チームの後衛が中央付近で
// 縦に重なってしまうため、見た目専用に「1ポイント目の雁行陣」的な対角配置へ補正する：
// 後衛同士が対角（左上⇔右下）、前衛は自分の後衛と逆サイドのネット寄りに配置する。
// ※ FORMATIONSのx座標が0付近（後衛が中央寄り）の場合はサイドへオフセットして重なりを避ける。
function updatePickerPositions() {
  const f = FORMATIONS[formation] || FORMATIONS["ganko"];
  const SIDE_OFFSET = 2.5; // 後衛が中央寄り(|x|が小さい)陣形向けの最小サイド振り
  const sideSign = (x) => (x === 0 ? 1 : Math.sign(x));
  // 自チーム（手前）: 後衛を右寄り、前衛を後衛と逆サイドのネット寄りに配置
  const playerBackX = Math.abs(f.back.x) < SIDE_OFFSET ? sideSign(f.back.x) * SIDE_OFFSET : f.back.x;
  const playerFrontX = -sideSign(playerBackX) * Math.max(SIDE_OFFSET, Math.abs(f.front.x));
  // 相手チーム（奥）: 自チームと対角になるよう左右反転、前衛も後衛と逆サイド
  const cpuBackX = -playerBackX;
  const cpuFrontX = -playerFrontX;
  const place = (el, x, y) => {
    if (!el) return;
    el.style.left = worldXToPercent(x) + "%";
    el.style.top = worldYToPercent(y) + "%";
  };
  place(pickerPlayerBack, playerBackX, f.back.y);
  place(pickerPlayerFront, playerFrontX, f.front.y);
  place(pickerCpuBack, cpuBackX, -f.back.y);
  place(pickerCpuFront, cpuFrontX, -f.front.y);
}

function updatePickerUi() {
  const youIsBack = !spectatorMode && playerPosition === "back";
  const youIsFront = !spectatorMode && playerPosition === "front";
  if (pickerPlayerBack) {
    pickerPlayerBack.classList.toggle("is-you", youIsBack);
    pickerPlayerBack.querySelector(".picker-tag").textContent = youIsBack ? "YOU" : "AI";
  }
  if (pickerPlayerFront) {
    pickerPlayerFront.classList.toggle("is-you", youIsFront);
    pickerPlayerFront.querySelector(".picker-tag").textContent = youIsFront ? "YOU" : "AI";
  }
  startBtn.textContent = spectatorMode ? "観戦を始める" : "試合を始める";
}

function selectPickerPosition(position) {
  // 同じマーカーを再タップしたらAIに戻す（=観戦化）。違うマーカーならそちらをYOUにする。
  if (!spectatorMode && playerPosition === position) {
    setSpectatorMode(true);
  } else {
    setSpectatorMode(false);
    setPlayerPosition(position);
  }
  updatePickerUi();
}

if (playerPicker) {
  playerPicker.addEventListener("click", function (e) {
    const btn = e.target.closest(".picker-marker-self");
    if (!btn || btn.disabled) return;
    selectPickerPosition(btn.dataset.position);
  });
  updatePickerUi();
  updatePickerPositions();
}

export function setActiveButton(group, activeBtn) {
  group.querySelectorAll(".ctrl-btn").forEach((b) => b.classList.remove("is-active"));
  activeBtn.classList.add("is-active");
}

/* ---- バーチャルスティック（スマホの移動操作） ---- */

export function stickVectorFromEvent(e) {
  const rect = moveStick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = rect.width / 2;
  let dx = (e.clientX - cx) / radius;
  let dy = (e.clientY - cy) / radius;
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  return { dx: dx, dy: dy };
}

export function updateStickKnob(dx, dy) {
  const radius = moveStick.getBoundingClientRect().width / 2;
  moveStickKnob.style.transform =
    "translate(" + (dx * radius * 0.55) + "px, " + (dy * radius * 0.55) + "px)";
}

if (moveStick) {
  moveStick.addEventListener("pointerdown", function (e) {
    stick.active = true;
    moveStick.setPointerCapture(e.pointerId);
    const v = stickVectorFromEvent(e);
    stick.dx = v.dx; stick.dy = v.dy;
    updateStickKnob(stick.dx, stick.dy);
    e.preventDefault();
  });
  moveStick.addEventListener("pointermove", function (e) {
    if (!stick.active) return;
    const v = stickVectorFromEvent(e);
    stick.dx = v.dx; stick.dy = v.dy;
    updateStickKnob(stick.dx, stick.dy);
    e.preventDefault();
  });
  function releaseStick(e) {
    stick.active = false;
    stick.dx = 0; stick.dy = 0;
    updateStickKnob(0, 0);
  }
  moveStick.addEventListener("pointerup", releaseStick);
  moveStick.addEventListener("pointercancel", releaseStick);
  moveStick.addEventListener("pointerleave", function () {
    if (stick.active) releaseStick();
  });
}

// PC: マウス移動で狙い（着地カーソル）をマウスが指すコート地点へ追従させる。
// canvas外へ出たら直前の狙いを保持（mouseAim.valid は維持）。
// swipeモード（デフォルト）ではマウス追従の狙いを無効化する（スワイプ/タップ前提のため）。
canvas.addEventListener("mousemove", function (e) {
  if (inputMode !== "mouse") return;
  updateMouseAimFromEvent(e);
});
// 右クリックのコンテキストメニューは抑止（右クリック=カット/カットサーブとして使う）
canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

// コートをクリック: 球種はクリックしたボタンで決まる
//   左クリック = シュート（フラット/ドライブ）/ サーブはトス→フラットサーブ
//   右クリック = カット（スライス/ドロップ） / サーブはカットサーブ
//   Spaceを押しながらクリック = ロブ
// 打点ゾーン中も自動でため済みのため、クリック=即スイング。
//
// スマホ（タッチ/ペン）はラリー中のみ「スワイプ＝狙い＋打球」（右手・二本目の指）。
// 左手は #move-stick で移動専用のまま。サーブ中（serve-stance/serve-toss）の
// タッチ操作は #app 側の専用ハンドラ（画面どこタップ/スワイプ）で処理する。
canvas.addEventListener("pointerdown", function (e) {
  if (e.pointerType === "mouse") {
    const button = e.button;
    if (button !== 0 && button !== 2) return; // 中ボタン等は無視
    e.preventDefault(); // ドラッグによるテキスト選択ハイライトを防ぐ
    // swipeモードでは狙いをマウス位置に合わせない（直近のスワイプ/デフォルト狙いのまま打つ）。
    if (inputMode === "mouse") updateMouseAimFromEvent(e); // 押した瞬間の地点を即狙いへ反映
    if (state === "serve-stance" || state === "serve-toss") {
      playerServeAction(button);
      return;
    }
    attemptSwing(shotFamilyForClick(button));
    return;
  }

  // タッチ/ペン: サーブ中は #app 側のハンドラに委ねる（ここでは何もしない）
  if (state === "serve-stance" || state === "serve-toss") return;
  if (state !== "rally") return;
  swipe.active = true;
  swipe.pointerId = e.pointerId;
  swipe.startX = e.clientX;
  swipe.startY = e.clientY;
  swipe.moved = false;
  swipe.aimX = aim.x;
  swipe.aimY = aim.y;
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
});

canvas.addEventListener("pointermove", function (e) {
  if (!swipe.active || e.pointerId !== swipe.pointerId) return;
  e.preventDefault();
  const dx = e.clientX - swipe.startX;
  const dy = e.clientY - swipe.startY;
  if (Math.hypot(dx, dy) > SWIPE_THRESHOLD_PX) swipe.moved = true;

  // スワイプ量(クライアントpx)→ワールド座標の差分に変換し、開始時の狙いに加算する。
  // 横dx→aim.x（左右の配球）、縦dy→aim.y（上方向スワイプ=相手コート深く=aim.yがより負）。
  // canvas表示サイズ(コート全幅/全長)基準でpx→m換算し、感度係数を掛ける。
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const c = TUNING.aim;
  const worldPerPxX = (COURT.halfW * 2) / rect.width;
  const worldPerPxY = (COURT.halfL * 2) / rect.height;
  swipe.aimX = aim.x + dx * worldPerPxX * SWIPE_AIM_SENSITIVITY;
  swipe.aimY = aim.y + dy * worldPerPxY * SWIPE_AIM_SENSITIVITY; // 上スワイプ(dy<0)で奥(より負のy)へ

  // 既存のクランプ（updateAimInputsと同じマージン）に収める（プレビュー段階でも見た目を合わせる）
  swipe.aimX = Math.max(-(COURT.halfW - c.sideMargin), Math.min(COURT.halfW - c.sideMargin, swipe.aimX));
  swipe.aimY = Math.max(-(COURT.halfL - c.depthMargin), Math.min(-c.minDepth, swipe.aimY));
  // パワー（ため）は今回スワイプ長さに連動させない。既存の自動ため(chargeAmount)を流用。
  // 将来拡張: スワイプの速さ/長さでパワーを上乗せする余地あり。
});

function endSwipe(e) {
  if (!swipe.active || e.pointerId !== swipe.pointerId) return;
  swipe.active = false;
  if (swipe.moved) {
    // スワイプ確定: そのベクトルから決めた狙いでスイング
    aim.x = swipe.aimX;
    aim.y = swipe.aimY;
  }
  // しきい値未満（タップ）は従来通りデフォルト狙いでスイング
  attemptSwing(selectedShot);
}
canvas.addEventListener("pointerup", function (e) {
  if (e.pointerType === "mouse") return;
  endSwipe(e);
});
canvas.addEventListener("pointercancel", function (e) {
  if (e.pointerType === "mouse") return;
  swipe.active = false;
});

/* ---- スマホ: サーブ中（serve-stance/serve-toss）のタッチ操作 ----
 * serve-stance: 画面のどこをタップ（.ctrl-btn・#move-stick以外）してもトスする。
 * serve-toss:   コート上のスワイプでコース（serveAimCursor）を指定し、
 *               指を離した瞬間にサーブを打つ（ラリーのスワイプ打球と統一）。
 */
const serveSwipe = {
  active: false,
  pointerId: null,
  startX: 0, startY: 0,
  baseX: 0, baseY: 0, // スワイプ開始時の serveAimCursor（差分計算の基準）
  moved: false,
};

function isServeUiTarget(target) {
  return !!(target.closest && (target.closest(".ctrl-btn") || target.closest("#move-stick")));
}

if (appRoot) {
  appRoot.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse") return; // PCマウスは既存のcanvasハンドラに任せる
    if (state !== "serve-stance" && state !== "serve-toss") return;
    if (isServeUiTarget(e.target)) return; // 操作ボタン・スティックは除外
    if (!playerIsServer()) return;

    if (state === "serve-stance") {
      playerServeAction(0); // 画面どこタップでもトス
      return;
    }

    // serve-toss: スワイプでコースを決め、離した瞬間にサーブ
    if (!serveAimCursor.set) resetServeAimCursor();
    serveSwipe.active = true;
    serveSwipe.pointerId = e.pointerId;
    serveSwipe.startX = e.clientX;
    serveSwipe.startY = e.clientY;
    serveSwipe.baseX = serveAimCursor.x;
    serveSwipe.baseY = serveAimCursor.y;
    serveSwipe.moved = false;
    e.preventDefault();
  });

  appRoot.addEventListener("pointermove", function (e) {
    if (!serveSwipe.active || e.pointerId !== serveSwipe.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - serveSwipe.startX;
    const dy = e.clientY - serveSwipe.startY;
    if (Math.hypot(dx, dy) > SWIPE_THRESHOLD_PX) serveSwipe.moved = true;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const worldPerPxX = (COURT.halfW * 2) / rect.width;
    const worldPerPxY = (COURT.halfL * 2) / rect.height;
    serveAimCursor.x = serveSwipe.baseX + dx * worldPerPxX * SWIPE_AIM_SENSITIVITY;
    serveAimCursor.y = serveSwipe.baseY + dy * worldPerPxY * SWIPE_AIM_SENSITIVITY;
    clampServeAimCursor();
  });

  function endServeSwipe(e) {
    if (!serveSwipe.active || e.pointerId !== serveSwipe.pointerId) return;
    serveSwipe.active = false;
    // 離した瞬間＝打点タイミング。コースはスワイプで決めた serveAimCursor のまま。
    playerServeAction(0);
  }
  appRoot.addEventListener("pointerup", function (e) {
    if (e.pointerType === "mouse") return;
    endServeSwipe(e);
  });
  appRoot.addEventListener("pointercancel", function (e) {
    if (e.pointerType === "mouse") return;
    serveSwipe.active = false;
  });
}


export function ballIncomingToPlayer() {
  return ball.lastHitter === "cpu" && ball.bounces < 2;
}

export function distToBall(p) {
  return Math.hypot(ball.x - p.x, ball.y - p.y);
}

export function canPlayerHit(p) {
  const cp = p || rallyControlled;
  if (!ballIncomingToPlayer()) return false;
  if (ball.serving && ball.bounces === 0) return false; // サーブはワンバウンドしてから
  if (ball.z > 2.4) return false;
  return distToBall(cp) <= HIT_REACH * cp.stats.reach;
}

export function playerHitBall(shot, chargePower, aimX, aimY) {
  setPendingSwing(0);
  hitBall({
    hitter: rallyControlled,
    side: "player",
    shot: shot,
    charge: chargePower || 0,
    aimX: aimX != null ? aimX : 0,
    aimY: aimY != null ? aimY : -TUNING.aim.defaultY,
    contactZ: ball.z,
    byPlayer: true, // 実際の打点位置で角度幅・球速・ミス率を決める
  });
  setBallHittableSince(-1);
}
