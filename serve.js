import {
  TUNING, COURT, G,
  FINAL_GAME_POINTS, GAMES_TO_WIN_MATCH,
  TOSS_RISE_TIME, TOSS_HOLD_TIME, TOSS_BASE_Z, TOSS_APEX_Z,
} from "./config.js";

import { clamp01 } from "./math.js";

import {
  hintText,
  player, cpu, back, front, cpuBack, cpuFront, ball, rallyControlled,
  receiverSideAssign,
  serveType, setServeType,
  serveAimCursor, toss, serveReady,
  serveFaults, setServeFaults, incServeFaults,
  cpuServePlan, setCpuServePlan, aiServePlan, setAiServePlan,
  spectatorMode, state, setState, matchTime, effects,
  setReceiveDone, spaceHeld, serveCategory,
} from "./state.js";

import {
  isFinalGame, showMessage, hideMessage, setControlMode, awardPoint,
} from "./main.js";
import { resetPlayersForPoint } from "./reset.js";
import { startSwing, launchBall, netClearance } from "./matchLoop.js";

import { latchCoverageOnHit } from "./aiPositioning.js";

// サーブのパワー/回転は UI ではなく打つ選手の能力(stats)から内部で決める。
// serve（球速）が高い選手は強いサーブ、control（精度）が高い選手はよく回転をかける、
// というイメージ。3段階モデル(weak/mid/strong)へ写像する。
const SERVE_INITIAL_SPEED_MUL = 1.08;

function statLevel(v) {
  if (v == null) return "mid";
  if (v >= 1.06) return "strong";
  if (v <= 0.93) return "weak";
  return "mid";
}
function servePowerLevel(stats) { return statLevel(stats && stats.serve); }
function serveSpinLevel(stats) { return statLevel(stats && stats.control); }

// button(0=左/2=右) と spaceHeld(修飾キー) から4種のサーブタイプを決める。
// ラリー中の shotFamilyForClick と対称: Space=修飾キー、左右ボタンで系統が変わる。
// 事前にアンダーを選んだ場合（serveCategory==="under"）は、打つ瞬間の振り分けを
// 省略してunderCut確定にする（操作をシンプルにする）。
// 事前にオーバーを選んだ場合は、上から系3種をボタン+Spaceで打ち分ける従来操作のまま
// （underCutはオーバー選択中は打てない＝Space+左クリックはattackCutに割り当て直す）。
export function serveTypeForInput(button, space) {
  if (serveCategory === "under") return "underCut";
  if (space) return "attackCut";
  return button === 2 ? "slice" : "flat";
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
      hintText.textContent = "サーブ準備中";
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
    hintText.textContent = "適正マーカーの高さで打つ";
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
    // トスは常に統一トス。事前にオーバーを選んだ場合は打つ瞬間のボタン+Spaceで
    // 上から系3種が決まる。事前にアンダーを選んだ場合はunderCut確定。
    // serveType はレシーブ位置取りの基準にもなるため、トス開始時にここで仮決定しておく
    setServeType(serveCategory === "under" ? "underCut" : "flat");
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
  hintText.textContent = "";

  if (!serveAimCursor.set) resetServeAimCursor();
  launchServeBall("player", server, server.stats, {
    type: serveType,
    power: servePowerLevel(server.stats),
    spin: serveSpinLevel(server.stats),
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

// AIサーブのコース（aim=[-1,1]、+でサービスコート右方向）をレシーバー位置と
// 球種から決める。カット系(slice/underCut)はレシーバーと逆サイドへ逃がしてワイドに
// 切り、フラット/攻撃カットはレシーバーのボディ寄り（立ち位置側）を突く。
// 配球意図はつけるが固定にはせず、乱数で散らばりを残す。
function aiServeAimFor(team, type) {
  const receiver = receiverPlayerFor(team === "player" ? "cpu" : "player");
  const box = serviceBox(team);
  const boxMid = (box.x1 + box.x2) / 2;
  const boxHalf = Math.max(0.1, (box.x2 - box.x1) / 2);
  // レシーバーが箱中央のどちら側に寄っているか（-1..1にクランプ）
  const recSide = Math.max(-1, Math.min(1, (receiver.x - boxMid) / boxHalf));
  const wide = (type === "slice" || type === "underCut");
  // ボディ狙いはレシーバー側へ、ワイド狙いは逆側へ寄せる
  const intent = (wide ? -recSide : recSide) * 0.7;
  return Math.max(-1, Math.min(1, intent + (Math.random() * 2 - 1) * 0.35));
}

export function aiLaunchServe(team) {
  if (state !== "serve-toss") return;
  hideMessage();
  toss.active = false;
  setState("rally");
  hintText.textContent = (team === "cpu") ? "レシーブ！" : "";

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
    aim: aiServeAimFor(team, plan.type),
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
  let speed = tcfg.speed * SERVE_INITIAL_SPEED_MUL * stats.serve * powerMul;
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
  // アンダーカットのみ、回転による飛行中の沈み込み(tcfg.sink)をlaunchBallに渡す。
  // 他のサーブ種別・ラリー打球はsink未指定のため従来どおりの純放物線のまま。
  launchBall(server.x, server.y, fromZ, tx, ty, speed, tcfg.sink || null);
  // サーブも「相手が打った」一打。レシーブ側の守備をこのサーブで確定する。
  latchCoverageOnHit(team);
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
