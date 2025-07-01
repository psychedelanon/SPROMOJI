// converts FaceMesh landmarks to {x,y,w,h} rects with padding
window.AutoRegions = (function () {
  const PAD = { eye: 1.2, mouth: 1.3 };

  function bbox(points, w, h) {
    let minX=1,minY=1,maxX=0,maxY=0;
    points.forEach(p=>{ minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
                        minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y); });
    return { x:minX*w, y:minY*h, w:(maxX-minX)*w, h:(maxY-minY)*h };
  }

  const L_EYE_IDXS  = [33,7,163,144,145,153,154,155,133];
  const R_EYE_IDXS  = [362,382,381,380,374,373,390,249,263];
  const MOUTH_IDXS  = [61,291,78,308,12,15,13,14];

  return function toRegions(lm, cw, ch) {
    const left  = bbox(L_EYE_IDXS.map(i=>lm[i]), cw, ch);
    const right = bbox(R_EYE_IDXS.map(i=>lm[i]), cw, ch);
    const mouth = bbox(MOUTH_IDXS.map(i=>lm[i]), cw, ch);
    return {
      leftEye:  expand(left , PAD.eye ),
      rightEye: expand(right, PAD.eye ),
      mouth:    expand(mouth, PAD.mouth)
    };
    function expand(r,f){ const cx=r.x+r.w/2, cy=r.y+r.h/2;
      return { x:cx-r.w*f/2, y:cy-r.h*f/2, w:r.w*f, h:r.h*f }; }
  };
})(); 