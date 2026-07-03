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
