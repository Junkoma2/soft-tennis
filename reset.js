import { TUNING, COURT } from "./config.js";

import {
  back, front, cpuBack, cpuFront, ball,
  charge, serveReady, toss, serveAimCursor,
  setPendingSwing, setCpuFrontPlan, setReceiveDone,
  setPointJustServedByFront, setCpuJustServedByFront,
  receiverSideAssign, resetCoverageAnchors,
} from "./state.js";

import {
  serverTeamNow, serverIsFrontPlayer, serveFromRight,
  servePosition, receiverPlayerFor, receivePosition,
} from "./serve.js";

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

  // サーバーでない自陣の相方（前衛）はサーバーと反対サイドへ寄せ、重なりを防ぐ。
  // 全陣形に適用する（旧コードは雁行のみで、ダブル後衛では後衛サーバーと前衛が
  // 同サイド・同深さに居残り重なっていた）。yは各自のhome深さのまま動かさない。
  // レシーブ役の前衛にはこのサイド寄せを適用しない（レシーブ位置を上書きしてしまうため）。
  const sideSign = serveFromRight() ? 1 : -1;
  const fx = TUNING.pos.frontSideX;
  const receivingTeam = team === "player" ? "cpu" : "player";
  const recv = receiverPlayerFor(receivingTeam);
  if (front !== recv && !(team === "player" && frontServes)) {
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
  resetCoverageAnchors();     // 守備ラッチをクリア（次の一打＝サーブで確定し直す）
  setCpuFrontPlan("base");
  setReceiveDone(false);
  serveReady.timer = 0;
  serveReady.still = 0;
  serveReady.ready = false;
  toss.active = false;
  toss.t = 0;
  [back, front, cpuBack, cpuFront].forEach((p) => {
    p.pose = "idle"; p.swingT = 0; p.recoverT = 0;
    p.swingSideLocked = false; p.wrapCommitted = false; p.wrapTargetX = null;
    p.approachTargetX = null;
  });
}
