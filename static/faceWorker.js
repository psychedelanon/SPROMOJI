console.log('[faceWorker] booting…');

import { FilesetResolver, FaceLandmarker } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.mjs';

const base = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm';
const landmarker = await FaceLandmarker.create(
  await FilesetResolver.forVisionTasks(base, { forceSIMD:false }),  // WebView safe
  { runningMode:'VIDEO', numFaces:1, outputFaceBlendshapes:true }
);
postMessage({type:'ready'});

self.onmessage = async ({data})=>{
  if (data.type!=='frame') return;
  const res = landmarker.detectForVideo(data.bitmap, data.ts);
  data.bitmap.close();
  if (res.faceBlendshapes.length){
    postMessage({type:'blend', blend:res.faceBlendshapes[0].categories,
                                lm:res.faceLandmarks[0]});
  }
}; 