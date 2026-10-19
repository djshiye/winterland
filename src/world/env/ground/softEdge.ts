/**
 * [0.9.12] Two small shared dressings for the base boards, both flat / tiny and drawn into the era's existing GroundKit
 * batches (no extra draw calls):
 * - `softEdge` (audit T2): a thin, broken strip of scattered pebbles and snow where two floor materials meet, so the join
 *   is no longer a ruler-straight line.
 * - `pathEnds` (audit C5): every zone path that would stop dead in plain ground ends in a small round pad with a bench.
 */
import type { Rect } from '../../../config';
import type { RegionLayout } from '../../../eras/layout';
import { geo } from '../../../render/materials';
import { SNOW, mixHex, palette } from '../../../render/palette';
import type { Rng } from '../common';
import type { GroundKit } from '../eraGround';
import { regionPaths } from '../frontier';

const inAny = (rs: readonly Rect[], x: number, z: number, m: number): boolean => rs.some((q) => x > q.minX - m && x < q.maxX + m && z > q.minZ - m && z < q.maxZ + m);

/** The four strips along a region's fence (1.6 m inside, 2 m outside): floors end at the fence, they do not meet another floor there. */
export function fenceStrips(l: RegionLayout): Rect[] {
  const r = l.rect;
  const w = 1.6;
  const o = 2;
  return [
    { minX: r.minX - o, maxX: r.minX + w, minZ: r.minZ - o, maxZ: r.maxZ + o },
    { minX: r.maxX - w, maxX: r.maxX + o, minZ: r.minZ - o, maxZ: r.maxZ + o },
    { minX: r.minX - o, maxX: r.maxX + o, minZ: r.minZ - o, maxZ: r.minZ + w },
    { minX: r.minX - o, maxX: r.maxX + o, minZ: r.maxZ - w, maxZ: r.maxZ + o },
  ];
}

/**
 * Scatter pebbles (`stone`) and snow crumbs along the four sides of rect `q`, straddling the line, skipping `skip` rects
 * (gates, paths, pads). About two flat discs per metre of edge.
 */
export function softEdge(k: GroundKit, q: Rect, rng: Rng, c: { stone: number; snow?: number }, skip: readonly Rect[] = [], y = 0.0405): void {
  const snow = c.snow ?? SNOW;
  const drop = (x: number, z: number): void => {
    if (inAny(skip, x, z, 0.3) || rng.next() < 0.15) return;
    const isSnow = rng.next() < 0.4;
    const r = rng.range(0.12, isSnow ? 0.36 : 0.26);
    k.floor.add(geo.circleGround(1, 7), isSnow ? snow : mixHex(c.stone, rng.next() < 0.5 ? 0xffffff : 0x000000, rng.range(0.04, 0.16)), x, y + (isSnow ? 0.0006 : 0), z, { sx: r * rng.range(1, 1.5), sz: r, ry: rng.range(0, 3) });
  };
  for (let x = q.minX + 0.2; x < q.maxX - 0.2; x += rng.range(0.3, 0.65)) {
    drop(x, q.minZ + rng.range(-0.5, 0.4));
    drop(x, q.maxZ + rng.range(-0.4, 0.5));
  }
  for (let z = q.minZ + 0.2; z < q.maxZ - 0.2; z += rng.range(0.3, 0.65)) {
    drop(q.minX + rng.range(-0.5, 0.4), z);
    drop(q.maxX + rng.range(-0.4, 0.5), z);
  }
}

/**
 * The dead ends of a region's zone paths (regionPaths): the two west ends (a path stops 1 m short of the west fence) and
 * the far end of the cross path (1 m short of the far fence). Each gets a round pad in the era's path tones, a pale rim and
 * a little bench facing back along the path, so the path ends at somewhere to sit. `keep` rects are left alone.
 */
export function pathEnds(k: GroundKit, l: RegionLayout, keep: readonly Rect[] = []): void {
  const p = palette(l.n);
  const paths = regionPaths(l);
  const pad = mixHex(p.floor.yard, SNOW, 0.42);
  const rim = mixHex(pad, SNOW, 0.55);
  const wood = mixHex(p.fence, p.floor.board, 0.25);
  const R = 1.5;
  const ends: { x: number; z: number; ax: number; az: number }[] = [];
  for (const q of [paths[0]!, paths[2]!]) ends.push({ x: q.minX + R, z: (q.minZ + q.maxZ) / 2, ax: -1, az: 0 });
  const v = paths[1]!;
  const far = l.inward > 0 ? v.maxZ : v.minZ;
  ends.push({ x: (v.minX + v.maxX) / 2, z: far - l.inward * R, ax: 0, az: l.inward });
  for (const e of ends) {
    if (inAny(keep, e.x, e.z, 0)) continue;
    k.floor.add(geo.circleGround(R, 28), pad, e.x, 0.0395, e.z);
    k.floor.add(geo.ringGround(R - 0.14, R, 28), rim, e.x, 0.0398, e.z);
    // the bench stands on the far side of the pad, seat toward the path (long side across the path)
    const bx = e.x + e.ax * (R - 0.45);
    const bz = e.z + e.az * (R - 0.45);
    const across = e.ax !== 0; // long side runs along Z when the path runs along X
    const w = across ? { sx: 0.5, sz: 1.5 } : { sx: 1.5, sz: 0.5 };
    k.solid.add(geo.box(1, 1, 1), wood, bx, 0.42, bz, { sx: w.sx, sy: 0.09, sz: w.sz });
    k.solid.add(geo.box(1, 1, 1), mixHex(wood, 0x000000, 0.25), bx + e.ax * 0.22, 0.7, bz + e.az * 0.22, across ? { sx: 0.08, sy: 0.4, sz: 1.5 } : { sx: 1.5, sy: 0.4, sz: 0.08 });
    for (const s of [-0.6, 0.6]) k.solid.add(geo.box(1, 1, 1), mixHex(wood, 0x000000, 0.35), across ? bx : bx + s, 0.2, across ? bz + s : bz, { sx: 0.1, sy: 0.4, sz: 0.1 });
    k.solid.add(geo.box(1, 1, 1), SNOW, bx, 0.48, bz, across ? { sx: 0.4, sy: 0.05, sz: 1.3 } : { sx: 1.3, sy: 0.05, sz: 0.4 });
  }
}
