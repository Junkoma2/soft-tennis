/* ===========================================================
 * ソフトテニス ダブルス（雁行陣）ラリーゲーム
 *
 * ワールド座標系（メートル・実コート寸法）:
 *   x: -5.485（画面左） 〜 +5.485（画面右）, 0 がセンター
 *   y: +11.885 が自陣ベースライン, -11.885 が相手陣ベースライン, 0 がネット
 *   z: 高さ（0 が地面, ネット 1.07m）
 *
 * カメラは自陣ベースライン後方・やや上空からの透視投影
 * （「みんなのテニス」風の視点）。
 *
 * 操作方式:
 *   - 矢印キー（またはWASD）で4方向に自由移動。前後移動でネット
 *     詰め・ロブ処理・サービスダッシュ・ダブル後衛などの位置取りができる。
 *   - ため打ち: スペースを押している間「ため」、ボールが打点に来ると
 *     自動でスイング（途中で離してもスイング）。ためが長いほど球速アップ。
 *     ため中に ←/→ を押すと押した方向のコース（クロス/ストレート）、
 *     押さなければミドル。ため中は移動が遅くなる。
 *   - 球種は修飾キー: スペース=シュート, Shift+スペース=ロブ,
 *     Ctrl+スペース=ドロップ（カット）。
 *   - サーブ: スペース1回目でトス、トス中は左右移動可能、
 *     2回目のスペースのタイミングで対角サービスコート内の
 *     左/中/右を打ち分ける。
 *   - 試合前にポジション（後衛/前衛）と陣形（雁行陣/ダブル後衛/
 *     ダブル前衛）を選べる。操作しない相方はAIが動かす。
 *
 * 調整パラメータは下の TUNING に一元化。将来の育成要素は
 * makeStats() の戻り値を書き換えるだけで反映される設計。
 * =========================================================== */

/* ===========================================================
 * ゲームバランス調整パラメータ（ここの数値をいじるだけで調整可能）
 * =========================================================== */
const TUNING = {
  // 球速（m/s ベース。stats やためボーナスが乗る）
  shot: {
    driveSpeed: 15.0,      // シュート（ドライブ）の基本球速
    lobSpeed: 10.0,        // ロブの基本球速
    dropSpeed: 6.5,        // ドロップの基本球速
    serveOverSpeed: 18.0,  // オーバーサーブの球速
    serveCutSpeed: 11.5,   // アンダーカットサーブの球速
    cpuSpeedScale: 0.85,   // CPU打球の球速倍率（難易度調整）
  },
  // ため（チャージ）
  charge: {
    maxTime: 1.1,    // この秒数押し続けると最大チャージ
    speedBonus: 0.3, // 最大チャージ時の球速ボーナス（+30%）
    moveSlow: 0.35,  // ため中の移動速度倍率（前後のみ移動可）
  },
  // 移動の速さ（m/s）
  move: {
    playerSpeed: 7.0,   // 操作キャラの足の速さ
    partnerSpeed: 4.2,  // 味方AIの足の速さ
    cpuBackSpeed: 4.2,  // 相手後衛の足の速さ
    cpuFrontSpeed: 3.4, // 相手前衛の足の速さ
  },
  // 回転によるバウンド後の挙動
  //   friction: バウンド時の前方速度の維持率（低い=止まる）
  //   restitution: 跳ね返り係数（低い=低く滑る）
  spin: {
    slice: { friction: 0.5,  restitution: 0.22 }, // スライス/カット: かなり止まる・低く滑る
    drive: { friction: 0.92, restitution: 0.45 }, // ドライブ: 相手へ食い込む（硬式ほどは伸びない）
    flat:  { friction: 0.76, restitution: 0.52 }, // 無回転（ロブなど）
  },
};

const screens = {
  ready:  document.getElementById("screen-ready"),
  game:   document.getElementById("screen-game"),
  result: document.getElementById("screen-result"),
};

const startBtn   = document.getElementById("start-btn");
const retryBtn   = document.getElementById("retry-btn");
const canvas     = document.getElementById("court");
const ctx        = canvas.getContext("2d");
const messageOverlay = document.getElementById("message-overlay");
const messageText    = document.getElementById("message-text");

const playerScoreEl = document.getElementById("player-score");
const cpuScoreEl    = document.getElementById("cpu-score");
const playerGamesEl = document.getElementById("player-games");
const cpuGamesEl    = document.getElementById("cpu-games");
const resultTitle   = document.getElementById("result-title");
const resultDetail  = document.getElementById("result-detail");
const hintText      = document.getElementById("hint-text");
const shotControls  = document.getElementById("shot-controls");
const serveControls = document.getElementById("serve-controls");
const moveStick     = document.getElementById("move-stick");
const moveStickKnob = document.getElementById("move-stick-knob");
const positionControls  = document.getElementById("position-controls");
const formationControls = document.getElementById("formation-controls");

const W = 360;
const H = 540;

/* ---- 実コート寸法（m） ---- */
const COURT = {
  halfW: 5.485,        // ダブルスサイドライン（幅10.97m）
  singlesHalfW: 4.115, // シングルスサイドライン（幅8.23m）
  halfL: 11.885,       // ベースライン（全長23.77m）
  serviceY: 6.40,      // サービスラインはネットから6.40m
  netH: 1.07,          // ネット高
};

const G = 9.8; // 重力 m/s^2

/* ---- カメラ（自陣ベースライン後方・上空） ---- */
const CAM = {
  y: 19.0,
  z: 8.0,
  pitch: 0.42,
  fov: 330,
  horizonY: 288,
  cos: Math.cos(0.42),
  sin: Math.sin(0.42),
};

function project(x, y, z) {
  const dy = CAM.y - y;
  const dz = z - CAM.z;
  const depth = dy * CAM.cos - dz * CAM.sin;
  const up = dy * CAM.sin + dz * CAM.cos;
  const s = CAM.fov / Math.max(depth, 0.5);
  return {
    x: W / 2 + x * s,
    y: CAM.horizonY - up * s,
    s: s,          // px/m 換算（奥行きスケール）
    depth: depth,
  };
}

/* ---- ステータス（育成要素の拡張ポイント） ----
 * 将来の育成システムはこの値を書き換えるだけで効く。
 *   power:   ストロークの球速
 *   serve:   サーブの球速
 *   speed:   走る速さ
 *   reach:   打球判定の広さ
 *   control: 狙いの正確さ（1で誤差最小）
 *   volley:  前衛の反応の良さ
 */
function makeStats(overrides) {
  return Object.assign({
    power: 1.0,
    serve: 1.0,
    speed: 1.0,
    reach: 1.0,
    control: 1.0,
    volley: 1.0,
  }, overrides || {});
}

const playerStats = {
  back:  makeStats(),
  front: makeStats(),
};
const cpuStats = {
  back:  makeStats({ power: 0.9, speed: 0.62, control: 0.82 }),
  front: makeStats({ volley: 0.7 }),
};

/* ---- 試合状態 ---- */
const POINT_LABELS = ["0", "1", "2", "3"];
const POINTS_TO_WIN_GAME = 4;       // 4ポイント先取（3-3はデュース）
const FINAL_GAME_POINTS = 7;        // ファイナルゲームは7ポイント先取（6-6はデュース）
const GAMES_TO_WIN_MATCH = 3;       // 5ゲームマッチ・3ゲーム先取（2-2でファイナル）

// state:
//  ready / serve-stance(トス前) / serve-toss(トス中) /
//  rally / fault / point / gameset / matchend
let state = "ready";
let player = { games: 0, points: 0 };
let cpu = { games: 0, points: 0 };
let serveFaults = 0;     // 現在のポイントのフォルト数（0=ファースト、1=セカンド）
let rafId = null;
let lastTime = 0;
let pointerActive = false;
let pendingSwing = 0;    // 早めにタップした時の予約スイング（秒）
let matchTime = 0;       // 経過時間（タイミング計算用）

let selectedServe = "cut";  // cut / power（アンダーカット / オーバー）

/* ---- ポジション・陣形（試合開始前に選択） ---- */
let playerPosition = "back"; // back（後衛を操作） / front（前衛を操作）
let formation = "ganko";     // ganko / double-back / double-front

// 陣形ごとの定位置（自チームのみ。相手は雁行陣固定）
const FORMATIONS = {
  "ganko":        { back: { x: 0,    y: 12.3 }, front: { x: 1.8, y: 2.6 } },
  "double-back":  { back: { x: -2.2, y: 12.3 }, front: { x: 2.2, y: 11.6 } },
  "double-front": { back: { x: -2.0, y: 4.2 },  front: { x: 2.0, y: 2.6 } },
};

/* ---- ため（チャージ）状態 ---- */
const charge = {
  active: false,
  start: 0,       // ため開始時の matchTime
  shot: "drive",  // drive / lob / drop（ため開始時の修飾キー/ボタンで確定）
  course: 0,      // -1=画面左へ / 0=ミドル / +1=画面右へ（ため中の←/→で指定）
};

function chargeAmount() {
  if (!charge.active) return 0;
  return Math.max(0, Math.min(1, (matchTime - charge.start) / TUNING.charge.maxTime));
}

/* ---- サーブのトス管理 ---- */
const TOSS_RISE_TIME = 0.62;  // トスが頂点に達するまでの時間
const TOSS_HOLD_TIME = 0.95;  // 頂点付近で打てる猶予（これを過ぎると落下してフォルト）
const toss = {
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
function makePlayer(opts) {
  return Object.assign({
    x: 0, y: 0, homeX: 0, homeY: 0,
    color: "#6366F1", skin: "#F1C7A8", label: "",
    facing: -1,
    pose: "idle",      // idle / ready / swing / serve / toss
    swingSide: "fore", // fore / back
    swingT: 0,
    role: "back",      // back / front（その時点でのコート上の役割表示用）
    stats: makeStats(),
  }, opts);
}

const back = makePlayer({
  homeX: 0, homeY: 12.3, color: "#6366F1", label: "あなた", facing: -1,
  stats: playerStats.back,
});
const front = makePlayer({
  homeX: 1.8, homeY: 2.6, color: "#A5B4FC", label: "前衛", facing: -1,
  stats: playerStats.front,
});
const cpuBack = makePlayer({
  homeX: 0, homeY: -11.6, color: "#1E1B4B", label: "相手後衛", facing: 1,
  stats: cpuStats.back,
});
const cpuFront = makePlayer({
  homeX: -1.8, homeY: -2.6, color: "#4338CA", label: "相手前衛", facing: 1,
  stats: cpuStats.front,
});

const PLAYER_X_LIMIT = 5.6;
const HIT_REACH = 2.1;      // 後衛の打球判定リーチ（m, 寛容め）
const CPU_REACH = 2.0;
const VOLLEY_REACH = 1.7;   // 前衛のボレー判定

/* ---- ボール ---- */
const ball = {
  x: 0, y: 12, z: 0.5,
  vx: 0, vy: 0, vz: 0,
  bounces: 0,
  lastHitter: "cpu",  // "player" / "cpu"（チーム単位）
  serving: false,     // サーブのボール（1バウンド目でイン判定）
  spin: "flat",       // flat / slice / drive（バウンド後の挙動が変わる）
  flashT: 0,
  trail: [],
  frontChecked: false,    // プレイヤー前衛のボレー判定を1回だけ行う
  cpuFrontChecked: false, // CPU前衛のポーチ判定を1回だけ行う
};

let effects = []; // { type:"ripple"|"text", x,y(ワールド), t, ttl, text, color }

/* ===========================================================
 * 画面・スコア表示
 * =========================================================== */

function showScreen(name) {
  Object.values(screens).forEach((s) => (s.hidden = true));
  screens[name].hidden = false;
}

function showMessage(text) {
  messageText.textContent = text;
  messageOverlay.hidden = false;
}

function hideMessage() {
  messageOverlay.hidden = true;
}

function isFinalGame() {
  return player.games === GAMES_TO_WIN_MATCH - 1 && cpu.games === GAMES_TO_WIN_MATCH - 1;
}

function pointLabel(points, opponentPoints) {
  if (isFinalGame()) {
    return String(points); // ファイナルゲームは数字表示（7点先取・6-6デュース）
  }
  if (points >= 3 && opponentPoints >= 3) {
    if (points === opponentPoints) return "デュース";
    return points > opponentPoints ? "アド" : "3";
  }
  return POINT_LABELS[Math.min(points, 3)];
}

function updateScoreboard() {
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

function serverTeamNow() {
  if (isFinalGame()) {
    const block = Math.floor((player.points + cpu.points) / 2);
    return (block % 2 === 0) ? "player" : "cpu";
  }
  const totalGames = player.games + cpu.games;
  return (totalGames % 2 === 0) ? "player" : "cpu";
}

// そのチームの中で「2人目のサーバー（前衛側）」が打つ番かどうか
function serverIsSecondOfPair() {
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
function serverIsFrontPlayer() {
  return serverIsSecondOfPair();
}

// ポイント数の合計が偶数なら「サーバーから見て右」、奇数なら左
function serveFromRight() {
  return (player.points + cpu.points) % 2 === 0;
}

// サーバーの立ち位置（ベースライン後方0.6m、センターマーク〜サイドラインの間）
function servePosition(team) {
  const right = serveFromRight();
  if (team === "player") {
    // プレイヤー（奥向き）の右 = 画面右(x+)
    return { x: right ? 2.0 : -2.0, y: COURT.halfL + 0.6 };
  }
  // CPU（手前向き）の右 = 画面左(x-)
  return { x: right ? -2.0 : 2.0, y: -(COURT.halfL + 0.6) };
}

// サーブが入るべき対角サービスコート（相手コート側）
function serviceBox(team) {
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

// レシーバーの定位置（対角サービスコート後方のベースライン付近）
function receivePosition(team) {
  const box = serviceBox(team === "player" ? "cpu" : "player");
  const cx = (box.x1 + box.x2) / 2;
  if (team === "player") {
    return { x: cx, y: COURT.halfL - 0.3 };
  }
  return { x: cx, y: -(COURT.halfL - 0.3) };
}

/* ===========================================================
 * 試合進行
 * =========================================================== */

function applyFormation() {
  const f = FORMATIONS[formation] || FORMATIONS["ganko"];
  back.homeX = f.back.x;  back.homeY = f.back.y;
  front.homeX = f.front.x; front.homeY = f.front.y;
}

function startMatch() {
  player.points = 0; player.games = 0;
  cpu.points = 0; cpu.games = 0;
  serveFaults = 0;
  applyFormation();
  rallyControlled = (playerPosition === "front") ? front : back;
  back.label = (playerPosition === "back") ? "あなた" : "相方";
  front.label = (playerPosition === "front") ? "あなた" : "相方";
  updateScoreboard();
  showScreen("game");
  startServe(true);
}


// 操作キャラは試合を通じて固定（ポジション選択で決まる）。
// 相方の番のサーブはAIが自動で打つ。
let rallyControlled = back;
let pointJustServedByFront = false;
let cpuJustServedByFront = false;

function resetPlayersForPoint() {
  const team = serverTeamNow();
  const frontServes = serverIsFrontPlayer();
  const sp = servePosition(team);
  pointJustServedByFront = (team === "player" && frontServes);
  cpuJustServedByFront = (team === "cpu" && frontServes);

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
    const rp = receivePosition("cpu");
    cpuBack.x = rp.x; cpuBack.y = rp.y;
  } else {
    const server = frontServes ? cpuFront : cpuBack;
    server.x = sp.x; server.y = sp.y;
    if (frontServes) { cpuBack.x = -sp.x * 0.6; cpuBack.y = -11.5; }
    // レシーブはこのゲームでは後衛役が担当する（簡略化）
    const rp = receivePosition("player");
    back.x = rp.x; back.y = rp.y;
  }

  // 前衛は逆サイドに寄る（雁行陣のみ）。サーブする本人はその限りでない
  const sideSign = serveFromRight() ? 1 : -1;
  if (formation === "ganko" && !(team === "player" && frontServes)) {
    front.x = -1.8 * sideSign;
  }
  if (!(team === "cpu" && frontServes)) cpuFront.x = 1.8 * sideSign;

  ball.vx = 0; ball.vy = 0; ball.vz = 0;
  ball.bounces = 0;
  ball.serving = false;
  ball.spin = "flat";
  ball.trail = [];
  pendingSwing = 0;
  charge.active = false;
  toss.active = false;
  toss.t = 0;
  [back, front, cpuBack, cpuFront].forEach((p) => { p.pose = "idle"; p.swingT = 0; });
}

function currentServer() {
  const team = serverTeamNow();
  const frontServes = serverIsFrontPlayer();
  if (team === "player") return frontServes ? front : back;
  return frontServes ? cpuFront : cpuBack;
}

// プレイヤーチームのサーブで、操作キャラ自身がサーバーかどうか
function playerIsServer() {
  return serverTeamNow() === "player" && currentServer() === rallyControlled;
}

function startServe(isFirstPointOfGame) {
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
  state = "serve-stance";
  server.pose = "idle";
  if (team === "player") {
    if (playerIsServer()) {
      who = "自分のサーブ";
      serveControls.hidden = false;
      hintText.textContent = "左右に動いて構え→スペースでトス→もう一度スペースで打つ";
    } else {
      who = "相方のサーブ";
      serveControls.hidden = true;
      hintText.textContent = "相方がサーブする。自由に動いて構えよう";
      setTimeout(function () {
        if (state === "serve-stance" && serverTeamNow() === "player" && !playerIsServer()) {
          aiStartToss("player");
        }
      }, 900);
    }
  } else {
    who = "相手のサーブ";
    serveControls.hidden = true;
    hintText.textContent = "矢印キー/ドラッグで自由に動いてレシーブ";
  }

  let msg = who + "（" + sideText + "）";
  if (serveNoText) msg += "\n" + serveNoText;
  if (isFirstPointOfGame && isFinalGame() && player.points + cpu.points === 0) {
    msg = "ファイナルゲーム\n7ポイント先取・2ポイントごとにサーブ交代\n" + msg;
  }
  showMessage(msg);

  if (team === "cpu") {
    setTimeout(function () {
      if (state === "serve-stance" && serverTeamNow() === "cpu") aiStartToss("cpu");
    }, 700);
  }
}

/* ===========================================================
 * サーブ: トス → 打球
 *
 * スペース1回目でトスを上げ、トスが頂点に近いタイミングで
 * 2回目のスペースを押すと打球する。トス中はベースライン後方で
 * 左右に移動できる。
 *
 * 打球タイミング（トス頂点を基準にしたズレ）と、打つ瞬間の
 * 左右の立ち位置の組み合わせで、対角サービスコート内の
 * 左/中/右を狙い分ける。
 * =========================================================== */

function startToss(server) {
  state = "serve-toss";
  toss.active = true;
  toss.t = 0;
  toss.startX = server.x;
  toss.startY = server.y;
  server.pose = "toss";
  hintText.textContent = "トスが頂点に来た瞬間にスペースで打つ（左右にも動ける）";
}

function tossHeight() {
  // 放物線でトスの高さを計算（頂点 = apexZ、TOSS_RISE_TIMEで頂点）
  const t = toss.t;
  const riseV = (toss.apexZ - toss.baseZ) / TOSS_RISE_TIME + 0.5 * G * TOSS_RISE_TIME;
  return toss.baseZ + riseV * t - 0.5 * G * t * t;
}

function updateToss(dt) {
  if (!toss.active) return;
  toss.t += dt;
  const server = currentServer();
  ball.x = server.x;
  ball.y = server.y;
  ball.z = Math.max(0, tossHeight());

  // トスを見失う（落下しすぎ）と自動フォルト
  if (toss.t > TOSS_RISE_TIME + TOSS_HOLD_TIME) {
    toss.active = false;
    if (playerIsServer()) {
      serveFault("トスを打てなかった");
    } else {
      // AIは必ずトス頂点付近で打つので通常ここには来ない
      aiLaunchServe(serverTeamNow());
    }
  }
}

function timingOffsetFromToss() {
  return toss.t - TOSS_RISE_TIME; // 負=早い(引っ張り) / 正=遅い(流し)
}

/* ---- プレイヤーのサーブ操作 ---- */

function playerServeAction() {
  if (!playerIsServer()) return;
  if (state === "serve-stance") {
    startToss(currentServer());
    return;
  }
  if (state === "serve-toss") {
    launchPlayerServe();
    return;
  }
}

function launchPlayerServe() {
  if (state !== "serve-toss" || !playerIsServer()) return;
  hideMessage();
  toss.active = false;
  state = "rally";
  serveControls.hidden = true;
  hintText.textContent = "スペース長押しでため、←/→でコース。離すか打点が来ると打つ";

  const server = currentServer();
  const stats = server.stats;
  const timingOffset = timingOffsetFromToss();
  launchServeBall("player", server, stats, selectedServe, timingOffset);
  startSwing(server, "fore");
}

/* ---- AIのサーブ（相手チームと、自チームの相方の番で共通） ---- */

function aiStartToss(team) {
  if (state !== "serve-stance" || serverTeamNow() !== team) return;
  const server = currentServer();
  startToss(server);
  setTimeout(function () {
    if (state === "serve-toss" && serverTeamNow() === team) aiLaunchServe(team);
  }, Math.round(TOSS_RISE_TIME * 1000) + 60);
}

function aiLaunchServe(team) {
  if (state !== "serve-toss") return;
  hideMessage();
  toss.active = false;
  state = "rally";
  hintText.textContent = (team === "cpu")
    ? "矢印キー/ドラッグで動いてレシーブ。スペース長押しでため"
    : "ラリー再開。スペース長押しでため、←/→でコース";

  const server = currentServer();
  // ファーストはオーバー多め、セカンドは安全にカット
  const kind = serveFaults === 0 && Math.random() < 0.6 ? "power" : "cut";
  const timingOffset = (Math.random() - 0.5) * 0.3; // ランダムに左右のコースを散らす
  launchServeBall(team, server, server.stats, kind, timingOffset);
  startSwing(server, "fore");
}

/* ---- サーブ打球の生成（タイミング+立ち位置でコースを決定） ---- */

function launchServeBall(team, server, stats, kind, timingOffset) {
  const box = serviceBox(team);
  const targetDepth = team === "player" ? -1 : 1; // 深さの符号

  // タイミング: 早い(負)=引っ張り側、遅い(正)=流し側。
  // 「引っ張り」はフォアハンドの体の正面方向＝サービスボックスの
  // センター寄り、「流し」はサイドライン寄りに対応させる。
  // さらに立ち位置（左右どちらから打つか）に応じてベースを決める。
  const bias = Math.max(-1, Math.min(1, timingOffset / 0.45)); // -1..1
  const boxMid = (box.x1 + box.x2) / 2;
  const boxHalf = (box.x2 - box.x1) / 2;
  // bias= -1 → センター寄り(引っ張り) / +1 → サイド寄り(流し)
  // サーバーの利き腕（フォア）方向は常にセンターマーク側なので、
  // box内では「センターに近い側」がセンターマーク寄りのコート
  let tx = boxMid + bias * boxHalf * 0.85;

  let ty, speed, fromZ, sigma;
  if (kind === "power") {
    // オーバーサーブ: 速くて深いが狙いが散ってフォルトのリスク。ドライブ回転
    ty = targetDepth * (COURT.serviceY - 0.8);
    speed = TUNING.shot.serveOverSpeed * stats.serve;
    fromZ = 2.6;
    sigma = 0.55;
    ball.spin = "drive";
  } else {
    // アンダーカット: 遅く確実、バウンド後に止まって低く滑る
    ty = targetDepth * (COURT.serviceY - 2.4);
    speed = TUNING.shot.serveCutSpeed * stats.serve;
    fromZ = 0.6;
    sigma = 0.25;
    ball.spin = "slice";
  }
  if (team === "cpu") speed *= TUNING.shot.cpuSpeedScale;

  tx += (Math.random() - 0.5) * 2 * sigma;
  ty += (Math.random() - 0.5) * 2 * sigma;
  tx = Math.max(box.x1 + 0.05, Math.min(box.x2 - 0.05, tx));

  ball.lastHitter = team;
  ball.serving = true;
  ball.bounces = 0;
  ball.frontChecked = true;     // サーブには前衛は触らない
  ball.cpuFrontChecked = true;
  launchBall(server.x, server.y, fromZ, tx, ty, speed);
}

/* ---- 物理: ターゲットに1バウンド目が落ちる初速を球速から逆算 ---- */
function launchBall(fromX, fromY, fromZ, tx, ty, speed) {
  const dist = Math.max(1.0, Math.hypot(tx - fromX, ty - fromY));
  const T = dist / speed;
  ball.x = fromX; ball.y = fromY; ball.z = fromZ;
  ball.vx = (tx - fromX) / T;
  ball.vy = (ty - fromY) / T;
  ball.vz = (0.5 * G * T * T - fromZ) / T;
  ball.bounces = 0;
  ball.trail = [];
}

// ネット通過時の高さ（届かない場合はnull）
function netClearance(fromX, fromY, fromZ, tx, ty, speed) {
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
 * コースは「ため中の←/→」で決める:
 *   - course = -1: 画面左へ / 0: ミドル / +1: 画面右へ
 *   - 立ち位置との関係でクロス/ストレートの呼び名が決まる
 * ためた時間（charge 0〜1）が長いほど球速が上がる。
 *
 * 球種は修飾キー/ボタンで決定:
 *   - drive（通常・シュート）: 低めで速い。ドライブ回転で
 *     バウンド後に食い込む
 *   - lob（ロブ）: 高い弧、前衛の頭上を狙う。無回転
 *   - drop（ドロップ/カット）: ネット際に短く落とす。スライス
 *     回転でバウンド後に止まる
 * =========================================================== */

const IDEAL_HIT_DELAY = 0.14; // ため中の自動スイングが発動する打点タイミング（秒）

// 打点の高さ（地面〜2.4m）を 0(低い)〜1(高い) に正規化
function contactQuality(z) {
  return Math.max(0, Math.min(1, (z - 0.3) / 1.6));
}

// フォア/バック判定: プレイヤー（奥向き）は画面右(x+)がフォア、CPUは画面左(x-)がフォア
function isBackhandFor(side, hitterX, ballX) {
  if (side === "player") return ballX < hitterX - 0.1;
  return ballX > hitterX + 0.1;
}

// コース（-1/0/+1）とヒッターの立ち位置から表示用の呼び名を決める
function courseLabelFor(hitterX, course) {
  if (course === 0) return "ミドル";
  if (Math.abs(hitterX) < 0.6) return course < 0 ? "左へ！" : "右へ！";
  const isCross = (hitterX > 0) === (course < 0); // 立ち位置と逆へ打つ=クロス
  return isCross ? "クロス！" : "ストレート！";
}

function hitBall(opts) {
  const side = opts.side;
  const hitter = opts.hitter;
  const stats = hitter.stats;
  const shot = opts.shot || "drive";
  const course = Math.max(-1, Math.min(1, opts.course || 0)); // -1..1（連続値も可）
  const chargeBoost = 1 + TUNING.charge.speedBonus * Math.max(0, Math.min(1, opts.charge || 0));
  const contactZ = opts.contactZ != null ? opts.contactZ : ball.z;

  const backhand = isBackhandFor(side, hitter.x, ball.x);
  const quality = contactQuality(contactZ); // 高い打点ほど強打しやすい
  const power = (backhand ? 0.85 : 1.0) * (0.85 + 0.25 * quality);
  const accuracy = (backhand ? 0.55 : 1.0) * Math.min(stats.control, 1.3) * (0.8 + 0.3 * quality);

  // コース指定で目標xを決定（-1=左サイド / 0=センター / +1=右サイド）
  let tx = course * 3.5;
  tx += (Math.random() - 0.5) * 2.6 * Math.max(0, 1.15 - accuracy);
  tx = Math.max(-5.2, Math.min(5.2, tx));

  const depthDir = side === "player" ? -1 : 1;
  let ty;
  let fromZ = Math.max(0.3, Math.min(contactZ, 2.3));
  let speed;

  if (shot === "lob") {
    ty = depthDir * (8.5 + Math.random() * 3.0);
    speed = TUNING.shot.lobSpeed * (0.9 + 0.1 * stats.power) * chargeBoost;
    ball.spin = "flat";
  } else if (shot === "drop") {
    // ドロップ/カット: ネット際に短く落とす（ためは効かない）
    ty = depthDir * (1.2 + Math.random() * 1.6);
    speed = TUNING.shot.dropSpeed * (0.9 + 0.1 * stats.power);
    tx = hitter.x + (tx - hitter.x) * 0.35; // 横の散らばりも控えめに
    ball.spin = "slice";
  } else {
    ty = depthDir * (7.5 + Math.random() * 3.6); // サービスライン〜ベースラインの深め
    speed = TUNING.shot.driveSpeed * stats.power * power * chargeBoost;
    ball.spin = "drive";
  }
  if (side === "cpu") speed *= TUNING.shot.cpuSpeedScale;
  ty += (Math.random() - 0.5) * 1.6 * Math.max(0, 1.1 - accuracy);

  // CPUは時々凡ミスする（初心者でもポイントが取れる難易度調整）
  if (side === "cpu" && Math.random() < 0.13) {
    if (Math.random() < 0.5) {
      tx = (tx >= 0 ? 1 : -1) * (COURT.halfW + 0.6 + Math.random() * 1.2); // サイドアウト
    } else {
      ty = depthDir * (COURT.halfL + 0.8 + Math.random() * 1.5);           // ベースラインオーバー
    }
  }

  // ネット越えアシスト: フォアは弾道を自動補正、バックは補正なし（ネットのリスク）
  if (!backhand && shot !== "drop") {
    let tries = 0;
    while (tries < 5) {
      const clr = netClearance(hitter.x, hitter.y, fromZ, tx, ty, speed);
      if (clr === null || clr > COURT.netH + 0.25) break;
      speed *= 0.93;
      tries++;
    }
  }

  ball.lastHitter = side;
  ball.serving = false;
  ball.frontChecked = (side === "cpu") ? false : true;
  ball.cpuFrontChecked = (side === "player") ? false : true;
  launchBall(hitter.x, hitter.y, fromZ, tx, ty, speed);

  startSwing(hitter, backhand ? "back" : "fore");

  // フォア/バックを打球時に明示（バックは威力・精度ダウン）
  if (side === "player" && hitter === rallyControlled) {
    effects.push({
      type: "text",
      x: hitter.x, y: hitter.y, t: 0, ttl: 0.7,
      text: backhand ? "バック！" : "フォア！",
      color: backhand ? "#F59E0B" : "#3B82F6",
    });
    effects.push({
      type: "text",
      x: hitter.x, y: hitter.y - 0.8, t: 0, ttl: 0.7,
      text: courseLabelFor(hitter.x, course),
      color: "#10B981",
    });
  }
}

function startSwing(p, side) {
  p.pose = "swing";
  p.swingSide = side;
  p.swingT = 0.32;
}

/* ===========================================================
 * 得点処理
 * =========================================================== */

function awardPoint(toPlayer, reason) {
  if (state === "point" || state === "gameset" || state === "matchend") return;
  if (toPlayer) player.points++;
  else cpu.points++;
  serveFaults = 0;

  const winPts = isFinalGame() ? FINAL_GAME_POINTS : POINTS_TO_WIN_GAME;
  const pP = player.points;
  const cP = cpu.points;
  if (pP >= winPts && pP - cP >= 2) { finishGame(true); return; }
  if (cP >= winPts && cP - pP >= 2) { finishGame(false); return; }

  updateScoreboard();
  state = "point";
  showMessage((toPlayer ? "ポイント！" : "相手のポイント") + (reason ? "\n" + reason : ""));
  setTimeout(function () {
    if (state === "point") startServe(false);
  }, 1400);
}

function finishGame(playerWon) {
  if (playerWon) player.games++;
  else cpu.games++;
  player.points = 0;
  cpu.points = 0;
  updateScoreboard();

  if (player.games >= GAMES_TO_WIN_MATCH || cpu.games >= GAMES_TO_WIN_MATCH) {
    state = "matchend";
    showMessage(playerWon ? "ゲーム獲得！" : "ゲームを落とした");
    setTimeout(function () {
      endMatch(player.games >= GAMES_TO_WIN_MATCH);
    }, 1400);
    return;
  }

  state = "gameset";
  showMessage(playerWon ? "ゲーム獲得！" : "ゲームを落とした");
  setTimeout(function () {
    if (state === "gameset") startServe(true);
  }, 1500);
}

function endMatch(playerWon) {
  cancelAnimationFrame(rafId);
  rafId = null;
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

function serveFault(reason) {
  serveFaults++;
  if (serveFaults >= 2) {
    const receiverIsPlayer = serverTeamNow() === "cpu";
    serveFaults = 0;
    awardPoint(receiverIsPlayer, "ダブルフォルト");
    return;
  }
  state = "fault";
  showMessage("フォルト\n" + reason);
  setTimeout(function () {
    if (state === "fault") startServe(false);
  }, 1100);
}

/* ===========================================================
 * バウンド・ラリー判定
 * =========================================================== */

function insideCourt(x, y) {
  return Math.abs(x) <= COURT.halfW + 0.04 && Math.abs(y) <= COURT.halfL + 0.04;
}

function insideBox(x, y, box) {
  return x >= box.x1 - 0.04 && x <= box.x2 + 0.04 && y >= box.y1 - 0.04 && y <= box.y2 + 0.04;
}

function handleBounce() {
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

  // 反発は回転で変わる:
  //   slice: かなり止まる・低く滑る / drive: 食い込む / flat: 中間
  const sp = TUNING.spin[ball.spin] || TUNING.spin.flat;
  ball.vz = -ball.vz * sp.restitution;
  ball.vx *= sp.friction;
  ball.vy *= sp.friction;
}

function checkNet(prevY) {
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
function predictLanding() {
  const vz = ball.vz;
  const z = Math.max(ball.z, 0);
  const t = (vz + Math.sqrt(vz * vz + 2 * G * z)) / G;
  if (!isFinite(t) || t <= 0) return null;
  return { x: ball.x + ball.vx * t, y: ball.y + ball.vy * t, t: t };
}

/* ===========================================================
 * プレイヤー操作
 *
 * - 矢印キー（またはWASD）で4方向に自由移動
 *   ・上/Wでネット方向（ボレー・サービスダッシュ）
 *   ・下/Sでベースライン方向（ロブ処理・サーブの構え）
 * - スペース押しっぱなし: ため（チャージ）。長いほど球速アップ
 *   ・ため中に ←/→ でコース指定（押さなければミドル）
 *   ・ボールが打点に来ると自動でスイング。途中で離してもスイング
 *   ・ため中は左右移動できず、前後移動も遅くなる
 * - Shift+スペース: ロブ / Ctrl+スペース: ドロップ（カット）
 * - スマホ: スティックで2軸移動、下部ボタン長押しでため
 *   （ため中はスティック左右でコース指定）
 * =========================================================== */

const keys = { left: false, right: false, up: false, down: false };
const stick = { active: false, dx: 0, dy: 0 }; // dx,dy は -1..1（dy: 正=自陣ベースライン方向）

// 自由移動できるy方向の範囲（操作キャラクターの役割に応じて変える）
const Y_RANGE_BACK  = { min: 1.0, max: 13.6 };
const Y_RANGE_FRONT = { min: 0.6, max: 13.6 };

let ballHittableSince = -1; // matchTime。-1なら現在は打てる状態でない

function setControlledX(p, x) {
  p.x = Math.max(-PLAYER_X_LIMIT, Math.min(PLAYER_X_LIMIT, x));
}

function setControlledY(p, y) {
  const range = (p === front) ? Y_RANGE_FRONT : Y_RANGE_BACK;
  p.y = Math.max(range.min, Math.min(range.max, y));
}

// 後方互換用（デバッグフックから使用）
function setBackX(x) { setControlledX(back, x); }

document.addEventListener("keydown", function (e) {
  if (e.code === "ArrowLeft" || e.code === "KeyA") { keys.left = true; e.preventDefault(); }
  if (e.code === "ArrowRight" || e.code === "KeyD") { keys.right = true; e.preventDefault(); }
  if (e.code === "ArrowUp" || e.code === "KeyW") { keys.up = true; e.preventDefault(); }
  if (e.code === "ArrowDown" || e.code === "KeyS") { keys.down = true; e.preventDefault(); }

  if (e.code === "Space") {
    e.preventDefault();
    if (e.repeat) return;
    if (state === "serve-stance" || state === "serve-toss") {
      playerServeAction();
      return;
    }
    let shot = "drive";
    if (e.shiftKey) shot = "lob";
    else if (e.ctrlKey) shot = "drop";
    startCharge(shot);
  }
});

document.addEventListener("keyup", function (e) {
  if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = false;
  if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = false;
  if (e.code === "ArrowUp" || e.code === "KeyW") keys.up = false;
  if (e.code === "ArrowDown" || e.code === "KeyS") keys.down = false;
  if (e.code === "Space") releaseCharge();
});

/* ---- ため（チャージ）の開始・解放 ---- */

function startCharge(shot) {
  if (state !== "rally" || charge.active) return;
  charge.active = true;
  charge.start = matchTime;
  charge.shot = shot || "drive";
  charge.course = 0;
}

function releaseCharge() {
  if (!charge.active) return;
  const power = chargeAmount();
  const shot = charge.shot;
  const course = charge.course;
  charge.active = false;
  if (state !== "rally") return;
  if (canPlayerHit(rallyControlled)) {
    playerHitBall(shot, power, course);
  } else if (ballIncomingToPlayer() && distToBall(rallyControlled) < 6.0) {
    // 早めに離したときは「予約スイング」: 打点に届いた瞬間に自動で打つ
    pendingSwing = 0.35;
    pendingShot = shot;
    pendingPower = power;
    pendingCourse = course;
  }
}

// ため中の←/→（スティック左右）からコースを毎フレーム更新
function updateChargeCourse() {
  if (!charge.active) return;
  let c = 0;
  if (keys.left && !keys.right) c = -1;
  else if (keys.right && !keys.left) c = 1;
  if (stick.active) {
    if (stick.dx < -0.35) c = -1;
    else if (stick.dx > 0.35) c = 1;
  }
  charge.course = c;
}

// スマホ: 打球ボタンは長押し=ため、離す=スイング
shotControls.querySelectorAll(".ctrl-btn").forEach(function (btn) {
  btn.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    if (state === "serve-stance" || state === "serve-toss") {
      playerServeAction();
      return;
    }
    startCharge(btn.dataset.shot || "drive");
  });
  btn.addEventListener("pointerup", function (e) {
    e.preventDefault();
    releaseCharge();
  });
  btn.addEventListener("pointercancel", function () { releaseCharge(); });
});

serveControls.addEventListener("click", function (e) {
  const btn = e.target.closest(".ctrl-btn");
  if (!btn) return;
  selectedServe = btn.dataset.serve;
  setActiveButton(serveControls, btn);
});

// 開始画面: ポジション（後衛/前衛）と陣形の選択
positionControls.addEventListener("click", function (e) {
  const btn = e.target.closest(".ctrl-btn");
  if (!btn) return;
  playerPosition = btn.dataset.position;
  setActiveButton(positionControls, btn);
});

formationControls.addEventListener("click", function (e) {
  const btn = e.target.closest(".ctrl-btn");
  if (!btn) return;
  formation = btn.dataset.formation;
  setActiveButton(formationControls, btn);
});

function setActiveButton(group, activeBtn) {
  group.querySelectorAll(".ctrl-btn").forEach((b) => b.classList.remove("is-active"));
  activeBtn.classList.add("is-active");
}

/* ---- バーチャルスティック（スマホの移動操作） ---- */

function stickVectorFromEvent(e) {
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

function updateStickKnob(dx, dy) {
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

// コートをタップ/クリック: サーブ操作、ラリー中は長押し=ため
canvas.addEventListener("pointerdown", function (e) {
  pointerActive = true;
  if (state === "serve-stance" || state === "serve-toss") {
    playerServeAction();
    return;
  }
  startCharge("drive");
});

window.addEventListener("pointerup", function () {
  pointerActive = false;
  releaseCharge();
});

let pendingShot = "drive";
let pendingPower = 0;
let pendingCourse = 0;

function ballIncomingToPlayer() {
  return ball.lastHitter === "cpu" && ball.bounces < 2;
}

function distToBall(p) {
  return Math.hypot(ball.x - p.x, ball.y - p.y);
}

function canPlayerHit(p) {
  const cp = p || rallyControlled;
  if (!ballIncomingToPlayer()) return false;
  if (ball.serving && ball.bounces === 0) return false; // サーブはワンバウンドしてから
  if (ball.z > 2.4) return false;
  return distToBall(cp) <= HIT_REACH * cp.stats.reach;
}

function playerHitBall(shot, chargePower, course) {
  pendingSwing = 0;
  hitBall({
    hitter: rallyControlled,
    side: "player",
    shot: shot,
    charge: chargePower || 0,
    course: course || 0,
    contactZ: ball.z,
  });
  ballHittableSince = -1;
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

function moveToward(p, tx, ty, maxDist) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.01) return;
  const step = Math.min(d, maxDist);
  p.x += (dx / d) * step;
  p.y += (dy / d) * step;
}

// 相方がいま「自分のサーブを打つ前」かどうか（AIサーバーは動かさない）
function partnerIsServingNow(partner) {
  return (state === "serve-stance" || state === "serve-toss") &&
    serverTeamNow() === "player" && currentServer() === partner;
}

// 味方パートナー（プレイヤーが操作していない方）の自動移動
function updatePartner(dt) {
  const partner = (rallyControlled === back) ? front : back;
  const speed = TUNING.move.partnerSpeed * partner.stats.speed;

  // サーブを打つまでベースライン後方に留まる（前へ出ない）
  if (partnerIsServingNow(partner)) return;

  // 相手サーブ中、AI後衛はレシーブ位置で待機する
  if ((state === "serve-stance" || state === "serve-toss") &&
      serverTeamNow() === "cpu" && partner === back) {
    return;
  }

  // 相方前衛がサーブした直後はサービスダッシュ（速めに定位置へ）
  const dash = (state === "rally" && pointJustServedByFront && partner === front &&
    formation !== "double-back") ? 1.4 : 1.0;

  if (partner === front) {
    // 前衛パートナー
    if (formation === "double-back") {
      // ダブル後衛: ベースラインで操作キャラと逆サイドをカバー
      const targetX = back.x > 0 ? -2.2 : 2.2;
      moveToward(front, targetX, front.homeY, speed * dt);
    } else if (state === "rally" && ball.lastHitter === "cpu") {
      const targetX = back.x > 0 ? -1.9 : 1.9;
      moveToward(front, targetX, front.homeY, speed * dash * dt);
    } else {
      moveToward(front, front.homeX * (back.x > 0 ? -1 : 1), front.homeY, speed * dash * dt);
    }
    front.x = Math.max(-4.6, Math.min(4.6, front.x));
  } else {
    // 後衛パートナー（前衛操作時）: ストローク役としてボールを追う
    if (state === "rally" && ball.lastHitter === "cpu") {
      const landing = predictLanding();
      let tx = front.x > 0 ? -1.6 : 1.6;
      let ty = back.homeY;
      if (ball.bounces >= 1) {
        tx = ball.x + ball.vx * 0.25;
        ty = Math.max(4.5, ball.y + ball.vy * 0.25);
      } else if (landing && landing.y > 0 && insideCourt(landing.x, landing.y)) {
        tx = landing.x;
        ty = Math.max(4.5, landing.y + 1.0);
      }
      moveToward(back, tx, ty, speed * 1.2 * dt);
    } else {
      const targetX = front.x > 0 ? -1.6 : 1.6;
      moveToward(back, targetX, back.homeY, speed * dt);
    }
    back.x = Math.max(-5.2, Math.min(5.2, back.x));
  }
}

function updateCpuBack(dt) {
  const speed = TUNING.move.cpuBackSpeed * cpuBack.stats.speed;
  // 自分のサーブを打つ前はサーブ位置から動かない
  if ((state === "serve-stance" || state === "serve-toss") &&
      serverTeamNow() === "cpu" && currentServer() === cpuBack) {
    return;
  }
  if (state === "rally" && ball.lastHitter === "player") {
    const landing = predictLanding();
    let tx = cpuBack.homeX;
    let ty = cpuBack.homeY;
    if (ball.bounces >= 1) {
      tx = ball.x + ball.vx * 0.25;
      ty = Math.min(-4.5, ball.y + ball.vy * 0.25);
    } else if (landing && landing.y < 0 && insideCourt(landing.x, landing.y)) {
      tx = landing.x;
      ty = Math.min(-4.5, landing.y - 1.2);
    }
    moveToward(cpuBack, tx, ty, speed * dt);
  } else if (state === "rally" && cpuJustServedByFront) {
    // 相手前衛がサーブした回: 後衛パートナーはダブル後衛的にカバー
    const targetX = cpuFront.x > 0 ? -1.6 : 1.6;
    moveToward(cpuBack, targetX, -12.0, speed * dt);
  } else {
    moveToward(cpuBack, cpuBack.homeX, cpuBack.homeY, speed * 0.55 * dt);
  }
  cpuBack.x = Math.max(-5.2, Math.min(5.2, cpuBack.x));
}

function updateCpuFront(dt) {
  const speed = TUNING.move.cpuFrontSpeed * cpuFront.stats.speed;
  // 自分のサーブを打つ前はベースライン後方に留まる（前へ出ない）
  if ((state === "serve-stance" || state === "serve-toss") &&
      serverTeamNow() === "cpu" && currentServer() === cpuFront) {
    return;
  }
  if (state === "rally" && ball.lastHitter === "player") {
    const predicted = ball.x + ball.vx * 0.4;
    moveToward(cpuFront, Math.max(-4.4, Math.min(4.4, predicted * 0.6)), cpuFront.homeY, speed * dt);
  } else if (state === "rally" && cpuJustServedByFront) {
    // サーブを打った後はサービスダッシュでネット前の定位置へ
    moveToward(cpuFront, cpuFront.homeX * (cpuBack.x > 0 ? -1 : 1), cpuFront.homeY, speed * 1.3 * dt);
  } else {
    moveToward(cpuFront, cpuFront.homeX * (cpuBack.x > 0 ? -1 : 1), cpuFront.homeY, speed * 0.6 * dt);
  }
}


function cpuTryReturn() {
  if (ball.lastHitter !== "player" || state !== "rally") return;

  // 前衛のポーチ（ノーバウンドでカット）: 打球ごとに1回だけ判定
  if (!ball.cpuFrontChecked && ball.bounces === 0 &&
      ball.y < -0.6 && ball.y > -4.8 && ball.z < 1.9 &&
      Math.hypot(ball.x - cpuFront.x, ball.y - cpuFront.y) <= VOLLEY_REACH) {
    ball.cpuFrontChecked = true;
    if (Math.random() < 0.4 * cpuFront.stats.volley) {
      hitBall({
        hitter: cpuFront,
        side: "cpu",
        shot: "drive",
        course: (Math.random() - 0.5) * 1.4,
        contactZ: ball.z,
      });
      showMessage("相手前衛のカット！");
      setTimeout(function () { if (state === "rally") hideMessage(); }, 700);
      return;
    }
  }

  // 後衛はワンバウンドしてから打つ
  if (ball.bounces === 1 && ball.z < 2.3 &&
      distToBall(cpuBack) <= CPU_REACH * cpuBack.stats.reach) {
    // 6割でプレイヤー側後衛のいない方を突くコースを選ぶ
    let course;
    if (Math.random() < 0.6) {
      course = back.x > 0 ? -0.8 : 0.8;
    } else {
      course = (Math.random() - 0.5) * 1.6;
    }
    const shot = Math.random() < 0.75 ? "drive" : "lob";
    hitBall({
      hitter: cpuBack, side: "cpu", shot: shot,
      course: course,
      contactZ: ball.z,
    });
  }
}

// 味方パートナーの返球（ボレー+ストローク）
function partnerTryReturn() {
  if (ball.lastHitter !== "cpu" || state !== "rally") return;
  const partner = (rallyControlled === back) ? front : back;

  // ノーバウンドのボレー: ネット付近にいるときだけ、打球ごとに1回判定
  if (!ball.frontChecked && ball.bounces === 0 &&
      partner.y < 5.2 &&
      ball.y > 0.6 && ball.y < 4.8 && ball.z < 1.9 &&
      Math.hypot(ball.x - partner.x, ball.y - partner.y) <= VOLLEY_REACH) {
    ball.frontChecked = true;
    if (Math.random() < 0.5 * partner.stats.volley) {
      hitBall({
        hitter: partner,
        side: "player",
        shot: "drive",
        course: (Math.random() - 0.5) * 1.4,
        contactZ: ball.z,
      });
      showMessage("相方のボレー！");
      setTimeout(function () { if (state === "rally") hideMessage(); }, 700);
      return;
    }
  }

  // ワンバウンド後のストローク: 操作キャラが打てないボールをカバーする
  if (ball.bounces === 1 && ball.z < 2.3 &&
      !canPlayerHit(rallyControlled) &&
      distToBall(partner) <= CPU_REACH * partner.stats.reach &&
      distToBall(partner) < distToBall(rallyControlled)) {
    const shot = Math.random() < 0.8 ? "drive" : "lob";
    hitBall({
      hitter: partner,
      side: "player",
      shot: shot,
      course: (Math.random() - 0.5) * 1.6,
      contactZ: ball.z,
    });
  }
}

/* ===========================================================
 * メインループ
 * =========================================================== */

// 現在の入力（キーボード+スティック）から移動ベクトルを得る
function inputVector() {
  let dx = 0, dy = 0;
  if (keys.left) dx -= 1;
  if (keys.right) dx += 1;
  if (keys.up) dy -= 1;   // 上/Wはネット方向（yが減る）
  if (keys.down) dy += 1; // 下/Sは自陣ベースライン方向（yが増える）
  if (stick.active) {
    dx += stick.dx;
    dy += stick.dy; // スティック下方向 = 自陣ベースライン方向
  }
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  return { dx: dx, dy: dy };
}

function update(dt) {
  matchTime += dt;

  // 移動操作: サーブの構え/トス中は自分がサーバーのときのみ、ラリー中は rallyControlled
  let mover = null;
  if (state === "serve-stance" || state === "serve-toss") {
    if (playerIsServer()) mover = currentServer();
  } else if (state === "rally") {
    mover = rallyControlled;
  }

  // ため中の←/→はコース指定に使う
  updateChargeCourse();

  if (mover) {
    const v = inputVector();
    if (v.dx !== 0 || v.dy !== 0) {
      const charging = charge.active && state === "rally";
      const slow = charging ? TUNING.charge.moveSlow : 1;
      const speed = TUNING.move.playerSpeed * mover.stats.speed * slow;
      // ため中は左右入力をコース指定に充てるため、左右移動は無効
      if (!charging) setControlledX(mover, mover.x + v.dx * speed * dt);
      // トス中は前後移動を抑制（左右だけ）し、左右に動いてもトス自体は追従させる
      if (state !== "serve-toss" && state !== "serve-stance") {
        setControlledY(mover, mover.y + v.dy * speed * dt);
      }
    }
  }

  [back, front, cpuBack, cpuFront].forEach(function (p) {
    if (p.swingT > 0) {
      p.swingT -= dt;
      if (p.swingT <= 0) { p.swingT = 0; p.pose = "idle"; }
    }
  });

  effects = effects.filter(function (ef) {
    ef.t += dt;
    return ef.t < ef.ttl;
  });
  if (ball.flashT > 0) ball.flashT -= dt;

  // トスの更新（プレイヤー・CPU共通）
  if (state === "serve-toss") {
    updateToss(dt);
  }

  if (state !== "rally") {
    updatePartner(dt);
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
  updateCpuBack(dt);
  updateCpuFront(dt);

  // 予約スイング（アシスト）: 早めに離した直後の猶予内にゾーンへ入れば打つ
  if (pendingSwing > 0) {
    pendingSwing -= dt;
    if (canPlayerHit(rallyControlled)) playerHitBall(pendingShot, pendingPower, pendingCourse);
  }

  // 構え・打点タイミングの管理
  const cp = rallyControlled;
  const hittable = canPlayerHit(cp);
  if (hittable) {
    if (ballHittableSince < 0) ballHittableSince = matchTime;
    if (cp.pose !== "swing") {
      cp.pose = "ready";
      cp.swingSide = isBackhandFor("player", cp.x, ball.x) ? "back" : "fore";
    }
  } else {
    ballHittableSince = -1;
    if (cp.pose === "ready") cp.pose = "idle";
  }

  // ため中: ボールが打点に来たら自動でスイング（押しっぱなしで打てる）
  if (charge.active && hittable && ballHittableSince >= 0 &&
      matchTime - ballHittableSince >= IDEAL_HIT_DELAY) {
    const power = chargeAmount();
    const shot = charge.shot;
    const course = charge.course;
    charge.active = false;
    playerHitBall(shot, power, course);
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

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawBackground();
  drawCourt();
  drawLandingMarker();
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
  drawTimingGauge();
}

function drawBackground() {
  const horizon = CAM.horizonY - CAM.fov * Math.tan(CAM.pitch);
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#BFD9F2");
  sky.addColorStop(1, "#E8F1FA");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon);

  ctx.fillStyle = "#14532D";
  ctx.fillRect(0, horizon - 26, W, 26);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (let i = 0; i < 12; i++) {
    ctx.fillRect(i * 32, horizon - 26, 1.5, 26);
  }

  ctx.fillStyle = "#1f7a3f";
  ctx.fillRect(0, horizon, W, H - horizon);
}

function courtLine(x1, y1, x2, y2) {
  const a = project(x1, y1, 0);
  const b = project(x2, y2, 0);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawCourt() {
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

function drawNet() {
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

function drawLandingMarker() {
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

function drawGroundEffects() {
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

function drawTextEffects() {
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

function drawTimingGauge() {
  if (state === "serve-toss" && toss.active && playerIsServer()) {
    // サーブのトスゲージ: タイミングでコースが決まる
    const progress = Math.min(1, toss.t / (TOSS_RISE_TIME + TOSS_HOLD_TIME * 0.6));
    const gx = 60, gy = H - 18, gw = W - 120, gh = 6;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    roundRect(gx, gy, gw, gh, 3);
    ctx.fill();

    const idealX = gx + gw * 0.32;
    ctx.fillStyle = "rgba(16,185,129,0.9)";
    ctx.fillRect(idealX - 1.5, gy - 3, 3, gh + 6);

    const knobX = gx + gw * progress;
    ctx.fillStyle = "#FACC15";
    ctx.beginPath();
    ctx.arc(knobX, gy + gh / 2, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "700 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("センター寄り", gx + gw * 0.16, gy - 8);
    ctx.fillText("ミドル", gx + gw * 0.5, gy - 8);
    ctx.fillText("サイド寄り", gx + gw * 0.84, gy - 8);
    return;
  }

  if (state === "rally" && charge.active) {
    // ためゲージ: たまるほど球速アップ。選択コースも表示
    const k = chargeAmount();
    const gx = 60, gy = H - 18, gw = W - 120, gh = 8;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    roundRect(gx, gy, gw, gh, 4);
    ctx.fill();

    ctx.fillStyle = k >= 1 ? "#F59E0B" : "#6366F1";
    roundRect(gx, gy, Math.max(6, gw * k), gh, 4);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "700 11px sans-serif";
    ctx.textAlign = "center";
    const shotName = charge.shot === "lob" ? "ロブ" : charge.shot === "drop" ? "ドロップ" : "シュート";
    const courseName = courseLabelFor(rallyControlled.x, charge.course).replace("！", "");
    ctx.fillText("ため " + shotName + " / " + courseName + (k >= 1 ? " MAX" : ""), gx + gw / 2, gy - 6);
  }
}

/* ---- ボール ---- */
function drawBallShadow() {
  if (state === "ready") return;
  const p = project(ball.x, ball.y, 0);
  const r = Math.max(2, 0.16 * p.s * (1 + Math.min(ball.z, 4) * 0.12));
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * 1.4, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBall() {
  ball.trail.forEach(function (tp, i) {
    const p = project(tp.x, tp.y, tp.z);
    const k = (i + 1) / ball.trail.length;
    ctx.globalAlpha = 0.16 * k;
    ctx.fillStyle = "#DFFF4F";
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

  ctx.fillStyle = "#DFFF4F";
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(30,27,75,0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/* ---- 簡易人型の選手 ---- */
function drawHumanoid(pl) {
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
  roundRect(-tw / 2, torsoTop, tw, torsoBottom - torsoTop, 0.12 * s);
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
    roundRect(-bw / 2, by, bw, 0.36 * s, 0.1 * s);
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

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/* ===========================================================
 * ループ・画面遷移
 * =========================================================== */

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000 || 0.016, 0.05);
  lastTime = now;
  update(dt);
  draw();
  rafId = requestAnimationFrame(loop);
}

startBtn.addEventListener("click", function () {
  startMatch();
  if (!rafId) {
    lastTime = performance.now();
    matchTime = 0;
    rafId = requestAnimationFrame(loop);
  }
});

retryBtn.addEventListener("click", function () {
  showScreen("ready");
  cancelAnimationFrame(rafId);
  rafId = null;
  state = "ready";
});

draw();

// 動作確認（E2Eテスト）用の読み取り専用フック。ゲームロジックからは使用しない。
window.__softTennisDebug = {
  get: function () {
    return {
      state: state,
      playerPoints: player.points, cpuPoints: cpu.points,
      playerGames: player.games, cpuGames: cpu.games,
      serveFaults: serveFaults,
      serverTeam: state === "ready" ? null : serverTeamNow(),
      serverIsFront: state === "ready" ? null : serverIsFrontPlayer(),
      playerIsServer: state === "ready" ? null : playerIsServer(),
      serveRight: serveFromRight(),
      controlledIsFront: rallyControlled === front,
      playerPosition: playerPosition,
      formation: formation,
      tossActive: toss.active,
      tossT: toss.t,
      charge: { active: charge.active, shot: charge.shot, course: charge.course, amount: chargeAmount() },
      ball: {
        x: ball.x, y: ball.y, z: ball.z,
        vx: ball.vx, vy: ball.vy, vz: ball.vz,
        bounces: ball.bounces, serving: ball.serving,
        lastHitter: ball.lastHitter, spin: ball.spin,
      },
      back: { x: back.x, y: back.y },
      front: { x: front.x, y: front.y },
      cpuBack: { x: cpuBack.x, y: cpuBack.y },
      cpuFront: { x: cpuFront.x, y: cpuFront.y },
    };
  },
  setBackX: setBackX,
  setControlledX: setControlledX,
  setControlledY: setControlledY,
  // テスト用: 操作キャラを指定座標へ移動
  teleport: function (x, y) {
    setControlledX(rallyControlled, x);
    setControlledY(rallyControlled, y);
  },
  getControlled: function () { return rallyControlled === front ? "front" : "back"; },
  // テスト用: ため→打つ を一括で行う（chargeSec秒ためた扱い、courseは-1/0/1）
  action: function (shot, course, chargeSec) {
    if (state === "serve-stance" || state === "serve-toss") {
      playerServeAction();
      return;
    }
    if (state !== "rally") return;
    const power = Math.max(0, Math.min(1, (chargeSec || 0) / TUNING.charge.maxTime));
    if (canPlayerHit(rallyControlled)) {
      playerHitBall(shot || "drive", power, course || 0);
    } else if (ballIncomingToPlayer() && distToBall(rallyControlled) < 6.0) {
      pendingSwing = 0.4;
      pendingShot = shot || "drive";
      pendingPower = power;
      pendingCourse = course || 0;
    }
  },
  startCharge: startCharge,
  releaseCharge: releaseCharge,
  // テスト用: トスのタイミングを直接指定して打つ
  forceServeTiming: function (tossT) {
    if (state === "serve-stance") playerServeAction();
    if (state === "serve-toss") {
      toss.t = tossT;
      launchPlayerServe();
    }
  },
  tuning: TUNING,
};
