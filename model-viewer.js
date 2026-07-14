import * as THREE from "./vendor/three/three.module.js";
import { createCharacter } from "./simpleCharacter3d.js";
import { POSES, applyPose, applyLeftHandGrip, applySwingPhase } from "./animation3d.js";

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
const debugAxisToggle = document.getElementById("debug-axis-toggle");
const sideMarkerToggle = document.getElementById("side-marker-toggle");
const jointAxisToggle = document.getElementById("joint-axis-toggle");
const tunePartSelect = document.getElementById("tune-part-select");
const tunePoseCode = document.getElementById("tune-pose-code");
const tuneControls = document.getElementById("tune-controls");
const tuneResetButton = document.getElementById("tune-reset-button");
const tuneCopyButton = document.getElementById("tune-copy-button");
const exportJsonButton = document.getElementById("export-json-button");
const exportJsButton = document.getElementById("export-js-button");
const exportStatus = document.getElementById("export-status");
const formChecklist = document.getElementById("form-checklist");
const formMetrics = document.getElementById("form-metrics");

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
    { id: "rearForehandLoad", label: "フォアストローク：ため", pose: "rearForehandLoad", description: "テイクバックから打点へ入る前のため局面。" },
    { id: "rearForehandContact", label: "フォアストローク：打点", pose: "rearForehandContact", description: "身体の前でラケットを加速させるインパクト局面。" },
    { id: "rearForehandDrive", label: "フォアストローク：押し出し", pose: "rearForehandDrive", description: "打点からフォローへ水平に抜ける中間局面。" },
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

const SWING_EDIT_KEYS = {
  rearForehandSwing: [
    { p: 0.0, pose: "rearForehandTakeback" },
    { p: 0.30, pose: "rearForehandLoad" },
    { p: 0.52, pose: "rearForehandContact" },
    { p: 0.64, pose: "rearForehandDrive" },
    { p: 0.78, pose: "rearForehandFollow" },
  ],
  frontForehandSwing: [
    { p: 0.0, pose: "forehandTakeback" },
    { p: 0.48, pose: "forehandContact" },
    { p: 0.74, pose: "forehandFollow" },
  ],
  backhandSwing: [
    { p: 0.0, pose: "backhandTakeback" },
    { p: 0.40, pose: "backhandContact" },
    { p: 1.0, pose: "backhandFollow" },
  ],
};

const TUNE_PARTS = [
  { id: "bodyLean", label: "全身の前傾", type: "scalar", key: "bodyLean", min: -25, max: 25, step: 1, unit: "deg", axes: ["value"], joint: "leanRoot" },
  { id: "pelvis", label: "骨盤・重心", type: "pelvis", joint: "pelvis" },
  { id: "chest", label: "胸", type: "rotation", joint: "chest" },
  { id: "head", label: "頭", type: "rotation", joint: "head" },
  { id: "shoulderR", label: "右肩", type: "rotation", joint: "shoulderR" },
  { id: "elbowR", label: "右ひじ", type: "rotation", joint: "elbowR" },
  { id: "handR", label: "右手首", type: "rotation", joint: "handR" },
  { id: "racket", label: "ラケット", type: "rotation", joint: "racket" },
  { id: "shoulderL", label: "左肩", type: "rotation", joint: "shoulderL" },
  { id: "elbowL", label: "左ひじ", type: "rotation", joint: "elbowL" },
  { id: "hipR", label: "右股関節", type: "rotationWithOffset", joint: "hipR" },
  { id: "kneeR", label: "右ひざ", type: "rotation", joint: "kneeR" },
  { id: "footR", label: "右足首", type: "rotation", joint: "footR" },
  { id: "hipL", label: "左股関節", type: "rotationWithOffset", joint: "hipL" },
  { id: "kneeL", label: "左ひざ", type: "rotation", joint: "kneeL" },
  { id: "footL", label: "左足首", type: "rotation", joint: "footL" },
];

const DEFAULT_POSES = JSON.parse(JSON.stringify(POSES));
const ROTATION_AXES = [
  { key: "x", label: "X", color: 0xff4b4b },
  { key: "y", label: "Y", color: 0x38b66a },
  { key: "z", label: "Z", color: 0x4d8dff },
];
const POSITION_AXES = [
  { key: "x", label: "X位置", color: 0xff4b4b, min: -0.3, max: 0.3, step: 0.005, unit: "m" },
  { key: "y", label: "Y位置", color: 0x38b66a, min: -0.2, max: 0.2, step: 0.005, unit: "m" },
  { key: "z", label: "Z位置", color: 0x4d8dff, min: -0.35, max: 0.35, step: 0.005, unit: "m" },
];

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

const debugAxes = new THREE.Group();
const racketHeadAxis = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.42, 0xffd400, 0.08, 0.045);
const racketFaceAxis = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.34, 0x22d3ee, 0.07, 0.04);
const racketGripAxis = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 0.24, 0x111111, 0.055, 0.032);
debugAxes.add(racketHeadAxis, racketFaceAxis, racketGripAxis);
scene.add(debugAxes);

const jointAxes = new THREE.Group();
const jointAxisX = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.34, 0xff4b4b, 0.07, 0.04);
const jointAxisY = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.34, 0x38b66a, 0.07, 0.04);
const jointAxisZ = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.34, 0x4d8dff, 0.07, 0.04);
jointAxes.add(jointAxisX, jointAxisY, jointAxisZ);
scene.add(jointAxes);

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
const SWING_LOOP_SECONDS = 0.5;
let modelYaw = 0;
let targetYaw = 0;
let cameraDistance = 5.25;
let cameraMinDistance = 3.2;
let cameraMaxDistance = 7.2;
let cameraUserAdjusted = false;
let lastTime = performance.now();
let dragging = false;
let dragX = 0;
let dragStartX = 0;
let dragStartY = 0;
let renderedTunePoseName = "";
let renderedTunePartId = "";

const _worldA = new THREE.Vector3();
const _worldB = new THREE.Vector3();
const _localA = new THREE.Vector3();
const _localB = new THREE.Vector3();
const _axisOrigin = new THREE.Vector3();
const _axisDir = new THREE.Vector3();
const _pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

function characterLocalPoint(object, localPoint, out) {
  object.localToWorld(out.copy(localPoint));
  character.group.worldToLocal(out);
  return out;
}

function characterLocalPosition(object, out) {
  object.getWorldPosition(out);
  character.group.worldToLocal(out);
  return out;
}

function setAxis(helper, origin, direction, length) {
  helper.position.copy(origin);
  helper.setDirection(_axisDir.copy(direction).normalize());
  helper.setLength(length);
}

function getSelectedPart() {
  return TUNE_PARTS.find((part) => part.id === tunePartSelect.value) || TUNE_PARTS[0];
}

function getEditablePoseName() {
  const motion = getMotion();
  if (!motion.swing) return motion.pose;
  const keys = SWING_EDIT_KEYS[motion.id] || [];
  if (!keys.length) return motion.pose || "ready";
  return keys.reduce((best, key) => (
    Math.abs(key.p - phase) < Math.abs(best.p - phase) ? key : best
  ), keys[0]).pose;
}

function ensureVector(target, key) {
  if (!target[key]) target[key] = { x: 0, y: 0, z: 0 };
  return target[key];
}

function getPartValue(pose, part, axis) {
  if (part.type === "scalar") return pose[part.key] || 0;
  if (part.type === "pelvis") {
    if (axis === "lift") return pose.rootLift || 0;
    if (axis === "turn") return pose.pelvisTurn || 0;
    if (axis === "shiftX") return pose.rootShiftX || 0;
    if (axis === "shiftZ") return pose.rootShiftZ || 0;
  }
  if (axis.startsWith("offset")) {
    const offset = pose[`${part.id}Offset`] || {};
    return offset[axis.slice(-1).toLowerCase()] || 0;
  }
  const rotation = pose[part.id] || {};
  return rotation[axis] || 0;
}

function setPartValue(pose, part, axis, value) {
  if (part.type === "scalar") {
    pose[part.key] = value;
    return;
  }
  if (part.type === "pelvis") {
    if (axis === "lift") pose.rootLift = value;
    if (axis === "turn") pose.pelvisTurn = value;
    if (axis === "shiftX") pose.rootShiftX = value;
    if (axis === "shiftZ") pose.rootShiftZ = value;
    return;
  }
  if (axis.startsWith("offset")) {
    ensureVector(pose, `${part.id}Offset`)[axis.slice(-1).toLowerCase()] = value;
    return;
  }
  ensureVector(pose, part.id)[axis] = value;
}

function resetPartValue(pose, defaultPose, part, axis) {
  setPartValue(pose, part, axis, getPartValue(defaultPose || {}, part, axis));
}

function formatTuneValue(value, unit) {
  if (unit === "m") return value.toFixed(3);
  return Math.round(value).toString();
}

function tuneRowsForPart(part) {
  if (part.type === "scalar") {
    return [{ axis: "value", label: "前傾", min: part.min, max: part.max, step: part.step, unit: part.unit }];
  }
  if (part.type === "pelvis") {
    return [
      { axis: "lift", label: "Y重心", min: -0.18, max: 0.12, step: 0.005, unit: "m" },
      { axis: "shiftX", label: "X重心", min: -0.25, max: 0.25, step: 0.005, unit: "m" },
      { axis: "shiftZ", label: "Z重心", min: -0.3, max: 0.3, step: 0.005, unit: "m" },
      { axis: "turn", label: "Y回転", min: -70, max: 70, step: 1, unit: "deg" },
    ];
  }
  const rows = ROTATION_AXES.map((axis) => ({ axis: axis.key, label: `${axis.label}回転`, min: -140, max: 140, step: 1, unit: "deg" }));
  if (part.type === "rotationWithOffset") {
    rows.push(...POSITION_AXES.map((axis) => ({ axis: `offset${axis.key.toUpperCase()}`, ...axis })));
  }
  return rows;
}

function renderTuneControls() {
  const poseName = getEditablePoseName();
  const pose = POSES[poseName];
  const part = getSelectedPart();
  const rows = tuneRowsForPart(part);
  tunePoseCode.textContent = poseName;
  renderedTunePoseName = poseName;
  renderedTunePartId = part.id;
  tuneControls.replaceChildren(...rows.map((row) => {
    const value = getPartValue(pose, part, row.axis);
    const wrapper = document.createElement("label");
    wrapper.className = "tune-row";
    wrapper.innerHTML = `
      <span>${row.label}</span>
      <input type="range" min="${row.min}" max="${row.max}" step="${row.step}" value="${value}" data-axis="${row.axis}" data-unit="${row.unit}" />
      <input type="number" min="${row.min}" max="${row.max}" step="${row.step}" value="${formatTuneValue(value, row.unit)}" data-axis="${row.axis}" data-unit="${row.unit}" />
    `;
    return wrapper;
  }));
}

function refreshTuneControlsIfNeeded(force) {
  const poseName = getEditablePoseName();
  const partId = getSelectedPart().id;
  const editingTuneInput = tuneControls.contains(document.activeElement);
  if (force || (!editingTuneInput && (poseName !== renderedTunePoseName || partId !== renderedTunePartId))) {
    renderTuneControls();
  } else {
    tunePoseCode.textContent = poseName;
  }
}

function syncTuneInputs(axis, value) {
  tuneControls.querySelectorAll(`[data-axis="${axis}"]`).forEach((input) => {
    input.value = formatTuneValue(value, input.dataset.unit);
  });
}

function updateTunedPose(axis, value) {
  const poseName = getEditablePoseName();
  const pose = POSES[poseName];
  const part = getSelectedPart();
  setPartValue(pose, part, axis, value);
  syncTuneInputs(axis, value);
  applyCurrentMotion();
}

function poseJson() {
  return JSON.stringify(POSES, null, 2);
}

function poseJsSnippet() {
  return `export const POSES = ${poseJson()};`;
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    exportStatus.textContent = successMessage;
    setTimeout(() => {
      if (exportStatus.textContent === successMessage) exportStatus.textContent = "";
    }, 1800);
    return true;
  } catch {
    exportStatus.textContent = "コピーできませんでした";
    return false;
  }
}

function updateJointAxes() {
  if (!character) return;
  const part = getSelectedPart();
  const joint = character.joints[part.joint];
  jointAxes.visible = !!(jointAxisToggle && jointAxisToggle.checked && joint);
  if (!jointAxes.visible) return;
  joint.getWorldPosition(_axisOrigin);
  joint.getWorldQuaternion(jointAxes.quaternion);
  jointAxes.position.copy(_axisOrigin);
}

function updateSideMarkers() {
  if (!character) return;
  const visible = !!(sideMarkerToggle && sideMarkerToggle.checked);
  (character.group.userData.sideMarkers || []).forEach((marker) => {
    marker.visible = visible;
  });
}

function tagTunePartTree(root, partId) {
  if (!root) return;
  root.traverse((object) => {
    object.userData.tunePart = partId;
  });
}

function tagCharacterTuneParts() {
  if (!character) return;
  for (const part of TUNE_PARTS) {
    tagTunePartTree(character.joints[part.joint], part.id);
  }
}

function selectPart(partId) {
  if (!TUNE_PARTS.some((part) => part.id === partId)) return;
  tunePartSelect.value = partId;
  refreshTuneControlsIfNeeded(true);
  updateJointAxes();
}

function selectPartFromCanvas(event) {
  if (!character) return;
  const rect = canvas.getBoundingClientRect();
  _pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  _pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(_pointer, camera);
  const hit = raycaster
    .intersectObjects(character.group.children, true)
    .find((item) => item.object.userData.tunePart);
  if (hit) selectPart(hit.object.userData.tunePart);
}

function statusItem(ok, label, detail, visual) {
  const state = visual ? "watch" : (ok ? "ok" : "ng");
  const mark = visual ? "目視" : (ok ? "OK" : "要修正");
  return `<li class="${state}"><b>${mark}</b><span>${label}</span><em>${detail}</em></li>`;
}

function updateDebugInspection() {
  if (!character) return;
  const motion = getMotion();
  const joints = character.joints;
  const showAxes = !!(debugAxisToggle && debugAxisToggle.checked);
  debugAxes.visible = showAxes && !!joints.racket;

  const checklist = [];
  const metrics = [];

  if (joints.racket) {
    const grip = characterLocalPoint(joints.racket, new THREE.Vector3(0, 0.12, 0), _worldA);
    const head = characterLocalPoint(joints.racket, new THREE.Vector3(0, 0.68, 0), _worldB);
    const faceCenter = characterLocalPoint(joints.racket, new THREE.Vector3(0, 0.52, 0), _localA);
    const facePoint = characterLocalPoint(joints.racket, new THREE.Vector3(0, 0.52, 0.18), _localB);
    const headDir = head.clone().sub(grip).normalize();
    const faceDir = facePoint.clone().sub(faceCenter).normalize();
    const gripDir = grip.clone().sub(head).normalize();
    const faceCenterForAxis = faceCenter.clone();
    const gripForAxis = grip.clone();

    if (debugAxes.visible) {
      character.group.localToWorld(_axisOrigin.copy(faceCenterForAxis));
      character.group.localToWorld(_localA.copy(faceCenterForAxis).add(headDir));
      setAxis(racketHeadAxis, _axisOrigin, _localA.sub(_axisOrigin), 0.42);
      character.group.localToWorld(_axisOrigin.copy(faceCenterForAxis));
      character.group.localToWorld(_localA.copy(faceCenterForAxis).add(faceDir));
      setAxis(racketFaceAxis, _axisOrigin, _localA.sub(_axisOrigin), 0.34);
      character.group.localToWorld(_axisOrigin.copy(gripForAxis));
      character.group.localToWorld(_localA.copy(gripForAxis).add(gripDir));
      setAxis(racketGripAxis, _axisOrigin, _localA.sub(_axisOrigin), 0.24);
    }

    const headHorizontal = Math.abs(headDir.y);
    const faceVertical = Math.abs(faceDir.y);
    metrics.push(["ヘッド水平度", `${(1 - headHorizontal).toFixed(2)} / 1.00`]);
    metrics.push(["面の垂直度", `${(1 - faceVertical).toFixed(2)} / 1.00`]);

    if (motion.id === "rearForehandContact" || motion.id === "forehandContact") {
      checklist.push(statusItem(headHorizontal < 0.28, "打点: グリップからヘッドが地面と平行", `上下ズレ ${headHorizontal.toFixed(2)}`));
      checklist.push(statusItem(faceVertical < 0.28, "打点: 面が地面に対して垂直", `上下成分 ${faceVertical.toFixed(2)}`));
      checklist.push(statusItem(false, "打点: ラケットが真横を向く", "ヘッド/面の矢印で目視確認", true));
    }
  }

  if (joints.shoeL && joints.shoeR) {
    const left = characterLocalPosition(joints.shoeL, _worldA);
    const right = characterLocalPosition(joints.shoeR, _worldB);
    const leftForward = left.z - right.z;
    const rightBack = right.z < left.z;
    metrics.push(["左足の前後差", `${leftForward.toFixed(2)} m`]);

    if (motion.id === "rearForehandTakeback" || motion.id === "forehandTakeback") {
      checklist.push(statusItem(right.z < left.z + 0.08, "テイクバック: 右足重心または両足重心", `右足Z ${right.z.toFixed(2)} / 左足Z ${left.z.toFixed(2)}`, true));
      checklist.push(statusItem(true, "テイクバック: 半身", "肩・腰の向きで目視確認", true));
    }
    if (motion.id === "rearForehandContact" || motion.id === "forehandContact") {
      checklist.push(statusItem(leftForward > 0.18, "打点: 左足が打球方向へ踏み込み", `前後差 ${leftForward.toFixed(2)} m`));
      checklist.push(statusItem(rightBack, "打点: 右足が後ろに残る", `右足Z ${right.z.toFixed(2)} / 左足Z ${left.z.toFixed(2)}`));
      checklist.push(statusItem(true, "打点: まだ半身", "正面を向ききっていないか目視確認", true));
    }
    if (motion.id === "rearForehandFollow" || motion.id === "forehandFollow") {
      checklist.push(statusItem(leftForward > 0.15, "フォロー: 左足重心のまま抜ける", `前後差 ${leftForward.toFixed(2)} m`));
      checklist.push(statusItem(true, "フォロー: 遠心力で正面へ戻る", "胸の向きと右足の抜けで目視確認", true));
    }
  }

  if (motion.id === "rearForehandTakeback" || motion.id === "rearForehandContact" || motion.id === "rearForehandFollow") {
    checklist.unshift(statusItem(true, "ラケット形状: 〇 / Y / I", "面の外側でY字スロートがフレームを支える", true));
    checklist.push(statusItem(true, "連動: ひじ→前腕→手首→ラケット", "連続再生で目視確認", true));
  }

  if (!checklist.length) {
    checklist.push(statusItem(true, "このフォームの専用チェックは未定義", "後衛フォアを優先中", true));
  }

  formChecklist.innerHTML = checklist.join("");
  formMetrics.innerHTML = metrics.map(([name, value]) => `<dt>${name}</dt><dd>${value}</dd>`).join("");
}

function createSelectedModel() {
  if (character) scene.remove(character.group);
  character = createCharacter(MODEL_COLORS[modelSelect.value]);
  tagCharacterTuneParts();
  character.group.scale.x = handed === "right" ? -1 : 1;
  scene.add(character.group);
  updateSideMarkers();
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

function populateTuneParts() {
  tunePartSelect.replaceChildren(...TUNE_PARTS.map((part) => {
    const option = document.createElement("option");
    option.value = part.id;
    option.textContent = part.label;
    return option;
  }));
  tunePartSelect.value = "racket";
}

function applyCurrentMotion() {
  if (!character) return;
  const motion = getMotion();
  const baseHipY = character.group.userData.dims.hipY;

  if (motion.swing) {
    const activeEnd = 0.86;
    const returnStart = 0.92;
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
  updateJointAxes();
  updateDebugInspection();
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
  refreshTuneControlsIfNeeded(true);
  applyCurrentMotion();
});

document.querySelectorAll('input[name="role"]').forEach((input) => {
  input.addEventListener("change", () => {
    role = input.value;
    populateMotions();
    refreshTuneControlsIfNeeded(true);
    applyCurrentMotion();
  });
});

document.querySelectorAll('input[name="handed"]').forEach((input) => {
  input.addEventListener("change", () => {
    handed = input.value;
    character.group.scale.x = handed === "right" ? -1 : 1;
    updateJointAxes();
  });
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

debugAxisToggle.addEventListener("change", updateDebugInspection);
sideMarkerToggle.addEventListener("change", updateSideMarkers);
jointAxisToggle.addEventListener("change", updateJointAxes);
tunePartSelect.addEventListener("change", () => {
  refreshTuneControlsIfNeeded(true);
  updateJointAxes();
});

tuneControls.addEventListener("input", (event) => {
  const input = event.target.closest("input[data-axis]");
  if (!input) return;
  updateTunedPose(input.dataset.axis, Number(input.value));
});

tuneResetButton.addEventListener("click", () => {
  const poseName = getEditablePoseName();
  const pose = POSES[poseName];
  const defaultPose = DEFAULT_POSES[poseName] || {};
  const part = getSelectedPart();
  for (const row of tuneRowsForPart(part)) {
    resetPartValue(pose, defaultPose, part, row.axis);
  }
  renderTuneControls();
  applyCurrentMotion();
});

tuneCopyButton.addEventListener("click", async () => {
  const poseName = getEditablePoseName();
  const pose = POSES[poseName];
  const part = getSelectedPart();
  const values = {};
  for (const row of tuneRowsForPart(part)) values[row.axis] = getPartValue(pose, part, row.axis);
  const text = `${poseName}.${part.id} = ${JSON.stringify(values)}`;
  if (await copyText(text, "選択部品の値をコピーしました")) {
    tuneCopyButton.textContent = "コピーしました";
    setTimeout(() => { tuneCopyButton.textContent = "値をコピー"; }, 1100);
  }
});

exportJsonButton.addEventListener("click", () => {
  copyText(poseJson(), "全ポーズJSONをコピーしました");
});

exportJsButton.addEventListener("click", () => {
  copyText(poseJsSnippet(), "全ポーズJSをコピーしました");
});

playButton.addEventListener("click", () => {
  playing = !playing;
  updateInterface();
});

restartButton.addEventListener("click", () => {
  phase = 0;
  playing = true;
  updateInterface();
  refreshTuneControlsIfNeeded(false);
});

phaseRange.addEventListener("input", () => {
  phase = Number(phaseRange.value) / 100;
  playing = false;
  updateInterface();
  refreshTuneControlsIfNeeded(false);
  applyCurrentMotion();
});

speedRange.addEventListener("input", () => {
  speed = Number(speedRange.value);
  speedOutput.value = `${speed.toFixed(2).replace(/0$/, "")}×`;
});

canvas.addEventListener("pointerdown", (event) => {
  dragging = true;
  dragX = event.clientX;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  targetYaw += (event.clientX - dragX) * 0.012;
  dragX = event.clientX;
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.remove("is-active"));
});

canvas.addEventListener("pointerup", (event) => {
  const moved = Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY);
  dragging = false;
  if (moved < 5) selectPartFromCanvas(event);
});
canvas.addEventListener("pointercancel", () => { dragging = false; });
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  cameraUserAdjusted = true;
  cameraDistance = THREE.MathUtils.clamp(cameraDistance + event.deltaY * 0.003, cameraMinDistance, cameraMaxDistance);
}, { passive: false });

function updateCameraBounds(width, height) {
  const aspect = width / Math.max(1, height);
  const desktopLandscape = width >= 900 && aspect >= 1.25;
  cameraMinDistance = desktopLandscape ? 4.2 : 3.2;
  cameraMaxDistance = desktopLandscape ? 8.2 : 6.2;
  const preferredDistance = desktopLandscape
    ? THREE.MathUtils.clamp(4.9 + (aspect - 1.25) * 0.7, 5.0, 6.0)
    : 4.5;
  if (!cameraUserAdjusted) cameraDistance = preferredDistance;
  cameraDistance = THREE.MathUtils.clamp(cameraDistance, cameraMinDistance, cameraMaxDistance);
}

function resizeRenderer() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = renderer.getPixelRatio();
  updateCameraBounds(width, height);
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
    phase = (phase + dt * speed / SWING_LOOP_SECONDS) % 1;
    applyCurrentMotion();
    phaseRange.value = Math.round(phase * 100);
    phaseOutput.value = `${Math.round(phase * 100)}%`;
    refreshTuneControlsIfNeeded(false);
  }

  modelYaw += (targetYaw - modelYaw) * Math.min(1, dt * 9);
  character.group.rotation.y = modelYaw;
  camera.position.z += (cameraDistance - camera.position.z) * Math.min(1, dt * 8);
  updateJointAxes();
  updateDebugInspection();
  resizeRenderer();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

populateTuneParts();
populateMotions();
createSelectedModel();
renderTuneControls();
requestAnimationFrame(animate);
