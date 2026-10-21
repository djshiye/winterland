/**
 * 0.9.13 (review idea 4): the loops the city's street vehicles drive. Pure data (no THREE, no GameContext).
 *
 * The city is a 3×3 grid of districts with 4 m streets between them (eras/data.ts CITY_GRID). Only two blocks are
 * closed in by city streets on all four sides (row 0 has no street north of it, column 2 none east, and the south edge
 * is road R2, which belongs to the era buyers): the block of district 5 (cityWest, cityV1, cityH1, cityH2) and the block
 * of district 6 (cityV1, cityV2, cityH1, cityH2). Each loop runs in the lane on its OWN block's side of every street
 * (the district rect grown by LANE m, corners rounded with CORNER_R), so the two loops share cityV1 in opposite lanes
 * (2 m apart) and never meet. A loop exists once all four of its streets are open (eras/traffic.ts roadOpenAt).
 *
 * The direction is clockwise as seen from above (x east, z south): +x along the north edge, +z down the east edge, so the
 * block is always on the driver's right (right-hand traffic, like the lane the era buyers use). Each loop also lists the
 * districts whose vehicle drives it (the streets beside them).
 */
import { DISTRICTS, type ERect } from '../eras/data';
import { roadOpenAt } from '../eras/traffic';

/** Lane centre this far out from the block's district rect (m): the middle of the lane half of a 4 m street. */
export const LANE = 1.0;
/** Corner radius (m): the arc is centred on the district's own corner, so it can't clip the district. */
const CORNER_R = 1.0;
const ARC_STEPS = 6;

export interface StreetLoop {
  readonly id: string;
  /** Districts whose vehicle drives this loop. */
  readonly districts: readonly number[];
  /** Streets that must be open for the loop to exist. */
  readonly roads: readonly string[];
  /** Closed polyline: the last point equals the first. */
  readonly x: readonly number[];
  readonly z: readonly number[];
  /** Distance along the loop at each point (cum[0] = 0, last = length). */
  readonly cum: readonly number[];
  readonly length: number;
}

/** Block rects (district `block`) and who drives each loop. */
const DEFS: readonly { id: string; block: number; roads: readonly string[]; districts: readonly number[] }[] = [
  { id: 'block5', block: 5, roads: ['cityWest', 'cityV1', 'cityH1', 'cityH2'], districts: [2, 4, 5, 8] },
  { id: 'block6', block: 6, roads: ['cityV1', 'cityV2', 'cityH1', 'cityH2'], districts: [3, 6, 7, 9, 10] },
];

/** The loop round rect `r` grown by LANE, clockwise from above, rounded at the corners. */
function build(id: string, r: ERect, roads: readonly string[], districts: readonly number[]): StreetLoop {
  const g = { minX: r.minX - LANE, maxX: r.maxX + LANE, minZ: r.minZ - LANE, maxZ: r.maxZ + LANE };
  const x: number[] = [];
  const z: number[] = [];
  // corner arcs (centre, start angle in the (x, z) plane; increasing angle turns clockwise seen from above)
  const corners: [number, number, number][] = [
    [g.maxX - CORNER_R, g.minZ + CORNER_R, -Math.PI / 2], // north-east
    [g.maxX - CORNER_R, g.maxZ - CORNER_R, 0], // south-east
    [g.minX + CORNER_R, g.maxZ - CORNER_R, Math.PI / 2], // south-west
    [g.minX + CORNER_R, g.minZ + CORNER_R, Math.PI], // north-west
  ];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= ARC_STEPS; i++) {
      const a = a0 + ((Math.PI / 2) * i) / ARC_STEPS;
      x.push(cx + Math.cos(a) * CORNER_R);
      z.push(cz + Math.sin(a) * CORNER_R);
    }
  }
  x.push(x[0]!);
  z.push(z[0]!);
  const cum = [0];
  for (let i = 1; i < x.length; i++) cum.push(cum[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, z[i]! - z[i - 1]!));
  return { id, districts, roads, x, z, cum, length: cum[cum.length - 1]! };
}

const cache = new Map<number, readonly StreetLoop[]>();

/** The loops that exist at era `age` (those whose four streets are open). Cached per age. */
export function streetLoops(age: number): readonly StreetLoop[] {
  let out = cache.get(age);
  if (!out) {
    out = DEFS.filter((d) => d.roads.every((id) => roadOpenAt(age, id))).map((d) => build(d.id, DISTRICTS[d.block]!.rect, d.roads, d.districts));
    cache.set(age, out);
  }
  return out;
}

/** Index of the segment holding `s` (already wrapped into [0, length)). */
function segAt(loop: StreetLoop, s: number): number {
  let lo = 0;
  let hi = loop.cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (loop.cum[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const wrap = (loop: StreetLoop, s: number): number => ((s % loop.length) + loop.length) % loop.length;

/** Point at distance `s` along the loop (wraps modulo its length). */
export function loopPoint(loop: StreetLoop, s: number, out: { x: number; z: number }): { x: number; z: number } {
  const w = wrap(loop, s);
  const i = segAt(loop, w);
  const len = loop.cum[i + 1]! - loop.cum[i]!;
  const f = len > 0 ? (w - loop.cum[i]!) / len : 0;
  out.x = loop.x[i]! + (loop.x[i + 1]! - loop.x[i]!) * f;
  out.z = loop.z[i]! + (loop.z[i + 1]! - loop.z[i]!) * f;
  return out;
}

/** Unit direction of travel at distance `s` (that of the segment holding it). */
export function loopHeading(loop: StreetLoop, s: number, out: { x: number; z: number }): { x: number; z: number } {
  const i = segAt(loop, wrap(loop, s));
  const dx = loop.x[i + 1]! - loop.x[i]!;
  const dz = loop.z[i + 1]! - loop.z[i]!;
  const l = Math.hypot(dx, dz) || 1;
  out.x = dx / l;
  out.z = dz / l;
  return out;
}
