// SPROMOJI - Landmark-to-Landmark Facial Morphing (Memoji-lite)
// Phase P0: Avatar landmark detection and caching
// Phase P1: Real-time mouth/eye morphing with Delaunay triangulation

console.log('[morph] SPROMOJI Facial Morphing starting...');

// DOM elements (initialized in initializeApp)
let cam, avatarCanvas, debugCanvas, debugOverlay, ctx, debugCtx, debugOverlayCtx;
let avatarInput, startBtn, loadingIndicator, statusText, manualModeBtn;

// Global state
let avatarImg = null;
let avatarLandmarks = null;    // P0: Cached avatar facial landmarks (for auto-detection)
let avatarRegions = null;      // P1: Feature regions for animation
let avatarMesh = null;  // Dedicated to static avatar analysis
let liveMesh = null;    // Dedicated to webcam streaming
let camera = null;
let isRecording = false;
let previewRunning = false;
let animationEnabled = false;   // P1: Region-based animation flag
let manualLandmarks = false;
let debugMode = false;         // Debug overlay mode
let currentAvatarURL = null;   // object URL for uploaded avatar

// Performance monitoring
let lastFrameTime = 0;
let frameCount = 0;
let lastLogTime = 0;

// Create off-screen canvas for avatar processing
let avatarSrcCanvas = null;
let avatarSrcCtx = null;

// Promise resolvers for avatar detection
let avatarDetectResolve = null;

// Telegram WebApp initialization
const tg = window.Telegram?.WebApp;
if (tg && tg.expand) tg.expand();

/**
 * Initialize the application when DOM is ready
 */
async function initializeApp() {
    console.log('[spromoji] DOM ready, initializing...');
    
    // Check for debug mode
    const debugParams = new URLSearchParams(window.location.search);
    debugMode = debugParams.has('debug');
    console.log('[spromoji] Debug mode:', debugMode);
    
    // Get DOM elements
    avatarCanvas = document.getElementById('avatarCanvas');
    debugCanvas = document.getElementById('debugCanvas');
    debugOverlay = document.getElementById('debugOverlay');
    cam = document.getElementById('cam');
    startBtn = document.getElementById('startBtn');
    avatarInput = document.getElementById('avatarInput');
    loadingIndicator = document.getElementById('loading');
    statusText = document.getElementById('status');
    manualModeBtn = document.getElementById('manualModeBtn');
    
    if (!avatarCanvas || !debugCanvas) {
        console.error('[spromoji] Required canvas elements not found');
        return;
    }
    
    // Initialize contexts
    ctx = avatarCanvas.getContext('2d');
    debugCtx = debugCanvas.getContext('2d');
    
    if (debugOverlay) {
        debugOverlayCtx = debugOverlay.getContext('2d');
        if (debugMode) {
            debugOverlay.style.display = 'block';
            console.log('[spromoji] Debug overlay enabled');
        }
    }
    
    // Create off-screen canvas for avatar processing
    avatarSrcCanvas = document.createElement('canvas');
    avatarSrcCtx = avatarSrcCanvas.getContext('2d');
    
    console.log('[spromoji] Canvas contexts initialized');
    
    // Set up event listeners
    if (avatarInput) {
        avatarInput.addEventListener('change', handleAvatarUpload);
    }
    
    if (manualModeBtn) {
        manualModeBtn.addEventListener('click', () => {
            console.log('[spromoji] Manual mode requested by user');
            startManualSelection();
        });
    }
    
    startBtn.addEventListener('click', startRecording);
    
    // Auto-load avatar from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const avatarParam = urlParams.get('avatar');
    
    if (avatarParam) {
        console.log('[spromoji] Loading avatar from URL:', avatarParam);
        await loadAvatar(avatarParam);
    } else {
        updateStatus('Upload an avatar image to begin');
        if (manualModeBtn) manualModeBtn.style.display = 'none';
        hideLoading();
    }
}

/**
 * Load and process avatar image
 * @param {string} src - Image source URL
 */
async function loadAvatar(src) {
    try {
        console.log('[spromoji] Loading avatar:', src);
        updateStatus('Loading avatar image...');
        
        avatarImg = new Image();
        avatarImg.crossOrigin = 'anonymous';
        
        await new Promise((resolve, reject) => {
            avatarImg.onload = resolve;
            avatarImg.onerror = reject;
            avatarImg.src = src;
        });
        
        console.log('[spromoji] ✅ Avatar loaded:', avatarImg.width, 'x', avatarImg.height);
        
        // Set canvas dimensions
        const maxSize = 500;
        const scale = Math.min(maxSize / avatarImg.width, maxSize / avatarImg.height);
        
        avatarCanvas.width = avatarImg.width * scale;
        avatarCanvas.height = avatarImg.height * scale;
        
        // Sync debug canvas dimensions
        if (debugCanvas) {
            debugCanvas.width = avatarCanvas.width;
            debugCanvas.height = avatarCanvas.height;
        }
        
        if (debugOverlay) {
            debugOverlay.width = avatarCanvas.width;
            debugOverlay.height = avatarCanvas.height;
        }
        
        // Set up source canvas
        avatarSrcCanvas.width = avatarCanvas.width;
        avatarSrcCanvas.height = avatarCanvas.height;
        avatarSrcCtx.drawImage(avatarImg, 0, 0, avatarCanvas.width, avatarCanvas.height);
        
        // Initial draw
        ctx.drawImage(avatarImg, 0, 0, avatarCanvas.width, avatarCanvas.height);
        
        console.log('[spromoji] Canvas dimensions set:', avatarCanvas.width, 'x', avatarCanvas.height);
        
        
        // Initialize MediaPipe and try auto-detection (but make it optional)
        await initializeMediaPipe();
        
        // Try auto-detection first, but don't force it
        const autoSuccess = await tryAutoDetection();
        
        if (!autoSuccess) {
            updateStatus('Auto-detection failed. Use manual selection or try uploading a clearer photo.');
            console.log('[spromoji] Auto-detection failed, manual mode available');
            if (manualModeBtn) manualModeBtn.style.display = 'inline-block';
            await initPreview();
        }
        // If auto-detection succeeded, initPreview() was already called
        
    } catch (error) {
        console.error('[spromoji] Failed to load avatar:', error);
        updateStatus('Failed to load avatar image');
        hideLoading();
    }
}

/**
 * Handle file upload from input
 * @param {Event} event - File input change event
 */
function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (file) {
        if (currentAvatarURL) URL.revokeObjectURL(currentAvatarURL);
        currentAvatarURL = URL.createObjectURL(file);
        animationEnabled = false;
        avatarRegions = null;
        stopCamera();
        updateStatus('Using uploaded image');
        if (manualModeBtn) manualModeBtn.style.display = 'none';
        loadAvatar(currentAvatarURL).then(async () => {
            if (!animationEnabled) {
                await startManualSelection();
            }
        });
    }
}

/**
 * Initialize MediaPipe face mesh instances
 */
async function initializeMediaPipe() {
    if (avatarMesh && liveMesh) {
        console.log('[spromoji] MediaPipe already initialized');
        return;
    }
    updateStatus('🔧 Debug: Initializing MediaPipe...');
    
    try {
        updateStatus('🔧 Debug: Waiting for MediaPipe to load...');
        await waitForMediaPipe();
        
        updateStatus('🔧 Debug: Creating avatar FaceMesh instance...');
        
        // Create separate FaceMesh for avatar analysis
        avatarMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });
        
        avatarMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.5
        });
        
        updateStatus('🔧 Debug: Creating live FaceMesh instance...');
        
        // Create separate FaceMesh for live webcam
        liveMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });
        
        liveMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        
        liveMesh.onResults(onLiveFaceResults);
        
        updateStatus('✅ Debug: MediaPipe instances created successfully');
        
    } catch (error) {
        updateStatus('❌ Debug: MediaPipe initialization failed - ' + error.message);
        throw error;
    }
}

/**
 * Try automatic avatar detection (optional, non-blocking)
 */
async function tryAutoDetection() {
    console.log('[spromoji] Starting avatar facial analysis...');
    updateStatus('Detecting facial landmarks...');

    // Clear debug overlay
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);

    try {
        // First attempt cartoon-style detection using simple image analysis
        const cartoonRegions = window.AutoRegions.detectCartoon(avatarCanvas);
        if (cartoonRegions) {
            console.log('[spromoji] 🎨 Cartoon detection succeeded');
            avatarRegions = cartoonRegions;
            Object.values(avatarRegions).forEach(r => {
                r.w = Math.max(r.w, 20);
                r.h = Math.max(r.h, 20);
            });
            console.table(avatarRegions);
            window.RegionAnimator.init(ctx, avatarRegions, avatarImg);
            animationEnabled = true;
            manualLandmarks = false;
            debugCanvas.style.display = 'none';
            updateStatus('✅ Auto-detected features – try blinking & talking!');
            await initPreview();
            return true;
        }

        // Try MediaPipe-based detection as fallback
        // Try multiple sizes for better detection
        for (const maxSize of [512, 256]) {
            console.log('[spromoji] Attempting detection at max size:', maxSize);
            
            const landmarks = await attemptAvatarDetection(maxSize);
            if (landmarks && landmarks.length > 0) {
                console.log('[spromoji] ✅ Avatar detection successful at', maxSize, 'px');
                
                avatarLandmarks = landmarks;
                drawDebugPoints(landmarks);
                
                // Convert landmarks to regions using AutoRegions helper
                avatarRegions = window.AutoRegions(avatarLandmarks, avatarCanvas.width, avatarCanvas.height);
                Object.values(avatarRegions).forEach(r => {
                    r.w = Math.max(r.w, 20);
                    r.h = Math.max(r.h, 20);
                });
                console.table(avatarRegions);
                window.RegionAnimator.init(ctx, avatarRegions, avatarImg);
                animationEnabled = true;
                manualLandmarks = false;
                
                // Hide debug canvas
                debugCanvas.style.display = 'none';
                
                console.log('[spromoji] ✅ Auto-detected features:', Object.keys(avatarRegions));
                updateStatus('✅ Auto-detected features – try blinking & talking!');
                
                // Start webcam preview for auto-detected features
                await initPreview();
                return true;
            }
            
            console.warn('[spromoji] ❌ Avatar detection failed at', maxSize, 'px');
        }
        
        // All automatic detection failed
        console.warn('[spromoji] ❌ Automatic detection failed');
        animationEnabled = false;
        updateStatus('❌ Auto-detection failed - please select features manually');
        if (manualModeBtn) manualModeBtn.style.display = 'inline-block';
        return false;
        
    } catch (error) {
        console.error('[spromoji] Avatar analysis error:', error);
        animationEnabled = false;
        updateStatus('❌ Detection error - please select features manually');
        if (manualModeBtn) manualModeBtn.style.display = 'inline-block';
        return false;
    }
}

/**
 * Attempt avatar detection at specified max size
 * @param {number} maxSize - Maximum image dimension
 * @returns {Array|null} Detected landmarks or null
 */
async function attemptAvatarDetection(maxSize) {
    // Create scaled canvas
    const scale = Math.min(maxSize / avatarImg.width, maxSize / avatarImg.height, 1);
    const scaledWidth = Math.floor(avatarImg.width * scale);
    const scaledHeight = Math.floor(avatarImg.height * scale);
    
    const scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = scaledWidth;
    scaledCanvas.height = scaledHeight;
    
    const scaledCtx = scaledCanvas.getContext('2d');
    scaledCtx.drawImage(avatarImg, 0, 0, scaledWidth, scaledHeight);
    
    console.debug('[spromoji] Scaled image:', scaledWidth, 'x', scaledHeight);
    
    try {
        // Send to MediaPipe with timeout
        const results = await Promise.race([
            new Promise((resolve) => {
                avatarDetectResolve = resolve;
                avatarMesh.onResults = (results) => {
                    avatarDetectResolve(results);
                };
                avatarMesh.send({ image: scaledCanvas });
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Detection timeout')), 8000)
            )
        ]);
        
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            
            // Scale landmarks back to avatar canvas coordinates
            const scaleFactor = Math.min(avatarCanvas.width / scaledWidth, avatarCanvas.height / scaledHeight);
            const offsetX = (avatarCanvas.width - scaledWidth * scaleFactor) / 2;
            const offsetY = (avatarCanvas.height - scaledHeight * scaleFactor) / 2;
            
            return landmarks.map(landmark => ({
                x: landmark.x * scaledWidth * scaleFactor + offsetX,
                y: landmark.y * scaledHeight * scaleFactor + offsetY,
                z: landmark.z || 0
            }));
        }
        
        return null;
        
    } catch (error) {
        console.warn('[spromoji] Detection attempt failed:', error.message);
        return null;
    }
}

/**
 * Start manual landmark selection process
 */
async function startManualSelection() {
    if (!avatarImg) {
        console.error('[spromoji] No avatar loaded for manual selection');
        return;
    }
    
    console.log('[spromoji] Starting manual region selection');
    updateStatus('🎯 Manual region selection mode activated');
    
    // Clear any existing data
    avatarLandmarks = null;
    avatarRegions = null;
    animationEnabled = false;
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
    
    try {
        // Use new region selection system
        const regions = await window.ManualRegions.selectFeatureRegions(avatarCanvas, debugCanvas, avatarImg);
        
        console.log('[spromoji] ✅ Manual regions selected:', regions);
        
        // Store regions for animation
        avatarRegions = regions;
        Object.values(avatarRegions).forEach(r => {
            r.w = Math.max(r.w, 20);
            r.h = Math.max(r.h, 20);
        });
        console.table(avatarRegions);

        // Initialize RegionAnimator with the selected regions
        window.RegionAnimator.init(ctx, avatarRegions, avatarImg);
        animationEnabled = true;
        manualLandmarks = true;
        
        // Draw region outlines for confirmation
        drawRegionDebugOutlines(regions);
        
        updateStatus('✅ Manual regions mapped - ready to animate!');
        
        // Start webcam preview immediately after successful selection
        await initPreview();
        
        return true;
        
    } catch (error) {
        console.error('[spromoji] Manual selection failed:', error);
        updateStatus('❌ Manual selection cancelled or failed');
        return false;
    }
}

/**
 * Draw debug landmarks overlay
 * @param {Array} landmarks - Facial landmarks to visualize
 */
function drawDebugPoints(landmarks) {
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
    debugCtx.fillStyle = '#00ff00';
    debugCtx.strokeStyle = '#00ff00';
    debugCtx.lineWidth = 1;
    
    landmarks.forEach((landmark, index) => {
        const x = landmark.x;
        const y = landmark.y;
        
        // Draw small green circle
        debugCtx.beginPath();
        debugCtx.arc(x, y, 1.5, 0, 2 * Math.PI);
        debugCtx.fill();
        
        // Highlight key landmarks
        if ([1, 33, 263, 13, 14].includes(index)) { // nose, eyes, mouth
            debugCtx.beginPath();
            debugCtx.arc(x, y, 3, 0, 2 * Math.PI);
            debugCtx.stroke();
        }
    });
    
    console.debug('[spromoji] ✅ Debug overlay drawn:', landmarks.length, 'points');
}

/**
 * Draw region outlines for debugging
 * @param {Object} regions - Feature regions to visualize
 */
function drawRegionDebugOutlines(regions) {
    if (!regions) return;
    
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
    
    const colors = {
        leftEye: '#ff4444',
        rightEye: '#44ff44', 
        mouth: '#4444ff'
    };
    
    for (const [regionName, region] of Object.entries(regions)) {
        if (region && colors[regionName]) {
            debugCtx.strokeStyle = colors[regionName];
            debugCtx.lineWidth = 2;
            debugCtx.strokeRect(region.x, region.y, region.w, region.h);
            
            // Add label
            debugCtx.fillStyle = colors[regionName];
            debugCtx.font = '12px Arial';
            debugCtx.fillText(regionName, region.x + 5, region.y + 15);
        }
    }
    
    console.debug('[spromoji] ✅ Region debug overlay drawn');
}

/**
 * Show enhanced manual 3-point picker interface
 * @returns {Promise<Array>} Array of 3 picked points or null if cancelled
 */
async function showManualPicker() {
    return new Promise((resolve) => {
        const points = [];
        let clickHandler, cancelHandler, resetHandler;
        let instructionEl, controlsEl;
        
        // Create instruction overlay
        instructionEl = document.createElement('div');
        instructionEl.className = 'manual-instruction';
        instructionEl.textContent = '👆 Tap the LEFT EYE (1/3)';
        document.getElementById('stage').appendChild(instructionEl);
        
        // Create control buttons
        controlsEl = document.createElement('div');
        controlsEl.className = 'manual-controls';
        controlsEl.innerHTML = `
            <button class="reset-btn">🔄 Reset</button>
            <button class="cancel-btn">✕ Cancel</button>
        `;
        document.getElementById('stage').appendChild(controlsEl);
        
        const resetBtn = controlsEl.querySelector('.reset-btn');
        const cancelBtn = controlsEl.querySelector('.cancel-btn');
        
        // Update instruction text
        const updateInstruction = (step) => {
            const instructions = [
                '👆 Tap the LEFT EYE (1/3)',
                '👆 Tap the RIGHT EYE (2/3)', 
                '👆 Tap the MOUTH CENTER (3/3)',
                '✅ Perfect! Processing...'
            ];
            instructionEl.textContent = instructions[step] || instructions[0];
        };
        
        // Reset function
        const resetSelection = () => {
            points.length = 0;
            debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
            updateInstruction(0);
            console.log('[spromoji] Manual selection reset');
        };
        
        // Cleanup function
        const cleanup = () => {
            avatarCanvas.removeEventListener('click', clickHandler);
            resetBtn.removeEventListener('click', resetHandler);
            cancelBtn.removeEventListener('click', cancelHandler);
            avatarCanvas.style.cursor = 'default';
            instructionEl.remove();
            controlsEl.remove();
        };
        
        // Click handler for point selection
        clickHandler = (event) => {
            const rect = avatarCanvas.getBoundingClientRect();
            const x = (event.clientX - rect.left) * (avatarCanvas.width / rect.width);
            const y = (event.clientY - rect.top) * (avatarCanvas.height / rect.height);
            
            points.push({ x, y });
            
            // Draw point with different colors for each step
            const colors = ['#ff4444', '#44ff44', '#4444ff'];
            debugCtx.fillStyle = colors[points.length - 1] || '#ff4444';
            debugCtx.beginPath();
            debugCtx.arc(x, y, 6, 0, 2 * Math.PI);
            debugCtx.fill();
            
            // Add white border for visibility
            debugCtx.strokeStyle = 'white';
            debugCtx.lineWidth = 2;
            debugCtx.stroke();
            
            // Add point number
            debugCtx.fillStyle = 'white';
            debugCtx.font = 'bold 12px Arial';
            debugCtx.textAlign = 'center';
            debugCtx.fillText(points.length.toString(), x, y + 4);
            
            console.log('[spromoji] Manual point', points.length, ':', { x, y });
            
            if (points.length < 3) {
                updateInstruction(points.length);
            } else {
                updateInstruction(3);
                cleanup();
                setTimeout(() => resolve(points), 500); // Small delay to show success message
            }
        };
        
        // Button event handlers
        resetHandler = () => resetSelection();
        cancelHandler = () => {
            cleanup();
            updateStatus('Manual selection cancelled');
            resolve(null);
        };
        
        // Set up event listeners
        avatarCanvas.addEventListener('click', clickHandler);
        resetBtn.addEventListener('click', resetHandler);
        cancelBtn.addEventListener('click', cancelHandler);
        avatarCanvas.style.cursor = 'crosshair';
        
        updateStatus('Manual selection active - click on the face features');
        
        // Auto-timeout after 60 seconds
        setTimeout(() => {
            if (points.length < 3) {
                cleanup();
                updateStatus('Manual selection timed out');
                resolve(null);
            }
        }, 60000);
    });
}

/**
 * Draw alignment debug visualization
 * @param {Array} userTaps - User tap points
 * @param {Array} alignedLandmarks - Aligned template landmarks
 */
function drawAlignmentDebug(userTaps, alignedLandmarks) {
    // Clear debug canvas
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
    
    // Draw user tap points (red)
    debugCtx.fillStyle = '#ff4444';
    userTaps.forEach((tap, index) => {
        debugCtx.beginPath();
        debugCtx.arc(tap.x, tap.y, 8, 0, 2 * Math.PI);
        debugCtx.fill();
        
        // Add labels
        debugCtx.fillStyle = 'white';
        debugCtx.font = 'bold 12px Arial';
        debugCtx.textAlign = 'center';
        debugCtx.fillText(['L', 'R', 'M'][index], tap.x, tap.y + 4);
        debugCtx.fillStyle = '#ff4444';
    });
    
    // Draw key aligned landmarks (blue)
    debugCtx.fillStyle = '#4444ff';
    const keyIndices = [33, 263, 65]; // left eye, right eye, mouth center
    keyIndices.forEach((idx, index) => {
        if (alignedLandmarks[idx]) {
            const landmark = alignedLandmarks[idx];
            debugCtx.beginPath();
            debugCtx.arc(landmark.x, landmark.y, 6, 0, 2 * Math.PI);
            debugCtx.fill();
        }
    });
    
    console.log('[spromoji] ✅ Alignment debug visualization drawn');
}

/**
 * Draw debug overlay showing template vs live landmarks
 * @param {Array} liveLandmarks - Live user landmarks
 */
function drawDebugOverlay(liveLandmarks) {
    if (!debugOverlayCtx || !debugMode) return;
    
    debugOverlayCtx.clearRect(0, 0, debugOverlay.width, debugOverlay.height);
    
    if (alignmentData) {
        // Draw template landmarks (blue)
        const templateLandmarks = window.ManualAlignment.landmarksToPoints(alignmentData.landmarks);
        debugOverlayCtx.fillStyle = '#4444ff';
        templateLandmarks.forEach(landmark => {
            debugOverlayCtx.beginPath();
            debugOverlayCtx.arc(landmark.x, landmark.y, 1, 0, 2 * Math.PI);
            debugOverlayCtx.fill();
        });
    }
    
    // Draw live landmarks (red)
    debugOverlayCtx.fillStyle = '#ff4444';
    liveLandmarks.forEach(landmark => {
        debugOverlayCtx.beginPath();
        debugOverlayCtx.arc(landmark.x, landmark.y, 1.5, 0, 2 * Math.PI);
        debugOverlayCtx.fill();
    });
    
    // Draw feature triangle outlines (lime)
    if (alignmentData && alignmentData.featureTriangles) {
        debugOverlayCtx.strokeStyle = '#00ff00';
        debugOverlayCtx.lineWidth = 1;
        
        for (const triIndex of alignmentData.featureTriangles) {
            const i = triIndex * 3;
            const triangles = alignmentData.triangulation;
            
            if (i < triangles.length - 2) {
                const idx0 = triangles[i];
                const idx1 = triangles[i + 1];
                const idx2 = triangles[i + 2];
                
                if (liveLandmarks[idx0] && liveLandmarks[idx1] && liveLandmarks[idx2]) {
                    debugOverlayCtx.beginPath();
                    debugOverlayCtx.moveTo(liveLandmarks[idx0].x, liveLandmarks[idx0].y);
                    debugOverlayCtx.lineTo(liveLandmarks[idx1].x, liveLandmarks[idx1].y);
                    debugOverlayCtx.lineTo(liveLandmarks[idx2].x, liveLandmarks[idx2].y);
                    debugOverlayCtx.closePath();
                    debugOverlayCtx.stroke();
                }
            }
        }
    }
}

/**
 * Initialize webcam preview
 */
async function initPreview() {
    if (previewRunning) {
        updateStatus('Preview already running');
        return;
    }
    
    updateStatus('🔧 Debug: Starting webcam...');
    
    // Validate prerequisites with visible feedback
    if (!avatarImg) {
        updateStatus('❌ Debug: No avatar image loaded');
        return;
    }
    
    if (!liveMesh) {
        updateStatus('❌ Debug: Face detection not ready - initializing MediaPipe...');
        // Try to initialize MediaPipe if not ready
        try {
            await initializeMediaPipe();
            if (!liveMesh) {
                updateStatus('❌ Debug: MediaPipe initialization failed');
                return;
            }
            updateStatus('✅ Debug: MediaPipe initialized');
        } catch (error) {
            updateStatus('❌ Debug: MediaPipe error - ' + error.message);
            return;
        }
    }
    
    previewRunning = true;
    
    try {
        updateStatus('🔧 Debug: Requesting camera access...');
        
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            }
        });
        
        updateStatus('✅ Debug: Camera stream obtained');
        cam.srcObject = stream;
        
        updateStatus('🔧 Debug: Setting up MediaPipe camera...');
        
        // Check if Camera class is available
        if (!window.Camera) {
            updateStatus('❌ Debug: MediaPipe Camera class not available');
            return;
        }
        
        // Initialize camera processing
        camera = new Camera(cam, {
            onFrame: async () => {
                if (liveMesh) {
                    await liveMesh.send({ image: cam });
                }
            },
            width: 640,
            height: 480
        });
        
        updateStatus('🔧 Debug: Starting camera processing...');
        await camera.start();
        
        updateStatus('✅ Debug: Camera started successfully');
        
        // Give camera a moment to initialize
        setTimeout(() => {
            const statusMsg = manualLandmarks 
                ? '✅ Manual landmarks - template morphing active!'
                : morphingEnabled 
                    ? '✅ Full facial morphing active!'
                    : '✅ Ready! Camera active - try manual selection';
                    
            updateStatus(statusMsg);
            
            // Visual debug info in status
            setTimeout(() => {
                updateStatus(`Debug: Morph=${morphingEnabled}, Manual=${manualLandmarks}, Landmarks=${!!avatarLandmarks}`);
            }, 2000);
            
        }, 1000);
        
        hideLoading();
        
    } catch (error) {
        updateStatus('❌ Debug: Camera failed - ' + error.name + ': ' + error.message);
        hideLoading();
        previewRunning = false;
    }
}

/**
 * Handle live face detection results
 * @param {Object} results - MediaPipe face mesh results
 */
function onLiveFaceResults(results) {
    if (!avatarImg || !results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        return;
    }
    
    // Performance throttling
    const now = performance.now();
    if (now - lastFrameTime < 33) return; // ~30 FPS
    lastFrameTime = now;
    if (now - lastLogTime > 1000) {
        console.log({animationEnabled, hasRegions: !!avatarRegions});
        lastLogTime = now;
    }
    
    const userLandmarks = results.multiFaceLandmarks[0];
    
    // Scale user landmarks to canvas coordinates
    const scaledUserLandmarks = userLandmarks.map(landmark => ({
        x: landmark.x * avatarCanvas.width,
        y: landmark.y * avatarCanvas.height,
        z: landmark.z || 0
    }));
    
    // Use region-based animation if available
    if (animationEnabled && avatarRegions) {
        // Clear debug canvas during animation
        debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
        
        // Use the new RegionAnimator system
        window.RegionAnimator.animate(ctx, scaledUserLandmarks);
        
        // Status update occasionally
        if (frameCount % 180 === 0) {
            updateStatus('🎭 Region-based animation active');
        }
    } else {
        // Show static avatar if no animation available
        ctx.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);
        ctx.drawImage(avatarImg, 0, 0, avatarCanvas.width, avatarCanvas.height);
        
        // Debug why animation isn't working
        if (frameCount % 90 === 0) {
            updateStatus(`❌ Debug: Animation disabled - Enabled:${animationEnabled}, Regions:${!!avatarRegions}`);
        }
    }
    
    // Update debug overlay
    if (debugMode && debugOverlayCtx) {
        drawDebugOverlay(scaledUserLandmarks);
    }
    
    // Performance logging
    frameCount++;
    if (frameCount % 90 === 0) {
        const fps = 1000 / (now - lastFrameTime);
        console.debug(`[spromoji] Live FPS: ${fps.toFixed(1)}`);
    }
}

// Old morphing functions removed - now using RegionAnimator.animateFeatureRegions()

/**
 * Compute eye gaze direction from landmarks
 * @param {Array} landmarks - Facial landmarks
 * @returns {Object} Eye direction {x, y}
 */
function computeEyeDirection(landmarks) {
    if (!landmarks || landmarks.length < 468) return { x: 0, y: 0 };
    
    // Get eye center points
    const leftEyeCenter = landmarks[159]; // Left eye center
    const rightEyeCenter = landmarks[386]; // Right eye center
    const noseTip = landmarks[1]; // Nose tip for reference
    
    if (!leftEyeCenter || !rightEyeCenter || !noseTip) return { x: 0, y: 0 };
    
    // Calculate relative eye position to face center
    const eyeCenterX = (leftEyeCenter.x + rightEyeCenter.x) / 2;
    const eyeCenterY = (leftEyeCenter.y + rightEyeCenter.y) / 2;
    
    // Use nose as reference point
    const deltaX = (eyeCenterX - noseTip.x) * 0.5; // Scale down movement
    const deltaY = (eyeCenterY - noseTip.y) * 0.5;
    
    return { x: deltaX, y: deltaY };
}

/**
 * Compute blink state from landmarks
 * @param {Array} landmarks - Facial landmarks
 * @returns {Object} Blink state {left, right}
 */
function computeBlinkState(landmarks) {
    if (!landmarks || landmarks.length < 468) return { left: 1, right: 1 };
    
    // Left eye landmarks (top and bottom)
    const leftEyeTop = landmarks[159];
    const leftEyeBottom = landmarks[145];
    
    // Right eye landmarks
    const rightEyeTop = landmarks[386];
    const rightEyeBottom = landmarks[374];
    
    if (!leftEyeTop || !leftEyeBottom || !rightEyeTop || !rightEyeBottom) {
        return { left: 1, right: 1 };
    }
    
    // Calculate eye openness
    const leftOpenness = Math.abs(leftEyeTop.y - leftEyeBottom.y);
    const rightOpenness = Math.abs(rightEyeTop.y - rightEyeBottom.y);
    
    // Normalize to 0-1 range (0 = closed, 1 = open)
    const normalizedLeft = Math.min(1, Math.max(0, leftOpenness * 100)); // Amplify small differences
    const normalizedRight = Math.min(1, Math.max(0, rightOpenness * 100));
    
    return {
        left: normalizedLeft > 0.3 ? 1 : 0, // Binary blink detection
        right: normalizedRight > 0.3 ? 1 : 0
    };
}

/**
 * Draw enhanced facial features overlay
 * @param {Object} eyeDirection - Eye gaze direction
 * @param {Object} blinkState - Blink state
 * @param {boolean} mouthOpen - Mouth openness
 */
function drawEnhancedFeatures(eyeDirection, blinkState, mouthOpen) {
    // Get manual points positions (from global scope)
    const leftEyePos = window.manualPoints[0];   // Left eye tap
    const rightEyePos = window.manualPoints[1];  // Right eye tap  
    const mouthPos = window.manualPoints[2];     // Mouth tap
    
    ctx.save();
    
    // Draw animated eyes with gaze tracking
    drawAnimatedEye(leftEyePos, eyeDirection, blinkState.left, 'left');
    drawAnimatedEye(rightEyePos, eyeDirection, blinkState.right, 'right');
    
    // Draw animated mouth
    drawAnimatedMouth(mouthPos, mouthOpen);
    
    ctx.restore();
}

/**
 * Draw animated eye overlay with gaze tracking
 * @param {Object} eyePos - Eye position from manual selection
 * @param {Object} direction - Gaze direction
 * @param {number} openness - Eye openness (0-1)
 * @param {string} side - 'left' or 'right'
 */
function drawAnimatedEye(eyePos, direction, openness, side) {
    const eyeSize = 12;
    const pupilSize = 6;
    
    ctx.save();
    
    // Eye background (white)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.ellipse(eyePos.x, eyePos.y, eyeSize, eyeSize * openness, 0, 0, 2 * Math.PI);
    ctx.fill();
    
    // Eye border
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    if (openness > 0.5) { // Only draw pupil if eye is open
        // Pupil following gaze (amplify movement)
        const pupilX = eyePos.x + direction.x * 3;
        const pupilY = eyePos.y + direction.y * 3;
        
        // Iris (colored part)
        ctx.fillStyle = 'rgba(100, 150, 200, 0.8)'; // Blue iris
        ctx.beginPath();
        ctx.ellipse(pupilX, pupilY, pupilSize + 2, (pupilSize + 2) * openness, 0, 0, 2 * Math.PI);
        ctx.fill();
        
        // Pupil (black center)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.beginPath();
        ctx.ellipse(pupilX, pupilY, pupilSize, pupilSize * openness, 0, 0, 2 * Math.PI);
        ctx.fill();
        
        // Add light reflection
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.ellipse(pupilX + 2, pupilY - 2, 2, 2 * openness, 0, 0, 2 * Math.PI);
        ctx.fill();
    }
    
    ctx.restore();
}

/**
 * Draw animated mouth overlay
 * @param {Object} mouthPos - Mouth position from manual selection
 * @param {boolean} mouthOpen - Mouth openness
 */
function drawAnimatedMouth(mouthPos, mouthOpen) {
    const mouthWidth = 25;
    const mouthHeight = mouthOpen ? 15 : 8; // Bigger opening when talking
    
    ctx.save();
    
    // Mouth shape (red/pink)
    ctx.fillStyle = mouthOpen ? 'rgba(180, 50, 50, 0.8)' : 'rgba(200, 100, 100, 0.7)';
    ctx.beginPath();
    ctx.ellipse(mouthPos.x, mouthPos.y, mouthWidth, mouthHeight, 0, 0, 2 * Math.PI);
    ctx.fill();
    
    // Mouth border
    ctx.strokeStyle = 'rgba(150, 50, 50, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Add teeth when mouth is open
    if (mouthOpen) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.ellipse(mouthPos.x, mouthPos.y - mouthHeight * 0.3, mouthWidth * 0.8, mouthHeight * 0.4, 0, 0, 2 * Math.PI);
        ctx.fill();
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
    if (!landmarks || landmarks.length < 468) return false;
    
    // Use more reliable mouth landmarks
    const upperLip = landmarks[13];   // Upper lip center
    const lowerLip = landmarks[14];   // Lower lip center
    const leftCorner = landmarks[61]; // Left mouth corner
    const rightCorner = landmarks[291]; // Right mouth corner
    
    if (!upperLip || !lowerLip || !leftCorner || !rightCorner) return false;
    
    // Calculate mouth opening height
    const mouthHeight = Math.abs(lowerLip.y - upperLip.y);
    
    // Calculate mouth width for proportion
    const mouthWidth = Math.abs(rightCorner.x - leftCorner.x);
    
    // Mouth is open if height is significant relative to width
    const openRatio = mouthHeight / mouthWidth;
    
    return openRatio > 0.05; // More sensitive threshold
}

/**
 * Start recording the animated canvas
 */
function startRecording() {
    if (isRecording || !avatarImg) {
        console.log('[spromoji] Already recording or no avatar loaded');
        return;
    }
    
    console.log('[spromoji] Starting recording...');
    console.log('[spromoji] Recording state check:', {
        animationEnabled,
        manualLandmarks,
        hasAvatarRegions: !!avatarRegions
    });
    
    isRecording = true;
    startBtn.disabled = true;
    startBtn.textContent = '🎬 Recording... (5s)';
    
    const recordingStatus = animationEnabled 
        ? `Recording ${manualLandmarks ? 'manual' : 'auto-detected'} regions animation...`
        : 'Recording static avatar...';
    updateStatus(recordingStatus);
    
    // Create MediaRecorder from canvas stream
    const stream = avatarCanvas.captureStream(30);
    const recorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 300000
    });
    
    const chunks = [];
    
    recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            chunks.push(event.data);
        }
    };
    
    recorder.onstop = () => {
        console.log('[spromoji] Recording stopped');
        console.log('[spromoji] Recorded chunks:', chunks.length);
        const blob = new Blob(chunks, { type: 'video/webm' });
        console.log('[spromoji] Final blob size:', blob.size, 'bytes');
        
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

        const shareLink = document.createElement('a');
        shareLink.href = `tg://share?url=${encodeURIComponent(url)}`;
        shareLink.textContent = '📤 Share to Telegram';
        shareLink.className = 'download-link';
        shareLink.style.cssText = downloadLink.style.cssText;
        startBtn.parentNode.appendChild(shareLink);
        
        // Reset recording state
        isRecording = false;
        startBtn.disabled = false;
        startBtn.textContent = '🎬 Start Recording';
        updateStatus(`Recording complete! ${animationEnabled ? 'Region-based' : 'Static'} animation saved.`);
        
        console.log('[spromoji] Download link created, blob size:', blob.size, 'bytes');
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
 * Stop webcam and MediaPipe processing
 */
function stopCamera() {
    if (camera) {
        if (camera.video && camera.video.srcObject) {
            camera.video.srcObject.getTracks().forEach(t => t.stop());
        }
        if (camera.stop) camera.stop();
        camera = null;
    }
    if (cam && cam.srcObject) {
        cam.srcObject.getTracks().forEach(t => t.stop());
        cam.srcObject = null;
    }
    previewRunning = false;
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

// Initialize the application when DOM is ready
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