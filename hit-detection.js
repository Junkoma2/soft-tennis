import { TUNING, G } from "./config.js";
import { ball } from "./state.js";

function foreDirFor(p) {
  const handSign = p.stats && p.stats.handed === "left" ? -1 : 1;
  return -(p.facing || -1) * handSign;
}

function hitWindowFor(p, contactX) {
  const foreDir = foreDirFor(p);
  const side = (contactX - p.x) * foreDir >= 0 ? "fore" : "back";
  const roleScale = p.role === "front" ? 0.86 : 1;
  const reachScale = Math.max(0.82, Math.min(1.18, p.stats?.reach || 1));
  const foreWidth = 0.96 * roleScale * reachScale;
  const backWidth = 0.58 * roleScale * reachScale;
  return { side, foreDir, foreWidth, backWidth, width: side === "fore" ? foreWidth : backWidth };
}

export function predictLineContactAtY(targetY) {
  if (!Number.isFinite(targetY) || Math.abs(ball.vy) < 0.05) return null;
  if ((targetY - ball.y) * ball.vy < -0.01) return null;

  let x = ball.x;
  let y = ball.y;
  let z = ball.z;
  let vx = ball.vx;
  let vy = ball.vy;
  let vz = ball.vz;
  let bounces = ball.bounces;
  const dt = 0.025;
  const dragPerStep = Math.max(0, 1 - (TUNING.airDrag || 0) * dt);

  for (let i = 0; i < 90; i++) {
    const px = x, py = y, pz = z;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    vz -= G * dt;
    vx *= dragPerStep;
    vy *= dragPerStep;

    if ((py - targetY) * (y - targetY) <= 0 && Math.abs(y - py) > 1e-4) {
      const t = (targetY - py) / (y - py);
      return {
        x: px + (x - px) * t,
        y: targetY,
        z: Math.max(0, pz + (z - pz) * t),
        time: (i + t) * dt,
        bounces,
      };
    }

    if (z <= 0 && vz < 0) {
      bounces++;
      if (bounces > 2) return null;
      z = 0;
      const sp = TUNING.spin[ball.spin] || TUNING.spin.flat;
      const flat = TUNING.spin.flat;
      const k = Math.min(1.3, Math.max(0, ball.spinMag != null ? ball.spinMag : 1));
      const friction = Math.max(0.3, Math.min(0.97, flat.friction + (sp.friction - flat.friction) * k));
      const restitution = Math.max(0.12, Math.min(0.78, flat.restitution + (sp.restitution - flat.restitution) * k));
      vx *= friction;
      vy *= friction;
      vz = -vz * restitution;
    }
  }
  return null;
}

export function hitLineInfo(p) {
  const contact = predictLineContactAtY(p.y);
  const fallbackWindow = hitWindowFor(p, p.x);
  if (!contact) {
    return {
      contact: null,
      active: false,
      distanceX: Infinity,
      side: "fore",
      foreDir: fallbackWindow.foreDir,
      foreWidth: fallbackWindow.foreWidth,
      backWidth: fallbackWindow.backWidth,
      width: 0,
    };
  }
  const highPenalty = Math.max(0, contact.z - 2.05) * 0.42;
  const lowPenalty = Math.max(0, 0.28 - contact.z) * 0.7;
  const window = hitWindowFor(p, contact.x);
  const distanceX = Math.abs(contact.x - p.x) + highPenalty + lowPenalty;
  return {
    contact,
    active: distanceX <= window.width && contact.z <= 2.4,
    distanceX,
    side: window.side,
    foreDir: window.foreDir,
    foreWidth: window.foreWidth,
    backWidth: window.backWidth,
    width: window.width,
  };
}
