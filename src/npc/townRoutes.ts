/**
 * [wave 9 — crew in the Market Town] Pure route geometry (no THREE) for the helpers that leave the yard for the
 * market square: the porters (npc/crewHelpers.ts Porter) and the cashiers collecting the town tills.
 *
 * Helpers are scripted waypoint walkers, but the town is only reachable along one chain of walkable rects
 * (LAYOUT.yard → village.walk[0] gate → village.walk[1] street → town.walk[0] corridor → town.walk[1] square), so:
 *   - yard side: a short fixed `leg` from each yard post to GATE_HUB (just inside the village gate),
 *   - TRUNK: gate hub → along the village street → along the corridor → ENTRY (inside the square, by the mouth),
 *   - square side: planSquare() finds a path around the fir, benches, stalls, lamps and every lot's props with a
 *     small grid A* over a `blocked(x, z)` predicate (the game passes ColliderWorld.overlaps; tests pass a replica),
 *     so any lot / business combination works and a later building simply becomes another obstacle.
 * tests/townRoutes.test.ts samples every route against the walk-rect union and the colliders.
 */
import { LAYOUT, type Rect, type XZ } from '../config';

const T = LAYOUT.town;
const V = LAYOUT.village;

/** Just inside the yard, in front of the village gate gap (yard z <= 10, gate walk z 9..11.8, x 3.8..5.4). */
export const GATE_HUB: XZ = { x: 4.6, z: 9.4 };
/** First point inside the square, on the corridor's axis (corridor z 25.9..27.5, square x >= 15.6). */
export const ENTRY: XZ = { x: 16.8, z: 26.7 };
/** Gate hub excluded: street entrance → street end → along the corridor → ENTRY. */
export const TRUNK: readonly XZ[] = [
  { x: 4.6, z: 12.0 },
  { x: 4.6, z: 26.7 },
  ENTRY,
];

/** Yard stops: waypoints from the post (excluded) to GATE_HUB (included). */
export const DROP_LEG: readonly XZ[] = [{ x: 0.5, z: 7.5 }, GATE_HUB];
export const BENCH_LEG: readonly XZ[] = [GATE_HUB];
/** From the cabin mat (cashier home) down the crate runner's x 7.4 lane, clear of the processor bench. */
export const CABIN_LEG: readonly XZ[] = [{ x: 7.4, z: -2.0 }, { x: 7.4, z: 4.0 }, GATE_HUB];

/** Keeps stand points and planned waypoints this far inside the square's rect. */
const INSET = 0.35;
/** Body clearance the game asks ColliderWorld.overlaps for when planning (character radius ~0.3). */
export const CLEARANCE = 0.4;
const STEP = 0.3;

/** The rect walkers keep to inside the square. */
export const SQUARE_WALK: Rect = {
  minX: T.square.minX + INSET,
  maxX: T.square.maxX - INSET,
  minZ: T.square.minZ + INSET,
  maxZ: T.square.maxZ - INSET,
};

/** Every rect a helper may stand on (the walk-rect union of the player, plus the yard). */
export function walkUnion(): Rect[] {
  return [LAYOUT.yard, ...V.walk, ...T.walk];
}

export function inRects(rects: readonly Rect[], x: number, z: number, eps = 1e-6): boolean {
  for (const r of rects) if (x >= r.minX - eps && x <= r.maxX + eps && z >= r.minZ - eps && z <= r.maxZ + eps) return true;
  return false;
}

export function rectCentre(r: Rect): XZ {
  return { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 };
}

/** The point of the square nearest `p` (stand points of zones that reach the square's edge). */
export function clampToSquare(p: XZ): XZ {
  return {
    x: Math.min(SQUARE_WALK.maxX, Math.max(SQUARE_WALK.minX, p.x)),
    z: Math.min(SQUARE_WALK.maxZ, Math.max(SQUARE_WALK.minZ, p.z)),
  };
}

/** [lateral, depth] offsets (metres) for the 1st..4th helper working the same zone (zones are ~1 m wide; a 4th shares the 1st spot rather than risk a prop). */
export const ZONE_SPOTS: readonly (readonly [number, number])[] = [[0, 0], [0.4, 0], [-0.4, 0], [0, 0]];

/** A cashier stands this far in front of a till's zone centre (toward the square), off the pile itself. */
export const TILL_SHIFT = 0.3;

/**
 * Where helper number `index` stands to use a business zone: the zone's centre (clamped into the square) shifted along
 * the lot's lateral / depth axes, plus `extraDepth` toward the square; and the point it faces (toward the building,
 * opposite the lot's `face`).
 */
export function zoneStand(zone: Rect, face: XZ, index = 0, extraDepth = 0): { p: XZ; look: XZ } {
  const c = rectCentre(zone);
  const [lane, depth] = ZONE_SPOTS[Math.min(index, ZONE_SPOTS.length - 1)]!;
  const d = depth + extraDepth;
  const p = clampToSquare({ x: c.x + face.z * lane + face.x * d, z: c.z - face.x * lane + face.z * d });
  return { p, look: { x: p.x - face.x, z: p.z - face.z } };
}

// ---------------------------------------------------------------------------------------------------------------
// Planner inside the square
// ---------------------------------------------------------------------------------------------------------------

export type Blocked = (x: number, z: number) => boolean;

/** True when the straight segment a → b is free (endpoints within `slack` of a / b are not tested). */
function lineClear(a: XZ, b: XZ, blocked: Blocked, slack: number): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / 0.12));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const d = len * t;
    if (d < slack || len - d < slack) continue;
    if (blocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

/**
 * Waypoints from `from` (excluded) to `to` (included) through the square. Straight when clear, else a grid A*
 * (8-connected, no corner cutting) smoothed by line of sight. The two end cells are always walkable (a stand point
 * may be tight against a prop). Falls back to [to] when no path exists.
 */
export function planSquare(from: XZ, to: XZ, blocked: Blocked): XZ[] {
  const slack = 0.5;
  if (lineClear(from, to, blocked, slack)) return [to];
  const R = SQUARE_WALK;
  const cols = Math.floor((R.maxX - R.minX) / STEP) + 1;
  const rows = Math.floor((R.maxZ - R.minZ) / STEP) + 1;
  const cx = (c: number): number => R.minX + c * STEP;
  const cz = (r: number): number => R.minZ + r * STEP;
  const toCol = (x: number): number => Math.max(0, Math.min(cols - 1, Math.round((x - R.minX) / STEP)));
  const toRow = (z: number): number => Math.max(0, Math.min(rows - 1, Math.round((z - R.minZ) / STEP)));
  const start = toRow(from.z) * cols + toCol(from.x);
  const goal = toRow(to.z) * cols + toCol(to.x);
  const free = new Int8Array(cols * rows); // 0 unknown, 1 free, -1 blocked
  const isFree = (i: number): boolean => {
    if (i === start || i === goal) return true;
    let v = free[i]!;
    if (v === 0) {
      v = blocked(cx(i % cols), cz(Math.floor(i / cols))) ? -1 : 1;
      free[i] = v;
    }
    return v > 0;
  };
  const g = new Float32Array(cols * rows).fill(Infinity);
  const came = new Int32Array(cols * rows).fill(-1);
  const closed = new Uint8Array(cols * rows);
  const open: Array<{ i: number; f: number }> = [];
  const push = (i: number, f: number): void => {
    open.push({ i, f });
    let k = open.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (open[p]!.f <= open[k]!.f) break;
      [open[p], open[k]] = [open[k]!, open[p]!];
      k = p;
    }
  };
  const pop = (): number => {
    const top = open[0]!;
    const last = open.pop()!;
    if (open.length > 0) {
      open[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < open.length && open[l]!.f < open[m]!.f) m = l;
        if (r < open.length && open[r]!.f < open[m]!.f) m = r;
        if (m === k) break;
        [open[m], open[k]] = [open[k]!, open[m]!];
        k = m;
      }
    }
    return top.i;
  };
  const gc = goal % cols;
  const gr = Math.floor(goal / cols);
  const h = (i: number): number => Math.hypot((i % cols) - gc, Math.floor(i / cols) - gr) * STEP;
  g[start] = 0;
  push(start, h(start));
  let found = false;
  while (open.length > 0) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) {
      found = true;
      break;
    }
    const c = cur % cols;
    const r = Math.floor(cur / cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (closed[ni] || !isFree(ni)) continue;
        if (dr !== 0 && dc !== 0 && (!isFree(r * cols + nc) || !isFree(nr * cols + c))) continue; // no corner cutting
        const ng = g[cur]! + (dr !== 0 && dc !== 0 ? STEP * Math.SQRT2 : STEP);
        if (ng < g[ni]!) {
          g[ni] = ng;
          came[ni] = cur;
          push(ni, ng + h(ni));
        }
      }
    }
  }
  if (!found) return [to];
  const cells: XZ[] = [];
  for (let i = goal; i !== -1; i = came[i]!) cells.push({ x: cx(i % cols), z: cz(Math.floor(i / cols)) });
  cells.reverse();
  cells[0] = from;
  cells[cells.length - 1] = to;
  // string pulling: from each anchor jump to the farthest cell that is still in clear sight
  const out: XZ[] = [];
  let anchor = 0;
  while (anchor < cells.length - 1) {
    let far = anchor + 1;
    for (let k = cells.length - 1; k > anchor + 1; k--) {
      if (lineClear(cells[anchor]!, cells[k]!, blocked, anchor === 0 ? slack : 0.0)) {
        far = k;
        break;
      }
    }
    out.push(cells[far]!);
    anchor = far;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Stops and travel
// ---------------------------------------------------------------------------------------------------------------

/** A place a helper works from. `leg` = yard waypoints from `p` to GATE_HUB (yard stops); null = inside the square. */
export interface Stop {
  p: XZ;
  leg: readonly XZ[] | null;
}

const same = (a: XZ, b: XZ): boolean => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;

/** Drop consecutive duplicates. */
function dedupe(from: XZ, pts: XZ[]): XZ[] {
  const out: XZ[] = [];
  let prev = from;
  for (const p of pts) {
    if (same(prev, p)) continue;
    out.push(p);
    prev = p;
  }
  return out;
}

/** Waypoints after `a.p` ending at `b.p`, along walkable ground only. */
export function travel(a: Stop, b: Stop, blocked: Blocked): XZ[] {
  if (a.leg === null && b.leg === null) return dedupe(a.p, planSquare(a.p, b.p, blocked));
  if (a.leg !== null && b.leg !== null) {
    if (a.leg === b.leg) return dedupe(a.p, [b.p]);
    return dedupe(a.p, [...a.leg, ...[...b.leg].reverse(), b.p]);
  }
  if (a.leg !== null && b.leg === null) {
    return dedupe(a.p, [...a.leg, ...TRUNK, ...planSquare(ENTRY, b.p, blocked)]);
  }
  // square → yard
  return dedupe(a.p, [...planSquare(a.p, ENTRY, blocked), ...[...TRUNK].reverse().slice(1), ...[...b.leg!].reverse(), b.p]);
}

/** Route length in metres (for tests and job scoring). */
export function routeLength(from: XZ, pts: readonly XZ[]): number {
  let d = 0;
  let prev = from;
  for (const p of pts) {
    d += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
  return d;
}
