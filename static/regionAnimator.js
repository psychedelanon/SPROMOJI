(function () {
  const BLINK_THRESHOLD = 0.17;  // EAR below this → eye closed
  const MOUTH_OPEN_THR  = 0.35;  // openness above this → mouth open (Pepe mouths often small)
  const DEBUG_MOUTH = false;

  let r = null;  // cached regions + images

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

  // Use outer-lip pair 12 / 15 (upper/lower) – gives bigger delta
  function computeMouthOpenness(lm) {
    const v = Math.hypot(lm[12].x - lm[15].x, lm[12].y - lm[15].y);
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

    /** draw one frame */
    animate(ctx, lm) {
      if (!r) return;

      const roll   = computeRoll(lm);
      const yaw    = computeYaw(lm);
      const earL   = computeEAR(lm, 159, 145, 33, 133);
      const earR   = computeEAR(lm, 386, 374, 362, 263);
      const mouthO = computeMouthOpenness(lm);
      
      if (DEBUG_MOUTH) console.debug('mouth ratio', mouthO.toFixed(2));

      // 1. base avatar (optionally with slight tilt)
      ctx.save();
      ctx.clearRect(0,0,r.canvasW,r.canvasH);
      ctx.translate(r.canvasW/2, r.canvasH/2);
      ctx.rotate(roll * 0.3 + yaw * 0.2);
      ctx.translate((Math.random()-0.5)*2, (Math.random()-0.5)*2);
      ctx.translate(-r.canvasW/2, -r.canvasH/2);
      ctx.drawImage(r.baseImg, 0, 0, r.canvasW, r.canvasH);
      ctx.restore();

      // draw helpers
      ctx.imageSmoothingEnabled = true;

      /********* LEFT EYE *********/
      ctx.save();
      const le = r.regs.leftEye;
      ctx.translate(le.x + le.w/2, le.y + le.h/2);

      // tiny parallax shift with roll
      ctx.translate( roll * 5, 0 );

      const blinkL = earL < BLINK_THRESHOLD ? 0 : 1;
      ctx.globalAlpha = blinkL;
      ctx.drawImage(r.leftEyeImg, -le.w/2, -le.h/2, le.w, le.h);
      ctx.globalAlpha = 1;
      ctx.restore();

      /********* RIGHT EYE *********/
      ctx.save();
      const re = r.regs.rightEye;
      ctx.translate(re.x + re.w/2, re.y + re.h/2);
      ctx.translate( roll * -5, 0 );
      const blinkR = earR < BLINK_THRESHOLD ? 0 : 1;
      ctx.globalAlpha = blinkR;
      ctx.drawImage(r.rightEyeImg, -re.w/2, -re.h/2, re.w, re.h);
      ctx.globalAlpha = 1;
      ctx.restore();

      /********* MOUTH *********/
      ctx.save();
      const mo = r.regs.mouth;
      ctx.translate(mo.x + mo.w/2, mo.y + mo.h/2);
      // drop mouth slightly when open
      const openF = Math.min(Math.max((mouthO - MOUTH_OPEN_THR) * 4, 0), 1); // 0→1
      ctx.translate(0, openF * mo.h * 0.15);       // drop 15 % of h
      ctx.scale(1, 1 + openF * 0.25);              // up to 25 % taller
      ctx.drawImage(r.mouthImg, -mo.w/2, -mo.h/2, mo.w, mo.h);
      ctx.restore();
    }
  };
})(); 