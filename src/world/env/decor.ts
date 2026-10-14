/**
 * Pines, rocks, stumps, snow mounds and drifts: instanced, deterministic, placed outside every
 * gameplay area. The phase-5 strip decor (z in [expandedMinZ, -10]) is built as separate objects so
 * expand() can clear it.
 */
import * as THREE from 'three';
import { LAYOUT } from '../../config';
import { toon } from '../../render/materials';
import { blocked, edgeDistance, instanced, occludes, Rng, vcMat, type EnvPart, type Placement } from './common';
import { moundGeo, pineGeo, pineTallGeo, rockGeo, stumpGeo } from './props';

export interface ClearItem {
  readonly object: THREE.Object3D;
  readonly x: number;
  readonly z: number;
}

export interface DecorPart extends EnvPart {
  /** Props inside the future expansion strip; removed with puffs by expand(). */
  readonly stripItems: ClearItem[];
}

export function buildDecor(rng: Rng): DecorPart {
  const group = new THREE.Group();
  group.name = 'decor';
  const mat = vcMat();

  // ---- pines -----------------------------------------------------------
  const pines: Placement[] = [];
  const tall: Placement[] = [];
  const taken: Array<[number, number, number]> = [];
  const free = (x: number, z: number, r: number): boolean => {
    for (const t of taken) {
      const d = Math.hypot(t[0] - x, t[1] - z);
      if (d < r + t[2]) return false;
    }
    return true;
  };
  for (let attempts = 0; attempts < 9000 && pines.length + tall.length < 210; attempts++) {
    const x = rng.range(-85, 80);
    const z = rng.range(-62, 72);
    const d = edgeDistance(x, z);
    if (rng.next() > Math.min(1, Math.max(0.2, (d - 8) / 30))) continue;
    const scale = rng.range(0.85, 1.5);
    const isTall = rng.next() < 0.4;
    const h = (isTall ? 4.6 : 3.7) * scale;
    if (blocked(x, z, 1.4 * scale) || occludes(x, z, h) || !free(x, z, 1.1 * scale)) continue;
    taken.push([x, z, 1.1 * scale]);
    const p: Placement = { x, z, ry: rng.range(0, 6.28), sx: scale, sy: scale * rng.range(0.92, 1.12), tint: rng.range(0.82, 1.05) };
    (isTall ? tall : pines).push(p);
  }
  // Only trees near the play area cast shadows (the sun's shadow box never reaches the rest).
  const near = (p: Placement): boolean => Math.abs(p.x) < 42 && p.z > -40 && p.z < 52;
  group.add(instanced(pineGeo(), mat, pines.filter(near), { cast: true }));
  group.add(instanced(pineGeo(), mat, pines.filter((p) => !near(p)), { cast: false }));
  group.add(instanced(pineTallGeo(), mat, tall.filter(near), { cast: true }));
  group.add(instanced(pineTallGeo(), mat, tall.filter((p) => !near(p)), { cast: false }));

  // ---- rocks / stumps ---------------------------------------------------
  const rocks: Placement[] = [];
  for (let i = 0; i < 400 && rocks.length < 34; i++) {
    const x = rng.range(-70, 70);
    const z = rng.range(-50, 60);
    if (blocked(x, z, 1.0) || !free(x, z, 0.6)) continue;
    const s = rng.range(0.6, 1.5);
    taken.push([x, z, 0.5 * s]);
    rocks.push({ x, z, ry: rng.range(0, 6.28), sx: s, sy: s * rng.range(0.8, 1.2), sz: s * rng.range(0.8, 1.2), tint: rng.range(0.88, 1.05) });
  }
  // Boulders along the far (west) river bank.
  for (let z = -40; z < 56; z += rng.range(5, 11)) {
    if (Math.abs(z - LAYOUT.highway.z) < 5) continue;
    const s = rng.range(0.7, 1.3);
    rocks.push({ x: LAYOUT.river.minX - rng.range(0.2, 0.9), z, ry: rng.range(0, 6.28), sx: s, tint: 1 });
  }
  group.add(instanced(rockGeo(), mat, rocks, { cast: true }));

  const stumps: Placement[] = [];
  for (let i = 0; i < 400 && stumps.length < 16; i++) {
    const x = rng.range(-45, 45);
    const z = rng.range(-30, 50);
    if (blocked(x, z, 1.0) || occludes(x, z, 0.6) || !free(x, z, 0.8)) continue;
    taken.push([x, z, 0.5]);
    stumps.push({ x, z, ry: rng.range(0, 6.28), sx: rng.range(0.9, 1.4), tint: 1 });
  }
  group.add(instanced(stumpGeo(), mat, stumps, { cast: true }));

  // ---- snow mounds + flat drift patches ---------------------------------
  const mounds: Placement[] = [];
  for (let i = 0; i < 600 && mounds.length < 90; i++) {
    const x = rng.range(-75, 75);
    const z = rng.range(-55, 65);
    const r = rng.range(0.9, 2.6);
    if (blocked(x, z, r) || occludes(x, z, 1.2)) continue;
    mounds.push({ x, z, ry: rng.range(0, 6.28), sx: r, sy: r * rng.range(0.7, 1.2), sz: r * rng.range(0.8, 1.4), tint: rng.pick([1, 0.94, 0.9]) });
  }
  // Ridges (plough banks) along both sides of the tricycle road and the highway.
  const road = LAYOUT.tricycles.road;
  for (let z = -60; z < 66; z += rng.range(2.6, 4.2)) {
    if (z > -29 && z < -17) continue;
    mounds.push({ x: road.maxX + 0.9 + rng.range(0, 0.4), z, ry: Math.PI / 2, sx: rng.range(1.1, 1.5), sy: rng.range(0.7, 1), sz: rng.range(1.5, 2.2), tint: 1 });
    if (z < LAYOUT.expandedMinZ - 1.5 || z > LAYOUT.village.area.maxZ + 2.5) {
      mounds.push({ x: road.minX - 0.55, z, ry: Math.PI / 2, sx: 0.75, sy: 0.55, sz: rng.range(1.3, 1.8), tint: 0.95 });
    }
  }
  for (let x = -90; x < 28; x += rng.range(2.6, 4.2)) {
    if (x > -26 && x < -2) continue; // bridge + ramps
    if (x > road.minX - 3 && x < road.maxX + 3) continue;
    mounds.push({ x, z: LAYOUT.highway.z - 3.6 + rng.range(-0.3, 0.3), sx: rng.range(1.4, 2.2), sy: rng.range(0.8, 1.2), sz: rng.range(0.9, 1.3), tint: 1 });
    if (x < -29 || x > 12) {
      mounds.push({ x: x + 1.2, z: LAYOUT.highway.z + 3.0, sx: rng.range(1, 1.5), sy: 0.6, sz: 0.8, tint: 0.95 });
    }
  }
  group.add(instanced(moundGeo(), mat, mounds, { cast: false }));

  const patches: Placement[] = [];
  for (let i = 0; i < 300 && patches.length < 46; i++) {
    const x = rng.range(-70, 70);
    const z = rng.range(-50, 60);
    const s = rng.range(2.5, 6.5);
    if (blocked(x, z, 0.5)) continue;
    patches.push({ x, y: 0.004, z, ry: 0, sx: s, sz: s * rng.range(0.6, 1.1) });
  }
  const drift = instanced(new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2), toon(0xe6eef8), patches, { cast: false });
  group.add(drift);

  // ---- strip decor (cleared by expand()) --------------------------------
  const stripItems: ClearItem[] = [];
  const addStrip = (geometry: THREE.BufferGeometry, x: number, z: number, s: number, cast: boolean): void => {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x, 0, z);
    m.rotation.y = rng.range(0, 6.28);
    m.scale.setScalar(s);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    stripItems.push({ object: m, x, z });
  };
  const stripPines: Array<[number, number, number]> = [
    [-7.8, -12.6, 1.2],
    [-3.6, -16.4, 1.05],
    [-8.4, -18.2, 1.35],
    [-1.8, -12.2, 0.95],
    [6.8, -12.6, 1.3],
    [8.7, -17.8, 1.15],
    [4.8, -14.6, 0.9],
  ];
  stripPines.forEach(([x, z, s], i) => addStrip(i % 2 ? pineTallGeo() : pineGeo(), x, z, s, true));
  [
    [3.6, -12.2, 1.0],
    [-5.6, -14.6, 1.2],
    [9.0, -14.4, 0.9],
  ].forEach(([x, z, s]) => addStrip(rockGeo(), x!, z!, s!, true));
  [
    [-9.0, -14.6, 1.1],
    [5.8, -18.6, 1.0],
  ].forEach(([x, z, s]) => addStrip(stumpGeo(), x!, z!, s!, true));

  return { group, stripItems };
}
