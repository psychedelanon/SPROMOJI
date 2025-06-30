// SPROMOJI - Live Avatar Animation
// Clean implementation with MediaPipe Face Mesh and 2D Canvas

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
let avatarLandmarks = null; // face landmarks from static avatar analysis
let faceMesh = null;
let camera = null;
let isRecording = false;

// Telegram WebApp initialization
const tg = window.Telegram?.WebApp;
if (tg && tg.expand) tg.expand();

/**
 * Load avatar image with CORS support
 * @param {string} src - Image URL
 * @returns {Promise<HTMLImageElement>}
 */
async function loadAvatar(src) {
    console.log('[preview] Loading avatar:', src);
    updateStatus('Loading avatar image...');
    
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
            console.log('[preview] Avatar loaded, size:', img.width, 'x', img.height);
            
            // Resize canvas to match image aspect ratio
            const maxSize = 400;
            const scale = Math.min(maxSize / img.width, maxSize / img.height);
            avatarCanvas.width = img.width * scale;
            avatarCanvas.height = img.height * scale;
            
            // Draw initial image
            ctx.drawImage(img, 0, 0, avatarCanvas.width, avatarCanvas.height);
            
            avatarImg = img;
            
            // Analyze avatar for face landmarks
            analyzeAvatarFace(img);
            
            resolve(img);
        };
        
        img.onerror = (error) => {
            console.error('[preview] Failed to load avatar:', error);
            reject(new Error('Failed to load avatar image'));
        };
        
        img.src = src;
    });
}

/**
 * Analyze static avatar image to find face landmarks
 * @param {HTMLImageElement} img - Avatar image
 */
function analyzeAvatarFace(img) {
    if (!faceMesh) {
        console.log('[preview] FaceMesh not ready, skipping avatar analysis');
        return;
    }
    
    console.log('[preview] Analyzing avatar face...');
    
    // Create a temporary canvas to analyze the avatar
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(img, 0, 0);
    
    faceMesh.send({ image: tempCanvas });
}

/**
 * Initialize webcam and face tracking
 */
async function initPreview() {
    console.log('[preview] Initializing webcam and face tracking...');
    updateStatus('Starting camera...');
    
    try {
        // Request webcam access
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: { ideal: 640 }, 
                height: { ideal: 480 },
                facingMode: 'user'
            }
        });
        
        cam.srcObject = stream;
        console.log('[preview] Webcam started');
        
        // Wait for MediaPipe scripts to load
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
        
        faceMesh.onResults(onFaceResults);
        
        // Initialize camera feed
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
        console.error('[preview] Failed to initialize preview:', error);
        updateStatus('Camera access denied or not available. Upload an image to continue.');
        hideLoading();
    }
}

/**
 * Wait for MediaPipe scripts to load
 */
function waitForMediaPipe() {
    return new Promise((resolve) => {
        const checkLoaded = () => {
            if (window.FaceMesh && window.Camera) {
                resolve();
            } else {
                setTimeout(checkLoaded, 100);
            }
        };
        checkLoaded();
    });
}

/**
 * Handle face detection results
 * @param {Object} results - MediaPipe face mesh results
 */
function onFaceResults(results) {
    // If this is avatar analysis (no live landmarks yet)
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0 && !avatarLandmarks && !camera) {
        avatarLandmarks = results.multiFaceLandmarks[0];
        console.log('[preview] Avatar face landmarks captured');
        updateStatus('Avatar face analyzed! Move your head to see animation.');
        return;
    }
    
    if (!avatarImg || !results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        return;
    }
    
    const landmarks = results.multiFaceLandmarks[0];
    
    // Compute head pose and facial expressions
    const roll = computeHeadRoll(landmarks);
    const mouthOpenness = computeMouthOpenness(landmarks);
    
    console.debug('[preview] roll=', roll.toFixed(3), 'mouth=', mouthOpenness.toFixed(3));
    
    // Animate avatar
    animateAvatar(roll, mouthOpenness);
}

/**
 * Compute head roll angle from eye corners
 * @param {Array} landmarks - Face landmarks
 * @returns {number} Roll angle in radians
 */
function computeHeadRoll(landmarks) {
    // Use eye corners for roll calculation
    const leftEye = landmarks[33];  // Left eye outer corner
    const rightEye = landmarks[263]; // Right eye outer corner
    
    const deltaY = rightEye.y - leftEye.y;
    const deltaX = rightEye.x - leftEye.x;
    
    return Math.atan2(deltaY, deltaX);
}

/**
 * Compute mouth openness ratio
 * @param {Array} landmarks - Face landmarks  
 * @returns {number} Mouth openness ratio
 */
function computeMouthOpenness(landmarks) {
    // Upper and lower lip landmarks
    const upperLip = landmarks[13];
    const lowerLip = landmarks[14];
    
    const mouthHeight = Math.abs(lowerLip.y - upperLip.y);
    
    // Compare with avatar's baseline mouth if available
    if (avatarLandmarks) {
        const avatarUpperLip = avatarLandmarks[13];
        const avatarLowerLip = avatarLandmarks[14];
        const avatarMouthHeight = Math.abs(avatarLowerLip.y - avatarUpperLip.y);
        return avatarMouthHeight > 0 ? mouthHeight / avatarMouthHeight : mouthHeight;
    }
    
    // Fallback to absolute threshold
    return mouthHeight > 0.01 ? mouthHeight * 50 : 0;
}

/**
 * Animate avatar based on face tracking data
 * @param {number} roll - Head roll angle in radians
 * @param {number} mouthOpenness - Mouth openness ratio
 */
function animateAvatar(roll, mouthOpenness) {
    if (!avatarImg) return;
    
    const centerX = avatarCanvas.width / 2;
    const centerY = avatarCanvas.height / 2;
    const avatarWidth = avatarCanvas.width;
    const avatarHeight = avatarCanvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);
    
    // Save context for transformations
    ctx.save();
    
    // Move to center for rotation
    ctx.translate(centerX, centerY);
    
    // Apply head roll rotation
    ctx.rotate(roll);
    
    // Draw base avatar
    ctx.drawImage(avatarImg, -avatarWidth/2, -avatarHeight/2, avatarWidth, avatarHeight);
    
    // Simple mouth animation - draw a second layer if mouth is open
    const mouthThreshold = 1.2;
    if (mouthOpenness > mouthThreshold) {
        console.debug('[preview] mouth open, adding talking effect');
        
        // Create a simple "talking mouth" effect by drawing the avatar slightly stretched
        ctx.save();
        ctx.scale(1, 1.05); // Slightly stretch vertically
        ctx.globalAlpha = 0.7;
        
        // Create mouth area mask (simple ellipse approximation)
        ctx.beginPath();
        ctx.ellipse(0, avatarHeight * 0.1, avatarWidth * 0.2, avatarHeight * 0.1, 0, 0, 2 * Math.PI);
        ctx.clip();
        
        // Draw stretched avatar for mouth area
        ctx.drawImage(avatarImg, -avatarWidth/2, -avatarHeight/2 + 3, avatarWidth, avatarHeight);
        
        ctx.restore();
    }
    
    // Restore context
    ctx.restore();
}

/**
 * Start recording the canvas
 */
function startRecording() {
    if (isRecording) return;
    
    console.log('[preview] Starting recording...');
    isRecording = true;
    startBtn.disabled = true;
    startBtn.textContent = '🎬 Recording... (5s)';
    
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
        console.log('[preview] Recording stopped');
        const blob = new Blob(chunks, { type: 'video/webm' });
        
        // TODO: Send blob back to bot or offer download
        console.log('[preview] Recorded blob size:', blob.size, 'bytes');
        
        // For now, create download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'spromoji-avatar.webm';
        a.textContent = 'Download Recording';
        a.style.display = 'block';
        a.style.marginTop = '10px';
        a.style.color = 'white';
        startBtn.parentNode.appendChild(a);
        
        // Reset button
        isRecording = false;
        startBtn.disabled = false;
        startBtn.textContent = '🎬 Start Recording';
        updateStatus('Recording complete! Click the download link above.');
    };
    
    recorder.start();
    
    // Record for 5 seconds
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
    console.log('[preview] Status:', message);
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
    console.log('[preview] Initializing app...');
    
    // Check for avatar URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const avatarUrl = urlParams.get('avatar');
    
    if (avatarUrl) {
        console.log('[preview] Found avatar URL parameter');
        try {
            await loadAvatar(decodeURIComponent(avatarUrl));
            updateStatus('Avatar loaded! Initializing face tracking...');
        } catch (error) {
            console.error('[preview] Failed to load avatar from URL:', error);
            updateStatus('Failed to load avatar. Please upload an image.');
            hideLoading();
        }
    } else {
        console.log('[preview] No avatar URL found');
        updateStatus('Please upload an avatar image to begin.');
        hideLoading();
    }
    
    // Initialize preview regardless (for live face tracking)
    await initPreview();
}

// Event listeners
startBtn.addEventListener('click', startRecording);

avatarInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) {
        console.log('[preview] Loading uploaded avatar:', file.name);
        const url = URL.createObjectURL(file);
        try {
            await loadAvatar(url);
            updateStatus('Avatar uploaded! Face tracking active.');
        } catch (error) {
            console.error('[preview] Failed to load uploaded avatar:', error);
            updateStatus('Failed to load uploaded image.');
        }
    }
});

// Graceful error handling
window.addEventListener('error', (event) => {
    console.error('[preview] Global error:', event.error);
    updateStatus('An error occurred. Please refresh the page.');
});

// Initialize when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

console.log('[preview] SPROMOJI script loaded successfully'); 