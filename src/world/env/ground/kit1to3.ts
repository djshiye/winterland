/**
 * [0.9.8 — 10a] Shared pieces of the era 1-3 base boards (world/env/ground/era01..03.ts): slab and fieldstone floors,
 * stepping-stone paths, snow drifts, lanterns, and the small tree / rock models the eras instance. Every colour is
 * passed in by the era file, which takes it from render/palette.ts (mixHex / shade on its palette row).
 *
 * Heights: the board tile lies at y 0.014; floors and paths stay at or below a 0.04 top so every pad, mat and counter
 * (all above 0.04) still sits on top of them.
 */
import * as THREE from 'three';
import type { Rect } from '../../../config';
import { Batch } from '../../../render/batch';
import { geo } from '../../../render/materials';
import { mixHex, SNOW } from '../../../render/palette';
import type { RegionLayout } from '../../../eras/layout';
import type { Rng } from '../common';
import type { GroundKit } from '../eraGround';

/** Multiply a hex colour's channels by k (clamped). */
export function shade(c: number, k: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 0xff) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 0xff) * k));
  const b = Math.min(255, Math.round((c & 0xff) * k));
  return (r << 16) | (g << 8) | b;
}

const BOX = (): THREE.BufferGeometry => geo.box(1, 1, 1);

/** A flat box (top at `top`) w × d, rotated `ry`. */
export function slab(b: Batch, color: number, x: number, z: number, w: number, d: number, top: number, h = 0.012, ry = 0): void {
  b.add(BOX(), color, x, top - h / 2, z, { sx: w, sy: h, sz: d, ry });
}

/** How far toward −X / −Z a solid of height h hides the ground from the isometric camera (pitch 48°). */
export const camReach = (h: number): number => h / Math.tan((48 * Math.PI) / 180) / Math.SQRT2;

/**
 * True when a piece of radius r and height h at (x, z) stays off rect q and its camera shadow (the ground it hides
 * toward −X / −Z) misses q too: q grown by the reach on its +X / +Z sides.
 */
export function clearOf(q: Rect, x: number, z: number, r: number, h: number, m = 0.4): boolean {
  const reach = camReach(h);
  return !(x > q.minX - r - m && x < q.maxX + reach + r + m && z > q.minZ - r - m && z < q.maxZ + reach + r + m);
}

/** True when (x, z) lies within `m` of rect q. */
export const near = (q: Rect, x: number, z: number, m = 0): boolean => x > q.minX - m && x < q.maxX + m && z > q.minZ - m && z < q.maxZ + m;

/**
 * Cut slabs on a mortar bed, laid cell by cell over the processing floor so the machine cells read without lines: each
 * cell gets a `per` × `per` grid of slabs, and the joints between cells are wider and darker.
 */
export function cellSlabs(k: GroundKit, l: RegionLayout, Y: Rect, c: { mortar: number; slab: number; joint: number }, rng: Rng, per = 4): void {
  const w = Y.maxX - Y.minX;
  const d = Y.maxZ - Y.minZ;
  slab(k.floor, c.mortar, (Y.minX + Y.maxX) / 2, (Y.minZ + Y.maxZ) / 2, w, d, 0.03, 0.016);
  const z0 = Y.minZ + 0.5;
  for (let cx = Y.minX; cx < Y.maxX - 0.5; cx += l.cell) {
    const cw = Math.min(l.cell, Y.maxX - cx);
    for (let cz = z0; cz < Y.maxZ - 0.5; cz += l.rowPitch) {
      const cd = Math.min(l.rowPitch, Y.maxZ - cz);
      // the joint frame round the cell
      slab(k.floor, c.joint, cx + cw / 2, cz + cd / 2, cw - 0.1, cd - 0.1, 0.034, 0.004);
      const sw = (cw - 0.5) / per;
      const sd = (cd - 0.5) / per;
      for (let i = 0; i < per; i++) {
        for (let j = 0; j < per; j++) {
          const t = rng.range(0.92, 1.06);
          slab(k.floor, shade(c.slab, t), cx + 0.25 + (i + 0.5) * sw, cz + 0.25 + (j + 0.5) * sd, sw - 0.1, sd - 0.1, 0.038, 0.004);
        }
      }
    }
    // the strip before the first row (the pave starts 0.5 m above the first cell)
    slab(k.floor, shade(c.slab, 0.96), cx + cw / 2, Y.minZ + 0.25, cw - 0.2, 0.36, 0.036, 0.004);
  }
}

/** Irregular fieldstones over a mortar bed filling rect R (staggered courses of uneven stones). */
export function fieldstones(k: GroundKit, R: Rect, c: { mortar: number; stones: readonly number[] }, rng: Rng, size = 1.1): void {
  const w = R.maxX - R.minX;
  const d = R.maxZ - R.minZ;
  slab(k.floor, c.mortar, (R.minX + R.maxX) / 2, (R.minZ + R.maxZ) / 2, w, d, 0.03, 0.016);
  for (let z = R.minZ + 0.1, row = 0; z < R.maxZ - 0.3; row++) {
    const sd = Math.min(rng.range(size * 0.7, size * 1.05), R.maxZ - 0.08 - z);
    let x = R.minX + 0.1 - (row % 2) * size * 0.45;
    while (x < R.maxX - 0.3) {
      const sw = rng.range(size * 0.75, size * 1.4);
      const x0 = Math.max(x, R.minX + 0.08);
      const x1 = Math.min(x + sw, R.maxX - 0.08);
      if (x1 - x0 > 0.3 && sd > 0.3) {
        const col = c.stones[Math.floor(rng.next() * c.stones.length)]!;
        slab(k.floor, shade(col, rng.range(0.94, 1.05)), (x0 + x1) / 2, z + sd / 2, x1 - x0 - 0.1, sd - 0.1, 0.038, 0.006, rng.range(-0.04, 0.04));
      }
      x += sw;
    }
    z += sd;
  }
}

/** A path of irregular stepping flags zig-zagging along rect q, on a darker bed. */
export function steppingPath(k: GroundKit, q: Rect, c: { bed: number; stone: number }, rng: Rng, spacing = 0.95): void {
  const w = q.maxX - q.minX;
  const d = q.maxZ - q.minZ;
  slab(k.floor, c.bed, (q.minX + q.maxX) / 2, (q.minZ + q.maxZ) / 2, w, d, 0.028, 0.01);
  const alongX = w >= d;
  const len = alongX ? w : d;
  const across = alongX ? d : w;
  const off = across > 1.6 ? across * 0.17 : 0;
  for (let t = spacing * 0.5, i = 0; t < len - 0.3; t += spacing * rng.range(0.9, 1.1), i++) {
    const a = (alongX ? q.minX : q.minZ) + t;
    const o = (alongX ? (q.minZ + q.maxZ) / 2 : (q.minX + q.maxX) / 2) + (i % 2 ? off : -off) + rng.range(-0.1, 0.1);
    const r = rng.range(0.42, 0.56);
    k.floor.add(geo.circleGround(1, 7), shade(c.stone, rng.range(0.92, 1.06)), alongX ? a : o, 0.036 + rng.range(0, 0.002), alongX ? o : a, { sx: r * rng.range(1.05, 1.35), sz: r, ry: rng.range(0, 3) });
  }
}

/** A soft snow patch lying on the board: a white heart with a thinner, board-tinted rim. */
export function snowPatch(k: GroundKit, x: number, z: number, r: number, rng: Rng, board = SNOW): void {
  const sx = r * rng.range(1.0, 1.5);
  const ry = rng.range(0, 3);
  k.floor.add(geo.circleGround(1, 14), mixHex(SNOW, board, 0.45), x, 0.02, z, { sx: sx * 1.25, sz: r * 1.25, ry });
  k.floor.add(geo.circleGround(1, 14), SNOW, x, 0.021 + rng.range(0, 0.001), z, { sx, sz: r, ry });
}

let drift: THREE.BufferGeometry | null = null;
/** A low rounded snow drift (≈ 2 m × 0.45 m). */
export function driftGeo(): THREE.BufferGeometry {
  if (!drift) {
    const b = new Batch();
    b.add(geo.sphere(1, 12, 6), SNOW, 0, 0, 0, { sx: 1.1, sy: 0.42, sz: 0.7 });
    b.add(geo.sphere(1, 10, 6), mixHex(SNOW, 0xdfe8f4, 0.4), 0.8, -0.05, 0.25, { sx: 0.6, sy: 0.32, sz: 0.5 });
    drift = b.geometry();
  }
  return drift;
}

/** Drifts along a fence run (inside the region), skipping spans within `skip` rects. */
export function fenceDrifts(k: GroundKit, a: { x: number; z: number }, b: { x: number; z: number }, rng: Rng, skip: readonly Rect[], every = 5.5): void {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ry = Math.atan2(-(b.z - a.z), b.x - a.x);
  for (let t = rng.range(1, 3); t < len - 1; t += rng.range(every * 0.7, every * 1.4)) {
    const x = a.x + ((b.x - a.x) * t) / len;
    const z = a.z + ((b.z - a.z) * t) / len;
    if (skip.some((q) => near(q, x, z, 1.2))) continue;
    const s = rng.range(0.7, 1.25);
    k.put('drift', driftGeo, { x, z, ry: ry + rng.range(-0.2, 0.2), sx: s, sy: s * rng.range(0.8, 1.1), sz: s }, false);
  }
}

/**
 * A lantern on a post (1.5 m): solid post and cap into k.solid, the pane into k.glow, a night halo + warm pool.
 * `style`: 'stone' (a squat stone lantern), 'iron' (a forge-iron cage on a post), 'timber' (a log post with a hook).
 */
export function lantern(k: GroundKit, x: number, z: number, style: 'stone' | 'iron' | 'timber', c: { body: number; dark: number; light: number }): void {
  const s = k.solid;
  if (style === 'stone') {
    s.add(BOX(), shade(c.body, 0.9), x, 0.12, z, { sx: 0.62, sy: 0.24, sz: 0.62 });
    s.add(geo.cylinder(0.13, 0.16, 0.7, 8), c.body, x, 0.59, z);
    s.add(BOX(), c.body, x, 0.98, z, { sx: 0.56, sy: 0.08, sz: 0.56 });
    k.glow.add(BOX(), c.light, x, 1.18, z, { sx: 0.44, sy: 0.34, sz: 0.44 });
    s.add(geo.cone(0.5, 0.28, 4), shade(c.body, 0.85), x, 1.48, z, { ry: Math.PI / 4 });
    s.add(geo.cone(0.38, 0.16, 4), SNOW, x, 1.6, z, { ry: Math.PI / 4 });
    k.lamps.push({ x, y: 1.2, z, size: 1.5, pool: 4.2 });
  } else if (style === 'iron') {
    s.add(geo.cylinder(0.06, 0.08, 1.6, 6), c.dark, x, 0.8, z);
    s.add(BOX(), c.dark, x, 1.62, z, { sx: 0.42, sy: 0.05, sz: 0.42 });
    k.glow.add(BOX(), c.light, x, 1.8, z, { sx: 0.34, sy: 0.34, sz: 0.34 });
    for (const [dx, dz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]] as const) s.add(BOX(), c.dark, x + dx, 1.8, z + dz, { sx: 0.04, sy: 0.36, sz: 0.04 });
    s.add(geo.cone(0.3, 0.2, 4), c.dark, x, 2.06, z, { ry: Math.PI / 4 });
    s.add(geo.cone(0.22, 0.1, 4), SNOW, x, 2.13, z, { ry: Math.PI / 4 });
    k.lamps.push({ x, y: 1.8, z, size: 1.6, pool: 4.6 });
  } else {
    s.add(geo.cylinder(0.11, 0.13, 1.7, 7), c.body, x, 0.85, z);
    s.add(BOX(), c.body, x + 0.22, 1.62, z, { sx: 0.5, sy: 0.08, sz: 0.08 });
    s.add(geo.cylinder(0.13, 0.13, 0.05, 8), SNOW, x, 1.73, z);
    k.glow.add(geo.cylinder(0.11, 0.13, 0.26, 8), c.light, x + 0.4, 1.38, z);
    s.add(geo.cone(0.17, 0.12, 8), c.dark, x + 0.4, 1.57, z);
    k.lamps.push({ x: x + 0.4, y: 1.38, z, size: 1.4, pool: 4.0 });
  }
}
