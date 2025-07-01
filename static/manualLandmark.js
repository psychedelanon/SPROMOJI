/**
 * Manual Landmark Alignment System
 * Implements similarity transform (scale, rotation, translation) to align
 * canonical MediaPipe template to user's 3-point manual selection
 */

console.log('[manual] Manual landmark alignment system loading...');

/**
 * Compute similarity transform from template key points to user taps
 * @param {Array} userTaps - [leftEye, rightEye, mouth] user tap coordinates
 * @param {Object} canvasSize - {width, height} canvas dimensions
 * @returns {Object} Aligned landmark data
 */
function alignTemplate(userTaps, canvasSize) {
    if (!userTaps || userTaps.length !== 3) {
        throw new Error('alignTemplate requires exactly 3 user tap points');
    }
    
    if (!window.MediaPipeTemplate) {
        throw new Error('MediaPipe template not loaded - include mediapipeTri.js first');
    }
    
    console.log('[manual] Aligning template to user taps:', {
        leftEye: { x: userTaps[0].x.toFixed(1), y: userTaps[0].y.toFixed(1) },
        rightEye: { x: userTaps[1].x.toFixed(1), y: userTaps[1].y.toFixed(1) },
        mouth: { x: userTaps[2].x.toFixed(1), y: userTaps[2].y.toFixed(1) }
    });
    
    const template = window.MediaPipeTemplate;
    const keyIndices = template.keyIndices;
    
    // Extract template key points (in normalized 0-1 space)
    const templatePoints = [
        {
            x: template.landmarks[keyIndices.leftEye * 3],
            y: template.landmarks[keyIndices.leftEye * 3 + 1]
        },
        {
            x: template.landmarks[keyIndices.rightEye * 3],
            y: template.landmarks[keyIndices.rightEye * 3 + 1]
        },
        {
            x: template.landmarks[keyIndices.mouth * 3],
            y: template.landmarks[keyIndices.mouth * 3 + 1]
        }
    ];
    
    console.log('[manual] Template key points (normalized):', templatePoints);
    
    // Convert user taps to normalized coordinates
    const normalizedTaps = userTaps.map(tap => ({
        x: tap.x / canvasSize.width,
        y: tap.y / canvasSize.height
    }));
    
    console.log('[manual] Normalized user taps:', normalizedTaps);
    
    // Compute similarity transform using Procrustes analysis
    const transform = computeSimilarityTransform(templatePoints, normalizedTaps);
    
    console.log('[manual] Computed similarity transform:', {
        scale: transform.scale.toFixed(3),
        rotation: (transform.rotation * 180 / Math.PI).toFixed(1) + '°',
        translation: { 
            x: transform.tx.toFixed(3), 
            y: transform.ty.toFixed(3) 
        },
        rmsError: transform.rmsError.toFixed(2) + 'px'
    });
    
    // Apply transform to all template landmarks
    const alignedLandmarks = new Float32Array(468 * 3);
    
    for (let i = 0; i < 468; i++) {
        const templateX = template.landmarks[i * 3];
        const templateY = template.landmarks[i * 3 + 1];
        const templateZ = template.landmarks[i * 3 + 2];
        
        // Apply similarity transform
        const transformed = applySimilarityTransform(
            templateX, templateY, transform
        );
        
        // Convert back to canvas coordinates
        alignedLandmarks[i * 3] = transformed.x * canvasSize.width;
        alignedLandmarks[i * 3 + 1] = transformed.y * canvasSize.height;
        alignedLandmarks[i * 3 + 2] = templateZ; // Keep original z
    }
    
    console.log('[manual] ✅ Template aligned successfully');
    
    return {
        landmarks: alignedLandmarks,
        triangulation: template.triangulation,
        featureTriangles: template.featureTriangles,
        transform: transform,
        rmsError: transform.rmsError
    };
}

/**
 * Compute similarity transform (scale, rotation, translation) using Procrustes analysis
 * @param {Array} templatePts - Template key points
 * @param {Array} userPts - User tap points  
 * @returns {Object} Transform parameters
 */
function computeSimilarityTransform(templatePts, userPts) {
    // Compute centroids
    const templateCentroid = computeCentroid(templatePts);
    const userCentroid = computeCentroid(userPts);
    
    // Center the points
    const centeredTemplate = templatePts.map(p => ({
        x: p.x - templateCentroid.x,
        y: p.y - templateCentroid.y
    }));
    
    const centeredUser = userPts.map(p => ({
        x: p.x - userCentroid.x,
        y: p.y - userCentroid.y
    }));
    
    // Compute scale (ratio of distances)
    const templateScale = Math.sqrt(
        centeredTemplate.reduce((sum, p) => sum + p.x * p.x + p.y * p.y, 0)
    );
    const userScale = Math.sqrt(
        centeredUser.reduce((sum, p) => sum + p.x * p.x + p.y * p.y, 0)
    );
    
    const scale = userScale / templateScale;
    
    // Compute rotation using cross-correlation
    let numerator = 0;
    let denominator = 0;
    
    for (let i = 0; i < centeredTemplate.length; i++) {
        const tx = centeredTemplate[i].x;
        const ty = centeredTemplate[i].y;
        const ux = centeredUser[i].x;
        const uy = centeredUser[i].y;
        
        numerator += tx * uy - ty * ux;
        denominator += tx * ux + ty * uy;
    }
    
    const rotation = Math.atan2(numerator, denominator);
    
    // Translation is difference in centroids
    const tx = userCentroid.x - templateCentroid.x;
    const ty = userCentroid.y - templateCentroid.y;
    
    // Compute RMS error for validation
    let totalError = 0;
    for (let i = 0; i < templatePts.length; i++) {
        const transformed = applySimilarityTransform(
            templatePts[i].x, templatePts[i].y, 
            { scale, rotation, tx, ty }
        );
        
        const dx = transformed.x - userPts[i].x;
        const dy = transformed.y - userPts[i].y;
        totalError += dx * dx + dy * dy;
    }
    
    const rmsError = Math.sqrt(totalError / templatePts.length);
    
    return {
        scale,
        rotation,
        tx,
        ty,
        rmsError
    };
}

/**
 * Apply similarity transform to a point
 * @param {number} x - Point x coordinate
 * @param {number} y - Point y coordinate  
 * @param {Object} transform - Transform parameters
 * @returns {Object} Transformed point
 */
function applySimilarityTransform(x, y, transform) {
    const { scale, rotation, tx, ty } = transform;
    
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    
    return {
        x: scale * (cos * x - sin * y) + tx,
        y: scale * (sin * x + cos * y) + ty
    };
}

/**
 * Compute centroid of points
 * @param {Array} points - Array of {x, y} points
 * @returns {Object} Centroid point
 */
function computeCentroid(points) {
    const sum = points.reduce(
        (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
        { x: 0, y: 0 }
    );
    
    return {
        x: sum.x / points.length,
        y: sum.y / points.length
    };
}

/**
 * Convert landmark array to point objects for easier manipulation
 * @param {Float32Array} landmarks - Raw landmark data
 * @returns {Array} Array of {x, y, z} points
 */
function landmarksToPoints(landmarks) {
    const points = [];
    for (let i = 0; i < landmarks.length; i += 3) {
        points.push({
            x: landmarks[i],
            y: landmarks[i + 1],
            z: landmarks[i + 2] || 0
        });
    }
    return points;
}

/**
 * Convert point objects back to landmark array
 * @param {Array} points - Array of {x, y, z} points
 * @returns {Float32Array} Raw landmark data
 */
function pointsToLandmarks(points) {
    const landmarks = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
        landmarks[i * 3] = points[i].x;
        landmarks[i * 3 + 1] = points[i].y;
        landmarks[i * 3 + 2] = points[i].z || 0;
    }
    return landmarks;
}

/**
 * Manual Feature Region Selection Module
 * Handles draggable rectangle interface for selecting eye and mouth regions
 */

let isSelecting = false;
let currentRegion = 0; // 0: left eye, 1: right eye, 2: mouth
let regions = {};
let selectionState = {
    startX: 0,
    startY: 0,
    isDragging: false,
    canvas: null,
    ctx: null,
    debugCanvas: null,
    debugCtx: null,
    avatarImg: null,
    onComplete: null
};

const regionNames = ['leftEye', 'rightEye', 'mouth'];
const regionLabels = ['LEFT EYE', 'RIGHT EYE', 'MOUTH'];
const regionColors = ['#ff4444', '#44ff44', '#4444ff'];

/**
 * Start manual region selection process
 * @param {HTMLCanvasElement} canvas - Main canvas
 * @param {HTMLCanvasElement} debugCanvas - Debug overlay canvas  
 * @param {HTMLImageElement} avatarImg - Avatar image
 * @returns {Promise<Object>} Promise that resolves with selected regions
 */
function selectFeatureRegions(canvas, debugCanvas, avatarImg) {
    return new Promise((resolve, reject) => {
        selectionState.canvas = canvas;
        selectionState.ctx = canvas.getContext('2d');
        selectionState.debugCanvas = debugCanvas;
        selectionState.debugCtx = debugCanvas.getContext('2d');
        selectionState.avatarImg = avatarImg;
        selectionState.onComplete = resolve;
        
        // Reset state
        isSelecting = true;
        currentRegion = 0;
        regions = {};
        
        // Make debug canvas visible and interactive
        debugCanvas.style.display = 'block';
        debugCanvas.style.pointerEvents = 'auto';
        
        // Set up event listeners
        setupEventListeners();
        
        // Show initial instruction
        showInstruction();
        
        // Add control buttons
        addControlButtons(reject);
    });
}

function setupEventListeners() {
    const canvas = selectionState.debugCanvas;
    
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    
    // Touch events for mobile
    canvas.addEventListener('touchstart', onTouchStart);
    canvas.addEventListener('touchmove', onTouchMove);
    canvas.addEventListener('touchend', onTouchEnd);
}

function removeEventListeners() {
    const canvas = selectionState.debugCanvas;
    
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove', onTouchMove);
    canvas.removeEventListener('touchend', onTouchEnd);
}

function getMousePos(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

function getTouchPos(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
    };
}

function onMouseDown(e) {
    e.preventDefault();
    const pos = getMousePos(selectionState.debugCanvas, e);
    startDrag(pos.x, pos.y);
}

function onTouchStart(e) {
    e.preventDefault();
    const pos = getTouchPos(selectionState.debugCanvas, e);
    startDrag(pos.x, pos.y);
}

function startDrag(x, y) {
    selectionState.isDragging = true;
    selectionState.startX = x;
    selectionState.startY = y;
}

function onMouseMove(e) {
    if (!selectionState.isDragging) return;
    e.preventDefault();
    const pos = getMousePos(selectionState.debugCanvas, e);
    updateDrag(pos.x, pos.y);
}

function onTouchMove(e) {
    if (!selectionState.isDragging) return;
    e.preventDefault();
    const pos = getTouchPos(selectionState.debugCanvas, e);
    updateDrag(pos.x, pos.y);
}

function updateDrag(x, y) {
    const ctx = selectionState.debugCtx;
    const canvas = selectionState.debugCanvas;
    
    // Clear canvas and redraw existing regions
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawExistingRegions();
    
    // Draw current selection rectangle
    const width = x - selectionState.startX;
    const height = y - selectionState.startY;
    
    ctx.strokeStyle = regionColors[currentRegion];
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(selectionState.startX, selectionState.startY, width, height);
    ctx.setLineDash([]);
}

function onMouseUp(e) {
    if (!selectionState.isDragging) return;
    e.preventDefault();
    const pos = getMousePos(selectionState.debugCanvas, e);
    endDrag(pos.x, pos.y);
}

function onTouchEnd(e) {
    if (!selectionState.isDragging) return;
    e.preventDefault();
    const pos = e.changedTouches[0];
    const canvas = selectionState.debugCanvas;
    const rect = canvas.getBoundingClientRect();
    endDrag(pos.clientX - rect.left, pos.clientY - rect.top);
}

function endDrag(x, y) {
    selectionState.isDragging = false;
    
    const width = x - selectionState.startX;
    const height = y - selectionState.startY;
    
    // Only accept reasonably sized regions
    if (Math.abs(width) < 10 || Math.abs(height) < 10) {
        return;
    }
    
    // Normalize rectangle (handle negative width/height)
    const region = {
        x: Math.min(selectionState.startX, x),
        y: Math.min(selectionState.startY, y),
        w: Math.abs(width),
        h: Math.abs(height)
    };
    
    // Store the region
    regions[regionNames[currentRegion]] = region;
    
    // Move to next region or complete
    currentRegion++;
    if (currentRegion >= regionNames.length) {
        completeSelection();
    } else {
        showInstruction();
        drawExistingRegions();
    }
}

function drawExistingRegions() {
    const ctx = selectionState.debugCtx;
    
    for (let i = 0; i < currentRegion; i++) {
        const regionName = regionNames[i];
        const region = regions[regionName];
        if (region) {
            ctx.strokeStyle = regionColors[i];
            ctx.lineWidth = 2;
            ctx.strokeRect(region.x, region.y, region.w, region.h);
            
            // Add label
            ctx.fillStyle = regionColors[i];
            ctx.font = '14px Arial';
            ctx.fillText(`${i + 1}`, region.x + 5, region.y + 20);
        }
    }
}

function showInstruction() {
    const instructionText = `👆 Draw a box around the ${regionLabels[currentRegion]} (${currentRegion + 1}/3)`;
    
    // Find or create instruction element
    let instructionEl = document.getElementById('manualInstruction');
    if (!instructionEl) {
        instructionEl = document.createElement('div');
        instructionEl.id = 'manualInstruction';
        instructionEl.style.cssText = `
            position: absolute;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 10px 20px;
            border-radius: 10px;
            font-size: 16px;
            z-index: 1000;
            text-align: center;
        `;
        document.body.appendChild(instructionEl);
    }
    
    instructionEl.textContent = instructionText;
    instructionEl.style.color = regionColors[currentRegion];
}

function addControlButtons(onCancel) {
    // Remove existing buttons
    const existingControls = document.getElementById('manualControls');
    if (existingControls) {
        existingControls.remove();
    }
    
    const controlsDiv = document.createElement('div');
    controlsDiv.id = 'manualControls';
    controlsDiv.style.cssText = `
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 10px;
        z-index: 1000;
    `;
    
    const resetBtn = document.createElement('button');
    resetBtn.textContent = '🔄 Reset';
    resetBtn.style.cssText = `
        background: #ff6b35;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 25px;
        cursor: pointer;
        font-size: 14px;
    `;
    resetBtn.onclick = resetSelection;
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✕ Cancel';
    cancelBtn.style.cssText = `
        background: #666;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 25px;
        cursor: pointer;
        font-size: 14px;
    `;
    cancelBtn.onclick = () => {
        cleanup();
        onCancel(new Error('Selection cancelled'));
    };
    
    controlsDiv.appendChild(resetBtn);
    controlsDiv.appendChild(cancelBtn);
    document.body.appendChild(controlsDiv);
}

function resetSelection() {
    currentRegion = 0;
    regions = {};
    selectionState.debugCtx.clearRect(0, 0, selectionState.debugCanvas.width, selectionState.debugCanvas.height);
    showInstruction();
}

function completeSelection() {
    cleanup();
    
    // Convert regions to include center points for compatibility
    const processedRegions = {};
    for (const [name, region] of Object.entries(regions)) {
        processedRegions[name] = {
            ...region,
            centerX: region.x + region.w / 2,
            centerY: region.y + region.h / 2
        };
    }
    
    selectionState.onComplete(processedRegions);
}

function cleanup() {
    isSelecting = false;
    removeEventListeners();
    
    // Hide debug canvas
    if (selectionState.debugCanvas) {
        selectionState.debugCanvas.style.pointerEvents = 'none';
    }
    
    // Remove UI elements
    const instruction = document.getElementById('manualInstruction');
    if (instruction) instruction.remove();
    
    const controls = document.getElementById('manualControls');
    if (controls) controls.remove();
}

// Export alignment functions
window.ManualAlignment = {
    alignTemplate,
    computeSimilarityTransform,
    applySimilarityTransform,
    landmarksToPoints,
    pointsToLandmarks
};

// Export the main function
window.ManualLandmark = {
    selectFeatureRegions
};

console.log('[manual] Manual landmark alignment system loaded successfully'); 