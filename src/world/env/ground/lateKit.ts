/**
 * 0.9.8 (10c) the late eras' base-board kit (eras 8 Computer, 9 Nuclear, 10 AI): floor patterns and the code-built
 * toy props their ground files (ground/era08.ts … era10.ts) lay out by layout zone. Every builder adds vertex-coloured
 * primitives to a Batch (`body` casts and takes shadows, `glow` is the era's lit share: screens, pools, crystal hearts,
 * fusion rings) so a whole era stays a couple of draw calls. Colours come from render/palette.ts (the era's floor,
 * city, light and guide rows); the few material tones below are mixed from it.
 *
 * Style (DIRECTION "snow-globe toy diorama"): rounded, chunky, a fat snow cap on top, no spikes, no near-black.
 */
import * as THREE from 'three';
import type { Rect } from '../../../config';
import { geo } from '../../../render/materials';
import type { Batch } from '../../../render/batch';
import { SNOW, mixHex, palette } from '../../../render/palette';
import type { Rng } from '../common';
import type { PlotPlaces, RegionLayout } from '../../../eras/layout';
import { nodePatch, regionPaths } from '../frontier';

const shade = (c: number, k: number): number => {
  const col = new THREE.Color(c);
  col.r = Math.min(1, col.r * k);
  col.g = Math.min(1, col.g * k);
  col.b = Math.min(1, col.b * k);
  return col.getHex();
};

/** Height of the floor patterns' top (above the snow ground and the region tile, under the 0.9.7 plot paving). */
export const FLOOR_Y = 0.018;

// ---------------------------------------------------------------------------------------------------------------------
// floors (one call per rect; flat boxes a few millimetres thick)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Era 8: beige terrazzo. Big two-tone tiles with warm brass divider strips and a scatter of chips (cream, warm grey,
 * teal glass), the way a 1980s campus lobby floor looks, with sand drifted into the corners.
 */
export function terrazzo(body: Batch, r: Rect, rng: Rng, y = FLOOR_Y): void {
  const p = palette(8);
  const base = p.floor.yard;
  const tile = 3;
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  body.add(geo.box(w, 0.006, d), shade(base, 0.9), (r.minX + r.maxX) / 2, y, (r.minZ + r.maxZ) / 2);
  for (let x = r.minX; x < r.maxX - 0.3; x += tile) {
    for (let z = r.minZ; z < r.maxZ - 0.3; z += tile) {
      const tw = Math.min(tile, r.maxX - x) - 0.12;
      const td = Math.min(tile, r.maxZ - z) - 0.12;
      const odd = (Math.round((x - r.minX) / tile) + Math.round((z - r.minZ) / tile)) & 1;
      body.add(geo.box(tw, 0.006, td), odd ? base : mixHex(base, p.floor.processing, 0.55), x + tw / 2 + 0.06, y + 0.003, z + td / 2 + 0.06);
    }
  }
  const chips = [0xfbf6ea, 0xb8ab96, mixHex(p.accent, 0xffffff, 0.35), 0xd9b98a];
  const n = Math.round((w * d) / 3.2);
  for (let i = 0; i < n; i++) {
    const s = rng.range(0.05, 0.13);
    body.add(geo.circleGround(1, 6), chips[i % chips.length]!, rng.range(r.minX + 0.2, r.maxX - 0.2), y + 0.007, rng.range(r.minZ + 0.2, r.maxZ - 0.2), { sx: s, sz: s * rng.range(0.6, 1), ry: rng.range(0, 3) });
  }
}

/**
 * Era 9: mint-glazed concrete. Large slabs with soft darker joints and a glossy lighter glaze pooled on each one, a
 * cool aqua drain channel along one edge (it glows at night: `glow`).
 */
export function mintGlaze(body: Batch, glow: Batch | null, r: Rect, rng: Rng, y = FLOOR_Y): void {
  const p = palette(9);
  const base = p.floor.yard;
  const slab = 3.6;
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  body.add(geo.box(w, 0.006, d), shade(base, 0.82), (r.minX + r.maxX) / 2, y, (r.minZ + r.maxZ) / 2);
  for (let x = r.minX; x < r.maxX - 0.4; x += slab) {
    for (let z = r.minZ; z < r.maxZ - 0.4; z += slab) {
      const sw = Math.min(slab, r.maxX - x) - 0.16;
      const sd = Math.min(slab, r.maxZ - z) - 0.16;
      const k = rng.range(0.96, 1.04);
      const cx = x + sw / 2 + 0.08;
      const cz = z + sd / 2 + 0.08;
      body.add(geo.box(sw, 0.006, sd), shade(base, k), cx, y + 0.003, cz);
      // the glaze: a lighter, rounded pool off-centre on the slab
      body.add(geo.circleGround(1, 14), mixHex(base, p.floor.processing, 0.75), cx - sw * 0.12, y + 0.0068, cz - sd * 0.12, { sx: sw * 0.3, sz: sd * 0.24 });
    }
  }
  if (glow) glow.add(geo.box(w - 0.6, 0.008, 0.22), p.glow, (r.minX + r.maxX) / 2, y + 0.006, r.maxZ - 0.35);
}

/**
 * Era 10: cream hex panels with gold seams. A gold bed under a honeycomb of cream panels (three soft tints) with a
 * sun-gold light inlaid in every seventh panel (`glow`, it brightens at night like a fusion floor).
 */
export function hexGold(body: Batch, glow: Batch | null, r: Rect, rng: Rng, y = FLOOR_Y, R = 1.25): void {
  const p = palette(10);
  const cream = p.floor.yard;
  const gold = p.floor.processing;
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  body.add(geo.box(w, 0.006, d), mixHex(gold, cream, 0.15), (r.minX + r.maxX) / 2, y, (r.minZ + r.maxZ) / 2);
  const dx = Math.sqrt(3) * R;
  const dz = 1.5 * R;
  const tints = [cream, mixHex(cream, 0xffffff, 0.35), mixHex(cream, 0xf0d9b0, 0.4)];
  let row = 0;
  for (let z = r.minZ + R * 0.9; z < r.maxZ - R * 0.6; z += dz, row++) {
    let col = 0;
    for (let x = r.minX + R * 0.9 + (row % 2) * (dx / 2); x < r.maxX - R * 0.6; x += dx, col++) {
      const lit = glow && (row * 3 + col * 5) % 7 === 0;
      body.add(geo.cylinder(R * 0.9, R * 0.9, 0.012, 6), tints[(row + col * 2) % 3]!, x, y + 0.006, z, { ry: Math.PI / 6 });
      if (lit) glow.add(geo.cylinder(R * 0.32, R * 0.32, 0.01, 6), p.light, x, y + 0.014, z, { ry: Math.PI / 6 });
    }
  }
  void rng;
}

// ---------------------------------------------------------------------------------------------------------------------
// trees (the tree belt)
// ---------------------------------------------------------------------------------------------------------------------

/** Era 8: a sculpted cypress in a cream planter (a tidy campus row), snow on its shoulders. */
export function cypress(body: Batch, x: number, z: number, s: number, rng: Rng): void {
  const p = palette(8);
  const leaf = mixHex(0x6f9a7a, 0x8fb39a, rng.next() * 0.5);
  body.add(geo.cylinder(0.55 * s, 0.48 * s, 0.6 * s, 12), p.city!.wall, x, 0.3 * s, z);
  body.add(geo.cylinder(0.6 * s, 0.6 * s, 0.08 * s, 12), p.city!.trim, x, 0.62 * s, z);
  body.add(geo.capsule(0.55 * s, 1.9 * s, 6, 12), leaf, x, 2.0 * s, z);
  body.add(geo.sphere(0.48 * s, 12, 8), SNOW, x, 3.05 * s, z, { sy: 0.55 });
  body.add(geo.sphere(0.5 * s, 10, 6), SNOW, x + 0.1 * s, 2.3 * s, z - 0.3 * s, { sx: 0.7, sy: 0.25, sz: 0.5 });
}

/** Era 9: a rounded mint conifer, three soft tiers stacked with snow in the folds. */
export function mintPine(body: Batch, x: number, z: number, s: number, rng: Rng): void {
  const leaf = mixHex(0x5f9e88, 0x7cb8a0, rng.next());
  body.add(geo.cylinder(0.16 * s, 0.2 * s, 0.7 * s, 8), 0x8a6a52, x, 0.35 * s, z);
  const tiers: [number, number][] = [[1.15, 0.95], [0.9, 1.75], [0.62, 2.45]];
  for (const [rad, y] of tiers) {
    body.add(geo.sphere(rad * s, 14, 9), leaf, x, y * s, z, { sy: 0.72 });
    body.add(geo.sphere(rad * 0.82 * s, 12, 6), SNOW, x, (y + rad * 0.34) * s, z, { sy: 0.28 });
  }
  body.add(geo.sphere(0.24 * s, 10, 6), SNOW, x, 2.95 * s, z);
}

/**
 * Era 10: a geode tree, a gold trunk carrying round rare-earth crowns (neodymium lavender, rose, sun-gold) whose hearts
 * glow softly at night. Rounded everywhere: the AI era's "no spikes" rule.
 */
export function geodeTree(body: Batch, glow: Batch, x: number, z: number, s: number, rng: Rng): void {
  const p = palette(10);
  const crowns = [0xb9a3e8, 0xe8a8c0, 0xf2c46a];
  const c = crowns[Math.floor(rng.next() * crowns.length)]!;
  body.add(geo.cylinder(0.12 * s, 0.2 * s, 1.6 * s, 8), p.accent, x, 0.8 * s, z);
  body.add(geo.cylinder(0.5 * s, 0.6 * s, 0.18 * s, 12), p.city!.wall, x, 0.09 * s, z);
  body.add(geo.sphere(0.95 * s, 16, 10), c, x, 2.1 * s, z, { sy: 0.85 });
  body.add(geo.sphere(0.5 * s, 12, 8), mixHex(c, 0xffffff, 0.3), x + 0.55 * s, 1.75 * s, z + 0.3 * s);
  body.add(geo.sphere(0.85 * s, 14, 6), SNOW, x, 2.45 * s, z, { sy: 0.32 });
  glow.add(geo.sphere(0.2 * s, 10, 6), mixHex(c, p.light, 0.5), x - 0.25 * s, 1.85 * s, z + 0.82 * s);
}

// ---------------------------------------------------------------------------------------------------------------------
// props
// ---------------------------------------------------------------------------------------------------------------------

/** Era 8: a soft sand dune with a snow crest. */
export function dune(body: Batch, x: number, z: number, s: number, ry: number): void {
  const sand = palette(8).floor.processing;
  body.add(geo.sphere(1, 16, 8), sand, x, 0, z, { sx: 2.4 * s, sy: 0.7 * s, sz: 1.3 * s, ry });
  body.add(geo.sphere(1, 12, 6), mixHex(sand, SNOW, 0.75), x, 0.18 * s, z, { sx: 1.5 * s, sy: 0.5 * s, sz: 0.6 * s, ry });
}

/** Era 8: a row of three tilted teal solar panels on cream stands, snow on the top edge and a mint status light. */
export function solarRow(body: Batch, glow: Batch, x: number, z: number, s: number): void {
  const p = palette(8);
  for (let i = -1; i <= 1; i++) {
    const px = x + i * 1.9 * s;
    body.add(geo.box(0.12 * s, 0.7 * s, 0.12 * s), p.city!.trim, px, 0.35 * s, z);
    body.add(geo.box(1.7 * s, 0.08 * s, 1.1 * s), 0x4b86a0, px, 0.82 * s, z, { rx: -0.45 });
    body.add(geo.box(1.6 * s, 0.03 * s, 0.9 * s), 0x7fb7c8, px, 0.87 * s, z + 0.02 * s, { rx: -0.45 });
    body.add(geo.box(1.7 * s, 0.08 * s, 0.2 * s), SNOW, px, 1.05 * s, z - 0.42 * s, { rx: -0.45 });
  }
  glow.add(geo.sphere(0.08 * s, 8, 6), p.glow, x + 2.9 * s, 0.75 * s, z);
}

/** Era 8: a silicon boule (a pale blue-grey crystal ingot) resting in a cream cradle. */
export function boule(body: Batch, x: number, z: number, s: number, ry: number): void {
  const p = palette(8);
  body.add(geo.boxBase(0.5 * s, 0.25 * s, 1.0 * s), p.city!.wall, x, 0, z, { ry });
  body.add(geo.capsule(0.32 * s, 1.5 * s, 6, 14), 0xc6d2dc, x, 0.55 * s, z, { rx: Math.PI / 2, ry });
  body.add(geo.sphere(0.2 * s, 10, 6), 0xeef4f8, x, 0.78 * s, z, { sx: 1, sy: 0.4, sz: 3, ry });
}

/** Era 9: a cluster of rounded uranium crystals (soft lumps, no points) in a mint-glazed dish; they glow at night. */
export function crystalCluster(body: Batch, glow: Batch, x: number, z: number, s: number, rng: Rng): void {
  const p = palette(9);
  body.add(geo.cylinder(0.9 * s, 1.0 * s, 0.22 * s, 16), p.floor.yard, x, 0.11 * s, z);
  const lumps = 4;
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * Math.PI * 2 + rng.range(0, 0.6);
    const r = i === 0 ? 0 : 0.42 * s;
    const h = (i === 0 ? 1.0 : rng.range(0.55, 0.75)) * s;
    glow.add(geo.capsule(0.2 * s, h, 4, 8), mixHex(p.glow, 0xb8f07a, 0.35), x + Math.cos(a) * r, 0.22 * s + h * 0.55, z + Math.sin(a) * r, { rz: Math.cos(a) * (i ? 0.35 : 0), rx: -Math.sin(a) * (i ? 0.35 : 0) });
  }
  body.add(geo.sphere(0.32 * s, 10, 6), SNOW, x - 0.4 * s, 0.3 * s, z - 0.3 * s, { sy: 0.4 });
}

/** Era 9: a round aqua cooling pool with a mint-glazed rim (the water glows at night). */
export function aquaPool(body: Batch, glow: Batch, x: number, z: number, s: number): void {
  const p = palette(9);
  body.add(geo.cylinder(1.6 * s, 1.7 * s, 0.32 * s, 24), p.floor.processing, x, 0.16 * s, z);
  body.add(geo.torus(1.5 * s, 0.12 * s, 6, 28), SNOW, x, 0.33 * s, z, { rx: Math.PI / 2 });
  glow.add(geo.cylinder(1.38 * s, 1.38 * s, 0.04 * s, 24), p.glow, x, 0.3 * s, z);
}

/** Era 9: a lead cask, rounded, mint band and snow lid (never a black drum). */
export function cask(body: Batch, x: number, z: number, s: number): void {
  const p = palette(9);
  body.add(geo.cylinder(0.4 * s, 0.4 * s, 0.9 * s, 14), 0xb8c2c4, x, 0.45 * s, z);
  body.add(geo.torus(0.4 * s, 0.05 * s, 6, 18), p.accent, x, 0.62 * s, z, { rx: Math.PI / 2 });
  body.add(geo.sphere(0.4 * s, 12, 6), SNOW, x, 0.9 * s, z, { sy: 0.3 });
}

/** Era 10: a rare-earth geode, a round cream shell split open on a heart of soft glowing crystal pebbles. */
export function geode(body: Batch, glow: Batch, x: number, z: number, s: number, rng: Rng): void {
  const p = palette(10);
  const hearts = [0xb9a3e8, 0xe8a8c0, 0x9fd8e8];
  const c = hearts[Math.floor(rng.next() * hearts.length)]!;
  body.add(geo.sphere(1, 16, 10), mixHex(p.city!.wall2, 0xa898b0, 0.35), x, 0.1 * s, z, { sx: 0.95 * s, sy: 0.62 * s, sz: 0.95 * s });
  body.add(geo.cylinder(0.66 * s, 0.6 * s, 0.06 * s, 18), mixHex(c, 0x6a5a7a, 0.3), x, 0.62 * s, z);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    glow.add(geo.sphere(0.2 * s, 10, 6), c, x + Math.cos(a) * 0.32 * s, 0.68 * s, z + Math.sin(a) * 0.32 * s);
  }
  glow.add(geo.sphere(0.26 * s, 12, 8), mixHex(c, 0xffffff, 0.4), x, 0.74 * s, z);
  body.add(geo.sphere(0.5 * s, 10, 5), SNOW, x - 0.45 * s, 0.55 * s, z - 0.4 * s, { sy: 0.3 });
}

/** Era 10: a helium-3 flask, an ice-blue glass capsule with gold caps on a cream stand, a soft glowing core. */
export function flask(body: Batch, glow: Batch, x: number, z: number, s: number): void {
  const p = palette(10);
  body.add(geo.cylinder(0.42 * s, 0.5 * s, 0.22 * s, 14), p.city!.wall, x, 0.11 * s, z);
  body.add(geo.capsule(0.3 * s, 0.8 * s, 6, 14), 0xd8ecf6, x, 0.9 * s, z);
  body.add(geo.cylinder(0.33 * s, 0.33 * s, 0.14 * s, 14), p.accent, x, 0.32 * s, z);
  body.add(geo.cylinder(0.33 * s, 0.33 * s, 0.14 * s, 14), p.accent, x, 1.5 * s, z);
  body.add(geo.sphere(0.3 * s, 12, 6), SNOW, x, 1.6 * s, z, { sy: 0.35 });
  glow.add(geo.capsule(0.13 * s, 0.5 * s, 4, 10), 0xe6f6ff, x, 0.9 * s, z);
}

/**
 * Era 10: the fusion halo, a floating sun-gold ring over a cream plinth (the era's crown silhouette at landscape scale);
 * the ring and the plinth's heart are lit. Static: the comfort settings never see it move.
 */
export function fusionHalo(body: Batch, glow: Batch, x: number, z: number, s: number): void {
  const p = palette(10);
  body.add(geo.cylinder(1.3 * s, 1.5 * s, 0.5 * s, 20), p.city!.wall, x, 0.25 * s, z);
  body.add(geo.cylinder(1.36 * s, 1.36 * s, 0.1 * s, 20), p.accent, x, 0.55 * s, z);
  body.add(geo.cylinder(1.1 * s, 1.1 * s, 0.1 * s, 20), SNOW, x, 0.62 * s, z);
  glow.add(geo.sphere(0.5 * s, 16, 10), p.light, x, 1.7 * s, z);
  glow.add(geo.torus(1.25 * s, 0.1 * s, 8, 36), p.light, x, 1.7 * s, z, { rx: Math.PI / 2 });
  body.add(geo.torus(1.25 * s, 0.05 * s, 6, 36), p.accent, x, 1.7 * s, z, { rx: Math.PI / 2 + 0.5 });
}

/** A low lamp along a path in the era's light colour (screen mint, aqua, sun-gold). */
export function pathLamp(body: Batch, glow: Batch, n: number, x: number, z: number): void {
  const p = palette(n);
  const pole = p.city!.roof;
  body.add(geo.cylinder(0.06, 0.08, 1.5, 8), pole, x, 0.75, z);
  body.add(geo.cylinder(0.2, 0.22, 0.1, 10), pole, x, 1.52, z);
  glow.add(geo.sphere(0.17, 10, 8), mixHex(p.light, 0xffffff, 0.3), x, 1.66, z);
  body.add(geo.sphere(0.2, 10, 5), SNOW, x, 1.82, z, { sy: 0.35 });
}

// ---------------------------------------------------------------------------------------------------------------------
// layout helpers: where the late eras' belts, props and paths go (zones, never random scatter)
// ---------------------------------------------------------------------------------------------------------------------

const inRect = (q: Rect, x: number, z: number, m: number): boolean => x > q.minX - m && x < q.maxX + m && z > q.minZ - m && z < q.maxZ + m;

/** Front-yard spots a tree must leave clear (facilities, the sign, the arrival point, both gates). */
function frontSpots(l: RegionLayout): { x: number; z: number; r: number }[] {
  return [
    { ...l.depot, r: 4 },
    { ...l.dock, r: 4 },
    { ...l.jack, r: 3.5 },
    { ...l.shopMat, r: 3.5 },
    { x: l.cashSpot.x, z: l.cashSpot.z, r: 3.5 },
    { ...l.sign, r: 3 },
    { ...l.inside, r: 3 },
    { x: l.gate.x, z: l.gate.z, r: l.gate.width / 2 + 3 },
    { x: l.marketGate.x, z: l.marketGate.z, r: l.marketGate.width / 2 + 3 },
  ];
}

/**
 * The tree belt: spots along the region's west strip and its gate (north) strip, the two edges the camera looks
 * toward (-X / -Z), so a tree there never hides a pad, the player or a counter. `step` metres apart, clear of the
 * gates and the front-yard facilities.
 */
export function beltSpots(l: RegionLayout, step: number, rng: Rng): { x: number; z: number; s: number }[] {
  const r = l.rect;
  const out: { x: number; z: number; s: number }[] = [];
  const clear = frontSpots(l);
  const ok = (x: number, z: number): boolean => clear.every((c) => Math.hypot(c.x - x, c.z - z) > c.r);
  const edge = l.gate.side === 'north' ? r.minZ + 1.7 : r.maxZ - 1.7;
  for (let z = r.minZ + 2.2; z < r.maxZ - 1.5; z += step) {
    const x = r.minX + 1.7 + rng.range(-0.15, 0.15);
    if (ok(x, z)) out.push({ x, z, s: rng.range(0.85, 1.12) });
  }
  if (l.gate.side === 'north') {
    for (let x = r.minX + 2.2 + step; x < r.maxX - 2; x += step) {
      const z = edge + rng.range(-0.15, 0.15);
      if (ok(x, z)) out.push({ x, z, s: rng.range(0.8, 1.05) });
    }
  }
  return out;
}

/**
 * Free ground in the harvest zone for a prop of footprint radius `rad` at (x, z): inside the zone, clear of the hand
 * node's patch, the 0.9.7 resource beds, the zone paths and the props already `placed`.
 */
export function harvestFree(l: RegionLayout, P: PlotPlaces, x: number, z: number, rad: number, placed: readonly { x: number; z: number; r: number }[]): boolean {
  const H = l.zones.harvest;
  if (!(x > H.minX + rad + 0.8 && x < H.maxX - rad - 0.8 && z > H.minZ + rad + 0.8 && z < H.maxZ - rad - 0.8)) return false;
  if (x < l.rect.minX + 3.4 + rad) return false; // the tree belt
  if (inRect(nodePatch(l), x, z, rad + 0.6)) return false;
  if (inRect(P.field, x, z, rad + 0.5)) return false;
  if (regionPaths(l).some((q) => inRect(q, x, z, rad + 0.4))) return false;
  return placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + rad);
}

/** Lamp spots along the zone paths, `step` metres apart, set 1.4 m to one side of each path. */
export function pathLampSpots(l: RegionLayout, step: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const q of regionPaths(l)) {
    const alongX = q.maxX - q.minX > q.maxZ - q.minZ;
    if (alongX) for (let x = q.minX + step / 2; x < q.maxX - 1; x += step) out.push({ x, z: q.minZ - 0.4 });
    else for (let z = q.minZ + step / 2; z < q.maxZ - 1; z += step) out.push({ x: q.maxX + 0.4, z });
  }
  const clear = frontSpots(l);
  return out.filter((p) => clear.every((c) => Math.hypot(c.x - p.x, c.z - p.z) > c.r - 1) && !inRect(nodePatch(l), p.x, p.z, 0.5) && !l.slots.some((s) => Math.abs(s.x - p.x) < l.cell / 2 && Math.abs(s.z - p.z) < l.rowPitch / 2));
}

/** The machine grid marks on a processing floor (one cell per slot of the room grid, as plots.ts drew them). */
export function cellMarks(floor: Batch, l: RegionLayout, P: PlotPlaces, color: number, y = FLOOR_Y + 0.009): void {
  const Y = P.yardPave;
  if (!l.slots[0]) return;
  for (let x = Y.minX; x <= Y.maxX + 0.01; x += l.cell) floor.add(geo.box(0.1, 0.004, Y.maxZ - Y.minZ - 0.6), color, Math.min(x, Y.maxX - 0.05), y, (Y.minZ + Y.maxZ) / 2);
  for (let z = Y.minZ + 0.5; z <= Y.maxZ + 0.01; z += l.rowPitch) floor.add(geo.box(Y.maxX - Y.minX - 0.6, 0.004, 0.1), color, (Y.minX + Y.maxX) / 2, y, Math.min(z, Y.maxZ - 0.05));
}

/** A zone rect inset by `m` metres (empty when too small). */
export function inset(q: Rect, m: number): Rect | null {
  const r = { minX: q.minX + m, maxX: q.maxX - m, minZ: q.minZ + m, maxZ: q.maxZ - m };
  return r.maxX - r.minX > 0.5 && r.maxZ - r.minZ > 0.5 ? r : null;
}

/** A flat plain slab over a rect (lawns, forecourts, paths). */
export function slab(floor: Batch, q: Rect, color: number, y = FLOOR_Y): void {
  floor.add(geo.box(q.maxX - q.minX, 0.006, q.maxZ - q.minZ), color, (q.minX + q.maxX) / 2, y, (q.minZ + q.maxZ) / 2);
}
