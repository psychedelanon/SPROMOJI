/**
 * ENHANCED Auto-Detection for Cartoon/NFT Avatars
 * Improved accuracy with better landmark mapping and region validation
 */

(function(){
  const PAD = { eye: 1.4, mouth: 1.5 }; // Increased padding for better coverage

  function rgb2hsv(r,g,b){
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    const v=max, d=max-min;
    const s=max===0?0:d/max;
    let h = 0;
    if (d !== 0) {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return {h, s, v};
  }

  function fromLandmarks(lm, w, h) {
    if (!lm || lm.length < 468) {
      console.warn('[autoRegions] Invalid landmarks, not enough points:', lm?.length || 0);
      return null;
    }
    
    function bbox(points) {
      if (!points.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      points.forEach(p => {
        if (p && typeof p.x === 'number' && typeof p.y === 'number') {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      });
      return {x: minX * w, y: minY * h, w: (maxX - minX) * w, h: (maxY - minY) * h};
    }
    
    // Enhanced landmark indices for better accuracy
    const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
    const RIGHT_EYE = [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382];
    const MOUTH = [61, 84, 17, 314, 405, 320, 307, 375, 321, 308, 324, 318, 
                   78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 
                   310, 311, 312, 13, 82, 81, 80, 291];
    
    try {
      const leftEyePoints = LEFT_EYE.map(i => lm[i]).filter(p => p);
      const rightEyePoints = RIGHT_EYE.map(i => lm[i]).filter(p => p);
      const mouthPoints = MOUTH.map(i => lm[i]).filter(p => p);
      
      if (leftEyePoints.length < 8 || rightEyePoints.length < 8 || mouthPoints.length < 8) {
        console.warn('[autoRegions] Insufficient landmark points for regions');
        return null;
      }
      
      const left = bbox(leftEyePoints);
      const right = bbox(rightEyePoints);
      const mouth = bbox(mouthPoints);
      
      if (!left || !right || !mouth) {
        console.warn('[autoRegions] Failed to calculate bounding boxes');
        return null;
      }
      
      function expand(r, f) {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const rx = Math.max(r.w * f / 2, 20); // Minimum size
        const ry = Math.max(r.h * f / 2, 20);
        return {
          x: Math.max(0, cx - rx),
          y: Math.max(0, cy - ry),
          w: Math.min(rx * 2, w),
          h: Math.min(ry * 2, h),
          cx, cy, rx, ry
        };
      }
      
      const result = {
        leftEye: expand(left, PAD.eye),
        rightEye: expand(right, PAD.eye),
        mouth: expand(mouth, PAD.mouth)
      };
      
      // Validate regions are reasonable
      if (validateRegions(result, w, h)) {
        console.log('[autoRegions] MediaPipe regions validated successfully');
        return result;
      } else {
        console.warn('[autoRegions] MediaPipe regions failed validation');
        return null;
      }
      
    } catch (error) {
      console.error('[autoRegions] Error processing landmarks:', error);
      return null;
    }
  }

  function validateRegions(regions, w, h) {
    try {
      const { leftEye, rightEye, mouth } = regions;
      
      // Check if regions exist and have reasonable dimensions
      if (!leftEye || !rightEye || !mouth) return false;
      
      // Eyes should be in upper half of image
      if (leftEye.cy > h * 0.7 || rightEye.cy > h * 0.7) return false;
      
      // Mouth should be in lower half of image  
      if (mouth.cy < h * 0.4) return false;
      
      // Left eye should be to the left of right eye
      if (leftEye.cx >= rightEye.cx) return false;
      
      // Eyes should be roughly at same height (within 30% of image height)
      if (Math.abs(leftEye.cy - rightEye.cy) > h * 0.3) return false;
      
      // Regions should have reasonable sizes (not too small or too large)
      const minSize = Math.min(w, h) * 0.05;
      const maxSize = Math.min(w, h) * 0.4;
      
      for (const region of [leftEye, rightEye, mouth]) {
        if (region.w < minSize || region.h < minSize || 
            region.w > maxSize || region.h > maxSize) {
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error('[autoRegions] Validation error:', error);
      return false;
    }
  }

  function detectCartoonFeatures(canvas) {
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d');
    
    try {
      const data = ctx.getImageData(0, 0, w, h).data;
      
      // Enhanced feature detection with multiple approaches
      const features = {
        darkRegions: [],
        lightRegions: [],
        colorRegions: [],
        edgeRegions: []
      };
      
      // Multi-pass analysis
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = (y * w + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];
          
          if (a < 128) continue; // Skip transparent pixels
          
          const hsv = rgb2hsv(r, g, b);
          const gray = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          
          // Classify pixels
          if (gray < 0.3) {
            features.darkRegions.push({x, y, intensity: 1 - gray});
          } else if (hsv.s < 0.2 && hsv.v > 0.8) {
            features.lightRegions.push({x, y, intensity: hsv.v});
          } else if (hsv.s > 0.4) {
            features.colorRegions.push({x, y, hue: hsv.h, sat: hsv.s, val: hsv.v});
          }
          
          // Edge detection
          const edgeStrength = calculateEdgeStrength(data, x, y, w, h);
          if (edgeStrength > 0.3) {
            features.edgeRegions.push({x, y, strength: edgeStrength});
          }
        }
      }
      
      // Try multiple detection strategies
      let result = null;
      
      // Strategy 1: Dark/light region clustering
      if (features.darkRegions.length >= 20 && features.lightRegions.length >= 20) {
        result = detectFromDarkLight(features.darkRegions, features.lightRegions, w, h);
        if (result && validateRegions(result, w, h)) {
          console.log('[autoRegions] Dark/light detection successful');
          return result;
        }
      }
      
      // Strategy 2: Color-based detection
      if (features.colorRegions.length >= 30) {
        result = detectFromColor(features.colorRegions, w, h);
        if (result && validateRegions(result, w, h)) {
          console.log('[autoRegions] Color-based detection successful');
          return result;
        }
      }
      
      // Strategy 3: Edge-based detection
      if (features.edgeRegions.length >= 50) {
        result = detectFromEdges(features.edgeRegions, w, h);
        if (result && validateRegions(result, w, h)) {
          console.log('[autoRegions] Edge-based detection successful');
          return result;
        }
      }
      
      // Strategy 4: Fallback to default positions
      console.log('[autoRegions] Falling back to default positions');
      return getDefaultRegions(w, h);
      
    } catch (error) {
      console.error('[autoRegions] Cartoon detection error:', error);
      return getDefaultRegions(w, h);
    }
  }

  function calculateEdgeStrength(data, x, y, w, h) {
    const idx = (y * w + x) * 4;
    const gray = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) / 255;
    
    let gradientMagnitude = 0;
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];
    
    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const nIdx = (ny * w + nx) * 4;
        const nGray = (0.299 * data[nIdx] + 0.587 * data[nIdx + 1] + 0.114 * data[nIdx + 2]) / 255;
        gradientMagnitude += Math.abs(gray - nGray);
      }
    }
    
    return gradientMagnitude / 8;
  }

  function detectFromDarkLight(darkRegions, lightRegions, w, h) {
    const allPoints = [...darkRegions, ...lightRegions];
    const eyeClusters = improvedKMeans(allPoints, 2, w, h);
    
    if (eyeClusters.length < 2) return null;
    
    const [left, right] = eyeClusters.sort((a, b) => a.centerX - b.centerX);
    const mouthRegion = findMouthRegion(darkRegions, left, right, w, h);
    
    return {
      leftEye: createRegion(left, w, h, 'eye'),
      rightEye: createRegion(right, w, h, 'eye'),
      mouth: mouthRegion
    };
  }

  function detectFromColor(colorRegions, w, h) {
    // Group by similar hues
    const hueGroups = groupByHue(colorRegions);
    const clusters = [];
    
    for (const group of hueGroups) {
      if (group.length >= 10) {
        const cluster = calculateClusterCenter(group);
        clusters.push(cluster);
      }
    }
    
    if (clusters.length < 2) return null;
    
    // Find eye and mouth regions
    const eyeRegions = clusters.filter(c => c.centerY < h * 0.6).slice(0, 2);
    const mouthRegions = clusters.filter(c => c.centerY > h * 0.5);
    
    if (eyeRegions.length < 2 || mouthRegions.length < 1) return null;
    
    eyeRegions.sort((a, b) => a.centerX - b.centerX);
    
    return {
      leftEye: createRegion(eyeRegions[0], w, h, 'eye'),
      rightEye: createRegion(eyeRegions[1], w, h, 'eye'),
      mouth: createRegion(mouthRegions[0], w, h, 'mouth')
    };
  }

  function detectFromEdges(edgeRegions, w, h) {
    const clusters = improvedKMeans(edgeRegions, 3, w, h);
    
    if (clusters.length < 3) return null;
    
    // Sort by Y position to separate eyes from mouth
    clusters.sort((a, b) => a.centerY - b.centerY);
    
    const eyeCandidates = clusters.filter(c => c.centerY < h * 0.6);
    const mouthCandidates = clusters.filter(c => c.centerY > h * 0.4);
    
    if (eyeCandidates.length < 2 || mouthCandidates.length < 1) return null;
    
    eyeCandidates.sort((a, b) => a.centerX - b.centerX);
    
    return {
      leftEye: createRegion(eyeCandidates[0], w, h, 'eye'),
      rightEye: createRegion(eyeCandidates[1], w, h, 'eye'),
      mouth: createRegion(mouthCandidates[0], w, h, 'mouth')
    };
  }

  function improvedKMeans(points, k, w, h) {
    if (points.length < k) return [];
    
    const centroids = [];
    for (let i = 0; i < k; i++) {
      const idx = Math.floor(points.length * (i + 0.5) / k);
      centroids.push({x: points[idx].x, y: points[idx].y});
    }
    
    let changed = true;
    let iterations = 0;
    const maxIterations = 10;
    
    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;
      
      const clusters = new Array(k).fill(0).map(() => []);
      
      // Assign points to nearest centroid
      points.forEach(point => {
        let bestCluster = 0;
        let bestDistance = Infinity;
        
        for (let i = 0; i < k; i++) {
          const dx = point.x - centroids[i].x;
          const dy = (point.y - centroids[i].y) * 0.7; // Slight Y bias
          const distance = dx * dx + dy * dy;
          
          if (distance < bestDistance) {
            bestDistance = distance;
            bestCluster = i;
          }
        }
        
        clusters[bestCluster].push(point);
      });
      
      // Update centroids
      for (let i = 0; i < k; i++) {
        if (clusters[i].length > 0) {
          const newX = clusters[i].reduce((sum, p) => sum + p.x, 0) / clusters[i].length;
          const newY = clusters[i].reduce((sum, p) => sum + p.y, 0) / clusters[i].length;
          
          if (Math.abs(newX - centroids[i].x) > 1 || Math.abs(newY - centroids[i].y) > 1) {
            centroids[i] = {x: newX, y: newY};
            changed = true;
          }
        }
      }
    }
    
    // Convert to regions
    return centroids.map((centroid, i) => {
      const clusterPoints = points.filter(point => {
        let bestCluster = 0;
        let bestDistance = Infinity;
        
        for (let j = 0; j < k; j++) {
          const dx = point.x - centroids[j].x;
          const dy = (point.y - centroids[j].y) * 0.7;
          const distance = dx * dx + dy * dy;
          
          if (distance < bestDistance) {
            bestDistance = distance;
            bestCluster = j;
          }
        }
        
        return bestCluster === i;
      });
      
      return calculateClusterCenter(clusterPoints);
    }).filter(cluster => cluster.pointCount > 5);
  }

  function groupByHue(colorRegions) {
    const groups = [];
    const hueThreshold = 0.1;
    
    for (const region of colorRegions) {
      let foundGroup = false;
      
      for (const group of groups) {
        const avgHue = group.reduce((sum, p) => sum + p.hue, 0) / group.length;
        if (Math.abs(region.hue - avgHue) < hueThreshold) {
          group.push(region);
          foundGroup = true;
          break;
        }
      }
      
      if (!foundGroup) {
        groups.push([region]);
      }
    }
    
    return groups;
  }

  function calculateClusterCenter(points) {
    if (points.length === 0) return null;
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    
    return {
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      width: maxX - minX,
      height: maxY - minY,
      pointCount: points.length
    };
  }

  function findMouthRegion(darkRegions, leftEye, rightEye, w, h) {
    const eyeY = (leftEye.centerY + rightEye.centerY) / 2;
    const mouthCandidates = darkRegions.filter(p => p.y > eyeY + h * 0.1 && p.y < h * 0.9);
    
    if (mouthCandidates.length < 5) {
      return getDefaultRegions(w, h).mouth;
    }
    
    const mouthCluster = calculateClusterCenter(mouthCandidates);
    return createRegion(mouthCluster, w, h, 'mouth');
  }

  function createRegion(cluster, w, h, type) {
    const padding = type === 'eye' ? PAD.eye : PAD.mouth;
    const minSize = Math.min(w, h) * (type === 'eye' ? 0.08 : 0.12);
    
    const width = Math.max(cluster.width * padding, minSize);
    const height = Math.max(cluster.height * padding, minSize);
    
    const cx = cluster.centerX;
    const cy = cluster.centerY;
    const rx = width / 2;
    const ry = height / 2;
    
    return {
      x: Math.max(0, cx - rx),
      y: Math.max(0, cy - ry),
      w: Math.min(width, w),
      h: Math.min(height, h),
      cx, cy, rx, ry
    };
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

  window.AutoRegions = {
    fromLandmarks,
    detectCartoonFeatures,
    validateRegions
  };
})();
