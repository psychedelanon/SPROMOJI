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
        avatarInput.addEventListener('change', handleFileUpload);
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
        hideLoading();
    }
}

// Removed unused auto-detection stub

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

// This function is now replaced by setupWebcamAndWorker()

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
 * Setup webcam and face detection worker
 */
async function setupWebcamAndWorker() {
    try {
        updateStatus('Starting camera...');
        
        // Get webcam stream
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: 640, height: 480 }
        });
        cam.srcObject = stream;
        await cam.play();
        console.log('[spromoji] Camera started successfully');
        
        // Initialize face detection worker
        if (worker) {
            worker.terminate();
        }
        
        worker = new Worker('/static/faceWorker.js', { type: 'module' });
        worker.onmessage = ({ data }) => {
            if (data.type === 'ready') {
                console.log('[spromoji] Worker ready');
                workerReady = true;
                if (!loopStarted) {
                    startRAFonce();
                }
            }
            if (data.type === 'blend') {
                // Update animation based on face landmarks
                window.AIDriver.driveFromBlend(data.blend, data.lm);
                if (!animationReady) {
                    animationReady = true;
                    console.log('[spromoji] Animation flowing');
                    updateStatus('🎭 Animation active! Blink and talk to see your avatar move');
                }
            }
        };
        
        worker.onerror = (error) => {
            console.error('[spromoji] Worker error:', error);
            updateStatus('Face detection failed - you can still use manual selection');
        };
        
        updateStatus('🎯 Face tracking ready! Look at the camera...');
        
    } catch (error) {
        console.error('[spromoji] Camera/worker setup failed:', error);
        updateStatus('Camera access failed. Please allow camera access or use manual selection.');
    }
}

/**
 * Start manual region selection
 */
async function startManualSelection() {
    if (!avatarImg) {
        updateStatus('Please load an avatar first');
        return;
    }
    
    console.log('[spromoji] Starting manual selection');
    updateStatus('🎯 Draw boxes around the left eye, right eye, and mouth');
    
    try {
        // Use existing manual selection system
        const selectedRegions = await window.ManualRegions.selectFeatureRegions(
            avatarCanvas, debugCanvas, avatarImg
        );
        
        if (selectedRegions) {
            avatarRegions = selectedRegions;
            window.RegionAnimator.init(ctx, avatarRegions, avatarImg);
            
            updateStatus('✅ Manual regions set! Animation ready - look at the camera');
            
            // Ensure animation starts
            if (!loopStarted) {
                startRAFonce();
            }
        } else {
            updateStatus('Manual selection cancelled');
        }
        
    } catch (error) {
        console.error('[spromoji] Manual selection failed:', error);
        updateStatus('Manual selection failed - please try again');
    }
}

/**
 * Main animation loop - robust and continuous
 */
function mainLoop() {
    if (!(workerReady && animationReady && avatarRegions)) {
        requestAnimationFrame(mainLoop);
        return;
    }
    
    (async () => {
        try {
            // Send frame to worker for processing
            const bitmap = await createImageBitmap(cam);
            worker.postMessage({
                type: 'frame',
                bitmap,
                ts: performance.now()
            }, [bitmap]);
            
            // Animate (RegionAnimator handles clearing)
            window.RegionAnimator.animate(ctx);
            
        } catch (error) {
            console.error('[spromoji] Animation loop error:', error);
        }
        
        requestAnimationFrame(mainLoop);
    })();
}

// RAF loop integrated into startRAFonce above

/**
 * Update FPS counter
 */
function updateFPS() {
    frameCount++;
    const now = performance.now();
    
    if (now - lastFpsTime >= 1000) {
        console.log('[spromoji] FPS:', frameCount);
        frameCount = 0;
        lastFpsTime = now;
    }
}

/**
 * Stop animation loop and cleanup
 */
function stopAnimation() {
    console.log('[spromoji] Stopping animation...');
    animationReady = false;
    
    // Terminate existing worker
    if (worker) {
        worker.terminate();
        worker = null;
        console.log('[spromoji] Worker terminated');
    }
    
    // Stop webcam stream to force fresh restart
    if (cam && cam.srcObject) {
        const tracks = cam.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        cam.srcObject = null;
        console.log('[spromoji] Webcam stream stopped');
    }
}

/**
 * Reset all application state
 */
function resetState() {
    console.log('[spromoji] Resetting state...');
    
    // Reset global state
    avatarRegions = null;
    isRecording = false;
    frameCount = 0;
    lastFpsTime = 0;
    workerReady = false;
    loopStarted = false;
    
    // Clear initialization timeout
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

// Theme selector removed - using fixed blue/yellow/red color scheme

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