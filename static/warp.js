/**
 * Region-Based Animation System
 * Simple affine transforms on facial feature regions for pose-driven animation
 */

/**
 * Get facial region landmark indices for feature detection
 */
const FACIAL_REGIONS = {
    // MediaPipe Face Mesh landmark indices for key facial regions
    MOUTH: [
        0, 11, 12, 13, 14, 15, 16, 17, 18, 24, 25, 26, 27, 28, 29, 30, 31, 32,
        61, 62, 72, 73, 74, 82, 83, 84, 87, 88, 89, 90, 91, 95, 96, 146, 178,
        179, 180, 181, 183, 184, 185, 186, 191, 267, 268, 269, 270, 271, 272,
        303, 304, 308, 310, 311, 312, 317, 318, 319, 320, 321, 324, 375, 402,
        403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 415
    ],
    
    LEFT_EYE: [
        33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246
    ],
    
    RIGHT_EYE: [
        362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398
    ]
};

/**
 * Extract feature region bounding rectangles from landmarks
 * @param {Array} landmarks - Array of {x, y, z} landmarks
 * @returns {Object} Object with leftEye, rightEye, mouth region rectangles
 */
function getFeatureRegionRects(landmarks) {
    if (!landmarks || landmarks.length < 468) {
        console.warn('[regions] Insufficient landmarks for region detection');
        return null;
    }
    
    const regions = {};
    
    // Extract each region
    for (const [regionName, indices] of Object.entries(FACIAL_REGIONS)) {
        const regionPoints = indices.map(i => landmarks[i]).filter(p => p);
        
        if (regionPoints.length === 0) {
            console.warn(`[regions] No valid points for ${regionName}`);
            continue;
        }
        
        // Calculate bounding box
        const xs = regionPoints.map(p => p.x);
        const ys = regionPoints.map(p => p.y);
        
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        
        regions[regionName.toLowerCase()] = {
            x: minX,
            y: minY,
            w: maxX - minX,
            h: maxY - minY,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
        };
    }
    
    console.log('[regions] Extracted regions:', Object.keys(regions));
    return regions;
}

/**
 * Draw a region with affine transform
 * @param {CanvasRenderingContext2D} srcCtx - Source image context
 * @param {CanvasRenderingContext2D} dstCtx - Destination context
 * @param {Object} region - Region bounds {x, y, w, h, centerX, centerY}
 * @param {Object} transform - Transform options {translateX, translateY, scaleX, scaleY, rotation}
 */
function drawRegionTransformed(srcCtx, dstCtx, region, transform = {}) {
    const {
        translateX = 0,
        translateY = 0,
        scaleX = 1,
        scaleY = 1,
        rotation = 0
    } = transform;
    
    dstCtx.save();
    
    // Move to target position
    const targetX = region.centerX + translateX;
    const targetY = region.centerY + translateY;
    
    dstCtx.translate(targetX, targetY);
    
    if (rotation !== 0) {
        dstCtx.rotate(rotation);
    }
    
    if (scaleX !== 1 || scaleY !== 1) {
        dstCtx.scale(scaleX, scaleY);
    }
    
    // Draw region centered at origin
    dstCtx.drawImage(
        srcCtx.canvas,
        region.x, region.y, region.w, region.h,
        -region.w / 2, -region.h / 2, region.w, region.h
    );
    
    dstCtx.restore();
}

/**
 * Compute Eye Aspect Ratio for blink detection
 * @param {Array} landmarks - Facial landmarks
 * @param {string} eye - 'left' or 'right'
 * @returns {number} Eye aspect ratio (0 = closed, 1 = open)
 */
function computeEyeAspectRatio(landmarks, eye) {
    if (!landmarks || landmarks.length < 468) return 1;
    
    let topPoints, bottomPoints, sidePoints;
    
    if (eye === 'left') {
        topPoints = [159, 158, 157]; // Left eye top
        bottomPoints = [145, 144, 163]; // Left eye bottom
        sidePoints = [33, 133]; // Left eye corners
    } else {
        topPoints = [386, 385, 384]; // Right eye top
        bottomPoints = [374, 373, 380]; // Right eye bottom
        sidePoints = [362, 263]; // Right eye corners
    }
    
    // Calculate vertical distances
    let verticalDist = 0;
    for (let i = 0; i < topPoints.length; i++) {
        const top = landmarks[topPoints[i]];
        const bottom = landmarks[bottomPoints[i]];
        if (top && bottom) {
            verticalDist += Math.abs(top.y - bottom.y);
        }
    }
    verticalDist /= topPoints.length;
    
    // Calculate horizontal distance
    const left = landmarks[sidePoints[0]];
    const right = landmarks[sidePoints[1]];
    const horizontalDist = left && right ? Math.abs(right.x - left.x) : 1;
    
    // Eye aspect ratio
    const ear = verticalDist / horizontalDist;
    
    // Normalize and threshold
    return ear > 0.15 ? 1 : 0; // Binary open/closed
}

/**
 * Compute mouth scale based on openness
 * @param {Array} landmarks - Facial landmarks
 * @returns {Object} {scaleX, scaleY, translateY}
 */
function computeMouthTransform(landmarks) {
    if (!landmarks || landmarks.length < 468) {
        return { scaleX: 1, scaleY: 1, translateY: 0 };
    }
    
    // Mouth landmarks
    const upperLip = landmarks[13];   // Upper lip center
    const lowerLip = landmarks[14];   // Lower lip center
    const leftCorner = landmarks[61]; // Left mouth corner
    const rightCorner = landmarks[291]; // Right mouth corner
    
    if (!upperLip || !lowerLip || !leftCorner || !rightCorner) {
        return { scaleX: 1, scaleY: 1, translateY: 0 };
    }
    
    // Calculate mouth dimensions
    const mouthHeight = Math.abs(lowerLip.y - upperLip.y);
    const mouthWidth = Math.abs(rightCorner.x - leftCorner.x);
    
    // Determine openness
    const openRatio = mouthHeight / mouthWidth;
    const isOpen = openRatio > 0.05;
    
    if (isOpen) {
        return {
            scaleX: 1.0,
            scaleY: 1.2, // Stretch vertically when open
            translateY: 2 // Move down slightly to simulate jaw drop
        };
    } else {
        return {
            scaleX: 1.0,
            scaleY: 1.0,
            translateY: 0
        };
    }
}

/**
 * Compute head yaw (left/right turn) approximation
 * @param {Array} landmarks - Facial landmarks
 * @returns {number} Yaw offset in pixels
 */
function computeHeadYaw(landmarks) {
    if (!landmarks || landmarks.length < 468) return 0;
    
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const noseTip = landmarks[1];
    
    if (!leftEye || !rightEye || !noseTip) return 0;
    
    // Calculate face center
    const faceCenterX = (leftEye.x + rightEye.x) / 2;
    
    // Distance from nose to face center indicates turn
    const yawOffset = (noseTip.x - faceCenterX) * 0.5; // Scale down
    
    return yawOffset;
}

/**
 * Main region-based animation function
 * @param {CanvasRenderingContext2D} srcCtx - Source avatar context
 * @param {CanvasRenderingContext2D} dstCtx - Destination canvas context
 * @param {Object} avatarRegions - Avatar feature regions
 * @param {Array} userLandmarks - Live user landmarks
 * @param {HTMLImageElement} avatarImg - Avatar image
 */
function animateFeatureRegions(srcCtx, dstCtx, avatarRegions, userLandmarks, avatarImg) {
    if (!avatarRegions || !userLandmarks || !avatarImg) {
        console.warn('[regions] Missing required data for animation');
        return;
    }
    
    // Clear canvas
    dstCtx.clearRect(0, 0, dstCtx.canvas.width, dstCtx.canvas.height);
    
    // Compute user pose data
    const headRoll = computeHeadRoll(userLandmarks);
    const headYaw = computeHeadYaw(userLandmarks);
    const leftEyeEAR = computeEyeAspectRatio(userLandmarks, 'left');
    const rightEyeEAR = computeEyeAspectRatio(userLandmarks, 'right');
    const mouthTransform = computeMouthTransform(userLandmarks);
    
    // Apply global head tilt
    dstCtx.save();
    dstCtx.translate(dstCtx.canvas.width / 2, dstCtx.canvas.height / 2);
    dstCtx.rotate(headRoll * 0.3); // Gentle head tilt
    dstCtx.translate(-dstCtx.canvas.width / 2, -dstCtx.canvas.height / 2);
    
    // Draw base avatar (we'll overwrite feature regions)
    dstCtx.drawImage(avatarImg, 0, 0, dstCtx.canvas.width, dstCtx.canvas.height);
    
    // Animate left eye
    if (avatarRegions.lefteye) {
        const eyeTransform = {
            translateX: headYaw * 0.5,
            translateY: 0,
            scaleX: 1,
            scaleY: leftEyeEAR, // Blink by scaling vertically
            rotation: 0
        };
        
        drawRegionTransformed(srcCtx, dstCtx, avatarRegions.lefteye, eyeTransform);
    }
    
    // Animate right eye
    if (avatarRegions.righteye) {
        const eyeTransform = {
            translateX: headYaw * 0.5,
            translateY: 0,
            scaleX: 1,
            scaleY: rightEyeEAR, // Blink by scaling vertically
            rotation: 0
        };
        
        drawRegionTransformed(srcCtx, dstCtx, avatarRegions.righteye, eyeTransform);
    }
    
    // Animate mouth
    if (avatarRegions.mouth) {
        const finalMouthTransform = {
            translateX: headYaw * 0.3,
            translateY: mouthTransform.translateY,
            scaleX: mouthTransform.scaleX,
            scaleY: mouthTransform.scaleY,
            rotation: 0
        };
        
        drawRegionTransformed(srcCtx, dstCtx, avatarRegions.mouth, finalMouthTransform);
    }
    
    dstCtx.restore();
}

/**
 * Helper function to compute head roll from eye positions
 * @param {Array} landmarks - Facial landmarks
 * @returns {number} Roll angle in radians
 */
function computeHeadRoll(landmarks) {
    if (!landmarks || landmarks.length < 468) return 0;
    
    const leftEye = landmarks[33];   // Left eye outer corner
    const rightEye = landmarks[263]; // Right eye outer corner
    
    if (!leftEye || !rightEye) return 0;
    
    return Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
}

// Export functions to global scope
window.RegionAnimator = {
    getFeatureRegionRects,
    drawRegionTransformed,
    computeEyeAspectRatio,
    computeMouthTransform,
    computeHeadYaw,
    computeHeadRoll,
    animateFeatureRegions,
    FACIAL_REGIONS
};

console.log('[regions] Region-based animation system loaded successfully'); 