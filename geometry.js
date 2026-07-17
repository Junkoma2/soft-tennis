/**
 * プレイヤーの向き（yaw）の単一の真実（single source of truth）。
 *
 * player3d.js の見た目（ballFacingYaw/travelYaw）が持っていた「ボールへ正対する」
 * 向きの算出ロジックを、描画から切り離してここに集約する。
 * hit-detection.js（届く判定）・matchLoop.js（打点評価）は、描画側の内部値に
 * 依存せずここを参照することで、見た目と判定が同じ向きを見る状態を保つ。
 *
 * 静止時・向き情報が無いときはこれまで通りネット正対（baseYaw）をデフォルトにする。
 */
import { back, front, cpuBack, cpuFront, ball, state } from "./state.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

const DEG = Math.PI / 180;

/* ---- 頭部のボール追従（見た目専用） ----
 * player3d.js が各ポーズ適用後に joints.head へ加算する、体の正対からの
 * 追加回転量（左右=yaw・上下=pitch）をここで計算する。角度の単一の真実は
 * このファイルに置き、player3d.js 側は補間・スケール調整のみ行う。
 */

// 現実の首の可動域を超えて背後のボールへ180度近く回転させたり、直上のトスを
// 真上まで見上げさせたりすると不自然に見えるため、体の正対(bodyYaw)からの
// 追加回転量として上限を設ける（over-the-shoulder程度で頭部の回転を止める）。
const HEAD_YAW_MAX = 95 * DEG;
const HEAD_PITCH_UP_MAX = 55 * DEG;   // 見上げの上限（サーブトス等）
const HEAD_PITCH_DOWN_MAX = 40 * DEG; // 見下げの上限（足元付近の低い球）
// 至近距離（トス直下等、水平距離がほぼ0）でatan2の仰角が発散しないための下限(m)。
const HEAD_LOOK_MIN_DIST = 0.4;

// 体の正対yaw(bodyYaw)から見てボール方向を向くために頭部へ追加すべき
// 左右回転量(ラジアン)。プレイヤーとボールが同じ位置（水平距離ほぼ0）の
// ときは向きが定まらないため0を返す。
export function headYawOffset(pl, ballX, ballY, bodyYaw) {
  const dx = ballX - pl.x, dy = ballY - pl.y;
  if (Math.hypot(dx, dy) < 1e-4) return 0;
  const ballYaw = Math.atan2(dx, dy);
  return clamp(angleDelta(bodyYaw, ballYaw), -HEAD_YAW_MAX, HEAD_YAW_MAX);
}

// 頭部の高さ(headHeight)からボール(ballZ)を見るための上下回転量(ラジアン)。
// simpleCharacter3d.js の head 関節は rotation.x が正で見下げ・負で見上げになる
// （applyPose の回転規約）ため、仰角(elevation)の符号を反転して返す。
export function headPitchOffset(headHeight, ballZ, horizontalDist) {
  const dist = Math.max(HEAD_LOOK_MIN_DIST, horizontalDist);
  const elevation = Math.atan2(ballZ - headHeight, dist);
  return clamp(-elevation, -HEAD_PITCH_UP_MAX, HEAD_PITCH_DOWN_MAX);
}

// 頭部トラッキングを行ってよい試合状態か（ポイント終了・試合開始前・
// フォルト直後などボールが「今まさに見るべき対象」ではない状態を除外する）。
function headTrackStateActive(s) {
  return s === "rally" || s === "serve-toss" || s === "serve-stance";
}

// このプレイヤーが今フレーム頭部へ追加すべき回転量(yaw/pitch、ラジアン)。
// 状態が無効・ボール座標が無効なときは {yaw:0, pitch:0, active:false} を返し、
// 呼び出し側（player3d.js）がそのまま補間すると自然に正面へ戻る。
export function headTrackTarget(pl, bodyYaw, headHeight) {
  if (!headTrackStateActive(state) || !ball ||
      !Number.isFinite(ball.x) || !Number.isFinite(ball.y) || !Number.isFinite(ball.z)) {
    return { yaw: 0, pitch: 0, active: false };
  }
  const dist = Math.hypot(ball.x - pl.x, ball.y - pl.y);
  return {
    yaw: headYawOffset(pl, ball.x, ball.y, bodyYaw),
    pitch: headPitchOffset(headHeight, ball.z, dist),
    active: true,
  };
}

// current から target へ dt 秒分だけ指数関数的に近づける（急な切り替えを補間し、
// 首が振動・瞬間反転して見えるのを防ぐ）。player3d.js の smoothYawFor と同じ式。
export function smoothHeadAngle(current, target, dt, rate) {
  if (!Number.isFinite(current)) return target;
  const r = rate != null ? rate : 10;
  const alpha = 1 - Math.exp(-Math.max(0, dt) * r);
  return current + (target - current) * alpha;
}

// ネット正対の基準yaw（静止時のデフォルト）。
export function baseYawFor(pl) {
  return (pl.facing < 0) ? Math.PI : 0;
}

// このプレイヤー側に向かって（バウンド前後を問わず）ボールが来ているかどうか。
function ballComingToSide(pl) {
  if (state !== "rally" || ball.serving || Math.hypot(ball.vx, ball.vy) < 0.2) return false;
  const mySide = (pl === back || pl === front) ? "player" : "cpu";
  const towardPlayer = ball.lastHitter === "cpu" && ball.vy > 0;
  const towardCpu = ball.lastHitter === "player" && ball.vy < 0;
  return (mySide === "player" && towardPlayer) || (mySide === "cpu" && towardCpu);
}

// 体の正対先（構え〜追走中）: 通常はネット向き(baseYaw)。自分側へ球が来ている間は、
// 懐（打てる角度）が変わるよう球の来る向きへ少し体を開く。
export function ballFacingYaw(pl) {
  const base = baseYawFor(pl);
  if (!ballComingToSide(pl)) return base;
  const courseYaw = Math.atan2(-ball.vx, -ball.vy);
  return base + clamp(angleDelta(base, courseYaw), -0.6, 0.6);
}

// 打点判定・当たり判定に使う「体の正対yaw」。
// ballFacingYawをそのまま採用し、静止時・向き情報が無いときはネット正対にフォールバックする。
export function contactYawFor(pl) {
  const yaw = ballFacingYaw(pl);
  return Number.isFinite(yaw) ? yaw : baseYawFor(pl);
}

// ワールド座標(dx, dy)（例: ball.x/y - hitter.x/y）を、プレイヤーの正対yawが
// baseYaw（ネット正対）からズレた分だけ回転してローカル座標へ変換する。
// baseYawとの「差分」だけを回転に使うため、yaw===baseYaw（ネット正対のまま）の
// ときは常に lateral=dx, forward=dy と一致し、従来のワールド軸固定の評価と
// 完全に同じ結果になる（既存の前衛レシーブ深さ等の挙動を変えないための設計）。
// yawがballFacingYawでネット正対から開くと、その開いた分だけ懐の軸が回転する。
export function toLocal(pl, dx, dy, yaw) {
  const useYaw = yaw != null ? yaw : contactYawFor(pl);
  const delta = angleDelta(baseYawFor(pl), useYaw); // ネット正対からの回転量
  const sin = Math.sin(delta), cos = Math.cos(delta);
  const lateral = dx * cos - dy * sin;
  const forward = dx * sin + dy * cos;
  return { lateral, forward };
}

// toLocal の逆変換。体ローカル座標(lateral, forward)を、プレイヤーのyawに応じて
// ワールド座標のオフセット(dx, dy)へ戻す（デバッグ描画で判定ゾーンを可視化するために使う）。
export function fromLocal(pl, lateral, forward, yaw) {
  const useYaw = yaw != null ? yaw : contactYawFor(pl);
  const delta = angleDelta(baseYawFor(pl), useYaw);
  const sin = Math.sin(delta), cos = Math.cos(delta);
  const dx = lateral * cos + forward * sin;
  const dy = -lateral * sin + forward * cos;
  return { dx, dy };
}
