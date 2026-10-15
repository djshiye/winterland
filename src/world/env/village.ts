/** Village scenery that is always the same: packed-snow street + lot squares, picket fence, lanterns. */
import * as THREE from 'three';
import { LAYOUT, PALETTE } from '../../config';
import { palisadeMaterial, palisadePostGeometry } from '../../assets/scenery';
import { toon } from '../../render/materials';
import { buildHalos, registerGlow, type HaloSpot } from './glow';
import { Batch, instanced, type EnvPart, type Placement } from './common';

const V = LAYOUT.village;

/** Street + lot ground, a low picket fence on the east and south sides, and baked street lanterns. */
export function buildVillageScenery(): EnvPart {
  const group = new THREE.Group();
  group.name = 'villageScenery';

  // ---- ground ---------------------------------------------------------------
  const g = new Batch();
  const street = V.street;
  const sw = street.maxX - street.minX;
  const sd = street.maxZ - street.minZ;
  const slab = (w: number, d: number, x: number, z: number, y: number, color: number, t = 0.03): void => {
    g.add(new THREE.BoxGeometry(w, t, d), color, x, y - t / 2 + 0.02, z);
  };
  slab(sw, sd, (street.minX + street.maxX) / 2, (street.minZ + street.maxZ) / 2, 0.012, 0xd3deea);
  // wheel / foot lines down the middle lane
  for (const dx of [-0.35, 0.35]) slab(0.18, sd - 0.6, (street.minX + street.maxX) / 2 + dx, (street.minZ + street.maxZ) / 2, 0.026, 0xbccadb, 0.01);
  // lot squares (slightly trampled snow)
  for (const p of V.plots) slab(V.plotSize, V.plotSize, p.x, p.z, 0.016, 0xdfe8f2);
  // forecourt of the Great Lodge
  const gl = V.greatLodge;
  slab(gl.w + 0.8, gl.d + 0.8, gl.x, gl.z, 0.016, 0xdfe8f2);
  slab(sw + 1.2, 1.4, gl.x, street.maxZ + 0.1, 0.014, 0xd3deea);
  group.add(g.mesh({ cast: false, receive: true }));

  // ---- picket fence (east + south sides; the west side is the customer-path fence) ---------
  const A = V.area;
  const pickets: Placement[] = [];
  const spacing = 0.22;
  const east = A.maxX + 0.3;
  const south = A.maxZ + 0.45;
  for (let z = A.minZ; z <= south; z += spacing) pickets.push({ x: east, z, sx: 0.8, sy: 0.5, sz: 0.8 });
  for (let x = A.minX + 0.2; x <= east; x += spacing) pickets.push({ x, z: south, sx: 0.8, sy: 0.5, sz: 0.8 });
  group.add(instanced(palisadePostGeometry(), palisadeMaterial(), pickets, { cast: false }));

  // ---- lanterns (baked, no real lights) ---------------------------------------------------
  const post = new Batch();
  const glow = new Batch();
  const halos: HaloSpot[] = [];
  const lampZ = [15.2, 18.8, 22.4, 26.0];
  for (const z of lampZ) {
    for (const x of [street.minX + 0.05, street.maxX - 0.05]) {
      post.add(new THREE.CylinderGeometry(0.07, 0.1, 2.3, 7), PALETTE.metalDark, x, 1.15, z);
      post.add(new THREE.BoxGeometry(0.4, 0.07, 0.4), PALETTE.metalDark, x, 2.35, z);
      post.add(new THREE.ConeGeometry(0.3, 0.26, 4), PALETTE.rubber, x, 2.78, z, { ry: Math.PI / 4 });
      post.add(new THREE.CylinderGeometry(0.16, 0.26, 0.08, 4), PALETTE.snow, x, 2.9, z, { ry: Math.PI / 4 });
      glow.add(new THREE.BoxGeometry(0.26, 0.34, 0.26), 0xffd978, x, 2.57, z);
      halos.push({ x, y: 2.6, z });
    }
  }
  group.add(post.mesh());
  const lit = glow.mesh({ cast: false, material: registerGlow(toon(0xffd978, { emissive: 0xffb347, emissiveIntensity: 0.8 })) });
  group.add(lit);
  group.add(buildHalos(halos));

  return { group };
}
