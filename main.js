import {
  TUNING, COURT, G,
  POINT_LABELS, POINTS_TO_WIN_GAME, FINAL_GAME_POINTS, GAMES_TO_WIN_MATCH,
  FORMATIONS, PLAYER_X_LIMIT, HIT_REACH, CPU_REACH, VOLLEY_REACH,
  SHOOT_FLAT_Z, CUT_SLICE_DEPTH, SHOT_FAMILY_ORDER, SHOT_FAMILY_META,
  TOSS_RISE_TIME, TOSS_HOLD_TIME, TOSS_BASE_Z, TOSS_APEX_Z,
  IDEAL_HIT_DELAY, LINE_IN_MARGIN, Y_RANGE_BACK, Y_RANGE_FRONT,
  W, H,
} from "./config.js";

import {
  project, unproject, clientToCanvas, clamp01, lerp, roundRect,
} from "./math.js";

import {
  screens, startBtn, retryBtn, canvas, ctx, messageOverlay, messageText,
  playerScoreEl, cpuScoreEl, playerGamesEl, cpuGamesEl, resultTitle, resultDetail,
  hintText, shotControls, chargeBtn, servePowerControls, serveSpinControls,
  aggressionControls, shotSelectControls, moveStick, moveStickKnob,
  positionControls, formationControls, spectatorToggle, controlsPanel,
  mouseAim, makeStats, playerStats, cpuStats,
  state, player, cpu, serveFaults, rafId, lastTime, pendingSwing, matchTime,
  setState, setServeFaults, incServeFaults, setRafId, setLastTime, setPendingSwing, setMatchTime, addMatchTime,
  partnerAggressiveness, setPartnerAggressiveness,
  serveType, setServeType, servePower, serveSpin, setServePower, setServeSpin,
  serveAimCursor,
  selectedShot, setSelectedShot,
  cpuFrontPlan, playerFrontPlan, setCpuFrontPlan, setPlayerFrontPlan,
  playerPosition, formation, setPlayerPosition, setFormation,
  spectatorMode, setSpectatorMode,
  charge, aim, serveReady,
  receiveDone, setReceiveDone,
  cpuServePlan, setCpuServePlan,
  toss, makePlayer,
  back, front, cpuBack, cpuFront, ball,
  effects, setEffects,
  rallyControlled, pointJustServedByFront, cpuJustServedByFront,
  setRallyControlled, setPointJustServedByFront, setCpuJustServedByFront,
  receiverSideAssign,
  aiServePlan, setAiServePlan,
  lastHitInfo, setLastHitInfo,
  keysWasd, stick,
  spaceHeld, setSpaceHeld,
  ballHittableSince, setBallHittableSince,
  pendingShot, pendingPower, pendingAimX, pendingAimY,
  setPendingShot, setPendingPower, setPendingAimX, setPendingAimY,
  development,
} from "./state.js";

// button(0=左/2=右) と spaceHeld(修飾キー) から4種のサーブタイプを決める。
// ラリー中の shotFamilyForClick と対称: Space=修飾キー、左右ボタンで系統が変わる。
export function serveTypeForInput(button, space) {
  if (space) return button === 2 ? "attackCut" : "underCut";
  return button === 2 ? "slice" : "flat";
}

export function resolveShotKey(family, contactZ, aimY) {
  if (family === "shoot") {
    return (contactZ != null && contactZ >= SHOOT_FLAT_Z) ? "flat" : "drive";
  }
  if (family === "cut") {
    // 狙いが未指定ならデフォルト狙い（深め）= スライス扱い
    const depth = (aimY != null) ? Math.abs(aimY) : TUNING.aim.defaultY;
    return depth >= CUT_SLICE_DEPTH ? "slice" : "drop";
  }
  return "lob";
}

// スマッシュ成立判定: ネット前（前衛域）で打点が高いと、球種選択に関わらず
// スマッシュ（速く鋭い下向きの決め球）になる。hitter のネットからの距離と
// 打点高さ contactZ で判定する。
export function isSmashContact(hitter, contactZ) {
  const sm = TUNING.smash;
  const netDist = Math.abs(hitter.y); // ネット(y=0)からの距離
  return contactZ >= sm.minZ && netDist <= sm.netDist;
}

// 前衛の作戦を確率で抽選（両チーム共通）。
export function pickFrontPlan() {
  const ai = TUNING.ai;
  const r = Math.random();
  if (r < ai.frontPoachChance) return "poach";
  if (r < ai.frontPoachChance + ai.frontGuardStraightChance) return "straight";
  if (r < ai.frontPoachChance + ai.frontGuardStraightChance + ai.frontMiddleChance) return "middle";
  return "base";
}

export function chargeAmount() {
  if (!charge.active) return 0;
  return Math.max(0, Math.min(1, (matchTime - charge.start) / TUNING.charge.maxTime));
}
export function updateMouseAimFromEvent(e) {
  const c = clientToCanvas(e.clientX, e.clientY);
  const w = unproject(c.sx, c.sy);
  if (w) { mouseAim.x = w.x; mouseAim.y = w.y; mouseAim.valid = true; }
}

/* ===========================================================
 * 画面・スコア表示
 * =========================================================== */

export function showScreen(name) {
  Object.values(screens).forEach((s) => (s.hidden = true));
  screens[name].hidden = false;
}

export function showMessage(text) {
  // インプレー（ラリー）中は画面中央の文字を出さない（ボレー/スマッシュ等の告知を抑制）。
  // ポイント/ゲーム/フォルト等は state が rally 以外になってから呼ばれるので表示される。
  if (state === "rally") return;
  messageText.textContent = text;
  messageOverlay.hidden = false;
}

// 操作パネルの表示切替: serve=サーブ設定（種類/パワー/回転） / rally=球種選択
export function setControlMode(mode) {
  const serveMode = mode === "serve";
  servePowerControls.hidden = !serveMode;
  serveSpinControls.hidden = !serveMode;
  // 攻守は観戦モードOFF かつ サーブ前にのみ表示（パワー/回転と同運用）
  if (aggressionControls) aggressionControls.hidden = !serveMode || spectatorMode;
  shotSelectControls.hidden = serveMode;
  if (chargeBtn) {
    chargeBtn.textContent = serveMode ? "トス / 打つ" : "打つ";
  }
}

export function hideMessage() {
  messageOverlay.hidden = true;
}

export function isFinalGame() {
  return player.games === GAMES_TO_WIN_MATCH - 1 && cpu.games === GAMES_TO_WIN_MATCH - 1;
}

export function pointLabel(points, opponentPoints) {
  if (isFinalGame()) {
    return String(points); // ファイナルゲームは数字表示（7点先取・6-6デュース）
  }
  if (points >= 3 && opponentPoints >= 3) {
    if (points === opponentPoints) return "デュース";
    return points > opponentPoints ? "アド" : "3";
  }
  return POINT_LABELS[Math.min(points, 3)];
}

export function updateScoreboard() {
  playerScoreEl.textContent = pointLabel(player.points, cpu.points);
  cpuScoreEl.textContent = pointLabel(cpu.points, player.points);
  playerGamesEl.textContent = player.games;
  cpuGamesEl.textContent = cpu.games;
}

/* ===========================================================
 * サーブ順・サーブ位置（JSTA競技規則第24条に基づく）
 *
 * ・サービスは1ゲームごとに両チーム交互に行う（このゲームでは
 *   プレイヤーチームが奇数ゲーム目=ゲーム1,3,5...を担当）。
 * ・競技規則第24条第1項・第2項:「サーバーのどちらか1人がサービス
 *   を行い、2人のプレーヤーは同じゲーム中に2ポイントずつ
 *   かわるがわる打つ。一つのゲームの中でサービスの順序を替える
 *   ことはできない」。つまり前衛もサーブを打つ。
 *   ※ ゲームの最初のサーバーはペアのどちらでもよい規則のため、
 *      このゲームでは「1人目=後衛、2人目=前衛」で固定する。
 * ・前衛がサーブする番では、打つまでベースライン後方に留まり、
 *   打った後にサービスダッシュで前へ詰める。
 * ・ファイナルゲーム（2-2）は2ポイントごとに4人が固定順で
 *   交代しながらサーブする: 自チーム1人目 → 相手チーム1人目 →
 *   自チーム2人目 → 相手チーム2人目 → （以後繰り返し）。
 * ・サーブ位置はベースライン後方、ポイントごとに右/左交互。
 * ・対角のサービスコートに入らなければフォルト（2本制）。
 * =========================================================== */

export function serverTeamNow() {
  if (isFinalGame()) {
    const block = Math.floor((player.points + cpu.points) / 2);
    return (block % 2 === 0) ? "player" : "cpu";
  }
  const totalGames = player.games + cpu.games;
  return (totalGames % 2 === 0) ? "player" : "cpu";
}

// そのチームの中で「2人目のサーバー（前衛側）」が打つ番かどうか
export function serverIsSecondOfPair() {
  const block = Math.floor((player.points + cpu.points) / 2);
  if (isFinalGame()) {
    // 2ポイントごとに4人が順に交代: [自1人目, 相1人目, 自2人目, 相2人目] の繰り返し
    return Math.floor(block / 2) % 2 === 1;
  }
  // 通常ゲーム: 同じゲームの中で2ポイントごとにペアの2人が交互にサーブ
  // （デュースでもポイント合計の進行に従い交互が続く）
  return block % 2 === 1;
}

// 後衛サーブか前衛サーブか（プレイヤー視点での呼び名）。
// ファイナルゲームでは「後衛/前衛」の区別自体が薄れるが、
// 表示・配置の都合上、この関数はサーブする選手が
// homeで前衛ポジションの選手かどうかを返す。
export function serverIsFrontPlayer() {
  return serverIsSecondOfPair();
}

// ポイント数の合計が偶数なら「サーバーから見て右」、奇数なら左
export function serveFromRight() {
  return (player.points + cpu.points) % 2 === 0;
}

// サーバーの立ち位置（ベースライン後方0.6m、センターマーク〜サイドラインの間）
export function servePosition(team) {
  const right = serveFromRight();
  const sx = TUNING.pos.serveSideX;
  const y = COURT.halfL + TUNING.pos.serveBackY;
  if (team === "player") {
    // プレイヤー（奥向き）の右 = 画面右(x+)
    return { x: right ? sx : -sx, y: y };
  }
  // CPU（手前向き）の右 = 画面左(x-)
  return { x: right ? -sx : sx, y: -y };
}

// サーブが入るべき対角サービスコート（相手コート側）
export function serviceBox(team) {
  const right = serveFromRight();
  if (team === "player") {
    // プレイヤーが画面右から打つ → 対角は相手コートの画面左側
    const x1 = right ? -COURT.singlesHalfW : 0;
    const x2 = right ? 0 : COURT.singlesHalfW;
    return { x1: x1, x2: x2, y1: -COURT.serviceY, y2: 0 };
  }
  const x1 = right ? 0 : -COURT.singlesHalfW;
  const x2 = right ? COURT.singlesHalfW : 0;
  return { x1: x1, x2: x2, y1: 0, y2: COURT.serviceY };
}

// サーブ狙いカーソルを自陣サーバーの対角サービスコート中央へ初期化する
export function resetServeAimCursor() {
  const box = serviceBox("player");
  serveAimCursor.x = (box.x1 + box.x2) / 2;
  serveAimCursor.y = (box.y1 + box.y2) / 2;
  serveAimCursor.set = true;
}

// サーブ狙いカーソルをサービスコート内（わずかに外まで許容）にクランプする。
// コート外まで動かせばフォルトになる（立ち位置＋狙いで左/中/右を打ち分ける）。
export function clampServeAimCursor() {
  const box = serviceBox("player");
  const m = 0.6; // サービスライン/センター/サイドから外へ少し出せる余地（フォルト判断の幅）
  serveAimCursor.x = Math.max(box.x1 - m, Math.min(box.x2 + m, serveAimCursor.x));
  serveAimCursor.y = Math.max(box.y1 - m, Math.min(box.y2 + m, serveAimCursor.y));
}

// 相手（サーバー側）のサーブ種類を返す。CPUサーブは事前抽選 cpuServePlan、
// 自陣サーブ（自分/相方）はトス→打つ瞬間のクリックで決まるため、
// レシーブ位置取りの基準としては直前の serveType（デフォルト"flat"）を使う。
export function incomingServeType(receiverTeam) {
  if (receiverTeam === "player") {
    return cpuServePlan ? cpuServePlan.type : "flat";
  }
  return serveType; // CPUがレシーブする側＝プレイヤーチームのサーブ
}

// サーブ種類 → レシーバーが前に出るか／下がるか。
// slice・underCutは浅く落ちる球なので前進、flat・attackCutは速く伸びるので後方で待つ。
export function serveComesShort(type) {
  return type === "slice" || type === "underCut";
}

/* ===========================================================
 * レシーブ順（確定セオリー・JSTA競技規則）
 *
 * レシーバー2人は「1ゲームの間ずっと同じサービスコート（右/左）」を受け持つ。
 * サーブは右→左と交互に入るので、各ポイントのレシーバーは
 * 「そのサーブが入る側を担当する1人」。ゲームをまたぐ（サーブ権交代）と
 * 受け持ちを再設定する。
 *
 * 割り当てルール:「後衛は必ずクロス（自陣の右＝デュースサイド）、
 * 前衛は必ず逆クロス（自陣の左＝アドサイド）でレシーブ」。
 * 各チームの右サービスコートのx符号は player=+1(画面右) / cpu=-1(画面左)
 * で固定なので、レシーバー割り当ても陣形に関係なく固定値とする。
 *
 * 実装: レシーブ側チームの2人（back/front）に、自陣のx<0側/x>0側を
 * 固定で割り当てる（receiverSideAssign）。サーブが入る対角サービス
 * コートのx符号と一致する側の担当者がそのポイントのレシーバー。
 * =========================================================== */

// チームごと: その担当者が受け持つ自陣サービスコートのx符号（+1=画面右側 / -1=左側）。
// 「後衛はクロス（自陣デュースサイド）・前衛は逆クロス（自陣アドサイド）」で固定。

// レシーブ権の再設定（サーブ権が交代したゲーム開始時に呼ぶ）。
// 「後衛=クロス/デュースサイド、前衛=逆クロス/アドサイド」で固定のため、
// 陣形（front.homeX）に関係なく常に同じ値を再設定する。
export function assignReceiverSides() {
  receiverSideAssign.player.back = 1;
  receiverSideAssign.player.front = -1;

  receiverSideAssign.cpu.back = -1;
  receiverSideAssign.cpu.front = 1;
}

// このポイントでレシーブするのは、サーブが入るサービスコートの側を
// 受け持つプレイヤー（その側を1ゲーム通して固定で担当する）。
export function receiverPlayerFor(team) {
  // team = レシーブ側チーム。サーブは serviceBox(servingTeam) に入る。
  const servingTeam = team === "player" ? "cpu" : "player";
  const box = serviceBox(servingTeam);
  const cx = (box.x1 + box.x2) / 2;
  const sideSign = cx >= 0 ? 1 : -1;
  const assign = receiverSideAssign[team];
  const useBack = (assign.back === sideSign);
  if (team === "player") return useBack ? back : front;
  return useBack ? cpuBack : cpuFront;
}

// レシーバーの定位置（確定セオリー）:
//   サーブは対角のサービスコートにしか来ないので、その対角範囲の真ん中に正対する。
//   さらにサーブ種類で前後位置を変える:
//     アンダーカット告知 → サービスライン付近まで前に出て構える
//     オーバーサーブ告知 → ベースライン付近まで下がって待つ
export function receivePosition(team) {
  const box = serviceBox(team === "player" ? "cpu" : "player");
  const cx = (box.x1 + box.x2) / 2; // 対角サービスコートの左右中央
  const type = incomingServeType(team);
  // ネットからの距離（深さ）。スライス/アンダーカットは浅く出る→前へ、
  // フラット/攻撃的カットは速く伸びる→後ろで待つ
  const depth = serveComesShort(type)
    ? TUNING.pos.receiveCutAdvanceY
    : TUNING.pos.receiveOverBackY;
  return { x: cx, y: team === "player" ? depth : -depth };
}

/* ===========================================================
 * 試合進行
 * =========================================================== */

export function applyFormation() {
  const f = FORMATIONS[formation] || FORMATIONS["ganko"];
  back.homeX = f.back.x;  back.homeY = f.back.y;
  front.homeX = f.front.x; front.homeY = f.front.y;
}

export function startMatch() {
  player.points = 0; player.games = 0;
  cpu.points = 0; cpu.games = 0;
  setServeFaults(0);
  applyFormation();
  assignReceiverSides();
  setRallyControlled((playerPosition === "front") ? front : back);
  if (controlsPanel) controlsPanel.hidden = spectatorMode;
  if (moveStick) moveStick.hidden = spectatorMode;
  if (spectatorMode) {
    back.label = "後衛";
    front.label = "前衛";
    // 観戦モード: 両チーム同一能力（公平な対戦）
    cpuBack.stats = makeStats();
    cpuFront.stats = makeStats();
  } else {
    // 通常モード: CPU は意図的にやや弱く（プレイヤーが勝ちやすい）
    cpuBack.stats = makeStats({ power: 0.95, control: 0.90 });
    cpuFront.stats = makeStats({ volley: 0.7 });
    back.label = (playerPosition === "back") ? "あなた" : "相方";
    front.label = (playerPosition === "front") ? "あなた" : "相方";
  }
  updateScoreboard();
  showScreen("game");
  startServe(true);
}


// 操作キャラは試合を通じて固定（ポジション選択で決まる）。
// 相方の番のサーブはAIが自動で打つ。

export function resetPlayersForPoint() {
  const team = serverTeamNow();
  const frontServes = serverIsFrontPlayer();
  const sp = servePosition(team);
  setPointJustServedByFront((team === "player" && frontServes));
  setCpuJustServedByFront((team === "cpu" && frontServes));

  // 全員いったん定位置へ
  back.x = back.homeX;  back.y = back.homeY;
  front.x = front.homeX; front.y = front.homeY;
  cpuBack.x = cpuBack.homeX; cpuBack.y = cpuBack.homeY;
  cpuFront.x = cpuFront.homeX; cpuFront.y = cpuFront.homeY;

  if (team === "player") {
    const server = frontServes ? front : back;
    server.x = sp.x; server.y = sp.y;
    if (frontServes) {
      // パートナー（後衛）はダブル後衛的にベースライン中央寄りへ
      back.x = -sp.x * 0.5; back.y = Math.max(back.homeY, 11.6);
    }
    // レシーブは「そのサーブが入る側を1ゲーム担当するレシーバー」が受ける
    const rp = receivePosition("cpu");
    const receiver = receiverPlayerFor("cpu");
    receiver.x = rp.x; receiver.y = rp.y;
  } else {
    const server = frontServes ? cpuFront : cpuBack;
    server.x = sp.x; server.y = sp.y;
    if (frontServes) { cpuBack.x = -sp.x * 0.6; cpuBack.y = -11.5; }
    const rp = receivePosition("player");
    const receiver = receiverPlayerFor("player");
    receiver.x = rp.x; receiver.y = rp.y;
  }

  // 前衛は逆サイドに寄る（雁行陣のみ）。サーブする本人はその限りでない。
  // レシーブ役の前衛にはこのサイド寄せを適用しない（レシーブ位置を上書きしてしまうため）。
  const sideSign = serveFromRight() ? 1 : -1;
  const fx = TUNING.pos.frontSideX;
  const receivingTeam = team === "player" ? "cpu" : "player";
  const recv = receiverPlayerFor(receivingTeam);
  if (formation === "ganko" && front !== recv && !(team === "player" && frontServes)) {
    front.x = -fx * sideSign;
  }
  if (cpuFront !== recv && !(team === "cpu" && frontServes)) cpuFront.x = fx * sideSign;

  // レシーブ側チームで、後衛が「そのポイントのレシーバーでない」場合
  // （＝前衛が受ける番）、後衛をホームのセンター(x=0)に残さず、
  // 自分のクロス側（receiverSideAssignのback符号）の後方に構えさせる。
  const halfWX = COURT.singlesHalfW / 2;
  if (receivingTeam === "player" && back !== recv) {
    back.x = receiverSideAssign.player.back * halfWX;
    back.y = TUNING.pos.receiveOverBackY;
  }
  if (receivingTeam === "cpu" && cpuBack !== recv) {
    cpuBack.x = receiverSideAssign.cpu.back * halfWX;
    cpuBack.y = -TUNING.pos.receiveOverBackY;
  }

  ball.vx = 0; ball.vy = 0; ball.vz = 0;
  ball.bounces = 0;
  ball.serving = false;
  ball.spin = "flat";
  ball.spinMag = 1;
  ball.trailColor = "#DFFF4F";
  ball.trail = [];
  setPendingSwing(0);
  charge.active = false;
  charge.source = null;
  serveAimCursor.set = false; // サーブ狙いカーソルは初回参照時にサービスコート中央へ
  setCpuFrontPlan("base");
  setReceiveDone(false);
  serveReady.timer = 0;
  serveReady.still = 0;
  serveReady.ready = false;
  toss.active = false;
  toss.t = 0;
  [back, front, cpuBack, cpuFront].forEach((p) => { p.pose = "idle"; p.swingT = 0; });
}

export function currentServer() {
  const team = serverTeamNow();
  const frontServes = serverIsFrontPlayer();
  if (team === "player") return frontServes ? front : back;
  return frontServes ? cpuFront : cpuBack;
}

// プレイヤーチームのサーブで、操作キャラ自身がサーバーかどうか
export function playerIsServer() {
  return serverTeamNow() === "player" && currentServer() === rallyControlled;
}

export function startServe(isFirstPointOfGame) {
  hideMessage();
  resetPlayersForPoint();

  const team = serverTeamNow();
  const server = currentServer();
  ball.x = server.x;
  ball.y = server.y;
  ball.z = 0.9;
  ball.lastHitter = team;

  const sideText = serveFromRight() ? "右サイド" : "左サイド";
  const serveNoText = serveFaults > 0 ? "セカンドサーブ" : "";
  let who;
  setState("serve-stance");
  server.pose = "idle";
  setCpuServePlan(null);
  if (team === "player") {
    if (playerIsServer() && !spectatorMode) {
      who = "自分のサーブ";
      setControlMode("serve");
      hintText.textContent = "パワー・回転を選び、マウスで狙う場所を指す→準備後クリックでトス";
    } else {
      who = spectatorMode ? "自チームのサーブ" : "相方のサーブ";
      setControlMode("rally");
      hintText.textContent = spectatorMode ? "観戦中… AIがサーブする" : "相方がサーブする。自由に動いて構えよう";
    }
  } else {
    who = "相手のサーブ";
    setControlMode("rally");
    // サーブの種類を打つ前に抽選してプレイヤーへ表示する
    // （前進が必要な球種なら前へ詰める、という判断と移動の時間を確保する）
    setCpuServePlan(pickServePlan(serveFaults === 0));
    hintText.textContent = spectatorMode
      ? "観戦中… 相手チームがサーブする（" + TUNING.serve.types[cpuServePlan.type].label + "）"
      : serveComesShort(cpuServePlan.type)
        ? "相手は" + TUNING.serve.types[cpuServePlan.type].label + "！前に詰めて構え、静止すると打ってくる"
        : "相手は" + TUNING.serve.types[cpuServePlan.type].label + "。位置を決めて静止すると打ってくる";
  }

  let msg = who + "（" + sideText + "）";
  if (serveNoText) msg += "\n" + serveNoText;
  if (isFirstPointOfGame && isFinalGame() && player.points + cpu.points === 0) {
    msg = "ファイナルゲーム\n7ポイント先取・2ポイントごとにサーブ交代\n" + msg;
  }
  showMessage(msg);
  // 準備待ちの間も移動・カーソルが見えるようにメッセージは自動で消す
  setTimeout(function () {
    if (state === "serve-stance" || state === "serve-toss") hideMessage();
  }, TUNING.tempo.serveMsgHide);
}

/* ===========================================================
 * サーブ: 事前設定 → トス → 打点で打つ
 *
 * 打つ前にパワー・回転を設定し、左クリックでトス（統一トス）。
 * ボールが適正打点の高さ（ゲージの「適正」マーカー）に来たタイミングで、
 * ボタン+Space（修飾キー）の組み合わせで4種から選んで打つ:
 *   左クリック=flat / 右クリック=slice /
 *   Space+左クリック=underCut / Space+右クリック=attackCut
 *
 * ・トスは統一トス。左右のコースはトス位置では決まらず、
 *   トス中もマウスで狙う場所（着地点カーソル）を指定する
 * ・各サーブ種類は専用の打点ゾーンを持つ。適正打点に近いほど速く正確、
 *   外れるほど球速・精度が落ちる。トス軌道を超える極端な打点だけ空振り（フォルト）
 * ・パワー・回転が強いほど散らばりが増えて狙ったコースに行きにくい
 * ・underCut（アンダーカット）はセカンド向けの安全球、attackCut（攻撃的カット）
 *   は速くて鋭いがリスクが高い。flat/sliceはその中間〜最速
 * =========================================================== */

// トスは常に統一トス（base→apex）。打点ゾーンは打つ瞬間のボタンで4種に
// 振り分けるため、トス自体の高さはサーブ種類に依存しない。

export function startToss(server) {
  setState("serve-toss");
  toss.active = true;
  toss.t = 0;
  toss.startX = server.x;
  toss.startY = server.y;
  toss.baseZ = TOSS_BASE_Z;
  toss.apexZ = TOSS_APEX_Z;
  server.pose = "toss";
  hideMessage(); // ゲージが見えるようにオーバーレイを消す
  if (playerIsServer() && !spectatorMode) {
    hintText.textContent = "適正マーカーの高さで 左クリック=フラット / 右クリック=スライス / Space+左=アンダーカット / Space+右=攻撃カット。マウスで狙う場所を指す（WASDで立ち位置）";
  }
}

export function tossHeight() {
  // 放物線でトスの高さを計算（頂点 = apexZ、TOSS_RISE_TIMEで頂点）
  const t = toss.t;
  const riseV = (toss.apexZ - toss.baseZ) / TOSS_RISE_TIME + 0.5 * G * TOSS_RISE_TIME;
  return toss.baseZ + riseV * t - 0.5 * G * t * t;
}

export function updateToss(dt) {
  if (!toss.active) return;
  toss.t += dt;
  const server = currentServer();
  // ボールはトスを上げた本人に追従する（移動してもボールが置き去りにならない）
  ball.x = server.x;
  ball.y = server.y;
  const z = tossHeight();
  ball.z = Math.max(0, z);

  // トスが地面まで落ちたらフォルト
  if (z <= 0 || toss.t > TOSS_RISE_TIME + TOSS_HOLD_TIME) {
    toss.active = false;
    if (playerIsServer() && !spectatorMode) {
      serveFault("トスを打てなかった");
    } else {
      // AIは必ず適正打点付近で打つので通常ここには来ない
      aiLaunchServe(serverTeamNow());
    }
  }
}

// トス中の打点品質: 適正高さ(ideal)に近いほど1、ゾーン端で0
export function serveContactQuality(z, zone) {
  if (z >= zone.ideal) {
    return clamp01(1 - (z - zone.ideal) / Math.max(0.05, zone.max - zone.ideal));
  }
  return clamp01(1 - (zone.ideal - z) / Math.max(0.05, zone.ideal - zone.min));
}

/* ---- プレイヤーのサーブ操作 ---- */

// button: 0=左クリック / 2=右クリック。spaceHeldは「修飾キー」（ラリー中のロブ修飾と統一）。
//   serve-stance: どちらのボタン/Space状態でもトス（トスは常に統一トス）
//   serve-toss:   左クリック=フラット / 右クリック=スライス /
//                  Space+左クリック=アンダーカット / Space+右クリック=攻撃カット
export function playerServeAction(button) {
  if (!playerIsServer() || spectatorMode) return;
  if (state === "serve-stance") {
    // 相手レシーバーの準備が整うまでトスを上げられない
    if (!serveReady.ready) {
      const server = currentServer();
      effects.push({
        type: "text",
        x: server.x, y: server.y - 1.0, t: 0, ttl: 0.8,
        text: "レシーバー準備中…",
        color: "#F59E0B",
      });
      return;
    }
    // トスは常に統一トス。4種は打つ瞬間のボタン+Spaceで決まる。
    // serveType はレシーブ位置取りの基準にもなるため、トス開始時にデフォルトへ戻す
    setServeType("flat");
    startToss(currentServer());
    return;
  }
  if (state === "serve-toss") {
    launchPlayerServe(serveTypeForInput(button, spaceHeld));
    return;
  }
}

export function launchPlayerServe(type) {
  if (state !== "serve-toss" || !playerIsServer() || spectatorMode) return;
  const server = currentServer();
  const z = Math.max(0, tossHeight());
  setServeType(type);
  const zone = TUNING.serve.types[type].zone;

  toss.active = false;
  startSwing(server, "fore");

  // 高すぎる打点は届かず空振り（フォルト）
  if (z > zone.max) {
    serveFault("打点が高すぎて空振り");
    return;
  }

  hideMessage();
  setState("rally");
  setControlMode("rally");
  hintText.textContent = "WASDで移動・マウスで狙い。打点ゾーンで左クリック=シュート/右クリック=カット/Space+クリック=ロブ";

  if (!serveAimCursor.set) resetServeAimCursor();
  launchServeBall("player", server, server.stats, {
    type: serveType,
    power: servePower,
    spin: serveSpin,
    quality: serveContactQuality(z, zone),
    contactZ: Math.max(0.3, z),
    aimTarget: { x: serveAimCursor.x, y: serveAimCursor.y }, // 着地点カーソルの狙い
  });
}

/* ---- AIのサーブ（相手チームと、自チームの相方の番で共通） ----
 * 4種から抽選: ファーストは攻め（flat/slice/attackCut中心）、
 * セカンドは安全寄り（underCut中心）に偏らせる。 */


// ファースト/セカンドに応じて4種からサーブプランを抽選する。
export function pickServePlan(first) {
  let type;
  if (first) {
    const r = Math.random();
    type = r < 0.45 ? "flat" : r < 0.8 ? "slice" : "attackCut";
  } else {
    const r = Math.random();
    type = r < 0.65 ? "underCut" : r < 0.9 ? "slice" : "flat";
  }
  const aggressive = (type === "flat" || type === "attackCut");
  return {
    type: type,
    power: first
      ? (Math.random() < 0.5 ? "strong" : "mid")
      : (Math.random() < 0.6 ? "weak" : "mid"),
    spin: aggressive
      ? (Math.random() < 0.5 ? "mid" : "weak")
      : (Math.random() < 0.5 ? "strong" : "mid"),
  };
}

export function aiStartToss(team) {
  if (state !== "serve-stance" || serverTeamNow() !== team) return;
  const server = currentServer();
  // CPUは事前抽選したプラン（プレイヤーに表示済み）をそのまま使う。
  // 相方サーブはここで抽選
  setAiServePlan((team === "cpu" && cpuServePlan) ? cpuServePlan : pickServePlan(serveFaults === 0));
  startToss(server);
  setTimeout(function () {
    if (state === "serve-toss" && serverTeamNow() === team) aiLaunchServe(team);
  }, Math.round(TOSS_RISE_TIME * 1000) + 60);
}

export function aiLaunchServe(team) {
  if (state !== "serve-toss") return;
  hideMessage();
  toss.active = false;
  setState("rally");
  hintText.textContent = (team === "cpu")
    ? "レシーブ！ WASD移動・マウスで狙い。左クリック=シュート/右クリック=カット/Space+クリック=ロブ"
    : "ラリー再開。WASD移動・マウスで狙い。左クリック=シュート/右クリック=カット/Space+クリック=ロブ";

  const server = currentServer();
  const plan = aiServePlan || { type: "underCut", power: "mid", spin: "mid" };
  setAiServePlan(null);
  const zone = TUNING.serve.types[plan.type].zone;
  launchServeBall(team, server, server.stats, {
    type: plan.type,
    power: plan.power,
    spin: plan.spin,
    quality: 0.7 + Math.random() * 0.3,
    contactZ: zone.ideal + (Math.random() - 0.5) * 0.25,
    aim: (Math.random() * 2 - 1) * 0.8,
  });
  startSwing(server, "fore");
}

/* ---- サーブ打球の生成（事前設定のパワー・回転 × 打点品質） ---- */

export function launchServeBall(team, server, stats, cfg) {
  const s = TUNING.serve;
  const tcfg = s.types[cfg.type] || s.types.flat;
  const box = serviceBox(team);
  const targetDepth = team === "player" ? -1 : 1; // 深さの符号
  const powerMul = s.power[cfg.power] || 1;
  const spinMul = s.spin[cfg.spin] || 1;
  const q = cfg.quality != null ? clamp01(cfg.quality) : 1;

  // パワー・回転が強いほど、また打点が悪いほど散らばる。型ごとの sigmaExtra も加味
  const sigma = s.sigmaBase + (tcfg.sigmaExtra || 0)
    + s.sigmaPower * clamp01((powerMul - s.power.weak) / (s.power.strong - s.power.weak))
    + s.sigmaSpin * clamp01((spinMul - s.spin.weak) / (s.spin.strong - s.spin.weak))
    + s.qualitySigma * (1 - q);

  // 球速・目標深さ・回転は型ごとの設定から決まる。
  // depthOffset はサービスラインからの手前への距離（大きいほど浅く入る）。
  // 回転が強いほどさらに浅く落ちる（カット系の食い込み/減速を表現）
  let speed = tcfg.speed * stats.serve * powerMul;
  let ty = targetDepth * (COURT.serviceY - tcfg.depthOffset - 0.6 * (spinMul - 1));
  ball.spin = tcfg.spinKind;
  ball.spinMag = tcfg.spinMagBase * spinMul;
  ball.trailColor = tcfg.color;
  speed *= 1 - s.qualitySpeedDrop * (1 - q);
  // AI打球は両チーム共通パラメータ（cpuSpeedScale廃止・対称性確保）

  let tx;
  if (cfg.aimTarget) {
    // プレイヤー: 着地点カーソルの狙いをそのまま使う（コート外ならフォルト）。
    // 深さ(ty)もカーソルで指定できるが、回転による浅さ補正を残すため平均を取る。
    tx = cfg.aimTarget.x;
    ty = (ty + cfg.aimTarget.y) / 2;
  } else {
    const boxMid = (box.x1 + box.x2) / 2;
    const boxHalf = (box.x2 - box.x1) / 2;
    tx = boxMid + Math.max(-1, Math.min(1, cfg.aim || 0)) * boxHalf * 0.7;
  }
  tx += (Math.random() - 0.5) * 2 * sigma;
  ty += (Math.random() - 0.5) * 2 * sigma;
  // 大外れだけ防ぐ（サイドのフォルトは起こり得る）
  tx = Math.max(box.x1 - 1.0, Math.min(box.x2 + 1.0, tx));

  const fromZ = Math.max(0.3, cfg.contactZ != null ? cfg.contactZ : 2.4);
  // カットサーブ等（遅め）がネットに掛かりすぎないよう、ネット越えが低すぎるときは
  // 球速を落として山なりにし、ネットを越えるようにする（ストロークと同様のアシスト）。
  let netTries = 0;
  while (netTries < 8) {
    const clr = netClearance(server.x, server.y, fromZ, tx, ty, speed);
    if (clr === null || clr > COURT.netH + 0.18) break;
    speed *= 0.93;
    netTries++;
  }
  ball.lastHitter = team;
  ball.serving = true;
  ball.bounces = 0;
  ball.frontChecked = true;     // サーブには前衛は触らない
  ball.cpuFrontChecked = true;
  setReceiveDone(false);          // レシーブが返るまで前衛はポジション移動しない
  launchBall(server.x, server.y, fromZ, tx, ty, speed);
}

/* ---- 物理: ターゲットに1バウンド目が落ちる初速を球速から逆算 ---- */
export function launchBall(fromX, fromY, fromZ, tx, ty, speed) {
  const dist = Math.max(1.0, Math.hypot(tx - fromX, ty - fromY));
  const T = dist / speed;
  ball.x = fromX; ball.y = fromY; ball.z = fromZ;
  ball.vx = (tx - fromX) / T;
  ball.vy = (ty - fromY) / T;
  ball.vz = (0.5 * G * T * T - fromZ) / T;
  // 球の高さにわずかなランダムブレを加えて自然にする
  ball.vz += (Math.random() - 0.5) * TUNING.jitter.z;
  ball.bounces = 0;
  ball.trail = [];
  ball.originX = fromX;
  ball.originY = fromY;
  ball.lastHitTime = matchTime;
}

// ネット通過時の高さ（届かない場合はnull）
export function netClearance(fromX, fromY, fromZ, tx, ty, speed) {
  const dist = Math.max(1.0, Math.hypot(tx - fromX, ty - fromY));
  const T = dist / speed;
  const vy = (ty - fromY) / T;
  if (Math.abs(vy) < 0.01) return null;
  const tn = (0 - fromY) / vy;
  if (tn < 0 || tn > T * 1.5) return null;
  const vz = (0.5 * G * T * T - fromZ) / T;
  return fromZ + vz * tn - 0.5 * G * tn * tn;
}

/* ===========================================================
 * 打球（ストローク・ボレー共通）
 *
 * 球種は選択式の5種（TUNING.shots: flat/drive/slice/drop/lob）。
 * プレイヤーの狙いは「着地点カーソル」（aimX/aimY・ワールド座標）で、
 * AIの打球は course（-1..1）で決める。
 *
 * プレイヤーの打球は「実際の打点位置」で球質が決まる:
 *   - 体の横の距離: 詰まるほど引っ張り方向の角度がつかなくなり、
 *     球速も落ちる（方向は消えず、許容角度の幅が狭くなるだけ）
 *   - 前後: 前すぎ=引っ張り強・低弾道、後ろ=流し強・弱い球
 *   - 高さ: 高い=速く低弾道 / 低い=すくい上げで弾道が上がる
 *   - 打点が悪いほど狙いが散らばる（ミスが出る）
 * ためた時間が長いほど鋭い角度を狙え、球速も少し上がる。
 * =========================================================== */


// フォア/バック判定: プレイヤー（奥向き）は画面右(x+)がフォア、CPUは画面左(x-)がフォア
export function isBackhandFor(side, hitterX, ballX) {
  if (side === "player") return ballX < hitterX - 0.1;
  return ballX > hitterX + 0.1;
}

// 狙い（ワールドx）とヒッターの立ち位置から表示用の呼び名を決める
export function courseLabelFor(hitterX, targetX) {
  const dx = targetX - hitterX;
  if (Math.abs(dx) < 1.2) return "まっすぐ";
  if (Math.abs(hitterX) < 0.6) return dx < 0 ? "左へ！" : "右へ！";
  const isCross = (hitterX > 0) === (dx < 0); // 立ち位置と逆へ打つ=クロス
  return isCross ? "クロス！" : "ストレート！";
}

/* ---- 打点の評価: 横距離・前後・高さ → 角度幅/球速/精度の係数 ---- */
export function evaluateContact(side, hitter, contactZ) {
  const c = TUNING.contact;
  const backhand = isBackhandFor(side, hitter.x, ball.x);
  const foreSign = side === "player" ? 1 : -1;       // フォア側のx方向
  const sideSign = backhand ? -foreSign : foreSign;  // 打点がある側のx方向
  const lateral = (ball.x - hitter.x) * sideSign;    // 体から打点までの横距離(m)

  // 詰まり度: 1=適正 〜 0=完全に詰まり
  const cramp = clamp01((lateral - c.minLateral) / (c.idealLateral - c.minLateral));
  // 泳ぎ度: 打点が遠すぎる（0=問題なし 〜 1=届くだけ）
  const overReach = clamp01((lateral - c.idealLateral - c.reachSlack) / c.reachRange);

  // 前後: 正=前すぎ（ネット寄り） / 負=後ろすぎ
  const frontDist = (hitter.y - ball.y) * (side === "player" ? 1 : -1);
  const front = Math.max(-1, Math.min(1, (frontDist - c.frontYIdeal) / c.yTolerance));

  // 高さ: 正=高い打点（強打ゾーン） / 負=低い打点（すくい上げ）
  let heightK = 0;
  if (contactZ > c.idealZHigh) heightK = clamp01((contactZ - c.idealZHigh) / 1.0);
  else if (contactZ < c.idealZLow) heightK = -clamp01((c.idealZLow - contactZ) / c.idealZLow);

  // 引っ張り/流しの方向（右利き想定）:
  //   フォアの引っ張り=体の逆側へ（プレイヤーのフォアなら画面左）、流し=打点側へ
  const pullSign = -sideSign;
  const flowSign = sideSign;

  // 角度幅の倍率: 詰まるほど引っ張りはほぼ真っ直ぐのみ、流しは比較的残る
  let pullMul = lerp(c.pullCrampMin, 1, cramp);
  let flowMul = lerp(c.flowCrampMin, 1, cramp);
  // 前すぎ: 引っ張りが強くなり流しの角度がつかない / 後ろ: その逆
  if (front > 0) {
    pullMul = Math.min(1.25, pullMul * (1 + c.frontPullBoost * front));
    flowMul *= 1 - c.frontFlowDrop * front;
  } else if (front < 0) {
    flowMul = Math.min(1.25, flowMul * (1 + c.backFlowBoost * -front));
    pullMul *= 1 - c.backPullDrop * -front;
  }
  // 泳いだら両方向とも角度がつかない
  const reachMul = 1 - c.reachAngleDrop * overReach;
  pullMul *= reachMul;
  flowMul *= reachMul;

  // 球速倍率
  let speedMul = backhand ? c.backhandPower : 1;
  speedMul *= 1 - c.crampSpeedDrop * (1 - cramp);     // 詰まると返すだけの球質
  speedMul *= 1 - c.reachSpeedDrop * overReach;
  if (heightK > 0) speedMul *= 1 + c.highZBonus * heightK;       // 高い打点=速く低弾道
  else if (heightK < 0) speedMul *= 1 - c.lowZLoft * -heightK;   // 低い打点=遅く山なり
  if (front > 0) speedMul *= 1 + c.frontSpeedBoost * front;
  else if (front < 0) speedMul *= 1 - c.backSpeedDrop * -front;

  // 総合品質 → 散らばり（ミス率）
  const overall = cramp
    * (1 - 0.5 * overReach)
    * (1 - 0.25 * Math.abs(front))
    * (1 - 0.2 * Math.abs(heightK));
  const sigma = c.sigmaBase + c.sigmaBad * (1 - overall);

  // 前後ズレで打球が自然に流れる方向（前=引っ張り側 / 後ろ=流し側）
  const driftX = pullSign * c.driftFront * Math.max(0, front)
    + flowSign * c.driftBack * Math.max(0, -front);

  return {
    backhand: backhand, cramp: cramp, overReach: overReach,
    front: front, heightK: heightK,
    pullSign: pullSign, flowSign: flowSign,
    pullMul: pullMul, flowMul: flowMul,
    speedMul: speedMul, sigma: sigma, driftX: driftX, overall: overall,
  };
}


export function hitBall(opts) {
  const side = opts.side;
  const hitter = opts.hitter;
  const stats = hitter.stats;
  const chargeK = Math.max(0, Math.min(1, opts.charge || 0));
  const contactZ = opts.contactZ != null ? opts.contactZ : ball.z;
  // 系統（shoot/cut/lob）が来たら打点高さ・狙いの深さで内部の5種へ振り分ける。
  // カットは着地カーソルの深さで slice/drop が連続的に決まる（ため分岐は廃止）。
  // AIや旧来の直接指定（flat/drive/...）はそのまま使う。
  let shotKey;
  if (SHOT_FAMILY_ORDER.indexOf(opts.shot) >= 0) {
    shotKey = resolveShotKey(opts.shot, contactZ, opts.aimY);
  } else {
    shotKey = TUNING.shots[opts.shot] ? opts.shot : "drive";
  }
  // スマッシュ自動判定: ネット前で高い球を捉えたら球種選択に関わらずスマッシュへ。
  // ロブ選択は意図的な高弾道なので対象外（前衛が高い球をロブで逃がせる）。
  const isSmash = opts.shot !== "lob" && isSmashContact(hitter, contactZ);
  if (isSmash) shotKey = "smash";
  const def = TUNING.shots[shotKey];
  const backhand = isBackhandFor(side, hitter.x, ball.x);
  const depthDir = side === "player" ? -1 : 1;
  const fromZ = Math.max(0.3, Math.min(contactZ, 2.3));

  let tx, ty, speed, sigma;
  let ev = null;

  if (opts.byPlayer) {
    // プレイヤー操作: 着地点カーソル（aimX/aimY）を狙う。
    // ただし打点品質による角度幅制限がかかり、詰まったときに
    // 鋭い角度を狙っても浅い角度（体の正面寄り）に補正される
    ev = evaluateContact(side, hitter, contactZ);
    const aimX = opts.aimX != null ? opts.aimX : 0;
    const desired = aimX - hitter.x;
    const angleSpan = TUNING.contact.maxAngle
      * (1 + TUNING.charge.angleBonus * chargeK); // ためが長いほど鋭い角度
    const dirSign = desired >= 0 ? 1 : -1;
    const mul = (dirSign === ev.pullSign) ? ev.pullMul : ev.flowMul;
    const maxOffset = angleSpan * mul;
    tx = hitter.x + Math.max(-maxOffset, Math.min(maxOffset, desired)) + ev.driftX;
    ty = opts.aimY != null
      ? Math.max(-(COURT.halfL - 0.4), Math.min(-TUNING.aim.minDepth, opts.aimY))
      : depthDir * (def.depthMin + Math.random() * def.depthRange);
    speed = def.speed * stats.power * ev.speedMul
      * (1 + TUNING.charge.speedBonus * chargeK);
    sigma = ev.sigma / Math.min(Math.max(stats.control, 0.5), 1.3);
  } else {
    // AI: コース(-1..1)からそのまま目標を決める
    const course = Math.max(-1, Math.min(1, opts.course || 0));
    const accuracy = (backhand ? 0.7 : 1.0) * Math.min(stats.control, 1.3);
    tx = course * 3.5;
    sigma = 0.45 + 1.0 * Math.max(0, 1.1 - accuracy);
    speed = def.speed * stats.power * (backhand ? 0.9 : 1.0)
      * (1 + TUNING.charge.speedBonus * chargeK);
    // cpuSpeedScale は廃止（両チーム共通パラメータで対称化済み）
    ty = depthDir * (def.depthMin + Math.random() * def.depthRange);
  }

  // ドロップは横へ散らさずネット際を狙う（プレイヤーはカーソルを尊重）
  if (shotKey === "drop") {
    if (!opts.byPlayer) tx = hitter.x + (tx - hitter.x) * 0.35;
    sigma *= 0.6;
  }

  // 散らばり + 自然なブレ
  tx += (Math.random() - 0.5) * 2 * sigma;
  ty += (Math.random() - 0.5) * 2 * sigma * 0.8 + (Math.random() - 0.5) * 2 * TUNING.jitter.x;
  tx = Math.max(-6.5, Math.min(6.5, tx)); // コート外もあり得る（ミス）

  // CPUは時々凡ミスする（初心者でもポイントが取れる難易度調整）。
  // 観戦モード（AI対AI）では公平性のため無効。
  if (side === "cpu" && !spectatorMode && Math.random() < 0.04) {
    if (Math.random() < 0.5) {
      tx = (tx >= 0 ? 1 : -1) * (COURT.halfW + 0.6 + Math.random() * 1.2); // サイドアウト
    } else {
      ty = depthDir * (COURT.halfL + 0.8 + Math.random() * 1.5);           // ベースラインオーバー
    }
  }

  speed = Math.max(4.0, speed);

  // ネット越えアシスト: 打点が悪いときは補正なし（ネットのリスクが残る）
  const assist = shotKey !== "drop" && (!ev ? true : ev.overall > 0.35);
  if (assist) {
    let tries = 0;
    while (tries < 5) {
      const clr = netClearance(hitter.x, hitter.y, fromZ, tx, ty, speed);
      if (clr === null || clr > COURT.netH + 0.25) break;
      speed *= 0.93;
      tries++;
    }
  }

  ball.spin = def.spin;
  ball.spinMag = def.spinMag;
  ball.trailColor = def.color;
  ball.lastHitter = side;
  ball.serving = false;
  ball.frontChecked = (side === "cpu") ? false : true;
  ball.cpuFrontChecked = (side === "player") ? false : true;
  setReceiveDone(true); // サーブ以外の打球が出た=レシーブ完了（前衛が動き出せる）
  launchBall(hitter.x, hitter.y, fromZ, tx, ty, speed);

  // 打球を受ける側チームの前衛に作戦を抽選する（両チーム対称）。
  // player が打つ→相手(cpu)前衛、cpu が打つ→味方(player)前衛。
  // 味方前衛のポーチは観戦モードでのみ自走（人間モードは partnerAggressiveness 側で制御）。
  if (side === "player") {
    setCpuFrontPlan(pickFrontPlan());
    setPlayerFrontPlan("base");
  } else {
    setCpuFrontPlan("base");
    setPlayerFrontPlan(spectatorMode ? pickFrontPlan() : "base");
  }

  startSwing(hitter, backhand ? "back" : "fore");

  // スマッシュは決め球として大きく告知（プレイヤー・AI前衛とも）
  if (isSmash) {
    effects.push({
      type: "text",
      x: hitter.x, y: hitter.y - 0.6, t: 0, ttl: 0.8,
      text: "スマッシュ！",
      color: "#F43F5E",
    });
  }

  setLastHitInfo({
    side: side, shot: shotKey, course: opts.course != null ? opts.course : null,
    aimX: opts.aimX != null ? opts.aimX : null,
    aimY: opts.aimY != null ? opts.aimY : null,
    tx: tx, ty: ty, speed: speed, byPlayer: !!opts.byPlayer,
    contact: ev,
  });

  // 打球時のフィードバック表示（コース + 打点品質）
  if (opts.byPlayer && side === "player" && hitter === rallyControlled) {
    effects.push({
      type: "text",
      x: hitter.x, y: hitter.y, t: 0, ttl: 0.7,
      text: courseLabelFor(hitter.x, tx),
      color: "#10B981",
    });
    let qualityText = null;
    let qualityColor = "#F59E0B";
    if (ev.cramp < 0.35) { qualityText = "詰まった！"; }
    else if (ev.overReach > 0.5) { qualityText = "泳いだ！"; }
    else if (ev.overall > 0.85) { qualityText = "ジャスト！"; qualityColor = "#22C55E"; }
    else if (ev.backhand) { qualityText = "バック"; qualityColor = "#F59E0B"; }
    if (qualityText) {
      effects.push({
        type: "text",
        x: hitter.x, y: hitter.y - 0.9, t: 0, ttl: 0.8,
        text: qualityText,
        color: qualityColor,
      });
    }
  }
}

export function startSwing(p, side) {
  p.pose = "swing";
  p.swingSide = side;
  p.swingT = 0.32;
}

/* ===========================================================
 * 得点処理
 * =========================================================== */

export function awardPoint(toPlayer, reason) {
  if (state === "point" || state === "gameset" || state === "matchend") return;
  if (toPlayer) player.points++;
  else cpu.points++;
  setServeFaults(0);

  const winPts = isFinalGame() ? FINAL_GAME_POINTS : POINTS_TO_WIN_GAME;
  const pP = player.points;
  const cP = cpu.points;
  if (pP >= winPts && pP - cP >= 2) { finishGame(true); return; }
  if (cP >= winPts && cP - pP >= 2) { finishGame(false); return; }

  updateScoreboard();
  setState("point");
  showMessage((toPlayer ? "ポイント！" : "相手のポイント") + (reason ? "\n" + reason : ""));
  setTimeout(function () {
    if (state === "point") startServe(false);
  }, TUNING.tempo.pointDelay);
}

export function finishGame(playerWon) {
  if (playerWon) player.games++;
  else cpu.games++;
  player.points = 0;
  cpu.points = 0;
  updateScoreboard();

  if (player.games >= GAMES_TO_WIN_MATCH || cpu.games >= GAMES_TO_WIN_MATCH) {
    setState("matchend");
    showMessage(playerWon ? "ゲーム獲得！" : "ゲームを落とした");
    setTimeout(function () {
      endMatch(player.games >= GAMES_TO_WIN_MATCH);
    }, TUNING.tempo.gameDelay);
    return;
  }

  setState("gameset");
  // ゲームをまたぐ（サーブ権交代）→ レシーブ受け持ちを再設定
  assignReceiverSides();
  showMessage(playerWon ? "ゲーム獲得！" : "ゲームを落とした");
  setTimeout(function () {
    if (state === "gameset") startServe(true);
  }, TUNING.tempo.gameDelay);
}

export function endMatch(playerWon) {
  cancelAnimationFrame(rafId);
  setRafId(null);
  showScreen("result");
  if (playerWon) {
    resultTitle.textContent = "WIN!";
    resultTitle.className = "result-title is-win";
    resultDetail.textContent = player.games + " - " + cpu.games + " で勝利しました";
  } else {
    resultTitle.textContent = "LOSE...";
    resultTitle.className = "result-title is-lose";
    resultDetail.textContent = player.games + " - " + cpu.games + " で敗れました";
  }
}

/* ===========================================================
 * サーブのフォルト処理（2本制）
 * =========================================================== */

export function serveFault(reason) {
  incServeFaults();
  if (serveFaults >= 2) {
    const receiverIsPlayer = serverTeamNow() === "cpu";
    setServeFaults(0);
    awardPoint(receiverIsPlayer, "ダブルフォルト");
    return;
  }
  setState("fault");
  showMessage("フォルト\n" + reason);
  setTimeout(function () {
    if (state === "fault") startServe(false);
  }, TUNING.tempo.faultDelay);
}

/* ===========================================================
 * バウンド・ラリー判定
 * =========================================================== */

// オンザライン（ライン上）はイン。ボール半径＋ライン幅相当の余裕を持たせ、
// 着地点がラインに掛かっていればインと判定する。

export function insideCourt(x, y) {
  return Math.abs(x) <= COURT.halfW + LINE_IN_MARGIN && Math.abs(y) <= COURT.halfL + LINE_IN_MARGIN;
}

export function insideBox(x, y, box) {
  var m = LINE_IN_MARGIN;
  return x >= box.x1 - m && x <= box.x2 + m && y >= box.y1 - m && y <= box.y2 + m;
}

export function handleBounce() {
  ball.z = 0;
  ball.bounces++;
  ball.flashT = 0.22;
  effects.push({ type: "ripple", x: ball.x, y: ball.y, t: 0, ttl: 0.45 });

  const hitterIsPlayer = ball.lastHitter === "player";

  if (ball.bounces === 1) {
    if (ball.serving) {
      const box = serviceBox(ball.lastHitter);
      if (insideBox(ball.x, ball.y, box)) {
        ball.serving = false; // サービスイン → そのままラリーへ
      } else {
        serveFault("サービスコートに入らなかった");
        return;
      }
    } else if (!insideCourt(ball.x, ball.y)) {
      awardPoint(!hitterIsPlayer, hitterIsPlayer ? "アウト" : "相手のアウト");
      return;
    }
  } else if (ball.bounces >= 2) {
    // ツーバウンドはボールが落ちた側のコートのチームが失点
    awardPoint(ball.y < 0, "ツーバウンド");
    return;
  }

  // 反発は回転の種類と強さで変わる:
  //   slice: 止まる・低く滑る / drive: 食い込んで伸びる / flat: 中間
  //   spinMagが大きいほど flat からの差が強調される
  const sp = TUNING.spin[ball.spin] || TUNING.spin.flat;
  const flat = TUNING.spin.flat;
  const k = Math.min(1.3, Math.max(0, ball.spinMag != null ? ball.spinMag : 1));
  const friction = Math.max(0.3, Math.min(0.97, flat.friction + (sp.friction - flat.friction) * k));
  const restitution = Math.max(0.12, Math.min(0.78, flat.restitution + (sp.restitution - flat.restitution) * k));
  ball.vz = -ball.vz * restitution;
  ball.vx *= friction;
  ball.vy *= friction;
}

export function checkNet(prevY) {
  if ((prevY > 0) === (ball.y > 0)) return false;
  // ネット面通過時の高さを補間
  const t = prevY / (prevY - ball.y);
  const zAt = ball.z; // 1フレーム内なので近似でよい
  if (zAt < COURT.netH && Math.abs(ball.x) < COURT.halfW + 0.4) {
    const hitterIsPlayer = ball.lastHitter === "player";
    if (ball.serving) {
      serveFault("ネット");
    } else {
      awardPoint(!hitterIsPlayer, hitterIsPlayer ? "ネット" : "相手のネット");
    }
    return true;
  }
  return false;
}

// 現在の速度から次の着地点を予測
export function predictLanding() {
  const vz = ball.vz;
  const z = Math.max(ball.z, 0);
  const t = (vz + Math.sqrt(vz * vz + 2 * G * z)) / G;
  if (!isFinite(t) || t <= 0) return null;
  return { x: ball.x + ball.vx * t, y: ball.y + ball.vy * t, t: t };
}

// バウンド後にボールが最も高くなる点（頂点）を、球種(スピン)の反発・摩擦と
// 速さから予測する。後衛はこの点に構えると最も高い打点で打てる。
//   slice: 反発小→低く滑る（頂点は低く、手前寄り）
//   drive/flat: 反発大→高く弾む（頂点が高く、奥寄り）
export function predictHighContact() {
  const L = predictLanding();
  if (!L) return null;
  const vzLand = Math.abs(ball.vz - G * L.t); // 着地時の落下速度の大きさ
  const sp = TUNING.spin[ball.spin] || TUNING.spin.flat;
  const flat = TUNING.spin.flat;
  const k = Math.min(1.3, Math.max(0, ball.spinMag != null ? ball.spinMag : 1));
  const friction = Math.max(0.3, Math.min(0.97, flat.friction + (sp.friction - flat.friction) * k));
  const restitution = Math.max(0.12, Math.min(0.78, flat.restitution + (sp.restitution - flat.restitution) * k));
  const vzOut = vzLand * restitution;       // バウンド後の上向き初速
  const tApex = vzOut / G;                   // 頂点までの時間
  return {
    x: L.x + ball.vx * friction * tApex,     // 頂点でのx（横速度はバウンドで friction 倍）
    y: L.y + ball.vy * friction * tApex,     // 頂点でのy
    apexZ: (vzOut * vzOut) / (2 * G),         // バウンド頂点の高さ
    landing: L,
  };
}

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
 * - スマホ: スティックで移動（ため/トス中はスティックが狙いへ切替）、下部ボタンタップでスイング
 * =========================================================== */


// Space = ロブ修飾キー。押している間にクリックすると球種がロブになる。

// 自由移動できるy方向の範囲（操作キャラクターの役割に応じて変える）


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

// 狙いの更新: PCはマウスが指すコート地点へ着地カーソルを追従、スマホはスティック。
//   ラリーのため中 → aim（相手コート内にクランプ）
//   サーブのトス前/トス中 → serveAimCursor（対角サービスコート±わずかにクランプ）
export function updateAimInputs(dt) {
  if (spectatorMode) return; // 観戦モードはマウス/スティック入力を使わない（全員AI）
  if (state === "rally" && charge.active) {
    const c = TUNING.aim;
    if (mouseAim.valid) {
      // マウスが指すコート地点をそのまま狙いに（相手コート＝負のy側へ）
      aim.x = mouseAim.x;
      aim.y = mouseAim.y;
    } else if (stick.active) {
      // スマホ: スティックで着地カーソルを相対移動
      aim.x += stick.dx * c.cursorSpeed * dt;
      aim.y += stick.dy * c.cursorSpeed * dt;
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
    } else if (stick.active) {
      serveAimCursor.x += stick.dx * c.cursorSpeed * dt;
      serveAimCursor.y += stick.dy * c.cursorSpeed * dt;
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

// 開始画面: ポジション（後衛/前衛）と陣形の選択
positionControls.addEventListener("click", function (e) {
  const btn = e.target.closest(".ctrl-btn");
  if (!btn) return;
  setPlayerPosition(btn.dataset.position);
  setActiveButton(positionControls, btn);
});

formationControls.addEventListener("click", function (e) {
  const btn = e.target.closest(".ctrl-btn");
  if (!btn) return;
  setFormation(btn.dataset.formation);
  setActiveButton(formationControls, btn);
});

// 観戦モード（AI対AI）の切替。ONのときはポジション選択を無効化する
// （rallyControlledもAIが操作するため、操作キャラの選択は表示上の意味のみ）。
if (spectatorToggle) {
  spectatorToggle.addEventListener("click", function () {
    setSpectatorMode(!spectatorMode);
    spectatorToggle.dataset.spectator = spectatorMode ? "on" : "off";
    spectatorToggle.classList.toggle("is-active", spectatorMode);
    spectatorToggle.textContent = spectatorMode ? "観戦モード: ON（4人ともAI）" : "観戦: AI対AI に切替";
    positionControls.querySelectorAll(".ctrl-btn").forEach(function (b) {
      b.disabled = spectatorMode;
    });
    startBtn.textContent = spectatorMode ? "観戦を始める" : "試合を始める";
  });
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
canvas.addEventListener("mousemove", function (e) {
  updateMouseAimFromEvent(e);
});
// 右クリックのコンテキストメニューは抑止（右クリック=カット/カットサーブとして使う）
canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

// コートをクリック: 球種はクリックしたボタンで決まる
//   左クリック = シュート（フラット/ドライブ）/ サーブはトス→フラットサーブ
//   右クリック = カット（スライス/ドロップ） / サーブはカットサーブ
//   Spaceを押しながらクリック = ロブ
// 打点ゾーン中も自動でため済みのため、クリック=即スイング。
// マウス以外（タッチ/ペン）はタップ=左クリック相当（フラット系）。
canvas.addEventListener("pointerdown", function (e) {
  let button = 0;
  if (e.pointerType === "mouse") {
    button = e.button;
    if (button !== 0 && button !== 2) return; // 中ボタン等は無視
    updateMouseAimFromEvent(e);        // 押した瞬間の地点を即狙いへ反映
  }
  if (state === "serve-stance" || state === "serve-toss") {
    playerServeAction(button);
    return;
  }
  attemptSwing(shotFamilyForClick(button));
});


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

/* ===========================================================
 * AI（味方パートナー・CPUペア）
 *
 * 自由移動・新サーブフローに対応。難易度は従来どおり易しめ。
 * 前衛がサーブする番は「打つまでベースライン後方に留まり、
 * 打った後にサービスダッシュで前へ詰める」。
 * 味方パートナーは陣形（雁行陣/ダブル後衛/ダブル前衛）に応じた
 * 定位置で動き、操作キャラが届かないボールを返球する。
 * =========================================================== */

export function moveToward(p, tx, ty, maxDist) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.01) return;
  const step = Math.min(d, maxDist);
  p.x += (dx / d) * step;
  p.y += (dy / d) * step;
}

// 相方がいま「自分のサーブを打つ前」かどうか（AIサーバーは動かさない）
export function partnerIsServingNow(partner) {
  return (state === "serve-stance" || state === "serve-toss") &&
    serverTeamNow() === "player" && currentServer() === partner;
}

// AI自動移動の共通ロジック（playerチーム・cpuチーム共通）。
// side: "player"(自陣y+側) または "cpu"(自陣y-側)
// p: 移動させる選手オブジェクト
// ロール（前衛/後衛）は side に応じた myFront/myBack で判定する。
export function moveAutoAI(p, side, dt) {
  const speed = TUNING.move.aiSpeed * p.stats.speed;
  const myFront  = side === "player" ? front    : cpuFront;
  const myBack   = side === "player" ? back     : cpuBack;
  const oppFront = side === "player" ? cpuFront : front;
  const oppBack  = side === "player" ? cpuBack  : back;
  // 自陣方向: player側はy+（自陣ベースライン y>0）、cpu側はy-（y<0）
  const homeSign = side === "player" ? 1 : -1;
  const homeBackY  = TUNING.pos.backY * homeSign;
  const opponentTeam = side === "player" ? "cpu" : "player";
  const myTeam = side;

  // 自分がサーブを打つ前はサーブ位置から動かない
  if ((state === "serve-stance" || state === "serve-toss") &&
      serverTeamNow() === myTeam && currentServer() === p) {
    return;
  }

  // 相手サーブ中: レシーバー担当ならレシーブ位置へ、それ以外は定位置で待機
  if ((state === "serve-stance" || state === "serve-toss") &&
      serverTeamNow() === opponentTeam) {
    if (p === receiverPlayerFor(myTeam)) {
      const rp = receivePosition(myTeam);
      moveToward(p, rp.x, rp.y, speed * 1.2 * dt);
    }
    return;
  }

  // 自分のサーブ前は、サーバー以外（味方前衛など）も持ち場で待つ。
  // サーブを打つ前にセンターマークを越えて動かない（ここで止める）。
  if (state === "serve-stance" || state === "serve-toss") {
    return;
  }

  // 相手のサーブが飛んでいる間（最初の返球まで＝!receiveDone）は、レシーブ担当だけがボールを追う。
  // 担当でない味方はその場で待機（前衛がレシーバーの逆クロスでも後衛が追ってしまうバグ防止）。
  if (!receiveDone && state === "rally" && ball.lastHitter === opponentTeam) {
    if (p === receiverPlayerFor(myTeam)) {
      const landing = predictLanding();
      let tx = p.x, ty = p.y;
      if (ball.bounces >= 1) {
        tx = ball.x + ball.vx * 0.2;
        ty = homeSign > 0 ? Math.min(COURT.halfL + 5.0, Math.max(4.0, ball.y + ball.vy * 0.2))
                          : Math.max(-(COURT.halfL + 5.0), Math.min(-4.0, ball.y + ball.vy * 0.2));
      } else if (landing && landing.y * homeSign > 0 && insideCourt(landing.x, landing.y)) {
        // サーブも球種・速さからバウンド後の頂点を予測し、そこで高い打点で迎える。
        const hc = predictHighContact();
        let depth = hc ? Math.abs(hc.y) : Math.abs(landing.y) + 0.6;
        depth = Math.min(COURT.halfL + 5.0, Math.max(Math.abs(landing.y), depth));
        tx = Math.max(-COURT.halfW, Math.min(COURT.halfW, hc ? hc.x : landing.x));
        ty = homeSign > 0 ? depth : -depth;
      }
      moveToward(p, tx, ty, speed * 1.25 * dt);
      p.x = Math.max(-7.5, Math.min(7.5, p.x));
    }
    return;
  }

  // 前衛はレシーブが完了するまでポジション移動しない。
  // ただし自分がサーブした直後のサービスダッシュは始めてよい
  const myJustServedByFront = side === "player" ? pointJustServedByFront : cpuJustServedByFront;
  if (p === myFront && !receiveDone) {
    if (state === "rally" && myJustServedByFront && formation !== "double-back") {
      moveToward(myFront, myFront.homeX * (myBack.x > 0 ? -1 : 1), myFront.homeY, speed * 1.4 * dt);
      myFront.x = Math.max(-4.6, Math.min(4.6, myFront.x));
    }
    return;
  }

  // 前衛がサーブした直後はサービスダッシュ（速めに定位置へ）
  const dash = (state === "rally" && myJustServedByFront && p === myFront &&
    formation !== "double-back") ? 1.4 : 1.0;

  if (p === myFront) {
    // 前衛
    if (formation === "double-back") {
      const targetX = myBack.x > 0 ? -2.2 : 2.2;
      moveToward(myFront, targetX, myFront.homeY, speed * dt);
    } else if (state === "rally" && ball.lastHitter === opponentTeam && !ball.serving) {
      // 相手が打った瞬間も、基本は展開（クロス/ストレート）に応じた定位置を保つ。
      // 届くポーチのときだけネットへ踏み込む（常時ボール追従で同サイド/隅へ暴れさせない）。
      let frontTargetX = Math.max(-3.0, Math.min(3.0, frontDevX(myTeam)));
      let frontTy = frontMirrorY(myTeam, myFront.homeY);
      let frontDash = dash;
      // ポーチ作戦時の踏み込み移動（両チーム対称。player側は観戦モードのみ自走）。
      const myPlan = (side === "cpu") ? cpuFrontPlan : (spectatorMode ? playerFrontPlan : "base");
      if (myPlan === "poach") {
        const t2 = Math.abs(ball.vy) > 0.1 ? (myFront.homeY - ball.y) / ball.vy : -1;
        const predX = (t2 > 0) ? ball.x + ball.vx * t2 : ball.x;
        const poachReach = TUNING.ai.poachReach * myFront.stats.reach;
        if (Math.abs(predX - myFront.x) <= poachReach * 1.5) {
          frontTargetX = Math.max(-3.4, Math.min(3.4, predX));
          frontTy = myFront.homeY;
          frontDash = 1.3;
        }
      }
      // 相方前衛（プレイヤー=後衛のとき）のポーチ移動: 攻守スライダーで踏み込み積極性を制御
      if ((side === "player") && !spectatorMode && p === front &&
          rallyControlled !== front) {
        const aggr = partnerAggressiveness;
        // 着地予測でポーチ位置を決める（CPUポーチと対称）
        const t2p = Math.abs(ball.vy) > 0.1 ? (myFront.homeY - ball.y) / ball.vy : -1;
        const predXp = (t2p > 0 && t2p < 1.5) ? ball.x + ball.vx * t2p : ball.x;
        // 攻め度が高いほど広いリーチで踏み込む
        const pReach = (TUNING.ai.frontVolleyReach + aggr * 0.6) * myFront.stats.reach;
        if (aggr > 0.15 && Math.abs(predXp - myFront.x) <= pReach * 1.5) {
          frontTargetX = Math.max(-3.4, Math.min(3.4, predXp));
          frontTy = myFront.homeY;
          frontDash = 1.0 + aggr * 0.4; // 攻めるほど速く踏み込む
        }
      }
      // 前衛の守備側（後衛のいない側）のネット際へ低く来る球には、届く範囲で
      // 軽く一歩踏み込んでボレーに行く（大きくは追わず、後衛のクロス球は奪わない）。
      {
        const ownBackSign = myBack.x >= 0 ? 1 : -1;
        const frontSide = -ownBackSign; // 前衛が受け持つ側
        const tNet = Math.abs(ball.vy) > 0.1 ? (myFront.homeY - ball.y) / ball.vy : -1;
        if (tNet > 0 && tNet < 0.9) {
          const crossX = ball.x + ball.vx * tNet;
          const crossZ = ball.z + ball.vz * tNet - 0.5 * G * tNet * tNet; // ネット到達時の高さ
          const onMySide = (Math.sign(crossX) === frontSide); // 自分の守備側に来る球のみ
          const reach = TUNING.ai.frontVolleyReach * myFront.stats.reach;
          if (onMySide && crossZ < 1.3 && Math.abs(crossX - myFront.x) <= reach * 0.9) {
            frontTargetX = Math.max(-3.4, Math.min(3.4, crossX));
            frontTy = myFront.homeY;
            frontDash = Math.max(frontDash, 1.15);
          }
        }
      }
      moveToward(myFront, frontTargetX, frontTy, speed * frontDash * dt);
    } else if (state === "rally") {
      // 自分チームにボールがある間は展開に応じたセオリー位置へ戻る
      const tx = Math.max(-4.4, Math.min(4.4, frontDevX(myTeam)));
      const retSpeed = (side === "cpu" && !spectatorMode) ? speed * 0.8 : speed * dash;
      moveToward(myFront, tx, frontMirrorY(myTeam, myFront.homeY), retSpeed * dt);
    } else {
      moveToward(myFront, myFront.homeX * (myBack.x > 0 ? -1 : 1), myFront.homeY, speed * dash * dt);
    }
    myFront.x = Math.max(-4.6, Math.min(4.6, myFront.x));
  } else {
    // 後衛: ストローク役としてボールを追う
    if (state === "rally" && ball.lastHitter === opponentTeam) {
      if ((side === "cpu" || spectatorMode) && matchTime - ball.lastHitTime < TUNING.ai.backReactionDelay) return;
      const landing = predictLanding();
      let tx = backDevX(myTeam);
      let ty = homeBackY;
      if (ball.bounces >= 1) {
        // バウンド後はボールへ寄せるが、ベースライン後方へ深追いしすぎない
        // （深く下がると落ちてきた球を低く打つことになる）。
        tx = ball.x + ball.vx * 0.2;
        ty = homeSign > 0
          ? Math.min(COURT.halfL + 5.0, Math.max(4.5, ball.y + ball.vy * 0.2))
          : Math.max(-(COURT.halfL + 5.0), Math.min(-4.5, ball.y + ball.vy * 0.2));
      } else if (landing && landing.y * homeSign > 0 && insideCourt(landing.x, landing.y)) {
        const isLob = ball.spin === "flat" && ball.z > 2.0 &&
          Math.abs(landing.y) > COURT.serviceY;
        // 球種(スピン)の反発・摩擦と速さから「バウンド後にボールが最も高くなる点(頂点)」を
        // 予測し、そこに構える。これでバウンド地点へ走り込まず、最も高い打点で打てる。
        // ドライブ/フラットは高く弾むので奥め、スライスは低く滑るので手前、と自動で変わる。
        const hc = predictHighContact();
        let depth = hc ? Math.abs(hc.y) : Math.abs(landing.y) + 0.6;
        // バウンドより手前にはしない・コート後方に出すぎない
        depth = Math.min(COURT.halfL + 5.0, Math.max(Math.abs(landing.y), depth));
        const hx = hc ? hc.x : landing.x;
        const xCap = isLob ? COURT.singlesHalfW + 0.3 : COURT.halfW;
        tx = Math.max(-xCap, Math.min(xCap, hx));
        ty = homeSign > 0 ? depth : -depth;
      }
      moveToward(myBack, tx, ty, speed * 1.2 * dt);
    } else if (state === "rally" && myJustServedByFront) {
      // 前衛パートナーがサーブした回: 後衛はカバー位置へ
      const targetX = myFront.x > 0 ? -1.6 : 1.6;
      moveToward(myBack, targetX, homeBackY * 1.02, speed * dt);
    } else {
      // 自分側にボールがある間は展開に応じた定位置へ戻る
      const retSpeed = (side === "cpu" && !spectatorMode) ? speed * 0.55 : speed;
      moveToward(myBack, backDevX(myTeam), homeBackY, retSpeed * dt);
    }
    myBack.x = Math.max(-7.5, Math.min(7.5, myBack.x));
  }
}

// 味方パートナー（プレイヤーが操作していない方）の自動移動
export function updatePartner(dt) {
  const partner = (rallyControlled === back) ? front : back;
  moveAutoAI(partner, "player", dt);
}

// 観戦モード: 操作キャラ（rallyControlled）もAIが移動させる。
// 共通移動ロジック（moveAutoAI）を自チーム（player側）として適用する。
export function updateRallyControlledAI(dt) {
  if (!spectatorMode) return;
  moveAutoAI(rallyControlled, "player", dt);
}

// 観戦モード: 操作キャラ（rallyControlled）の打球判断（コース・球種・狙い）。
// CPU後衛のコース選択（cpuTryReturn）と同じ考え方で、相手前衛のいない側を
// 主体に狙う。球種はシュート/カット/ロブを状況に応じて振り分け、
// 着地点(aimX/aimY)に変換してbyPlayer経路（hitBall）へ渡す。
export function chooseAiHitForRallyControlled() {
  const cp = rallyControlled;

  // セオリー: 基本はクロスのコーナー（相手後衛側＝アレー寄り）へ返す。
  let course;
  if (Math.random() < 0.65) {
    course = (cpuBack.x >= 0 ? 1 : -1) * (0.78 + Math.random() * 0.32);
  } else {
    course = (Math.random() - 0.5) * 1.9;
  }

  // 球種選択: ネット前で打点が高ければスマッシュ（hitBall内で自動判定）。
  // それ以外はシュート中心、時々カット、ネット際に詰まったらロブで逃げる。
  let family;
  const r = Math.random();
  if (cp.y < 4.0 && ball.z > 1.5 && ball.z < 2.3 && r < 0.25) {
    family = "lob";
  } else if (r < 0.55) {
    family = "shoot";
  } else if (r < 0.85) {
    family = "cut";
  } else {
    family = "lob";
  }

  const aimX = Math.max(-(COURT.singlesHalfW - 0.3), Math.min(COURT.singlesHalfW - 0.3, course * 3.5));
  const depth = TUNING.aim.defaultY + (Math.random() - 0.5) * 3.0;
  const aimY = Math.max(-(COURT.halfL - 0.6), Math.min(-TUNING.aim.minDepth, -depth));

  return { shot: family, aimX: aimX, aimY: aimY };
}

export function updateCpuBack(dt) {
  moveAutoAI(cpuBack, "cpu", dt);
}

// 相手後衛（＝こちらに打ってくる側）の打点位置を返す。
//   side="cpu": 相手はプレイヤー。side="player": 相手はCPU。
// 相手が打った球が飛来中はその打点(originX)を、こちらの打球が飛行中
// （サーブ含む）は飛んでいる球ではなく相手後衛の現在位置を基準にする。
// （飛行中の自球xを使うと、球がコートを横切るのに合わせて展開判定/定位置が
//   左右に振れてしまうため）。
export function opponentHitterPos(side) {
  if (side === "cpu") {
    // CPUから見た相手＝プレイヤー側
    if (ball.lastHitter === "player") return { x: ball.originX, y: ball.originY };
    return { x: back.x, y: back.y };
  }
  if (ball.lastHitter === "cpu") return { x: ball.originX, y: ball.originY };
  return { x: cpuBack.x, y: cpuBack.y };
}

/* ===========================================================
 * クロス/ストレート展開の判定（陣形の動的切替）
 *
 * ソフトテニスのセオリー（softtennis-zenei.com /position）:
 *   クロス展開（後衛同士が対角でラリー）:
 *     「後衛がいない方のサイドに前衛が立つ」。自後衛が右なら前衛は左ネット前。
 *     前衛はサイドへ寄りすぎてセンターを空けない。
 *   ストレート展開（ボールがストレート＝同サイドへ展開）:
 *     前衛と後衛が同じサイドに並ぶ（サイドバイサイド）。前衛は
 *     「相手後衛の打点─自センター」線上でセンターより内側、後衛はストレート側ラインを担当。
 *
 * 判定: 自陣後衛と相手後衛のx符号（コート左右サイド）を比較する。
 *   後衛同士が逆サイド = クロス展開（対角でラリーしている）
 *   後衛同士が同サイド = ストレート展開（自後衛の側へ来ている）
 *   ヒステリシス: 両後衛ともセンター付近（|x|<devHysteresis）のとき切替保留。
 *   ボールの着地予測ではなく後衛の位置関係を軸にして判定を安定させる。
 * =========================================================== */

// その展開判定で使う「自陣後衛」のx符号（操作キャラ/AIに関わらずコート上の後衛役）
export function ownBackPlayer(side) { return side === "cpu" ? cpuBack : back; }
export function ownFrontPlayer(side) { return side === "cpu" ? cpuFront : front; }

// 相手の打球がこちらのどのサイドへ向かっているか（着地予測のx符号）。
// 予測できないときは相手打点の符号で代用する。
export function incomingSideSign(side) {
  const incoming = (side === "cpu") ? (ball.lastHitter === "player")
                                    : (ball.lastHitter === "cpu");
  if (incoming) {
    const landing = predictLanding();
    if (landing && Math.abs(landing.x) > 0.2) return landing.x >= 0 ? 1 : -1;
    if (Math.abs(ball.x) > 0.2) return ball.x >= 0 ? 1 : -1;
  }
  const op = opponentHitterPos(side);
  return op.x >= 0 ? 1 : -1;
}

// 展開状態（チームごと）。"cross" / "straight"。ヒステリシス付きで更新する。

// side から見た「相手後衛」
export function oppBackPlayer(side) { return side === "cpu" ? back : cpuBack; }

// 展開判定: 自陣後衛と相手後衛のx符号（コート左右サイド）を比較する。
//   後衛同士が対角（逆サイド）= クロス展開
//   後衛同士が同サイド         = ストレート展開
//   ヒステリシス: 両後衛ともセンター付近（|x| < devHysteresis）のとき切替保留。
export function updateDevelopment(side) {
  const ownBackP = ownBackPlayer(side);
  const oppBackP = oppBackPlayer(side);
  const ownBackSign = ownBackP.x >= 0 ? 1 : -1;
  const oppBackSign = oppBackP.x >= 0 ? 1 : -1;
  // 後衛同士が逆サイド=クロス展開、同サイド=ストレート展開
  const raw = (ownBackSign !== oppBackSign) ? "cross" : "straight";
  // ヒステリシス: 両後衛ともセンター付近では切替を保留する
  const hysteresis = TUNING.pos.devHysteresis;
  if (Math.abs(ownBackP.x) < hysteresis && Math.abs(oppBackP.x) < hysteresis) {
    return development[side];
  }
  development[side] = raw;
  return raw;
}

// 展開に応じた前衛のx定位置。
//   クロス: 後衛がいない側（-ownBackSign）のネット前。|x|<=3.0 でクランプ。
//   ストレート: 後衛と同サイドでセンターより内側（線上の内側）。
export function frontDevX(side) {
  const dev = updateDevelopment(side);
  const ownBackSign = ownBackPlayer(side).x >= 0 ? 1 : -1;
  if (dev === "straight") {
    // 同サイドへ並ぶ。相手打点─自センター線上の内側に寄る
    const lineX = frontTheoryX(side, ownFrontPlayer(side).homeY);
    const inside = ownBackSign * TUNING.pos.straightFrontX;
    // 線上の値と「同サイド内側」の中間。センターより内側を保つ
    const x = (lineX + inside) / 2;
    return Math.max(-3.0, Math.min(3.0, x));
  }
  // クロス展開: 後衛のいない側のネット前。隅へ吸い込まれない
  return Math.max(-3.0, Math.min(3.0, -ownBackSign * TUNING.pos.crossFrontX));
}

// 展開に応じた後衛のx定位置。
//   クロス: クロス側の残り範囲の真ん中（既存セオリー）。
//   ストレート: ストレート側ライン担当（同サイドのライン際寄り）。
export function backDevX(side) {
  const dev = updateDevelopment(side);
  if (dev === "straight") {
    const ownBackSign = ownBackPlayer(side).x >= 0 ? 1 : -1;
    return ownBackSign * TUNING.pos.straightBackX;
  }
  return backCrossX(side);
}

// 前衛の定位置（確定セオリー）:
//   「相手後衛の打点 ─ 自コートのセンターマーク」を結んだ線上、ただし
//   気持ち一歩“外側”（利き腕の肩がその線に乗る程度）に立つ。
//   side が守るコートのセンターマークは ±COURT.halfL。
//   frontY はその前衛のネット前定位置y。
export function frontTheoryX(side, frontY) {
  const op = opponentHitterPos(side);
  const cy = side === "cpu" ? -COURT.halfL : COURT.halfL; // 自コートのセンターマーク
  let lineX = 0;
  if (Math.abs(cy - op.y) >= 0.5) {
    // t>1 は op.y が cy を超えた位置（ベースライン外など）なのでクランプして破綻防止
    const t = Math.max(0, Math.min(1, (frontY - op.y) / (cy - op.y)));
    lineX = op.x * (1 - t);
  }
  // 線上から「気持ち一歩外側」へ。外側＝センターラインから離れる向き
  // （線が左側(x<0)なら更に左へ、右側なら更に右へ）。
  const outSign = lineX >= 0 ? 1 : -1;
  // コート外への逸脱を防ぐ（シングルスコート幅でクランプ）
  return Math.max(-COURT.singlesHalfW, Math.min(COURT.singlesHalfW,
    lineX + outSign * TUNING.pos.frontOutsideStep));
}

// 後衛の定位置（確定セオリー）:
//   前提＝前衛がストレート側を守る。後衛はそのストレートレーンを捨て、
//   残ったクロス側範囲の“真ん中”（コート中央ではなくクロス側寄り）に立つ。
//   ストレート＝相手後衛の打点と同じ側、クロス＝その反対側。
//   side="cpu" なら自コートは y<0、相手＝プレイヤー。
export function backCrossX(side) {
  const op = opponentHitterPos(side);
  // 相手から見たストレートは相手打点と同じ符号側。クロスはその反対。
  // こちら（守る側）の自陣では、相手打点 op.x の符号と反対側がクロス。
  const straightSign = op.x >= 0 ? 1 : -1;
  // 残ったクロス側範囲（センター0〜サイドライン）の真ん中あたりへ寄る
  return -straightSign * TUNING.pos.backCrossBias;
}

// 互換: 旧名（CPU前衛のセオリーX）
export function cpuFrontTheoryX() {
  return frontTheoryX("cpu", cpuFront.homeY);
}

// 前衛が相手後衛の前後の動きへ「鏡のように」対応した定位置y（歩幅の約半分追従）。
//   side="cpu": 自陣はy<0、相手後衛はy>0側。相手が前に詰める(yが小さく)ほど前衛も前へ。
//   homeY からの追従量は frontMirror で制御。
export function frontMirrorY(side, homeY) {
  const op = opponentHitterPos(side);
  const baseDepth = COURT.halfL; // 相手後衛の標準の深さ（ベースライン）
  const opDepth = Math.abs(op.y); // 相手後衛のネットからの距離
  // 相手が前に出る(opDepthが小さい)と front も前(ネット寄り=|y|小)へ、下がると後ろへ。
  const follow = (opDepth - baseDepth) * TUNING.pos.frontMirror;
  const sign = side === "cpu" ? -1 : 1; // 自陣の向き
  // homeY は既に符号付き。|homeY| + follow を符号付きへ戻す。
  const newAbs = Math.max(1.6, Math.min(4.2, Math.abs(homeY) + follow));
  return sign * newAbs;
}

export function updateCpuFront(dt) {
  moveAutoAI(cpuFront, "cpu", dt);
}


// AI打球の共通ロジック（playerチーム・cpuチーム共通）。
// side: "player"(自陣y+側) または "cpu"(自陣y-側)
// 両チームで同一ロジック・同一パラメータ。対称性から自動的に互角になる。
export function tryReturnAI(side) {
  const opponentSide = side === "player" ? "cpu" : "player";
  if (ball.lastHitter !== opponentSide || state !== "rally") return;

  const ai = TUNING.ai;
  const sm = TUNING.smash;
  const myFront  = side === "player" ? front    : cpuFront;
  const myBack   = side === "player" ? back     : cpuBack;
  const oppBack  = side === "player" ? cpuBack  : back;
  // 自陣のy符号: player=+（y>0）、cpu=-（y<0）
  const homeSign = side === "player" ? 1 : -1;
  // 前衛ボレー判定用フラグ
  const frontChecked = side === "player" ? "frontChecked" : "cpuFrontChecked";

  // ---- サーブの返球: レシーブ担当（前衛/後衛どちらでも）がワンバウンドで返す ----
  // 返球者を担当レシーバーに固定し、非担当（特に後衛）が横取りしないようにする。
  // ball.serving はバウンド前に解除されるため、レシーブ未完了フラグ !receiveDone で判定する。
  if (!receiveDone && ball.bounces === 1 && ball.z < 2.3) {
    const receiver = receiverPlayerFor(side);
    if (distToBall(receiver) <= ai.backReach * receiver.stats.reach) {
      // セオリー: 基本はクロスのコーナー（相手後衛側＝アレー寄り）へ返す
      let course;
      if (Math.random() < 0.65) course = (oppBack.x >= 0 ? 1 : -1) * (0.78 + Math.random() * 0.32);
      else course = (Math.random() - 0.5) * 1.9;
      const r = Math.random();
      const shot = r < 0.55 ? "drive" : (r < 0.8 ? "flat" : "slice");
      hitBall({ hitter: receiver, side: side, shot: shot, course: course, contactZ: ball.z });
    }
    return;
  }

  // ---- 前衛のスマッシュ（浅いロブを叩き込む） ----
  // 自陣側（homeSign方向）のネット前〜に浮いた球を、バウンド前に叩く。
  if (!ball[frontChecked] && ball.bounces === 0 &&
      ball.y * homeSign > 0.4 && ball.y * homeSign < sm.netDist &&
      ball.z >= sm.minZ && ball.z < 2.3) {
    const landing = predictLanding();
    const shallowLob = landing && landing.y * homeSign > 0 &&
      Math.abs(landing.y) <= sm.aiLobShallowY;
    const reach = ai.poachReach * myFront.stats.reach;
    if (shallowLob && Math.hypot(ball.x - myFront.x, ball.y - myFront.y) <= reach) {
      ball[frontChecked] = true;
      if (Math.random() < 0.98 * myFront.stats.volley) {
        hitBall({
          hitter: myFront,
          side: side,
          shot: "flat",
          course: (oppBack.x > 0 ? -1 : 1) * (0.4 + Math.random() * 0.6),
          contactZ: ball.z,
        });
        const label = side === "player" ? "相方のスマッシュ！" : "相手前衛のスマッシュ！";
        showMessage(label);
        setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
        return;
      }
    }
  }

  // ---- 前衛のボレー/ポーチ ----
  // 自陣側（homeSign方向）のネット際に来た、まだバウンドしていない球だけを迎える。
  // 深く速いラリー球（ネットを高く越えて後衛へ抜ける球）は拾わず後衛に任せる。
  if (!ball[frontChecked] && ball.bounces === 0 &&
      ball.y * homeSign > 0.4 && ball.y * homeSign < 3.2 && ball.z < 1.6) {
    const poaching = ((side === "cpu") ? cpuFrontPlan : playerFrontPlan) === "poach";
    {
      // 前衛は届くならボレーする（ポーチ指示の有無に関わらず）。
      const reach = (poaching ? ai.poachReach : ai.frontVolleyReach) * myFront.stats.reach;
      if (Math.hypot(ball.x - myFront.x, ball.y - myFront.y) <= reach) {
        ball[frontChecked] = true;
        const chance = (poaching ? 0.9 : 0.82) * myFront.stats.volley;
        if (Math.random() < chance) {
          hitBall({
            hitter: myFront,
            side: side,
            shot: "flat",
            course: (oppBack.x > 0 ? -1 : 1) * (0.4 + Math.random() * 0.6),
            contactZ: ball.z,
          });
          let label;
          if (side === "player") {
            label = "相方のボレー！";
          } else {
            label = poaching ? "相手前衛のポーチ！" : "相手前衛のカット！";
          }
          showMessage(label);
          setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
          return;
        }
      }
    }
  }

  // ---- cpu前衛のポーチ（作戦による定位置移動ロジックは moveAutoAI で対応。
  //      ここではボレー判定後の「ポーチに出た位置でのボレー」のみ ----

  // ---- 後衛のワンバウンド返球 ----
  // バウンド直後の地面スレスレ（急上昇中）を叩かず、バウンドの頂点付近
  // （vz が十分下がってから＝ライジングしすぎない打点）で打つ。
  // ただし落ちて二度目のバウンド直前になったら最後のチャンスで打つ。
  if (ball.bounces === 1 && ball.z < 2.3 &&
      (ball.vz <= 0.8 || (ball.vz < 0 && ball.z < 0.4))) {
    const reach = ai.backReach * myBack.stats.reach;
    if (distToBall(myBack) <= reach) {
      // セオリー: 基本はクロスのコーナー（相手後衛側＝アレー寄り）へ深く返す。
      // 相手後衛のいる側へ外めに振り、アレー方向の球を増やす。残りは散らす。
      let course;
      if (Math.random() < 0.65) {
        const crossSign = oppBack.x >= 0 ? 1 : -1;
        course = crossSign * (0.78 + Math.random() * 0.32);
      } else {
        course = (Math.random() - 0.5) * 1.9;
      }
      const r = Math.random();
      const shot = r < 0.55 ? "drive" : (r < 0.75 ? "flat" : (r < 0.9 ? "lob" : "slice"));
      hitBall({
        hitter: myBack, side: side, shot: shot,
        course: course,
        contactZ: ball.z,
      });
    }
  }
}

// 後方互換ラッパー（メインループから呼ばれる）
export function cpuTryReturn() { tryReturnAI("cpu"); }
export function partnerTryReturn() {
  if (!spectatorMode) {
    // 人間モード: 操作キャラが届かないときだけパートナーが返す
    const partner = (rallyControlled === back) ? front : back;
    const isPartnerFront = partner === front; // プレイヤーが後衛→相方は前衛
    if (ball.lastHitter !== "cpu" || state !== "rally") return;
    const ai = TUNING.ai;
    const sm = TUNING.smash;
    // 攻守スライダー値（観戦時は中庸0.5固定）
    const aggr = spectatorMode ? 0.5 : partnerAggressiveness;

    // ---- 相方前衛のスマッシュ ----
    if (isPartnerFront &&
        !ball.frontChecked && ball.bounces === 0 &&
        partner.y < sm.netDist && partner.y > 0.4 &&
        ball.y > 0.6 && ball.y < sm.netDist && ball.z >= sm.minZ && ball.z < 2.3 &&
        Math.hypot(ball.x - partner.x, ball.y - partner.y) <= ai.poachReach * partner.stats.reach) {
      ball.frontChecked = true;
      if (Math.random() < 0.8 * partner.stats.volley) {
        hitBall({
          hitter: partner, side: "player", shot: "flat",
          course: (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6),
          contactZ: ball.z,
        });
        showMessage("相方のスマッシュ！");
        setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
        return;
      }
    }

    // ---- 相方前衛のポーチ（攻守スライダーで制御: プレイヤー=後衛のとき） ----
    // ポーチ確率: 守り(0)=0.15, 中(0.5)=0.45, 攻め(1)=0.75
    // 動き出し範囲: 攻めるほど ball.y が手前（大きい値）でも踏み込む (3.6〜5.2m)
    if (isPartnerFront &&
        !ball.frontChecked && ball.bounces === 0 &&
        ball.y > 0.6 && ball.y < (3.6 + aggr * 1.6) && ball.z < 2.0) {
      // 攻め度に応じたポーチリーチ（標準+最大0.6m拡大）
      const poachReach = (ai.frontVolleyReach + aggr * 0.6) * partner.stats.reach;
      if (Math.hypot(ball.x - partner.x, ball.y - partner.y) <= poachReach) {
        ball.frontChecked = true;
        const poachChance = (0.15 + aggr * 0.6) * partner.stats.volley;
        if (Math.random() < poachChance) {
          // 相手後衛のいない側を突く（CPUポーチと対称ロジック）
          const targetCourse = (cpuBack.x > 0 ? -1 : 1) * (0.4 + Math.random() * 0.6);
          hitBall({
            hitter: partner, side: "player", shot: "flat",
            course: targetCourse,
            contactZ: ball.z,
          });
          const label = aggr >= 0.5 ? "相方のポーチ！" : "相方のボレー！";
          showMessage(label);
          setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
          return;
        }
      }
    }

    // ---- 相方前衛の通常ボレー ----
    if (isPartnerFront &&
        !ball.frontChecked && ball.bounces === 0 &&
        partner.y < 5.2 &&
        ball.y > 0.6 && ball.y < 4.8 && ball.z < 1.9 &&
        Math.hypot(ball.x - partner.x, ball.y - partner.y) <= VOLLEY_REACH) {
      ball.frontChecked = true;
      if (Math.random() < 0.5 * partner.stats.volley) {
        hitBall({
          hitter: partner, side: "player", shot: "flat",
          course: (Math.random() - 0.5) * 1.4,
          contactZ: ball.z,
        });
        showMessage("相方のボレー！");
        setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
        return;
      }
    }

    // ---- 相方後衛のストローク（操作キャラが届かないボールをカバー） ----
    // プレイヤー=前衛のとき（partner=back）: 攻守スライダーでコース選択を制御
    if (ball.bounces === 1 && ball.z < 2.3 &&
        !canPlayerHit(rallyControlled) &&
        distToBall(partner) <= CPU_REACH * partner.stats.reach &&
        distToBall(partner) < distToBall(rallyControlled)) {
      const shot = Math.random() < 0.8 ? "drive" : "lob";
      let course;
      if (!isPartnerFront) {
        // 相方=後衛（プレイヤー=前衛のケース）: 攻守でコース選択を変化
        // 守り寄り=クロス（相手前衛のいない側）重視, 攻め寄り=ストレート/前衛方向重視
        const straightChance = 0.15 + aggr * 0.65; // 守り=0.15, 中=0.475, 攻め=0.80
        if (Math.random() < straightChance) {
          // ストレート: 相手前衛(cpuFront)がいる側へ抜きにいく
          course = (cpuFront.x >= 0 ? 1 : -1) * (0.5 + Math.random() * 0.5);
        } else {
          // クロス: 相手前衛のいない側を安全に返す
          course = (cpuFront.x >= 0 ? -1 : 1) * (0.4 + Math.random() * 0.5);
        }
      } else {
        course = (Math.random() - 0.5) * 1.6;
      }
      hitBall({
        hitter: partner, side: "player", shot: shot,
        course: course,
        contactZ: ball.z,
      });
    }
    return;
  }
  // 観戦モード: 統一AIで返球
  tryReturnAI("player");
}

/* ===========================================================
 * メインループ
 * =========================================================== */

// 現在の移動入力を得る。確定操作: 移動=WASD（左手）専用。
// 狙い（着地カーソル/サーブ狙い）はマウスが担当し、移動とは独立。
// スマホはスティックで移動（ため中/トス中はスティックが狙いへ切り替わる）。
export function inputVector() {
  const aiming = (charge.active && state === "rally") || state === "serve-toss";
  let dx = 0, dy = 0;
  if (keysWasd.left) dx -= 1;
  if (keysWasd.right) dx += 1;
  if (keysWasd.up) dy -= 1;   // 上/Wはネット方向（yが減る）
  if (keysWasd.down) dy += 1; // 下/Sは自陣ベースライン方向（yが増える）
  if (!aiming && stick.active) {
    dx += stick.dx;
    dy += stick.dy; // スティック下方向 = 自陣ベースライン方向
  }
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  return { dx: dx, dy: dy };
}

// サーブ前、サーバー以外の3人（両前衛・レシーバー）が所定位置へ到達したか。
// 各自の目標は AI 移動と同じ定位置。サーバーは既にサーブ位置にいる前提。
export function nonServerPlayersInPosition() {
  const server = currentServer();
  const tol = 0.6; // 到達とみなす許容距離(m)
  // 人が操作するキャラ（rallyControlled）は自由移動なので位置判定の対象外。
  //   サーバー本人も既にサーブ位置にいるので対象外。
  // 残りの AI が自動で定位置へ到達したかだけを見る。
  const targets = [];
  const sideSign = serveFromRight() ? 1 : -1;
  const fx = TUNING.pos.frontSideX;
  const skip = function (p) { return p === server || p === rallyControlled; };
  // レシーブ側のレシーバー（割り当てられた1人）は受け持ち側のレシーブ位置で待つ。
  const recvTeam = serverTeamNow() === "player" ? "cpu" : "player";
  const receiver = receiverPlayerFor(recvTeam);
  const rp = receivePosition(recvTeam);
  if (!skip(receiver)) targets.push({ p: receiver, x: rp.x, y: rp.y });
  // 前衛（レシーバーでなければ）逆サイド寄りの定位置
  if (front !== receiver && !skip(front))       targets.push({ p: front,    x: -fx * sideSign, y: front.homeY });
  if (cpuFront !== receiver && !skip(cpuFront))  targets.push({ p: cpuFront, x: fx * sideSign,  y: cpuFront.homeY });
  return targets.every(function (t) {
    return Math.hypot(t.p.x - t.x, t.p.y - t.y) <= tol;
  });
}

/* ---- サーブ前の全員準備管理（確定セオリー） ----
 * 味方・相手を含む全員（4人）が定位置の準備を整えるまでサーブを始めない。
 *   サーバーは既にサーブ位置。残り3人（両前衛・レシーバー）の到達と、
 *   レシーブ側の静止/猶予を満たして初めて serveReady.ready=true。
 * CPUサーブ: プレイヤー（レシーブ側）が静止し全員整列するまで打たない。
 * 相方サーブ / プレイヤーサーブ: AIの準備時間（aiReady）＋全員整列を待つ。 */
export function updateServeReady(dt) {
  const cfg = TUNING.serveReady;
  serveReady.timer += dt;
  if (serveReady.ready) return;
  const team = serverTeamNow();
  const allInPosition = nonServerPlayersInPosition();
  // maxWait を超えたら整列が崩れていても進める（ハマり防止）
  const timedOut = serveReady.timer >= cfg.maxWait;
  if (team === "cpu") {
    const v = inputVector();
    const moving = v.dx !== 0 || v.dy !== 0 || stick.active;
    serveReady.still = moving ? 0 : serveReady.still + dt;
    const receiverReady = serveReady.still >= cfg.stillTime;
    if (serveReady.timer >= cfg.minShow &&
        ((receiverReady && allInPosition) || timedOut)) {
      serveReady.ready = true;
      hintText.textContent = "全員準備OK！相手がサーブを打つ";
      aiStartToss("cpu");
    }
  } else if (!playerIsServer() || spectatorMode) {
    if ((serveReady.timer >= cfg.aiReady && allInPosition) || timedOut) {
      serveReady.ready = true;
      aiStartToss("player");
    }
  } else {
    if ((serveReady.timer >= cfg.aiReady && allInPosition) || timedOut) {
      serveReady.ready = true;
      hintText.textContent = "全員準備OK。クリックでトス。マウスで狙う場所を指す";
    }
  }
}

export function update(dt) {
  addMatchTime(dt);

  // サーブの構え中: レシーバーの準備が整ってからサーブが始まる
  if (state === "serve-stance") {
    updateServeReady(dt);
  }

  // 移動操作: サーブの構え/トス中は自分がサーバーのときのみ、ラリー中は rallyControlled
  // 観戦モードでは rallyControlled も AI が動かすため人間操作の mover は立てない
  let mover = null;
  if (!spectatorMode) {
    if (state === "serve-stance" || state === "serve-toss") {
      if (playerIsServer()) mover = currentServer();
    } else if (state === "rally") {
      mover = rallyControlled;
    }
  }

  // ため中のマウス/スティック（着地点カーソル）とトス中のマウス（狙い）を反映
  updateAimInputs(dt);

  if (mover) {
    const v = inputVector();
    if (v.dx !== 0 || v.dy !== 0) {
      const charging = charge.active && state === "rally";
      const slow = charging ? TUNING.charge.moveSlow : 1;
      const speed = TUNING.move.playerSpeed * mover.stats.speed * slow;
      setControlledX(mover, mover.x + v.dx * speed * dt);
      // サーブの構え・トス中は左右だけ動ける（打点の左右調整）
      if (state !== "serve-toss" && state !== "serve-stance") {
        setControlledY(mover, mover.y + v.dy * speed * dt);
      }
    }
    // サーブの構え中はボールがサーバーに追従する（置き去り防止）
    if (state === "serve-stance") {
      ball.x = mover.x;
      ball.y = mover.y;
    }
  }

  [back, front, cpuBack, cpuFront].forEach(function (p) {
    if (p.swingT > 0) {
      p.swingT -= dt;
      if (p.swingT <= 0) { p.swingT = 0; p.pose = "idle"; }
    }
  });

  setEffects(effects.filter(function (ef) {
    ef.t += dt;
    return ef.t < ef.ttl;
  }));
  if (ball.flashT > 0) ball.flashT -= dt;

  // トスの更新（プレイヤー・CPU共通）
  if (state === "serve-toss") {
    updateToss(dt);
  }

  if (state !== "rally") {
    updatePartner(dt);
    updateRallyControlledAI(dt);
    updateCpuBack(dt);
    updateCpuFront(dt);
    return;
  }

  // ボール物理（メートル・秒）
  const prevY = ball.y;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;
  ball.vz -= G * dt;

  ball.trail.push({ x: ball.x, y: ball.y, z: ball.z });
  if (ball.trail.length > 7) ball.trail.shift();

  if (checkNet(prevY)) return;

  if (ball.z <= 0 && ball.vz < 0) {
    handleBounce();
    if (state !== "rally") return;
  }

  updatePartner(dt);
  updateRallyControlledAI(dt);
  updateCpuBack(dt);
  updateCpuFront(dt);

  // 予約スイング（アシスト）: 早めに離した直後の猶予内にゾーンへ入れば打つ
  if (pendingSwing > 0) {
    setPendingSwing(pendingSwing - dt);
    if (canPlayerHit(rallyControlled)) playerHitBall(pendingShot, pendingPower, pendingAimX, pendingAimY);
  }

  // 構え・打点タイミングの管理。打点ゾーンに入ったら自動でため開始
  // （離して打つ操作は廃止。WASD移動はため中も常に有効）
  const cp = rallyControlled;
  const hittable = canPlayerHit(cp);
  if (hittable) {
    if (ballHittableSince < 0) setBallHittableSince(matchTime);
    if (cp.pose !== "swing") {
      cp.pose = "ready";
      cp.swingSide = isBackhandFor("player", cp.x, ball.x) ? "back" : "fore";
    }
    if (!charge.active) startCharge("auto");
  } else {
    setBallHittableSince(-1);
    if (cp.pose === "ready") cp.pose = "idle";
    if (charge.active && charge.source === "auto") {
      charge.active = false;
      charge.source = null;
    }
  }

  // ため中にクリックせずゾーンを通り過ぎた場合の保険スイング。
  // デフォルト球種（selectedShot。PCは未操作なら"shoot"）・デフォルト狙いで打つ。
  // 観戦モードはAIがコース・球種を選んで同じ経路（playerHitBall）でスイングする。
  if (charge.active && hittable && ballHittableSince >= 0 &&
      matchTime - ballHittableSince >= IDEAL_HIT_DELAY) {
    const power = chargeAmount();
    charge.active = false;
    charge.source = null;
    if (spectatorMode) {
      // 観戦モード: 打球は tryReturnAI("player") に委譲（partnerTryReturn経由）
      // ここでは charge のみリセットして二重打球を防ぐ
      setBallHittableSince(-1);
    } else {
      playerHitBall(selectedShot, power, aim.x, aim.y);
    }
  }

  partnerTryReturn();
  if (state !== "rally") return;
  cpuTryReturn();
  if (state !== "rally") return;

  // 安全網: 大きく場外に出たボール
  if (Math.abs(ball.x) > 9 || ball.y > 16 || ball.y < -16) {
    const hitterIsPlayer = ball.lastHitter === "player";
    if (ball.bounces >= 1) awardPoint(ball.y < 0, "ツーバウンド");
    else awardPoint(!hitterIsPlayer, hitterIsPlayer ? "アウト" : "相手のアウト");
  }
}

/* ===========================================================
 * 描画
 * =========================================================== */

export function draw() {
  ctx.clearRect(0, 0, W, H);
  drawBackground();
  drawCourt();
  drawLandingMarker();
  drawAimCursor();
  drawGroundEffects();
  drawBallShadow();

  const items = [
    { y: cpuBack.y, fn: function () { drawHumanoid(cpuBack); } },
    { y: cpuFront.y, fn: function () { drawHumanoid(cpuFront); } },
    { y: 0, fn: drawNet },
    { y: front.y, fn: function () { drawHumanoid(front); } },
    { y: back.y, fn: function () { drawHumanoid(back); } },
    { y: ball.y, fn: drawBall },
  ];
  items.sort(function (a, b) { return a.y - b.y; });
  items.forEach(function (it) { it.fn(); });

  drawTextEffects();
  drawServeTypeBadge();
  drawTimingGauge();
  drawHud();
  drawControlLegend();
}

/* ---- 操作レジェンド: 左クリック/右クリック/Space+クリックの球種割当を常時表示 ---- */
export function drawControlLegend() {
  if (state === "ready" || spectatorMode) return;
  const isServer = (state === "serve-stance" || state === "serve-toss") && playerIsServer();

  const st = TUNING.serve.types;
  const lines = isServer
    ? [
        { color: st.flat.color,      text: "左クリック: " + st.flat.label },
        { color: st.slice.color,     text: "右クリック: " + st.slice.label },
        { color: st.underCut.color,  text: "Space+左: " + st.underCut.label },
        { color: st.attackCut.color, text: "Space+右: " + st.attackCut.label },
      ]
    : [
        { color: SHOT_FAMILY_META.shoot.color, text: "左クリック: シュート" },
        { color: SHOT_FAMILY_META.cut.color,   text: "右クリック: カット" },
        { color: SHOT_FAMILY_META.lob.color,   text: "Space+クリック: ロブ" },
      ];

  ctx.font = "700 10px sans-serif";
  let maxW = 0;
  lines.forEach(function (l) {
    const tw = ctx.measureText(l.text).width;
    if (tw > maxW) maxW = tw;
  });
  const boxW = maxW + 30;
  const lineH = 16;
  const boxH = lines.length * lineH + 6;
  const bx = W - boxW - 6, by = 6;

  ctx.fillStyle = "rgba(30,27,75,0.55)";
  roundRect(ctx, bx, by, boxW, boxH, 6);
  ctx.fill();

  lines.forEach(function (l, i) {
    const ly = by + 6 + i * lineH;
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.arc(bx + 12, ly + 5, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "700 10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(l.text, bx + 22, ly + 9);
  });
}

/* ---- 相手サーブの種類を打つ前に表示（サーバー頭上のバッジ） ---- */
export function drawServeTypeBadge() {
  if (state !== "serve-stance" && state !== "serve-toss") return;
  if (serverTeamNow() !== "cpu" || !cpuServePlan) return;
  const server = currentServer();
  const tcfg = TUNING.serve.types[cpuServePlan.type];
  const text = tcfg.label;
  const color = tcfg.color;
  const p = project(server.x, server.y, 2.3);
  ctx.font = "700 11px sans-serif";
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(30,27,75,0.78)";
  roundRect(ctx, p.x - tw / 2 - 7, p.y - 12, tw + 14, 18, 6);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(text, p.x, p.y + 1);
}

/* ---- HUD: サーブ設定 / レシーバー準備状態を常時表示 ---- */
export function drawHud() {
  if (state === "ready") return;

  if ((state === "serve-stance" || state === "serve-toss") && playerIsServer() && !spectatorMode) {
    const lv = { weak: "弱", mid: "中", strong: "強" };
    const text = "パワー" + (lv[servePower] || "中") + "  回転" + (lv[serveSpin] || "中");
    ctx.fillStyle = "rgba(30,27,75,0.55)";
    roundRect(ctx, 6, 6, 140, 22, 6);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(text, 14, 21);
    // レシーバーの準備状態（準備が整うまでトス不可）
    ctx.fillStyle = serveReady.ready ? "rgba(16,185,129,0.9)" : "rgba(255,255,255,0.7)";
    ctx.font = "600 9px sans-serif";
    ctx.fillText(serveReady.ready ? "レシーバー準備OK" : "レシーバー準備中…", 14, 40);
    return;
  }

  // 相手サーブ: 種類を打つ前に表示（前へ詰める判断の時間を確保する）
  if ((state === "serve-stance" || state === "serve-toss") &&
      serverTeamNow() === "cpu" && cpuServePlan) {
    const tcfg = TUNING.serve.types[cpuServePlan.type];
    const text = "相手サーブ: " + tcfg.label;
    ctx.fillStyle = "rgba(30,27,75,0.55)";
    roundRect(ctx, 6, 6, 158, 22, 6);
    ctx.fill();
    ctx.fillStyle = tcfg.color;
    ctx.font = "700 11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(text, 14, 21);
    if (state === "serve-stance" && !serveReady.ready) {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "600 9px sans-serif";
      ctx.fillText("静止するとサーブが来る", 14, 40);
    }
    return;
  }
}

export function drawBackground() {
  // 中継映像風の背景: 相手ベースラインの上端あたり（画面上から約18%）を地平線として
  // 上に空＋スタンドの帯、下にコート周りの芝を敷く。
  const horizon = project(0, -COURT.halfL, 0).y; // 奥ベースラインの画面Y（≈99）

  // 空グラデーション（上部）
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#BFD9F2");
  sky.addColorStop(1, "#E8F1FA");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon);

  // スタンドを示す濃緑の帯＋等間隔の縦リブ（観客席の質感）
  const standH = 30;
  ctx.fillStyle = "#14532D";
  ctx.fillRect(0, horizon - standH, W, standH);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (let i = 0; i < 30; i++) {
    ctx.fillRect(i * (W / 30), horizon - standH, 1.5, standH);
  }

  // コート外周（芝/サーフェスの地色）
  ctx.fillStyle = "#1f7a3f";
  ctx.fillRect(0, horizon, W, H - horizon);
}

export function courtLine(x1, y1, x2, y2) {
  const a = project(x1, y1, 0);
  const b = project(x2, y2, 0);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export function drawCourt() {
  const c = COURT;

  const p1 = project(-c.halfW, -c.halfL, 0);
  const p2 = project(c.halfW, -c.halfL, 0);
  const p3 = project(c.halfW, c.halfL, 0);
  const p4 = project(-c.halfW, c.halfL, 0);
  ctx.fillStyle = "#34A853";
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.lineTo(p4.x, p4.y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineCap = "round";

  ctx.lineWidth = 2;
  courtLine(-c.halfW, -c.halfL, c.halfW, -c.halfL);
  courtLine(-c.halfW, c.halfL, c.halfW, c.halfL);
  courtLine(-c.halfW, -c.halfL, -c.halfW, c.halfL);
  courtLine(c.halfW, -c.halfL, c.halfW, c.halfL);

  ctx.lineWidth = 1.6;
  courtLine(-c.singlesHalfW, -c.halfL, -c.singlesHalfW, c.halfL);
  courtLine(c.singlesHalfW, -c.halfL, c.singlesHalfW, c.halfL);

  courtLine(-c.singlesHalfW, -c.serviceY, c.singlesHalfW, -c.serviceY);
  courtLine(-c.singlesHalfW, c.serviceY, c.singlesHalfW, c.serviceY);

  courtLine(0, -c.serviceY, 0, 0);
  courtLine(0, 0, 0, c.serviceY);

  courtLine(0, c.halfL - 0.18, 0, c.halfL);
  courtLine(0, -c.halfL, 0, -c.halfL + 0.18);

  const serving = state === "serve-stance" || state === "serve-toss" ||
    (state === "rally" && ball.serving);
  if (serving && serverTeamNow()) {
    const box = serviceBox(serverTeamNow());
    const b1 = project(box.x1, box.y1, 0);
    const b2 = project(box.x2, box.y1, 0);
    const b3 = project(box.x2, box.y2, 0);
    const b4 = project(box.x1, box.y2, 0);
    ctx.fillStyle = serverTeamNow() === "player" ? "rgba(99,102,241,0.18)" : "rgba(220,80,80,0.14)";
    ctx.beginPath();
    ctx.moveTo(b1.x, b1.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.lineTo(b3.x, b3.y);
    ctx.lineTo(b4.x, b4.y);
    ctx.closePath();
    ctx.fill();
  }
}

export function drawNet() {
  const c = COURT;
  const postL0 = project(-c.halfW - 0.3, 0, 0);
  const postL1 = project(-c.halfW - 0.3, 0, c.netH);
  const postR0 = project(c.halfW + 0.3, 0, 0);
  const postR1 = project(c.halfW + 0.3, 0, c.netH);

  ctx.fillStyle = "rgba(20,30,40,0.42)";
  ctx.beginPath();
  ctx.moveTo(postL0.x, postL0.y);
  ctx.lineTo(postR0.x, postR0.y);
  ctx.lineTo(postR1.x, postR1.y);
  ctx.lineTo(postL1.x, postL1.y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 0.6;
  for (let i = 1; i < 14; i++) {
    const x = -c.halfW - 0.3 + (i / 14) * (c.halfW * 2 + 0.6);
    const a = project(x, 0, 0);
    const b = project(x, 0, c.netH);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(postL1.x, postL1.y);
  ctx.lineTo(postR1.x, postR1.y);
  ctx.stroke();

  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(postL0.x, postL0.y); ctx.lineTo(postL1.x, postL1.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(postR0.x, postR0.y); ctx.lineTo(postR1.x, postR1.y); ctx.stroke();
}

export function drawLandingMarker() {
  if (state !== "rally") return;
  if (ball.bounces >= 2) return;
  const landing = predictLanding();
  if (!landing || landing.t < 0.06) return;

  const p = project(landing.x, landing.y, 0);
  const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 90);
  const baseR = Math.max(4, 0.42 * p.s) * pulse;

  const incoming = ball.lastHitter === "cpu" && landing.y > 0;
  const inCourt = ball.serving
    ? insideBox(landing.x, landing.y, serviceBox(ball.lastHitter))
    : insideCourt(landing.x, landing.y);

  let color;
  if (!inCourt) color = "rgba(120,120,120,0.65)";
  else if (incoming) color = "rgba(255,196,0,0.9)";
  else color = "rgba(255,255,255,0.75)";

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, baseR, baseR * 0.45, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, baseR * 0.45, baseR * 0.2, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/* ---- 着地点カーソル（ため中の狙い・ゴーストリング） ---- */
export function drawAimCursor() {
  if (spectatorMode) return; // 観戦モードはマウス操作の狙いカーソルを表示しない
  // サーブの構え/トス中（自分がサーバー）は、対角サービスコート上に狙いカーソルを表示
  if ((state === "serve-stance" || state === "serve-toss") && playerIsServer() && serveAimCursor.set) {
    drawServeAimCursor();
    return;
  }
  if (state !== "rally" || !charge.active) return;
  // 球種はクリックで決まるため、カーソルは中立色で表示
  const p = project(aim.x, aim.y, 0);
  const pulse = 0.9 + 0.1 * Math.sin(performance.now() / 110);
  const r = Math.max(6, 0.6 * p.s) * pulse;
  const color = "#FFFFFF";

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r, r * 0.45, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * 0.5, r * 0.22, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // 中心の十字（位置が分かりやすいように）
  ctx.beginPath();
  ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x + 4, p.y);
  ctx.moveTo(p.x, p.y - 3); ctx.lineTo(p.x, p.y + 3);
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

/* ---- サーブの狙いカーソル（対角サービスコート上） ---- */
export function drawServeAimCursor() {
  const box = serviceBox("player");
  const inBox = serveAimCursor.x >= box.x1 && serveAimCursor.x <= box.x2 &&
    serveAimCursor.y >= box.y1 && serveAimCursor.y <= box.y2;
  const color = inBox ? "#10B981" : "rgba(220,80,80,0.95)"; // 外ならフォルト色
  const p = project(serveAimCursor.x, serveAimCursor.y, 0);
  const pulse = 0.9 + 0.1 * Math.sin(performance.now() / 110);
  const r = Math.max(6, 0.55 * p.s) * pulse;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r, r * 0.45, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x + 4, p.y);
  ctx.moveTo(p.x, p.y - 3); ctx.lineTo(p.x, p.y + 3);
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

export function drawGroundEffects() {
  effects.forEach(function (ef) {
    if (ef.type !== "ripple") return;
    const p = project(ef.x, ef.y, 0);
    const k = ef.t / ef.ttl;
    const r = (0.25 + k * 0.9) * p.s;
    ctx.strokeStyle = "rgba(255,255,255," + (0.8 * (1 - k)) + ")";
    ctx.lineWidth = 2.2 * (1 - k) + 0.6;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
  });
}

export function drawTextEffects() {
  effects.forEach(function (ef) {
    if (ef.type !== "text") return;
    const k = ef.t / ef.ttl;
    const p = project(ef.x, ef.y, 1.9 + k * 0.9);
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = ef.color;
    ctx.font = "700 15px sans-serif";
    ctx.textAlign = "center";
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    ctx.strokeText(ef.text, p.x, p.y);
    ctx.fillText(ef.text, p.x, p.y);
    ctx.globalAlpha = 1;
  });
}

export function drawTimingGauge() {
  if (state === "serve-toss" && toss.active && playerIsServer() && !spectatorMode) {
    // サーブの打点ゲージ（縦）: トスは統一トスのため、4種すべての
    // 適正打点を表示する。左=フラット/右=スライス/Space+左=アンダーカット/Space+右=攻撃カット
    const st = TUNING.serve.types;
    const zMax = 3.4;
    const gx = W - 24, gTop = 70, gBottom = H - 70, gw = 10;
    const zToY = function (z) { return gBottom - (gBottom - gTop) * Math.min(1, z / zMax); };

    // ゲージの土台（無彩色の細いトラックのみ。色付きゾーンは出さない）
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    roundRect(ctx, gx, gTop, gw, gBottom - gTop, 4);
    ctx.fill();

    // 適正打点マーカー: 4種それぞれの ideal を1本ずつ表示
    const markers = [
      { cfg: st.flat,      label: "左:フラット" },
      { cfg: st.slice,     label: "右:スライス" },
      { cfg: st.attackCut, label: "Sp+右:攻撃カット" },
      { cfg: st.underCut,  label: "Sp+左:アンダーカット" },
    ];
    markers.forEach(function (m) {
      ctx.fillStyle = m.cfg.color;
      ctx.fillRect(gx - 3, zToY(m.cfg.zone.ideal) - 1, gw + 6, 2);
    });

    // 現在のボールの高さ
    ctx.fillStyle = "#FACC15";
    ctx.beginPath();
    ctx.arc(gx + gw / 2, zToY(ball.z), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(30,27,75,0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = "700 9px sans-serif";
    ctx.textAlign = "right";
    markers.forEach(function (m) {
      ctx.fillStyle = m.cfg.color;
      ctx.fillText("適正（" + m.label + "）", gx - 4, zToY(m.cfg.zone.ideal) + 3);
    });

    // 狙い（マウスで指す着地点カーソル）の案内
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "700 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("マウスで狙う場所を指す（コート外はフォルト）", W / 2, H - 10);
    return;
  }

  if (state === "rally" && charge.active) {
    // ためゲージ: たまるほど鋭い角度。コースとクリック案内を表示
    // （球種は左/右クリック・Space+クリックで決まるため、ここでは確定表示しない）
    const k = chargeAmount();
    const gw = Math.min(420, W - 120);
    const gx = (W - gw) / 2, gy = H - 18, gh = 8;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    roundRect(ctx, gx, gy, gw, gh, 4);
    ctx.fill();

    ctx.fillStyle = k >= 1 ? "#F59E0B" : "#6366F1";
    roundRect(ctx, gx, gy, Math.max(6, gw * k), gh, 4);
    ctx.fill();

    ctx.font = "700 11px sans-serif";
    ctx.textAlign = "center";
    const courseName = courseLabelFor(rallyControlled.x, aim.x).replace("！", "");
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText("ため " + courseName + (k >= 1 ? " MAX" : "") + "（クリックで打つ）", gx + gw / 2, gy - 6);
  }
}

/* ---- ボール ---- */
export function drawBallShadow() {
  if (state === "ready") return;
  const p = project(ball.x, ball.y, 0);
  const r = Math.max(2, 0.16 * p.s * (1 + Math.min(ball.z, 4) * 0.12));
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * 1.4, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawBall() {
  // 軌道（トレイル）は球種ごとの色で描く（視認性向上）
  ball.trail.forEach(function (tp, i) {
    const p = project(tp.x, tp.y, tp.z);
    const k = (i + 1) / ball.trail.length;
    ctx.globalAlpha = 0.22 * k;
    ctx.fillStyle = ball.trailColor || "#DFFF4F";
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.5, 0.13 * p.s), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  const p = project(ball.x, ball.y, ball.z);
  const r = Math.max(2.5, 0.16 * p.s);

  if (ball.flashT > 0) {
    ctx.fillStyle = "rgba(255,255,255," + (ball.flashT / 0.22) * 0.8 + ")";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 2.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // 速い球は進行方向に伸びる（球速の演出）
  const spd = Math.hypot(ball.vx, ball.vy, ball.vz);
  const stretch = Math.min(0.45, Math.max(0, (spd - 10) * 0.035));
  let angle = 0;
  if (stretch > 0.01) {
    const p2 = project(ball.x + ball.vx * 0.03, ball.y + ball.vy * 0.03, ball.z + ball.vz * 0.03);
    angle = Math.atan2(p2.y - p.y, p2.x - p.x);
  }

  ctx.fillStyle = "#DFFF4F";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * (1 + stretch), r * (1 - stretch * 0.45), angle, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ball.trailColor && ball.trailColor !== "#DFFF4F"
    ? ball.trailColor
    : "rgba(30,27,75,0.45)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

/* ---- 簡易人型の選手 ---- */
export function drawHumanoid(pl) {
  const g = project(pl.x, pl.y, 0);
  const s = g.s; // px/m

  ctx.save();
  ctx.translate(g.x, g.y);

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.34 * s, 0.13 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  const legH = 0.5 * s;
  const torsoTop = -1.18 * s;
  const torsoBottom = -legH;
  const headR = 0.23 * s;
  const headCy = torsoTop - headR * 0.85;

  const foreDir = pl.facing === -1 ? 1 : -1;
  const sideDir = pl.swingSide === "fore" ? foreDir : -foreDir;

  ctx.strokeStyle = "#1F2937";
  ctx.lineWidth = Math.max(1.5, 0.09 * s);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-0.12 * s, torsoBottom);
  ctx.lineTo(-0.16 * s, 0);
  ctx.moveTo(0.12 * s, torsoBottom);
  ctx.lineTo(0.16 * s, 0);
  ctx.stroke();

  ctx.fillStyle = pl.color;
  const tw = 0.46 * s;
  roundRect(ctx, -tw / 2, torsoTop, tw, torsoBottom - torsoTop, 0.12 * s);
  ctx.fill();

  const shoulderY = torsoTop + 0.12 * s;
  let armAngle;
  let racketLen = 0.62 * s;
  if (pl.pose === "swing" && pl.swingT > 0) {
    const k = 1 - pl.swingT / 0.32;
    armAngle = (-0.9 + k * 1.7);
  } else if (pl.pose === "ready") {
    armAngle = -0.55;
  } else if (pl.pose === "serve" || pl.pose === "toss") {
    armAngle = -1.5;
  } else {
    armAngle = 0.6;
  }

  const armX = sideDir * Math.cos(armAngle);
  const armY = Math.sin(armAngle);
  const handX = sideDir * 0.3 * s * Math.abs(Math.cos(armAngle)) + sideDir * 0.06 * s;
  const handY = shoulderY + 0.3 * s * armY;

  ctx.strokeStyle = pl.skin;
  ctx.lineWidth = Math.max(1.5, 0.08 * s);
  ctx.beginPath();
  ctx.moveTo(-sideDir * tw * 0.4, shoulderY);
  if (pl.pose === "toss") {
    // トス腕（反対側の手）を高く上げる
    ctx.lineTo(-sideDir * 0.16 * s, shoulderY - 0.55 * s);
  } else {
    ctx.lineTo(-sideDir * 0.34 * s, shoulderY + 0.26 * s);
  }
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(sideDir * tw * 0.4, shoulderY);
  ctx.lineTo(handX, handY);
  ctx.stroke();

  const rx = handX + armX * racketLen * 0.55;
  const ry = handY + armY * racketLen * 0.55 - 0.1 * s;
  ctx.strokeStyle = "#7C3AED";
  ctx.lineWidth = Math.max(1.2, 0.05 * s);
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(rx, ry);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.strokeStyle = "#7C3AED";
  ctx.beginPath();
  ctx.ellipse(rx, ry, 0.13 * s, 0.17 * s, Math.atan2(armY, armX), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = pl.skin;
  ctx.beginPath();
  ctx.arc(0, headCy, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3B2A1E";
  if (pl.facing === -1) {
    ctx.beginPath();
    ctx.arc(0, headCy, headR, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, headCy - headR * 0.2, headR * 0.98, headR * 0.78, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(0, headCy - headR * 0.45, headR * 0.95, headR * 0.55, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1F2937";
    ctx.beginPath();
    ctx.arc(-headR * 0.35, headCy + headR * 0.05, Math.max(0.8, headR * 0.13), 0, Math.PI * 2);
    ctx.arc(headR * 0.35, headCy + headR * 0.05, Math.max(0.8, headR * 0.13), 0, Math.PI * 2);
    ctx.fill();
  }

  if (pl.label) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "600 " + Math.max(8, 0.28 * s) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(pl.label, 0, headCy - headR - 0.1 * s);
  }

  if (pl === rallyControlled && pl.pose === "ready") {
    const isBack = pl.swingSide === "back";
    const text = isBack ? "バック" : "フォア";
    const color = isBack ? "#F59E0B" : "#3B82F6";
    const bw = 0.95 * s;
    const by = headCy - headR - 0.62 * s;
    ctx.fillStyle = color;
    roundRect(ctx, -bw / 2, by, bw, 0.36 * s, 0.1 * s);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 " + Math.max(8, 0.24 * s) + "px sans-serif";
    ctx.fillText(text, 0, by + 0.26 * s);
  }

  ctx.restore();

  if (pl === rallyControlled && state === "rally" && canPlayerHit(pl)) {
    const pr = project(pl.x, pl.y, 0);
    const pulse = 1 + 0.08 * Math.sin(performance.now() / 70);
    ctx.strokeStyle = "rgba(99,102,241,0.9)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(pr.x, pr.y, 0.75 * pr.s * pulse, 0.3 * pr.s * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}


/* ===========================================================
 * ループ・画面遷移
 * =========================================================== */

export function loop(now) {
  const dt = Math.min((now - lastTime) / 1000 || 0.016, 0.05);
  setLastTime(now);
  update(dt);
  draw();
  setRafId(requestAnimationFrame(loop));
}

startBtn.addEventListener("click", function () {
  startMatch();
  if (!rafId) {
    setLastTime(performance.now());
    setMatchTime(0);
    setRafId(requestAnimationFrame(loop));
  }
});

retryBtn.addEventListener("click", function () {
  showScreen("ready");
  cancelAnimationFrame(rafId);
  setRafId(null);
  setState("ready");
});

draw();
