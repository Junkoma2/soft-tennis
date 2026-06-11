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

const W = 360;
const H = 540;
const NET_Y = H / 2;
const RACKET_W = 64;
const RACKET_H = 10;
const BALL_R = 7;
const PLAYER_Y = H - 28;
const CPU_Y = 28;

const POINT_LABELS = ["0", "15", "30", "40"];

const POINTS_TO_WIN_GAME = 4;
const GAMES_TO_WIN_MATCH = 3;

let state = "ready";
let player = { x: W / 2, points: 0, games: 0 };
let cpu = { x: W / 2, points: 0, games: 0 };
let ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
let serverIsPlayer = true;
let rafId = null;
let pointerActive = false;

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
    return points > opponentPoints ? "アド" : "40";
  }
  return POINT_LABELS[Math.min(points, 3)];
}

function updateScoreboard() {
  playerScoreEl.textContent = pointLabel(player.points, cpu.points);
  cpuScoreEl.textContent = pointLabel(cpu.points, player.points);
  playerGamesEl.textContent = player.games;
  cpuGamesEl.textContent = cpu.games;
}

function resetPositions() {
  player.x = W / 2;
  cpu.x = W / 2;
  ball.x = W / 2;
  ball.vx = 0;
  ball.vy = 0;
}

function startMatch() {
  player.points = 0;
  player.games = 0;
  cpu.points = 0;
  cpu.games = 0;
  serverIsPlayer = true;
  resetPositions();
  updateScoreboard();
  showScreen("game");
  startServe();
}

function startServe() {
  resetPositions();
  hideMessage();
  state = "serve";
  if (serverIsPlayer) {
    ball.x = player.x;
    ball.y = PLAYER_Y - 16;
    showMessage("自分のサーブ\nタップで打つ");
  } else {
    ball.x = cpu.x;
    ball.y = CPU_Y + 16;
    showMessage("CPUのサーブ");
    setTimeout(function () {
      if (state === "serve" && !serverIsPlayer) {
        launchServe(false);
      }
    }, 900);
  }
}

function launchServe(byPlayer) {
  if (state !== "serve") return;
  hideMessage();
  state = "rally";
  const speed = 4.4;
  const angle = (Math.random() - 0.5) * 0.6;
  if (byPlayer) {
    ball.vx = Math.sin(angle) * speed;
    ball.vy = -Math.cos(angle) * speed;
  } else {
    ball.vx = Math.sin(angle) * speed;
    ball.vy = Math.cos(angle) * speed;
  }
}

function awardPoint(toPlayer) {
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
  showMessage(toPlayer ? "ポイント！" : "CPUのポイント");

  const totalPoints = player.points + cpu.points;
  if (totalPoints % 2 === 0) {
    serverIsPlayer = !serverIsPlayer;
  }

  setTimeout(function () {
    if (state === "point") startServe();
  }, 1100);
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
    }, 1100);
    return;
  }

  state = "gameset";
  showMessage(playerWon ? "ゲーム獲得！" : "ゲームを落とした");
  serverIsPlayer = !serverIsPlayer;
  setTimeout(function () {
    if (state === "gameset") startServe();
  }, 1300);
}

function endMatch(playerWon) {
  cancelAnimationFrame(rafId);
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

const KEY_SPEED = 6;
const keys = { left: false, right: false };

function setPlayerX(x) {
  const half = RACKET_W / 2;
  player.x = Math.max(half, Math.min(W - half, x));
}

document.addEventListener("keydown", function (e) {
  if (e.code === "ArrowLeft") keys.left = true;
  if (e.code === "ArrowRight") keys.right = true;
  if (e.code === "Space") {
    e.preventDefault();
    if (state === "serve" && serverIsPlayer) launchServe(true);
  }
});

document.addEventListener("keyup", function (e) {
  if (e.code === "ArrowLeft") keys.left = false;
  if (e.code === "ArrowRight") keys.right = false;
});

function canvasXFromClient(clientX) {
  const rect = canvas.getBoundingClientRect();
  const ratio = W / rect.width;
  return (clientX - rect.left) * ratio;
}

canvas.addEventListener("mousemove", function (e) {
  if (screens.game.hidden) return;
  setPlayerX(canvasXFromClient(e.clientX));
});

canvas.addEventListener("pointerdown", function (e) {
  pointerActive = true;
  setPlayerX(canvasXFromClient(e.clientX));
  if (state === "serve" && serverIsPlayer) launchServe(true);
});

canvas.addEventListener("pointermove", function (e) {
  if (!pointerActive) return;
  setPlayerX(canvasXFromClient(e.clientX));
});

window.addEventListener("pointerup", function () {
  pointerActive = false;
});

canvas.addEventListener("touchmove", function (e) {
  e.preventDefault();
  const touch = e.touches[0];
  if (touch) setPlayerX(canvasXFromClient(touch.clientX));
}, { passive: false });

canvas.addEventListener("click", function () {
  if (state === "serve" && serverIsPlayer) launchServe(true);
});

function updateCpu() {
  const targetX = ball.vy < 0 ? cpu.x : ball.x;
  const diff = targetX - cpu.x;
  const cpuSpeed = 3.1;
  if (Math.abs(diff) > 1) {
    cpu.x += Math.sign(diff) * Math.min(cpuSpeed, Math.abs(diff));
  }
  const half = RACKET_W / 2;
  cpu.x = Math.max(half, Math.min(W - half, cpu.x));
}

function update() {
  if (keys.left) setPlayerX(player.x - KEY_SPEED);
  if (keys.right) setPlayerX(player.x + KEY_SPEED);

  if (state !== "rally") {
    updateCpu();
    return;
  }

  ball.x += ball.vx;
  ball.y += ball.vy;

  if (ball.x - BALL_R < 0) {
    ball.x = BALL_R;
    ball.vx *= -1;
  } else if (ball.x + BALL_R > W) {
    ball.x = W - BALL_R;
    ball.vx *= -1;
  }

  updateCpu();

  if (ball.vy > 0 && ball.y + BALL_R >= PLAYER_Y) {
    if (Math.abs(ball.x - player.x) <= RACKET_W / 2 + BALL_R) {
      const offset = (ball.x - player.x) / (RACKET_W / 2);
      ball.vy = -Math.abs(ball.vy) * 1.03;
      ball.vx = offset * 4.2;
      ball.y = PLAYER_Y - BALL_R;
      const maxSpeed = 8;
      const speed = Math.hypot(ball.vx, ball.vy);
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        ball.vx *= scale;
        ball.vy *= scale;
      }
    } else if (ball.y - BALL_R > H) {
      awardPoint(false);
    }
  }

  if (ball.vy < 0 && ball.y - BALL_R <= CPU_Y) {
    if (Math.abs(ball.x - cpu.x) <= RACKET_W / 2 + BALL_R) {
      const offset = (ball.x - cpu.x) / (RACKET_W / 2);
      ball.vy = Math.abs(ball.vy) * 1.03;
      ball.vx = offset * 3.6 + (Math.random() - 0.5) * 1.2;
      ball.y = CPU_Y + BALL_R;
      const maxSpeed = 8;
      const speed = Math.hypot(ball.vx, ball.vy);
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        ball.vx *= scale;
        ball.vy *= scale;
      }
    } else if (ball.y + BALL_R < 0) {
      awardPoint(true);
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = "#34A853";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, W - 16, H - 16);

  ctx.beginPath();
  ctx.setLineDash([6, 6]);
  ctx.moveTo(8, NET_Y);
  ctx.lineTo(W - 8, NET_Y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeRect(8, H * 0.18, W - 16, H * 0.32);
  ctx.strokeRect(8, H * 0.5, W - 16, H * 0.32);

  ctx.beginPath();
  ctx.moveTo(W / 2, H * 0.18);
  ctx.lineTo(W / 2, H * 0.5);
  ctx.moveTo(W / 2, H * 0.5);
  ctx.lineTo(W / 2, H * 0.82);
  ctx.stroke();

  ctx.fillStyle = "#1E1B4B";
  drawRoundedRect(cpu.x - RACKET_W / 2, CPU_Y - RACKET_H / 2, RACKET_W, RACKET_H, 4);

  ctx.fillStyle = "#6366F1";
  drawRoundedRect(player.x - RACKET_W / 2, PLAYER_Y - RACKET_H / 2, RACKET_W, RACKET_H, 4);

  ctx.fillStyle = "#DFFF4F";
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(30,27,75,0.3)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawRoundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
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
