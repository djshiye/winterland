/**
 * [city] 0.9.12 district decoration: where the cosy street furniture of a city district stands (street trees in round
 * planters, hedges, benches, flower boxes / barrels, post boxes, snowmen, bins, bike racks / hitching rails). Pure: no
 * THREE, no GameContext, deterministic (the same district always gets the same items). city/decorModels.ts draws the
 * items, District.ts batches them into the pavement's company (one extra mesh at most).
 *
 * The district's walking life and the building pads own the clear space, so an item may only stand where nobody walks:
 *
 * - the outer edge strip of the sidewalk ring (between the rect edge and the inner walk strip), between the lamps;
 * - behind the buildings (between a cell's back edge and the lot, minus the walk band of the row above);
 * - the gaps between neighbouring lots of a row.
 *
 * Every item is a circle (DECOR_RADIUS x scale) that stays inside the district rect and clear of every walkway rect,
 * lot footprint, pad tile, front lane, street lamp and every other item (`decorClear`, which the tests re-check). The
 * street lamps are laid out here too (`districtLamps`) so the lamp posts District.ts draws and the clearance rules read
 * the same numbers.
 */
import { districtDef, type ERect } from '../eras/data';
import { districtWalkways } from './roadRoute';
import { districtLots } from './rules';

export type DecorKind = 'tree' | 'hedge' | 'bench' | 'planter' | 'postbox' | 'snowman' | 'bin' | 'bikeRack';

export interface DecorItem {
  kind: DecorKind;
  x: number;
  z: number;
  /** Rotation about Y (0 faces +Z, like the lot fronts). */
  yaw: number;
  /** Size factor of the kind's model (and its footprint). */
  scale: number;
}

/** Footprint circle radius (metres, at scale 1) per kind. */
export const DECOR_RADIUS: Readonly<Record<DecorKind, number>> = {
  tree: 0.45,
  hedge: 0.45,
  bench: 0.45,
  planter: 0.35,
  postbox: 0.3,
  snowman: 0.35,
  bin: 0.3,
  bikeRack: 0.45,
};

/**
 * The collider circles of one item (x, z, r): a long item (bench, hedge, bike rack, 0.9 m along its local x) gets two
 * small circles along its length, a round one a single circle a little inside its footprint, so the player walks round
 * the furniture but never snags on its snow. Review E9: they used to have none, while region props block. Pure.
 */
export function decorColliders(it: DecorItem): { x: number; z: number; r: number }[] {
  const k = it.scale;
  if (it.kind === 'bench' || it.kind === 'hedge' || it.kind === 'bikeRack') {
    const cs = Math.cos(it.yaw) * 0.25 * k;
    const sn = Math.sin(it.yaw) * 0.25 * k;
    return [
      { x: it.x + cs, z: it.z - sn, r: 0.2 * k },
      { x: it.x - cs, z: it.z + sn, r: 0.2 * k },
    ];
  }
  return [{ x: it.x, z: it.z, r: DECOR_RADIUS[it.kind] * k * 0.8 }];
}

/** Items keep at least this far from walkways, lots, lanes and each other (a hand's width of snow). */
const GAP = 0.1;
/** Nothing stands closer than this (centre to lamp post) to a street lamp; trees, whose crowns hang over, keep more. */
export const LAMP_CLEAR = 0.8;
const TREE_LAMP_CLEAR = 1.25;

export interface Lamp {
  x: number;
  z: number;
  /** The side of the district it stands on (its arm leans inward). */
  side: 'n' | 's' | 'e' | 'w';
}

const lampCache = new Map<number, Lamp[]>();

/** The street lamps of district n: west / east every 7 m from minZ + 4, north / south every 8 m from minX + 8, 0.9 m in from the edge. */
export function districtLamps(n: number): readonly Lamp[] {
  const hit = lampCache.get(n);
  if (hit) return hit;
  const r = districtDef(n).rect;
  const out: Lamp[] = [];
  for (let z = r.minZ + 4; z < r.maxZ - 2; z += 7) {
    out.push({ x: r.minX + 0.9, z, side: 'w' }, { x: r.maxX - 0.9, z, side: 'e' });
  }
  for (let x = r.minX + 8; x < r.maxX - 6; x += 8) {
    out.push({ x, z: r.minZ + 0.9, side: 'n' }, { x, z: r.maxZ - 0.9, side: 's' });
  }
  lampCache.set(n, out);
  return out;
}

/** Distance from point (x, z) to rect `r` (0 inside). */
function distToRect(r: ERect, x: number, z: number): number {
  return Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
}

/** Everything an item must keep out of, per district (cached). */
interface Keepout {
  rect: ERect;
  rects: ERect[];
  lamps: readonly Lamp[];
}

const keepCache = new Map<number, Keepout>();

function keepout(n: number): Keepout {
  let k = keepCache.get(n);
  if (!k) {
    const rects: ERect[] = [...districtWalkways(n)];
    for (const f of districtLots(n)) {
      rects.push(f.rect, f.zone, { minX: f.cell.minX, maxX: f.cell.maxX, minZ: f.rect.maxZ, maxZ: f.cell.maxZ });
    }
    k = { rect: districtDef(n).rect, rects, lamps: districtLamps(n) };
    keepCache.set(n, k);
  }
  return k;
}

/** True when a circle of radius `r` at (x, z) fits district n's free space (not against other items). */
function freeSpot(n: number, kind: DecorKind, x: number, z: number, r: number): boolean {
  const k = keepout(n);
  if (x - r < k.rect.minX + GAP || x + r > k.rect.maxX - GAP || z - r < k.rect.minZ + GAP || z + r > k.rect.maxZ - GAP) return false;
  for (const w of k.rects) if (distToRect(w, x, z) < r + GAP) return false;
  const lampClear = kind === 'tree' ? TREE_LAMP_CLEAR : Math.max(LAMP_CLEAR, r + 0.45);
  for (const l of k.lamps) if (Math.hypot(l.x - x, l.z - z) < lampClear) return false;
  return true;
}

/** True when `item` can be added to `placed` in district n: it is in the free space and clear of the items already placed. */
export function decorClear(n: number, placed: readonly DecorItem[], item: DecorItem): boolean {
  const r = DECOR_RADIUS[item.kind] * item.scale;
  if (!freeSpot(n, item.kind, item.x, item.z, r)) return false;
  for (const o of placed) if (Math.hypot(o.x - item.x, o.z - item.z) < r + DECOR_RADIUS[o.kind] * o.scale + GAP) return false;
  return true;
}

/**
 * What lines the edge strip, era by era (cycled, with a little skipping): the frontier plants pines and keeps barrels and
 * hitching rails, the iron / steam eras trade in benches and iron urns, the electric and fuel eras bring post boxes and
 * bike racks, and the late eras plant trees and flower boxes in ever softer rows.
 */
const EDGE: readonly (readonly DecorKind[] | null)[] = [
  null,
  null,
  ['tree', 'bench', 'planter', 'bin', 'tree', 'bikeRack', 'bench', 'snowman'],
  ['tree', 'bench', 'planter', 'hedge', 'tree', 'postbox', 'bench', 'snowman'],
  ['tree', 'planter', 'bench', 'bin', 'hedge', 'tree', 'bikeRack', 'snowman'],
  ['hedge', 'bench', 'tree', 'bin', 'planter', 'bikeRack', 'tree', 'postbox'],
  ['tree', 'bench', 'planter', 'postbox', 'hedge', 'tree', 'bikeRack', 'snowman'],
  ['tree', 'bikeRack', 'bench', 'bin', 'planter', 'tree', 'postbox', 'hedge'],
  ['tree', 'planter', 'bench', 'hedge', 'bikeRack', 'tree', 'postbox', 'snowman'],
  ['tree', 'hedge', 'planter', 'bench', 'tree', 'bikeRack', 'planter', 'snowman'],
  ['tree', 'planter', 'hedge', 'bench', 'tree', 'planter', 'postbox', 'snowman'],
];
/** Behind the buildings: greenery and snowmen. */
const BACK: readonly DecorKind[] = ['tree', 'hedge', 'snowman', 'hedge', 'planter', 'tree', 'hedge'];
/** In the gaps between lots: small things only. */
const GAPS: readonly DecorKind[] = ['bin', 'planter', 'snowman', 'planter', 'postbox', 'bin'];

/** Edge strip: the item's centre this far in from the rect edge. */
const EDGE_IN = 0.575;
/** Spacing along the edge strip. */
const EDGE_STEP = 2.15;

/** Small seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<number, DecorItem[]>();

/** The decoration of district n (2..10), cached and deterministic. */
export function districtDecor(n: number): DecorItem[] {
  const hit = cache.get(n);
  if (hit) return hit;
  const out: DecorItem[] = [];
  const rnd = rng(0x51ed270b ^ (n * 7919));
  const r = districtDef(n).rect;
  const add = (kind: DecorKind, x: number, z: number, yaw: number, spread = 0.1): boolean => {
    const item: DecorItem = { kind, x, z, yaw, scale: 1 + (rnd() - 0.5) * 2 * spread };
    if (!decorClear(n, out, item)) return false;
    out.push(item);
    return true;
  };

  // 1. the outer edge strip, facing inward, between the lamps
  const seq = EDGE[n]!;
  const off = Math.floor(rnd() * seq.length);
  let i = off;
  const sides: { x0: number; z0: number; dx: number; dz: number; len: number; yaw: number }[] = [
    { x0: r.minX, z0: r.minZ + EDGE_IN, dx: 1, dz: 0, len: r.maxX - r.minX, yaw: 0 },
    { x0: r.maxX, z0: r.maxZ - EDGE_IN, dx: -1, dz: 0, len: r.maxX - r.minX, yaw: Math.PI },
    { x0: r.minX + EDGE_IN, z0: r.maxZ, dx: 0, dz: -1, len: r.maxZ - r.minZ, yaw: Math.PI / 2 },
    { x0: r.maxX - EDGE_IN, z0: r.minZ, dx: 0, dz: 1, len: r.maxZ - r.minZ, yaw: -Math.PI / 2 },
  ];
  for (const s of sides) {
    for (let t = 1.7 + rnd() * 0.6; t < s.len - 1.5; t += EDGE_STEP + rnd() * 0.5) {
      if (rnd() < 0.18) continue;
      const kind = seq[i++ % seq.length]!;
      const x = s.x0 + s.dx * t;
      const z = s.z0 + s.dz * t;
      // a blocked spot (lamp, connector) slides along the strip, and failing that a small planter fills in
      let placed = false;
      for (let slide = 0; slide < 3 && !placed; slide++) placed = add(kind, x + s.dx * slide * 0.55, z + s.dz * slide * 0.55, s.yaw);
      if (!placed && rnd() < 0.4) add('planter', x + s.dx * 0.7, z + s.dz * 0.7, s.yaw);
    }
  }

  // 2. behind the buildings: the free strip between the cell's back edge and the lot
  const lots = districtLots(n);
  for (const f of lots) {
    const z0 = f.cell.minZ + 0.1;
    const z1 = f.rect.minZ - 0.1;
    if (z1 - z0 < 0.8) continue;
    const zc = (z0 + z1) / 2;
    let j = Math.floor(rnd() * BACK.length);
    for (let x = f.cell.minX + 0.9; x < f.cell.maxX - 0.5; x += 2.1 + rnd() * 0.7) {
      if (rnd() < 0.3) continue;
      const kind = BACK[j++ % BACK.length]!;
      const deep = z1 - z0 > 2.2;
      const k2: DecorKind = kind === 'tree' && !deep ? 'hedge' : kind;
      add(k2, x, zc + (rnd() - 0.5) * 0.3, rnd() < 0.5 ? 0 : Math.PI);
    }
  }

  // 3. the gaps between neighbouring lots of a row (a bin, a post box or a flower box between two houses)
  for (let a = 0; a < lots.length; a++) {
    for (let b = a + 1; b < lots.length; b++) {
      const p = lots[a]!;
      const q = lots[b]!;
      if (Math.abs(p.rect.minZ - q.rect.minZ) > 1e-6 || Math.abs(p.rect.maxX - q.rect.minX) > 3 || q.rect.minX < p.rect.maxX) continue;
      const gx = (p.rect.maxX + q.rect.minX) / 2;
      for (const zf of [0.28, 0.72]) {
        if (rnd() < 0.5) continue;
        const kind = GAPS[Math.floor(rnd() * GAPS.length)]!;
        add(kind, gx, p.rect.minZ + (p.rect.maxZ - p.rect.minZ) * zf, 0);
      }
    }
  }

  cache.set(n, out);
  return out;
}
