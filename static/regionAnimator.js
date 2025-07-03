(function () {
  const POS_SMOOTH = 0.75;
  const BLEND_SMOOTH = 0.85;
  const ROT_SMOOTH = 0.80;
  const DEPTH_OFFSET = 2; // px for fake volume

  let ctx = null;
  let avatarImg = null;
  let rig = null;
  let vertices = [];
  let triangles = [];
  let blendState = {};
  let orientState = { yaw:0, pitch:0 };

  function lerp(a,b,t){ return a*(1-t)+b*t; }

  async function loadRig(url){
    const res = await fetch(url);
    rig = await res.json();
    vertices = rig.vertices.map(v=>({
      id:v.id,
      u:v.u,
      v:v.v,
      baseX:0,
      baseY:0,
      x:0,
      y:0,
      weights:v.weights||{}
    }));
    triangles = rig.triangles;
  }

  function applyBlend(blend){
    for(const k in blend){
      blendState[k] = blendState[k]===undefined ? blend[k] : lerp(blendState[k], blend[k], BLEND_SMOOTH);
    }
  }

  function updateVertices(){
    if(!avatarImg) return;
    vertices.forEach(v=>{
      const baseX = v.u * avatarImg.width;
      const baseY = v.v * avatarImg.height;
      let dx = 0, dy = 0;
      for(const [k,w] of Object.entries(v.weights)){
        dx += (blendState[k]||0) * w;
      }
      v.x = lerp(v.x, baseX + dx + orientState.yaw*4, POS_SMOOTH);
      v.y = lerp(v.y, baseY + dy + orientState.pitch*4, POS_SMOOTH);
    });
  }

  function drawTriangle(t){
    const v0 = vertices[t[0]];
    const v1 = vertices[t[1]];
    const v2 = vertices[t[2]];
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(v0.x, v0.y);
    ctx.lineTo(v1.x, v1.y);
    ctx.lineTo(v2.x, v2.y);
    ctx.closePath();
    ctx.clip();
    const u0 = v0.u*avatarImg.width;
    const v0y = v0.v*avatarImg.height;
    const u1 = v1.u*avatarImg.width;
    const v1y = v1.v*avatarImg.height;
    const u2 = v2.u*avatarImg.width;
    const v2y = v2.v*avatarImg.height;
    const denom = (u1-u0)*(v2y-v0y)-(u2-u0)*(v1y-v0y);
    if(denom===0){ ctx.restore(); return; }
    const m11 = (v1.x-v0.x)*(v2y-v0y)-(v2.x-v0.x)*(v1y-v0y);
    const m12 = (v1.y-v0.y)*(v2y-v0y)-(v2.y-v0.y)*(v1y-v0y);
    const m21 = (v2.x-v0.x)*(u1-u0)-(v1.x-v0.x)*(u2-u0);
    const m22 = (v2.y-v0.y)*(u1-u0)-(v1.y-v0.y)*(u2-u0);
    const dx = v0.x - m11*u0 - m21*v0y;
    const dy = v0.y - m12*u0 - m22*v0y;
    ctx.setTransform(m11, m12, m21, m22, dx, dy);
    ctx.drawImage(avatarImg,0,0);
    ctx.restore();
  }

  function render(){
    if(!ctx) return;
    ctx.clearRect(0,0,ctx.canvas.width, ctx.canvas.height);
    ctx.save();
    ctx.translate(0,0);
    triangles.forEach(t=>drawTriangle(t));
    ctx.restore();

    // fake depth layer
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.translate(-DEPTH_OFFSET*orientState.yaw, -DEPTH_OFFSET*orientState.pitch);
    triangles.forEach(t=>drawTriangle(t));
    ctx.restore();
  }

  window.RegionAnimator = {
    async init(context, img){
      ctx = context;
      avatarImg = img;
      await loadRig('/static/avatarRig.json');
      updateVertices();
      render();
    },
    reset(){
      blendState = {};
      orientState = {yaw:0,pitch:0};
    },
    update(blend, landmarks){
      if(!rig) return;
      applyBlend(blend);
      if(landmarks){
        const yaw = (landmarks[1].x - ((landmarks[33].x+landmarks[263].x)/2)) / (landmarks[263].x - landmarks[33].x);
        const top = landmarks[10].y;
        const bottom = landmarks[152].y;
        const nose = landmarks[1].y;
        const pitch = ((nose-top)/(bottom-top))-0.5;
        orientState.yaw = lerp(orientState.yaw, yaw, ROT_SMOOTH);
        orientState.pitch = lerp(orientState.pitch, pitch, ROT_SMOOTH);
      }
      updateVertices();
      render();
    }
  };
})();
