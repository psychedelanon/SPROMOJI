window.AIDriver = {
  driveFromBlend(blend, lm){
    const map = Object.fromEntries(blend.map(b=>[b.categoryName,b.score]));

    window.RegionAnimator.setMouthScale(1 + (map.mouthOpen||map.jawOpen||0)*0.35);
    window.RegionAnimator.setEyeScaleY(Math.max(0.1,1-(map.eyeBlinkLeft||0)));
    window.RegionAnimator.setEyeScaleY(Math.max(0.1,1-(map.eyeBlinkRight||0)), true);

    // mild head roll
    const roll = Math.atan2(lm[263].y-lm[33].y, lm[263].x-lm[33].x);
    window.RegionAnimator.setGlobalTilt(roll*0.4);
  }
}; 