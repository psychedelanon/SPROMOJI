// SPROMOJI - AI-Driven Real-time Emoji Mirroring
// Using MediaPipe Face Landmarker v0.10.0 with WebWorker processing

console.log('SPROMOJI AI-Driven Loading...');

// DOM elements
let cam, avatarCanvas, debugCanvas, ctx, debugCtx;
let avatarInput, startBtn, loadingIndicator, statusText, manualModeBtn;

// Global state
let avatarImg = null;
let avatarRegions = null;
let worker = null;
let workerReady = false;
let isRecording = false;
let animationReady = false;
let frameCount = 0;
let lastFpsTime = 0;
let loopStarted = false;
let initializationTimeout = null;

function log(...args){ console.debug('[spromoji]', ...args); }

// Telegram WebApp initialization
const tg = window.Telegram?.WebApp;
if (tg?.expand) tg.expand();

/**
 * Initialize the application
 */
async function initializeApp() {
    console.log('[spromoji] Initializing...');
    
    // Get DOM elements with debugging
    avatarCanvas = document.getElementById('avatarCanvas');
    debugCanvas = document.getElementById('debugCanvas');
    cam = document.getElementById('cam');
    startBtn = document.getElementById('startBtn');
    avatarInput = document.getElementById('avatarInput');
    loadingIndicator = document.getElementById('loading');
    statusText = document.getElementById('status');
    manualModeBtn = document.getElementById('manualModeBtn');
    
    console.log('[spromoji] DOM elements found:');
    console.log('  avatarInput:', !!avatarInput);
    console.log('  avatarCanvas:', !!avatarCanvas);
    console.log('  startBtn:', !!startBtn);
    console.log('  manualModeBtn:', !!manualModeBtn);

    
    ctx = avatarCanvas.getContext('2d');
    debugCtx = debugCanvas.getContext('2d');
    
    // Event listeners with debugging
    if (avatarInput) {
        console.log('[spromoji] File input found, adding event listener');
        avatarInput.addEventListener('change', handleAvatarUpload);
    } else {
        console.error('[spromoji] Avatar input element not found!');
    }
    
    manualModeBtn?.addEventListener('click', startManualSelection);
    startBtn?.addEventListener('click', startRecording);
    
    // Auto-load avatar from URL
    const urlParams = new URLSearchParams(window.location.search);
    const avatarParam = urlParams.get('avatar');
    
    if (avatarParam) {
        await loadAvatar(avatarParam);
    } else {
        updateStatus('Upload an avatar image to begin');
        if (manualModeBtn) manualModeBtn.style.display = 'none';
        hideLoading();
    }
}

/**
 * Load and process avatar image
 */
async function loadAvatar(src) {
    console.log('[spromoji] loadAvatar called with src:', src);
    
    try {
        updateStatus('Loading avatar...');
        
        // Stop any existing animation and reset state
        stopAnimation();
        resetState();
        
        avatarImg = new Image();
        avatarImg.crossOrigin = 'anonymous';
        
        avatarImg.onload = async () => {
            // 1. Resize canvas to image dimensions
            avatarCanvas.width = avatarImg.naturalWidth || avatarImg.width;
            avatarCanvas.height = avatarImg.naturalHeight || avatarImg.height;
            debugCanvas.width = avatarCanvas.width;
            debugCanvas.height = avatarCanvas.height;
            
            console.debug('[avatar] Canvas size:', avatarCanvas.width, 'x', avatarCanvas.height);
            
            // 2. Draw avatar immediately so user sees it
            ctx.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);
            ctx.drawImage(avatarImg, 0, 0, avatarCanvas.width, avatarCanvas.height);
            
            // 3. Try auto-detection first, then fallback to template
            updateStatus('🔍 Detecting facial features...');
            let detectedRegions = null;
            
            try {
                detectedRegions = await window.AutoRegions.detectRegions(avatarImg);
            } catch (error) {
                console.warn('[avatar] Auto-detection failed:', error);
            }
            
            if (detectedRegions) {
                avatarRegions = detectedRegions;
                console.debug(`[avatar] Auto-detection successful:`, detectedRegions.theme);
                updateStatus('✅ Features detected automatically!');
            } else {
                avatarRegions = window.CartoonTemplate(avatarCanvas.width, avatarCanvas.height, 'default');
                console.debug(`[avatar] Using fallback template regions`);
                updateStatus('⚠️ Auto-detection failed - using template regions');
            }
            
            // 4. Initialize animator
            window.RegionAnimator.init(ctx, avatarRegions, avatarImg);
            
            // 5. Show manual mode button
            if (manualModeBtn) {
                manualModeBtn.style.display = 'inline-block';
            }
            
            hideLoading();
            updateStatus('✅ Avatar loaded! Setting up camera...');
            
            // 6. Setup webcam and start animation
            await setupWebcamAndWorker();
        };
        
        avatarImg.onerror = () => {
            console.error('[spromoji] Failed to load image from:', src);
            updateStatus('Failed to load avatar image. Please try uploading a different image.');
            hideLoading();
        };
        
        avatarImg.src = src;
        
    } catch (error) {
        console.error('[spromoji] Failed to load avatar:', error);
        updateStatus('Error loading avatar: ' + error.message);
        hideLoading();
    }
}

/**
 * Handle file upload from input
 */
function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const url = URL.createObjectURL(file);
        updateStatus('Using uploaded image');
        if (manualModeBtn) manualModeBtn.style.display = 'none';
        loadAvatar(url);
    }
}

function startRAFonce() {
    if (loopStarted) return;
    loopStarted = true;
    console.log('[spromoji] Starting animation loop');
    
    function raf() {
        // Always animate the avatar even if face tracking isn't ready
        if (avatarRegions) {
            window.RegionAnimator.animate(ctx);
        }
        
        // Send webcam frames to worker if both are ready
        if (workerReady && cam.readyState === cam.HAVE_ENOUGH_DATA) {
            createImageBitmap(cam).then(bmp => {
                worker.postMessage({
                    type: 'frame', 
                    bitmap: bmp, 
                    ts: performance.now()
                }, [bmp]);
            }).catch(err => {
                // Silently continue if bitmap creation fails
            });
        }
        
        requestAnimationFrame(raf);
    }
    
    raf();
}

/**
 * Setup webcam and worker
 */
async function setupWebcamAndWorker() {
    try {
        updateStatus('🎥 Setting up camera...');
        
        // Initialize webcam
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            } 
        });
        
        if (!cam) cam = document.createElement('video');
        cam.srcObject = stream;
        cam.play();
        
        // Setup worker for face tracking
        if (!worker) {
            worker = new Worker('/static/faceWorker.js');
            worker.onmessage = (e) => {
                if (e.data.type === 'ready') {
                    workerReady = true;
                    console.log('[spromoji] Worker ready');
                } else if (e.data.type === 'landmarks') {
                    // Handle face landmarks from worker
                    const landmarks = e.data.landmarks;
                    if (landmarks && landmarks.length > 0) {
                        // Update animation state based on landmarks
                        updateAnimationFromLandmarks(landmarks);
                    }
                }
            };
        }
        
        updateStatus('✅ Camera ready! Animation starting...');
        startRAFonce();
        
    } catch (error) {
        console.error('[spromoji] Camera setup failed:', error);
        updateStatus('⚠️ Camera access denied. Animation will work without face tracking.');
        startRAFonce(); // Start animation loop anyway
    }
}

/**
 * Update animation state from face landmarks
 */
function updateAnimationFromLandmarks(landmarks) {
    if (!window.RegionAnimator || !landmarks || landmarks.length === 0) return;
    
    // Simple landmark-based animation updates
    try {
        // Calculate basic facial expressions
        const leftEye = landmarks[159];
        const rightEye = landmarks[386];
        const mouth = landmarks[13];
        
        if (leftEye && rightEye && mouth) {
            // Simple blink detection
            const eyeOpenness = Math.abs(leftEye.y - landmarks[145].y);
            window.RegionAnimator.setEyeScaleY(Math.max(0.3, eyeOpenness * 10));
            window.RegionAnimator.setEyeScaleY(Math.max(0.3, eyeOpenness * 10), true);
            
            // Simple mouth opening
            const mouthOpenness = Math.abs(mouth.y - landmarks[14].y);
            window.RegionAnimator.setMouthScale(1 + mouthOpenness * 5);
        }
    } catch (error) {
        console.warn('[spromoji] Landmark processing error:', error);
    }
}

/**
 * Start manual region selection
 */
async function startManualSelection() {
    updateStatus('👆 Click to select facial features manually');
    if (manualModeBtn) manualModeBtn.style.display = 'none';
    
    // Simple manual selection implementation
    // This would normally open a manual selection interface
    console.log('[spromoji] Manual selection would be implemented here');
    updateStatus('Manual selection not yet implemented');
}

/**
 * Main animation loop
 */
function mainLoop() {
    if (!avatarRegions) return;
    
    frameCount++;
    updateFPS();
    
    // Animate avatar
    window.RegionAnimator.animate(ctx);
    
    requestAnimationFrame(mainLoop);
}

/**
 * Update FPS counter
 */
function updateFPS() {
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
        console.debug(`[spromoji] FPS: ${frameCount}`);
        frameCount = 0;
        lastFpsTime = now;
    }
}

/**
 * Stop animation and cleanup
 */
function stopAnimation() {
    isRecording = false;
    animationReady = false;
    loopStarted = false;
    
    if (worker) {
        worker.terminate();
        worker = null;
        workerReady = false;
    }
    
    if (cam && cam.srcObject) {
        cam.srcObject.getTracks().forEach(track => track.stop());
        cam.srcObject = null;
    }
    
    console.log('[spromoji] Animation stopped and cleaned up');
}

/**
 * Reset application state
 */
function resetState() {
    avatarImg = null;
    avatarRegions = null;
    animationReady = false;
    frameCount = 0;
    
    if (initializationTimeout) {
        clearTimeout(initializationTimeout);
        initializationTimeout = null;
    }
    
    // Reset UI
    if (startBtn) {
        startBtn.textContent = '🎬 Start Recording';
        startBtn.disabled = false;
    }
    
    // Hide debug canvas
    if (debugCanvas) {
        debugCanvas.style.display = 'none';
    }
    
    // Reset RegionAnimator if it exists
    if (window.RegionAnimator?.reset) {
        window.RegionAnimator.reset();
    }
    
    // Clear any existing avatar display
    if (ctx && avatarCanvas) {
        ctx.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);
    }
}

/**
 * Start recording
 */
function startRecording() {
    if (isRecording) return;
    
    isRecording = true;
    startBtn.textContent = '🔴 Recording...';
    startBtn.disabled = true;
    
    console.log('[spromoji] Recording started');
    updateStatus('🎬 Recording 5 seconds...');
    
    // Record from the same canvas RegionAnimator draws on
    const rec = new MediaRecorder(avatarCanvas.captureStream(30),{mimeType:'video/webm'});
    const chunks = [];
    
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => {
        const blob = new Blob(chunks, {type:'video/webm'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'spromoji-recording.webm';
        a.click();
        URL.revokeObjectURL(url);
    };
    
    rec.start();
    
    // Simple 5-second recording
    setTimeout(() => {
        rec.stop();
        isRecording = false;
        startBtn.textContent = '🎬 Start Recording';
        startBtn.disabled = false;
        updateStatus('✅ Recording complete!');
        console.log('[spromoji] Recording complete');
    }, 5000);
}

/**
 * Handle file upload
 */
function handleFileUpload(event) {
    console.log('[spromoji] File upload event triggered');
    console.log('[spromoji] Event:', event);
    console.log('[spromoji] Files:', event.target.files);
    
    const file = event.target.files[0];
    if (!file) {
        console.error('[spromoji] No file selected');
        return;
    }
    
    console.log('[spromoji] File selected:', file.name, file.type, file.size);
    
    // Show immediate feedback
    updateStatus('📤 Processing new avatar...');
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
        console.error('[spromoji] Invalid file type:', file.type);
        updateStatus('❌ Please select an image file');
        return;
    }
    
    try {
        const url = URL.createObjectURL(file);
        console.log('[spromoji] Created object URL:', url);
        
        // Clear the file input to allow re-uploading same file
        event.target.value = '';
        
        loadAvatar(url);
    } catch (error) {
        console.error('[spromoji] Error creating object URL:', error);
        updateStatus('❌ Error loading file: ' + error.message);
    }
}

/**
 * Update status text
 */
function updateStatus(message) {
    if (statusText) {
        statusText.textContent = message;
    }
    console.log('[spromoji]', message);
}

/**
 * Hide loading indicator
 */
function hideLoading() {
    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
} 