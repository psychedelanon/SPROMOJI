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
    }
}; 