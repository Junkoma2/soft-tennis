import { W, H, CAM } from "./config.js";
import { canvas } from "./state.js";

export function project(x, y, z) {
  const dy = CAM.y - y;
  const dz = z - CAM.z;
  const depth = dy * CAM.cos - dz * CAM.sin;
  const up = dy * CAM.sin + dz * CAM.cos;
  const s = CAM.fov / Math.max(depth, 0.5);
  return {
    x: W / 2 + x * s,
    y: CAM.horizonY - up * s,
    s: s,          // px/m 換算（奥行きスケール）
    depth: depth,
  };
}

/* 内部解像度(960×540)のスクリーン点 → 地面(z=0)のワールド座標へ逆投影する。
 * project() の幾何を z=0 で解いたもの。マウスが指すコート地点を求めるのに使う。
 *   depth = dy*cos + CAM.z*sin,  up = dy*sin - CAM.z*cos   （dy = CAM.y - y）
 *   sy = horizonY - up*(fov/depth)  を dy について解く。
 * 地平線より上（depth<=0）など解が手前に来ない場合は null を返す。 */
export function unproject(sx, sy) {
  const k = (CAM.horizonY - sy) / CAM.fov;
  const denom = CAM.sin - k * CAM.cos;
  if (Math.abs(denom) < 1e-6) return null; // 地平線方向（交点が無限遠）
  const dy = CAM.z * (CAM.cos + k * CAM.sin) / denom;
  const depth = dy * CAM.cos + CAM.z * CAM.sin;
  if (depth <= 0.5) return null;           // カメラ後方／地平線より上
  const s = CAM.fov / depth;
  return { x: (sx - W / 2) / s, y: CAM.y - dy };
}

/* マウスのクライアント座標(イベントの clientX/Y) を内部解像度のスクリーン座標へ。
 * canvas の実表示サイズと内部960×540のスケール差を換算する。 */
export function clientToCanvas(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { sx: W / 2, sy: H / 2 };
  return {
    sx: (clientX - rect.left) / rect.width * W,
    sy: (clientY - rect.top) / rect.height * H,
  };
}

export function clamp01(v) { return Math.max(0, Math.min(1, v)); }
export function lerp(a, b, k) { return a + (b - a) * k; }

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
