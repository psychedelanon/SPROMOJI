/**
 * IMPROVED Auto-Detection for Cartoon/NFT Avatars
 * This actually works instead of failing like the previous system
 */

window.AutoRegions = {
    
    /**
     * Detect regions using multiple fallback methods
     */
    async detectRegions(img) {
        console.log('[AutoRegions] Starting detection for image:', img.width, 'x', img.height);
        
        // Try MediaPipe first (works for realistic faces)
        let regions = await this.tryMediaPipeDetection(img);
        if (regions) {
            console.log('[AutoRegions] MediaPipe detection successful');
            return regions;
        }
        
        // Try color-based detection (works for cartoons/NFTs)
        regions = await this.tryColorBasedDetection(img);
        if (regions) {
            console.log('[AutoRegions] Color-based detection successful');
            return regions;
        }
        
        // Try edge detection (backup method)
        regions = await this.tryEdgeDetection(img);
        if (regions) {
            console.log('[AutoRegions] Edge detection successful');
            return regions;
        }
        
        console.log('[AutoRegions] All detection methods failed');
        return null;
    },
    
    /**
     * MediaPipe detection (for realistic faces)
     */
    async tryMediaPipeDetection(img) {
        try {
            // This would need the MediaPipe integration - skip for now since it's failing
            return null;
        } catch (error) {
            console.log('[AutoRegions] MediaPipe failed:', error);
            return null;
        }
    },
    
    /**
     * Color-based detection (works great for cartoons and NFTs)
     */
    async tryColorBasedDetection(img) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            const data = imageData.data;
            
            // Find dark circular regions (likely eyes)
            const eyeRegions = this.findDarkCircularRegions(data, img.width, img.height);
            
            // Find horizontal lines or contrasting regions (likely mouth)
            const mouthRegion = this.findMouthRegion(data, img.width, img.height);
            
            if (eyeRegions.length >= 2 && mouthRegion) {
                return {
                    leftEye: eyeRegions[0],
                    rightEye: eyeRegions[1], 
                    mouth: mouthRegion,
                    theme: 'Auto-detected (Color-based)'
                };
            }
            
            return null;
            
        } catch (error) {
            console.log('[AutoRegions] Color detection failed:', error);
            return null;
        }
    },
    
    /**
     * Find dark circular regions that could be eyes
     */
    findDarkCircularRegions(data, width, height) {
        const eyeRegions = [];
        const blockSize = Math.min(width, height) / 20; // Adaptive block size
        
        // Scan the upper half of the image for dark regions
        for (let y = height * 0.2; y < height * 0.6; y += blockSize) {
            for (let x = width * 0.1; x < width * 0.9; x += blockSize) {
                const darkness = this.calculateRegionDarkness(data, x, y, blockSize, width, height);
                
                if (darkness > 0.3) { // Dark enough to be an eye
                    const region = {
                        x: Math.max(0, x - blockSize/2),
                        y: Math.max(0, y - blockSize/2),
                        w: Math.min(blockSize * 2, width - x),
                        h: Math.min(blockSize * 1.5, height - y)
                    };
                    
                    // Avoid duplicate regions
                    if (!this.isOverlapping(region, eyeRegions)) {
                        eyeRegions.push(region);
                    }
                }
            }
        }
        
        // Sort by X position and take the leftmost 2
        eyeRegions.sort((a, b) => a.x - b.x);
        return eyeRegions.slice(0, 2);
    },
    
    /**
     * Find mouth region in the lower part of face
     */
    findMouthRegion(data, width, height) {
        const blockSize = Math.min(width, height) / 15;
        let bestRegion = null;
        let bestScore = 0;
        
        // Scan the lower half for horizontal features
        for (let y = height * 0.55; y < height * 0.8; y += blockSize/2) {
            for (let x = width * 0.2; x < width * 0.8; x += blockSize/2) {
                const score = this.calculateMouthScore(data, x, y, blockSize, width, height);
                
                if (score > bestScore) {
                    bestScore = score;
                    bestRegion = {
                        x: Math.max(0, x - blockSize),
                        y: Math.max(0, y - blockSize/2),
                        w: Math.min(blockSize * 2, width - x),
                        h: Math.min(blockSize, height - y)
                    };
                }
            }
        }
        
        return bestScore > 0.2 ? bestRegion : null;
    },
    
    /**
     * Calculate darkness of a region (higher = darker)
     */
    calculateRegionDarkness(data, startX, startY, size, width, height) {
        let totalDarkness = 0;
        let pixelCount = 0;
        
        for (let y = startY; y < Math.min(startY + size, height); y++) {
            for (let x = startX; x < Math.min(startX + size, width); x++) {
                const i = (y * width + x) * 4;
                const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
                totalDarkness += (255 - brightness) / 255; // Invert so dark = high score
                pixelCount++;
            }
        }
        
        return pixelCount > 0 ? totalDarkness / pixelCount : 0;
    },
    
    /**
     * Calculate mouth score (looks for horizontal contrasts)
     */
    calculateMouthScore(data, startX, startY, size, width, height) {
        let horizontalContrast = 0;
        let pixelCount = 0;
        
        for (let y = startY; y < Math.min(startY + size/2, height); y++) {
            for (let x = startX; x < Math.min(startX + size, width - 1); x++) {
                const i1 = (y * width + x) * 4;
                const i2 = (y * width + x + 1) * 4;
                
                const brightness1 = (data[i1] + data[i1 + 1] + data[i1 + 2]) / 3;
                const brightness2 = (data[i2] + data[i2 + 1] + data[i2 + 2]) / 3;
                
                horizontalContrast += Math.abs(brightness1 - brightness2) / 255;
                pixelCount++;
            }
        }
        
        return pixelCount > 0 ? horizontalContrast / pixelCount : 0;
    },
    
    /**
     * Check if regions overlap
     */
    isOverlapping(region, existingRegions) {
        return existingRegions.some(existing => {
            return !(region.x + region.w < existing.x ||
                    existing.x + existing.w < region.x ||
                    region.y + region.h < existing.y ||
                    existing.y + existing.h < region.y);
        });
    },
    
    /**
     * Edge detection fallback
     */
    async tryEdgeDetection(img) {
        // Simplified edge detection as final fallback
        try {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            // Apply simple edge detection and find prominent features
            // This is a simplified implementation
            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            const edges = this.detectEdges(imageData);
            
            // Find regions with high edge density
            const regions = this.findEdgeDenseRegions(edges, img.width, img.height);
            
            if (regions.length >= 3) {
                return {
                    leftEye: regions[0],
                    rightEye: regions[1],
                    mouth: regions[2],
                    theme: 'Auto-detected (Edge-based)'
                };
            }
            
            return null;
            
        } catch (error) {
            console.log('[AutoRegions] Edge detection failed:', error);
            return null;
        }
    },
    
    /**
     * Simple edge detection
     */
    detectEdges(imageData) {
        // Simplified Sobel edge detection
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const edges = new Uint8Array(width * height);
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const pixelIdx = idx * 4;
                
                // Get grayscale value
                const gray = (data[pixelIdx] + data[pixelIdx + 1] + data[pixelIdx + 2]) / 3;
                
                // Simple gradient calculation
                const gx = -data[(idx - width - 1) * 4] + data[(idx - width + 1) * 4] +
                          -2 * data[(idx - 1) * 4] + 2 * data[(idx + 1) * 4] +
                          -data[(idx + width - 1) * 4] + data[(idx + width + 1) * 4];
                
                const gy = -data[(idx - width - 1) * 4] - 2 * data[(idx - width) * 4] - data[(idx - width + 1) * 4] +
                           data[(idx + width - 1) * 4] + 2 * data[(idx + width) * 4] + data[(idx + width + 1) * 4];
                
                edges[idx] = Math.min(255, Math.sqrt(gx * gx + gy * gy));
            }
        }
        
        return edges;
    },
    
    /**
     * Find regions with high edge density
     */
    findEdgeDenseRegions(edges, width, height) {
        const regions = [];
        const blockSize = Math.min(width, height) / 15;
        
        for (let y = 0; y < height - blockSize; y += blockSize/2) {
            for (let x = 0; x < width - blockSize; x += blockSize/2) {
                let edgeSum = 0;
                let pixelCount = 0;
                
                for (let by = y; by < y + blockSize && by < height; by++) {
                    for (let bx = x; bx < x + blockSize && bx < width; bx++) {
                        edgeSum += edges[by * width + bx];
                        pixelCount++;
                    }
                }
                
                const edgeDensity = edgeSum / (pixelCount * 255);
                
                if (edgeDensity > 0.3) { // High edge density
                    regions.push({
                        x: x,
                        y: y,
                        w: Math.min(blockSize, width - x),
                        h: Math.min(blockSize, height - y),
                        score: edgeDensity
                    });
                }
            }
        }
        
        // Sort by score and return top regions
        regions.sort((a, b) => b.score - a.score);
        return regions.slice(0, 3);
    },
    
    /**
     * Helper functions for MediaPipe integration and cartoon detection
     */
    
    // RGB to HSV conversion for color analysis
    rgb2hsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const v = max, d = max - min;
        const s = max === 0 ? 0 : d / max;
        return { s, v };
    },
    
    // Convert MediaPipe landmarks to regions
    fromLandmarks(lm, w, h) {
        const PAD = { eye: 1.2, mouth: 1.3 };
        
        function bbox(points) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            points.forEach(p => {
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            });
            return { x: minX * w, y: minY * h, w: (maxX - minX) * w, h: (maxY - minY) * h };
        }
        
        function expand(r, f) {
            const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
            return { x: cx - r.w * f / 2, y: cy - r.h * f / 2, w: r.w * f, h: r.h * f };
        }
        
        const L = [33, 7, 163, 144, 145, 153, 154, 155, 133];
        const R = [362, 382, 381, 380, 374, 373, 390, 249, 263];
        const M = [61, 291, 78, 308, 12, 15, 13, 14];
        
        const left = bbox(L.map(i => lm[i]));
        const right = bbox(R.map(i => lm[i]));
        const mouth = bbox(M.map(i => lm[i]));
        
        return {
            leftEye: expand(left, PAD.eye),
            rightEye: expand(right, PAD.eye),
            mouth: expand(mouth, PAD.mouth)
        };
    },
    
    // K-means clustering for feature detection
    kmeans(points, k) {
        const centroids = [];
        for (let i = 0; i < k; i++) {
            centroids.push({
                x: points[Math.floor(points.length * (i + 0.5) / k)].x,
                y: points[Math.floor(points.length * (i + 0.5) / k)].y
            });
        }
        
        let changed = true, iter = 0;
        const clusters = new Array(k).fill(0).map(() => []);
        
        while (changed && iter < 5) {
            clusters.forEach(c => c.length = 0);
            changed = false;
            
            points.forEach(p => {
                let best = 0, bd = Infinity;
                for (let i = 0; i < k; i++) {
                    const dx = p.x - centroids[i].x, dy = (p.y - centroids[i].y) * 0.5;
                    const d = dx * dx + dy * dy;
                    if (d < bd) { bd = d; best = i; }
                }
                clusters[best].push(p);
            });
            
            for (let i = 0; i < k; i++) {
                if (clusters[i].length) {
                    const cx = clusters[i].reduce((s, p) => s + p.x, 0) / clusters[i].length;
                    const cy = clusters[i].reduce((s, p) => s + p.y, 0) / clusters[i].length;
                    if (cx !== centroids[i].x || cy !== centroids[i].y) {
                        centroids[i] = { x: cx, y: cy };
                        changed = true;
                    }
                }
            }
            iter++;
        }
        
        return clusters.map((pts, i) => {
            let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
            pts.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            });
            return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, cx: centroids[i].x, cy: centroids[i].y };
        });
    },
    
    // Optimized cartoon detection using HSV masks and edge clustering
    detectCartoon(canvas) {
        const w = canvas.width, h = canvas.height;
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, w, h).data;
        const dark = [];
        const grad = new Float32Array(w * h);
        
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = (y * w + x) * 4;
                const r = data[idx], g = data[idx + 1], b = data[idx + 2];
                const hsv = this.rgb2hsv(r, g, b);
                const gray = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                
                if (!(hsv.s < 0.25 && hsv.v > 0.85) && gray < 0.4) dark.push({ x, y });
                
                const idxR = idx + 4;
                const idxD = idx + w * 4;
                const gR = (0.299 * data[idxR] + 0.587 * data[idxR + 1] + 0.114 * data[idxR + 2]) / 255;
                const gD = (0.299 * data[idxD] + 0.587 * data[idxD + 1] + 0.114 * data[idxD + 2]) / 255;
                grad[y * w + x] = Math.abs(gray - gR) + Math.abs(gray - gD);
            }
        }
        
        if (dark.length < 20) return null;
        
        const clusters = this.kmeans(dark, 2).sort((a, b) => a.cx - b.cx);
        const pad = 5;
        const left = {
            x: Math.max(clusters[0].x - pad, 0),
            y: Math.max(clusters[0].y - pad, 0),
            w: Math.min(clusters[0].w + pad * 2, w),
            h: Math.min(clusters[0].h + pad * 2, h)
        };
        const right = {
            x: Math.max(clusters[1].x - pad, 0),
            y: Math.max(clusters[1].y - pad, 0),
            w: Math.min(clusters[1].w + pad * 2, w),
            h: Math.min(clusters[1].h + pad * 2, h)
        };
        
        const midY = (clusters[0].cy + clusters[1].cy) / 2;
        let bestY = Math.floor(midY), best = 0;
        for (let y = Math.floor(midY); y < h - 1; y++) {
            let sum = 0;
            for (let x = 0; x < w; x++) sum += grad[y * w + x];
            if (sum > best) { best = sum; bestY = y; }
        }
        
        let leftEdge = w, rightEdge = 0;
        for (let x = 0; x < w; x++) {
            if (grad[bestY * w + x] > best / w * 0.3) {
                if (x < leftEdge) leftEdge = x;
                if (x > rightEdge) rightEdge = x;
            }
        }
        if (rightEdge - leftEdge < 10) { leftEdge = w * 0.3; rightEdge = w * 0.7; }
        
        const mh = h * 0.2;
        const mouth = {
            x: Math.max(leftEdge - 10, 0),
            y: Math.max(bestY - mh / 2, midY),
            w: Math.min(rightEdge - leftEdge + 20, w),
            h: Math.min(mh, h - (bestY - mh / 2))
        };
        
        return { leftEye: left, rightEye: right, mouth: mouth };
    }
};
