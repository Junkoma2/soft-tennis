import {
  TUNING, COURT, W, H, G, HIT_REACH, CPU_REACH, VOLLEY_REACH, SHOT_FAMILY_META,
} from "./config.js";

import {
  project, roundRect,
} from "./math.js";

import {
  ctx, serveAimCursor, aim, charge, toss, rallyControlled, ball, effects,
  state, spectatorMode, cpuServePlan, serveReady,
  back, front, cpuBack, cpuFront, matchTime, serveCategory,
  player, cpu,
  debugDraw,
} from "./state.js";

import {
  playerIsServer, serverTeamNow, currentServer, serviceBox,
} from "./serve.js";

import { courseLabelFor, insideCourt, insideBox, predictLanding, predictHighContact, chargeAmount, pointLabel } from "./main.js";
import { canPlayerHit } from "./input.js";
import { hitLineInfo } from "./hit-detection.js";
import { opponentHitterPos, netPlayerOf, basePlayerOf } from "./aiPositioning.js";

/* ===========================================================
 * 描画
 * =========================================================== */

export function draw() {
  ctx.clearRect(0, 0, W, H);
  drawBackground();
  drawCourt();
  drawDebugCoverage();
  drawLandingMarker();
  drawAimCursor();
  drawGroundEffects();
  drawDebugTrajectory();
  drawDebugHitboxes();
  drawBallShadow();

  // キャラクターは3Dオーバーレイ（player3d.js）が描画する。ここでは場の要素のみ。
  const items = [
    { y: 0, fn: drawNet },
    { y: ball.y, fn: drawBall },
  ];
  items.sort(function (a, b) { return a.y - b.y; });
  items.forEach(function (it) { it.fn(); });

  drawTextEffects();
  drawServeTypeBadge();
  drawTimingGauge();
  drawHud();
  drawScore();
  drawControlLegend();
  drawDebugParams();
}

/* ===========================================================
 * デバッグ: 守備範囲の可視化
 *
 * 相手の打点 O から「打てるコースの幅」（自陣シングルスコート両隅への2辺）を引き、
 * その角の二等分線を自陣ベースラインまで引く。二等分線で自陣を2分割し、
 * ストレート側（ネット担当=青）とクロス側（後方担当=赤）に塗り分ける。
 * 各ゾーンの中央（その選手の深さでの左右中央）が理想ポジション＝リングで表示。
 * 雁行の「前衛がストレートを締め、後衛がクロスを守る」を幾何的に確認できる。
 * =========================================================== */
function drawDebugCoverage() {
  if (!debugDraw.coverage) return;
  if (state === "ready") return;
  drawCoverageForSide("player");
  drawCoverageForSide("cpu");
}

function covNorm(x, y) { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; }

function covFillZone(pts, fill, stroke) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = project(p[0], p[1], 0);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
}

function covStrokeLine(x1, y1, x2, y2, color, w) {
  const a = project(x1, y1, 0), b = project(x2, y2, 0);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
}

function covMarker(x, y, color) {
  const s = project(x, y, 0);
  ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
}

function drawCoverageForSide(side) {
  const homeSign = side === "player" ? 1 : -1;
  const O = opponentHitterPos(side);             // 相手の打点
  const Xw = COURT.halfW;                          // ダブルスサイドライン（実際に打てる横幅）
  const yBase = homeSign * COURT.halfL;            // 自陣ベースライン
  const yNet = 0;
  if (Math.abs(yBase - O.y) < 1) return;
  // その瞬間に打てる範囲＝最も鋭いコースはネット際のサイド隅（ベースライン隅より角度が鋭い）。
  // 相手打点 O から自陣のネット際両隅 (±Xw, 0) への2辺が打てるコースの角度幅になる。
  const NL = { x: -Xw, y: yNet };
  const NR = { x:  Xw, y: yNet };
  const uL = covNorm(NL.x - O.x, NL.y - O.y);
  const uR = covNorm(NR.x - O.x, NR.y - O.y);
  const d = { x: uL.x + uR.x, y: uL.y + uR.y };     // 角の二等分線方向
  const clampX = (x) => Math.max(-Xw, Math.min(Xw, x));
  const bisX = (y) => clampX(Math.abs(d.y) < 1e-4 ? O.x : O.x + (y - O.y) / d.y * d.x);

  const xB0 = bisX(yNet), xBb = bisX(yBase);

  // 自陣コート矩形（ネット〜ベースライン）を二等分線で左右に分割する。
  const leftZone  = [ [-Xw, yNet], [xB0, yNet], [xBb, yBase], [-Xw, yBase] ];
  const rightZone = [ [xB0, yNet], [ Xw, yNet], [ Xw, yBase], [xBb, yBase] ];

  // ストレート側＝相手打点と同じx符号側。ネット担当がストレートを締める。
  const straightSign = O.x >= 0 ? 1 : -1;
  const frontZone = straightSign > 0 ? rightZone : leftZone;
  const backZone  = straightSign > 0 ? leftZone  : rightZone;

  covFillZone(frontZone, "rgba(37,99,235,0.20)", "rgba(37,99,235,0.55)");
  covFillZone(backZone,  "rgba(220,38,38,0.20)", "rgba(220,38,38,0.55)");

  // 打てるコースの角度幅（ネット際の鋭い隅まで）と、その二等分線（自陣ベースラインまで）。
  covStrokeLine(O.x, O.y, NL.x, NL.y, "rgba(255,255,255,0.85)", 1.5);
  covStrokeLine(O.x, O.y, NR.x, NR.y, "rgba(255,255,255,0.85)", 1.5);
  covStrokeLine(O.x, O.y, xBb, yBase, "rgba(250,204,21,0.95)", 2);

  // 理想ポジション（各ゾーンの左右中央）を各選手の深さで表示する。
  const netP = netPlayerOf(side), baseP = basePlayerOf(side);
  const frontCenter = straightSign > 0 ? (bisX(netP.y) + Xw) / 2 : (-Xw + bisX(netP.y)) / 2;
  const backCenter  = straightSign > 0 ? (-Xw + bisX(baseP.y)) / 2 : (bisX(baseP.y) + Xw) / 2;
  covMarker(frontCenter, netP.y, "rgba(37,99,235,0.95)");
  covMarker(backCenter,  baseP.y, "rgba(220,38,38,0.95)");
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
  // スコアを上部中央に描くようになったため、操作レジェンドは左上隅へ寄せて
  // スコアと被らないようにする。
  const bx = 10, by = 8;

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
    // パワー/回転は内部値にしたため表示しない。サーブの種類（オーバー/アンダー）だけ示す。
    const text = serveCategory === "under" ? "アンダーサーブ" : "オーバーサーブ";
    const boxW = 140;
    const bx = (W - boxW) / 2, by = 62;
    ctx.fillStyle = "rgba(30,27,75,0.55)";
    roundRect(ctx, bx, by, boxW, 22, 6);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, bx + boxW / 2, by + 15);
    // レシーバーの準備状態（準備が整うまでトス不可）
    ctx.fillStyle = serveReady.ready ? "rgba(16,185,129,0.9)" : "rgba(255,255,255,0.7)";
    ctx.font = "600 9px sans-serif";
    ctx.fillText(serveReady.ready ? "レシーバー準備OK" : "レシーバー準備中…", bx + boxW / 2, by + 34);
    return;
  }

  // 相手サーブ: 種類を打つ前に表示（前へ詰める判断の時間を確保する）
  if ((state === "serve-stance" || state === "serve-toss") &&
      serverTeamNow() === "cpu" && cpuServePlan) {
    const tcfg = TUNING.serve.types[cpuServePlan.type];
    const text = "相手サーブ: " + tcfg.label;
    const boxW = 158;
    const bx = (W - boxW) / 2, by = 62;
    ctx.fillStyle = "rgba(30,27,75,0.55)";
    roundRect(ctx, bx, by, boxW, 22, 6);
    ctx.fill();
    ctx.fillStyle = tcfg.color;
    ctx.font = "700 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, bx + boxW / 2, by + 15);
    if (state === "serve-stance" && !serveReady.ready) {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "600 9px sans-serif";
      ctx.fillText("静止するとサーブが来る", bx + boxW / 2, by + 34);
    }
    return;
  }
}

// スコアをキャンバス上部（空の領域）に描画する。HTMLのヘッダ枠を作らず、
// コートの上方にそのまま重ねて表示する（中継のスコアテロップ風）。
export function drawScore() {
  if (state === "ready") return;
  const sc = W / 1280;           // 解像度に応じた拡縮
  const cx = W / 2;
  const gap = 132 * sc;          // 中央からプレイヤー/相手スコアまでの距離
  const yLabel = 22 * sc;
  const yNum = 52 * sc;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "rgba(30,41,59,0.65)";
  ctx.font = "700 " + (13 * sc) + "px sans-serif";
  ctx.fillText("あなた", cx - gap, yLabel);
  ctx.fillText("相手", cx + gap, yLabel);

  ctx.fillStyle = "#4338CA";
  ctx.font = "900 " + (34 * sc) + "px sans-serif";
  ctx.fillText(pointLabel(player.points, cpu.points), cx - gap, yNum);
  ctx.fillText(pointLabel(cpu.points, player.points), cx + gap, yNum);

  // ゲームカウント（中央）
  ctx.fillStyle = "rgba(30,41,59,0.85)";
  ctx.font = "800 " + (20 * sc) + "px sans-serif";
  ctx.fillText(player.games + " - " + cpu.games, cx, yNum - 4 * sc);
}

export function drawBackground() {
  // 中継映像風の背景: 奥ベースラインのさらに外側（バックランオフ）まで芝を伸ばし、
  // その先（地平線）に空を置く。ランオフ＝コート外の余白で、壁のような帯は作らない。
  const RUNOFF = 6.4; // ITF推奨の後方余白相当（m）
  const skylineY = project(0, -(COURT.halfL + RUNOFF), 0).y; // 地平線の画面Y（奥ベースラインより上）

  // 空グラデーション（上部）
  const sky = ctx.createLinearGradient(0, 0, 0, skylineY);
  sky.addColorStop(0, "#BFD9F2");
  sky.addColorStop(1, "#E8F1FA");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, skylineY);

  // コート外周（芝/サーフェスの地色）: 地平線からランオフを含めて下まで一面に敷く
  ctx.fillStyle = "#1f7a3f";
  ctx.fillRect(0, skylineY, W, H - skylineY);

  // 地平線にごく控えめなフェード（壁ではなく境界の馴染ませ程度）
  const fadeH = 4;
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  ctx.fillRect(0, skylineY, W, fadeH);
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
function drawWorldEllipse(cx, cy, rx, ry, color, fillColor) {
  const steps = 40;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (Math.PI * 2 * i) / steps;
    const p = project(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 0);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawDebugHitboxFor(pl, opts) {
  const info = hitLineInfo(pl);
  const active = opts.controlled ? canPlayerHit(pl) : info.active;
  const color = active ? "rgba(74,222,128,0.95)" : opts.color;
  const fillColor = active ? "rgba(74,222,128,0.13)" : opts.fillColor;
  const foreX = pl.x + info.foreDir * (info.foreWidth || 0.75);
  const backX = pl.x - info.foreDir * (info.backWidth || 0.45);
  const a = project(backX, pl.y, 0);
  const b = project(foreX, pl.y, 0);
  const c = project(pl.x, pl.y, 0);

  ctx.setLineDash([8, 5]);
  ctx.strokeStyle = color;
  ctx.lineWidth = active ? 5 : 3;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, Math.max(8, 0.34 * c.s), Math.max(5, 0.12 * c.s), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  if (info.contact) {
    const cp = project(info.contact.x, info.contact.y, Math.min(1.0, info.contact.z));
    ctx.fillStyle = active ? "#BBF7D0" : "#F8FAFC";
    ctx.strokeStyle = "rgba(15,23,42,0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, active ? 7 : 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
  }

  const p = project(pl.x, pl.y, 0);
  ctx.font = "700 10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = active ? "#BBF7D0" : "#F8FAFC";
  ctx.strokeStyle = "rgba(15,23,42,0.8)";
  ctx.lineWidth = 3;
  const distance = Number.isFinite(info.distanceX) ? info.distanceX.toFixed(2) : "--";
  const label = `${info.side} ${distance} / ${(info.width || 0).toFixed(2)}`;
  ctx.strokeText(label, p.x, p.y - Math.max(14, 0.8 * p.s));
  ctx.fillText(label, p.x, p.y - Math.max(14, 0.8 * p.s));
}

function drawDebugHitboxes() {
  if (!debugDraw.hitboxes) return;
  if (state === "ready") return;
  ctx.save();
  ctx.setLineDash([8, 5]);
  drawDebugHitboxFor(back, {
    reach: HIT_REACH,
    weighted: true,
    controlled: rallyControlled === back,
    color: "rgba(56,189,248,0.95)",
    fillColor: "rgba(56,189,248,0.10)",
  });
  drawDebugHitboxFor(front, {
    reach: VOLLEY_REACH,
    weighted: false,
    controlled: rallyControlled === front,
    color: "rgba(56,189,248,0.8)",
    fillColor: "rgba(56,189,248,0.08)",
  });
  drawDebugHitboxFor(cpuBack, {
    reach: TUNING.ai?.backReach || CPU_REACH,
    weighted: true,
    controlled: false,
    color: "rgba(251,113,133,0.9)",
    fillColor: "rgba(251,113,133,0.08)",
  });
  drawDebugHitboxFor(cpuFront, {
    reach: TUNING.ai?.frontVolleyReach || VOLLEY_REACH,
    weighted: false,
    controlled: false,
    color: "rgba(251,113,133,0.75)",
    fillColor: "rgba(251,113,133,0.07)",
  });
  ctx.restore();
}

// デバッグ: 各選手の positionBias・役割・現在タスクを頭上に表示する。
function drawDebugParams() {
  if (!debugDraw.params) return;
  if (state === "ready") return;
  const players = [
    { p: back,     self: true },
    { p: front,    self: true },
    { p: cpuBack,  self: false },
    { p: cpuFront, self: false },
  ];
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  players.forEach(({ p, self }) => {
    const bias = p.positionBias != null ? Math.round(p.positionBias) : "?";
    const roleLabel = (p.positionBias != null && p.positionBias < 50) ? "前衛" : "後衛";
    const task = p.aiTaskKind || "-";
    const sc = project(p.x, p.y, 2.9); // 頭上（3Dキャラの頭より上）
    const lines = [`${roleLabel} bias ${bias}`, `task: ${task}`];
    ctx.font = "700 11px sans-serif";
    let maxW = 0;
    lines.forEach((l) => { const w = ctx.measureText(l).width; if (w > maxW) maxW = w; });
    const boxW = maxW + 12, boxH = lines.length * 14 + 6;
    const bx = sc.x - boxW / 2, by = sc.y - boxH;
    ctx.fillStyle = self ? "rgba(37,99,235,0.85)" : "rgba(220,38,38,0.85)";
    roundRect(ctx, bx, by, boxW, boxH, 5);
    ctx.fill();
    ctx.fillStyle = "#fff";
    lines.forEach((l, i) => { ctx.fillText(l, sc.x, by + 14 + i * 14); });
  });
  ctx.restore();
}

function bouncePreviewVelocity(vx, vy, vz) {
  const sp = TUNING.spin[ball.spin] || TUNING.spin.flat;
  const flat = TUNING.spin.flat;
  const k = Math.min(1.3, Math.max(0, ball.spinMag != null ? ball.spinMag : 1));
  const friction = Math.max(0.3, Math.min(0.97, flat.friction + (sp.friction - flat.friction) * k));
  const restitution = Math.max(0.12, Math.min(0.78, flat.restitution + (sp.restitution - flat.restitution) * k));
  return { vx: vx * friction, vy: vy * friction, vz: -vz * restitution };
}

function drawDebugTrajectory() {
  if (!debugDraw.trajectory) return;
  if (state === "ready") return;

  ctx.save();
  ctx.lineCap = "round";
  if (ball.trail.length > 1) {
    ctx.strokeStyle = "rgba(255,255,255,0.42)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ball.trail.forEach((pt, i) => {
      const p = project(pt.x, pt.y, pt.z);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }

  const pts = [];
  let x = ball.x;
  let y = ball.y;
  let z = ball.z;
  let vx = ball.vx;
  let vy = ball.vy;
  let vz = ball.vz;
  let bounces = ball.bounces;
  const dt = 0.055;
  const dragPerStep = Math.max(0, 1 - (TUNING.airDrag || 0) * dt);

  for (let i = 0; i < 120; i++) {
    pts.push({ x, y, z: Math.max(0, z), bounces });
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    vz -= G * dt;
    vx *= dragPerStep;
    vy *= dragPerStep;
    if (z <= 0 && vz < 0) {
      bounces++;
      z = 0;
      if (bounces > 2) break;
      const bounced = bouncePreviewVelocity(vx, vy, vz);
      vx = bounced.vx;
      vy = bounced.vy;
      vz = bounced.vz;
    }
  }

  ctx.strokeStyle = ball.trailColor || "rgba(251,146,60,0.95)";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  pts.forEach((pt, i) => {
    const p = project(pt.x, pt.y, pt.z);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  pts.forEach((pt) => {
    if (pt.z > 0.12) return;
    const p = project(pt.x, pt.y, 0);
    ctx.fillStyle = pt.bounces === ball.bounces ? "rgba(250,204,21,0.8)" : "rgba(248,250,252,0.65)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, 0.16 * p.s), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

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
    const st = TUNING.serve.types;
    const zMax = 3.4;
    const gx = W - 16, gTop = 90, gBottom = H - 90, gw = 8;
    const zToY = function (z) { return gBottom - (gBottom - gTop) * Math.min(1, z / zMax); };

    ctx.fillStyle = "rgba(255,255,255,0.24)";
    roundRect(ctx, gx, gTop, gw, gBottom - gTop, 4);
    ctx.fill();

    const ideal = serveCategory === "under" ? st.underCut.zone.ideal : st.flat.zone.ideal;
    const tol = serveCategory === "under"
      ? Math.max(0.1, (st.underCut.zone.max - st.underCut.zone.min) * 0.12)
      : Math.max(0.1, Math.abs(st.flat.zone.ideal - st.attackCut.zone.ideal));
    const y1 = zToY(ideal + tol), y2 = zToY(ideal - tol);
    ctx.fillStyle = "rgba(99,102,241,0.24)";
    roundRect(ctx, gx - 3, y1, gw + 6, y2 - y1, 5);
    ctx.fill();

    const ty = zToY(toss.z);
    ctx.fillStyle = "#FACC15";
    ctx.beginPath();
    ctx.arc(gx + gw / 2, ty, 8, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (state === "serve-stance" && playerIsServer() && !spectatorMode) {
    const box = serviceBox(serverTeamNow());
    const inBox = insideBox(serveAimCursor.x, serveAimCursor.y, box);
    const p = project(serveAimCursor.x, serveAimCursor.y, 0);
    ctx.strokeStyle = inBox ? "#6366F1" : "#EF4444";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(8, 0.35 * p.s), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "700 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("\u30de\u30a6\u30b9\u3067\u72d9\u3046", W / 2, H - 10);
    return;
  }

  if (state === "rally" && charge.active) {
    const k = chargeAmount();
    const p = project(rallyControlled.x, rallyControlled.y, 0.15);
    const pulse = 0.82 + 0.18 * Math.sin(performance.now() / 85);
    const r = (0.38 + 0.42 * k) * p.s * pulse;
    const readyColor = k >= 1 ? "245,158,11" : "99,102,241";

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = `rgba(${readyColor},${0.35 - i * 0.08})`;
      ctx.lineWidth = 7 - i * 1.5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r * (1 + i * 0.18), r * 0.34 * (1 + i * 0.12), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = `rgba(${readyColor},0.92)`;
    ctx.beginPath();
    ctx.arc(p.x, p.y - Math.max(16, 0.38 * p.s), Math.max(5, 0.08 * p.s) + 8 * k, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "800 14px sans-serif";
    ctx.textAlign = "center";
    const courseName = courseLabelFor(rallyControlled.x, aim.x).replace("\u2192", "");
    const text = "\u305f\u3081 " + courseName + (k >= 1 ? " MAX" : "");
    ctx.strokeStyle = "rgba(15,23,42,0.82)";
    ctx.lineWidth = 4;
    ctx.fillStyle = "#FFFFFF";
    ctx.strokeText(text, p.x, p.y - Math.max(24, 0.52 * p.s));
    ctx.fillText(text, p.x, p.y - Math.max(24, 0.52 * p.s));
  }
}

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

/* キャラクター描画は3Dオーバーレイ（player3d.js）が担当する。 */
