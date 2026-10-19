/**
 * 0.9.12: where the era buyer vehicles drive (npc/EraBuyers.ts). Pure: no THREE, no GameContext.
 *
 * Before, a buyer popped into being on the road a few metres from its market and popped out again a few metres past
 * it, in plain view ("customers vanish in the middle of the road"). Now every buyer follows one ROUTE over the real
 * road network, from far up the road to far down it, so it can appear and disappear out of the player's view (the
 * queue decides where along the route, npc/EraBuyers.ts):
 *
 *   approach  in from the network: era I-IV's road R1 is fed by the city's west street (from the city, north), R2 by
 *             the east link once it is open (else from R2's own east end), R3 up the east link from R2
 *   drive     along the market road's DRIVE lane (the fence half), every buyer heading −X
 *   merge     an S-bend into the STOP lane (the road's outer half, away from the fence: parked vehicles no longer
 *             stand over the region fence, review C1) and up to the counter; the queue grows back toward +X
 *   pull out  an S-bend back into the drive lane past the counter
 *   depart    on along the road (and down the west link, R1, when it is open) to the route's END, a road end
 *
 * Through traffic of other eras keeps to the drive lane, so it never drives through a parked queue. The route is a
 * dense polyline (0.5 m steps) with filleted corners, so a vehicle posed at distance `s` faces along `headingAt(s)`.
 */
import { ROADS, type ERect } from './data';
import type { XZ } from './layout';

/** Half of a market road the vehicles keep to: lane centre this far in from the road's edge. */
export const LANE_INSET = 1.0;
/** Corner radius of the route's turns (roads are 4 m wide). */
const FILLET = 2.4;
/** Length of a lane change (merge into the stop lane / pull back out). */
const LANE_CHANGE = 7;
const STEP = 0.5;

export interface BuyerRoute {
  /** Dense polyline in driving order. */
  readonly pts: readonly XZ[];
  /** Cumulative distance at each point. */
  readonly s: readonly number[];
  /** Total length (the route's END: a road end, where a vehicle still in view waits). */
  readonly length: number;
  /** Distance of the front queue slot (the bed at the counter). Slot i sits at sFront − i·spacing. */
  readonly sFront: number;
  /** Where the merge into the stop lane begins: a vehicle may only appear before this. */
  readonly sMerge: number;
  /** Where the pull-out is back in the drive lane: a leaving vehicle may only vanish past this. */
  readonly sOut: number;
  readonly driveZ: number;
  readonly stopZ: number;
}

const road = (id: string): ERect => ROADS.find((r) => r.id === id)!.rect;
const midX = (r: ERect): number => (r.minX + r.maxX) / 2;

/**
 * The route of era `n`'s buyers on road `roadId` with the front slot's vehicle origin at `frontX` and `slots` queue
 * places `spacing` apart. `open(id)` says which roads are open (frontier.ts roadOpen).
 */
export function buyerRoute(roadId: string, frontX: number, slots: number, spacing: number, open: (id: string) => boolean): BuyerRoute {
  const R = road(roadId);
  const driveZ = R.maxZ - LANE_INSET;
  const stopZ = R.minZ + LANE_INSET;
  const ctrl: XZ[] = [];
  // ---- approach: down a feeder road onto the drive lane at the road's east end
  let eastX = R.maxX - 1;
  if (roadId === 'r1') {
    const cw = road('cityWest');
    eastX = midX(cw);
    ctrl.push({ x: eastX, z: cw.minZ + 0.6 });
  } else if (roadId === 'r2' && open('eastLink')) {
    const el = road('eastLink');
    eastX = el.minX + LANE_INSET;
    ctrl.push({ x: eastX, z: road('r3').minZ - 2 });
  } else if (roadId === 'r3' && open('eastLink')) {
    const el = road('eastLink');
    eastX = el.maxX - LANE_INSET;
    ctrl.push({ x: eastX, z: road('r2').maxZ + 2 });
  }
  const tailX = frontX + (slots - 1) * spacing;
  // the merge starts LANE_CHANGE before the last slot; a queue that reaches back to the feeder's corner (era II, by
  // the city's west street) has no room for it, so the turn off the feeder goes straight into the stop lane
  const feeder = ctrl.length > 0;
  const direct = feeder && eastX - FILLET - 0.6 - (tailX + 3) < LANE_CHANGE;
  ctrl.push({ x: eastX, z: direct ? stopZ : driveZ });
  const mergeFrom = direct ? tailX + 3 : Math.min(tailX + 3 + LANE_CHANGE, feeder ? eastX - FILLET - 0.6 : eastX);
  const mergeTo = direct ? mergeFrom : Math.min(tailX + 3, mergeFrom - 3);
  // ---- depart: the pull-out, then on to the west end (R1: down the west link once it is open)
  const outFrom = frontX - 2.5;
  const outTo = outFrom - LANE_CHANGE;
  const westX = roadId === 'r1' || roadId === 'r2' ? midX(road('westLink')) : R.minX + 1;
  const tail: XZ[] = [{ x: westX, z: driveZ }];
  if (roadId === 'r1' && open('westLink')) tail.push({ x: westX, z: road('r2').minZ - 8 });

  // ---- sample: straight runs + filleted corners, lane changes as smooth S-bends
  const pts: XZ[] = [];
  const add = (p: XZ): void => {
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(q.x - p.x, q.z - p.z) > 1e-6) pts.push(p);
  };
  const line = (a: XZ, b: XZ): void => {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP));
    for (let i = 0; i <= n; i++) add({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n });
  };
  const sBend = (x0: number, z0: number, x1: number, z1: number): void => {
    const n = Math.max(2, Math.ceil(Math.abs(x1 - x0) / STEP));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      add({ x: x0 + (x1 - x0) * t, z: z0 + ((z1 - z0) * (1 - Math.cos(Math.PI * t))) / 2 });
    }
  };
  /** A polyline through `c` with every inner corner rounded by FILLET. */
  const polyline = (c: readonly XZ[]): void => {
    if (c.length === 1) return add(c[0]!);
    let from = c[0]!;
    for (let i = 1; i < c.length; i++) {
      const p = c[i]!;
      const next = c[i + 1];
      if (!next) {
        line(from, p);
        break;
      }
      const ax = from.x - p.x;
      const az = from.z - p.z;
      const bx = next.x - p.x;
      const bz = next.z - p.z;
      const la = Math.hypot(ax, az);
      const lb = Math.hypot(bx, bz);
      const r = Math.min(FILLET, la * 0.45, lb * 0.45);
      const enter = { x: p.x + (ax / la) * r, z: p.z + (az / la) * r };
      const exit = { x: p.x + (bx / lb) * r, z: p.z + (bz / lb) * r };
      line(from, enter);
      // quadratic Bézier enter → corner → exit (a smooth quarter turn for the right-angled road corners)
      const n = Math.max(4, Math.ceil((r * 1.6) / STEP));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const u = 1 - t;
        add({ x: u * u * enter.x + 2 * u * t * p.x + t * t * exit.x, z: u * u * enter.z + 2 * u * t * p.z + t * t * exit.z });
      }
      from = exit;
    }
  };
  if (direct) polyline([...ctrl, { x: mergeTo, z: stopZ }]);
  else {
    polyline([...ctrl, { x: mergeFrom, z: driveZ }]);
    sBend(mergeFrom, driveZ, mergeTo, stopZ);
  }
  line({ x: mergeTo, z: stopZ }, { x: outFrom, z: stopZ });
  sBend(outFrom, stopZ, outTo, driveZ);
  polyline([{ x: outTo, z: driveZ }, ...tail]);

  const s: number[] = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  const at = (x: number, z: number): number => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i]!.x - x, pts[i]!.z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    // exact: project onto the segment from that point on
    const i = Math.min(best, pts.length - 2);
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const len = s[i + 1]! - s[i]!;
    return s[i]! + (len > 0 ? ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / len : 0);
  };
  return {
    pts,
    s,
    length: s[s.length - 1]!,
    sFront: at(frontX, stopZ),
    sMerge: direct ? at(eastX, stopZ) - FILLET - 1 : at(mergeFrom, driveZ),
    sOut: at(outTo, driveZ),
    driveZ,
    stopZ,
  };
}

/** Index of the last point at or before distance `d` (binary search). */
function seg(r: BuyerRoute, d: number): number {
  let lo = 0;
  let hi = r.s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (r.s[mid]! <= d) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(lo, r.s.length - 2);
}

/** World point at distance `d` along the route (clamped to its ends). */
export function pointAt(r: BuyerRoute, d: number, out: XZ = { x: 0, z: 0 }): XZ {
  const c = Math.max(0, Math.min(r.length, d));
  const i = seg(r, c);
  const a = r.pts[i]!;
  const b = r.pts[i + 1]!;
  const len = r.s[i + 1]! - r.s[i]!;
  const t = len > 0 ? (c - r.s[i]!) / len : 0;
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

const tA: XZ = { x: 0, z: 0 };
const tB: XZ = { x: 0, z: 0 };
/** Unit travel direction at distance `d` (a short look either side, so the turn through a corner is smooth). */
export function headingAt(r: BuyerRoute, d: number, out: XZ = { x: 0, z: 0 }): XZ {
  const span = 0.9;
  const a = pointAt(r, Math.min(d - span, r.length - 2 * span), tA);
  const b = pointAt(r, Math.max(d + span, 2 * span), tB);
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  out.x = (b.x - a.x) / l;
  out.z = (b.z - a.z) / l;
  return out;
}

/** Whether road `id` is open at era `age` once the new land shows (world/env/frontier.ts roadOpen, for a reached era). */
export function roadOpenAt(age: number, id: string): boolean {
  const r = ROADS.find((q) => q.id === id);
  return !!r && (r.opensAt <= 2 || age >= r.opensAt - 1);
}
