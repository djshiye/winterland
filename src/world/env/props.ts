/** Reusable vertex-coloured prop geometries (built once, shared by instanced + single meshes). */
import * as THREE from 'three';
import { PALETTE } from '../../config';
import { Batch } from './common';

let pine: THREE.BufferGeometry | null = null;
let pineTall: THREE.BufferGeometry | null = null;
let rock: THREE.BufferGeometry | null = null;
let stump: THREE.BufferGeometry | null = null;
let mound: THREE.BufferGeometry | null = null;

const cone = (r: number, h: number, seg = 7): THREE.ConeGeometry => new THREE.ConeGeometry(r, h, seg, 1, true);

function buildPine(tiers: Array<[number, number, number, number]>, trunkH: number): THREE.BufferGeometry {
  const b = new Batch();
  b.add(new THREE.CylinderGeometry(0.15, 0.22, trunkH + 0.3, 6), PALETTE.trunk, 0, (trunkH + 0.3) / 2, 0);
  tiers.forEach(([r, h, y0, capFrac], i) => {
    const col = i === 0 ? PALETTE.pineDark : i === 1 ? PALETTE.pine : 0x3a8c63;
    b.add(cone(r, h), col, 0, y0 + h / 2, 0, { ry: i * 0.5 });
    const ch = h * capFrac;
    const cr = r * capFrac * 1.07;
    b.add(cone(cr, ch), PALETTE.snow, 0, y0 + h - ch / 2 + 0.03, 0, { ry: i * 0.5 });
  });
  return b.geometry();
}

/** Stacked-cone pine with snow caps (≈3.7 m tall). */
export function pineGeo(): THREE.BufferGeometry {
  pine ??= buildPine(
    [
      [1.3, 1.5, 0.55, 0.42],
      [1.0, 1.4, 1.5, 0.5],
      [0.66, 1.25, 2.5, 0.62],
    ],
    0.6,
  );
  return pine;
}

/** Slimmer four-tier pine (≈4.6 m tall). */
export function pineTallGeo(): THREE.BufferGeometry {
  pineTall ??= buildPine(
    [
      [1.1, 1.4, 0.7, 0.4],
      [0.92, 1.3, 1.65, 0.45],
      [0.72, 1.2, 2.6, 0.52],
      [0.46, 1.15, 3.55, 0.65],
    ],
    0.8,
  );
  return pineTall;
}

/** Grey-blue boulder with a snow cap (≈0.9 m). */
export function rockGeo(): THREE.BufferGeometry {
  if (!rock) {
    const b = new Batch();
    b.add(new THREE.IcosahedronGeometry(0.7, 0), PALETTE.rock, 0, 0.32, 0, { sx: 1, sy: 0.72, sz: 0.9, ry: 0.4 });
    b.add(new THREE.IcosahedronGeometry(0.4, 0), PALETTE.rockDark, 0.6, 0.15, 0.25, { sy: 0.7, ry: 1.1 });
    b.add(new THREE.IcosahedronGeometry(0.55, 0), PALETTE.snow, -0.02, 0.52, 0, { sx: 1.05, sy: 0.38, sz: 0.92, ry: 0.4 });
    rock = b.geometry();
  }
  return rock;
}

/** Cut tree stump with a snow cap. */
export function stumpGeo(): THREE.BufferGeometry {
  if (!stump) {
    const b = new Batch();
    b.add(new THREE.CylinderGeometry(0.3, 0.38, 0.5, 8), PALETTE.bark, 0, 0.25, 0);
    b.add(new THREE.CylinderGeometry(0.31, 0.31, 0.04, 8), PALETTE.woodRing, 0, 0.5, 0);
    b.add(new THREE.CylinderGeometry(0.22, 0.28, 0.09, 8), PALETTE.snow, 0, 0.54, 0);
    stump = b.geometry();
  }
  return stump;
}

/** Soft snow mound / drift (unit radius, 0.45 high; scale at will). */
export function moundGeo(): THREE.BufferGeometry {
  if (!mound) {
    const b = new Batch();
    b.add(new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), PALETTE.snow, 0, -0.02, 0, { sy: 0.45 });
    mound = b.geometry();
  }
  return mound;
}
