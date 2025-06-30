/**
 * SPROMOJI Facial Morphing - Triangulation and Warping Helpers
 * Implements Delaunay triangulation and per-triangle affine transforms for real-time face morphing
 */

console.log('[warp] Facial morphing helpers loading...');

/**
 * Create Delaunay triangulation from facial landmarks
 * @param {Array} landmarks - Array of {x, y} points
 * @returns {Object} {triangles: Uint32Array, coords: Float32Array}
 */
function triangulatePoints(landmarks) {
    console.log('[warp] Triangulating', landmarks.length, 'landmarks');
    
    // Convert landmarks to flat coordinate array for Delaunator
    const coords = new Float32Array(landmarks.length * 2);
    for (let i = 0; i < landmarks.length; i++) {
        coords[i * 2] = landmarks[i].x;
        coords[i * 2 + 1] = landmarks[i].y;
    }
    
    // Perform Delaunay triangulation
    const delaunay = Delaunator.from(landmarks.map(p => [p.x, p.y]));
    
    console.log('[warp] Created', delaunay.triangles.length / 3, 'triangles');
    
    return {
        triangles: delaunay.triangles, // Indices into landmarks array
        coords: coords
    };
}

/**
 * Get triangles that include specific landmark indices (for performance optimization)
 * @param {Uint32Array} triangles - Triangle indices from Delaunator
 * @param {Array} landmarkIndices - Landmark indices to filter by
 * @returns {Array} Filtered triangle indices
 */
function getTrianglesContaining(triangles, landmarkIndices) {
    const indexSet = new Set(landmarkIndices);
    const filteredTriangles = [];
    
    for (let i = 0; i < triangles.length; i += 3) {
        const t0 = triangles[i];
        const t1 = triangles[i + 1];
        const t2 = triangles[i + 2];
        
        // If any vertex of the triangle is in our target indices
        if (indexSet.has(t0) || indexSet.has(t1) || indexSet.has(t2)) {
            filteredTriangles.push(t0, t1, t2);
        }
    }
    
    return filteredTriangles;
}

/**
 * Warp a single triangle using affine transformation
 * @param {CanvasRenderingContext2D} srcCtx - Source canvas context
 * @param {CanvasRenderingContext2D} dstCtx - Destination canvas context
 * @param {Array} srcTriangle - Source triangle vertices [{x,y}, {x,y}, {x,y}]
 * @param {Array} dstTriangle - Destination triangle vertices [{x,y}, {x,y}, {x,y}]
 */
function warpTriangle(srcCtx, dstCtx, srcTriangle, dstTriangle) {
    const [src0, src1, src2] = srcTriangle;
    const [dst0, dst1, dst2] = dstTriangle;
    
    // Calculate affine transformation matrix
    // From src triangle to dst triangle
    const matrix = calculateAffineMatrix(src0, src1, src2, dst0, dst1, dst2);
    
    if (!matrix) return; // Skip degenerate triangles
    
    dstCtx.save();
    
    // Create clipping path for destination triangle
    dstCtx.beginPath();
    dstCtx.moveTo(dst0.x, dst0.y);
    dstCtx.lineTo(dst1.x, dst1.y);
    dstCtx.lineTo(dst2.x, dst2.y);
    dstCtx.closePath();
    dstCtx.clip();
    
    // Apply transformation matrix
    dstCtx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    
    // Draw source triangle area
    dstCtx.drawImage(srcCtx.canvas, 0, 0);
    
    dstCtx.restore();
}

/**
 * Calculate 2D affine transformation matrix to map src triangle to dst triangle
 * @param {Object} src0, src1, src2 - Source triangle vertices
 * @param {Object} dst0, dst1, dst2 - Destination triangle vertices
 * @returns {Object} Transformation matrix {a, b, c, d, e, f}
 */
function calculateAffineMatrix(src0, src1, src2, dst0, dst1, dst2) {
    // Set up system of linear equations for affine transform
    // [a c e] [x]   [x']
    // [b d f] [y] = [y']
    // [0 0 1] [1]   [1 ]
    
    const x1 = src0.x, y1 = src0.y;
    const x2 = src1.x, y2 = src1.y;
    const x3 = src2.x, y3 = src2.y;
    
    const u1 = dst0.x, v1 = dst0.y;
    const u2 = dst1.x, v2 = dst1.y;
    const u3 = dst2.x, v3 = dst2.y;
    
    // Calculate determinant to avoid division by zero
    const det = (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
    if (Math.abs(det) < 1e-10) return null; // Degenerate triangle
    
    // Solve for transformation matrix coefficients
    const a = ((u1 - u3) * (y2 - y3) - (u2 - u3) * (y1 - y3)) / det;
    const b = ((v1 - v3) * (y2 - y3) - (v2 - v3) * (y1 - y3)) / det;
    const c = ((x1 - x3) * (u2 - u3) - (x2 - x3) * (u1 - u3)) / det;
    const d = ((x1 - x3) * (v2 - v3) - (x2 - x3) * (v1 - v3)) / det;
    const e = u3 - a * x3 - c * y3;
    const f = v3 - b * x3 - d * y3;
    
    return { a, b, c, d, e, f };
}

/**
 * Morph entire face using triangulation
 * @param {CanvasRenderingContext2D} srcCtx - Source avatar context
 * @param {CanvasRenderingContext2D} dstCtx - Destination context
 * @param {Array} srcLandmarks - Source facial landmarks
 * @param {Array} dstLandmarks - Target facial landmarks
 * @param {Uint32Array} triangles - Triangle indices
 */
function morphFace(srcCtx, dstCtx, srcLandmarks, dstLandmarks, triangles) {
    // Clear destination
    dstCtx.clearRect(0, 0, dstCtx.canvas.width, dstCtx.canvas.height);
    
    // Process triangles in batches for performance
    for (let i = 0; i < triangles.length; i += 3) {
        const idx0 = triangles[i];
        const idx1 = triangles[i + 1];
        const idx2 = triangles[i + 2];
        
        const srcTriangle = [
            srcLandmarks[idx0],
            srcLandmarks[idx1], 
            srcLandmarks[idx2]
        ];
        
        const dstTriangle = [
            dstLandmarks[idx0],
            dstLandmarks[idx1],
            dstLandmarks[idx2]
        ];
        
        warpTriangle(srcCtx, dstCtx, srcTriangle, dstTriangle);
    }
}

/**
 * Get facial region landmark indices for optimization
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
    ],
    
    LEFT_EYEBROW: [
        46, 53, 52, 51, 48, 115, 131, 134, 102, 49, 220, 305, 292, 334, 293, 300
    ],
    
    RIGHT_EYEBROW: [
        276, 283, 282, 295, 285, 336, 296, 334, 293, 300, 276, 353, 383, 372, 345, 346
    ]
};

// Performance monitoring
let lastMorphTime = 0;
let morphCount = 0;

/**
 * Get performance-optimized triangle set focusing on expressive regions
 * @param {Uint32Array} allTriangles - All triangulation triangles
 * @returns {Uint32Array} Filtered triangles for mouth and eye regions
 */
function getExpressionTriangles(allTriangles) {
    const expressiveIndices = [
        ...FACIAL_REGIONS.MOUTH,
        ...FACIAL_REGIONS.LEFT_EYE,
        ...FACIAL_REGIONS.RIGHT_EYE,
        ...FACIAL_REGIONS.LEFT_EYEBROW,
        ...FACIAL_REGIONS.RIGHT_EYEBROW
    ];
    
    return getTrianglesContaining(allTriangles, expressiveIndices);
}

/**
 * Log morphing performance metrics
 */
function logMorphPerformance() {
    morphCount++;
    const now = performance.now();
    
    if (morphCount % 30 === 0) { // Log every 30 frames
        const fps = morphCount / ((now - lastMorphTime) / 1000);
        console.log(`[warp] Morphing FPS: ${fps.toFixed(1)}`);
        morphCount = 0;
        lastMorphTime = now;
    }
}

// Export functions to global scope for script.js
window.FacialMorph = {
    triangulatePoints,
    getTrianglesContaining,
    warpTriangle,
    morphFace,
    getExpressionTriangles,
    logMorphPerformance,
    FACIAL_REGIONS
};

console.log('[warp] Facial morphing helpers loaded successfully');

/* TODO: Phase P2 - WebGL Implementation
 * 
 * For mobile performance and advanced effects, implement WebGL-based morphing:
 * 
 * 1. WebGL Vertex Shader:
 *    - Upload landmarks as vertex attributes
 *    - Apply morphing in vertex shader for GPU acceleration
 *    - Use texture coordinates for proper mapping
 * 
 * 2. Fragment Shader:
 *    - Handle texture sampling and blending
 *    - Add real-time lighting effects
 *    - Implement smooth interpolation between keyframes
 * 
 * 3. WebGL Optimizations:
 *    - Use vertex buffer objects (VBOs) for landmark data
 *    - Implement level-of-detail (LOD) for distant faces
 *    - Add frustum culling for off-screen triangles
 *    - Use instanced rendering for multiple avatars
 * 
 * 4. Advanced Features:
 *    - Subsurface scattering for realistic skin
 *    - Dynamic normal mapping for facial texture
 *    - Real-time shadow casting
 *    - Hair and clothing physics
 * 
 * Implementation files needed:
 *    - static/shaders/morph.vert
 *    - static/shaders/morph.frag  
 *    - static/webgl-morph.js
 * 
 * Expected performance: 60 FPS on mobile devices
 */ 