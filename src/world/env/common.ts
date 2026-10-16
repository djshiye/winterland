/**
 * Shared helpers for the environment builders: seeded RNG, vertex-colour static batching,
 * instancing, and the keep-out / occlusion rules that keep decor off every gameplay area.
 */
import * as THREE from 'three';
import { LAYOUT, PADS, inflate, rect, type Rect } from '../../config';
import { DISTRICTS, REGIONS, RIVER_POND, ROADS } from '../../eras/data';

/** Deterministic PRNG (mulberry32) so screenshots are reproducible. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
}

/** Interface every sub-builder returns. */
export interface EnvPart {
  readonly group: THREE.Group;
  update?(dt: number): void;
}

// Vertex-colour batching lives in render/batch.ts (shared with the AssetFactory); re-exported for env builders.
export { Batch, vcMat, type PartOpts } from '../../render/batch';

export interface Placement {
  x: number;
  y?: number;
  z: number;
  ry?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** Per-instance tint multiplier (instance colour). */
  tint?: number;
}

/** Build a static InstancedMesh from placements (bounding sphere computed so it is never wrongly culled). */
export function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  items: readonly Placement[],
  opts?: { cast?: boolean; receive?: boolean },
): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
  im.count = items.length;
  const o = new THREE.Object3D();
  const c = new THREE.Color();
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    o.position.set(it.x, it.y ?? 0, it.z);
    o.rotation.set(0, it.ry ?? 0, 0);
    o.scale.set(it.sx ?? 1, it.sy ?? it.sx ?? 1, it.sz ?? it.sx ?? 1);
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
    if (it.tint !== undefined) {
      c.setRGB(it.tint, it.tint, it.tint, THREE.LinearSRGBColorSpace);
      im.setColorAt(i, c);
    }
  }
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = opts?.cast ?? false;
  im.receiveShadow = opts?.receive ?? true;
  im.computeBoundingSphere();
  return im;
}

// ---------------------------------------------------------------------------
// Keep-out rules
// ---------------------------------------------------------------------------

/** World constants shared by several builders. */
export const W = {
  /** Yard dirt extends this far beyond the fence centre line. */
  yardMinX: -10.4,
  yardMaxX: 10.4,
  yardMaxZ: 10.4,
  yardMinZ: -10.4,
  /** Highway road surface height on the bridge deck. */
  bridgeY: 2.2,
  /** Bridge ramps (world X). */
  rampWest: { from: -23.5, to: -17.5 },
  rampEast: { from: -9.3, to: -3.3 },
  /** Tunnel spur (solid) extents. */
  spur: { minX: 29, maxX: 66, minZ: -31, maxZ: -17.5, height: 6.6 },
} as const;

const strip: Rect = { minX: W.yardMinX, maxX: W.yardMaxX, minZ: LAYOUT.expandedMinZ - 0.4, maxZ: W.yardMaxZ };

const padRects: Rect[] = Object.values(PADS).map((p) => rect(p.x, p.z, p.size, p.size));

/** Areas decor must never overlap (inflated by the caller's radius). */
const KEEP_OUT: Rect[] = [
  inflate(strip, 1.0),
  inflate({ ...LAYOUT.river }, 0.7),
  inflate({ ...LAYOUT.customers.path, maxZ: 46, minZ: 8.5 }, 1.6),
  inflate(LAYOUT.tricycles.road, 1.2),
  inflate(LAYOUT.village.area, 1.4),
  // Wave 9 Market Town district + the corridor that leads to it (env/town.ts dresses both)
  inflate(LAYOUT.town.area, 1.4),
  inflate(LAYOUT.town.walk[0]!, 1.6),
  // Timber Ridge (its own forest / rocks / bushes live in ridge/Ridge.ts) + the rail corridor
  inflate(LAYOUT.ridge.area, 1.2),
  { minX: LAYOUT.ridge.rail.x - 2.4, maxX: LAYOUT.ridge.rail.x + 2.4, minZ: -70, maxZ: 70 },
  // Wave 8 dog-sled lane, U-turn loop and return line (npc/SledQueue, assets/sled.ts)
  { minX: 15, maxX: 62, minZ: 7.2, maxZ: 11.2 },
  // highway corridor + bridge ramps
  { minX: -95, maxX: W.spur.minX, minZ: LAYOUT.highway.z - 4.6, maxZ: LAYOUT.highway.z + 4.0 },
  { minX: W.spur.minX - 2, maxX: W.spur.maxX + 2, minZ: W.spur.minZ - 2, maxZ: W.spur.maxZ + 2 },
  ...padRects,
];

/** Regions a tall prop must not visually cover (the camera looks toward -X/-Z). */
const PROTECT: Rect[] = [
  inflate({ minX: W.yardMinX, maxX: W.yardMaxX, minZ: -10.4, maxZ: W.yardMaxZ }, 0.6),
  inflate({ ...LAYOUT.customers.path, maxZ: 40, minZ: 9 }, 0.9),
  inflate(LAYOUT.tricycles.road, 0.6),
  inflate(LAYOUT.village.area, 0.5),
  inflate(LAYOUT.town.area, 0.5),
  inflate(LAYOUT.ridge.area, 0.4),
  { minX: -2, maxX: 16, minZ: -26, maxZ: -9 },
];

/**
 * 0.9.0 new land: every era region, road and city district (eras/data.ts) and the river's pond, inflated 1.5 m. Decor must stay off them.
 * Kept OUT of `blocked` / `occludes` on purpose: the old-map scatter (world/env/decor.ts) draws its random numbers
 * through them, so adding rects there would reshuffle every existing tree. Instead the old scatter is built exactly as
 * before and `pruneNewLand` (env/frontier.ts) deletes the instances that landed on the new land; new scatter in the far
 * land asks `blockedNewLand` / `occludesNewLand` directly.
 */
export const NEW_LAND: Rect[] = [
  ...REGIONS.filter((r) => r !== null).map((r) => inflate(r!.rect, 1.5)),
  ...ROADS.map((r) => inflate(r.rect, 1.5)),
  ...DISTRICTS.filter((d) => d !== null).map((d) => inflate(d!.rect, 1.5)),
  // 0.9.5: the frozen pond the river ends in
  inflate(RIVER_POND, 1.5),
];

function hit(list: readonly Rect[], x: number, z: number, margin: number): boolean {
  for (const r of list) {
    if (x > r.minX - margin && x < r.maxX + margin && z > r.minZ - margin && z < r.maxZ + margin) return true;
  }
  return false;
}

/** True if a prop of radius `r` at (x, z) would sit on a gameplay area, road, river or path. */
export function blocked(x: number, z: number, r = 0): boolean {
  return hit(KEEP_OUT, x, z, r);
}

/** True if a prop of radius `r` at (x, z) would sit on a region, road or city district. */
export function blockedNewLand(x: number, z: number, r = 0): boolean {
  return hit(NEW_LAND, x, z, r);
}

/** True if a prop of height `h` at (x, z) would, in the isometric view, hide part of the new land (see `occludes`). */
export function occludesNewLand(x: number, z: number, h: number): boolean {
  const reach = h * 0.7;
  for (let t = 0; t <= reach; t += 0.5) {
    if (hit(NEW_LAND, x - t, z - t, 0.4)) return true;
  }
  return false;
}

/**
 * True if a prop of height `h` at (x, z) would, in the isometric view, hide something that
 * matters (the camera sits toward +X/+Z, so props cover the ground behind them along (-1,-1)).
 */
export function occludes(x: number, z: number, h: number): boolean {
  const reach = h * 0.7;
  for (let t = 0; t <= reach; t += 0.5) {
    if (hit(PROTECT, x - t, z - t, 0.4)) return true;
  }
  return false;
}

/** Distance from the centre of the play area (Chebyshev). */
export function edgeDistance(x: number, z: number): number {
  return Math.max(Math.abs(x), Math.abs(z + 5));
}
