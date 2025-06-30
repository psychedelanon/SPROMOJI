import { FaceMesh } from 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';
import { Camera } from 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';
import * as THREE from 'https://unpkg.com/three@0.161.1/build/three.module.js';

const tg = window.Telegram.WebApp;
if (tg && tg.expand) tg.expand();

const canvas = document.getElementById('avatarCanvas');
const cam = document.getElementById('cam');
const avatarInput = document.getElementById('avatarInput');
const startBtn = document.getElementById('startBtn');
const loadingIndicator = document.getElementById('loading');
const statusText = document.getElementById('status');

let avatarImg = null;
let renderer, scene, camera3D, mesh;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

function updateStatus(message) {
  if (statusText) {
    statusText.textContent = message;
  }
  console.log('Status:', message);
}

function hideLoading() {
  if (loadingIndicator) {
    loadingIndicator.style.display = 'none';
  }
}

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
  try {
    updateStatus('Loading avatar image...');
    avatarImg = await loadAvatar(src);
    if (!renderer) await initScene();
    updateStatus('Avatar loaded! Move your face to see the animation.');
    console.log('Avatar loaded and scene initialized');
  } catch (error) {
    console.error('Error loading avatar:', error);
    updateStatus('Error loading avatar image. Please try another image.');
  }
}

function startRecording() {
  if (isRecording || !canvas) return;
  
  try {
    const canvasStream = canvas.captureStream(30); // 30 FPS capture
    mediaRecorder = new MediaRecorder(canvasStream, {
      mimeType: MediaRecorder.isTypeSupported('video/webm; codecs=vp9') 
        ? 'video/webm; codecs=vp9' 
        : 'video/webm'
    });
    
    recordedChunks = [];
    
    mediaRecorder.ondataavailable = event => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, {
        type: 'video/webm'
      });
      
      // Create a download link for the recorded video
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = 'spromoji_recording.webm';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      updateStatus('Recording saved! Check your downloads.');
      console.log('Recording saved');
    };
    
    mediaRecorder.start();
    isRecording = true;
    startBtn.textContent = 'Recording... (5s)';
    startBtn.disabled = true;
    updateStatus('Recording in progress...');
    
    // Record for 5 seconds
    setTimeout(() => {
      stopRecording();
    }, 5000);
    
  } catch (error) {
    updateStatus('Error starting recording. Please try again.');
    console.error('Error starting recording:', error);
  }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  
  mediaRecorder.stop();
  isRecording = false;
  startBtn.textContent = '🎬 Start Recording';
  startBtn.disabled = false;
  updateStatus('Processing recording...');
}

async function main() {
  // Set up face mesh processing
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

  // Set up camera
  const camera = new Camera(cam, {
    onFrame: async () => {
      await facemesh.send({ image: cam });
    },
  });

  // Function to start preview (camera + face mesh)
  async function startPreview() {
    try {
      updateStatus('Starting camera and face tracking...');
      await camera.start();
      hideLoading();
      updateStatus('Camera active! Move your face to see the avatar respond.');
      console.log('Camera and face mesh started');
    } catch (error) {
      hideLoading();
      updateStatus('Camera access denied. Please allow camera permissions and refresh.');
      console.error('Error starting camera:', error);
    }
  }

  // Load avatar from URL parameters (Telegram profile photo)
  const urlParams = new URLSearchParams(window.location.search);
  const startParams = new URLSearchParams(tg?.initDataUnsafe?.start_param || '');
  const avatarParam = startParams.get('avatar') || urlParams.get('avatar');
  const userPhoto = avatarParam || tg?.initDataUnsafe?.user?.photo_url;
  
  if (userPhoto) {
    console.log('Loading avatar from URL:', userPhoto);
    await setupAvatarFromPhoto(userPhoto);
    await startPreview(); // Start preview as soon as avatar is loaded
  }

  // Handle file input for avatar upload
  avatarInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    console.log('Loading avatar from file:', file.name);
    const url = URL.createObjectURL(file);
    await setupAvatarFromPhoto(url);
    URL.revokeObjectURL(url);
    
    // Start preview if not already started
    if (!userPhoto) {
      await startPreview();
    }
  });

  // Handle recording button
  startBtn.addEventListener('click', () => {
    if (!avatarImg) {
      updateStatus('Please select an avatar image first!');
      return;
    }
    startRecording();
  });

  // If no avatar is loaded initially, start camera anyway for preview
  if (!userPhoto) {
    updateStatus('Please upload an avatar image to get started!');
    await startPreview();
  }
}

main();
