import {
  debugControls, debugDraw,
  setDebugHitboxes, setDebugTrajectory, setDebugParams,
} from "./state.js";

function syncDebugButtons() {
  debugControls.querySelectorAll("[data-debug]").forEach((b) => {
    const active = b.dataset.debug === "hitboxes" ? debugDraw.hitboxes
      : b.dataset.debug === "trajectory" ? debugDraw.trajectory
      : debugDraw.params;
    b.classList.toggle("is-active", active);
  });
}

function toggleDebugButton(b, onChange) {
  if (b.dataset.debug === "hitboxes") setDebugHitboxes(!debugDraw.hitboxes);
  if (b.dataset.debug === "trajectory") setDebugTrajectory(!debugDraw.trajectory);
  if (b.dataset.debug === "params") setDebugParams(!debugDraw.params);
  syncDebugButtons();
  if (onChange) onChange();
}

export function setupDebugControls(onChange) {
  if (!debugControls) return;
  debugControls.querySelectorAll("[data-debug]").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleDebugButton(b, onChange);
    });
  });
  syncDebugButtons();
}
