import { SamPredictor } from '@segment-anything/sam';
import { ClipModel, clipScore } from '@microsoft/clip-js';
import cv from 'opencv4nodejs';
import fs from 'fs';

const samModelName = 'vit_h';
const prompts = {
  L_EYE: 'a left eye illustration',
  R_EYE: 'a right eye illustration',
  MOUTH: 'a cartoon mouth, lips open'
};

async function autoRigAvatar(imgPath: string, outPath: string){
  const sam = await SamPredictor.fromPretrained(samModelName);
  const clip = await ClipModel.load();

  const img = cv.imread(imgPath);
  const samMasks = await sam.predict(img);

  const scored: Record<'L_EYE'|'R_EYE'|'MOUTH', {mask: cv.Mat|null, score: number}> = {
    L_EYE: {mask:null, score:-Infinity},
    R_EYE: {mask:null, score:-Infinity},
    MOUTH: {mask:null, score:-Infinity}
  };

  for(const mask of samMasks){
    const patch = img.copy(mask);
    for(const k of Object.keys(prompts) as Array<'L_EYE'|'R_EYE'|'MOUTH'>){
      const s = clipScore(patch, prompts[k]);
      if(!scored[k].mask || s > scored[k].score){
        scored[k] = {mask, score:s};
      }
    }
  }

  const rig:any = {};

  for(const k of Object.keys(scored) as Array<'L_EYE'|'R_EYE'|'MOUTH'>){
    const m = scored[k].mask;
    if(!m) continue;
    const clean = m.erode(2).dilate(2).medianBlur(3);
    const contours = clean.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    if(!contours.length) continue;
    const contour = contours[0];
    const approx = contour.approxPolyDP(1,true).getPoints();
    rig[k] = approx.map(p => ({u: p.x/img.cols, v: p.y/img.rows}));
  }

  fs.writeFileSync(outPath, JSON.stringify(rig, null, 2));
}

const [,,imgPath,outPath] = process.argv;
if(!imgPath || !outPath){
  console.error('Usage: ts-node autoRig.ts <inImg> <outJson>');
  process.exit(1);
}
autoRigAvatar(imgPath, outPath).catch(err=>{console.error(err);process.exit(1)});
