import { TUNING } from "./config.js";

/* ---- DOM要素 ---- */
export const screens = {
  ready:  document.getElementById("screen-ready"),
  game:   document.getElementById("screen-game"),
  result: document.getElementById("screen-result"),
};

export const appRoot    = document.getElementById("app");
export const startBtn   = document.getElementById("start-btn");
export const retryBtn   = document.getElementById("retry-btn");
export const canvas     = document.getElementById("court");
export const ctx        = canvas.getContext("2d");
export const messageOverlay = document.getElementById("message-overlay");
export const messageText    = document.getElementById("message-text");

export const playerScoreEl = document.getElementById("player-score");
export const cpuScoreEl    = document.getElementById("cpu-score");
export const playerGamesEl = document.getElementById("player-games");
export const cpuGamesEl    = document.getElementById("cpu-games");
export const resultTitle   = document.getElementById("result-title");
export const resultDetail  = document.getElementById("result-detail");
export const hintText      = document.getElementById("hint-text");
export const shotControls  = document.getElementById("shot-controls");
export const debugControls = document.getElementById("debug-controls");
export const chargeBtn     = document.getElementById("charge-btn");
export const serveCategoryControls = document.getElementById("serve-category-controls");
export const aggressionControls = document.getElementById("aggression-controls");
export const shotSelectControls = document.getElementById("shot-select-controls");
export const moveStick     = document.getElementById("move-stick");
export const moveStickKnob = document.getElementById("move-stick-knob");
export const formationControls = document.getElementById("formation-controls");
export const handedControls = document.getElementById("handed-controls");
export const inputModeControls = document.getElementById("input-mode-controls");
export const controlsPanel     = document.getElementById("controls");
export const playerPicker        = document.getElementById("player-picker");
export const pickerPlayerBack    = document.getElementById("picker-player-back");
export const pickerPlayerFront   = document.getElementById("picker-player-front");
export const pickerCpuBack       = document.getElementById("picker-cpu-back");
export const pickerCpuFront      = document.getElementById("picker-cpu-front");

// マウスが最後に指していたコート地面のワールド座標（canvas外でも直前値を保持）
export const mouseAim = { x: 0, y: -TUNING.aim.defaultY, valid: false };

/* ---- ステータス（育成要素の拡張ポイント） ----
 * 将来の育成システムはこの値を書き換えるだけで効く。
 *   power:   ストロークの球速
 *   serve:   サーブの球速
 *   speed:   走る速さ
 *   reach:   打球判定の広さ
 *   control: 狙いの正確さ（1で誤差最小）
 *   volley:  前衛の反応の良さ
 *   handed:  利き腕（"right" | "left"）。デフォルトは"right"で既存挙動と同一。
 */
export function makeStats(overrides) {
  return Object.assign({
    power: 1.0,
    serve: 1.0,
    speed: 1.0,
    reach: 1.0,
    control: 1.0,  // サーブ回転の精度（serve.js）。ストローク/ボレーのブレは下記3種で扱う。
    // 打点種別ごとの「うまさ」（精度＝ブレの小ささ。高いほど正確）:
    volley: 1.0,   // ノーバウンド（ボレー）
    rising: 1.0,   // バウンド後ライジング（速い球を頂点付近で打つ。難度高め）
    stroke: 1.0,   // 通常（落としてから打つ）
    handed: "right",
  }, overrides || {});
}

export const playerStats = {
  back:  makeStats(),
  front: makeStats(),
};
export const cpuStats = {
  // CPU はやや弱め（プレイヤーが勝ちやすい）。ライジングは特に苦手にする。
  back:  makeStats({ power: 0.95, control: 0.90, stroke: 0.90, rising: 0.82, volley: 0.85 }),
  front: makeStats({ volley: 0.7, stroke: 0.85, rising: 0.78 }),
};

/* ---- 試合状態 ---- */
// state:
//  ready / serve-stance(トス前) / serve-toss(トス中) /
//  rally / fault / point / gameset / matchend
export let state = "ready";
export const debugDraw = { hitboxes: false, trajectory: false, params: false, coverage: false };
export let debugHitboxes = false;
export let debugTrajectory = false;
export let debugParams = false;
export let debugCoverage = false;
export function setDebugHitboxes(v) {
  debugDraw.hitboxes = !!v;
  debugHitboxes = debugDraw.hitboxes;
}
export function setDebugTrajectory(v) {
  debugDraw.trajectory = !!v;
  debugTrajectory = debugDraw.trajectory;
}
export function setDebugParams(v) {
  debugDraw.params = !!v;
  debugParams = debugDraw.params;
}
export function setDebugCoverage(v) {
  debugDraw.coverage = !!v;
  debugCoverage = debugDraw.coverage;
}
export let player = { games: 0, points: 0 };
export let cpu = { games: 0, points: 0 };
export let serveFaults = 0;     // 現在のポイントのフォルト数（0=ファースト、1=セカンド）
export let rafId = null;
export let lastTime = 0;
export let pendingSwing = 0;    // 早めにタップした時の予約スイング（秒）
export let matchTime = 0;       // 経過時間（タイミング計算用）

export function setState(v) { state = v; }
export function setServeFaults(v) { serveFaults = v; }
export function incServeFaults() { serveFaults++; }
export function setRafId(v) { rafId = v; }
export function setLastTime(v) { lastTime = v; }
export function setPendingSwing(v) { pendingSwing = v; }
export function setMatchTime(v) { matchTime = v; }
export function addMatchTime(dt) { matchTime += dt; }

/* ---- 攻守の割合（相方AIの積極性: 0=守り 〜 1=攻め） ---- */
// ポイント間で保持。サーブ前フェーズのUIで変更可。観戦モードでは 0.5 固定。
export let partnerAggressiveness = 0.5;
export function setPartnerAggressiveness(v) { partnerAggressiveness = v; }

/* ---- サーブ設定（打つ前にパワーと回転量を設定する） ---- */
// serveType: トスは常に統一トス。打つ瞬間のボタン+Space状態で4種に決まる。
//   左クリック=flat / 右クリック=slice / Space+左=underCut / Space+右=attackCut
export let serveType = "flat";
export function setServeType(v) { serveType = v; }

// サーブ前に選ぶ大分類: "over"（上から。flat/slice/attackCutを打つ瞬間に振り分け）
//   / "under"（下から。underCut確定でシンプルに打てる）。ポイント間で保持。
export let serveCategory = "over";
export function setServeCategory(v) { serveCategory = v; }

// サーブのパワー/回転は UI 操作ではなく、打つ選手の能力(stats)から内部で決める
// （serve.js の servePowerLevel / serveSpinLevel）。

// サーブの狙い（着地点カーソル・ワールド座標）。マウスで対角サービスコート内を指す。
// 立ち位置＋この狙いで左/中/右を打ち分け、サービスコート外はフォルトになる。
export const serveAimCursor = { x: 0, y: 0, set: false };

/* ---- ストロークの球種（クリックで3系統に集約） ---- */
export let selectedShot = "shoot"; // スマホ用の選択中の「系統」（shoot / cut / lob）。PCの保険スイングにも使用
export function setSelectedShot(v) { selectedShot = v; }

/* ---- 相手前衛の作戦（プレイヤーが打つたびに抽選） ---- */
// base（センターライン基準の定位置） / poach（邪魔しに行く） /
// straight（ストレートを守る） / middle（ミドルを張る）
export let cpuFrontPlan = "base";
// 味方（player側）前衛の作戦。観戦モードでは相手前衛と対称に動かすために使う。
export let playerFrontPlan = "base";
export function setCpuFrontPlan(v) { cpuFrontPlan = v; }
export function setPlayerFrontPlan(v) { playerFrontPlan = v; }

/* ---- ポジション・陣形（試合開始前に選択） ---- */
export let playerPosition = "back"; // back（後衛を操作） / front（前衛を操作）
export let formation = "ganko";     // ganko / double-back / double-front
export function setPlayerPosition(v) { playerPosition = v; }
export function setFormation(v) { formation = v; }

// 利き腕（自チーム全員）。デフォルトは"right"で既存挙動と同一。
// 試合前設定画面でのみ変更可能（ゲーム挙動はstats.handedを読む各所が自動で反映）。
export function setPlayerHanded(v) {
  playerStats.back.handed = v;
  playerStats.front.handed = v;
}

// 操作方法（入力デバイス）: swipe（スマホ想定・スワイプ/タップで狙い+打球。マウス追従は無効）
//                          / mouse（PC想定・マウス追従＋クリックで打球）。デフォルトはswipe。
// setControlMode（main.js）はサーブ/ラリーのUIパネル切替用の別物なので、これは setInputMode という別名にする。
export let inputMode = "swipe";
export function setInputMode(v) { inputMode = v; }

// 観戦モード（AI対AI）: trueのとき、rallyControlled（本来の操作キャラ）も
// AIが移動・狙い・スイング・サーブまで自走させる。4人全員AIで試合が進む。
export let spectatorMode = false;
export function setSpectatorMode(v) { spectatorMode = v; }

/* ---- ため（チャージ）状態 ----
 * 打点ゾーンに入ると自動でため開始。狙いはため中のマウス/スティックで
 * 着地点カーソルを動かして決める。未操作ならデフォルト（ミドル深め）へ打つ。
 * 球種は左クリック=シュート/右クリック=カット/Space+クリック=ロブで決まる。
 * source: "auto"（打点ゾーン自動開始）/ "Space"等（旧経路の後方互換用）。 */
export const charge = {
  active: false,
  start: 0,      // ため開始時の matchTime
  source: null,
};

/* ---- 着地点カーソル（ワールド座標・相手コート上） ---- */
export const aim = {
  x: 0,
  y: -9.0, // ため開始時に TUNING.aim.defaultY でリセットされる
};

/* ---- サーブ前のレシーブ準備状態 ---- */
export const serveReady = {
  timer: 0,     // serve-stance 開始からの経過秒
  still: 0,     // レシーブ側プレイヤーが静止している秒数
  ready: false, // レシーバー準備完了（CPUはこれを待って打つ／プレイヤーはトス可能になる）
};

// サーブ後にレシーブ（最初の返球）が済んだか。
// これが false の間、両チームの前衛はポジション移動・ポーチ判断をしない
export let receiveDone = true;
export function setReceiveDone(v) { receiveDone = v; }

// CPUサーブの事前プラン（種類を打つ前にプレイヤーへ表示するため先に抽選する）
export let cpuServePlan = null;
export function setCpuServePlan(v) { cpuServePlan = v; }

/* ---- サーブのトス管理 ---- */
export const toss = {
  active: false,
  t: 0,
  startX: 0,
  startY: 0,
  baseZ: 0.9,
  apexZ: 3.1,
};

/* ---- 選手 ----
 * facing: -1 = 奥向き（プレイヤー側）, +1 = 手前向き（CPU側）
 * フォアハンド側: プレイヤーは画面右(x+)、CPUは画面左(x-)
 */
// 見た目（描画のみ・ゲーム挙動には無関係）。将来のラケット色変更・キャラ外見変更や
// 対戦時の選手ごとの差し替えを見据え、人体とラケットを分離したデータとして持つ。
export function makeLook(overrides) {
  return Object.assign({
    hair: "#3B2A1E",
    // ラケットは人間とは別オブジェクト（色・スタイルを独立に差し替えられる）
    racket: { frame: "#7C3AED", string: "rgba(255,255,255,0.85)" },
  }, overrides);
}

export function makePlayer(opts) {
  return Object.assign({
    x: 0, y: 0, vx: 0, vy: 0, homeX: 0, homeY: 0,
    color: "#6366F1", skin: "#F1C7A8", label: "",
    look: makeLook(),  // 髪・ラケット等の外見（人体とラケットを分離して保持）
    facing: -1,
    pose: "idle",      // idle / ready / swing / serve / toss
    swingSide: "fore", // fore / back
    swingSideLocked: false, // trueの間はready/prepで固定済みのswingSideを再評価しない
    swingT: 0,
    recoverT: 0,       // フォロースルー終了後、構え直しが完了するまでの残り時間（秒）。
                        // >0の間は次の打球を受け付けない（クールダウン。見た目はidleでもよい）。
    wrapCommitted: false, // 来球に対して打ち方を一度決めたらtrue（打つまで再評価しない）
    wrapTargetX: null,     // 確定した立ち位置の目標x（foreApproachXが返した値を固定保持）
    wrapBallX: null,       // 確定時に基準にしたボールの予測打点x（予測が大きくズレたら再計画する判定に使う）
    hitSide: "fore",       // この来球を fore/back どちらで打つかの確定値（立ち位置と一体で決める）
    role: "back",      // back / front（その時点でのコート上の役割表示用）
    // positionBias: 0=完全前衛 〜 100=完全後衛 の連続値。AI内部はこの値で
    // 「前寄り/後ろ寄り」を判断する（front/backという固定クラスに依存しない）。
    // 陣形選択時に applyFormation() が自陣2選手へ再設定する。相手は常に雁行で固定。
    positionBias: 80,
    stats: makeStats(),
  }, opts);
}

export const back = makePlayer({
  homeX: 0, homeY: TUNING.pos.backY, color: "#6366F1", label: "あなた", facing: -1,
  stats: playerStats.back,
});
export const front = makePlayer({
  homeX: TUNING.pos.frontSideX, homeY: TUNING.pos.frontY, color: "#A5B4FC", label: "前衛", facing: -1,
  positionBias: 25, role: "front",
  stats: playerStats.front,
});
export const cpuBack = makePlayer({
  homeX: 0, homeY: -TUNING.pos.backY, color: "#1E1B4B", label: "相手後衛", facing: 1,
  stats: cpuStats.back,
});
export const cpuFront = makePlayer({
  homeX: -TUNING.pos.frontSideX, homeY: -TUNING.pos.frontY, color: "#4338CA", label: "相手前衛", facing: 1,
  positionBias: 25, role: "front",
  stats: cpuStats.front,
});

/* ---- ボール ---- */
export const ball = {
  x: 0, y: 12, z: 0.5,
  vx: 0, vy: 0, vz: 0,
  bounces: 0,
  lastHitter: "cpu",  // "player" / "cpu"（チーム単位）
  serving: false,     // サーブのボール（1バウンド目でイン判定）
  spin: "flat",       // flat / slice / drive（バウンド後の挙動が変わる）
  spinMag: 1,         // 回転の強さ（バウンドの変化量を強調）
  trailColor: "#DFFF4F", // 球種ごとの軌道色（視認性）
  originX: 0, originY: 12, // 打った位置（前衛AIのコース読みに使う）
  lastHitTime: 0,     // 打たれた時刻（AI後衛の反応遅延に使う）
  flashT: 0,
  trail: [],
  frontChecked: false,    // プレイヤー前衛のボレー判定を1回だけ行う
  cpuFrontChecked: false, // CPU前衛のポーチ判定を1回だけ行う
};

export let effects = []; // { type:"ripple"|"text", x,y(ワールド), t, ttl, text, color }
export function setEffects(v) { effects = v; }

// 操作キャラは試合を通じて固定（ポジション選択で決まる）。
// 相方の番のサーブはAIが自動で打つ。
export let rallyControlled = back;
export let pointJustServedByFront = false;
export let cpuJustServedByFront = false;
export function setRallyControlled(v) { rallyControlled = v; }
export function setPointJustServedByFront(v) { pointJustServedByFront = v; }
export function setCpuJustServedByFront(v) { cpuJustServedByFront = v; }

// チームごと: その担当者が受け持つ自陣サービスコートのx符号（+1=画面右側 / -1=左側）。
// 「後衛はクロス（自陣デュースサイド）・前衛は逆クロス（自陣アドサイド）」で固定。
export const receiverSideAssign = {
  player: { back: 1, front: -1 },
  cpu:    { back: -1, front: 1 },
};

// CPUサーブの事前抽選プラン（playerチームの相方サーブにも使う）
export let aiServePlan = null;
export function setAiServePlan(v) { aiServePlan = v; }

export let lastHitInfo = null; // 動作確認用（デバッグフックで参照）
export function setLastHitInfo(v) { lastHitInfo = v; }

/* ---- プレイヤー操作 ---- */
export const keysWasd  = { left: false, right: false, up: false, down: false };
export const stick = { active: false, dx: 0, dy: 0 }; // dx,dy は -1..1（dy: 正=自陣ベースライン方向）

// スマホ: コート(canvas)上のスワイプ操作（右手・狙い+打球用）。
// active中はスワイプの移動量から決めた狙いを優先し、pointerup でスイングする。
// タップ判定用に開始座標とポインターIDも保持する。
export const swipe = {
  active: false,
  pointerId: null,
  startX: 0, startY: 0,     // スワイプ開始のクライアント座標（しきい値判定用）
  aimX: 0, aimY: -9.0,      // スワイプ量から計算した狙い（プレビュー用・ワールド座標）
  moved: false,             // しきい値を超えて「スワイプ」と確定したか
};

// Space = ロブ修飾キー。押している間にクリックすると球種がロブになる。
export let spaceHeld = false;
export function setSpaceHeld(v) { spaceHeld = v; }

export let ballHittableSince = -1; // matchTime。-1なら現在は打てる状態でない
export function setBallHittableSince(v) { ballHittableSince = v; }

export let pendingShot = "drive";
export let pendingPower = 0;
export let pendingAimX = 0;
export let pendingAimY = -9.0;
export function setPendingShot(v) { pendingShot = v; }
export function setPendingPower(v) { pendingPower = v; }
export function setPendingAimX(v) { pendingAimX = v; }
export function setPendingAimY(v) { pendingAimY = v; }

// 展開状態（チームごと）。"cross" / "straight"。
// 相手が打った瞬間にだけ更新し、次に相手が打つまで保持する（毎フレーム再判定しない）。
export const development = { player: "cross", cpu: "cross" };

// 守備ラッチ（チームごと）。相手が打った瞬間の相手打点(x,y)を記録し、次に相手が
// 打つまで保持する。coverageGeom（守備範囲の幾何）・展開・左右責任はこの値だけを
// 基準にする。ラリー中に味方や相手が動いても責任範囲が揺れないようにするため。
//   set=false の間（ポイント開始直後など）は相手後衛の現在位置にフォールバックする。
// フォーメーション状態（ペアごと、ラリー中の唯一の状態）。
//   x,y       : 相手の(予測)打点 O。コーン幾何の起点。
//   frontSide : 前衛が守る半面（-1=左 / +1=右）。後衛は逆半面。=左右責任の割り当て。
//   set       : 確定済みか。
// 自分たちが返球した瞬間に updateFormation() で1回だけ更新し、次に返球するまで固定。
// 展開・前衛/後衛の目標位置・責任範囲はすべてこの {x,y,frontSide} から導出する。
export const coverageAnchor = {
  player: { x: 0, y: -TUNING.pos.backY, set: false, frontSide: 1 },
  cpu:    { x: 0, y:  TUNING.pos.backY, set: false, frontSide: -1 },
};
export function resetCoverageAnchors() {
  coverageAnchor.player.set = false;
  coverageAnchor.cpu.set = false;
}

// 守備デバッグ表示用。来球の打点予測と、その球の性質をチームごとに保持する。
// 担当(owner)・到達可否(reach)は各選手オブジェクトの dbgOwner / dbgReach に持つ。
// 相手の打球時に一度だけ投影してラッチする打点情報（以降ぶらさない）。
//   air/rise/descend … 打点候補（ノーバウンド/バウンド後ライジング頂点/降下点）{x,y,t}|null
//   sel               … 選択打点（打ち手の現在地から最短移動の候補）
//   hitterRole        … "net" | "base"（どちらが打つか）
//   hitTime           … ラッチした打球時刻（ball.lastHitTime。同じ球では再計算しない）
export const aiDebug = {
  player: { valid: false, hitTime: null, hitterRole: null, air: null, rise: null, descend: null, sel: null, isLob: false },
  cpu:    { valid: false, hitTime: null, hitterRole: null, air: null, rise: null, descend: null, sel: null, isLob: false },
};
