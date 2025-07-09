// SPROMOJI - Landmark-to-Landmark Facial Morphing (Memoji-lite)
// Phase P0: Avatar landmark detection and caching
// Phase P1: Real-time mouth/eye morphing with Delaunay triangulation

console.log('[morph] SPROMOJI Facial Morphing starting...');

// DOM elements (initialized in initializeApp)
let cam, avatarCanvas, debugCanvas, debugOverlay, ctx, debugCtx, debugOverlayCtx;
let avatarInput, startBtn, loadingIndicator, statusText, manualModeBtn, redoDetectBtn;
let avatarImg = null;
let avatarRegions = null;
let avatarMesh = null;
let liveMesh = null;
let isRecording = false;
let animationEnabled = false;
let currentAvatarURL = null;
let currentAvatarHash = null;
let lastFrameTime = 0;
let frameCount = 0;
let lastLogTime = 0;
let faceWorker = null;
let isUsingWorker = false;

// Smoothing factor for landmark interpolation (0=no smoothing, 1=ignore new data)
const LANDMARK_SMOOTHING = 0.3;

// Enhanced face detection parameters
const FACE_DETECTION_CONFIG = {
    baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU'
    },
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    runningMode: 'VIDEO',
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
};

async function computeAvatarHash(canvas){
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const buf = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// Resize the avatar canvas for rig upload if needed
async function prepareRigBlob(canvas){
    const originalBlob = await new Promise(r=>canvas.toBlob(r, 'image/png'));
    if(originalBlob.size <= 20 * 1024 * 1024){
        return {canvas, blob: originalBlob};
    }
    const max = 512;
    const scale = max / Math.max(canvas.width, canvas.height);
    const tmp = document.createElement('canvas');
    tmp.width = Math.round(canvas.width * scale);
    tmp.height = Math.round(canvas.height * scale);
    tmp.getContext('2d').drawImage(canvas, 0, 0, tmp.width, tmp.height);
    const scaledBlob = await new Promise(r=>tmp.toBlob(r, 'image/png'));
    return {canvas: tmp, blob: scaledBlob};
}

function polysToRegions(polys){
    const map = {eyeL:'leftEye', eyeR:'rightEye', mouth:'mouth'};
    const out = {};
    polys.forEach(f=>{
        const name = map[f.type] || f.type;
        if(!f.poly || !f.poly.length) return;
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        f.poly.forEach(([x,y])=>{
            if(x<minX) minX=x;
            if(x>maxX) maxX=x;
            if(y<minY) minY=y;
            if(y>maxY) maxY=y;
        });
        const w = avatarCanvas.width;
        const h = avatarCanvas.height;
        const cx=(minX+maxX)/2;
        const cy=(minY+maxY)/2;
        out[name] = {
            x: minX * w,
            y: minY * h,
            w: (maxX-minX) * w,
            h: (maxY-minY) * h,
            cx: cx * w,
            cy: cy * h,
            rx: (maxX-minX) * w / 2,
            ry: (maxY-minY) * h / 2
        };
    });
    return out;
}

const tg = window.Telegram?.WebApp;
if (tg && tg.expand) tg.expand();

async function initializeApp() {
    console.log('[spromoji] Initializing...');
    
    avatarCanvas = document.getElementById('avatarCanvas');
    debugCanvas = document.getElementById('debugCanvas');
    debugOverlay = document.getElementById('debugOverlay');
    cam = document.getElementById('cam');
    startBtn = document.getElementById('startBtn');
    avatarInput = document.getElementById('avatarInput');
    loadingIndicator = document.getElementById('loading');
    statusText = document.getElementById('status');
    manualModeBtn = document.getElementById('manualModeBtn');
    redoDetectBtn = document.getElementById('redoDetectBtn');
    
    if (!avatarCanvas || !debugCanvas) {
        console.error('[spromoji] Required canvas elements not found');
        return;
    }
    
    ctx = avatarCanvas.getContext('2d');
    debugCtx = debugCanvas.getContext('2d');
    debugOverlayCtx = debugOverlay?.getContext('2d');
    
    if (avatarInput) {
        avatarInput.addEventListener('change', handleAvatarUpload);
    }
    
    if (manualModeBtn) {
        manualModeBtn.addEventListener('click', startManualSelection);
    }
    if (redoDetectBtn) {
        redoDetectBtn.addEventListener('click', () => { tryAutoDetection(); });
    }
    
    startBtn.addEventListener('click', startRecording);

    const urlParams = new URLSearchParams(window.location.search);
    const avatarParam = urlParams.get('avatar');
    const debugMode = urlParams.get('debug') === '1';

    if (debugMode) {
        debugCanvas.style.display = 'block';
        if (debugOverlay) debugOverlay.style.display = 'block';
    } else {
        debugCanvas.style.display = 'none';
        if (debugOverlay) debugOverlay.style.display = 'none';
    }
    
    if (avatarParam) {
        console.log('[spromoji] Loading avatar from URL:', avatarParam);
        await loadAvatar(avatarParam);
    } else {
        updateStatus('Upload an avatar image to begin');
        if (manualModeBtn) manualModeBtn.style.display = 'none';
        if (redoDetectBtn) redoDetectBtn.style.display = 'none';
        hideLoading();
    }
}

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
        
        console.log('[spromoji] Avatar loaded:', avatarImg.width, 'x', avatarImg.height);
        
        const maxSize = 500;
        const scale = Math.min(maxSize / avatarImg.width, maxSize / avatarImg.height);
        
        avatarCanvas.width = avatarImg.width * scale;
        avatarCanvas.height = avatarImg.height * scale;
        debugCanvas.width = avatarCanvas.width;
        debugCanvas.height = avatarCanvas.height;
        if (debugOverlay) {
            debugOverlay.width = avatarCanvas.width;
            debugOverlay.height = avatarCanvas.height;
        }
        
        ctx.drawImage(avatarImg, 0, 0, avatarCanvas.width, avatarCanvas.height);

        console.log('[spromoji] Canvas dimensions set:', avatarCanvas.width, 'x', avatarCanvas.height);

        currentAvatarHash = await computeAvatarHash(avatarCanvas);
        const cacheKey = 'rigCache_' + currentAvatarHash;
        const cached = localStorage.getItem(cacheKey);

        await initializeMediaPipe();

        if (cached) {
            try {
                const data = JSON.parse(cached);
                if (data.rigUrl) {
                    const ok = await window.RegionAnimator.init(ctx, avatarImg, null, data.rigUrl);
                    if (ok) {
                        animationEnabled = true;
                        playDemo();
                        await initPreview();
                        updateStatus('Avatar loaded - try making expressions!');
                        if (redoDetectBtn) redoDetectBtn.style.display = 'inline-block';
                        return;
                    }
                } else if (data.regions) {
                    const ok = await window.RegionAnimator.init(ctx, avatarImg, data.regions);
                    if (ok) {
                        animationEnabled = true;
                        playDemo();
                        await initPreview();
                        updateStatus('Avatar loaded - try making expressions!');
                        if (redoDetectBtn) redoDetectBtn.style.display = 'inline-block';
                        return;
                    }
                }
            } catch(e){
                console.warn('[spromoji] Failed to load cached rig', e);
            }
        }
        
        // Try to initialize the mesh-based animation system
        let meshSuccess = false;
        if (window.RegionAnimator) {
            meshSuccess = await window.RegionAnimator.init(ctx, avatarImg);
        }
        
        if (meshSuccess) {
            console.log('[spromoji] Using mesh-based animation system');
            animationEnabled = true;
            playDemo();
            if (redoDetectBtn) redoDetectBtn.style.display = 'inline-block';
            await initPreview();
            updateStatus('Avatar loaded - try making expressions!');
        } else {
            console.log('[spromoji] Mesh system failed, falling back to region detection');
            const autoSuccess = await tryAutoDetection();
            
            if (!autoSuccess) {
                updateStatus('Auto-detection failed. Use manual selection.');
                console.log('[spromoji] Auto-detection failed, manual mode available');
                if (manualModeBtn) manualModeBtn.style.display = 'inline-block';
                if (redoDetectBtn) redoDetectBtn.style.display = 'inline-block';
                await initPreview();
            }
        }
        
    } catch (error) {
        console.error('[spromoji] Failed to load avatar:', error);
        updateStatus('Failed to load avatar image');
        hideLoading();
    }
}

function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (file) {
        console.log('[spromoji] New avatar uploaded:', file.name);
        
        if (currentAvatarURL) URL.revokeObjectURL(currentAvatarURL);
        currentAvatarURL = URL.createObjectURL(file);
        
        animationEnabled = false;
        avatarRegions = null;
        avatarImg = null;
        
        if (window.RegionAnimator) {
            window.RegionAnimator.reset();
        }
        
        stopCamera();
        updateStatus('Loading new avatar...');
        
        if (manualModeBtn) manualModeBtn.style.display = 'none';
        
        setTimeout(() => {
            loadAvatar(currentAvatarURL);
        }, 100);
    }
}

async function initializeMediaPipe() {
    if (avatarMesh && liveMesh) {
        console.log('[spromoji] MediaPipe already initialized');
        return;
    }
    
    updateStatus('Initializing face tracking...');
    
    try {
        console.log('[spromoji] Loading MediaPipe...');
        
        // Try to use the web worker first for better performance
        if (window.Worker && !isUsingWorker) {
            try {
                faceWorker = new Worker('/static/faceWorker.js', { type: 'module' });
                
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Worker initialization timeout'));
                    }, 5000);
                    
                    faceWorker.onmessage = (event) => {
                        if (event.data.type === 'ready') {
                            clearTimeout(timeout);
                            isUsingWorker = true;
                            console.log('[spromoji] Face worker initialized successfully');
                            resolve();
                        } else if (event.data.type === 'blend') {
                            // Handle face detection results from worker
                            handleFaceDetectionResult(event.data.blend, event.data.lm);
                        }
                    };
                    
                    faceWorker.onerror = (error) => {
                        clearTimeout(timeout);
                        console.warn('[spromoji] Face worker failed:', error);
                        reject(error);
                    };
                });
                
                if (isUsingWorker) {
                    console.log('[spromoji] Using web worker for face detection');
                    return;
                }
            } catch (error) {
                console.warn('[spromoji] Web worker failed, falling back to main thread:', error);
                isUsingWorker = false;
                if (faceWorker) {
                    faceWorker.terminate();
                    faceWorker = null;
                }
            }
        }
        
        // Fallback to main thread MediaPipe
        const { FaceLandmarker, FilesetResolver } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs');
        
        console.log('[spromoji] MediaPipe loaded, creating instances...');
        
        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
            { forceSIMD: false }
        );
        
        console.log('[spromoji] FilesetResolver created');
        
        // Create avatar mesh for static image analysis
        avatarMesh = await FaceLandmarker.createFromOptions(filesetResolver, {
            ...FACE_DETECTION_CONFIG,
            runningMode: 'IMAGE'
        });
        
        console.log('[spromoji] Avatar mesh created');
        
        // Create live mesh for video analysis
        liveMesh = await FaceLandmarker.createFromOptions(filesetResolver, {
            ...FACE_DETECTION_CONFIG,
            runningMode: 'VIDEO'
        });
        
        console.log('[spromoji] MediaPipe fully initialized');
        console.log('[spromoji] Avatar mesh:', !!avatarMesh, 'Live mesh:', !!liveMesh);
        
    } catch (error) {
        console.error('[spromoji] MediaPipe initialization error:', error);
        updateStatus('Face tracking setup failed - will try manual mode');
    }
}

function handleFaceDetectionResult(blendshapes, landmarks) {
    if (!animationEnabled) return;
    
    const now = performance.now();
    if (now - lastFrameTime >= 16) { // 60 FPS target
        lastFrameTime = now;
        
        if (window.RegionAnimator) {
            const blend = Object.fromEntries(blendshapes.map(c => [c.categoryName, c.score]));
            window.RegionAnimator.update(blend, landmarks);
        }
        
        frameCount++;
        
        if (now - lastLogTime > 1000) {
            console.log('[spromoji] ACTIVE - FPS:', frameCount, 'Landmarks:', landmarks ? landmarks.length : 0);
            frameCount = 0;
            lastLogTime = now;
        }
    }
}

function drawDetectedRegions(regions, color = '#00ff00') {
    if (!regions || !debugCtx) return;
    
    debugCtx.strokeStyle = color;
    debugCtx.lineWidth = 2;
    debugCtx.font = '12px Arial';
    debugCtx.fillStyle = color;
    
    Object.entries(regions).forEach(([name, region]) => {
        if (region && region.x !== undefined && region.y !== undefined && region.w && region.h) {
            // Draw region rectangle
            debugCtx.strokeRect(region.x, region.y, region.w, region.h);
            
            // Draw center point
            if (region.cx !== undefined && region.cy !== undefined) {
                debugCtx.beginPath();
                debugCtx.arc(region.cx, region.cy, 3, 0, 2 * Math.PI);
                debugCtx.fill();
            }
            
            // Label the region
            const labelText = name.replace('Eye', ' Eye').replace('mouth', 'Mouth');
            debugCtx.fillText(labelText, region.x + 5, region.y - 5);
        }
    });
}

function getDefaultRegions(w, h) {
    return {
        leftEye: {
            x: w * 0.25, y: h * 0.35, w: w * 0.15, h: h * 0.12,
            cx: w * 0.325, cy: h * 0.41, rx: w * 0.075, ry: h * 0.06
        },
        rightEye: {
            x: w * 0.6, y: h * 0.35, w: w * 0.15, h: h * 0.12,
            cx: w * 0.675, cy: h * 0.41, rx: w * 0.075, ry: h * 0.06
        },
        mouth: {
            x: w * 0.35, y: h * 0.65, w: w * 0.3, h: h * 0.15,
            cx: w * 0.5, cy: h * 0.725, rx: w * 0.15, ry: h * 0.075
        }
    };
}

async function tryAutoDetection() {
    console.log('[spromoji] Starting enhanced facial feature detection...');
    updateStatus('Detecting facial features...');

    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);

    try {
        avatarRegions = null;
        let detectionMethod = 'none';

        // Enhanced MediaPipe detection on the avatar image
        if (avatarMesh) {
            console.log('[spromoji] Running MediaPipe face detection on avatar...');
            try {
                const mpRes = avatarMesh.detect(avatarCanvas);
                if (mpRes && mpRes.faceLandmarks && mpRes.faceLandmarks.length > 0) {
                    const landmarks = mpRes.faceLandmarks[0];
                    const blendshapes = mpRes.faceBlendshapes[0];
                    
                    console.log('[spromoji] MediaPipe detected', landmarks.length, 'landmarks');
                    console.log('[spromoji] Blendshapes available:', !!blendshapes);
                    
                    avatarRegions = window.AutoRegions.fromLandmarks(landmarks, avatarCanvas.width, avatarCanvas.height);
                    
                    if (avatarRegions) {
                        detectionMethod = 'MediaPipe';
                        console.log('[spromoji] MediaPipe detection successful');
                        
                        // Visualize detected landmarks on debug canvas
                        if (debugCanvas.style.display !== 'none') {
                            debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
                            debugCtx.fillStyle = '#00ff00';
                            landmarks.forEach((point, index) => {
                                const x = point.x * avatarCanvas.width;
                                const y = point.y * avatarCanvas.height;
                                debugCtx.beginPath();
                                debugCtx.arc(x, y, 2, 0, 2 * Math.PI);
                                debugCtx.fill();
                                
                                // Label key landmarks for debugging
                                if ([33, 7, 163, 362, 398, 384, 61, 291, 13, 14].includes(index)) {
                                    debugCtx.fillStyle = '#ff0000';
                                    debugCtx.font = '10px Arial';
                                    debugCtx.fillText(index.toString(), x + 3, y - 3);
                                    debugCtx.fillStyle = '#00ff00';
                                }
                            });
                            
                            // Draw detected regions
                            drawDetectedRegions(avatarRegions, '#00ff00');
                        }
                    }
                }
            } catch (error) {
                console.warn('[spromoji] MediaPipe detection failed:', error);
            }
        }

        // Enhanced fallback to heuristic detection
        if (!avatarRegions) {
            console.log('[spromoji] MediaPipe failed, trying enhanced heuristic detection...');
            updateStatus('Trying advanced image analysis...');
            
            const cartoonRegions = window.AutoRegions.detectCartoonFeatures(avatarCanvas);
            if (cartoonRegions) {
                avatarRegions = cartoonRegions;
                detectionMethod = 'heuristic';
                console.log('[spromoji] Enhanced heuristic detection succeeded');
                
                // Visualize detected regions
                if (debugCanvas.style.display !== 'none') {
                    drawDetectedRegions(avatarRegions, '#ffff00');
                }
            }
        }

        if (avatarRegions) {
            // Validate and enhance detected regions
            if (!window.AutoRegions.validateRegions(avatarRegions, avatarCanvas.width, avatarCanvas.height)) {
                console.warn('[spromoji] Detected regions failed validation, using defaults');
                avatarRegions = getDefaultRegions(avatarCanvas.width, avatarCanvas.height);
                detectionMethod = 'default';
            }
            
            // Enhance detected regions with better bounds
            Object.values(avatarRegions).forEach(r => {
                r.w = Math.max(r.w, 30);
                r.h = Math.max(r.h, 30);
                if (r.radiusX) r.radiusX = r.w / 2;
                if (r.radiusY) r.radiusY = r.h / 2;
                if (r.rx) r.rx = r.w / 2;
                if (r.ry) r.ry = r.h / 2;
            });
            
            console.log(`[spromoji] Detection successful using ${detectionMethod} method`);
            console.table(avatarRegions);

            if (currentAvatarHash) {
                const cacheKey = 'rigCache_' + currentAvatarHash;
                localStorage.setItem(cacheKey, JSON.stringify({regions: avatarRegions, method: detectionMethod}));
            }
            
            if (window.RegionAnimator) {
                await window.RegionAnimator.init(ctx, avatarImg, avatarRegions);
                console.log('[spromoji] RegionAnimator initialized with detected regions');
            } else {
                console.error('[spromoji] RegionAnimator not available!');
                return false;
            }
            
            animationEnabled = true;
            updateStatus(`Face detected (${detectionMethod}) - try making expressions!`);

            playDemo();
            await initPreview();

            if (!cam || !cam.srcObject) {
                startBasicAnimation();
            }
            
            return true;
        }

        // Server-side rig detection as last resort
        if (!avatarRegions) {
            console.log('[spromoji] Local detection failed - requesting server analysis...');
            const {blob} = await prepareRigBlob(avatarCanvas);
            const form = new FormData();
            form.append('file', blob, 'avatar.png');
            
            try {
                const resp = await fetch('/rig', { method:'POST', body: form });
                if (resp.ok) {
                    const data = await resp.json();
                    if (data.rig) {
                        if (currentAvatarHash) {
                            const ck = 'rigCache_' + currentAvatarHash;
                            localStorage.setItem(ck, JSON.stringify({rig: data.rig}));
                        }
                        const regions = polysToRegions(data.rig);
                        await window.RegionAnimator.init(ctx, avatarImg, regions);
                        animationEnabled = true;
                        debugCanvas.style.display = 'none';
                        updateStatus('Face detected via server - try making expressions!');
                        playDemo();
                        if (redoDetectBtn) redoDetectBtn.style.display = 'inline-block';
                        await initPreview();
                        if (!cam || !cam.srcObject) startBasicAnimation();
                        return true;
                    }
                }
            } catch (error) {
                console.error('[spromoji] Server rig detection failed:', error);
            }
        }

        console.warn('[spromoji] All detection methods failed');
        animationEnabled = false;
        updateStatus('Face detection failed - please select features manually');
        if (manualModeBtn) manualModeBtn.style.display = 'inline-block';
        if (redoDetectBtn) redoDetectBtn.style.display = 'inline-block';
        return false;
        
    } catch (error) {
        console.error('[spromoji] Detection error:', error);
        animationEnabled = false;
        updateStatus('Detection error - please select features manually');
        if (manualModeBtn) manualModeBtn.style.display = 'inline-block';
        if (redoDetectBtn) redoDetectBtn.style.display = 'inline-block';
        return false;
    }
}

async function startManualSelection() {
    console.log('[spromoji] Starting manual selection...');
    updateStatus('Click to select features manually...');
    
    if (manualModeBtn) manualModeBtn.style.display = 'none';
    if (redoDetectBtn) redoDetectBtn.style.display = 'none';
    
    try {
        const regions = await showManualPicker();
        avatarRegions = regions;
        
        Object.values(avatarRegions).forEach(r => {
            r.w = Math.max(r.w, 20);
            r.h = Math.max(r.h, 20);
            if (r.radiusX) r.radiusX = r.w / 2;
            if (r.radiusY) r.radiusY = r.h / 2;
            if (r.rx) r.rx = r.w / 2;
            if (r.ry) r.ry = r.h / 2;
        });
        
        console.table(avatarRegions);
        
        if (window.RegionAnimator) {
            window.RegionAnimator.init(ctx, avatarImg, avatarRegions);
            console.log('[spromoji] RegionAnimator initialized with manual regions');
        } else {
            console.error('[spromoji] RegionAnimator not available!');
            throw new Error('RegionAnimator not available');
        }
        
        animationEnabled = true;
        
        updateStatus('Manual selection complete - try blinking & talking!');
        
        await initPreview();
        
        if (!cam || !cam.srcObject) {
            startBasicAnimation();
        }
        
    } catch (error) {
        console.error('[spromoji] Manual selection failed:', error);
        updateStatus('Manual selection failed');
        if (manualModeBtn) manualModeBtn.style.display = 'inline-block';
    }
}

async function showManualPicker() {
    return new Promise((resolve, reject) => {
        const selections = {};
        const steps = ['leftEye', 'rightEye', 'mouth'];
        let currentStep = 0;
        
        const updateInstruction = (step) => {
            const instructions = {
                leftEye: 'Click on the LEFT EYE',
                rightEye: 'Click on the RIGHT EYE', 
                mouth: 'Click on the MOUTH'
            };
            updateStatus(instructions[step] || 'Selection complete');
        };
        
        const cleanup = () => {
            avatarCanvas.removeEventListener('click', handleClick);
            avatarCanvas.style.cursor = 'default';
            document.querySelectorAll('.manual-controls').forEach(el => el.remove());
        };
        
        const handleClick = (event) => {
            const rect = avatarCanvas.getBoundingClientRect();
            const scaleX = avatarCanvas.width / rect.width;
            const scaleY = avatarCanvas.height / rect.height;
            
            const x = (event.clientX - rect.left) * scaleX;
            const y = (event.clientY - rect.top) * scaleY;
            
            const stepName = steps[currentStep];
            const regionSize = stepName === 'mouth' ? 80 : 60;
            
            selections[stepName] = {
                x: Math.max(0, x - regionSize/2),
                y: Math.max(0, y - regionSize/2),
                w: Math.min(regionSize, avatarCanvas.width - x + regionSize/2),
                h: Math.min(regionSize, avatarCanvas.height - y + regionSize/2)
            };
            
            console.log('[spromoji] Selected', stepName, 'at', x, y);
            
            debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
            Object.entries(selections).forEach(([name, region]) => {
                debugCtx.strokeStyle = '#00ff00';
                debugCtx.lineWidth = 3;
                debugCtx.strokeRect(region.x, region.y, region.w, region.h);
                debugCtx.fillStyle = '#00ff00';
                debugCtx.font = '16px Arial';
                debugCtx.fillText(name, region.x + 5, region.y - 5);
            });
            debugCanvas.style.display = 'block';
            
            currentStep++;
            
            if (currentStep < steps.length) {
                updateInstruction(steps[currentStep]);
            } else {
                updateStatus('All features selected!');
                cleanup();
                resolve(selections);
            }
        };
        
        avatarCanvas.style.cursor = 'crosshair';
        avatarCanvas.addEventListener('click', handleClick);
        updateInstruction(steps[currentStep]);
        
        console.log('[spromoji] Manual picker initialized');
    });
}

async function initPreview() {
    try {
        console.log('[spromoji] Setting up camera...');
        updateStatus('Starting camera...');
        
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 }
        });
        
        cam.srcObject = stream;
        if (cam.paused) {
            await cam.play().catch(err =>
                console.warn("[spromoji] video play failed", err)
            );
        }
        cam.addEventListener('loadeddata', () => {
            console.log('[spromoji] Camera ready');
            updateStatus('Camera ready - try making expressions!');
            hideLoading();
            
            if (startBtn) {
                startBtn.style.display = 'inline-block';
            }
            
            startFaceTracking();
        });
        
    } catch (error) {
        console.error('[spromoji] Camera setup failed:', error);
        updateStatus('Camera access denied. Animation works without camera.');
        hideLoading();
        
        if (startBtn) {
            startBtn.style.display = 'inline-block';
        }
    }
}

function startFaceTracking() {
    if ((!liveMesh && !isUsingWorker) || !animationEnabled) {
        console.log('[spromoji] Cannot start tracking - missing:', {liveMesh: !!liveMesh, isUsingWorker, animationEnabled});
        return;
    }

    console.log('[spromoji] Starting enhanced face tracking loop...');

    let gotLandmarks = false;
    let prevLandmarks = null;
    let prevBlend = {};

    // Use worker-based tracking if available
    if (isUsingWorker && faceWorker) {
        console.log('[spromoji] Using worker-based face tracking');
        
        const workerTrackFace = () => {
            if (cam.readyState === cam.HAVE_ENOUGH_DATA) {
                try {
                    // Create ImageBitmap for worker
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = cam.videoWidth;
                    canvas.height = cam.videoHeight;
                    ctx.drawImage(cam, 0, 0);
                    
                    createImageBitmap(canvas).then(bitmap => {
                        faceWorker.postMessage({
                            type: 'frame',
                            bitmap: bitmap,
                            ts: performance.now()
                        }, [bitmap]);
                    });
                } catch (error) {
                    console.error('[spromoji] Worker face tracking error:', error);
                }
            }
            requestAnimationFrame(workerTrackFace);
        };
        
        workerTrackFace();
        return;
    }

    // Fallback to main thread tracking
    const trackFace = async () => {
        if (cam.readyState === cam.HAVE_ENOUGH_DATA) {
            try {
                const results = await liveMesh.detectForVideo(cam, performance.now());

                if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
                    let landmarks = results.faceLandmarks[0];
                    const blend = Object.fromEntries((results.faceBlendshapes[0]?.categories||[]).map(c=>[c.categoryName,c.score]));

                    // Enhanced landmark smoothing with adaptive factor
                    if (prevLandmarks) {
                        const a = LANDMARK_SMOOTHING;
                        const b = 1 - a;
                        landmarks = landmarks.map((pt, idx) => ({
                            x: pt.x * a + prevLandmarks[idx].x * b,
                            y: pt.y * a + prevLandmarks[idx].y * b,
                            z: pt.z * a + prevLandmarks[idx].z * b
                        }));
                    }

                    prevLandmarks = landmarks;
                    prevBlend = blend;

                    gotLandmarks = true;
                    
                    const now = performance.now();
                    if (now - lastFrameTime >= 16) { // Target 60 FPS
                        lastFrameTime = now;
                        
                        window.lastLandmarks = landmarks;

                        if (window.RegionAnimator) {
                            window.RegionAnimator.update(blend, landmarks);
                        }
                        
                        frameCount++;
                        
                        if (now - lastLogTime > 1000) {
                            console.log('[spromoji] ACTIVE - FPS:', frameCount, 'Landmarks:', landmarks.length);
                            frameCount = 0;
                            lastLogTime = now;
                        }
                    }
                } else {
                    // No face detected, use previous blend data
                    if (window.RegionAnimator) {
                        window.RegionAnimator.update(prevBlend, null);
                    }
                }
            } catch (error) {
                console.error('[spromoji] Face tracking error:', error);
            }
        }
        
        requestAnimationFrame(trackFace);
    };
    
    trackFace();

    setTimeout(() => {
        if (!gotLandmarks) {
            console.warn('[spromoji] No landmarks detected after timeout');
            updateStatus('Face tracking failed. Try again or adjust lighting.');
        }
    }, 5000);
}

function startBasicAnimation() {
    console.log('[spromoji] Starting basic animation loop (no camera)');
    
    const animateBasic = () => {
        if (window.RegionAnimator && animationEnabled) {
            window.RegionAnimator.update({}, null);
        }
        requestAnimationFrame(animateBasic);
    };
    
    animateBasic();
}

function playDemo(duration=3000){
    let elapsed=0;
    const step=()=>{
        if(elapsed>duration) return;
        const blink=Math.abs(Math.sin(elapsed/300*Math.PI));
        const jaw=0.2+0.1*Math.sin(elapsed/150*Math.PI);
        if(window.RegionAnimator){
            window.RegionAnimator.update({
                eyeBlinkLeft:blink,
                eyeBlinkRight:blink,
                jawOpen:jaw
            }, null);
        }
        elapsed+=80;
        setTimeout(step,80);
    };
    step();
}

async function startRecording() {
    if (isRecording) return;
    
    console.log('[spromoji] Starting recording...');
    updateStatus('Recording 10 seconds...');
    
    isRecording = true;
    startBtn.textContent = 'Recording...';
    startBtn.disabled = true;
    
    const canvasStream = avatarCanvas.captureStream(30);
    let audioStream = null;
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
        console.warn('[spromoji] Audio capture failed:', err);
    }

    const tracks = [...canvasStream.getVideoTracks()];
    if (audioStream) tracks.push(...audioStream.getAudioTracks());
    const stream = new MediaStream(tracks);

    const mime = MediaRecorder.isTypeSupported('video/mp4;codecs=h264') ?
        'video/mp4;codecs=h264' : 'video/webm;codecs=vp9,opus';
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 300000 });
    
    const chunks = [];
    
    recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            chunks.push(event.data);
        }
    };
    
    recorder.onstop = () => {
        console.log('[spromoji] Recording complete');
        updateStatus('Processing video...');
        
        const blob = new Blob(chunks, { type: mime });
        const url = URL.createObjectURL(blob);

        const dl = document.createElement('a');
        dl.href = url;
        dl.download = `spromoji-${Date.now()}.${mime.includes('mp4')?'mp4':'webm'}`;
        document.body.appendChild(dl);
        dl.click();
        dl.remove();
        URL.revokeObjectURL(url);

        if (audioStream) {
            audioStream.getTracks().forEach(t => t.stop());
        }
        
        isRecording = false;
        startBtn.textContent = 'Start Recording';
        startBtn.disabled = false;
        updateStatus('Recording complete!');
    };
    
    recorder.start();
    
    setTimeout(() => {
        if (recorder.state === 'recording') {
            recorder.stop();
        }
    }, 10000);
}

function updateStatus(message) {
    console.log('[spromoji]', message);
    if (statusText) {
        statusText.textContent = message;
    }
}

function hideLoading() {
    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
    }
}

function stopCamera() {
    if (cam && cam.srcObject) {
        cam.srcObject.getTracks().forEach(t => t.stop());
        cam.srcObject = null;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

// simple FPS telemetry
(function(){
    let t0 = performance.now();
    let frames = 0;
    async function postTelem(fps){
        try {
            await fetch('/telemetry', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({fps})});
        } catch(e){
            console.warn('telemetry error', e);
        }
    }
    function tick(){
        frames++;
        const now = performance.now();
        if (now - t0 > 10000){
            postTelem(frames/10);
            t0 = now;
            frames = 0;
        }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
})();
