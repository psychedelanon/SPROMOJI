/**
 * IMPROVED Auto-Detection for Cartoon/NFT Avatars
 * This actually works instead of failing like the previous system
 */

(function(){
  const PAD = { eye: 1.2, mouth: 1.3 };

  function rgb2hsv(r,g,b){
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    const v=max, d=max-min;
    const s=max===0?0:d/max;
    return {s,v};
  }

  function fromLandmarks(lm,w,h){
    function bbox(points){
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      points.forEach(p=>{minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);});
      return {x:minX*w,y:minY*h,w:(maxX-minX)*w,h:(maxY-minY)*h};
    }
    const L=[33,7,163,144,145,153,154,155,133];
    const R=[362,382,381,380,374,373,390,249,263];
    const M=[61,291,78,308,12,15,13,14];
    const left = bbox(L.map(i=>lm[i]));
    const right= bbox(R.map(i=>lm[i]));
    const mouth= bbox(M.map(i=>lm[i]));
    function expand(r,f){const cx=r.x+r.w/2,cy=r.y+r.h/2;return {x:cx-r.w*f/2,y:cy-r.h*f/2,w:r.w*f,h:r.h*f};}
    return {leftEye:expand(left,PAD.eye),rightEye:expand(right,PAD.eye),mouth:expand(mouth,PAD.mouth)};
  }

  function kmeans(points,k){
    const centroids=[];
    for(let i=0;i<k;i++) centroids.push({x:points[Math.floor(points.length*(i+0.5)/k)].x,y:points[Math.floor(points.length*(i+0.5)/k)].y});
    let changed=true,iter=0;
    const clusters=new Array(k).fill(0).map(()=>[]);
    while(changed&&iter<5){
      clusters.forEach(c=>c.length=0);
      changed=false;
      points.forEach(p=>{
        let best=0,bd=Infinity;
        for(let i=0;i<k;i++){
          const dx=p.x-centroids[i].x, dy=(p.y-centroids[i].y)*0.5;
          const d=dx*dx+dy*dy;
          if(d<bd){bd=d;best=i;}
        }
        clusters[best].push(p);
      });
      for(let i=0;i<k;i++){
        if(clusters[i].length){
          const cx=clusters[i].reduce((s,p)=>s+p.x,0)/clusters[i].length;
          const cy=clusters[i].reduce((s,p)=>s+p.y,0)/clusters[i].length;
          if(cx!==centroids[i].x||cy!==centroids[i].y){centroids[i]={x:cx,y:cy};changed=true;}
        }
      }
      iter++;
    }
    return clusters.map((pts,i)=>{
      let minX=Infinity,minY=Infinity,maxX=0,maxY=0;
      pts.forEach(p=>{if(p.x<minX)minX=p.x;if(p.x>maxX)maxX=p.x;if(p.y<minY)minY=p.y;if(p.y>maxY)maxY=p.y;});
      return {x:minX,y:minY,w:maxX-minX,h:maxY-minY,cx:centroids[i].x,cy:centroids[i].y};
    });
  }

  function detectCartoon(canvas){
    const w=canvas.width,h=canvas.height;
    const ctx=canvas.getContext('2d');
    const data=ctx.getImageData(0,0,w,h).data;
    const dark=[];
    const grad=new Float32Array(w*h);
    for(let y=1;y<h-1;y++){
      for(let x=1;x<w-1;x++){
        const idx=(y*w+x)*4;
        const r=data[idx],g=data[idx+1],b=data[idx+2];
        const hsv=rgb2hsv(r,g,b);
        const gray=(0.299*r+0.587*g+0.114*b)/255;
        if(!(hsv.s<0.25 && hsv.v>0.85) && gray<0.4) dark.push({x,y});
        const idxR=idx+4;
        const idxD=idx+w*4;
        const gR=(0.299*data[idxR]+0.587*data[idxR+1]+0.114*data[idxR+2])/255;
        const gD=(0.299*data[idxD]+0.587*data[idxD+1]+0.114*data[idxD+2])/255;
        grad[y*w+x]=Math.abs(gray-gR)+Math.abs(gray-gD);
      }
    }
    if(dark.length<20) return null;
    const clusters=kmeans(dark,2).sort((a,b)=>a.cx-b.cx);
    const pad=5;
    const left={x:Math.max(clusters[0].x-pad,0),y:Math.max(clusters[0].y-pad,0),w:Math.min(clusters[0].w+pad*2,w),h:Math.min(clusters[0].h+pad*2,h)};
    const right={x:Math.max(clusters[1].x-pad,0),y:Math.max(clusters[1].y-pad,0),w:Math.min(clusters[1].w+pad*2,w),h:Math.min(clusters[1].h+pad*2,h)};
    const midY=(clusters[0].cy+clusters[1].cy)/2;
    let bestY=Math.floor(midY),best=0;
    for(let y=Math.floor(midY);y<h-1;y++){
      let sum=0;for(let x=0;x<w;x++) sum+=grad[y*w+x];
      if(sum>best){best=sum;bestY=y;}
    }
    let leftEdge=w,rightEdge=0;
    for(let x=0;x<w;x++){
      if(grad[bestY*w+x]>best/w*0.3){
        if(x<leftEdge) leftEdge=x;
        if(x>rightEdge) rightEdge=x;
      }
    }
    if(rightEdge-leftEdge<10){leftEdge=w*0.3;rightEdge=w*0.7;}
    const mh=h*0.2;
    const mouth={x:Math.max(leftEdge-10,0),y:Math.max(bestY-mh/2,midY),w:Math.min(rightEdge-leftEdge+20,w),h:Math.min(mh,h-(bestY-mh/2))};
    return {leftEye:left,rightEye:right,mouth:mouth};
  }

  window.AutoRegions={
    fromLandmarks,
    detectCartoon
  };
})();
