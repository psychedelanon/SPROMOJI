import rig from '../assets/pepe_superhero_rig.json';

function buildPixiMeshFromUV(tex, verts){
  // placeholder for actual Pixi mesh creation
  return {texture: tex, vertices: verts};
}

export const featureMeshes = Object.fromEntries(
  Object.entries(rig).map(([k, verts]) => [k, buildPixiMeshFromUV(avatarTexture, verts)])
);

stage.addChild(...Object.values(featureMeshes));
