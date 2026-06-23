import {
  TUNING, COURT, W, H, SHOT_FAMILY_META,
} from "./config.js";

import {
  project, roundRect,
} from "./math.js";

import {
  ctx, serveAimCursor, aim, charge, toss, rallyControlled, ball, effects,
  state, spectatorMode, cpuServePlan, serveReady,
  back, front, cpuBack, cpuFront, matchTime, serveCategory,
  player, cpu,
} from "./state.js";

import {
  playerIsServer, serverTeamNow, currentServer, serviceBox,
} from "./serve.js";

import { courseLabelFor, insideCourt, insideBox, predictLanding, predictHighContact, chargeAmount, pointLabel } from "./main.js";
import { canPlayerHit } from "./input.js";

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
  drawScore();
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
    // サーブの打点ゲージ（縦）: トスは統一トスのため、事前に選んだ大分類
    // （アンダー/オーバー）に応じた適正打点を表示する（drawTimingGauge内で分岐）。
    // 打点の高さを示す縦ゲージは構造上、画面の上下に集約できないため右端から
    // 少し内側に寄せ、プレイエリア（コート）側の余白をできるだけ広く保つ。
    const st = TUNING.serve.types;
    const zMax = 3.4;
    const gx = W - 16, gTop = 90, gBottom = H - 90, gw = 8;
    const zToY = function (z) { return gBottom - (gBottom - gTop) * Math.min(1, z / zMax); };

    // ゲージの土台（無彩色の細いトラックのみ。色付きゾーンは出さない）
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    roundRect(ctx, gx, gTop, gw, gBottom - gTop, 4);
    ctx.fill();

    // 適正打点マーカー: 事前に選んだ大分類（アンダー/オーバー）に応じて表示を絞る。
    //   オーバー: flat/slice/attackCutの3種の適正高さをまとめた1本の範囲ゲージ
    //             （個別の点を出すと見にくいため統一。打ち分けは打つ瞬間のボタン+Space）
    //   アンダー: underCut確定なので単独の点のみ（操作がシンプルな分、表示もシンプルに）
    ctx.font = "700 9px sans-serif";
    ctx.textAlign = "right";
    if (serveCategory === "under") {
      ctx.fillStyle = st.underCut.color;
      ctx.fillRect(gx - 3, zToY(st.underCut.zone.ideal) - 1, gw + 6, 2);
      ctx.fillText("適正（アンダーカット）", gx - 4, zToY(st.underCut.zone.ideal) + 3);
    } else {
      const overIdeals = [st.flat.zone.ideal, st.slice.zone.ideal, st.attackCut.zone.ideal];
      const overTop = Math.max.apply(null, overIdeals);
      const overBottom = Math.min.apply(null, overIdeals);
      const overColor = "#F8FAFC"; // 上から系3種を中立色（フラットの色）でまとめて示す
      const overYTop = zToY(overTop);
      const overYBottom = zToY(overBottom);
      ctx.fillStyle = "rgba(248,250,252,0.55)";
      ctx.fillRect(gx - 3, overYTop, gw + 6, Math.max(2, overYBottom - overYTop));
      ctx.fillStyle = overColor;
      ctx.fillRect(gx - 3, overYTop - 1, gw + 6, 2);
      ctx.fillRect(gx - 3, overYBottom - 1, gw + 6, 2);
      ctx.fillText("適正帯（上から系：フラット/スライス/攻撃カット）", gx - 4, overYTop + 3);
    }

    // 現在のボールの高さ
    ctx.fillStyle = "#FACC15";
    ctx.beginPath();
    ctx.arc(gx + gw / 2, zToY(ball.z), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(30,27,75,0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();

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

/* プレイヤー描画は player-2d.js へ移動
 * import { drawHumanoid } from "./player-2d.js"; 参照 */
  const g = project(pl.x, pl.y, 0);
  const s = g.s; // px/m

  ctx.save();
  ctx.translate(g.x, g.y);

  // 影は地面に固定（回転させない）。
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.34 * s, 0.13 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // 体はボールの予測打点へ向けて背骨（鉛直軸）を中心にヨー回転する（直立のまま左右を向く）。
  // 平面スプライトのため鉛直軸まわりの回転は横方向の圧縮(scaleX=cos)で近似し、頭は回転方向へ
  // 少しずらして「ボールの方を向く」ようにする（傾けない）。スイング中は打球モーション優先。
  const bodyYaw = pl.pose !== "swing" ? bodyYawToBall(pl) : 0;
  if (bodyYaw) ctx.transform(Math.cos(bodyYaw), 0, 0, 1, 0, 0);

  // 前衛判定（role/front相当）: state.js上は front/cpuFront インスタンスそのものが
  // ネット前のプレイヤーを表す。ボレー・スマッシュ待ちのため、後衛よりやや高めの
  // 構え（膝の曲げを浅く＝重心を高く）にする。見た目のみで当たり判定には関与しない。
  const isFrontRole = pl === front || pl === cpuFront;

  // 移動検出: 前回描画時の位置との差分から「動いているか」を見る（描画専用キャッシュ）。
  const anim = getMoveAnim(pl);
  const now = performance.now();
  const animDt = Math.max(0.001, Math.min(0.1, (now - anim.lastNow) / 1000));
  const movedDist = Math.hypot(pl.x - anim.lastX, pl.y - anim.lastY);
  const moveSpeed = movedDist / animDt; // m/s相当（描画判定用のみ）
  const isMoving = moveSpeed > 0.15 && pl.pose !== "swing";
  if (isMoving) {
    // ソフトテニスらしいコンパクトな小刻みステップ＝速いサイクル
    anim.phase += animDt * Math.min(10, 6 + moveSpeed * 2.2);
  }
  anim.lastX = pl.x; anim.lastY = pl.y; anim.lastNow = now;
  const stepPhase = anim.phase;
  const stepSwing = isMoving ? Math.sin(stepPhase) : 0; // -1..1
  const stepLift = isMoving ? Math.max(0, Math.sin(stepPhase * 2)) * 0.05 : 0; // 軽い上下動

  // スプリットステップ: 相手が打った直後の短い時間だけ、軽く沈み込む予備動作。
  // タイミング判定は描画側だけで完結（ball.lastHitTime/lastHitterを読むだけ）。
  const isOwnTeam = (pl === back || pl === front) ? "player" : "cpu";
  const opponentJustHit = ball.lastHitter !== isOwnTeam;
  const sinceHit = matchTime - ball.lastHitTime;
  const SPLIT_WINDOW = 0.22;
  let splitSquat = 0;
  if (opponentJustHit && sinceHit >= 0 && sinceHit < SPLIT_WINDOW && pl.pose !== "swing") {
    const t = sinceHit / SPLIT_WINDOW;
    splitSquat = Math.sin(t * Math.PI) * 0.07; // 軽い沈み込み（最大7%収縮）
  }

  const swingDuration = TUNING.tempo.swingDuration;
  const swingK = (pl.pose === "swing" && pl.swingT > 0)
    ? Math.max(0, Math.min(1, 1 - pl.swingT / swingDuration))
    : 0;
  const recoverK = pl.recoverT > 0
    ? Math.max(0, Math.min(1, 1 - pl.recoverT / TUNING.tempo.swingRecover))
    : 1;
  // インパクト直後に踏み込み脚へ沈み、振り抜きに合わせて伸び上がる。
  // 当たり判定や移動座標は変えず、重心の上下だけで全身運動に見せる。
  const strokeLoad = pl.pose === "prep" ? 0.035 : Math.sin(Math.min(1, swingK / 0.72) * Math.PI) * 0.045;

  // 前衛は重心を高め（膝を浅く）、後衛・移動中・スプリットステップはやや低めに。
  // athleticな低い土台にするため全体的に膝の曲げを深くする（前衛も従来より低く）。
  const stanceCrouch = (isFrontRole ? 0.07 : 0.1) + splitSquat + (isMoving ? stepLift : 0) + strokeLoad;
  const legH = (0.5 - stanceCrouch) * s;
  // 上体の前傾: 重心がつま先寄りに見えるよう、胴を少し前方へオフセット
  const torsoLean = 0.05 * s;
  const torsoTop = (isFrontRole ? -1.21 : -1.18) * s + stanceCrouch * s * 0.6;
  const torsoBottom = -legH;
  const headR = 0.23 * s;
  const headCy = torsoTop - headR * 0.85;

  // ラケットを持つ手は利き腕で常に固定（フォア/バックで持ち替えない）。
  // foreDir: そのプレイヤーから見て「フォア側」が画面上どちら向きか（向き＋利き腕の鏡像を反映）。
  //   右利き: プレイヤー(facing=-1)はフォアが画面右(+1)、CPU(facing=1)は画面左(-1) ＝ 既存と同じ。
  //   左利き: 体の向きはそのままに、利き腕側が左右反転するため鏡像になる。
  const facingDir = pl.facing === -1 ? 1 : -1;
  const handSign = pl.stats && pl.stats.handed === "left" ? -1 : 1;
  const foreDir = facingDir * handSign;
  // racketDir: ラケットを保持する手の画面上の向き。フォア/バックに関わらず常に同じ
  // （利き腕固定）。バックハンドは体を捻ってラケット軌道を変えるだけで、持ち替えない。
  const racketDir = foreDir;
  // bodyTwist: フォア/バックの違いを胴体の向き・捻りで表現するための符号
  // （フォア=+、バック=-）。ラケット位置の左右反転には使わない。
  const swingDir = pl.swingSide === "fore" ? 1 : -1;

  // 脚: 静止時は構え（つま先重心・腰幅で軽く開いた）固定ポーズ。移動時はstepSwingで
  // 左右の足を交互に前後・上下させ、コンパクトな小刻みステップに見せる
  // （当たり判定・移動量には一切影響しない＝描画のみのオフセット）。
  const stepReach = isMoving ? 0.07 * s : 0;
  const leftFootZ = isMoving ? Math.max(0, -Math.sin(stepPhase)) * 0.06 * s : 0;
  const rightFootZ = isMoving ? Math.max(0, Math.sin(stepPhase)) * 0.06 * s : 0;
  ctx.strokeStyle = "#1F2937";
  ctx.lineWidth = Math.max(1.5, 0.09 * s);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-0.15 * s, torsoBottom);
  ctx.lineTo(-0.22 * s - stepSwing * stepReach, -leftFootZ);
  ctx.moveTo(0.15 * s, torsoBottom);
  ctx.lineTo(0.22 * s + stepSwing * stepReach, -rightFootZ);
  ctx.stroke();

  // このプレイヤーがちょうどサーブを打っている最中か（描画の演出選択のみに使う。
  // 当たり判定・タイミングには一切関与しない＝ball.serving/lastHitterを読むだけ）。
  const isServingTeam = (pl === back || pl === front) ? "player" : "cpu";
  const isServeSwing = pl.pose === "swing" && ball.serving && ball.lastHitter === isServingTeam;

  const shoulderY = torsoTop + 0.12 * s;
  let armAngle;
  let racketLen = 0.62 * s;
  let torsoTwist = 0; // 胴の左右の振れ（描画のみ）
  let foreWrap = 0; // フォア フォロースルーが首へ巻き付く度合い(0→1)
  if (pl.pose === "swing" && pl.swingT > 0) {
    // k=0: 打球判定が発生した瞬間（hitBall→startSwing呼び出し時点）。
    // k=1: スイング表示終了。当たり判定・タイミングはここでは一切変えず、
    // 同じ0→1の進行を非線形カーブに通すだけ（見た目の演出のみ）。
    const k = swingK;
    let progress;
    if (k < 0.18) {
      // ごく短い「引き」の余韻（当たった直後、ラケットが一瞬戻る動き）。
      // フォアはテイクバックの「溜め」を大きく見せ、バックは小さく留めて
      // フォアと体感差をつける（打点での角度=k=0時点の値は変えない）。
      const t = k / 0.18;
      const takebackAmp = isServeSwing ? 0.06 : (swingDir === 1 ? 0.1 : 0.04);
      progress = -takebackAmp * Math.sin(t * Math.PI);
    } else {
      // インパクト付近で一気に加速し、フォロースルー終盤は自然に減速する。
      const t = (k - 0.18) / (1 - 0.18);
      const eased = 1 - Math.pow(1 - t, 3.1);
      progress = eased;
    }
    if (isServeSwing) {
      // サーブ（アンダーカット基調）: テイクバックで沈み込み、下から上へ
      // すくい上げるように振る。ストロークと違い「上→下」ではなく「下→上」。
      // armAngle: -2.6（低いテイクバック）→ -0.5（高い振り上げ・フォロースルー）
      armAngle = -2.6 + progress * 2.1;
    } else if (swingDir === 1) {
      // フォアハンド: テイクバック→振り抜き→フォロースルーの抑揚をつける非線形カーブ。
      // armAngleProgress(k): k=0で-0.9（従来と同じ＝当たり判定の瞬間の見た目は変えない）、
      // 序盤はわずかに戻る（テイクバックの余韻）→中盤で加速して振り抜く→
      // 利き手側から前へ、反対肩方向まで大きく振り抜いて収まる（フォロースルーの減速）。
      armAngle = (-0.9 + progress * 1.85);
      // 振り抜き本体の後半(t>0.5)から、ラケットを反対側の首元へ巻き付ける
      // フィニッシュへ移行する（インハイ前衛の体の回転に乗ったフォロースルー）。
      const tt = Math.max(0, (k - 0.18) / (1 - 0.18));
      foreWrap = Math.max(0, Math.min(1, (tt - 0.5) / 0.5));
    } else {
      // バックハンド（片手）: 利き腕は持ち替えず、体を捻って胸の前で打つ。
      // テイクバックはコンパクト（armAngle -0.5付近）にとどめ、
      // インパクト〜フォロースルーで体の前を横切り、胸の前で収まる（0.85付近。
      // フォアより明確に小さい振り幅＝硬式的なワイパーにしない）。
      armAngle = (-0.5 + progress * 1.35);
    }
    // 胴の軽い捻り: 振り抜きに合わせてわずかに前へ（やりすぎない量）。
    // フォアは横向きの溜め→振り抜きを大きめに、バックは体の前でコンパクトに収める
    // ことでフォア/バックの見た目を区別する。
    const twistAmp = isServeSwing ? 0.07 : (swingDir === 1 ? 0.13 : 0.09);
    // 打点ではまだ肩を残し、ラケットより少し遅れて腰・胸が前へ回る。
    const bodyTurn = 1 - Math.pow(1 - Math.max(0, (k - 0.08) / 0.92), 2.2);
    torsoTwist = (-0.32 + bodyTurn * 1.32) * twistAmp * swingDir * foreDir;
  } else if (pl.recoverT > 0) {
    // フィニッシュからレディへ滑らかに戻す。従来の瞬間的な姿勢切替をなくす。
    const eased = recoverK * recoverK * (3 - 2 * recoverK);
    const finishAngle = pl.swingSide === "fore" ? 0.95 : 0.85;
    armAngle = finishAngle * (1 - eased) + 0.25 * eased;
    foreWrap = pl.swingSide === "fore" ? 1 - eased : 0;
    const finishTwist = pl.swingSide === "fore" ? 0.13 : -0.09;
    torsoTwist = finishTwist * foreDir * (1 - eased);
  } else if (pl.pose === "ready" || pl.pose === "idle") {
    // 構え（レディポジション）。スイング後の"idle"もここに合わせることで、
    // 打った直後すぐ構えに戻ったように見せる（タイミング値は変更しない、見た目の収束のみ）。
    // ラケットを胸の前・低めに収めるコンパクトな構え（肘を曲げ、体に近づける）。
    armAngle = 0.25;
  } else if (pl.pose === "prep") {
    // 早めの準備動作（テイクバック開始）: ボールがネットを越えて自陣に入った
    // 直後から、構え(0.25)よりわずかに後方へラケットを引き始める中間姿勢。
    // フォア/バックでテイクバック方向を分け、わずかに引いた角度にする。
    armAngle = pl.swingSide === "back" ? 0.0 : -0.15;
    // 肩を先に入れ、腕だけでなく上体でテイクバックしているように見せる。
    torsoTwist = (pl.swingSide === "fore" ? -0.055 : 0.045) * foreDir;
  } else if (pl.pose === "toss") {
    // トス〜テイクバック: トスを上げた直後からラケット側はすでに後方・低めへ
    // 沈み込み始める（アンダーカットサーブのテイクバック準備）。
    armAngle = -2.3;
  } else {
    armAngle = 0.6;
  }

  const tw = 0.46 * s;
  const drawTorso = () => {
    ctx.fillStyle = pl.color;
    // 前傾を見た目で表現: 胴の上端をわずかに前方へずらし、重心がつま先寄りに
    // 見えるようにする（当たり判定には無関係の描画オフセット。下端は脚に揃えたまま）。
    roundRect(ctx, -tw / 2 + torsoTwist * s + torsoLean, torsoTop, tw, torsoBottom - torsoTop, 0.12 * s);
    ctx.fill();
  };

  const isReadyPose = (pl.pose === "ready" || pl.pose === "idle") && !(pl.recoverT > 0);
  // レディ姿勢は肘を曲げてコンパクトに＝肩からの腕の伸ばし幅を狭める（胸の前に収める）。
  const armReach = isReadyPose ? 0.13 * s : 0.3 * s;
  const armX = racketDir * Math.cos(armAngle);
  const armY = Math.sin(armAngle);
  let handX = racketDir * armReach * Math.abs(Math.cos(armAngle)) + racketDir * 0.06 * s;
  // レディ姿勢はグリップ（手元）を胸の高さまで下げ、ラケット全体が顔にかからない
  // ようにする（PR#24で前面描画にした結果ヘッドが顔に被っていたための調整）。
  const readyHandDrop = isReadyPose ? 0.32 * s : 0;
  let handY = shoulderY + armReach * armY + readyHandDrop;

  // フォア フォロースルー: 手を利き手側→反対の首元へ横切らせ、肩口まで
  // 引き上げる（ラケットが首に巻き付くフィニッシュ）。位置を線形補間。
  if (foreWrap > 0) {
    const w = foreWrap;
    handX = handX * (1 - w) + (-racketDir * 0.14 * s) * w; // 反対肩〜首元へ
    handY = handY * (1 - w) + (shoulderY - 0.06 * s) * w;  // 肩口の高さへ
  }

  // ラケット先端の向き: 通常はarmX/armYと同じ（利き腕の伸び方向）。
  // レディ姿勢のみ例外で、グリップは利き手・スロートは非利き手で支える両手持ちのため、
  // ラケットヘッドは体の前を横切って非利き手側・やや上を向く（armX/armYとは別方向）。
  let racketTipX = armX;
  let racketTipY = armY;
  if (isReadyPose) {
    // 両手持ちでヘッドは体の前を横切り非利き手側・やや上を向く（元の構え位置）。
    // 背面視点でも位置は変えず、描画順（胴体より先に描く）だけで背中側への貫通を防ぐ。
    racketTipX = -racketDir * 0.85;
    // 上向きは維持するが弱めにする（ヘッドが顔の高さまで上がらないように）。
    racketTipY = -0.25;
  } else if (foreWrap > 0) {
    // 巻き付きフィニッシュ: ヘッドを反対肩の上・背中側へ向けて立てる。
    const w = foreWrap;
    racketTipX = racketTipX * (1 - w) + (-racketDir * 0.55) * w;
    racketTipY = racketTipY * (1 - w) + (-0.95) * w; // 上向き
  }

  // facing=-1（背を向けている＝プレイヤー側）のときは、両手とも体の奥側
  // （カメラから見て体の向こう側）にある。添え手をカメラ側の輪郭から
  // 飛び出させないよう、肩の起点・手元の寄せ幅を体の中心側に縮める
  // （描画のみのオフセット。当たり判定・進行には無関係）。
  const awayFromCamera = pl.facing === -1;
  const offHandTuck = awayFromCamera ? 0.6 : 1;

  // 描画順の方針: ラケットはどの視点でもフォロースルーまで常に見えるように描く
  // （背中や胴体に隠さない）。
  //  - 正面視点（相手＝facing=1）: ラケットは体の前（カメラ側）にあるため胴体・頭より
  //    後に描いて前面に出す。フォロースルー後半は体の後ろへ回り込むので頭より先に描き、
  //    振り抜き全体が見えるようにする。
  //  - 背面視点（味方＝facing=-1, awayFromCamera）: ラケットは体の前面＝カメラから見て
  //    体の「奥」にあるため、通常は胴体・頭より先に描いて体の輪郭で覆う。
  //    ただしフォア・フォロースルー終盤（foreWrap大）はラケットが反対肩〜首元へ
  //    巻き付き、振り抜き全体が見えるよう胴体・頭より後に描いて隠さない。
  const isFollowThrough = !awayFromCamera && pl.pose === "swing" && pl.swingT > 0 && swingK > 0.78;
  const isAwayFollowThrough = awayFromCamera && foreWrap > 0.55;

  // 腕（利き手＝ラケットを持つ手 と 添え手）のみを描く。ラケット本体は drawRacket で別途。
  const drawArms = () => {
    ctx.strokeStyle = pl.skin;
    ctx.lineWidth = Math.max(1.5, 0.08 * s);
    ctx.beginPath();
    ctx.moveTo(-racketDir * tw * 0.4 * offHandTuck, shoulderY);
    if (pl.pose === "toss") {
      // トス腕（反対側の手）を高く上げる
      ctx.lineTo(-racketDir * 0.16 * s * offHandTuck, shoulderY - 0.55 * s);
    } else if (pl.pose === "ready" || pl.pose === "idle") {
      // 構え時: 非利き手をラケットのスロート（喉/グリップ付近）に添える
      // 両手持ちレディポジション。利き手側のhandX/handYに寄せる。
      // 背を向けている選手は添え手が中心寄りに収まるよう寄せ幅を狭める。
      ctx.lineTo(handX - racketDir * 0.05 * s * offHandTuck, handY - 0.04 * s);
    } else {
      ctx.lineTo(-racketDir * 0.34 * s * offHandTuck, shoulderY + 0.26 * s);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(racketDir * tw * 0.4, shoulderY);
    ctx.lineTo(handX, handY);
    ctx.stroke();
  };

  // ラケット（人体とは別オブジェクト）。色は pl.look.racket から取得し、
  // 持ち手(handX/handY)とヘッド向き(racketTipX/Y)を引数として人体描画から独立させる。
  const drawRacket = () => {
    const gear = (pl.look && pl.look.racket) || { frame: "#7C3AED", string: "rgba(255,255,255,0.85)" };
    const racketLenDraw = isReadyPose ? racketLen * 0.82 : racketLen;
    const rx = handX + racketTipX * racketLenDraw * 0.55;
    const ry = handY + racketTipY * racketLenDraw * 0.55 - (isReadyPose ? 0.02 : 0.1) * s;
    ctx.strokeStyle = gear.frame;
    ctx.lineWidth = Math.max(1.2, 0.05 * s);
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    ctx.fillStyle = gear.string;
    ctx.strokeStyle = gear.frame;
    ctx.beginPath();
    ctx.ellipse(rx, ry, 0.13 * s, 0.17 * s, Math.atan2(racketTipY, racketTipX), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };

  // 腕→ラケットの順（ラケットは持ち手の上に重ねる）。人体とラケットは別関数＝別オブジェクト。
  const drawArmsAndRacket = () => { drawArms(); drawRacket(); };

  const drawHead = () => {
    const hx = Math.sin(bodyYaw) * headR * 0.5; // 顔を回転方向（ボール側）へ向ける
    ctx.save();
    ctx.translate(hx, 0);
    ctx.fillStyle = pl.skin;
    ctx.beginPath();
    ctx.arc(0, headCy, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = (pl.look && pl.look.hair) || "#3B2A1E";
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
    ctx.restore();
  };

  if (awayFromCamera) {
    // 背面視点: 通常は腕・ラケットを先に描き、胴体・頭で覆って体の前面
    // （カメラの奥）に収める。体の輪郭からはみ出す部分だけが覗き、
    // 背中側への貫通を防ぐ。
    // フォア・フォロースルー終盤（isAwayFollowThrough）は、ラケットが
    // 反対肩〜首元へ巻き付き振り抜きが大きく見えるタイミングのため、
    // 胴体・頭より後に描いて隠さない（振り抜きを見せる）。
    if (isAwayFollowThrough) {
      drawTorso();
      drawHead();
      drawArmsAndRacket();
    } else {
      drawArmsAndRacket();
      drawTorso();
      drawHead();
    }
  } else {
    // 正面視点: 胴体→（フォロースルーは頭の後ろへ）→頭→腕・ラケット（前面）。
    drawTorso();
    if (isFollowThrough) drawArmsAndRacket();
    drawHead();
    if (!isFollowThrough) drawArmsAndRacket();
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

