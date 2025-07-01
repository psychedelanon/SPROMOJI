(function () {
  const BLINK_THRESHOLD = 0.2;   // EAR below this → eye closed
  const MOUTH_OPEN_THR  = 0.35;  // openness above this → mouth open (Pepe mouths often small)
  const DEBUG_MOUTH = false;

  let r = null;  // cached regions + images
  
  // AI-driven animation state
  let animState = {
    eyeScaleLeft: 1.0,
    eyeScaleRight: 1.0, 
    mouthScale: 1.0,
    globalTilt: 0.0
  };

  function cropRegion(img, reg) {
    const c = document.createElement('canvas');
    c.width = reg.w; c.height = reg.h;
    c.getContext('2d').drawImage(img, reg.x, reg.y, reg.w, reg.h, 0, 0, reg.w, reg.h);
    return c;
  }

  function computeEAR(lm, idxTop, idxBot, idxLeft, idxRight) {
    const vDist = Math.hypot(lm[idxTop].x - lm[idxBot].x, lm[idxTop].y - lm[idxBot].y);
    const hDist = Math.hypot(lm[idxLeft].x - lm[idxRight].x, lm[idxLeft].y - lm[idxRight].y);
    return vDist / hDist;
  }

  function computeRoll(lm) {
    const dy = lm[263].y - lm[33].y;
    const dx = lm[263].x - lm[33].x;
    return Math.atan2(dy, dx);
  }

  // Use outer-lip pair 12 / 15 (upper/lower) – gives bigger delta
  function computeMouthOpenness(lm) {
    const v = Math.hypot(lm[12].x - lm[15].x, lm[12].y - lm[15].y);  // outer lips
    const h = Math.hypot(lm[61].x - lm[291].x, lm[61].y - lm[291].y);  // mouth width
    return v / h;
  }

  window.RegionAnimator = {
    /** cache feature bitmaps & rects */
    init(ctx, regions, avatarImg) {
      r = {
        baseImg: avatarImg,
        leftEyeImg:  cropRegion(avatarImg, regions.leftEye),
        rightEyeImg: cropRegion(avatarImg, regions.rightEye),
        mouthImg:    cropRegion(avatarImg, regions.mouth),
        regs: regions,
        canvasW: ctx.canvas.width,
        canvasH: ctx.canvas.height
      };
      
      console.debug('[RegionAnimator] init OK', r);
    },

    /** AI-driven setters */
    setEyeScaleY(val, right = false) {
      if (right) {
        animState.eyeScaleRight = Math.max(0.1, Math.min(val, 1.0));
      } else {
        animState.eyeScaleLeft = Math.max(0.1, Math.min(val, 1.0));
      }
    },
    
    setMouthScale(val) {
      animState.mouthScale = Math.max(1.0, Math.min(val, 1.3));
    },
    
    setGlobalTilt(rad) {
      animState.globalTilt = Math.max(-Math.PI/8, Math.min(rad, Math.PI/8));
    },
    
    /** Reset animation state */
    reset() {
      animState.eyeScaleLeft = 1.0;
      animState.eyeScaleRight = 1.0;
      animState.mouthScale = 1.0;
      animState.globalTilt = 0.0;
      r = null;
      console.debug('[RegionAnimator] State reset');
    },

    /** draw one frame using stored animation state - optimized for smoothness */
    animate(ctx) {
      if (!r) return;

      // 1. base avatar with global tilt - smooth drawing
      ctx.save();
      ctx.clearRect(0, 0, r.canvasW, r.canvasH);
      ctx.translate(r.canvasW/2, r.canvasH/2);
      ctx.rotate(animState.globalTilt * 0.3);    // use stored tilt
      ctx.translate(-r.canvasW/2, -r.canvasH/2);
      ctx.drawImage(r.baseImg, 0, 0, r.canvasW, r.canvasH);
      ctx.restore();
      
      // Theme effects should be UI-only, not overlaid on avatar
      // Removed viral effects overlay to keep avatar clean

      // draw helpers
      ctx.imageSmoothingEnabled = true;

      /********* LEFT EYE *********/
      ctx.save();
      const le = r.regs.leftEye;
      ctx.translate(le.x + le.w/2, le.y + le.h/2);
      
      // tiny parallax shift with tilt
      ctx.translate(animState.globalTilt * 5, 0);
      
      // use stored eye scale
      ctx.scale(1, animState.eyeScaleLeft);
      ctx.drawImage(r.leftEyeImg, -le.w/2, -le.h/2, le.w, le.h);
      ctx.restore();

      /********* RIGHT EYE *********/
      ctx.save();
      const re = r.regs.rightEye;
      ctx.translate(re.x + re.w/2, re.y + re.h/2);
      ctx.translate(animState.globalTilt * -5, 0);
      ctx.scale(1, animState.eyeScaleRight);
      ctx.drawImage(r.rightEyeImg, -re.w/2, -re.h/2, re.w, re.h);
      ctx.restore();

      /********* MOUTH *********/
      ctx.save();
      const mo = r.regs.mouth;
      ctx.translate(mo.x + mo.w/2, mo.y + mo.h/2);
      
      // use stored mouth scale
      const mouthOpenF = (animState.mouthScale - 1.0) / 0.3; // 0→1
      ctx.translate(0, mouthOpenF * mo.h * 0.15);   // drop when open
      ctx.scale(1, animState.mouthScale);           // scale up
      ctx.drawImage(r.mouthImg, -mo.w/2, -mo.h/2, mo.w, mo.h);
      ctx.restore();
    }
  };
})(); 