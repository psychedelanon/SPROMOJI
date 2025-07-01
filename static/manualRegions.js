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

// Export the main function
window.ManualRegions = {
    selectFeatureRegions
}; 