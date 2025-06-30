import { FaceMesh } from 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';
import { Camera } from 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';
import * as THREE from 'https://unpkg.com/three@0.161.1/build/three.module.js';

const tg = window.Telegram.WebApp;
if (tg && tg.expand) tg.expand();

const canvas = document.getElementById('avatarCanvas');
const cam = document.getElementById('cam');
const avatarInput = document.getElementById('avatarInput');

let avatarImg = null;
let renderer, scene, camera3D, mesh;

function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  if (renderer) {
    renderer.setSize(canvas.width, canvas.height);
    camera3D.aspect = canvas.width / canvas.height;
    camera3D.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

async function loadAvatar(src) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  return img;
}

async function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
  scene = new THREE.Scene();
  camera3D = new THREE.PerspectiveCamera(
    45,
    canvas.width / canvas.height,
    0.1,
    100
  );
  camera3D.position.z = 2;

  const tex = new THREE.Texture(avatarImg);
  tex.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(
    1,
    avatarImg.height / avatarImg.width
  );
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
  });
  mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
}

function animateMesh(pose, blink, mouthOpen) {
  if (!mesh) return;
  mesh.rotation.y = pose.yaw * 1.8;
  mesh.rotation.x = pose.pitch * 1.8;
  mesh.rotation.z = -pose.roll;
  mesh.scale.y = mouthOpen ? 1.05 : 1;
  if (blink) {
    mesh.material.opacity = 0.7;
    setTimeout(() => (mesh.material.opacity = 1), 100);
  }
  renderer.render(scene, camera3D);
}

const IDX_NOSE = 1,
  IDX_LEFT = 234,
  IDX_RIGHT = 454,
  IDX_CHIN = 152,
  IDX_FORE = 10;

function estimatePose(l) {
  const yaw = Math.atan2(l[IDX_RIGHT].x - l[IDX_LEFT].x, l[IDX_RIGHT].z - l[IDX_LEFT].z);
  const pitch = Math.atan2(l[IDX_CHIN].y - l[IDX_FORE].y, l[IDX_CHIN].z - l[IDX_FORE].z);
  const roll = Math.atan2(l[33].y - l[263].y, l[33].x - l[263].x);
  return { yaw, pitch, roll };
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function detectBlink(l) {
  const left = dist(l[159], l[145]) / dist(l[33], l[133]);
  const right = dist(l[386], l[374]) / dist(l[362], l[263]);
  return (left + right) / 2 < 0.23;
}

function detectMouthOpen(l) {
  const mouth = dist(l[13], l[14]);
  const face = dist(l[10], l[152]);
  return mouth / face > 0.08;
}

async function setupAvatarFromPhoto(src) {
  avatarImg = await loadAvatar(src);
  if (!renderer) await initScene();
}

async function main() {
  const userPhoto = tg?.initDataUnsafe?.user?.photo_url;
  if (userPhoto) {
    await setupAvatarFromPhoto(userPhoto);
  }

  avatarInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    await setupAvatarFromPhoto(url);
    URL.revokeObjectURL(url);
  });

  const facemesh = new FaceMesh({
    locateFile: (f) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
  });
  facemesh.setOptions({
    selfieMode: true,
    maxNumFaces: 1,
    refineLandmarks: true,
  });

  facemesh.onResults((res) => {
    if (!avatarImg || !res.multiFaceLandmarks.length) return;
    const l = res.multiFaceLandmarks[0];
    const pose = estimatePose(l);
    const blink = detectBlink(l);
    const mouthOpen = detectMouthOpen(l);
    animateMesh(pose, blink, mouthOpen);
  });

  const camera = new Camera(cam, {
    onFrame: async () => {
      await facemesh.send({ image: cam });
    },
  });
  camera.start();
}

main();
