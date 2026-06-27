import {
  TUNING, COURT, CPU_REACH, VOLLEY_REACH,
} from "./config.js";

import {
  state, spectatorMode, rallyControlled, back, front, cpuBack, cpuFront, ball,
  receiveDone, partnerAggressiveness, cpuFrontPlan, playerFrontPlan,
} from "./state.js";

import {
  serverTeamNow, currentServer, receiverPlayerFor,
} from "./serve.js";

import {
  predictLanding, hitBall, showMessage, hideMessage, canSwingNow,
} from "./main.js";

import { distToBall, canPlayerHit } from "./input.js";

import { buildCtx } from "./aiContext.js";
import {
  decideAIPhase, updateServePhaseAI, updateReceivePhaseAI, updateRallyPhaseAI,
} from "./aiPhase.js";
import { findOpenCourseX } from "./aiPositioning.js";

/* ===========================================================
 * AI（味方パートナー・CPUペア）の外部API入口
 *
 * 移動ロジックは責務ごとに分離している:
 *   aiPositioning.js … 移動ユーティリティ・展開判定・定位置計算
 *   aiContext.js     … ctx生成・状況評価・個性パラメータ
 *   aiTask.js        … タスク決定・実行
 *   aiPhase.js       … serve/receive/rally のフェーズ処理
 * このファイルは moveAutoAI（フェーズ委譲の入口）と、各更新フック・
 * 打球判断（tryReturnAI 等）を保持する。難易度は従来どおり易しめ。
 * =========================================================== */

// 相方がいま「自分のサーブを打つ前」かどうか（AIサーバーは動かさない）
export function partnerIsServingNow(partner) {
  return (state === "serve-stance" || state === "serve-toss") &&
    serverTeamNow() === "player" && currentServer() === partner;
}

// AI自動移動の共通ロジック（playerチーム・cpuチーム共通）。
// side: "player"(自陣y+側) または "cpu"(自陣y-側) / p: 移動させる選手。
// フェーズを判定して専用関数へ委譲する: serve / receive / rally。
export function moveAutoAI(p, side, dt) {
  const ctx = buildCtx(side, p);
  const phase = decideAIPhase(p, ctx);
  if (phase === "serve") {
    updateServePhaseAI(p, ctx, dt);
    return;
  }
  if (phase === "receive") {
    // レシーブ処理が完結したらそこで終了。完結しなければラリー処理へ流す。
    if (updateReceivePhaseAI(p, ctx, dt)) return;
  }
  updateRallyPhaseAI(p, ctx, dt);
}

// 味方パートナー（プレイヤーが操作していない方）の自動移動
export function updatePartner(dt) {
  const partner = (rallyControlled === back) ? front : back;
  moveAutoAI(partner, "player", dt);
}

// 観戦モード: 操作キャラ（rallyControlled）もAIが移動させる。
export function updateRallyControlledAI(dt) {
  if (!spectatorMode) return;
  moveAutoAI(rallyControlled, "player", dt);
}

export function updateCpuBack(dt) {
  moveAutoAI(cpuBack, "cpu", dt);
}

export function updateCpuFront(dt) {
  moveAutoAI(cpuFront, "cpu", dt);
}

// 観戦モード: 操作キャラ（rallyControlled）の打球判断（コース・球種・狙い）。
// CPU後衛のコース選択（cpuTryReturn）と同じ考え方で、相手前衛のいない側を
// 主体に狙う。球種はシュート/カット/ロブを状況に応じて振り分け、
// 着地点(aimX/aimY)に変換してbyPlayer経路（hitBall）へ渡す。
export function chooseAiHitForRallyControlled() {
  const cp = rallyControlled;

  // セオリー: 基本はクロスのコーナー（相手後衛側＝アレー寄り）へ返す。
  let course;
  if (Math.random() < 0.65) {
    course = (cpuBack.x >= 0 ? 1 : -1) * (0.78 + Math.random() * 0.32);
  } else {
    course = (Math.random() - 0.5) * 1.9;
  }

  // 球種選択: ネット前で打点が高ければスマッシュ（hitBall内で自動判定）。
  // それ以外はシュート中心、時々カット、ネット際に詰まったらロブで逃げる。
  let family;
  const r = Math.random();
  if (cp.y < 4.0 && ball.z > 1.5 && ball.z < 2.3 && r < 0.25) {
    family = "lob";
  } else if (r < 0.55) {
    family = "shoot";
  } else if (r < 0.85) {
    family = "cut";
  } else {
    family = "lob";
  }

  const aimX = Math.max(-(COURT.singlesHalfW - 0.3), Math.min(COURT.singlesHalfW - 0.3, course * 3.5));
  const depth = TUNING.aim.defaultY + (Math.random() - 0.5) * 3.0;
  const aimY = Math.max(-(COURT.halfL - 0.6), Math.min(-TUNING.aim.minDepth, -depth));

  return { shot: family, aimX: aimX, aimY: aimY };
}

// AI打球の共通ロジック（playerチーム・cpuチーム共通）。
// side: "player"(自陣y+側) または "cpu"(自陣y-側)
// 両チームで同一ロジック・同一パラメータ。対称性から自動的に互角になる。
export function tryReturnAI(side) {
  const opponentSide = side === "player" ? "cpu" : "player";
  if (ball.lastHitter !== opponentSide || state !== "rally") return;

  const ai = TUNING.ai;
  const sm = TUNING.smash;
  const myFront  = side === "player" ? front    : cpuFront;
  const myBack   = side === "player" ? back     : cpuBack;
  const oppBack  = side === "player" ? cpuBack  : back;
  const oppFront = side === "player" ? cpuFront : front;
  // 自陣のy符号: player=+（y>0）、cpu=-（y<0）
  const homeSign = side === "player" ? 1 : -1;
  // 前衛ボレー判定用フラグ
  const frontChecked = side === "player" ? "frontChecked" : "cpuFrontChecked";

  // ---- 後衛の早めのテイクバック準備（見た目のみ、打球判定には影響しない） ----
  // 操作プレイヤー側（main.js）はボールが自陣に入った時点でpose="prep"へ
  // 早めに移行しているが、AI後衛(cpuBack)はstartSwing（インパクト）まで
  // pose="swing"にならず、テイクバックが遅れて見える。
  // ここでも同じ考え方で、ボールが自陣側に入ったら早めにprepへ入れて
  // swingSideを固定する（実際の打球判定・タイミングはこの下のhitBall呼び出しの
  // ままで変更しない＝見た目だけの先行動作）。
  // まずは影響範囲をcpuBackに限定する（player後衛は既存のprep経路で対応済み）。
  if (side === "cpu" && canSwingNow(myBack)) {
    const ballComingHome = ball.y * homeSign > 0;
    if (ballComingHome) {
      // 先行テイクバック（見た目だけ）。フォア/バックは moveAutoAI が立ち位置と
      // 一体で確定済み（myBack.swingSide）なので、ここでは再計算しない
      // ＝回り込み・表示・物理がすべて同じ確定値を参照し、矛盾もちらつきも出ない。
      if (myBack.pose !== "prep") myBack.pose = "prep";
    } else if (myBack.pose === "prep") {
      myBack.pose = "idle";
    }
  }

  // ---- サーブの返球: レシーブ担当（前衛/後衛どちらでも）がワンバウンドで返す ----
  // 返球者を担当レシーバーに固定し、非担当（特に後衛）が横取りしないようにする。
  // ball.serving はバウンド前に解除されるため、レシーブ未完了フラグ !receiveDone で判定する。
  // 後衛の返球と同様、頂点を過ぎて落ち始めた打点（vz <= 0）で捉える。
  if (!receiveDone && ball.bounces === 1 && ball.z < 2.3 && ball.vz <= 0) {
    const receiver = receiverPlayerFor(side);
    if (canSwingNow(receiver) && distToBall(receiver) <= ai.backReach * receiver.stats.reach) {
      // セオリー: 基本はクロスのコーナー（相手後衛側＝アレー寄り）へ返す
      let course;
      if (Math.random() < 0.65) course = (oppBack.x >= 0 ? 1 : -1) * (0.78 + Math.random() * 0.32);
      else course = (Math.random() - 0.5) * 1.9;
      const r = Math.random();
      const shot = r < 0.55 ? "drive" : (r < 0.8 ? "flat" : "slice");
      hitBall({ hitter: receiver, side: side, shot: shot, course: course, contactZ: ball.z });
    }
    return;
  }

  // ---- 前衛のスマッシュ（浅いロブを叩き込む） ----
  // 自陣側（homeSign方向）のネット前〜に浮いた球を、バウンド前に叩く。
  if (!ball[frontChecked] && ball.bounces === 0 &&
      ball.y * homeSign > 0.4 && ball.y * homeSign < sm.netDist &&
      ball.z >= sm.minZ && ball.z < 2.3) {
    const landing = predictLanding();
    const shallowLob = landing && landing.y * homeSign > 0 &&
      Math.abs(landing.y) <= sm.aiLobShallowY;
    const reach = ai.poachReach * myFront.stats.reach;
    if (shallowLob && canSwingNow(myFront) && Math.hypot(ball.x - myFront.x, ball.y - myFront.y) <= reach) {
      ball[frontChecked] = true;
      if (Math.random() < 0.98 * myFront.stats.volley) {
        hitBall({
          hitter: myFront,
          side: side,
          shot: "flat",
          course: (oppBack.x > 0 ? -1 : 1) * (0.4 + Math.random() * 0.6),
          contactZ: ball.z,
        });
        const label = side === "player" ? "相方のスマッシュ！" : "相手前衛のスマッシュ！";
        showMessage(label);
        setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
        return;
      }
    }
  }

  // ---- 前衛のボレー/ポーチ ----
  // 自陣側（homeSign方向）のネット際に来た、まだバウンドしていない球だけを迎える。
  // 深く速いラリー球（ネットを高く越えて後衛へ抜ける球）は拾わず後衛に任せる。
  if (!ball[frontChecked] && ball.bounces === 0 &&
      ball.y * homeSign > 0.4 && ball.y * homeSign < 3.2 && ball.z < 1.6) {
    const poaching = ((side === "cpu") ? cpuFrontPlan : playerFrontPlan) === "poach";
    {
      // 前衛は届くならボレーする（ポーチ指示の有無に関わらず）。
      const reach = (poaching ? ai.poachReach : ai.frontVolleyReach) * myFront.stats.reach;
      if (canSwingNow(myFront) && Math.hypot(ball.x - myFront.x, ball.y - myFront.y) <= reach) {
        ball[frontChecked] = true;
        const chance = (poaching ? 0.9 : 0.82) * myFront.stats.volley;
        if (Math.random() < chance) {
          hitBall({
            hitter: myFront,
            side: side,
            shot: "flat",
            course: (oppBack.x > 0 ? -1 : 1) * (0.4 + Math.random() * 0.6),
            contactZ: ball.z,
          });
          let label;
          if (side === "player") {
            label = "相方のボレー！";
          } else {
            label = poaching ? "相手前衛のポーチ！" : "相手前衛のカット！";
          }
          showMessage(label);
          setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
          return;
        }
      }
    }
  }

  // ---- cpu前衛のポーチ（作戦による定位置移動ロジックは moveAutoAI で対応。
  //      ここではボレー判定後の「ポーチに出た位置でのボレー」のみ ----

  // ---- 後衛のワンバウンド返球 ----
  // 実際のストロークに合わせ、バウンドの頂点を過ぎて「落ち始めた」打点で打つ。
  //   vz <= 0 … 上昇が止まり下降に転じた以降（＝頂点〜落下中）。上昇中は打たない。
  //   z < 2.3 上限で頭上すぎる打点は避ける（頂点が高い球は2.3まで落ちてから打つ）。
  // 頂点〜地面までの下降中ずっと打てるので、届く位置にいれば頂点付近で自然に捉える。
  if (ball.bounces === 1 && ball.z < 2.3 && ball.vz <= 0) {
    // ワンバウンド返球の打ち手: 後衛が基本だが、前衛がストロークで取りに来ている
    // （moveAutoAIのfront-strokeタスクで打点へ寄っている）場合は前衛にも打たせる。
    // 両者とも届くなら近い方、片方しか届かなければその方が打つ。
    const backReach = ai.backReach * myBack.stats.reach;
    const frontReach = ai.backReach * myFront.stats.reach;
    const backCan = canSwingNow(myBack) && distToBall(myBack) <= backReach;
    const frontCan = canSwingNow(myFront) && distToBall(myFront) <= frontReach;
    let hitter = null;
    if (backCan && frontCan) hitter = distToBall(myBack) <= distToBall(myFront) ? myBack : myFront;
    else if (backCan) hitter = myBack;
    else if (frontCan) hitter = myFront;
    if (hitter) {
      // セオリー: 基本はクロスのコーナー（相手後衛側＝アレー寄り）へ深く返す。
      // 相手後衛のいる側へ外めに振り、アレー方向の球を増やす。残りは散らす。
      let course;
      if (Math.random() < 0.65) {
        const crossSign = oppBack.x >= 0 ? 1 : -1;
        course = crossSign * (0.78 + Math.random() * 0.32);
      } else {
        course = (Math.random() - 0.5) * 1.9;
      }
      // 駆け引き: 相手前衛が詰めている側へ向いた球は、ポーチされやすいので
      // ときどきオープン側（前衛のいない側）へ振り直す。常時ではなく確率的に
      // 補正し、配球が一辺倒にならないようにする。前衛がセンター付近のときは補正しない。
      const frontSign = oppFront.x >= 0 ? 1 : -1;
      if (Math.abs(oppFront.x) > 0.6 && Math.sign(course) === frontSign &&
          Math.random() < 0.6) {
        course = -frontSign * (0.55 + Math.random() * 0.35);
      }
      // 弱点狙い: 相手前衛・後衛のどちらも横移動で間に合わない地点が
      // 見つかったときは、高確率でそこを最優先で突く（決定打のチャンス）。
      // 常時ではなく確率的に効かせ、駆け引き（クロス/ストレートのセオリー）
      // による配球の読み合いを完全には上書きしない。
      const openX = findOpenCourseX(oppBack, oppFront);
      if (openX != null && Math.random() < 0.7) {
        course = Math.max(-1, Math.min(1, openX / 4.6));
      }
      const r = Math.random();
      const shot = r < 0.55 ? "drive" : (r < 0.75 ? "flat" : (r < 0.9 ? "lob" : "slice"));
      hitBall({
        hitter: hitter, side: side, shot: shot,
        course: course,
        contactZ: ball.z,
      });
    }
  }
}

// 後方互換ラッパー（メインループから呼ばれる）
export function cpuTryReturn() { tryReturnAI("cpu"); }
export function partnerTryReturn() {
  if (!spectatorMode) {
    // 人間モード: 操作キャラが届かないときだけパートナーが返す
    const partner = (rallyControlled === back) ? front : back;
    const isPartnerFront = partner === front; // プレイヤーが後衛→相方は前衛
    if (ball.lastHitter !== "cpu" || state !== "rally") return;
    const ai = TUNING.ai;
    const sm = TUNING.smash;
    // 攻守スライダー値（観戦時は中庸0.5固定）
    const aggr = spectatorMode ? 0.5 : partnerAggressiveness;

    // ---- 相方前衛のスマッシュ ----
    if (isPartnerFront &&
        !ball.frontChecked && ball.bounces === 0 &&
        partner.y < sm.netDist && partner.y > 0.4 &&
        ball.y > 0.6 && ball.y < sm.netDist && ball.z >= sm.minZ && ball.z < 2.3 &&
        canSwingNow(partner) &&
        Math.hypot(ball.x - partner.x, ball.y - partner.y) <= ai.poachReach * partner.stats.reach) {
      ball.frontChecked = true;
      if (Math.random() < 0.8 * partner.stats.volley) {
        hitBall({
          hitter: partner, side: "player", shot: "flat",
          course: (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6),
          contactZ: ball.z,
        });
        showMessage("相方のスマッシュ！");
        setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
        return;
      }
    }

    // ---- 相方前衛のポーチ（攻守スライダーで制御: プレイヤー=後衛のとき） ----
    // ポーチ確率: 守り(0)=0.15, 中(0.5)=0.45, 攻め(1)=0.75
    // 動き出し範囲: 攻めるほど ball.y が手前（大きい値）でも踏み込む (3.6〜5.2m)
    if (isPartnerFront &&
        !ball.frontChecked && ball.bounces === 0 &&
        ball.y > 0.6 && ball.y < (3.6 + aggr * 1.6) && ball.z < 2.0) {
      // 攻め度に応じたポーチリーチ（標準+最大0.6m拡大）
      const poachReach = (ai.frontVolleyReach + aggr * 0.6) * partner.stats.reach;
      if (canSwingNow(partner) && Math.hypot(ball.x - partner.x, ball.y - partner.y) <= poachReach) {
        ball.frontChecked = true;
        const poachChance = (0.15 + aggr * 0.6) * partner.stats.volley;
        if (Math.random() < poachChance) {
          // 相手後衛のいない側を突く（CPUポーチと対称ロジック）
          const targetCourse = (cpuBack.x > 0 ? -1 : 1) * (0.4 + Math.random() * 0.6);
          hitBall({
            hitter: partner, side: "player", shot: "flat",
            course: targetCourse,
            contactZ: ball.z,
          });
          const label = aggr >= 0.5 ? "相方のポーチ！" : "相方のボレー！";
          showMessage(label);
          setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
          return;
        }
      }
    }

    // ---- 相方前衛の通常ボレー ----
    if (isPartnerFront &&
        !ball.frontChecked && ball.bounces === 0 &&
        partner.y < 5.2 &&
        ball.y > 0.6 && ball.y < 4.8 && ball.z < 1.9 &&
        canSwingNow(partner) &&
        Math.hypot(ball.x - partner.x, ball.y - partner.y) <= VOLLEY_REACH) {
      ball.frontChecked = true;
      if (Math.random() < 0.5 * partner.stats.volley) {
        hitBall({
          hitter: partner, side: "player", shot: "flat",
          course: (Math.random() - 0.5) * 1.4,
          contactZ: ball.z,
        });
        showMessage("相方のボレー！");
        setTimeout(function () { if (state === "rally") hideMessage(); }, TUNING.tempo.rallyMsgHide);
        return;
      }
    }

    // ---- 相方後衛のストローク（操作キャラが届かないボールをカバー） ----
    // プレイヤー=前衛のとき（partner=back）: 攻守スライダーでコース選択を制御
    // 後衛返球と同様、頂点を過ぎて落ち始めた打点（vz <= 0）で打つ。
    if (ball.bounces === 1 && ball.z < 2.3 && ball.vz <= 0 &&
        !canPlayerHit(rallyControlled) &&
        canSwingNow(partner) &&
        distToBall(partner) <= CPU_REACH * partner.stats.reach &&
        distToBall(partner) < distToBall(rallyControlled)) {
      const shot = Math.random() < 0.8 ? "drive" : "lob";
      let course;
      if (!isPartnerFront) {
        // 相方=後衛（プレイヤー=前衛のケース）: 攻守でコース選択を変化
        // 守り寄り=クロス（相手前衛のいない側）重視, 攻め寄り=ストレート/前衛方向重視
        const straightChance = 0.15 + aggr * 0.65; // 守り=0.15, 中=0.475, 攻め=0.80
        if (Math.random() < straightChance) {
          // ストレート: 相手前衛(cpuFront)がいる側へ抜きにいく
          course = (cpuFront.x >= 0 ? 1 : -1) * (0.5 + Math.random() * 0.5);
        } else {
          // クロス: 相手前衛のいない側を安全に返す
          course = (cpuFront.x >= 0 ? -1 : 1) * (0.4 + Math.random() * 0.5);
        }
      } else {
        course = (Math.random() - 0.5) * 1.6;
      }
      hitBall({
        hitter: partner, side: "player", shot: shot,
        course: course,
        contactZ: ball.z,
      });
    }
    return;
  }
  // 観戦モード: 統一AIで返球
  tryReturnAI("player");
}
