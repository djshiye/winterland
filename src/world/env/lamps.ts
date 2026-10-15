/**
 * [T4 — wave 9] The three lamp generations of the eras (env/eras.ts): wooden torches (Camp / Hamlet), lanterns
 * (Village) and wrought-iron street lamps (Town and up). Each set is ONE baked post mesh + ONE emissive glow mesh +
 * ONE additive halo mesh, wrapped in a Group so a whole generation switches with one `.visible`.
 *
 * NOTE: toggle the returned Group, never the halo mesh inside it: glow.ts shows/hides halos itself at dusk.
 */
import * as THREE from 'three';
import { PALETTE } from '../../config';
import { toon } from '../../render/materials';
import { buildHalos, registerGlow, type HaloSpot } from './glow';
import { Batch } from './common';
import type { LampKind } from './eras';

export interface LampSpot {
  x: number;
  z: number;
}

/** Height of the light (lamp head centre) per generation, for strings hung from the lamps. */
export const LAMP_HEAD: Record<LampKind, number> = { torch: 1.95, lantern: 2.57, iron: 3.0 };
/** Height where a string / bunting attaches. */
export const LAMP_TOP: Record<LampKind, number> = { torch: 2.15, lantern: 2.62, iron: 3.1 };

const glowMat = (kind: LampKind): THREE.MeshToonMaterial => {
  if (kind === 'torch') return registerGlow(toon(0xffa23c, { emissive: 0xff7a18, emissiveIntensity: 0.95 }), 2.2);
  if (kind === 'lantern') return registerGlow(toon(0xffd978, { emissive: 0xffb347, emissiveIntensity: 0.8 }));
  return registerGlow(toon(0xfff0c2, { emissive: 0xffc866, emissiveIntensity: 0.9 }), 2.9);
};

function buildTorch(post: Batch, glow: Batch, x: number, z: number): void {
  // rough log post with a snowy foot, an iron fire bowl and a double flame
  post.add(new THREE.CylinderGeometry(0.07, 0.11, 1.55, 6), PALETTE.barkDark, x, 0.78, z);
  post.add(new THREE.CylinderGeometry(0.2, 0.17, 0.07, 7), PALETTE.snow, x, 0.04, z);
  post.add(new THREE.CylinderGeometry(0.2, 0.09, 0.22, 7), PALETTE.metalDark, x, 1.62, z);
  post.add(new THREE.TorusGeometry(0.2, 0.025, 4, 9), PALETTE.rubber, x, 1.73, z, { rx: Math.PI / 2 });
  post.add(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 7), PALETTE.snow, x, 0.075, z);
  glow.add(new THREE.ConeGeometry(0.22, 0.66, 6), 0xffa23c, x, 2.05, z);
  glow.add(new THREE.ConeGeometry(0.12, 0.46, 5), 0xffa23c, x + 0.07, 2.0, z - 0.04, { rz: -0.2 });
  glow.add(new THREE.ConeGeometry(0.1, 0.4, 5), 0xffa23c, x - 0.08, 1.98, z + 0.05, { rz: 0.25 });
}

function buildLantern(post: Batch, glow: Batch, x: number, z: number): void {
  post.add(new THREE.CylinderGeometry(0.07, 0.1, 2.3, 7), PALETTE.metalDark, x, 1.15, z);
  post.add(new THREE.BoxGeometry(0.4, 0.07, 0.4), PALETTE.metalDark, x, 2.35, z);
  post.add(new THREE.ConeGeometry(0.3, 0.26, 4), PALETTE.rubber, x, 2.78, z, { ry: Math.PI / 4 });
  post.add(new THREE.CylinderGeometry(0.16, 0.26, 0.08, 4), PALETTE.snow, x, 2.9, z, { ry: Math.PI / 4 });
  glow.add(new THREE.BoxGeometry(0.26, 0.34, 0.26), 0xffd978, x, 2.57, z);
}

function buildIron(post: Batch, glow: Batch, x: number, z: number): void {
  const iron = 0x30353d;
  // fluted base, slim shaft with collars, scroll arms, glass lantern with a pyramid roof and a finial
  post.add(new THREE.CylinderGeometry(0.17, 0.22, 0.28, 8), iron, x, 0.14, z);
  post.add(new THREE.CylinderGeometry(0.1, 0.17, 0.4, 8), iron, x, 0.48, z);
  post.add(new THREE.CylinderGeometry(0.055, 0.075, 2.1, 8), iron, x, 1.5, z);
  post.add(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 8), iron, x, 0.9, z);
  post.add(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 8), iron, x, 2.45, z);
  post.add(new THREE.TorusGeometry(0.22, 0.022, 4, 10, Math.PI), iron, x, 2.5, z, { rz: Math.PI });
  post.add(new THREE.TorusGeometry(0.22, 0.022, 4, 10, Math.PI), iron, x, 2.5, z, { rz: Math.PI, ry: Math.PI / 2 });
  post.add(new THREE.CylinderGeometry(0.19, 0.12, 0.1, 4), iron, x, 2.58, z, { ry: Math.PI / 4 });
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    post.add(new THREE.BoxGeometry(0.035, 0.46, 0.035), iron, x + dx * 0.13, 3.0, z + dz * 0.13);
  }
  post.add(new THREE.ConeGeometry(0.31, 0.3, 4), iron, x, 3.38, z, { ry: Math.PI / 4 });
  post.add(new THREE.ConeGeometry(0.22, 0.12, 4), PALETTE.snow, x, 3.48, z, { ry: Math.PI / 4 });
  post.add(new THREE.SphereGeometry(0.045, 6, 5), iron, x, 3.58, z);
  glow.add(new THREE.BoxGeometry(0.24, 0.44, 0.24), 0xfff0c2, x, 3.0, z);
}

/** One generation of lamps at `spots`: baked posts (cast), emissive glow, night halos. */
export function buildLampSet(kind: LampKind, spots: readonly LampSpot[]): THREE.Group {
  const group = new THREE.Group();
  group.name = `lamps-${kind}`;
  const post = new Batch();
  const glow = new Batch();
  const halos: HaloSpot[] = [];
  for (const s of spots) {
    (kind === 'torch' ? buildTorch : kind === 'lantern' ? buildLantern : buildIron)(post, glow, s.x, s.z);
    halos.push({ x: s.x, y: LAMP_HEAD[kind], z: s.z });
  }
  group.add(post.mesh({ cast: false })); // thin posts: no shadow pass (draw-call budget)
  group.add(glow.mesh({ cast: false, material: glowMat(kind) }));
  const halo = new THREE.Group(); // shields the halo mesh from toggling (glow.ts owns its visibility)
  halo.add(
    buildHalos(halos, kind === 'torch' ? { size: 1.8, pool: 4.2 } : kind === 'iron' ? { size: 2.5, pool: 5.8 } : undefined),
  );
  group.add(halo);
  return group;
}

/** The three generations of the same spots, one visible at a time: returns the switcher too. */
export function buildLampVariants(spots: readonly LampSpot[]): { group: THREE.Group; show: (kind: LampKind) => void } {
  const group = new THREE.Group();
  const sets = {
    torch: buildLampSet('torch', spots),
    lantern: buildLampSet('lantern', spots),
    iron: buildLampSet('iron', spots),
  };
  for (const g of Object.values(sets)) group.add(g);
  const show = (kind: LampKind): void => {
    sets.torch.visible = kind === 'torch';
    sets.lantern.visible = kind === 'lantern';
    sets.iron.visible = kind === 'iron';
  };
  show('torch');
  return { group, show };
}
