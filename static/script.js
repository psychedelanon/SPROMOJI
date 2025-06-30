// SPROMOJI - Landmark-to-Landmark Facial Morphing (Memoji-lite)
// Phase P0: Avatar landmark detection and caching
// Phase P1: Real-time mouth/eye morphing with Delaunay triangulation

console.log('[morph] SPROMOJI Facial Morphing starting...');

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
let avatarLandmarks = null;    // P0: Cached avatar facial landmarks
let avatarTriangulation = null; // P0: Cached triangulation data
let faceMesh = null;
let camera = null;
let isRecording = false;
let previewRunning = false;
let morphingEnabled = false;   // P1: Fallback flag

// Performance monitoring
let lastFrameTime = 0;
let frameCount = 0;

// Create off-screen canvas for avatar processing
let avatarSrcCanvas = null;
let avatarSrcCtx = null;

// Telegram WebApp initialization
const tg = window.Telegram?.WebApp;
if (tg && tg.expand) tg.expand();

/**
 * Robust avatar loader with CORS fallback
 * @param {string} src - Image URL
 */
async function loadAvatar(src) {
    console.log('[morph] Loading avatar:', src);
    updateStatus('Loading avatar image...');
    
    try {
        await drawImage(src);
        console.debug('[morph] Avatar loaded successfully');
        
        // P0: Try to analyze avatar for facial landmarks (will defer if MediaPipe not ready)
        const analysisSuccess = await analyzeAvatarFace();
        if (!analysisSuccess) {
            console.log('[morph] Avatar analysis deferred - will retry when MediaPipe ready');
        }
        
    } catch (e) {
        console.warn('[morph] Primary load failed, trying CORS fallback');
        try {
            // Fallback: fetch as blob then ObjectURL to bypass CORS
            const blob = await fetch(src).then(r => r.blob());
            const localUrl = URL.createObjectURL(blob);
            await drawImage(localUrl);
            console.debug('[morph] Fallback load successful');
            
            // P0: Try to analyze avatar for facial landmarks (will defer if MediaPipe not ready)
            const analysisSuccess = await analyzeAvatarFace();
            if (!analysisSuccess) {
                console.log('[morph] Avatar analysis deferred - will retry when MediaPipe ready');
            }
            
        } catch (fallbackError) {
            console.error('[morph] Both loading methods failed:', fallbackError);
            updateStatus('Failed to load avatar image');
            hideLoading(); // Make sure loading is hidden on failure
            throw fallbackError;
        }
    }
    
    // Start face-mesh preview once avatar is ready
    initPreview();
}

/**
 * Draw image to canvas and prepare for morphing
 * @param {string} url - Image URL
 */
function drawImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        
        img.onload = () => {
            avatarImg = img;
            
            // Downscale to max 256px for performance (P1 optimization)
            const maxSize = 256;
            const scale = Math.min(maxSize / img.width, maxSize / img.height);
            const scaledWidth = Math.floor(img.width * scale);
            const scaledHeight = Math.floor(img.height * scale);
            
            // Set canvas size
            avatarCanvas.width = scaledWidth;
            avatarCanvas.height = scaledHeight;
            
            // Create off-screen source canvas for morphing
            avatarSrcCanvas = document.createElement('canvas');
            avatarSrcCanvas.width = scaledWidth;
            avatarSrcCanvas.height = scaledHeight;
            avatarSrcCtx = avatarSrcCanvas.getContext('2d');
            
            // Draw initial image to both canvases
            ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
            avatarSrcCtx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
            
            updateStatus('Avatar loaded! Preparing face tracking...');
            resolve();
        };
        
        img.onerror = (error) => {
            console.error('[morph] Image load error:', error);
            reject(new Error('Failed to load image'));
        };
        
        // No crossOrigin - proxy handles CORS
        img.src = url;
    });
}

/**
 * P0: Analyze static avatar image to detect facial landmarks
 */
async function analyzeAvatarFace() {
    if (!faceMesh) {
        console.log('[morph] FaceMesh not ready, will analyze later');
        return false;
    }
    
    console.log('[morph] Analyzing avatar facial structure...');
    updateStatus('Detecting facial landmarks...');
    
    try {
        // Send avatar to MediaPipe for landmark detection with timeout
        const results = await Promise.race([
            new Promise((resolve) => {
                const originalHandler = faceMesh.onResults;
                
                // Temporary handler for avatar analysis
                faceMesh.onResults = (results) => {
                    faceMesh.onResults = originalHandler; // Restore original handler
                    resolve(results);
                };
                
                faceMesh.send({ image: avatarSrcCanvas });
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Avatar analysis timeout')), 5000)
            )
        ]);
        
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            avatarLandmarks = results.multiFaceLandmarks[0];
            
            // Scale landmarks to canvas coordinates
            for (let landmark of avatarLandmarks) {
                landmark.x *= avatarCanvas.width;
                landmark.y *= avatarCanvas.height;
            }
            
            console.log('[morph] Avatar landmarks detected:', avatarLandmarks.length, 'points');
            
            // P0: Create triangulation
            if (window.FacialMorph && window.Delaunator) {
                avatarTriangulation = window.FacialMorph.triangulatePoints(avatarLandmarks);
                morphingEnabled = true;
                updateStatus('Facial morphing ready! Camera starting...');
                console.log('[morph] Triangulation created, morphing enabled');
                return true;
            } else {
                console.warn('[morph] Delaunator not available, fallback to rotation mode');
                morphingEnabled = false;
                updateStatus('Basic animation ready (morphing unavailable)');
                return false;
            }
        } else {
            console.warn('[morph] No face detected in avatar, using fallback mode');
            morphingEnabled = false;
            updateStatus('No face detected - using basic rotation mode');
            return false;
        }
        
    } catch (error) {
        console.error('[morph] Avatar analysis failed:', error);
        morphingEnabled = false;
        updateStatus('Face analysis failed - using basic rotation mode');
        return false;
    }
}

/**
 * Initialize webcam and face tracking
 */
async function initPreview() {
    if (previewRunning) {
        console.log('[morph] Preview already running');
        return;
    }
    
    console.log('[morph] Initializing webcam and face tracking...');
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
        console.log('[morph] Webcam started');
        
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
        
        faceMesh.onResults(onFaceResults);
        
        // If avatar wasn't analyzed yet, do it now that MediaPipe is ready
        if (avatarImg && !avatarLandmarks) {
            console.log('[morph] MediaPipe ready, analyzing avatar now...');
            const analysisSuccess = await analyzeAvatarFace();
            if (!analysisSuccess) {
                console.log('[morph] Avatar analysis failed, continuing with basic mode');
            }
        }
        
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
        console.log('[morph] Face tracking started');
        updateStatus(morphingEnabled ? 
            'Facial morphing active - move your face!' : 
            'Basic animation active - no morphing available');
        hideLoading();
        
    } catch (error) {
        console.error('[morph] Failed to initialize:', error);
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
                console.log('[morph] MediaPipe loaded');
                resolve();
            } else {
                setTimeout(checkLoaded, 100);
            }
        };
        checkLoaded();
    });
}

/**
 * P1: Handle face detection results with real-time morphing
 * @param {Object} results - MediaPipe face mesh results
 */
function onFaceResults(results) {
    if (!avatarImg || !results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        return;
    }
    
    // Performance throttling - target 30 FPS max
    const now = performance.now();
    if (now - lastFrameTime < 33) return; // ~30 FPS
    lastFrameTime = now;
    
    const userLandmarks = results.multiFaceLandmarks[0];
    
    // Scale user landmarks to canvas coordinates
    const scaledUserLandmarks = userLandmarks.map(landmark => ({
        x: landmark.x * avatarCanvas.width,
        y: landmark.y * avatarCanvas.height,
        z: landmark.z || 0
    }));
    
    if (morphingEnabled && avatarLandmarks && avatarTriangulation && window.FacialMorph) {
        // P1: Real-time facial morphing
        morphAvatarFace(scaledUserLandmarks);
    } else {
        // Fallback: Basic rotation and simple effects
        fallbackAnimation(scaledUserLandmarks);
    }
    
    // Performance monitoring
    frameCount++;
    if (frameCount % 30 === 0) {
        const fps = 1000 / (now - lastFrameTime);
        console.debug(`[morph] Rendering FPS: ${fps.toFixed(1)}`);
    }
}

/**
 * P1: Perform real-time facial morphing using triangulation
 * @param {Array} userLandmarks - Live user facial landmarks
 */
function morphAvatarFace(userLandmarks) {
    try {
        // Get optimized triangle set for expressive regions
        const expressionTriangles = window.FacialMorph.getExpressionTriangles(
            avatarTriangulation.triangles
        );
        
        // Apply head rotation first
        const roll = computeHeadRoll(userLandmarks);
        
        ctx.save();
        ctx.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);
        
        // Apply rotation around center
        ctx.translate(avatarCanvas.width / 2, avatarCanvas.height / 2);
        ctx.rotate(roll);
        ctx.translate(-avatarCanvas.width / 2, -avatarCanvas.height / 2);
        
        // P1: Morph facial features using triangulation
        window.FacialMorph.morphFace(
            avatarSrcCtx,
            ctx,
            avatarLandmarks,
            userLandmarks,
            expressionTriangles
        );
        
        ctx.restore();
        
        // Log performance metrics
        window.FacialMorph.logMorphPerformance();
        
    } catch (error) {
        console.error('[morph] Morphing failed, falling back:', error);
        morphingEnabled = false; // Disable morphing on error
        fallbackAnimation(userLandmarks);
    }
}

/**
 * Fallback animation for when morphing is unavailable
 * @param {Array} userLandmarks - Live user facial landmarks
 */
function fallbackAnimation(userLandmarks) {
    const roll = computeHeadRoll(userLandmarks);
    const mouthOpen = computeMouthOpenness(userLandmarks);
    
    const centerX = avatarCanvas.width / 2;
    const centerY = avatarCanvas.height / 2;
    const width = avatarCanvas.width;
    const height = avatarCanvas.height;
    
    // Clear and apply basic transforms
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    
    // Rotate around center
    ctx.translate(centerX, centerY);
    ctx.rotate(roll);
    
    // Draw avatar
    ctx.drawImage(avatarImg, -width/2, -height/2, width, height);
    
    // Simple mouth effect
    if (mouthOpen) {
        ctx.save();
        ctx.scale(1, 1.05);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.ellipse(0, height * 0.1, width * 0.2, height * 0.08, 0, 0, 2 * Math.PI);
        ctx.clip();
        ctx.drawImage(avatarImg, -width/2, -height/2 + 2, width, height);
        ctx.restore();
    }
    
    ctx.restore();
}

/**
 * Compute head roll angle from eye corners
 * @param {Array} landmarks - Face landmarks
 * @returns {number} Roll angle in radians
 */
function computeHeadRoll(landmarks) {
    const leftEye = landmarks[33];   // Left eye outer corner
    const rightEye = landmarks[263]; // Right eye outer corner
    return Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
}

/**
 * Compute mouth openness
 * @param {Array} landmarks - Face landmarks
 * @returns {boolean} Whether mouth is open
 */
function computeMouthOpenness(landmarks) {
    const upperLip = landmarks[13];
    const lowerLip = landmarks[14];
    const mouthHeight = Math.abs(lowerLip.y - upperLip.y);
    return mouthHeight > 0.01 * avatarCanvas.height; // Scale to canvas
}

/**
 * Start recording the animated canvas
 */
function startRecording() {
    if (isRecording || !avatarImg) {
        console.log('[morph] Already recording or no avatar loaded');
        return;
    }
    
    console.log('[morph] Starting recording...');
    isRecording = true;
    startBtn.disabled = true;
    startBtn.textContent = '🎬 Recording... (5s)';
    updateStatus('Recording facial morphing animation...');
    
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
        console.log('[morph] Recording stopped');
        const blob = new Blob(chunks, { type: 'video/webm' });
        
        // Create styled download link
        const url = URL.createObjectURL(blob);
        
        // Remove existing download link
        const existingLink = document.querySelector('.download-link');
        if (existingLink) existingLink.remove();
        
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = `spromoji-morph-${Date.now()}.webm`;
        downloadLink.textContent = '📥 Download Your Morphing Animation';
        downloadLink.className = 'download-link';
        downloadLink.style.cssText = `
            display: block;
            margin-top: 15px;
            padding: 12px 24px;
            background: linear-gradient(45deg, #28a745, #20c997);
            color: white;
            text-decoration: none;
            border-radius: 10px;
            text-align: center;
            font-weight: bold;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            transition: transform 0.2s ease;
        `;
        
        downloadLink.addEventListener('mouseenter', () => {
            downloadLink.style.transform = 'translateY(-2px)';
        });
        
        downloadLink.addEventListener('mouseleave', () => {
            downloadLink.style.transform = 'translateY(0)';
        });
        
        startBtn.parentNode.appendChild(downloadLink);
        
        // Reset recording state
        isRecording = false;
        startBtn.disabled = false;
        startBtn.textContent = '🎬 Start Recording';
        updateStatus(`Recording complete! ${morphingEnabled ? 'Morphing' : 'Basic'} animation saved.`);
        
        console.log('[morph] Download link created, blob size:', blob.size, 'bytes');
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
    console.log('[morph]', message);
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
    console.log('[morph] Initializing facial morphing system...');
    
    // Failsafe: ensure loading indicator is hidden after 10 seconds max
    setTimeout(() => {
        if (loadingIndicator && loadingIndicator.style.display !== 'none') {
            console.warn('[morph] Forcing loading indicator to hide after timeout');
            hideLoading();
            if (!avatarImg) {
                updateStatus('Please upload an avatar image to begin.');
            } else if (!morphingEnabled) {
                updateStatus('Basic animation mode active');
            }
        }
    }, 10000);
    
    // Check for avatar URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const avatarUrl = urlParams.get('avatar');
    
    if (avatarUrl) {
        console.log('[morph] Found avatar URL parameter:', avatarUrl);
        try {
            const decodedUrl = decodeURIComponent(avatarUrl);
            await loadAvatar(decodedUrl);
        } catch (error) {
            console.error('[morph] Failed to load avatar from URL:', error);
            updateStatus('Failed to load avatar. Please upload an image.');
            hideLoading();
        }
    } else {
        console.log('[morph] No avatar URL found');
        updateStatus('Please upload an avatar image to begin.');
        hideLoading();
    }
}

// Event listeners
startBtn.addEventListener('click', startRecording);

avatarInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) {
        console.log('[morph] Processing uploaded file:', file.name);
        const url = URL.createObjectURL(file);
        try {
            await loadAvatar(url);
            updateStatus('Avatar uploaded! Facial analysis complete.');
        } catch (error) {
            console.error('[morph] Failed to load uploaded image:', error);
            updateStatus('Failed to load uploaded image.');
        }
    }
});

// Global error handling
window.addEventListener('error', (event) => {
    console.error('[morph] Global error:', event.error);
    updateStatus('An error occurred. Falling back to basic mode.');
    morphingEnabled = false; // Disable morphing on critical errors
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

console.log('[morph] SPROMOJI Facial Morphing system loaded successfully');

/* TODO: Phase P2 - Advanced Morphing Features
 * 
 * 1. Enhanced Facial Expressions:
 *    - Eyebrow movement detection and morphing
 *    - Cheek puffing and smile intensity
 *    - Nostril flaring and nose wrinkling
 *    - Forehead wrinkle mapping
 * 
 * 2. Performance Optimizations:
 *    - WebGL-based morphing for 60 FPS on mobile
 *    - Level-of-detail (LOD) triangle reduction
 *    - Adaptive quality based on device performance
 *    - Background processing with Web Workers
 * 
 * 3. Advanced Visual Effects:
 *    - Real-time lighting adjustment
 *    - Skin texture enhancement
 *    - Hair movement simulation
 *    - Environmental reflection mapping
 * 
 * 4. Multi-Avatar Support:
 *    - Switch between multiple stored avatars
 *    - Avatar blending and morphing
 *    - Style transfer between different faces
 *    - Real-time avatar generation from photos
 * 
 * Implementation targets:
 *    - 60 FPS on mobile devices
 *    - Sub-16ms frame time budget
 *    - 4K video recording support
 *    - WebRTC streaming capabilities
 */ 