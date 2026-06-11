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
 * 将来の育成要素は makeStats() の戻り値を書き換えるだけで
 * 球速・移動・リーチ等に反映される設計。
 * =========================================================== */

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
const courseControls = document.getElementById("course-controls");
const shotControls    = document.getElementById("shot-controls");
const serveControls   = document.getElementById("serve-controls");

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

let state = "ready"; // ready / serve / rally / fault / point / gameset / matchend
let player = { games: 0, points: 0 };
let cpu = { games: 0, points: 0 };
let serveFaults = 0;     // 現在のポイントのフォルト数（0=ファースト、1=セカンド）
let rafId = null;
let lastTime = 0;
let pointerActive = false;
let pendingSwing = 0;    // 早めにタップした時の予約スイング（秒）

let selectedCourse = "middle";
let selectedShot = "drive";
let selectedServe = "cut";

/* ---- 選手 ----
 * facing: -1 = 奥向き（プレイヤー側）, +1 = 手前向き（CPU側）
 * フォアハンド側: プレイヤーは画面右(x+)、CPUは画面左(x-)
 */
function makePlayer(opts) {
  return Object.assign({
    x: 0, y: 0, homeX: 0, homeY: 0,
    color: "#6366F1", skin: "#F1C7A8", label: "",
    facing: -1,
    pose: "idle",      // idle / ready / swing / serve
    swingSide: "fore", // fore / back
    swingT: 0,
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

const PLAYER_X_LIMIT = 4.9;
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
  cut: false,         // カットサーブ（バウンド後低く滑る）
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
 * サーブ順・サーブ位置（公式ルール準拠）
 *
 * ダブルスのサービスは1ゲームごとに輪番:
 *   第1ゲーム: 自チーム後衛 → 第2: 相手後衛 → 第3: 自チーム前衛
 *   → 第4: 相手前衛 → ファイナルゲームは2ポイントごとにチーム交代
 * サーブ位置はベースライン後方、ポイントごとに右/左交互。
 * 対角のサービスコートに入らなければフォルト（2本制）。
 * =========================================================== */

function serverTeamNow() {
  if (isFinalGame()) {
    const block = Math.floor((player.points + cpu.points) / 2);
    return block % 2 === 0 ? "player" : "cpu";
  }
  return (player.games + cpu.games) % 2 === 0 ? "player" : "cpu";
}

function serverIsFrontPlayer() {
  if (isFinalGame()) return false;
  return (player.games + cpu.games) >= 2; // 第3・第4ゲームは各ペアの2人目（前衛）がサーブ
}

// ポイント数の合計が偶数なら「サーバーから見て右」、奇数なら左
function serveFromRight() {
  return (player.points + cpu.points) % 2 === 0;
}

// サーバーの立ち位置（ベースライン後方0.6m、センターマーク寄り）
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

function startMatch() {
  player.points = 0; player.games = 0;
  cpu.points = 0; cpu.games = 0;
  serveFaults = 0;
  updateScoreboard();
  showScreen("game");
  startServe(true);
}

function resetPlayersForPoint() {
  const team = serverTeamNow();
  const frontServes = serverIsFrontPlayer();
  const sp = servePosition(team);

  // 全員定位置へ（サーバーとレシーバーだけ特別配置）
  back.x = back.homeX;  back.y = back.homeY;
  front.x = front.homeX; front.y = front.homeY;
  cpuBack.x = cpuBack.homeX; cpuBack.y = cpuBack.homeY;
  cpuFront.x = cpuFront.homeX; cpuFront.y = cpuFront.homeY;

  if (team === "player") {
    const server = frontServes ? front : back;
    server.x = sp.x; server.y = sp.y;
    if (frontServes) { back.x = -sp.x * 0.6; back.y = 11.5; }
    const rp = receivePosition("cpu");
    cpuBack.x = rp.x; cpuBack.y = rp.y;
  } else {
    const server = frontServes ? cpuFront : cpuBack;
    server.x = sp.x; server.y = sp.y;
    if (frontServes) { cpuBack.x = -sp.x * 0.6; cpuBack.y = -11.5; }
    const rp = receivePosition("player");
    back.x = rp.x; back.y = rp.y;
  }

  // 前衛は逆サイドに寄る（雁行陣）
  const sideSign = serveFromRight() ? 1 : -1;
  if (!(team === "player" && frontServes)) front.x = -1.8 * sideSign;
  if (!(team === "cpu" && frontServes)) cpuFront.x = 1.8 * sideSign;

  ball.vx = 0; ball.vy = 0; ball.vz = 0;
  ball.bounces = 0;
  ball.serving = false;
  ball.cut = false;
  ball.trail = [];
  pendingSwing = 0;
  [back, front, cpuBack, cpuFront].forEach((p) => { p.pose = "idle"; p.swingT = 0; });
}

function currentServer() {
  const team = serverTeamNow();
  const frontServes = serverIsFrontPlayer();
  if (team === "player") return frontServes ? front : back;
  return frontServes ? cpuFront : cpuBack;
}

function startServe(isFirstPointOfGame) {
  hideMessage();
  state = "serve";
  resetPlayersForPoint();

  const team = serverTeamNow();
  const server = currentServer();
  server.pose = "serve";
  ball.x = server.x;
  ball.y = server.y;
  ball.z = 0.9;
  ball.lastHitter = team;

  const sideText = serveFromRight() ? "右サイド" : "左サイド";
  const serveNoText = serveFaults > 0 ? "セカンドサーブ" : "";
  let who;
  if (team === "player") {
    who = serverIsFrontPlayer() ? "前衛のサーブ" : "自分のサーブ";
    serveControls.hidden = false;
    hintText.textContent = "サーブを選んでタップ／スペースで打つ（対角のサービスコートへ）";
  } else {
    who = "相手のサーブ";
    serveControls.hidden = true;
    hintText.textContent = "ドラッグまたは矢印キーで構える（ワンバウンドを打ち返す）";
  }

  let msg = who + "（" + sideText + "）";
  if (serveNoText) msg += "\n" + serveNoText;
  if (isFirstPointOfGame && isFinalGame() && player.points + cpu.points === 0) {
    msg = "ファイナルゲーム\n7ポイント先取・2ポイントごとにサーブ交代\n" + msg;
  }
  showMessage(msg);

  if (team === "cpu") {
    setTimeout(function () {
      if (state === "serve" && serverTeamNow() === "cpu") launchCpuServe();
    }, 1100);
  }
}

/* ---- サーブを打つ ---- */

function launchPlayerServe() {
  if (state !== "serve" || serverTeamNow() !== "player") return;
  hideMessage();
  state = "rally";
  serveControls.hidden = true;
  hintText.textContent = "リングが目印。ボールが来たらタップ／スペースで打つ";

  const server = currentServer();
  const stats = server.stats;
  launchServeBall("player", server, stats, selectedServe);
  startSwing(server, "fore");
}

function launchCpuServe() {
  hideMessage();
  state = "rally";
  hintText.textContent = "ドラッグまたは矢印キーで構える（ワンバウンドを打ち返す）";

  const server = currentServer();
  // CPUはファーストでオーバー、セカンドは安全にカット
  const kind = serveFaults === 0 && Math.random() < 0.6 ? "power" : "cut";
  launchServeBall("cpu", server, server.stats, kind);
  startSwing(server, "fore");
}

function launchServeBall(team, server, stats, kind) {
  const box = serviceBox(team);
  const targetDepth = team === "player" ? -1 : 1; // 深さの符号

  let tx, ty, speed, fromZ, sigma;
  // コース選択をサーブの狙いに反映（クロス=ワイド / ミドル=センター / ストレート=ボディ）
  const wideX = team === "player" ? (box.x1 + 0.7) : (box.x2 - 0.7);
  const centerX = team === "player" ? (box.x2 - 0.7) : (box.x1 + 0.7);
  const midX = (box.x1 + box.x2) / 2;
  const course = team === "player" ? selectedCourse : ["cross", "middle", "straight"][Math.floor(Math.random() * 3)];
  if (course === "cross") tx = wideX;
  else if (course === "straight") tx = centerX;
  else tx = midX;

  if (kind === "power") {
    // オーバーサーブ: 速くて深いが狙いが散ってフォルトのリスク
    ty = targetDepth * (COURT.serviceY - 0.8);
    speed = 15.5 * stats.serve;
    fromZ = 2.5;
    sigma = 1.0;
    ball.cut = false;
  } else {
    // アンダーカット: 遅く確実、バウンド後に低く滑る
    ty = targetDepth * (COURT.serviceY - 2.4);
    speed = 10.5 * stats.serve;
    fromZ = 0.5;
    sigma = 0.3;
    ball.cut = true;
  }

  tx += (Math.random() - 0.5) * 2 * sigma;
  ty += (Math.random() - 0.5) * 2 * sigma;

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
 * =========================================================== */

function courseTargetX(course, hitterX, side) {
  let target;
  if (course === "cross") {
    target = hitterX > 0 ? -3.6 : 3.6;
  } else if (course === "straight") {
    target = hitterX > 0 ? 3.6 : -3.6;
  } else {
    target = (Math.random() - 0.5) * 1.6;
  }
  return Math.max(-4.6, Math.min(4.6, target));
}

// フォア/バック判定: プレイヤー（奥向き）は画面右(x+)がフォア、CPUは画面左(x-)がフォア
function isBackhandFor(side, hitterX, ballX) {
  if (side === "player") return ballX < hitterX - 0.1;
  return ballX > hitterX + 0.1;
}

function hitBall(opts) {
  const side = opts.side;
  const hitter = opts.hitter;
  const stats = hitter.stats;
  const course = opts.course;
  const shot = opts.shot;

  const backhand = isBackhandFor(side, hitter.x, ball.x);
  const power = backhand ? 0.85 : 1.0;
  const accuracy = (backhand ? 0.55 : 1.0) * Math.min(stats.control, 1.3);

  let tx = courseTargetX(course, hitter.x, side);
  tx += (Math.random() - 0.5) * 2.6 * Math.max(0, 1.15 - accuracy);
  tx = Math.max(-5.2, Math.min(5.2, tx));

  const depthDir = side === "player" ? -1 : 1;
  let ty = depthDir * (7.5 + Math.random() * 3.6); // サービスライン〜ベースラインの深め
  ty += (Math.random() - 0.5) * 1.6 * Math.max(0, 1.1 - accuracy);

  // CPUは時々凡ミスする（初心者でもポイントが取れる難易度調整）
  if (side === "cpu" && Math.random() < 0.13) {
    if (Math.random() < 0.5) {
      tx = (tx >= 0 ? 1 : -1) * (COURT.halfW + 0.6 + Math.random() * 1.2); // サイドアウト
    } else {
      ty = depthDir * (COURT.halfL + 0.8 + Math.random() * 1.5);           // ベースラインオーバー
    }
  }

  const fromZ = Math.max(0.45, Math.min(ball.z, 1.6));
  let speed;
  if (shot === "lob") {
    speed = 9.0 * (0.9 + 0.1 * stats.power);
  } else {
    speed = 12.5 * stats.power * power;
  }

  // ネット越えアシスト: フォアは弾道を自動補正、バックは補正なし（ネットのリスク）
  if (!backhand) {
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
  ball.cut = false;
  ball.frontChecked = (side === "cpu") ? false : true;
  ball.cpuFrontChecked = (side === "player") ? false : true;
  launchBall(hitter.x, hitter.y, fromZ, tx, ty, speed);

  startSwing(hitter, backhand ? "back" : "fore");

  // フォア/バックを打球時に明示（バックは威力・精度ダウン）
  if (side === "player" && hitter === back) {
    effects.push({
      type: "text",
      x: hitter.x, y: hitter.y, t: 0, ttl: 0.7,
      text: backhand ? "バック！" : "フォア！",
      color: backhand ? "#F59E0B" : "#3B82F6",
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

  // 反発（カットサーブはバウンド後低く滑る）
  if (ball.cut) {
    ball.vz = -ball.vz * 0.2;
    ball.vx *= 0.95;
    ball.vy *= 0.95;
  } else {
    ball.vz = -ball.vz * 0.52;
    ball.vx *= 0.8;
    ball.vy *= 0.8;
  }
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
 * =========================================================== */

const KEY_MOVE_SPEED = 6.5; // m/s
const keys = { left: false, right: false };

function setBackX(x) {
  back.x = Math.max(-PLAYER_X_LIMIT, Math.min(PLAYER_X_LIMIT, x));
}

document.addEventListener("keydown", function (e) {
  if (e.code === "ArrowLeft") { keys.left = true; e.preventDefault(); }
  if (e.code === "ArrowRight") { keys.right = true; e.preventDefault(); }

  if (e.code === "KeyA") selectAndHighlight(courseControls, "cross");
  if (e.code === "KeyS") selectAndHighlight(courseControls, "middle");
  if (e.code === "KeyD") selectAndHighlight(courseControls, "straight");
  if (e.code === "KeyJ") selectAndHighlight(shotControls, "drive");
  if (e.code === "KeyK") selectAndHighlight(shotControls, "lob");

  if (e.code === "Space") {
    e.preventDefault();
    tryPlayerHit();
  }
});

document.addEventListener("keyup", function (e) {
  if (e.code === "ArrowLeft") keys.left = false;
  if (e.code === "ArrowRight") keys.right = false;
});

function selectAndHighlight(group, value) {
  const attr = group === courseControls ? "course" : "shot";
  const selector = "[data-" + attr + '="' + value + '"]';
  const btn = group.querySelector(selector);
  if (!btn) return;
  if (attr === "course") selectedCourse = value;
  if (attr === "shot") selectedShot = value;
  setActiveButton(group, btn);
}

courseControls.addEventListener("click", function (e) {
  const btn = e.target.closest(".ctrl-btn");
  if (!btn) return;
  selectedCourse = btn.dataset.course;
  setActiveButton(courseControls, btn);
});

shotControls.addEventListener("click", function (e) {
  const btn = e.target.closest(".ctrl-btn");
  if (!btn) return;
  selectedShot = btn.dataset.shot;
  setActiveButton(shotControls, btn);
});

serveControls.addEventListener("click", function (e) {
  const btn = e.target.closest(".ctrl-btn");
  if (!btn) return;
  selectedServe = btn.dataset.serve;
  setActiveButton(serveControls, btn);
  if (state === "serve" && serverTeamNow() === "player") {
    launchPlayerServe();
  }
});

function setActiveButton(group, activeBtn) {
  group.querySelectorAll(".ctrl-btn").forEach((b) => b.classList.remove("is-active"));
  activeBtn.classList.add("is-active");
}

function worldXFromClient(clientX) {
  const rect = canvas.getBoundingClientRect();
  const sx = (clientX - rect.left) * (W / rect.width);
  const p = project(back.x, back.y, 0);
  return (sx - W / 2) / p.s;
}

canvas.addEventListener("pointerdown", function (e) {
  pointerActive = true;
  if (state === "rally") setBackX(worldXFromClient(e.clientX));
  tryPlayerHit();
});

canvas.addEventListener("pointermove", function (e) {
  if (!pointerActive) return;
  if (state !== "serve") setBackX(worldXFromClient(e.clientX));
});

window.addEventListener("pointerup", function () {
  pointerActive = false;
});

canvas.addEventListener("touchmove", function (e) {
  e.preventDefault();
  const touch = e.touches[0];
  if (touch && state !== "serve") setBackX(worldXFromClient(touch.clientX));
}, { passive: false });

function tryPlayerHit() {
  if (state === "serve" && serverTeamNow() === "player") {
    launchPlayerServe();
    return;
  }
  if (state !== "rally") return;
  if (canPlayerHit()) {
    playerHitBall();
  } else if (ballIncomingToPlayer() && distToBall(back) < 6.0) {
    // 早めのタップは「予約スイング」: ボールが届いた瞬間に自動で打つアシスト
    pendingSwing = 0.4;
  }
}

function ballIncomingToPlayer() {
  return ball.lastHitter === "cpu" && ball.bounces < 2;
}

function distToBall(p) {
  return Math.hypot(ball.x - p.x, ball.y - p.y);
}

function canPlayerHit() {
  if (!ballIncomingToPlayer()) return false;
  if (ball.serving && ball.bounces === 0) return false; // サーブはワンバウンドしてから
  if (ball.y < 5.0) return false;                       // 後衛はネット際までは取れない
  if (ball.z > 2.4) return false;
  return distToBall(back) <= HIT_REACH * back.stats.reach;
}

function playerHitBall() {
  pendingSwing = 0;
  hitBall({
    hitter: back,
    side: "player",
    course: selectedCourse,
    shot: selectedShot,
  });
}

/* ===========================================================
 * CPU・前衛のAI
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

function updateFront(dt) {
  // 味方前衛: 相手の打球時はサイドへ寄り、味方の攻撃時はネットへ詰める
  const speed = 3.6 * front.stats.speed;
  if (state === "rally" && ball.lastHitter === "cpu") {
    const targetX = back.x > 0 ? -1.9 : 1.9;
    moveToward(front, targetX, front.homeY, speed * dt);
  } else {
    moveToward(front, front.homeX * (back.x > 0 ? -1 : 1), front.homeY, speed * dt);
  }
  front.x = Math.max(-4.6, Math.min(4.6, front.x));
}

function updateCpuBack(dt) {
  const speed = 4.2 * cpuBack.stats.speed;
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
  } else {
    moveToward(cpuBack, cpuBack.homeX, cpuBack.homeY, speed * 0.55 * dt);
  }
  cpuBack.x = Math.max(-5.2, Math.min(5.2, cpuBack.x));
}

function updateCpuFront(dt) {
  const speed = 3.4 * cpuFront.stats.speed;
  if (state === "rally" && ball.lastHitter === "player") {
    const predicted = ball.x + ball.vx * 0.4;
    moveToward(cpuFront, Math.max(-4.4, Math.min(4.4, predicted * 0.6)), cpuFront.homeY, speed * dt);
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
        course: ["cross", "straight"][Math.floor(Math.random() * 2)],
        shot: "drive",
      });
      showMessage("相手前衛のカット！");
      setTimeout(function () { if (state === "rally") hideMessage(); }, 700);
      return;
    }
  }

  // 後衛はワンバウンドしてから打つ
  if (ball.bounces === 1 && ball.z < 2.3 &&
      distToBall(cpuBack) <= CPU_REACH * cpuBack.stats.reach) {
    const courseChoices = ["cross", "middle", "straight"];
    let course = courseChoices[Math.floor(Math.random() * courseChoices.length)];
    // 6割でプレイヤーのいない方を突く
    if (Math.random() < 0.6) {
      course = back.x > 0 ? "cross" : "straight";
      if (cpuBack.x * back.x > 0) course = "cross";
    }
    const shot = Math.random() < 0.75 ? "drive" : "lob";
    hitBall({ hitter: cpuBack, side: "cpu", course: course, shot: shot });
  }
}

function playerFrontTryVolley() {
  if (ball.lastHitter !== "cpu" || state !== "rally") return;
  if (ball.frontChecked || ball.bounces !== 0) return;
  if (ball.y < 0.6 || ball.y > 4.8 || ball.z > 1.9) return;
  if (Math.hypot(ball.x - front.x, ball.y - front.y) > VOLLEY_REACH) return;
  ball.frontChecked = true;
  if (Math.random() < 0.5 * front.stats.volley) {
    hitBall({
      hitter: front,
      side: "player",
      course: ["cross", "middle", "straight"][Math.floor(Math.random() * 3)],
      shot: "drive",
    });
    showMessage("前衛ボレー！");
    setTimeout(function () { if (state === "rally") hideMessage(); }, 700);
  }
}

/* ===========================================================
 * メインループ
 * =========================================================== */

function update(dt) {
  if (state === "rally") {
    if (keys.left) setBackX(back.x - KEY_MOVE_SPEED * back.stats.speed * dt);
    if (keys.right) setBackX(back.x + KEY_MOVE_SPEED * back.stats.speed * dt);
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

  if (state !== "rally") {
    updateFront(dt);
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

  updateFront(dt);
  updateCpuBack(dt);
  updateCpuFront(dt);

  // 予約スイング（アシスト）: 押しっぱなしの猶予内にゾーンへ入れば打つ
  if (pendingSwing > 0) {
    pendingSwing -= dt;
    if (canPlayerHit()) playerHitBall();
  }

  // ボールが構え判定: フォア/バックの構えを更新
  if (ballIncomingToPlayer() && ball.y > 4 && back.pose !== "swing") {
    back.pose = "ready";
    back.swingSide = isBackhandFor("player", back.x, ball.x) ? "back" : "fore";
  } else if (back.pose === "ready") {
    back.pose = "idle";
  }

  playerFrontTryVolley();
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

  // 奥行き順に選手・ネット・ボールを描画
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
}

function drawBackground() {
  const horizon = CAM.horizonY - CAM.fov * Math.tan(CAM.pitch);
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#BFD9F2");
  sky.addColorStop(1, "#E8F1FA");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon);

  // 奥のフェンス
  ctx.fillStyle = "#14532D";
  ctx.fillRect(0, horizon - 26, W, 26);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (let i = 0; i < 12; i++) {
    ctx.fillRect(i * 32, horizon - 26, 1.5, 26);
  }

  // 地面（コート外周）
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

  // コート面（実寸の台形）
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

  // ベースライン・ダブルスサイドライン
  ctx.lineWidth = 2;
  courtLine(-c.halfW, -c.halfL, c.halfW, -c.halfL);
  courtLine(-c.halfW, c.halfL, c.halfW, c.halfL);
  courtLine(-c.halfW, -c.halfL, -c.halfW, c.halfL);
  courtLine(c.halfW, -c.halfL, c.halfW, c.halfL);

  // シングルスサイドライン
  ctx.lineWidth = 1.6;
  courtLine(-c.singlesHalfW, -c.halfL, -c.singlesHalfW, c.halfL);
  courtLine(c.singlesHalfW, -c.halfL, c.singlesHalfW, c.halfL);

  // サービスライン（ネットから6.40m・両コート）
  courtLine(-c.singlesHalfW, -c.serviceY, c.singlesHalfW, -c.serviceY);
  courtLine(-c.singlesHalfW, c.serviceY, c.singlesHalfW, c.serviceY);

  // センターサービスライン（ネット〜サービスライン）
  courtLine(0, -c.serviceY, 0, 0);
  courtLine(0, 0, 0, c.serviceY);

  // センターマーク（ベースライン中央の短い線）
  courtLine(0, c.halfL - 0.18, 0, c.halfL);
  courtLine(0, -c.halfL, 0, -c.halfL + 0.18);

  // サーブ時はターゲットのサービスコートをハイライト
  if ((state === "serve" || (state === "rally" && ball.serving)) && serverTeamNow()) {
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

  // 網
  ctx.fillStyle = "rgba(20,30,40,0.42)";
  ctx.beginPath();
  ctx.moveTo(postL0.x, postL0.y);
  ctx.lineTo(postR0.x, postR0.y);
  ctx.lineTo(postR1.x, postR1.y);
  ctx.lineTo(postL1.x, postL1.y);
  ctx.closePath();
  ctx.fill();

  // メッシュ模様
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 0.6;
  for (let i = 1; i < 14; i++) {
    const x = -c.halfW - 0.3 + (i / 14) * (c.halfW * 2 + 0.6);
    const a = project(x, 0, 0);
    const b = project(x, 0, c.netH);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  // 白帯
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(postL1.x, postL1.y);
  ctx.lineTo(postR1.x, postR1.y);
  ctx.stroke();

  // ポスト
  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(postL0.x, postL0.y); ctx.lineTo(postL1.x, postL1.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(postR0.x, postR0.y); ctx.lineTo(postR1.x, postR1.y); ctx.stroke();
}

/* ---- 着地予定マーカー ---- */
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
  if (!inCourt) color = "rgba(120,120,120,0.65)";       // アウト予測はグレー
  else if (incoming) color = "rgba(255,196,0,0.9)";      // 自分側に来るボールは黄色
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

/* ---- バウンドのリップル ---- */
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
  // 残像
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

  // バウンドの瞬間はフラッシュ
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

  // 影
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.34 * s, 0.13 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  const legH = 0.5 * s;
  const torsoTop = -1.18 * s;
  const torsoBottom = -legH;
  const headR = 0.23 * s;
  const headCy = torsoTop - headR * 0.85;

  // フォア/バックでスイング・構えの向きを決める
  // プレイヤー(奥向き)はフォア=画面右、CPU(手前向き)はフォア=画面左
  const foreDir = pl.facing === -1 ? 1 : -1;
  const sideDir = pl.swingSide === "fore" ? foreDir : -foreDir;

  // 脚
  ctx.strokeStyle = "#1F2937";
  ctx.lineWidth = Math.max(1.5, 0.09 * s);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-0.12 * s, torsoBottom);
  ctx.lineTo(-0.16 * s, 0);
  ctx.moveTo(0.12 * s, torsoBottom);
  ctx.lineTo(0.16 * s, 0);
  ctx.stroke();

  // 胴体（シャツ＝チームカラー）
  ctx.fillStyle = pl.color;
  const tw = 0.46 * s;
  roundRect(-tw / 2, torsoTop, tw, torsoBottom - torsoTop, 0.12 * s);
  ctx.fill();

  // 腕＋ラケット
  const shoulderY = torsoTop + 0.12 * s;
  let armAngle; // 0=真横、正=下、負=上（ラケット腕）
  let racketLen = 0.62 * s;
  if (pl.pose === "swing" && pl.swingT > 0) {
    const k = 1 - pl.swingT / 0.32; // 0→1
    armAngle = (-0.9 + k * 1.7);    // 引き→振り抜き
  } else if (pl.pose === "ready") {
    armAngle = -0.55;               // テイクバック
  } else if (pl.pose === "serve") {
    armAngle = -1.5;                // 上に構える
  } else {
    armAngle = 0.6;                 // だらんと下げる
  }

  const armX = sideDir * Math.cos(armAngle);
  const armY = Math.sin(armAngle);
  const handX = sideDir * 0.3 * s * Math.abs(Math.cos(armAngle)) + sideDir * 0.06 * s;
  const handY = shoulderY + 0.3 * s * armY;

  // 反対の腕
  ctx.strokeStyle = pl.skin;
  ctx.lineWidth = Math.max(1.5, 0.08 * s);
  ctx.beginPath();
  ctx.moveTo(-sideDir * tw * 0.4, shoulderY);
  ctx.lineTo(-sideDir * 0.34 * s, shoulderY + 0.26 * s);
  ctx.stroke();

  // ラケット腕
  ctx.beginPath();
  ctx.moveTo(sideDir * tw * 0.4, shoulderY);
  ctx.lineTo(handX, handY);
  ctx.stroke();

  // ラケット（グリップ→ヘッド）
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

  // 頭（正面=顔、背面=髪）
  ctx.fillStyle = pl.skin;
  ctx.beginPath();
  ctx.arc(0, headCy, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3B2A1E";
  if (pl.facing === -1) {
    // 背面: 後頭部の髪
    ctx.beginPath();
    ctx.arc(0, headCy, headR, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, headCy - headR * 0.2, headR * 0.98, headR * 0.78, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  } else {
    // 正面: 前髪と目
    ctx.beginPath();
    ctx.ellipse(0, headCy - headR * 0.45, headR * 0.95, headR * 0.55, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1F2937";
    ctx.beginPath();
    ctx.arc(-headR * 0.35, headCy + headR * 0.05, Math.max(0.8, headR * 0.13), 0, Math.PI * 2);
    ctx.arc(headR * 0.35, headCy + headR * 0.05, Math.max(0.8, headR * 0.13), 0, Math.PI * 2);
    ctx.fill();
  }

  // ラベル
  if (pl.label) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "600 " + Math.max(8, 0.28 * s) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(pl.label, 0, headCy - headR - 0.1 * s);
  }

  // フォア/バックの構えインジケータ（操作キャラのみ）
  if (pl === back && pl.pose === "ready") {
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

  // 打てるタイミングの足元リング（操作キャラのみ）
  if (pl === back && state === "rally" && canPlayerHit()) {
    const pr = project(back.x, back.y, 0);
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
      serveRight: serveFromRight(),
      ball: { x: ball.x, y: ball.y, z: ball.z, bounces: ball.bounces, serving: ball.serving, lastHitter: ball.lastHitter },
      back: { x: back.x, y: back.y },
      cpuBack: { x: cpuBack.x, y: cpuBack.y },
    };
  },
  setBackX: setBackX,
  hit: tryPlayerHit,
};
