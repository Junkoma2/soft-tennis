/* ===========================================================
 * ソフトテニス ダブルス（雁行陣）ラリーゲーム
 *
 * コート座標系:
 *   cx: -1.0(左サイドライン) 〜 1.0(右サイドライン), 0が中央
 *   cy: 0(自陣ベースライン) 〜 1(相手陣ベースライン), 0.5がネット
 *   cz: ボールの高さ（0が地面、ネットの高さは NET_HEIGHT）
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

const POINT_LABELS = ["0", "1", "2", "3"];
const POINTS_TO_WIN_GAME = 4;
const GAMES_TO_WIN_MATCH = 3;

const NET_HEIGHT = 0.15;
const TOP_MARGIN = H * 0.08;
const BOTTOM_MARGIN = H * 0.06;
const COURT_TOP_Y = TOP_MARGIN;
const COURT_BOTTOM_Y = H - BOTTOM_MARGIN;
const COURT_TOP_HALF_W = W * 0.22;
const COURT_BOTTOM_HALF_W = W * 0.46;
const NET_CY = 0.5;

function projY(cy) {
  return COURT_TOP_Y + cy * (COURT_BOTTOM_Y - COURT_TOP_Y);
}
function halfWidthAt(cy) {
  return COURT_TOP_HALF_W + cy * (COURT_BOTTOM_HALF_W - COURT_TOP_HALF_W);
}
function projX(cx, cy) {
  return W / 2 + cx * halfWidthAt(cy);
}
function scaleAt(cy) {
  return 0.55 + cy * 0.65;
}
function heightOffsetPx(cz, cy) {
  return cz * 220 * scaleAt(cy);
}

let state = "ready";
let serverTeam = "player";
let player = { games: 0, points: 0 };
let cpu = { games: 0, points: 0 };
let rafId = null;
let pointerActive = false;
let pointerCx = 0;

const back = {
  cx: 0,
  cy: 0.92,
};
const front = {
  cx: 0.5,
  cy: 0.58,
};
const cpuBack = {
  cx: 0,
  cy: 0.06,
};
const cpuFront = {
  cx: -0.5,
  cy: 0.42,
};

const PLAYER_REACH = 0.34;
const FRONT_REACH = 0.30;

let ball = {
  cx: 0, cy: 0.92, cz: 0,
  vx: 0, vy: 0, vz: 0,
  spin: 0,
  lastHitter: "cpu", // 直前にボールを打った側（次に拾うべき側の判定に使う）
};

const GRAVITY = -0.0026;

let selectedCourse = "middle";
let selectedShot = "drive";
let selectedServe = "cut";

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

function pointLabel(points, opponentPoints) {
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
  if (state === "serve" && serverTeam === "player") {
    launchServe();
  }
});

function setActiveButton(group, activeBtn) {
  group.querySelectorAll(".ctrl-btn").forEach((b) => b.classList.remove("is-active"));
  activeBtn.classList.add("is-active");
}

function resetPositions() {
  back.cx = 0;
  front.cx = 0.5;
  front.cy = 0.58;
  cpuBack.cx = 0;
  cpuFront.cx = -0.5;
  cpuFront.cy = 0.42;
  ball.vx = 0;
  ball.vy = 0;
  ball.vz = 0;
}

function startMatch() {
  player.points = 0;
  player.games = 0;
  cpu.points = 0;
  cpu.games = 0;
  serverTeam = "player";
  resetPositions();
  updateScoreboard();
  showScreen("game");
  startServe();
}

function startServe() {
  resetPositions();
  hideMessage();
  state = "serve";

  if (serverTeam === "player") {
    serveControls.hidden = false;
    ball.cx = back.cx;
    ball.cy = 0.96;
    ball.cz = 0.02;
    hintText.textContent = "サーブ方式を選んでタップ／スペースで打つ";
    showMessage("自分のサーブ");
  } else {
    serveControls.hidden = true;
    hintText.textContent = "ドラッグまたは矢印キーで構える";
    ball.cx = cpuBack.cx;
    ball.cy = 0.04;
    ball.cz = 0.02;
    showMessage("相手のサーブ");
    setTimeout(function () {
      if (state === "serve" && serverTeam === "cpu") {
        launchCpuServe();
      }
    }, 900);
  }
}

function launchServe() {
  if (state !== "serve" || serverTeam !== "player") return;
  hideMessage();
  state = "rally";
  serveControls.hidden = true;
  hintText.textContent = "コースと球種を選んでタップ／スペースで打つ";

  const targetCx = courseTargetCx(selectedCourse, back.cx, "player");
  const targetCy = 0.06 + Math.random() * 0.10;

  ball.lastHitter = "player";
  if (selectedServe === "power") {
    aimBall(ball, targetCx, targetCy, 0.22, 0.046);
    if (Math.random() < 0.16) {
      ball.vx *= 1.7;
    }
  } else {
    aimBall(ball, targetCx, targetCy, 0.19, 0.030);
    ball.spin = -1;
  }
}

function launchCpuServe() {
  hideMessage();
  state = "rally";
  hintText.textContent = "ドラッグまたは矢印キーで構える";

  const targetCx = (Math.random() - 0.5) * 1.4;
  const targetCy = 0.84 + Math.random() * 0.10;
  const useCut = Math.random() < 0.5;

  ball.lastHitter = "cpu";
  if (useCut) {
    aimBall(ball, targetCx, targetCy, 0.19, 0.028);
    ball.spin = -1;
  } else {
    aimBall(ball, targetCx, targetCy, 0.22, 0.044);
  }
}

function aimBall(b, targetCx, targetCy, peakHeight, speedXY) {
  const dx = targetCx - b.cx;
  const dy = targetCy - b.cy;
  const dist = Math.max(0.05, Math.hypot(dx, dy));
  const dirX = dx / dist;
  const dirY = dy / dist;

  // 頂点高さpeakHeightに到達するために必要な初速vz0と滞空時間T
  const g = Math.abs(GRAVITY);
  const vz0 = Math.sqrt(2 * g * peakHeight);
  const flightTime = (2 * vz0) / g;

  // 距離distを滞空時間内に進むための水平速度。speedXYは下限の目安として使う。
  const neededSpeed = dist / flightTime;
  const finalSpeed = Math.max(speedXY, neededSpeed);
  const finalFlightTime = dist / finalSpeed;

  b.vx = dirX * finalSpeed;
  b.vy = dirY * finalSpeed;
  b.vz = (g * finalFlightTime) / 2;
}

function courseTargetCx(course, hitterCx, side) {
  let target;
  if (course === "cross") {
    target = hitterCx > 0 ? -0.85 : 0.85;
  } else if (course === "straight") {
    target = hitterCx > 0 ? 0.85 : -0.85;
  } else {
    target = (Math.random() - 0.5) * 0.5;
  }
  return Math.max(-0.95, Math.min(0.95, target));
}

function isBackhand(hitterCx, ballCx) {
  return ballCx < hitterCx - 0.02;
}

function awardPoint(toPlayer, reason) {
  if (toPlayer) {
    player.points++;
  } else {
    cpu.points++;
  }

  const pP = player.points;
  const cP = cpu.points;
  if (pP >= POINTS_TO_WIN_GAME && pP - cP >= 2) {
    finishGame(true);
    return;
  }
  if (cP >= POINTS_TO_WIN_GAME && cP - pP >= 2) {
    finishGame(false);
    return;
  }

  updateScoreboard();
  state = "point";
  showMessage((toPlayer ? "ポイント！" : "相手のポイント") + (reason ? "\n" + reason : ""));

  const totalPoints = player.points + cpu.points;
  if (totalPoints % 2 === 0) {
    serverTeam = serverTeam === "player" ? "cpu" : "player";
  }

  setTimeout(function () {
    if (state === "point") startServe();
  }, 1300);
}

function finishGame(playerWon) {
  if (playerWon) {
    player.games++;
  } else {
    cpu.games++;
  }
  player.points = 0;
  cpu.points = 0;
  updateScoreboard();

  if (player.games >= GAMES_TO_WIN_MATCH || cpu.games >= GAMES_TO_WIN_MATCH) {
    state = "matchend";
    showMessage(playerWon ? "ゲーム獲得！" : "ゲームを落とした");
    setTimeout(function () {
      endMatch(player.games >= GAMES_TO_WIN_MATCH);
    }, 1300);
    return;
  }

  state = "gameset";
  showMessage(playerWon ? "ゲーム獲得！" : "ゲームを落とした");
  serverTeam = serverTeam === "player" ? "cpu" : "player";
  setTimeout(function () {
    if (state === "gameset") startServe();
  }, 1400);
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

const KEY_SPEED = 0.022;
const keys = { left: false, right: false };

function setBackCx(cx) {
  back.cx = Math.max(-0.95, Math.min(0.95, cx));
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

function tryPlayerHit() {
  if (state === "serve" && serverTeam === "player") {
    launchServe();
  } else if (state === "rally" && canPlayerHit()) {
    playerHitBall();
  }
}

function canvasCxFromClient(clientX) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (W / rect.width);
  const baseHalf = halfWidthAt(back.cy);
  return (x - W / 2) / baseHalf;
}

canvas.addEventListener("pointerdown", function (e) {
  pointerActive = true;
  pointerCx = canvasCxFromClient(e.clientX);
  setBackCx(pointerCx);
  tryPlayerHit();
});

canvas.addEventListener("pointermove", function (e) {
  if (!pointerActive) return;
  setBackCx(canvasCxFromClient(e.clientX));
});

window.addEventListener("pointerup", function () {
  pointerActive = false;
});

canvas.addEventListener("touchmove", function (e) {
  e.preventDefault();
  const touch = e.touches[0];
  if (touch) setBackCx(canvasCxFromClient(touch.clientX));
}, { passive: false });

function canPlayerHit() {
  if (ball.vy <= 0) return false;
  if (ball.cy < 0.78) return false;
  if (Math.abs(ball.cx - back.cx) > PLAYER_REACH) return false;
  if (ball.cz > 0.22) return false;
  return true;
}

function playerHitBall() {
  hitBall({
    hitterCx: back.cx,
    side: "player",
    course: selectedCourse,
    shot: selectedShot,
    fromCy: back.cy,
  });
}

function hitBall(opts) {
  const hitterCx = opts.hitterCx;
  const side = opts.side;
  const course = opts.course;
  const shot = opts.shot;
  const fromCy = opts.fromCy;

  const backhand = isBackhand(hitterCx, ball.cx);
  const power = backhand ? 0.85 : 1.0;
  const accuracy = backhand ? 0.55 : 0.95;

  let targetCx = courseTargetCx(course, hitterCx, side);
  targetCx += (Math.random() - 0.5) * (1 - accuracy) * 1.2;
  targetCx = Math.max(-0.95, Math.min(0.95, targetCx));

  const targetCyBase = side === "player" ? 0.04 + Math.random() * 0.10 : 0.86 + Math.random() * 0.10;

  ball.cy = fromCy;
  ball.spin = 0;
  ball.lastHitter = side;

  if (shot === "lob") {
    aimBall(ball, targetCx, targetCyBase, 0.46, 0.022 * power);
  } else {
    aimBall(ball, targetCx, targetCyBase, 0.20, 0.038 * power);
    ball.spin = backhand ? 0.4 : 0;
  }
}

function updateFront() {
  if (state === "rally" && ball.vy < 0) {
    const target = back.cx > 0 ? -0.35 : 0.35;
    front.cx += (target - front.cx) * 0.04;
  } else {
    front.cx += (back.cx * -0.4 - front.cx) * 0.03;
  }
  front.cx = Math.max(-0.9, Math.min(0.9, front.cx));
  front.cy += (0.58 - front.cy) * 0.05;
}

function updateCpuBack() {
  if (state === "rally" && ball.vy > 0) {
    const target = ball.cx;
    cpuBack.cx += (target - cpuBack.cx) * 0.045;
  } else {
    cpuBack.cx += (0 - cpuBack.cx) * 0.02;
  }
  cpuBack.cx = Math.max(-0.95, Math.min(0.95, cpuBack.cx));
}

function updateCpuFront() {
  if (state === "rally" && ball.vy < 0) {
    const predicted = predictBallCxAtCy(0.42);
    cpuFront.cx += (predicted * 0.7 - cpuFront.cx) * 0.05;
  } else {
    cpuFront.cx += (-0.5 - cpuFront.cx) * 0.03;
  }
  cpuFront.cx = Math.max(-0.9, Math.min(0.9, cpuFront.cx));
  cpuFront.cy += (0.42 - cpuFront.cy) * 0.05;
}

function predictBallCxAtCy(targetCy) {
  if (Math.abs(ball.vy) < 0.0001) return ball.cx;
  const t = (targetCy - ball.cy) / ball.vy;
  if (t < 0) return ball.cx;
  return ball.cx + ball.vx * t;
}

function cpuReturnBall() {
  const frontReach = Math.abs(ball.cx - cpuFront.cx) <= FRONT_REACH && ball.cz < 0.16 && ball.cy <= 0.50;
  const hitterCx = frontReach ? cpuFront.cx : cpuBack.cx;
  const fromCy = frontReach ? cpuFront.cy : cpuBack.cy;
  const courseChoices = ["cross", "middle", "straight"];
  const course = courseChoices[Math.floor(Math.random() * courseChoices.length)];
  const shot = Math.random() < 0.7 ? "drive" : "lob";

  hitBall({
    hitterCx: hitterCx,
    side: "cpu",
    course: course,
    shot: shot,
    fromCy: fromCy,
  });

  if (frontReach) {
    showMessage("相手前衛のカット！");
    setTimeout(function () {
      if (state === "rally") hideMessage();
    }, 600);
  }
}

function update() {
  if (keys.left) setBackCx(back.cx - KEY_SPEED);
  if (keys.right) setBackCx(back.cx + KEY_SPEED);

  if (state !== "rally") {
    updateFront();
    updateCpuBack();
    updateCpuFront();
    return;
  }

  ball.cx += ball.vx;
  ball.cy += ball.vy;
  ball.cz += ball.vz;
  ball.vz += GRAVITY;

  if (ball.spin < 0 && ball.cz <= 0 && ball.vz < 0) {
    ball.vz *= 0.25;
    ball.vy *= 1.05;
  }

  updateFront();
  updateCpuBack();
  updateCpuFront();

  // ヒットした側からみて、ミス＝相手の得点
  const hitterIsPlayer = ball.lastHitter === "player";

  if (Math.abs(ball.cx) > 1.05) {
    awardPoint(!hitterIsPlayer, "アウト");
    return;
  }

  // プレイヤー側ベースラインを越えて通過（CPU打球をプレイヤーが拾えなかった）
  if (ball.vy > 0 && ball.cy >= 1.05) {
    awardPoint(false, "拾えなかった");
    return;
  }

  // 相手側ベースラインを越えて通過（プレイヤー打球をCPUが拾えなかった）
  if (ball.vy < 0 && ball.cy <= -0.05) {
    awardPoint(true, "相手が拾えなかった");
    return;
  }

  // ネットにかかった場合は、打った側の相手の得点
  if (ball.vy > 0 && ball.cy >= NET_CY && ball.cy - ball.vy <= NET_CY) {
    if (ball.cz < NET_HEIGHT) {
      awardPoint(!hitterIsPlayer, hitterIsPlayer ? "ネット" : "相手のネット");
      return;
    }
  }
  if (ball.vy < 0 && ball.cy <= NET_CY && ball.cy - ball.vy >= NET_CY) {
    if (ball.cz < NET_HEIGHT) {
      awardPoint(!hitterIsPlayer, hitterIsPlayer ? "ネット" : "相手のネット");
      return;
    }
  }

  if (
    ball.vy < 0 &&
    ball.cy >= 0.30 && ball.cy <= 0.50 &&
    ball.cz < 0.14 &&
    Math.abs(ball.cx - cpuFront.cx) <= FRONT_REACH
  ) {
    awardPoint(false, "前衛にカットされた");
    return;
  }

  if (
    ball.vy > 0 &&
    ball.cy >= 0.50 && ball.cy <= 0.70 &&
    ball.cz < 0.14 &&
    Math.abs(ball.cx - front.cx) <= FRONT_REACH &&
    Math.random() < 0.5
  ) {
    hitBall({
      hitterCx: front.cx,
      side: "player",
      course: ["cross", "middle", "straight"][Math.floor(Math.random() * 3)],
      shot: Math.random() < 0.6 ? "drive" : "lob",
      fromCy: front.cy,
    });
    showMessage("前衛ボレー！");
    setTimeout(function () { if (state === "rally") hideMessage(); }, 600);
    return;
  }

  if (
    ball.vy < 0 &&
    ball.cy <= 0.22 && ball.cy >= 0.02 &&
    Math.abs(ball.cx - cpuBack.cx) <= PLAYER_REACH &&
    ball.cz < 0.30
  ) {
    cpuReturnBall();
    return;
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawCourt();
  drawPlayers();
  drawBall();
}

function drawCourt() {
  ctx.fillStyle = "#1f7a3f";
  ctx.fillRect(0, 0, W, H);

  const topY = projY(0);
  const bottomY = projY(1);
  const topHalf = halfWidthAt(0);
  const bottomHalf = halfWidthAt(1);

  ctx.fillStyle = "#34A853";
  ctx.beginPath();
  ctx.moveTo(W / 2 - topHalf, topY);
  ctx.lineTo(W / 2 + topHalf, topY);
  ctx.lineTo(W / 2 + bottomHalf, bottomY);
  ctx.lineTo(W / 2 - bottomHalf, bottomY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(W / 2, topY);
  ctx.lineTo(W / 2, bottomY);
  ctx.stroke();

  ctx.beginPath();
  ctx.setLineDash([5, 4]);
  ctx.moveTo(W / 2 - halfWidthAt(NET_CY), projY(NET_CY));
  ctx.lineTo(W / 2 + halfWidthAt(NET_CY), projY(NET_CY));
  ctx.stroke();
  ctx.setLineDash([]);

  drawHorizontalLine(0.30);
  drawHorizontalLine(0.70);
}

function drawHorizontalLine(cy) {
  ctx.beginPath();
  ctx.moveTo(W / 2 - halfWidthAt(cy), projY(cy));
  ctx.lineTo(W / 2 + halfWidthAt(cy), projY(cy));
  ctx.stroke();
}

function drawFigure(cx, cy, color, label) {
  const x = projX(cx, cy);
  const y = projY(cy);
  const scale = scaleAt(cy);
  const r = 6 * scale;
  const bodyH = 16 * scale;

  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 2, r * 1.3, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, 2.5 * scale);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.4);
  ctx.lineTo(0, -r * 0.4 - bodyH);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-r * 1.4, -r * 0.4 - bodyH * 0.7);
  ctx.lineTo(r * 1.4, -r * 0.4 - bodyH * 0.7);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, -r * 0.4 - bodyH - r, r, 0, Math.PI * 2);
  ctx.fill();

  if (label) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = (9 * Math.max(scale, 0.7)) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, 0, -r * 0.4 - bodyH - r * 2 - 2);
  }

  ctx.restore();
}

function drawPlayers() {
  drawFigure(cpuBack.cx, cpuBack.cy, "#1E1B4B", "相手後衛");
  drawFigure(cpuFront.cx, cpuFront.cy, "#4338CA", "相手前衛");
  drawFigure(front.cx, front.cy, "#A5B4FC", "前衛");
  drawFigure(back.cx, back.cy, "#6366F1", "あなた");
}

function drawBall() {
  const groundX = projX(ball.cx, ball.cy);
  const groundY = projY(ball.cy);
  const scale = scaleAt(ball.cy);
  const r = Math.max(2, 5 * scale);

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(groundX, groundY, r * 1.1, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  const offset = heightOffsetPx(ball.cz, ball.cy);
  const ballR = r * (1 + Math.min(ball.cz, 0.5) * 1.2);

  ctx.fillStyle = "#DFFF4F";
  ctx.beginPath();
  ctx.arc(groundX, groundY - offset, ballR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(30,27,75,0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function loop() {
  update();
  draw();
  rafId = requestAnimationFrame(loop);
}

startBtn.addEventListener("click", function () {
  startMatch();
  if (!rafId) loop();
});

retryBtn.addEventListener("click", function () {
  showScreen("ready");
  cancelAnimationFrame(rafId);
  rafId = null;
});

draw();