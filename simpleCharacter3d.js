/**
 * デフォルメ 3D ソフトテニスキャラのコード生成
 *
 * Wii Sports / みんなのテニス / マリオテニス風のリアルすぎないキャラ。
 * 関節は 肩・肘・手首相当(手)・股・膝 の最低限のみ。
 * すべて Three.js のプリミティブ（球・カプセル・円柱）で組む。
 *
 * 返り値 { group, joints, materials }
 *  - group: シーンに add する THREE.Group（足元 y=0、頭上 ~1.85）
 *  - joints: ポーズ回転をかけるピボット群
 *  - materials: 選手ごとに色差し替えする shirt / skin
 *
 * 各手足は「ピボット Group の原点が関節、メッシュは下方向へオフセット」で作り、
 * ピボットを回すと関節中心に曲がる。
 */

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const DEG = Math.PI / 180;

// 円柱の肢体：上端を原点(0,0,0)に置き、下方向(-y)へ length 伸ばす。
function makeLimb(material, radiusTop, radiusBottom, length, radialSeg) {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, radialSeg || 12);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = -length / 2; // 上端をピボット原点に
  mesh.castShadow = true;
  return mesh;
}

function makeSphere(material, r, segs) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, segs || 16, segs || 16), material);
  mesh.castShadow = true;
  return mesh;
}

function makePivot(x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
}

function addLimbSideMarkers(parent, length, radius, innerSign, materials, markerStore) {
  const markerLen = length * 0.78;
  const y = -length / 2;
  const offset = radius + 0.018;
  [
    { sign: innerSign, material: materials.inner },
    { sign: -innerSign, material: materials.outer },
  ].forEach(({ sign, material }) => {
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, markerLen, 8), material);
    marker.position.set(sign * offset, y, 0);
    marker.userData.sideMarker = true;
    marker.visible = false;
    parent.add(marker);
    markerStore.push(marker);
  });
}

function addHandOrientationMarkers(parent, radius, innerSign, materials, markerStore) {
  [
    { position: [innerSign * radius * 1.18, 0, 0], material: materials.inner },
    { position: [-innerSign * radius * 1.18, 0, 0], material: materials.outer },
    { position: [0, 0, radius * 1.22], material: materials.knuckle },
  ].forEach(({ position, material }) => {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.22, 8, 8), material);
    marker.position.set(...position);
    marker.userData.sideMarker = true;
    marker.visible = false;
    parent.add(marker);
    markerStore.push(marker);
  });
}

function addRacketBar(parent, material, ax, ay, bx, by, radius) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), material);
  bar.position.set((ax + bx) / 2, (ay + by) / 2, 0.004);
  bar.rotation.z = Math.atan2(-dx, dy);
  parent.add(bar);
  return bar;
}

// ラケット（右手に付ける）。グリップ→シャフト→楕円フレーム→簡易ガット。
function makeRacket(frameMat, gripMat) {
  const racket = new THREE.Group();

  // グリップ
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.20, 10), gripMat);
  grip.position.y = 0.10;
  racket.add(grip);

  // シャフト
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.16, 8), frameMat);
  shaft.position.y = 0.28;
  racket.add(shaft);

  // スロート（三角部分）。面の外側でフレーム下端をY字に支える。
  addRacketBar(racket, frameMat, 0.0, 0.30, 0.0, 0.355, 0.015);
  addRacketBar(racket, frameMat, 0.0, 0.355, -0.078, 0.385, 0.014);
  addRacketBar(racket, frameMat, 0.0, 0.355, 0.078, 0.385, 0.014);
  const throatTarget = makePivot(0, 0.355, 0.025);
  racket.add(throatTarget);
  racket.userData.throatTarget = throatTarget;

  // フレーム（楕円リング）: TorusGeometry を縦長にスケール
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 10, 28), frameMat);
  ring.position.y = 0.52;
  ring.scale.set(0.82, 1.0, 0.82); // やや縦長の楕円
  racket.add(ring);

  // 簡易ガット（薄い面）
  const gutMat = new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  const gut = new THREE.Mesh(new THREE.CircleGeometry(0.135, 20), gutMat);
  gut.position.y = 0.52;
  gut.scale.set(0.82, 1.0, 1);
  racket.add(gut);

  return racket;
}

export function createCharacter(opts) {
  opts = opts || {};
  const skinColor = opts.skinColor || 0xf1c7a8;
  const shirtColor = opts.shirtColor || 0x6366f1;
  const shortsColor = opts.shortsColor || 0x222a44;
  const hairColor = opts.hairColor || 0x2a2018;

  const materials = {
    skin: new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.85 }),
    shirt: new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.8 }),
    shorts: new THREE.MeshStandardMaterial({ color: shortsColor, roughness: 0.85 }),
    hair: new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.9 }),
    racket: new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.6, metalness: 0.1 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 }),
  };
  const sideMarkerMaterials = {
    inner: new THREE.MeshBasicMaterial({ color: 0x22d3ee }),
    outer: new THREE.MeshBasicMaterial({ color: 0xff4b4b }),
    knuckle: new THREE.MeshBasicMaterial({ color: 0xffd400 }),
  };

  const group = new THREE.Group();
  const joints = {};
  const sideMarkers = [];

  // 寸法（デフォルメ：頭大きめ・胴太め・手足太め）
  // Mii / Wii Sports Resort 風の比率へ：頭+10% 腕+15% 脚+10% 肩幅+15% 胴やや短め。
  const hipY = 0.86;        // 骨盤の高さ（脚を伸ばした分だけ持ち上げ、足を接地させる）
  const torsoLen = 0.47;    // 骨盤→胸（やや短く）
  const upperArm = 0.345, foreArm = 0.322, armR = 0.075;
  const thigh = 0.44, shin = 0.418, legR = 0.10;
  const headR = 0.22;

  // 足元を支点に全身を傾けるルート。後衛の構えはここで足首から前傾させる。
  const leanRoot = makePivot(0, 0, 0);
  joints.leanRoot = leanRoot;
  group.add(leanRoot);

  // root（足元）→ pelvis
  const pelvis = makePivot(0, hipY, 0);
  joints.pelvis = pelvis;
  leanRoot.add(pelvis);

  // 骨盤（丸い箱）
  const pelvisMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.20, 0.10, 6, 14), materials.shorts);
  pelvisMesh.rotation.z = Math.PI / 2;
  // モデルの正面は +Z。骨盤の量感は背面(-Z)へ寄せ、お尻の位置を明確にする。
  pelvisMesh.position.z = -0.055;
  pelvisMesh.scale.set(1, 1.2, 0.9);
  pelvisMesh.castShadow = true;
  pelvis.add(pelvisMesh);

  // chest ピボット（骨盤上端）→ 上体の前傾・ひねり
  const chest = makePivot(0, torsoLen, 0);
  joints.chest = chest;
  pelvis.add(chest);

  // 胴体（カプセル、骨盤→胸を太く）
  const torsoMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, torsoLen - 0.1, 8, 16), materials.shirt);
  torsoMesh.position.y = -torsoLen / 2;
  torsoMesh.scale.set(1.05, 1, 0.8);
  torsoMesh.castShadow = true;
  chest.add(torsoMesh);

  // 首＋頭
  const neck = makePivot(0, 0.08, 0);
  chest.add(neck);
  const head = makePivot(0, headR * 0.9, 0);
  joints.head = head;
  neck.add(head);
  const headMesh = makeSphere(materials.skin, headR, 18);
  headMesh.scale.set(0.95, 1.05, 0.95);
  head.add(headMesh);
  // 髪（上半球）
  // 額までの浅いキャップに留め、正面(+Z)の目を覆わない。
  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.02, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), materials.hair);
  hairMesh.position.y = headR * 0.10;
  head.add(hairMesh);
  // 目（簡易）
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
  [-1, 1].forEach((sx) => {
    const eye = makeSphere(eyeMat, headR * 0.10, 8);
    eye.position.set(sx * headR * 0.35, headR * 0.02, headR * 0.97);
    head.add(eye);
  });
  // 小さな鼻で正面を一目で判別できるようにする。
  const nose = makeSphere(materials.skin, headR * 0.075, 8);
  nose.position.set(0, -headR * 0.08, headR * 0.99);
  head.add(nose);

  // 肩幅・股幅（肩幅+15%）
  const shoulderX = 0.30, hipX = 0.13;
  const chestTopY = -0.02; // chest 原点付近に肩

  // ---- 右腕 ----
  const shoulderR = makePivot(shoulderX, chestTopY, 0);
  joints.shoulderR = shoulderR;
  chest.add(shoulderR);
  shoulderR.add(makeLimb(materials.skin, armR, armR * 0.92, upperArm));
  addLimbSideMarkers(shoulderR, upperArm, armR, -1, sideMarkerMaterials, sideMarkers);
  const elbowR = makePivot(0, -upperArm, 0);
  joints.elbowR = elbowR;
  shoulderR.add(elbowR);
  elbowR.add(makeSphere(materials.skin, armR * 0.92, 10));
  elbowR.add(makeLimb(materials.skin, armR * 0.92, armR * 0.8, foreArm));
  addLimbSideMarkers(elbowR, foreArm, armR * 0.92, -1, sideMarkerMaterials, sideMarkers);
  const handR = makePivot(0, -foreArm, 0);
  joints.handR = handR;
  elbowR.add(handR);
  handR.add(makeSphere(materials.skin, armR * 1.05, 10));
  addHandOrientationMarkers(handR, armR * 1.05, -1, sideMarkerMaterials, sideMarkers);
  // ラケットを右手へ
  const racket = makeRacket(materials.racket, materials.grip);
  racket.position.y = -armR * 0.5;
  joints.racket = racket;
  joints.racketThroat = racket.userData.throatTarget;
  handR.add(racket);

  // ---- 左腕 ----
  const shoulderL = makePivot(-shoulderX, chestTopY, 0);
  joints.shoulderL = shoulderL;
  chest.add(shoulderL);
  shoulderL.add(makeLimb(materials.skin, armR, armR * 0.92, upperArm));
  addLimbSideMarkers(shoulderL, upperArm, armR, 1, sideMarkerMaterials, sideMarkers);
  const elbowL = makePivot(0, -upperArm, 0);
  joints.elbowL = elbowL;
  shoulderL.add(elbowL);
  elbowL.add(makeSphere(materials.skin, armR * 0.92, 10));
  elbowL.add(makeLimb(materials.skin, armR * 0.92, armR * 0.8, foreArm));
  addLimbSideMarkers(elbowL, foreArm, armR * 0.92, 1, sideMarkerMaterials, sideMarkers);
  const handL = makePivot(0, -foreArm, 0);
  joints.handL = handL;
  elbowL.add(handL);
  handL.add(makeSphere(materials.skin, armR * 1.05, 10));
  addHandOrientationMarkers(handL, armR * 1.05, 1, sideMarkerMaterials, sideMarkers);

  // ---- 右脚 ----
  const hipR = makePivot(hipX, -0.05, 0);
  joints.hipR = hipR;
  pelvis.add(hipR);
  hipR.add(makeLimb(materials.skin, legR, legR * 0.85, thigh));
  addLimbSideMarkers(hipR, thigh, legR, -1, sideMarkerMaterials, sideMarkers);
  const kneeR = makePivot(0, -thigh, 0);
  joints.kneeR = kneeR;
  hipR.add(kneeR);
  kneeR.add(makeSphere(materials.skin, legR * 0.88, 10));
  kneeR.add(makeLimb(materials.skin, legR * 0.85, legR * 0.7, shin));
  addLimbSideMarkers(kneeR, shin, legR * 0.85, -1, sideMarkerMaterials, sideMarkers);
  const footR = makePivot(0, -shin, 0);
  joints.footR = footR;
  kneeR.add(footR);
  const footRMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.10, 4, 8), materials.shorts);
  footRMesh.rotation.x = Math.PI / 2;
  footRMesh.position.y = 0.075;
  footRMesh.position.z = 0.05;
  footRMesh.castShadow = true;
  footRMesh.userData.groundRadius = 0.08;
  joints.shoeR = footRMesh;
  footR.add(footRMesh);

  // ---- 左脚 ----
  const hipL = makePivot(-hipX, -0.05, 0);
  joints.hipL = hipL;
  pelvis.add(hipL);
  hipL.add(makeLimb(materials.skin, legR, legR * 0.85, thigh));
  addLimbSideMarkers(hipL, thigh, legR, 1, sideMarkerMaterials, sideMarkers);
  const kneeL = makePivot(0, -thigh, 0);
  joints.kneeL = kneeL;
  hipL.add(kneeL);
  kneeL.add(makeSphere(materials.skin, legR * 0.88, 10));
  kneeL.add(makeLimb(materials.skin, legR * 0.85, legR * 0.7, shin));
  addLimbSideMarkers(kneeL, shin, legR * 0.85, 1, sideMarkerMaterials, sideMarkers);
  const footL = makePivot(0, -shin, 0);
  joints.footL = footL;
  kneeL.add(footL);
  const footLMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.10, 4, 8), materials.shorts);
  footLMesh.rotation.x = Math.PI / 2;
  footLMesh.position.y = 0.075;
  footLMesh.position.z = 0.05;
  footLMesh.castShadow = true;
  footLMesh.userData.groundRadius = 0.08;
  joints.shoeL = footLMesh;
  footL.add(footLMesh);

  // 接地影（簡易ブロブ）
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  shadow.scale.set(1, 0.7, 1);
  group.add(shadow);

  group.userData.dims = {
    hipY,
    headTop: hipY + torsoLen + 0.08 + headR * 1.9,
    upperArm, foreArm, // 左手IK用の上腕・前腕長
  };
  group.userData.sideMarkers = sideMarkers;
  return { group, joints, materials };
}
