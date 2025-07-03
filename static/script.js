// SPROMOJI - Landmark-to-Landmark Facial Morphing (Memoji-lite)
// Phase P0: Avatar landmark detection and caching
// Phase P1: Real-time mouth/eye morphing with Delaunay triangulation

console.log('[morph] SPROMOJI Facial Morphing starting...');

// DOM elements (initialized in initializeApp)
let cam, avatarCanvas, debugCanvas, debugOverlay, ctx, debugCtx, debugOverlayCtx;
let avatarInput, startBtn, loadingIndicator, statusText, manualModeBtn;
let avatarImg = null;
let avatarRegions = null;
let avatarMesh = null;
let liveMesh = null;
let isRecording = false;
let animationEnabled = false;
let currentAvatarURL = null;
let lastFrameTime = 0;
let frameCount = 0;
let lastLogTime = 0;

// Smoothing factor for landmark interpolation (0=no smoothing, 1=ignore new data)
const LANDMARK_SMOOTHING = 0.6;

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
    
    startBtn.addEventListener('click', startRecording);
    
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
        
        await initializeMediaPipe();
        
        // Try to initialize the mesh-based animation system
        let meshSuccess = false;
        if (window.RegionAnimator) {
            meshSuccess = await window.RegionAnimator.init(ctx, avatarImg);
        }
        
        if (meshSuccess) {
            console.log('[spromoji] Using mesh-based animation system');
            animationEnabled = true;
            await initPreview();
            updateStatus('Avatar loaded - try making expressions!');
        } else {
            console.log('[spromoji] Mesh system failed, falling back to region detection');
            const autoSuccess = await tryAutoDetection();
            
            if (!autoSuccess) {
                updateStatus('Auto-detection failed. Use manual selection.');
                console.log('[spromoji] Auto-detection failed, manual mode available');
                if (manualModeBtn) manualModeBtn.style.display = 'inline-block';
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
        
        const { FaceLandmarker, FilesetResolver } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs');
        
        console.log('[spromoji] MediaPipe loaded, creating instances...');
        
        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
            { forceSIMD: false }
        );
        
        console.log('[spromoji] FilesetResolver created');
        
        avatarMesh = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                delegate: 'CPU'
            },
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: false,
            runningMode: 'IMAGE',
            numFaces: 1
        });
        
        console.log('[spromoji] Avatar mesh created');
        
        liveMesh = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                delegate: 'CPU'
            },
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: false,
            runningMode: 'VIDEO',
            numFaces: 1
        });
        
        console.log('[spromoji] MediaPipe fully initialized');
        console.log('[spromoji] Avatar mesh:', !!avatarMesh, 'Live mesh:', !!liveMesh);
        
    } catch (error) {
        console.error('[spromoji] MediaPipe initialization error:', error);
        updateStatus('Face tracking setup failed - will try manual mode');
    }
}

async function tryAutoDetection() {
    console.log('[spromoji] Starting facial feature detection...');
    updateStatus('Detecting facial features...');

    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);

    try {
        const cartoonRegions = window.AutoRegions.detectCartoon(avatarCanvas);
        if (cartoonRegions) {
            console.log('[spromoji] Cartoon detection succeeded');
            avatarRegions = cartoonRegions;
            
            Object.values(avatarRegions).forEach(r => {
                r.w = Math.max(r.w, 20);
                r.h = Math.max(r.h, 20);
            });
            
            console.table(avatarRegions);
            
            if (window.RegionAnimator) {
                window.RegionAnimator.init(ctx, avatarRegions, avatarImg);
                console.log('[spromoji] RegionAnimator initialized with cartoon regions');
            } else {
                console.error('[spromoji] RegionAnimator not available!');
                return false;
            }
            
            animationEnabled = true;
            debugCanvas.style.display = 'none';
            updateStatus('Features detected - try blinking & talking!');
            
            await initPreview();
            
            if (!cam || !cam.srcObject) {
                startBasicAnimation();
            }
            
            return true;
        }

        if (avatarMesh) {
            console.log('[spromoji] Trying MediaPipe detection...');
            const results = avatarMesh.detect(avatarCanvas);
            
            if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
                const landmarks = results.faceLandmarks[0];
                console.log('[spromoji] MediaPipe detected', landmarks.length, 'landmarks');
                
                avatarRegions = window.AutoRegions.fromLandmarks(landmarks, avatarCanvas.width, avatarCanvas.height);
                
                Object.values(avatarRegions).forEach(r => {
                    r.w = Math.max(r.w, 20);
                    r.h = Math.max(r.h, 20);
                });
                
                console.table(avatarRegions);
                
                if (window.RegionAnimator) {
                    window.RegionAnimator.init(ctx, avatarRegions, avatarImg);
                    console.log('[spromoji] RegionAnimator initialized with MediaPipe regions');
                } else {
                    console.error('[spromoji] RegionAnimator not available!');
                    return false;
                }
                
                animationEnabled = true;
                debugCanvas.style.display = 'none';
                updateStatus('Features detected - try blinking & talking!');
                
                await initPreview();
                
                if (!cam || !cam.srcObject) {
                    startBasicAnimation();
                }
                
                return true;
            }
        } else {
            console.log('[spromoji] MediaPipe not initialized, skipping...');
        }
        
        console.warn('[spromoji] Auto-detection failed');
        animationEnabled = false;
        updateStatus('Auto-detection failed - please select features manually');
        if (manualModeBtn) manualModeBtn.style.display = 'inline-block';
        return false;
        
    } catch (error) {
        console.error('[spromoji] Detection error:', error);
        animationEnabled = false;
        updateStatus('Detection error - please select features manually');
        if (manualModeBtn) manualModeBtn.style.display = 'inline-block';
        return false;
    }
}

async function startManualSelection() {
    console.log('[spromoji] Starting manual selection...');
    updateStatus('Click to select features manually...');
    
    if (manualModeBtn) manualModeBtn.style.display = 'none';
    
    try {
        const regions = await showManualPicker();
        avatarRegions = regions;
        
        Object.values(avatarRegions).forEach(r => {
            r.w = Math.max(r.w, 20);
            r.h = Math.max(r.h, 20);
        });
        
        console.table(avatarRegions);
        
        if (window.RegionAnimator) {
            window.RegionAnimator.init(ctx, avatarRegions, avatarImg);
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
    if (!liveMesh || !animationEnabled) {
        console.log('[spromoji] Cannot start tracking - missing:', {liveMesh: !!liveMesh, animationEnabled});
        return;
    }

    console.log('[spromoji] Starting face tracking loop...');

    let gotLandmarks = false;
    let prevLandmarks = null;
    let prevBlend = {};

    const trackFace = async () => {
        if (cam.readyState === cam.HAVE_ENOUGH_DATA) {
            try {
                const results = await liveMesh.detectForVideo(cam, performance.now());

                if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
                    let landmarks = results.faceLandmarks[0];
                    const blend = Object.fromEntries((results.faceBlendshapes[0]?.categories||[]).map(c=>[c.categoryName,c.score]));

                    // Smooth landmark updates for fluid animation
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
                    if (now - lastFrameTime >= 33) {
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
