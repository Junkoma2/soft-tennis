import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { createCharacter } from "./simpleCharacter3d.js";
import { applyPose, applyLeftHandGrip, applySwingPhase } from "./animation3d.js";

const canvas = document.getElementById("viewer-canvas");
const modelSelect = document.getElementById("model-select");
const motionSelect = document.getElementById("motion-select");
const phaseRange = document.getElementById("phase-range");
const phaseOutput = document.getElementById("phase-output");
const speedRange = document.getElementById("speed-range");
const speedOutput = document.getElementById("speed-output");
const playButton = document.getElementById("play-button");
const restartButton = document.getElementById("restart-button");
const playState = document.getElementById("play-state");
const roleBadge = document.getElementById("role-badge");
const motionLabel = document.getElementById("motion-label");
const poseCode = document.getElementById("pose-code");
const poseDescription = document.getElementById("pose-description");

const MODEL_COLORS = {
  blue: { shirtColor: 0x3f6df6, shortsColor: 0x172652, hairColor: 0x2a2018 },
  orange: { shirtColor: 0xff754d, shortsColor: 0x3f2430, hairColor: 0x32231b },
  mint: { shirtColor: 0x35c79a, shortsColor: 0x183c37, hairColor: 0x202622 },
};

const MOTIONS = {
  rear: [
    { id: "rearReady", label: "構え", pose: "rearReady", description: "低い重心と、ストロークへ移りやすい後衛の構え。" },
    { id: "rearForehandSwing", label: "フォアストローク（連続）", swing: "fore", description: "テイクバックから打点、フォロースルー、構えへの復帰までを連続再生。" },
    { id: "rearForehandTakeback", label: "フォアストローク：テイクバック", pose: "rearForehandTakeback", description: "肩と体幹を回し、後ろ足へためを作る局面。" },
    { id: "rearForehandContact", label: "フォアストローク：打点", pose: "rearForehandContact", description: "身体の前でラケットを加速させるインパクト局面。" },
    { id: "rearForehandFollow", label: "フォアストローク：フォロー", pose: "rearForehandFollow", description: "打球方向へ体重を運び、自然に振り抜いた局面。" },
    { id: "backhandSwing", label: "バックストローク（参考）", swing: "back", description: "既存のバックハンドを連続再生します。" },
  ],
  front: [
    { id: "ready", label: "構え", pose: "ready", description: "ネット前で素早く反応するための、ラケットを高く保った構え。" },
    { id: "forehandVolleyTakeback", label: "フォアボレー：テイクバック", pose: "forehandVolleyTakeback", description: "引きすぎず、身体の前で捉えるためのボレーテイクバック。" },
    { id: "frontForehandSwing", label: "フォアスイング（参考）", swing: "fore", description: "前衛用の既存フォアスイングを連続再生します。" },
    { id: "forehandTakeback", label: "フォア：テイクバック", pose: "forehandTakeback", description: "前衛用フォアスイングの開始姿勢。" },
    { id: "forehandContact", label: "フォア：打点", pose: "forehandContact", description: "前衛用フォアスイングの打点姿勢。" },
    { id: "forehandFollow", label: "フォア：フォロー", pose: "forehandFollow", description: "前衛用フォアスイングの振り抜き姿勢。" },
  ],
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x167a55, 7, 12);

const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
camera.position.set(0, 1.25, 4.5);
camera.lookAt(0, 0.9, 0);

scene.add(new THREE.HemisphereLight(0xf7fff4, 0x184936, 2.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.3);
keyLight.position.set(3, 5, 4);
keyLight.castShadow = true;
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xd9ff8a, 1.7);
rimLight.position.set(-4, 2, -3);
scene.add(rimLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(2.25, 64),
  new THREE.MeshStandardMaterial({ color: 0x0d6045, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(1.55, 1.57, 64),
  new THREE.MeshBasicMaterial({ color: 0xd9ff43, transparent: true, opacity: 0.65, side: THREE.DoubleSide })
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.008;
scene.add(ring);

let character = null;
let role = "rear";
let handed = "right";
let playing = true;
let phase = 0;
let speed = 1;
let modelYaw = 0;
let targetYaw = 0;
let cameraDistance = 4.5;
let lastTime = performance.now();
let dragging = false;
let dragX = 0;

function createSelectedModel() {
  if (character) scene.remove(character.group);
  character = createCharacter(MODEL_COLORS[modelSelect.value]);
  character.group.scale.x = handed === "right" ? -1 : 1;
  scene.add(character.group);
  applyCurrentMotion();
}

function getMotion() {
  return MOTIONS[role].find((motion) => motion.id === motionSelect.value) || MOTIONS[role][0];
}

function populateMotions() {
  motionSelect.replaceChildren(...MOTIONS[role].map((motion) => {
    const option = document.createElement("option");
    option.value = motion.id;
    option.textContent = motion.label;
    return option;
  }));
  motionSelect.value = MOTIONS[role][0].id;
  phase = 0;
  updateInterface();
}

function applyCurrentMotion() {
  if (!character) return;
  const motion = getMotion();
  const baseHipY = character.group.userData.dims.hipY;

  if (motion.swing) {
    const activeEnd = 0.62;
    const returnStart = 0.78;
    const isFront = role === "front";
    const followPose = motion.swing === "back"
      ? "backhandFollow"
      : (isFront ? "forehandFollow" : "rearForehandFollow");
    const readyPose = isFront ? "ready" : "rearReady";

    if (phase <= activeEnd) {
      applySwingPhase(character.joints, motion.swing, phase / activeEnd, baseHipY, isFront);
    } else if (phase < returnStart) {
      applyPose(character.joints, followPose, followPose, 1, baseHipY);
    } else {
      applyPose(character.joints, followPose, readyPose, (phase - returnStart) / (1 - returnStart), baseHipY);
    }
  } else {
    applyPose(character.joints, motion.pose, motion.pose, 1, baseHipY);
    if (motion.pose === "ready" || motion.pose === "rearReady" || motion.pose === "forehandVolleyTakeback") {
      applyLeftHandGrip(character.joints, character.group.userData.dims, character.group);
    }
  }
}

function updateInterface() {
  const motion = getMotion();
  roleBadge.textContent = role === "rear" ? "後衛" : "前衛";
  motionLabel.textContent = motion.label;
  poseCode.textContent = motion.swing
    ? `${role === "front" ? "front" : "rear"}:${motion.swing} swing`
    : motion.pose;
  poseDescription.textContent = motion.description;
  phaseRange.disabled = !motion.swing;
  playButton.disabled = !motion.swing;
  restartButton.disabled = !motion.swing;
  phaseRange.value = Math.round(phase * 100);
  phaseOutput.value = `${Math.round(phase * 100)}%`;
  playState.textContent = motion.swing ? (playing ? "再生中" : "停止中") : "静止画";
  playButton.textContent = playing ? "一時停止" : "再生";
}

function setView(view) {
  targetYaw = view === "side" ? -Math.PI / 2 : view === "back" ? Math.PI : 0;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
}

modelSelect.addEventListener("change", createSelectedModel);
motionSelect.addEventListener("change", () => {
  phase = 0;
  playing = true;
  updateInterface();
  applyCurrentMotion();
});

document.querySelectorAll('input[name="role"]').forEach((input) => {
  input.addEventListener("change", () => {
    role = input.value;
    populateMotions();
    applyCurrentMotion();
  });
});

document.querySelectorAll('input[name="handed"]').forEach((input) => {
  input.addEventListener("change", () => {
    handed = input.value;
    character.group.scale.x = handed === "right" ? -1 : 1;
  });
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

playButton.addEventListener("click", () => {
  playing = !playing;
  updateInterface();
});

restartButton.addEventListener("click", () => {
  phase = 0;
  playing = true;
  updateInterface();
});

phaseRange.addEventListener("input", () => {
  phase = Number(phaseRange.value) / 100;
  playing = false;
  updateInterface();
  applyCurrentMotion();
});

speedRange.addEventListener("input", () => {
  speed = Number(speedRange.value);
  speedOutput.value = `${speed.toFixed(2).replace(/0$/, "")}×`;
});

canvas.addEventListener("pointerdown", (event) => {
  dragging = true;
  dragX = event.clientX;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  targetYaw += (event.clientX - dragX) * 0.012;
  dragX = event.clientX;
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.remove("is-active"));
});

canvas.addEventListener("pointerup", () => { dragging = false; });
canvas.addEventListener("pointercancel", () => { dragging = false; });
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  cameraDistance = THREE.MathUtils.clamp(cameraDistance + event.deltaY * 0.003, 3.2, 6.2);
}, { passive: false });

function resizeRenderer() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = renderer.getPixelRatio();
  if (canvas.width !== Math.floor(width * pixelRatio) || canvas.height !== Math.floor(height * pixelRatio)) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function animate(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const motion = getMotion();
  if (motion.swing && playing) {
    phase = (phase + dt * speed / 2.2) % 1;
    applyCurrentMotion();
    phaseRange.value = Math.round(phase * 100);
    phaseOutput.value = `${Math.round(phase * 100)}%`;
  }

  modelYaw += (targetYaw - modelYaw) * Math.min(1, dt * 9);
  character.group.rotation.y = modelYaw;
  camera.position.z += (cameraDistance - camera.position.z) * Math.min(1, dt * 8);
  resizeRenderer();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

populateMotions();
createSelectedModel();
requestAnimationFrame(animate);
