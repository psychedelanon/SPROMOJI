// SPROMOJI - Live Avatar Animation
// Fixed implementation with CORS proxy, robust loading, and proper preview

console.log('[preview] SPROMOJI starting...');

// DOM elements
const cam = document.getElementById('cam');
const avatarCanvas = document.getElementById('avatarCanvas');
const ctx = avatarCanvas.getContext('2d');
const avatarInput = document.getElementById('avatarInput');
const startBtn = document.getElementById('startBtn');
const loadingIndicator = document.getElementById('loading');
const statusText = document.getElementById('status');

// Global state
let avatarImg = null;
let faceMesh = null;
let camera = null;
let isRecording = false;
let previewRunning = false;

// Telegram WebApp initialization
const tg = window.Telegram?.WebApp;
if (tg && tg.expand) tg.expand();

/**
 * Robust avatar loader with CORS fallback
 * @param {string} src - Image URL
 */
async function loadAvatar(src) {
    console.log('[avatar] Loading avatar:', src);
    updateStatus('Loading avatar image...');
    
    try {
        await drawImage(src);
        console.debug('[avatar] loaded ok');
    } catch (e) {
        console.warn('[avatar] cors fallback triggered');
        try {
            // Fallback: fetch as blob then ObjectURL to bypass CORS
            const blob = await fetch(src).then(r => r.blob());
            const localUrl = URL.createObjectURL(blob);
            await drawImage(localUrl);
            console.debug('[avatar] fallback successful');
        } catch (fallbackError) {
            console.error('[avatar] both methods failed:', fallbackError);
            updateStatus('Failed to load avatar image');
            throw fallbackError;
        }
    }
    
    // Start face-mesh preview once avatar is visible
    initPreview();
}

/**
 * Draw image to canvas without CORS restrictions
 * @param {string} url - Image URL
 */
function drawImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        
        img.onload = () => {
            avatarImg = img;
            
            // Resize canvas to match image while maintaining aspect ratio
            const maxSize = 400;
            const scale = Math.min(maxSize / img.width, maxSize / img.height);
            avatarCanvas.width = img.width * scale;
            avatarCanvas.height = img.height * scale;
            
            // Draw initial image
            ctx.drawImage(img, 0, 0, avatarCanvas.width, avatarCanvas.height);
            
            updateStatus('Avatar loaded! Initializing face tracking...');
            resolve();
        };
        
        img.onerror = (error) => {
            console.error('[avatar] Image load error:', error);
            reject(new Error('Failed to load image'));
        };
        
        // Important: do NOT set crossOrigin here; proxy already fixes CORS
        img.src = url;
    });
}

/**
 * Initialize webcam and face tracking - only once
 */
async function initPreview() {
    if (previewRunning) {
        console.log('[preview] Already running, skipping init');
        return;
    }
    
    console.log('[preview] Initializing webcam and face tracking...');
    previewRunning = true;
    
    try {
        // Get webcam stream
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            }
        });
        
        cam.srcObject = stream;
        console.log('[preview] Webcam started');
        
        // Wait for MediaPipe to be available
        await waitForMediaPipe();
        
        // Initialize face mesh
        faceMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });
        
        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        
        faceMesh.onResults(onFace);
        
        // Initialize camera processing
        camera = new Camera(cam, {
            onFrame: async () => {
                if (faceMesh) {
                    await faceMesh.send({ image: cam });
                }
            },
            width: 640,
            height: 480
        });
        
        await camera.start();
        console.log('[preview] Face tracking started');
        updateStatus('Face tracking active - move your head to see avatar animation!');
        hideLoading();
        
    } catch (error) {
        console.error('[preview] Failed to initialize:', error);
        updateStatus('Camera access denied or face tracking unavailable');
        hideLoading();
        previewRunning = false;
    }
}

/**
 * Wait for MediaPipe scripts to load
 */
function waitForMediaPipe() {
    return new Promise((resolve) => {
        const checkLoaded = () => {
            if (window.FaceMesh && window.Camera) {
                console.log('[preview] MediaPipe loaded');
                resolve();
            } else {
                setTimeout(checkLoaded, 100);
            }
        };
        checkLoaded();
    });
}

/**
 * Handle face detection results - simple rotation and mouth demo
 * @param {Object} results - MediaPipe face mesh results
 */
function onFace(results) {
    if (!avatarImg || !results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        return;
    }
    
    const landmarks = results.multiFaceLandmarks[0];
    
    // Compute head roll from eye corners
    const leftEye = landmarks[33];   // Left eye outer corner
    const rightEye = landmarks[263]; // Right eye outer corner
    const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
    
    // Compute mouth openness
    const upperLip = landmarks[13];
    const lowerLip = landmarks[14];
    const mouthHeight = Math.abs(lowerLip.y - upperLip.y);
    const mouthOpen = mouthHeight > 0.01;
    
    console.debug('[preview] roll=', roll.toFixed(3), 'mouth=', mouthOpen);
    
    // Animate avatar
    animateAvatar(roll, mouthOpen);
}

/**
 * Animate avatar with head rotation and mouth effect
 * @param {number} roll - Head roll angle in radians
 * @param {boolean} mouthOpen - Whether mouth is open
 */
function animateAvatar(roll, mouthOpen) {
    if (!avatarImg) return;
    
    const centerX = avatarCanvas.width / 2;
    const centerY = avatarCanvas.height / 2;
    const width = avatarCanvas.width;
    const height = avatarCanvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Save context for transformations
    ctx.save();
    
    // Move to center and rotate
    ctx.translate(centerX, centerY);
    ctx.rotate(roll);
    
    // Draw base avatar
    ctx.drawImage(avatarImg, -width/2, -height/2, width, height);
    
    // Simple mouth animation - stretch effect when talking
    if (mouthOpen) {
        ctx.save();
        ctx.scale(1, 1.05); // Slightly stretch vertically
        ctx.globalAlpha = 0.6;
        
        // Create mouth area clip (simple ellipse)
        ctx.beginPath();
        ctx.ellipse(0, height * 0.1, width * 0.2, height * 0.08, 0, 0, 2 * Math.PI);
        ctx.clip();
        
        // Draw stretched avatar for mouth area
        ctx.drawImage(avatarImg, -width/2, -height/2 + 2, width, height);
        ctx.restore();
    }
    
    // Restore context
    ctx.restore();
}

/**
 * Start recording the animated canvas
 */
function startRecording() {
    if (isRecording || !avatarImg) {
        console.log('[record] Already recording or no avatar loaded');
        return;
    }
    
    console.log('[record] Starting recording...');
    isRecording = true;
    startBtn.disabled = true;
    startBtn.textContent = '🎬 Recording... (5s)';
    updateStatus('Recording 5-second animation...');
    
    // Create MediaRecorder from canvas stream
    const stream = avatarCanvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { 
        mimeType: 'video/webm;codecs=vp9' 
    });
    
    const chunks = [];
    
    recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            chunks.push(event.data);
        }
    };
    
    recorder.onstop = () => {
        console.log('[record] Recording stopped');
        const blob = new Blob(chunks, { type: 'video/webm' });
        
        // Create download link
        const url = URL.createObjectURL(blob);
        
        // Remove existing download link if any
        const existingLink = document.querySelector('.download-link');
        if (existingLink) existingLink.remove();
        
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = 'spromoji-avatar.webm';
        downloadLink.textContent = '📥 Download Your Animation';
        downloadLink.className = 'download-link';
        downloadLink.style.cssText = `
            display: block;
            margin-top: 15px;
            padding: 10px 20px;
            background: linear-gradient(45deg, #28a745, #20c997);
            color: white;
            text-decoration: none;
            border-radius: 8px;
            text-align: center;
            font-weight: bold;
        `;
        
        startBtn.parentNode.appendChild(downloadLink);
        
        // Reset recording state
        isRecording = false;
        startBtn.disabled = false;
        startBtn.textContent = '🎬 Start Recording';
        updateStatus('Recording complete! Click the download link above.');
        
        console.log('[record] Download link created, blob size:', blob.size, 'bytes');
    };
    
    recorder.start();
    
    // Stop recording after 5 seconds
    setTimeout(() => {
        if (recorder.state === 'recording') {
            recorder.stop();
        }
    }, 5000);
}

/**
 * Update status message
 * @param {string} message - Status message
 */
function updateStatus(message) {
    if (statusText) {
        statusText.textContent = message;
    }
    console.log('[status]', message);
}

/**
 * Hide loading indicator
 */
function hideLoading() {
    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
    }
}

/**
 * Initialize the application
 */
async function initializeApp() {
    console.log('[app] Initializing...');
    
    // Check for avatar URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const avatarUrl = urlParams.get('avatar');
    
    if (avatarUrl) {
        console.log('[app] Found avatar URL parameter:', avatarUrl);
        try {
            const decodedUrl = decodeURIComponent(avatarUrl);
            await loadAvatar(decodedUrl);
        } catch (error) {
            console.error('[app] Failed to load avatar from URL:', error);
            updateStatus('Failed to load avatar. Please upload an image.');
            hideLoading();
        }
    } else {
        console.log('[app] No avatar URL found');
        updateStatus('Please upload an avatar image to begin.');
        hideLoading();
    }
}

// Event listeners
startBtn.addEventListener('click', startRecording);

avatarInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) {
        console.log('[upload] Processing uploaded file:', file.name);
        const url = URL.createObjectURL(file);
        try {
            await loadAvatar(url);
            updateStatus('Avatar uploaded! Face tracking active.');
        } catch (error) {
            console.error('[upload] Failed to load uploaded image:', error);
            updateStatus('Failed to load uploaded image.');
        }
    }
});

// Global error handling
window.addEventListener('error', (event) => {
    console.error('[error] Global error:', event.error);
    updateStatus('An error occurred. Please refresh the page.');
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

console.log('[preview] SPROMOJI script loaded successfully'); 