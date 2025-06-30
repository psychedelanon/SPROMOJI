import { FaceMesh } from 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';
import { Camera } from 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';
import * as THREE from 'https://unpkg.com/three@0.161.1/build/three.module.js';

const tg = window.Telegram.WebApp;
if (tg && tg.expand) tg.expand();

console.log('🌟 SPROMOJI WebApp started!');

const canvas = document.getElementById('avatarCanvas');
const cam = document.getElementById('cam');
const avatarInput = document.getElementById('avatarInput');
const startBtn = document.getElementById('startBtn');
const loadingIndicator = document.getElementById('loading');
const statusText = document.getElementById('status');

console.log('DOM elements found:', {
  canvas: !!canvas,
  cam: !!cam,
  avatarInput: !!avatarInput,
  startBtn: !!startBtn,
  loadingIndicator: !!loadingIndicator,
  statusText: !!statusText
});

let avatarImg = null;
let renderer, scene, camera3D, mesh;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

function updateStatus(message) {
  if (statusText) {
    statusText.textContent = message;
  }
  console.log('📱 Status:', message);
}

function hideLoading() {
  if (loadingIndicator) {
    loadingIndicator.style.display = 'none';
    console.log('✅ Loading indicator hidden');
  }
}

// Emergency timeout to prevent infinite loading
setTimeout(() => {
  console.log('🚨 Emergency timeout: Force hiding loading screen');
  hideLoading();
  updateStatus('App ready! Please wait for face tracking to initialize...');
}, 2000);

// Initial status update
updateStatus('Initializing SPROMOJI...');

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
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      console.log('Avatar image loaded successfully');
      resolve(img);
    };
    
    img.onerror = (error) => {
      console.error('Failed to load avatar image:', error);
      console.error('Image src was:', src);
      reject(new Error('Failed to load avatar image'));
    };
    
    img.src = src;
  });
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
  console.log('🚀 Starting SPROMOJI initialization...');
  
  // Add immediate debug logging
  console.log('MediaPipe imports available:', { FaceMesh: typeof FaceMesh, Camera: typeof Camera });
  console.log('Canvas elements:', { canvas, cam, avatarInput });
  
  let facemesh = null;
  let camera = null;
  
  try {
    console.log('📷 Initializing Face Mesh...');
    updateStatus('Initializing face tracking system...');
    
    // Set up face mesh processing with error handling
    facemesh = new FaceMesh({
      locateFile: (f) => {
        const url = `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`;
        console.log('Loading MediaPipe file:', url);
        return url;
      },
    });
    
    console.log('⚙️ Setting Face Mesh options...');
    facemesh.setOptions({
      selfieMode: true,
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    facemesh.onResults((res) => {
      if (!avatarImg || !res.multiFaceLandmarks.length) return;
      const l = res.multiFaceLandmarks[0];
      const pose = estimatePose(l);
      const blink = detectBlink(l);
      const mouthOpen = detectMouthOpen(l);
      animateMesh(pose, blink, mouthOpen);
    });
    
    console.log('✅ Face Mesh initialized successfully');

    // Set up camera with error handling
    console.log('📹 Setting up camera...');
    camera = new Camera(cam, {
      onFrame: async () => {
        try {
          await facemesh.send({ image: cam });
        } catch (error) {
          console.error('Error processing frame:', error);
        }
      },
      width: 640,
      height: 480
    });
    
    console.log('✅ Camera initialized successfully');
    
  } catch (error) {
    console.error('❌ Error initializing MediaPipe:', error);
    updateStatus('Face tracking initialization failed. Using fallback mode.');
    hideLoading();
    return; // Exit early if MediaPipe fails
  }

  // Function to start preview (camera + face mesh)
  async function startPreview() {
    console.log('🎬 Starting preview...');
    try {
      updateStatus('Starting camera and face tracking...');
      
      if (!camera) {
        throw new Error('Camera not initialized');
      }
      
      console.log('📹 Starting camera stream...');
      await camera.start();
      
      console.log('✅ Camera started successfully');
      hideLoading();
      updateStatus('Camera active! Move your face to see the avatar respond.');
      console.log('Camera and face mesh started');
      
    } catch (error) {
      console.error('❌ Error starting camera:', error);
      hideLoading();
      
      if (error.name === 'NotAllowedError') {
        updateStatus('Camera permission denied. Please allow camera access and refresh the page.');
      } else if (error.name === 'NotFoundError') {
        updateStatus('No camera found. Please connect a camera and refresh.');
      } else {
        updateStatus('Camera failed to start. Please refresh and try again.');
      }
    }
  }

  // Load avatar from URL parameters (Telegram profile photo)
  const urlParams = new URLSearchParams(window.location.search);
  const startParams = new URLSearchParams(tg?.initDataUnsafe?.start_param || '');
  const avatarParam = startParams.get('avatar') || urlParams.get('avatar');
  const userPhoto = avatarParam || tg?.initDataUnsafe?.user?.photo_url;
  
  if (userPhoto) {
    console.log('Loading avatar from URL:', userPhoto);
    try {
      await setupAvatarFromPhoto(userPhoto);
      await startPreview(); // Start preview as soon as avatar is loaded
    } catch (error) {
      console.error('Failed to load Telegram avatar, starting preview anyway:', error);
      updateStatus('Failed to load profile photo. Please upload an image or try again.');
      await startPreview(); // Start preview even if avatar fails
    }
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
  
  // Ensure loading indicator disappears after a timeout
  setTimeout(() => {
    console.log('⏰ Timeout check - Loading indicator visible:', 
                loadingIndicator && loadingIndicator.style.display !== 'none');
    if (loadingIndicator && loadingIndicator.style.display !== 'none') {
      console.log('⚠️ Timeout: Force hiding loading indicator');
      hideLoading();
      if (!avatarImg) {
        updateStatus('Ready! Upload an avatar image to get started.');
      } else {
        updateStatus('Face tracking may have issues. Try refreshing if avatar doesn\'t move.');
      }
    }
  }, 3000); // Reduced to 3 second timeout
  
  console.log('🎉 SPROMOJI initialization complete!');
}

// Fallback initialization if MediaPipe fails
async function fallbackMode() {
  console.log('🔄 Starting fallback mode without face tracking...');
  hideLoading();
  updateStatus('Running in basic mode. Upload an avatar to see it displayed.');
  
  // Set up basic recording without face tracking
  startBtn.addEventListener('click', () => {
    if (!avatarImg) {
      updateStatus('Please select an avatar image first!');
      return;
    }
    
    // Simple canvas recording without face mesh
    updateStatus('Recording static avatar...');
    const canvasStream = canvas.captureStream(30);
    const recorder = new MediaRecorder(canvasStream);
    const chunks = [];
    
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'spromoji_static.webm';
      a.click();
      updateStatus('Static recording saved!');
    };
    
    recorder.start();
    setTimeout(() => recorder.stop(), 3000);
  });
}

// Initialize with error handling
try {
  main().catch(error => {
    console.error('❌ Main initialization failed:', error);
    fallbackMode();
  });
} catch (error) {
  console.error('❌ Critical initialization error:', error);
  fallbackMode();
}
