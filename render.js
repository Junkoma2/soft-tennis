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
