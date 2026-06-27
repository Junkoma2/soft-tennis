import { COURT } from "./config.js";
import { state, ball, receiveDone, formation } from "./state.js";
import {
  serverTeamNow, currentServer, receiverPlayerFor, receivePosition,
} from "./serve.js";
import {
  predictLanding, predictHighContact, predictStrokeContact, insideCourt,
} from "./main.js";
import { moveToward } from "./aiPositioning.js";
import { getCpuStyle, evaluateSituation } from "./aiContext.js";
import { decideTask, executeTask } from "./aiTask.js";

/* ===========================================================
 * フェーズ処理: serve / receive / rally
 *
 * moveAutoAI は decideAIPhase でフェーズを判定し、各 update*PhaseAI へ委譲する。
 *   serve   … サーブ前の待機・レシーブ位置取り
 *   receive … 相手サーブの返球（レシーブ担当の追走）・前衛のサービスダッシュ
 *   rally   … 状況評価 → タスク決定 → タスク実行
 * 既存挙動を変えないため、元 moveAutoAI と同じ判定順・同じガードを保つ。
 * =========================================================== */

// いまのフェーズを返す。serve-stance/toss はサーブ、初回返球前(!receiveDone)はレシーブ、それ以外はラリー。
export function decideAIPhase(p, ctx) {
  if (state === "serve-stance" || state === "serve-toss") return "serve";
  if (!receiveDone) return "receive";
  return "rally";
}

// サーブ前フェーズ: 自分がサーバーなら動かない。相手サーブ中はレシーバーだけが
// レシーブ位置へ。それ以外（自分のサーブ前の味方）は持ち場で待つ＝動かさない。
export function updateServePhaseAI(p, ctx, dt) {
  const { myTeam, opponentTeam, speed } = ctx;

  // 自分がサーブを打つ前はサーブ位置から動かない
  if (serverTeamNow() === myTeam && currentServer() === p) return;

  // 相手サーブ中: レシーバー担当ならレシーブ位置へ、それ以外は定位置で待機
  if (serverTeamNow() === opponentTeam) {
    if (p === receiverPlayerFor(myTeam)) {
      const rp = receivePosition(myTeam);
      moveToward(p, rp.x, rp.y, speed * 1.2 * dt, dt);
    }
    return;
  }

  // 自分のサーブ前は、サーバー以外（味方前衛など）も持ち場で待つ（センターを越えない）。
}

// レシーブフェーズ: 初回返球が済むまで(!receiveDone)の処理。
//   ① 相手サーブ飛来中はレシーブ担当だけがボールを追う（非担当は持ち場で待つ）。
//   ② 前衛はレシーブ完了まで動かない。ただし自分がサーブした直後のダッシュは始めてよい。
// 処理しきった（＝rallyへ進ませない）場合のみ true を返す。false ならラリー処理へ流す。
export function updateReceivePhaseAI(p, ctx, dt) {
  const { myTeam, opponentTeam, homeSign, speed, netPlayer, basePlayer, myJustServedByFront } = ctx;

  // ① 相手サーブが飛んでいる間は、レシーブ担当だけがボールを追う。
  // 担当でない味方はその場で待機（前衛がレシーバーの逆クロスでも後衛が追ってしまうバグ防止）。
  if (!receiveDone && state === "rally" && ball.lastHitter === opponentTeam) {
    if (p === receiverPlayerFor(myTeam)) {
      const landing = predictLanding();
      const strokeContact = predictStrokeContact();
      let tx = p.x, ty = p.y;
      if (ball.bounces >= 1) {
        const cx = strokeContact ? strokeContact.x : ball.x + ball.vx * 0.2;
        const cy = strokeContact ? strokeContact.y : ball.y + ball.vy * 0.2;
        tx = cx;
        ty = homeSign > 0 ? Math.min(COURT.halfL + 5.0, Math.max(4.0, cy))
                          : Math.max(-(COURT.halfL + 5.0), Math.min(-4.0, cy));
      } else if (landing && landing.y * homeSign > 0 && insideCourt(landing.x, landing.y)) {
        // サーブも球種・速さからバウンド後の頂点を予測し、そこで高い打点で迎える。
        const hc = predictHighContact();
        const contact = strokeContact || hc;
        let depth = contact ? Math.abs(contact.y) : Math.abs(landing.y) + 0.6;
        depth = Math.min(COURT.halfL + 5.0, Math.max(Math.abs(landing.y), depth));
        tx = Math.max(-COURT.halfW, Math.min(COURT.halfW, contact ? contact.x : landing.x));
        ty = homeSign > 0 ? depth : -depth;
      }
      moveToward(p, tx, ty, speed * 1.25 * dt, dt);
      p.x = Math.max(-7.5, Math.min(7.5, p.x));
    }
    return true;
  }

  // ② 前寄り(netPlayer)役はレシーブが完了するまでポジション移動しない。
  // ただし自分がサーブした直後のサービスダッシュは始めてよい。
  if (p === netPlayer && !receiveDone) {
    if (state === "rally" && myJustServedByFront) {
      const style = getCpuStyle(netPlayer);
      const dashTargetX = formation === "double-back"
        ? (basePlayer.x > 0 ? -2.2 : 2.2)
        : netPlayer.homeX * (basePlayer.x > 0 ? -1 : 1);
      moveToward(netPlayer, dashTargetX, netPlayer.homeY, speed * (1.0 + style.netBias * 0.4) * dt, dt);
      netPlayer.x = Math.max(-4.6, Math.min(4.6, netPlayer.x));
    }
    return true;
  }

  return false;
}

// ラリーフェーズ: 状況評価 → タスク決定 → タスク実行。
export function updateRallyPhaseAI(p, ctx, dt) {
  const { myTeam, netPlayer, myJustServedByFront } = ctx;
  const isNet = (p === netPlayer);

  // ② 状況評価（チャンス/危険/展開/ロブ等）。formation/役割で分岐せず共通で評価する。
  ctx.situation = evaluateSituation(myTeam);
  // role: 個性パラメータ生成用の補助ラベル（前寄り/後ろ寄り）。判断は positionBias / 位置で行う。
  ctx.role = isNet ? "front" : "back";
  ctx.style = getCpuStyle(p);
  // サーブ直後のサービスダッシュ係数（前寄り選手のみ加速）
  ctx.dash = (state === "rally" && myJustServedByFront && isNet) ? 1.4 : 1.0;

  // ③④ タスク決定 + ⑤ タスク実行
  const task = decideTask(p, ctx);
  executeTask(p, ctx, task, dt);

  // 前寄りは横移動レンジを狭く、後ろ寄りは広く取る（コート端まで走るのは後衛側）。
  if (isNet) {
    p.x = Math.max(-4.6, Math.min(4.6, p.x));
  } else {
    p.x = Math.max(-7.5, Math.min(7.5, p.x));
  }
}
