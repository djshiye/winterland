/** Big soft low-poly snow-capped mountain ranges on the horizon (north, west and a hint of east). */
import * as THREE from 'three';
import { LAYOUT, PALETTE } from '../../config';
import { Batch, Rng, W, type EnvPart } from './common';

export function buildMountains(rng: Rng): EnvPart {
  const group = new THREE.Group();
  group.name = 'mountains';
  const b = new Batch();
  const riverX = (LAYOUT.river.minX + LAYOUT.river.maxX) / 2;

  const mountain = (x: number, z: number, r: number, h: number, pale: number): void => {
    const base = pale > 0.5 ? 0xb4c4d8 : rng.next() < 0.5 ? PALETTE.mountain : PALETTE.mountainDark;
    const cone = new THREE.ConeGeometry(1, 1, 7, 1, true);
    const ry = rng.range(0, 6.28);
    const rz = r * rng.range(0.85, 1.1);
    b.add(cone, base, x, h / 2 - 1, z, { sx: r, sy: h, sz: rz, ry });
    const snow = rng.range(0.38, 0.5);
    const ch = h * snow;
    b.add(cone, PALETTE.snow, x, h - ch / 2 - 1 + 0.05, z, { sx: r * snow * 1.04, sy: ch, sz: rz * snow * 1.04, ry });
  };

  // Row 1: the main northern range behind the highway.
  for (let x = -120; x <= 120; x += rng.range(11, 16)) {
    const z = -44 - rng.range(0, 10);
    const r = rng.range(10, 15);
    if (Math.abs(x - riverX) < r * 0.55 + 4) continue; // leave the river valley open
    if (x > W.spur.minX - 4 && x < W.spur.maxX + 6) continue; // the tunnel spur has its own peaks
    mountain(x, z, r, rng.range(14, 24), 0);
  }
  // The river's source: one huge peak at the head of the valley.
  mountain(riverX, -84, 24, 34, 0);
  mountain(riverX - 22, -70, 16, 22, 0);
  mountain(riverX + 24, -66, 15, 20, 0);
  // The tricycle road emerges from a mountain.
  mountain(LAYOUT.tricycles.laneX + 1, -50, 12, 17, 0);
  // Row 2: taller, paler range further back.
  for (let x = -130; x <= 130; x += rng.range(18, 26)) {
    mountain(x, -78 - rng.range(0, 12), rng.range(18, 26), rng.range(26, 40), 1);
  }
  // Western range beyond the far bank.
  for (let z = -60; z <= 80; z += rng.range(14, 20)) {
    mountain(-72 - rng.range(0, 14), z, rng.range(11, 16), rng.range(13, 22), z > 20 ? 1 : 0);
  }
  // Eastern hints.
  for (let z = -40; z <= 70; z += rng.range(18, 26)) {
    mountain(92 + rng.range(0, 14), z, rng.range(12, 18), rng.range(12, 20), 1);
  }

  const mesh = b.mesh({ cast: false, receive: false, flat: true });
  group.add(mesh);
  return { group };
}
