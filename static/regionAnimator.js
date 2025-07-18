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
  let featureMeshes = null;
  let regionMode = false;
  let regionData = null;

  function lerp(a,b,t){ return a*(1-t)+b*t; }

  async function loadRig(url){
    try {
      console.log('[RegionAnimator] Loading rig from:', url);
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch rig: ${res.status}`);
      }
      rig = await res.json();
      console.log('[RegionAnimator] Rig loaded:', rig);
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
      console.log('[RegionAnimator] Mesh initialized with', vertices.length, 'vertices and', triangles.length, 'triangles');
    } catch (error) {
      console.error('[RegionAnimator] Failed to load rig:', error);
      throw error;
    }
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

  function deform(mesh, a=0, b=0){
    if(!mesh || !mesh.vertices) return;
    const amt = (a||0)+(b||0);
    mesh.vertices.forEach(v=>{
      v.y += amt * -2;
    });
  }

  function toFeature(r){
    if(!r) return null;
    return {
      cx: r.cx ?? r.centerX ?? (r.x + r.w/2),
      cy: r.cy ?? r.centerY ?? (r.y + r.h/2),
      rx: r.rx ?? r.radiusX ?? (r.w/2),
      ry: r.ry ?? r.radiusY ?? (r.h/2)
    };
  }

  function drawFeature(f, sx=1, sy=1){
    if(!f) return;
    ctx.save();
    const offX = orientState.yaw*4;
    const offY = orientState.pitch*4;
    ctx.translate(f.cx + offX, f.cy + offY);
    ctx.scale(sx, sy);
    ctx.beginPath();
    ctx.ellipse(0,0,f.rx,f.ry,0,0,Math.PI*2);
    ctx.clip();
    ctx.drawImage(avatarImg, -f.cx, -f.cy);
    ctx.restore();
  }

  function applyBlendshapes(bs){
    if(!featureMeshes) return;
    const blinkL = bs['eyeBlinkLeft']||0;
    const blinkR = bs['eyeBlinkRight']||0;
    const jaw    = bs['jawOpen']||0;
    const smile  = bs['mouthSmile']||0;

    deform(featureMeshes.L_EYE, blinkL);
    deform(featureMeshes.R_EYE, blinkR);
    deform(featureMeshes.MOUTH, jaw, smile);
  }

  function render(){
    if(!ctx) return;
    ctx.clearRect(0,0,ctx.canvas.width, ctx.canvas.height);

    if(regionMode){
      ctx.drawImage(avatarImg,0,0);
      const blinkL = blendState['eyeBlinkLeft']||0;
      const blinkR = blendState['eyeBlinkRight']||0;
      const jaw = blendState['jawOpen']||0;
      const smile = blendState['mouthSmile']||0;

      drawFeature(regionData.leftEye,1,Math.max(0.2,1-blinkL));
      drawFeature(regionData.rightEye,1,Math.max(0.2,1-blinkR));
      drawFeature(regionData.mouth,1,1+jaw*0.7+smile*0.3);
      return;
    }

    ctx.save();
    ctx.translate(0,0);
    triangles.forEach(t=>drawTriangle(t));
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.translate(-DEPTH_OFFSET*orientState.yaw, -DEPTH_OFFSET*orientState.pitch);
    triangles.forEach(t=>drawTriangle(t));
    ctx.restore();
  }

  function rigFromRegions(regions, img){
    const w = img.width;
    const h = img.height;
    const L = regions.leftEye;
    const R = regions.rightEye;
    const M = regions.mouth;
    function uv(x,y){ return {u:x/w, v:y/h}; }
    const verts = [
      {id:0, ...uv(L.x, L.y), weights:{eyeBlinkLeft:-5}},
      {id:1, ...uv(L.x+L.w, L.y), weights:{eyeBlinkLeft:-5}},
      {id:2, ...uv(R.x, R.y), weights:{eyeBlinkRight:-5}},
      {id:3, ...uv(R.x+R.w, R.y), weights:{eyeBlinkRight:-5}},
      {id:4, ...uv(M.x, M.y), weights:{jawOpen:8}},
      {id:5, ...uv(M.x+M.w, M.y), weights:{jawOpen:8}},
      {id:6, ...uv(M.x+M.w/2, M.y+M.h), weights:{jawOpen:8}},
      {id:7, ...uv((L.x+L.w/2+R.x+R.w/2)/2, Math.min(L.y,R.y)*0.9), weights:{browDownLeft:2,browDownRight:2}}
    ];
    const tris = [[0,1,4],[1,2,4],[2,5,4],[2,3,5],[4,5,6],[0,7,1],[3,7,2]];
    return {vertices:verts, triangles:tris};
  }

  window.RegionAnimator = {
    async init(context, img, regions=null, rigUrl='/static/avatarRig.json'){
      try {
        ctx = context;
        avatarImg = img;
        console.log('[RegionAnimator] Initializing mesh system...');
      if(regions){
          const custom = rigFromRegions(regions, img);
          rig = custom;
          vertices = custom.vertices.map(v=>({
            id:v.id,
            u:v.u,
            v:v.v,
            baseX:0,
            baseY:0,
            x:0,
            y:0,
            weights:v.weights||{}
          }));
          triangles = custom.triangles;
          featureMeshes = {
            L_EYE:{vertices:vertices.slice(0,2)},
            R_EYE:{vertices:vertices.slice(2,4)},
            MOUTH:{vertices:vertices.slice(4,7)}
          };
          regionMode = false;
          updateVertices();
        } else {
          regionMode = false;
          await loadRig(rigUrl);
          updateVertices();
        }
        render();
        console.log('[RegionAnimator] Mesh system initialized successfully!');
        return true;
      } catch (error) {
        console.error('[RegionAnimator] Mesh system failed to initialize:', error);
        if(window.rum && window.rum.trackError){
          window.rum.trackError(error);
        }
        const banner = document.getElementById('errorBanner');
        if(banner){
          banner.textContent = 'Rig load failed - using fallback';
          banner.style.display = 'block';
        }
        regionMode = true;
        const w = img.width, h = img.height;
        regionData = {
          leftEye: {cx:w*0.3, cy:h*0.35, rx:w*0.1, ry:h*0.1},
          rightEye:{cx:w*0.7, cy:h*0.35, rx:w*0.1, ry:h*0.1},
          mouth:   {cx:w*0.5, cy:h*0.7,  rx:w*0.25, ry:h*0.15}
        };
        rig = null;
        render();
        return false;
      }
    },
    setMeshes(meshes){
      featureMeshes = meshes;
    },
    reset(){
      blendState = {};
      orientState = {yaw:0,pitch:0};
      regionData = null;
      regionMode = false;
      },
    update(blend, landmarks){
      if(regionMode){
        Object.assign(blendState, blend);
      } else {
        if(!rig) return;
        applyBlend(blend);
        applyBlendshapes(blend);
      }
      if(landmarks){
        const yaw = (landmarks[1].x - ((landmarks[33].x+landmarks[263].x)/2)) / (landmarks[263].x - landmarks[33].x);
        const top = landmarks[10].y;
        const bottom = landmarks[152].y;
        const nose = landmarks[1].y;
        const pitch = ((nose-top)/(bottom-top))-0.5;
        orientState.yaw = lerp(orientState.yaw, yaw, ROT_SMOOTH);
        orientState.pitch = lerp(orientState.pitch, pitch, ROT_SMOOTH);
      }
      if(!regionMode){
        updateVertices();
      }
      render();
    }
  };
})();
