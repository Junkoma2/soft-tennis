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

  const group = new THREE.Group();
  const joints = {};

  // 寸法（デフォルメ：頭大きめ・胴太め・手足太め）
  // Mii / Wii Sports Resort 風の比率へ：頭+10% 腕+15% 脚+10% 肩幅+15% 胴やや短め。
  const hipY = 0.86;        // 骨盤の高さ（脚を伸ばした分だけ持ち上げ、足を接地させる）
  const torsoLen = 0.47;    // 骨盤→胸（やや短く）
  const upperArm = 0.345, foreArm = 0.322, armR = 0.075;
  const thigh = 0.44, shin = 0.418, legR = 0.10;
  const headR = 0.22;

  // root（足元）→ pelvis
  const pelvis = makePivot(0, hipY, 0);
  joints.pelvis = pelvis;
  group.add(pelvis);

  // 骨盤（丸い箱）
  const pelvisMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.20, 0.10, 6, 14), materials.shorts);
  pelvisMesh.rotation.z = Math.PI / 2;
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
  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.02, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), materials.hair);
  hairMesh.position.y = headR * 0.12;
  head.add(hairMesh);
  // 目（簡易）
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
  [-1, 1].forEach((sx) => {
    const eye = makeSphere(eyeMat, headR * 0.10, 8);
    eye.position.set(sx * headR * 0.35, headR * 0.05, headR * 0.9);
    head.add(eye);
  });

  // 肩幅・股幅（肩幅+15%）
  const shoulderX = 0.30, hipX = 0.13;
  const chestTopY = -0.02; // chest 原点付近に肩

  // ---- 右腕 ----
  const shoulderR = makePivot(shoulderX, chestTopY, 0);
  joints.shoulderR = shoulderR;
  chest.add(shoulderR);
  shoulderR.add(makeLimb(materials.skin, armR, armR * 0.92, upperArm));
  const elbowR = makePivot(0, -upperArm, 0);
  joints.elbowR = elbowR;
  shoulderR.add(elbowR);
  elbowR.add(makeLimb(materials.skin, armR * 0.92, armR * 0.8, foreArm));
  const handR = makePivot(0, -foreArm, 0);
  joints.handR = handR;
  elbowR.add(handR);
  handR.add(makeSphere(materials.skin, armR * 1.05, 10));
  // ラケットを右手へ
  const racket = makeRacket(materials.racket, materials.grip);
  racket.position.y = -armR * 0.5;
  joints.racket = racket;
  handR.add(racket);

  // ---- 左腕 ----
  const shoulderL = makePivot(-shoulderX, chestTopY, 0);
  joints.shoulderL = shoulderL;
  chest.add(shoulderL);
  shoulderL.add(makeLimb(materials.skin, armR, armR * 0.92, upperArm));
  const elbowL = makePivot(0, -upperArm, 0);
  joints.elbowL = elbowL;
  shoulderL.add(elbowL);
  elbowL.add(makeLimb(materials.skin, armR * 0.92, armR * 0.8, foreArm));
  const handL = makePivot(0, -foreArm, 0);
  joints.handL = handL;
  elbowL.add(handL);
  handL.add(makeSphere(materials.skin, armR * 1.05, 10));

  // ---- 右脚 ----
  const hipR = makePivot(hipX, -0.05, 0);
  joints.hipR = hipR;
  pelvis.add(hipR);
  hipR.add(makeLimb(materials.skin, legR, legR * 0.85, thigh));
  const kneeR = makePivot(0, -thigh, 0);
  joints.kneeR = kneeR;
  hipR.add(kneeR);
  kneeR.add(makeLimb(materials.skin, legR * 0.85, legR * 0.7, shin));
  const footR = makePivot(0, -shin, 0);
  joints.footR = footR;
  kneeR.add(footR);
  const footRMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.10, 4, 8), materials.shorts);
  footRMesh.rotation.x = Math.PI / 2;
  footRMesh.position.z = 0.05;
  footRMesh.castShadow = true;
  footR.add(footRMesh);

  // ---- 左脚 ----
  const hipL = makePivot(-hipX, -0.05, 0);
  joints.hipL = hipL;
  pelvis.add(hipL);
  hipL.add(makeLimb(materials.skin, legR, legR * 0.85, thigh));
  const kneeL = makePivot(0, -thigh, 0);
  joints.kneeL = kneeL;
  hipL.add(kneeL);
  kneeL.add(makeLimb(materials.skin, legR * 0.85, legR * 0.7, shin));
  const footL = makePivot(0, -shin, 0);
  joints.footL = footL;
  kneeL.add(footL);
  const footLMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.10, 4, 8), materials.shorts);
  footLMesh.rotation.x = Math.PI / 2;
  footLMesh.position.z = 0.05;
  footLMesh.castShadow = true;
  footL.add(footLMesh);

  // 接地影（簡易ブロブ）
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  shadow.scale.set(1, 0.7, 1);
  group.add(shadow);

  group.userData.dims = { hipY, headTop: hipY + torsoLen + 0.08 + headR * 1.9 };
  return { group, joints, materials };
}
