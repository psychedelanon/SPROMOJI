(function () {
  const BLINK_THRESHOLD = 0.17;  // EAR below this → eye closed
  const MOUTH_OPEN_THR  = 0.35;  // openness above this → mouth open (Pepe mouths often small)
  const SHAPE_SMOOTHING = 0.3;   // smoothing for eye/mouth shape scaling
  const MOVE_SMOOTHING  = 0.4;   // smoothing for eye/mouth translation
  const ORIENT_SMOOTHING = 0.3;  // smoothing for pitch/yaw
  const DEBUG_MOUTH = false;

  let r = null;  // cached regions + images

  const LEFT_EYE_IDX  = [33, 7, 163, 144, 145, 153, 154, 155, 133];
  const RIGHT_EYE_IDX = [362, 382, 381, 380, 374, 373, 390, 249, 263];
  const MOUTH_IDX     = [61, 291, 78, 308, 12, 15, 13, 14];
  const LEFT_IRIS_C   = 468;  // iris center indices from MediaPipe
  const RIGHT_IRIS_C  = 473;

  let shapeBaseline = null;  // baseline feature sizes from first frame
  let posBaseline = null;    // baseline feature centers for movement
  let shapeState = {
    leX: 1, leY: 1,
    reX: 1, reY: 1,
    mX: 1,  mY: 1
  };
  let posState = { leX:0, leY:0, reX:0, reY:0, mX:0, mY:0 };
  let orientState = { yaw: 0, pitch: 0 };
  
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

  function computeYaw(lm) {
    const left = lm[33];
    const right = lm[263];
    const nose = lm[1];
    const cx = (left.x + right.x) / 2;
    const w = right.x - left.x;
    return (nose.x - cx) / w;
  }

  function computePitch(lm) {
    const top = lm[10].y;
    const bottom = lm[152].y;
    const nose = lm[1].y;
    const faceH = bottom - top;
    return ((nose - top) / faceH) - 0.5;
  }

  // Use outer-lip pair 12 / 15 (upper/lower) – gives bigger delta
  function computeMouthOpenness(lm) {
    const v = Math.hypot(lm[12].x - lm[15].x, lm[12].y - lm[15].y);  // outer lips
    const h = Math.hypot(lm[61].x - lm[291].x, lm[61].y - lm[291].y);  // mouth width
    return v / h;
  }

  function bbox(lm, idxs){
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    idxs.forEach(i=>{
      const p = lm[i];
      if (p.x<minX) minX=p.x;
      if (p.x>maxX) maxX=p.x;
      if (p.y<minY) minY=p.y;
      if (p.y>maxY) maxY=p.y;
    });
    return {w:maxX-minX, h:maxY-minY, cx:(minX+maxX)/2, cy:(minY+maxY)/2};
  }

  function center(lm, idx){
    return {x: lm[idx].x, y: lm[idx].y};
  }

  function updateShape(lm){
    if(!shapeBaseline){
      shapeBaseline = {
        le: bbox(lm, LEFT_EYE_IDX),
        re: bbox(lm, RIGHT_EYE_IDX),
        mo: bbox(lm, MOUTH_IDX)
      };
      posBaseline = {
        le: center(lm, LEFT_IRIS_C),
        re: center(lm, RIGHT_IRIS_C),
        mo: {x: shapeBaseline.mo.cx, y: shapeBaseline.mo.cy}
      };
    }

    const clamp = (v,mi,ma)=>Math.min(ma,Math.max(mi,v));
    const lerp = (a,b,t)=>a*(1-t)+b*t;

    const leBox = bbox(lm, LEFT_EYE_IDX);
    const reBox = bbox(lm, RIGHT_EYE_IDX);
    const moBox = bbox(lm, MOUTH_IDX);

    const tLeX = clamp(leBox.w/shapeBaseline.le.w, 0.5, 1.5);
    const tLeY = clamp(leBox.h/shapeBaseline.le.h, 0.5, 1.5);
    const tReX = clamp(reBox.w/shapeBaseline.re.w, 0.5, 1.5);
    const tReY = clamp(reBox.h/shapeBaseline.re.h, 0.5, 1.5);
    const tMoX = clamp(moBox.w/shapeBaseline.mo.w, 0.8, 1.5);
    const tMoY = clamp(moBox.h/shapeBaseline.mo.h, 0.8, 1.6);

    shapeState.leX = lerp(shapeState.leX, tLeX, SHAPE_SMOOTHING);
    shapeState.leY = lerp(shapeState.leY, tLeY, SHAPE_SMOOTHING);
    shapeState.reX = lerp(shapeState.reX, tReX, SHAPE_SMOOTHING);
    shapeState.reY = lerp(shapeState.reY, tReY, SHAPE_SMOOTHING);
    shapeState.mX  = lerp(shapeState.mX,  tMoX, SHAPE_SMOOTHING);
    shapeState.mY  = lerp(shapeState.mY,  tMoY, SHAPE_SMOOTHING);

    const leC = center(lm, LEFT_IRIS_C);
    const reC = center(lm, RIGHT_IRIS_C);
    const moC = {x: moBox.cx, y: moBox.cy};

    const lePX = clamp((leC.x - posBaseline.le.x) / shapeBaseline.le.w * 2, -1, 1);
    const lePY = clamp((leC.y - posBaseline.le.y) / shapeBaseline.le.h * 2, -1, 1);
    const rePX = clamp((reC.x - posBaseline.re.x) / shapeBaseline.re.w * 2, -1, 1);
    const rePY = clamp((reC.y - posBaseline.re.y) / shapeBaseline.re.h * 2, -1, 1);
    const moPX = clamp((moC.x - posBaseline.mo.x) / shapeBaseline.mo.w, -0.5, 0.5);
    const moPY = clamp((moC.y - posBaseline.mo.y) / shapeBaseline.mo.h, -0.5, 0.5);

    posState.leX = lerp(posState.leX, lePX, MOVE_SMOOTHING);
    posState.leY = lerp(posState.leY, lePY, MOVE_SMOOTHING);
    posState.reX = lerp(posState.reX, rePX, MOVE_SMOOTHING);
    posState.reY = lerp(posState.reY, rePY, MOVE_SMOOTHING);
    posState.mX  = lerp(posState.mX,  moPX, MOVE_SMOOTHING);
    posState.mY  = lerp(posState.mY,  moPY, MOVE_SMOOTHING);
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
      shapeBaseline = null;
      posBaseline = null;
      shapeState = { leX:1, leY:1, reX:1, reY:1, mX:1, mY:1 };
      posState = { leX:0, leY:0, reX:0, reY:0, mX:0, mY:0 };
      orientState = { yaw:0, pitch:0 };
      r = null;
      console.debug('[RegionAnimator] State reset');
    },

    /** draw one frame using stored animation state - optimized for smoothness */
    animate(ctx, landmarks = null) {
      if (!r) return;

      // Use landmarks if provided (real-time mode), otherwise use stored animation state
      let roll = 0, yaw = 0, pitch = 0, earL = 1, earR = 1, mouthO = 0;
      
      if (landmarks && landmarks.length > 0) {
        // Real-time MediaPipe mode
        roll = computeRoll(landmarks);
        yaw = computeYaw(landmarks);
        pitch = computePitch(landmarks);
        earL = computeEAR(landmarks, 159, 145, 33, 133);
        earR = computeEAR(landmarks, 386, 374, 362, 263);
        mouthO = computeMouthOpenness(landmarks);

        updateShape(landmarks);
        orientState.yaw = orientState.yaw * (1 - ORIENT_SMOOTHING) + yaw * ORIENT_SMOOTHING;
        orientState.pitch = orientState.pitch * (1 - ORIENT_SMOOTHING) + pitch * ORIENT_SMOOTHING;

        if (DEBUG_MOUTH) console.debug('mouth ratio', mouthO.toFixed(2));
      }

      // 1. base avatar with global tilt - smooth drawing
      ctx.save();
      ctx.clearRect(0, 0, r.canvasW, r.canvasH);
      ctx.translate(r.canvasW/2, r.canvasH/2);
      
      if (landmarks) {
        // Real-time mode: use computed values
        ctx.rotate(roll * 0.3 + yaw * 0.2);
        ctx.translate((Math.random()-0.5)*2, (Math.random()-0.5)*2);
      } else {
        // AI-driven mode: use stored animation state
        ctx.rotate(animState.globalTilt * 0.3);
      }
      
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

      if (landmarks) {
        const clamp = (v,mi,ma)=>Math.min(ma,Math.max(mi,v));
        ctx.translate(roll * 5, 0);
        ctx.translate(posState.leX * le.w * 0.2, posState.leY * le.h * 0.2);
        ctx.translate(-orientState.yaw * le.w * 0.2, orientState.pitch * le.h * 0.1);
        const blinkL = Math.min(1, Math.max(0, earL / BLINK_THRESHOLD));
        const yawScale = clamp(1 - orientState.yaw * 0.4, 0.6, 1.4);
        const pitchScale = 1 + orientState.pitch * 0.2;
        ctx.scale(shapeState.leX * yawScale, shapeState.leY * blinkL * pitchScale);
      } else {
        // AI-driven mode: use stored animation state
        ctx.translate(animState.globalTilt * 5, 0);
        ctx.scale(1, animState.eyeScaleLeft);
      }
      ctx.beginPath();
      ctx.ellipse(0, 0, le.w / 2, le.h / 2, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(r.leftEyeImg, -le.w/2, -le.h/2, le.w, le.h);
      ctx.globalAlpha = 1;
      ctx.restore();

      /********* RIGHT EYE *********/
      ctx.save();
      const re = r.regs.rightEye;
      ctx.translate(re.x + re.w/2, re.y + re.h/2);

      if (landmarks) {
        const clamp = (v,mi,ma)=>Math.min(ma,Math.max(mi,v));
        ctx.translate(roll * -5, 0);
        ctx.translate(posState.reX * re.w * 0.2, posState.reY * re.h * 0.2);
        ctx.translate(-orientState.yaw * re.w * 0.2, orientState.pitch * re.h * 0.1);
        const blinkR = Math.min(1, Math.max(0, earR / BLINK_THRESHOLD));
        const yawScale = clamp(1 + orientState.yaw * 0.4, 0.6, 1.4);
        const pitchScale = 1 + orientState.pitch * 0.2;
        ctx.scale(shapeState.reX * yawScale, shapeState.reY * blinkR * pitchScale);
      } else {
        // AI-driven mode: use stored animation state
        ctx.translate(animState.globalTilt * -5, 0);
        ctx.scale(1, animState.eyeScaleRight);
      }

      ctx.beginPath();
      ctx.ellipse(0, 0, re.w / 2, re.h / 2, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(r.rightEyeImg, -re.w/2, -re.h/2, re.w, re.h);
      ctx.globalAlpha = 1;
      ctx.restore();

      /********* MOUTH *********/
      ctx.save();
      const mo = r.regs.mouth;
      ctx.translate(mo.x + mo.w/2, mo.y + mo.h/2);

      if (landmarks) {
        const clamp = (v,mi,ma)=>Math.min(ma,Math.max(mi,v));
        ctx.translate(posState.mX * mo.w * 0.3, posState.mY * mo.h * 0.3);
        ctx.translate(orientState.yaw * mo.w * 0.3, orientState.pitch * mo.h * 0.2);
        ctx.translate(0, (shapeState.mY - 1) * mo.h * 0.15);
        const yawScale = clamp(1 + orientState.yaw * 0.2, 0.7, 1.3);
        const pitchScale = 1 + orientState.pitch * 0.2;
        ctx.scale(shapeState.mX * yawScale, shapeState.mY * pitchScale);
      } else {
        // AI-driven mode: use stored mouth scale
        const mouthOpenF = (animState.mouthScale - 1.0) / 0.3; // 0→1
        ctx.translate(0, mouthOpenF * mo.h * 0.15);
        ctx.scale(1, animState.mouthScale);
      }

      ctx.beginPath();
      ctx.ellipse(0, 0, mo.w / 2, mo.h / 2, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(r.mouthImg, -mo.w/2, -mo.h/2, mo.w, mo.h);
      ctx.restore();
    }
  };
})(); 
