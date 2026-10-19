/**
 * [T3 — townsfolk] Tiny navigation for the crowd (pure maths, no three.js, testable headless).
 *
 * The settlement is three convex areas joined in a line: the village STREET, the CORRIDOR through the east gap of the
 * village fence, and the market SQUARE (plus the lane that leaves the square's south-east corner, and the yard gate above
 * the street). A route between two points walks through the joining points of the areas in between; each leg is then
 * bent around the few solid props (the big tree, the snowman, the benches, the stalls) with circle detours.
 *
 * Paths are written into a preallocated `Path` (no allocation while planning).
 */
import { AMENITY_IDS, LAYOUT, type AmenityId } from '../config';
import { amenityFrame, amenityToWorld } from '../town/rules';
import { BENCHES, POND_POSTS, SNOWMAN, STALLS } from '../town/spots';
import { GAP_IN, GAP_OUT, inLane, SPINE_X } from '../town/lane';

/** Radius of a person plus a little air (added to every obstacle). */
export const PERSON_MARGIN = 0.36;
const MAX_POINTS = 24;
/**
 * Clearance from the solid itself, without the person margin: what the props of a route's `ignore` owner still block
 * (you may step up to the tree, not walk through it), and the hops into and out of the waypoint graph when the full
 * margin finds no way (see `leg`).
 */
const TIGHT_MARGIN = 0.05;
/** Margins `leg` tries in turn for the hops into and out of the waypoint graph. */
const FALLBACK_MARGINS: readonly number[] = [PERSON_MARGIN, 0.2, TIGHT_MARGIN];

export interface Obstacle {
  /** Capsule axis (a single point when equal): a circle is a capsule of zero length. */
  x: number;
  z: number;
  x2: number;
  z2: number;
  r: number;
  /** Props that own a seat / spot: a person going to it ignores its obstacles. */
  owner: number;
}

/** Owner ids. */
export const OWNER_TREE = 1;
export const OWNER_SNOWMAN = 2;
export const ownerBench = (i: number): number => 10 + i;
export const ownerStall = (i: number): number => 20 + i;
/** Owner of the solid footprint of amenity `id` ('amenity:<id>'): pass it as `ignore` to reach a spot inside it. */
export const ownerAmenity = (id: AmenityId): number => 30 + AMENITY_IDS.indexOf(id);

/** Seats are this far from the bench centre, along the bench. */
export const SEAT_OFFSET = 0.45;

function buildObstacles(): Obstacle[] {
  const out: Obstacle[] = [];
  const T = LAYOUT.town.tree;
  out.push({ x: T.x, z: T.z, x2: T.x, z2: T.z, r: T.r, owner: OWNER_TREE });
  out.push({ x: SNOWMAN.x, z: SNOWMAN.z, x2: SNOWMAN.x, z2: SNOWMAN.z, r: 0.5, owner: OWNER_SNOWMAN });
  // bench (≈1.7 × 0.5) runs perpendicular to its facing yaw; stall counter (≈1.8 × 1.0) too
  BENCHES.forEach((b, i) => {
    const ax = Math.cos(b.yaw);
    const az = -Math.sin(b.yaw);
    out.push({ x: b.x - ax * 0.6, z: b.z - az * 0.6, x2: b.x + ax * 0.6, z2: b.z + az * 0.6, r: 0.3, owner: ownerBench(i) });
  });
  STALLS.forEach((s, i) => {
    const ax = Math.cos(s.yaw);
    const az = -Math.sin(s.yaw);
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    // the counter sits toward the front of the stall footprint
    const cx = s.x + fx * 0.1;
    const cz = s.z + fz * 0.1;
    out.push({ x: cx - ax * 0.4, z: cz - az * 0.4, x2: cx + ax * 0.4, z2: cz + az * 0.4, r: 0.6, owner: ownerStall(i) });
  });
  // the amenities (always present: their pads sit there anyway). A footprint rect becomes a stadium (capsule)
  // along its long side; people walk around it, the pad tiles stay walkable. The café is only its kiosk body (the
  // back, local z -hd + 0.1 .. -hd + 0.74): the stools and tables in front are where the crowd sits, so no
  // `ignore` mask is needed for them.
  for (const id of AMENITY_IDS) {
    const f = amenityFrame(id);
    let { minX, maxX, minZ, maxZ } = f.rect;
    if (id === 'cafe') {
      const kw = Math.min(1.8, f.w - 0.3);
      const a = amenityToWorld(f, -kw / 2, -f.d / 2 + 0.1);
      const b = amenityToWorld(f, kw / 2, -f.d / 2 + 0.74);
      minX = Math.min(a.x, b.x);
      maxX = Math.max(a.x, b.x);
      minZ = Math.min(a.z, b.z);
      maxZ = Math.max(a.z, b.z);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const hx = (maxX - minX) / 2;
    const hz = (maxZ - minZ) / 2;
    // 0.9.10: the snowman park's stadium is 0.2 m fatter so its fenced corners fall inside (walkers cut across one)
    const r = Math.min(hx, hz) + (id === 'snowmanPark' ? 0.2 : 0);
    const hl = Math.max(0, Math.max(hx, hz) - Math.min(hx, hz)); // half length of the capsule axis
    const alongX = hx >= hz;
    out.push({
      x: cx - (alongX ? hl : 0),
      z: cz - (alongX ? 0 : hl),
      x2: cx + (alongX ? hl : 0),
      z2: cz + (alongX ? 0 : hl),
      r,
      owner: ownerAmenity(id),
    });
  }
  // the pond's corner lamp posts stand outside its stadium
  for (const p of POND_POSTS) out.push({ x: p.x, z: p.z, x2: p.x, z2: p.z, r: 0.1, owner: ownerAmenity('pond') });
  return out;
}

export const OBSTACLES: readonly Obstacle[] = buildObstacles();

/** Distance from point to the capsule axis. */
function distPointAxis(px: number, pz: number, o: Obstacle): number {
  const dx = o.x2 - o.x;
  const dz = o.z2 - o.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 < 1e-9 ? 0 : Math.min(1, Math.max(0, ((px - o.x) * dx + (pz - o.z) * dz) / l2));
  return Math.hypot(px - (o.x + dx * t), pz - (o.z + dz * t));
}

/** Smallest distance between segment A→B and the obstacle axis (Ericson 5.1.9 in 2D). */
function distSegmentAxis(ax: number, az: number, bx: number, bz: number, o: Obstacle): number {
  const d1x = bx - ax;
  const d1z = bz - az;
  const d2x = o.x2 - o.x;
  const d2z = o.z2 - o.z;
  const rx = ax - o.x;
  const rz = az - o.z;
  const a = d1x * d1x + d1z * d1z;
  const e = d2x * d2x + d2z * d2z;
  const f = d2x * rx + d2z * rz;
  let s: number;
  let t: number;
  if (e < 1e-9) {
    // obstacle is a point
    s = a < 1e-9 ? 0 : Math.min(1, Math.max(0, -(d1x * rx + d1z * rz) / a));
    t = 0;
  } else {
    const c = d1x * rx + d1z * rz;
    if (a < 1e-9) {
      s = 0;
      t = Math.min(1, Math.max(0, f / e));
    } else {
      const b = d1x * d2x + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  return Math.hypot(ax + d1x * s - (o.x + d2x * t), az + d1z * s - (o.z + d2z * t));
}

// --- areas -------------------------------------------------------------------

export type Zone = 'lane' | 'square' | 'corridor' | 'street';

const SQUARE = LAYOUT.town.square;
const CORRIDOR = LAYOUT.town.walk[0]!;
const STREET = LAYOUT.village.street;
const CORR_Z = (LAYOUT.town.gate.minZ + LAYOUT.town.gate.maxZ) / 2;
/** Joining points between neighbouring areas. */
const GATE_STREET = { x: STREET.maxX - 1.6, z: CORR_Z };
const GATE_SQUARE = { x: SQUARE.minX + 0.35, z: CORR_Z };
const LANE_OUTER = { x: SQUARE.maxX + 1.5, z: SQUARE.maxZ + 0.4 };
const LANE_INNER = { x: SQUARE.maxX - 0.6, z: SQUARE.maxZ - 0.9 };

const ZONE_ORDER: Zone[] = ['lane', 'square', 'corridor', 'street'];

export function zoneOf(x: number, z: number): Zone {
  if (x >= SQUARE.minX && x <= SQUARE.maxX && z >= SQUARE.minZ && z <= SQUARE.maxZ) return 'square';
  if (x >= STREET.minX - 0.2 && x <= STREET.maxX + 0.2 && z <= STREET.maxZ + 0.6) return 'street';
  if (x >= CORRIDOR.minX - 0.2 && x <= CORRIDOR.maxX + 0.2 && z >= CORRIDOR.minZ - 0.2 && z <= CORRIDOR.maxZ + 0.2) return 'corridor';
  if (x > SQUARE.maxX) return 'lane';
  return x < STREET.maxX ? 'street' : 'corridor';
}

/** Reusable waypoint list. */
export class Path {
  n = 0;
  i = 0;
  readonly x = new Float32Array(MAX_POINTS);
  readonly z = new Float32Array(MAX_POINTS);

  clear(): void {
    this.n = 0;
    this.i = 0;
  }

  push(x: number, z: number): void {
    if (this.n >= MAX_POINTS) {
      // out of room: overwrite the last point so the destination is always reached
      this.x[MAX_POINTS - 1] = x;
      this.z[MAX_POINTS - 1] = z;
      return;
    }
    this.x[this.n] = x;
    this.z[this.n] = z;
    this.n++;
  }

  get done(): boolean {
    return this.i >= this.n;
  }

  get last(): { x: number; z: number } | null {
    return this.n > 0 ? { x: this.x[this.n - 1]!, z: this.z[this.n - 1]! } : null;
  }
}

// --- visibility graph around the solids -------------------------------------------------------------------------

/** Waypoint candidates: a stadium of vertices around every obstacle (clear of all of them by construction). */
const NX: number[] = [];
const NZ: number[] = [];
(function buildNodes(): void {
  OBSTACLES.forEach((o) => {
    const R = (o.r + PERSON_MARGIN + 0.1) * 1.12;
    const ox = o.x2 - o.x;
    const oz = o.z2 - o.z;
    const ol = Math.hypot(ox, oz);
    const add = (x: number, z: number): void => {
      for (const q of OBSTACLES) if (distPointAxis(x, z, q) < q.r + PERSON_MARGIN + 0.02) return; // inside another solid
      NX.push(x);
      NZ.push(z);
    };
    if (ol < 1e-6) {
      for (let k = 0; k < 8; k++) add(o.x + Math.cos((k * Math.PI) / 4) * R, o.z + Math.sin((k * Math.PI) / 4) * R);
    } else {
      const ux = ox / ol;
      const uz = oz / ol;
      const nx = -uz;
      const nz = ux;
      for (const eu of [-1, 1]) {
        const ex = eu > 0 ? o.x2 : o.x;
        const ez = eu > 0 ? o.z2 : o.z;
        for (let k = -2; k <= 2; k++) {
          const th = (k * Math.PI) / 4;
          add(ex + (ux * eu * Math.cos(th) + nx * Math.sin(th)) * R, ez + (uz * eu * Math.cos(th) + nz * Math.sin(th)) * R);
        }
      }
    }
  });
})();
const NN = NX.length;

/** Metres before an end inside a solid's margin where the route may come closer than the margin (see `segBlocked`). */
const HELD_TAIL = 0.8;

/**
 * Does the segment A→B pass too close to obstacle `o`? Clearance is the solid plus `margin`. An end on the solid itself
 * (a seat on a bench) is the owner's business and never blocks. An end merely inside the margin (an approach spot close
 * to the pond) may only be walked up to over its last HELD_TAIL metres: before that the full margin holds (no hugging
 * the pond all along its side), and the bare solid always does.
 */
function segBlocked(ax: number, az: number, bx: number, bz: number, o: Obstacle, margin: number): boolean {
  const R = o.r + margin;
  const da = distPointAxis(ax, az, o);
  const db = distPointAxis(bx, bz, o);
  const heldA = da < R * 0.97;
  const heldB = db < R * 0.97;
  if (!heldA && !heldB) return distSegmentAxis(ax, az, bx, bz, o) < R * 0.999;
  if (da < o.r || db < o.r) return false;
  const T = Math.min(o.r + TIGHT_MARGIN, Math.min(da, db) - 0.01);
  if (distSegmentAxis(ax, az, bx, bz, o) < T * 0.999) return true;
  const L = Math.hypot(bx - ax, bz - az);
  const cutA = heldA ? Math.min(HELD_TAIL, L / 2) : 0;
  const cutB = heldB ? Math.min(HELD_TAIL, L / 2) : 0;
  if (L - cutA - cutB < 0.05) return false;
  const ux = (bx - ax) / L;
  const uz = (bz - az) / L;
  return distSegmentAxis(ax + ux * cutA, az + uz * cutA, bx - ux * cutB, bz - uz * cutB, o) < R * 0.999;
}

/** Bit mask of the obstacles that block the segment A→B (see `segBlocked`). */
function blockers(ax: number, az: number, bx: number, bz: number, margin = PERSON_MARGIN): number {
  let m = 0;
  for (let k = 0; k < OBSTACLES.length; k++) if (segBlocked(ax, az, bx, bz, OBSTACLES[k]!, margin)) m |= 1 << k;
  return m;
}

/** Static node-to-node blockers (row-major). */
const EDGE = new Int32Array(NN * NN);
for (let i = 0; i < NN; i++) {
  for (let j = i + 1; j < NN; j++) {
    const m = blockers(NX[i]!, NZ[i]!, NX[j]!, NZ[j]!);
    EDGE[i * NN + j] = EDGE[j * NN + i] = m;
  }
}
/** The same with only the solids themselves (TIGHT_MARGIN): what the props of the `ignore` owner still block. */
const EDGE_CORE = new Int32Array(NN * NN);
for (let i = 0; i < NN; i++) {
  for (let j = i + 1; j < NN; j++) {
    const m = blockers(NX[i]!, NZ[i]!, NX[j]!, NZ[j]!, TIGHT_MARGIN);
    EDGE_CORE[i * NN + j] = EDGE_CORE[j * NN + i] = m;
  }
}
const ownerBit = (owner: number): number => {
  let m = 0;
  for (let k = 0; k < OBSTACLES.length; k++) if (OBSTACLES[k]!.owner === owner) m |= 1 << k;
  return m;
};

const gA = new Int32Array(NN); // blockers from the start to each node
const gB = new Int32Array(NN); // …from each node to the goal
const gDist = new Float64Array(NN);
const gPrev = new Int32Array(NN);
const gDone = new Uint8Array(NN);

/** Blockers of A→B: every solid with `margin`, except the `free` ones, which only block with their bare footprint. */
function blocked(ax: number, az: number, bx: number, bz: number, free: number, margin: number): number {
  const m = blockers(ax, az, bx, bz, margin) & ~free;
  return free === 0 ? m : m | (blockers(ax, az, bx, bz, TIGHT_MARGIN) & free);
}

/** Dijkstra over the waypoint graph from A to B (O(N²), N ≈ 70); returns the last node before B, or -1. */
function search(ax: number, az: number, bx: number, bz: number, free: number, margin: number): number {
  for (let i = 0; i < NN; i++) {
    gA[i] = blocked(ax, az, NX[i]!, NZ[i]!, free, margin);
    gB[i] = blocked(NX[i]!, NZ[i]!, bx, bz, free, margin);
    gDist[i] = gA[i] === 0 ? Math.hypot(NX[i]! - ax, NZ[i]! - az) : Infinity;
    gPrev[i] = -1;
    gDone[i] = 0;
  }
  for (;;) {
    let u = -1;
    let ud = Infinity;
    for (let i = 0; i < NN; i++) if (!gDone[i] && gDist[i]! < ud) {
      ud = gDist[i]!;
      u = i;
    }
    if (u < 0) break;
    gDone[u] = 1;
    for (let v = 0; v < NN; v++) {
      if (gDone[v] || ((EDGE[u * NN + v]! & ~free) | (EDGE_CORE[u * NN + v]! & free)) !== 0) continue;
      const d = ud + Math.hypot(NX[v]! - NX[u]!, NZ[v]! - NZ[u]!);
      if (d < gDist[v]!) {
        gDist[v] = d;
        gPrev[v] = u;
      }
    }
  }
  let best = -1;
  let bestC = Infinity;
  for (let i = 0; i < NN; i++) {
    if (gB[i] !== 0 || gDist[i] === Infinity) continue;
    const c = gDist[i]! + Math.hypot(bx - NX[i]!, bz - NZ[i]!);
    if (c < bestC) {
      bestC = c;
      best = i;
    }
  }
  return best;
}

/** Waypoints (excluding A, including B) for one leg, bent around the solids. */
function leg(path: Path, ax: number, az: number, bx: number, bz: number, ignore: number): void {
  const free = ownerBit(ignore);
  const direct = blocked(ax, az, bx, bz, free, PERSON_MARGIN);
  if (direct === 0 || NN === 0) {
    path.push(bx, bz);
    return;
  }
  // First with the full person margin. A point squeezed into a pocket between solids (the tree, the cafe kiosk and
  // the pond leave one) reaches no waypoint that way; then the first and last hops get a thinner margin, down to the
  // bare solids. Going straight is the very last resort.
  let best = -1;
  for (const margin of FALLBACK_MARGINS) {
    best = search(ax, az, bx, bz, free, margin);
    if (best >= 0) break;
  }
  if (best < 0) {
    path.push(bx, bz); // boxed in: go straight
    return;
  }
  // unwind (last → first) straight into the path buffer, then reverse that stretch
  const from = path.n;
  for (let i = best; i >= 0; i = gPrev[i]!) path.push(NX[i]!, NZ[i]!);
  for (let i = from, j = path.n - 1; i < j; i++, j--) {
    const tx = path.x[i]!;
    const tz = path.z[i]!;
    path.x[i] = path.x[j]!;
    path.z[i] = path.z[j]!;
    path.x[j] = tx;
    path.z[j] = tz;
  }
  path.push(bx, bz);
}

/**
 * Plan a route from (ax, az) to (bx, bz) into `path` (cleared first; the start point is NOT included).
 * `ignore`: owner id of the prop the destination belongs to (a bench you sit on, the tree you look at).
 */
export function planPath(path: Path, ax: number, az: number, bx: number, bz: number, ignore = 0): void {
  if (!planViaLane(path, ax, az, bx, bz, ignore, planZonePath)) planZonePath(path, ax, az, bx, bz, ignore);
}

/** planPath north of the town's south fence: through the zone chain lane - square - corridor - street. */
function planZonePath(path: Path, ax: number, az: number, bx: number, bz: number, ignore: number): void {
  path.clear();
  let cx = ax;
  let cz = az;
  // A start inside a solid's margin (nudged there by a passer-by, or just stood up from a seat) would make `blockers`
  // skip that solid for the whole first leg, and the route would cut straight through it: step out first.
  if (stepOut(cx, cz, ignore, escaped)) {
    path.push(escaped.x, escaped.z);
    cx = escaped.x;
    cz = escaped.z;
  }
  const go = (x: number, z: number): void => {
    leg(path, cx, cz, x, z, ignore);
    cx = x;
    cz = z;
  };
  const za = ZONE_ORDER.indexOf(zoneOf(ax, az));
  const zb = ZONE_ORDER.indexOf(zoneOf(bx, bz));
  if (za < zb) {
    for (let k = za; k < zb; k++) joint(k, true, go);
  } else if (za > zb) {
    for (let k = za - 1; k >= zb; k--) joint(k, false, go);
  }
  go(bx, bz);
}

const escaped = { x: 0, z: 0 };

/** True when (x, z) is inside the margin of any solid but the `ignore` owner's. */
function inMargin(x: number, z: number, ignore: number): boolean {
  for (const o of OBSTACLES) if (o.owner !== ignore && distPointAxis(x, z, o) < (o.r + PERSON_MARGIN) * 0.97) return true;
  return false;
}

/**
 * A nearby point just outside every solid's margin (the `ignore` owner's props excepted), reachable from (x, z) without
 * walking through a solid, when (x, z) is inside a margin; false (and `out` untouched) when it is already clear.
 * Rings of 16 directions at growing distances; the first clear one wins.
 */
function stepOut(x: number, z: number, ignore: number, out: { x: number; z: number }): boolean {
  if (!inMargin(x, z, ignore)) return false;
  const free = ownerBit(ignore);
  for (let r = 0.15; r <= 2.4; r += 0.15) {
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (inMargin(px, pz, ignore) || (blockers(x, z, px, pz, TIGHT_MARGIN) & ~free) !== 0) continue;
      out.x = px;
      out.z = pz;
      return true;
    }
  }
  return false;
}

/** Joint between ZONE_ORDER[k] and ZONE_ORDER[k + 1], walked toward higher (`up`) or lower indices. */
function joint(k: number, up: boolean, go: (x: number, z: number) => void): void {
  if (k === 0) {
    // lane <-> square
    if (up) {
      go(LANE_OUTER.x, LANE_OUTER.z);
      go(LANE_INNER.x, LANE_INNER.z);
    } else {
      go(LANE_INNER.x, LANE_INNER.z);
      go(LANE_OUTER.x, LANE_OUTER.z);
    }
  } else if (k === 1) {
    go(GATE_SQUARE.x, GATE_SQUARE.z); // square <-> corridor
  } else {
    go(GATE_STREET.x, GATE_STREET.z); // corridor <-> street
  }
}

const SQ_INSET = 0.05;
const scratch = new Path();

/** True for points on the town side of the village that the zone logic would misjudge (lot interiors, the square's rim). */
function townInterior(x: number, z: number): boolean {
  const A = LAYOUT.town.area;
  if (x < SQUARE.minX || x > A.maxX || z < A.minZ || z > A.maxZ) return false;
  return !(x > SQUARE.maxX && z > SQUARE.maxZ); // the south-east lane is a zone of its own
}

const inSquare = (x: number, z: number): boolean => x >= SQUARE.minX && x <= SQUARE.maxX && z >= SQUARE.minZ && z <= SQUARE.maxZ;
const clampX = (x: number): number => Math.min(SQUARE.maxX - SQ_INSET, Math.max(SQUARE.minX + SQ_INSET, x));
const clampZ = (z: number): number => Math.min(SQUARE.maxZ - SQ_INSET, Math.max(SQUARE.minZ + SQ_INSET, z));

/**
 * planPath for endpoints that may sit just outside the square's walk rect (a lot's door, a staff spot inside a lot,
 * amenity spots on the rim): the route runs between the nearest square points and the real end points are tacked on.
 */
export function planTownPath(path: Path, ax: number, az: number, bx: number, bz: number, ignore = 0): void {
  if (!planViaLane(path, ax, az, bx, bz, ignore, planSquarePath)) planSquarePath(path, ax, az, bx, bz, ignore);
}

/**
 * 0.9.12 Lantern Lane (town/lane.ts): when either end lies south of the town's fence, plan `path` along the lane's
 * spine through the fence gap, with `inner` planning the part north of the fence. False (path untouched) otherwise.
 */
function planViaLane(path: Path, ax: number, az: number, bx: number, bz: number, ignore: number, inner: (p: Path, ax: number, az: number, bx: number, bz: number, ignore: number) => void): boolean {
  laneA.x = ax;
  laneA.z = az;
  laneB.x = bx;
  laneB.z = bz;
  const la = inLane(laneA);
  const lb = inLane(laneB);
  if (!la && !lb) return false;
  path.clear();
  if (la) {
    // out along the spine to the gap (and on to the other end when it is in the lane too)
    if (Math.abs(ax - SPINE_X) > 0.05) path.push(SPINE_X, az);
    if (lb) {
      path.push(SPINE_X, bz);
      path.push(bx, bz);
      return true;
    }
    path.push(GAP_OUT.x, GAP_OUT.z);
    path.push(GAP_IN.x, GAP_IN.z);
    inner(laneScratch, GAP_IN.x, GAP_IN.z, bx, bz, ignore);
    for (let i = 0; i < laneScratch.n; i++) path.push(laneScratch.x[i]!, laneScratch.z[i]!);
    return true;
  }
  inner(laneScratch, ax, az, GAP_IN.x, GAP_IN.z, ignore);
  for (let i = 0; i < laneScratch.n; i++) path.push(laneScratch.x[i]!, laneScratch.z[i]!);
  path.push(GAP_OUT.x, GAP_OUT.z);
  path.push(SPINE_X, bz);
  path.push(bx, bz);
  return true;
}

const laneA = { x: 0, z: 0 };
const laneB = { x: 0, z: 0 };
const laneScratch = new Path();

/** planTownPath inside the town (square, corridor, street, the south-east lane): both ends north of the south fence. */
function planSquarePath(path: Path, ax: number, az: number, bx: number, bz: number, ignore: number): void {
  path.clear();
  let sx = ax;
  let sz = az;
  if (townInterior(ax, az) && !inSquare(ax, az)) {
    sx = clampX(ax);
    sz = clampZ(az);
    path.push(sx, sz);
    // step well into the square before turning: walking along its very edge brushes the shop counters and signs out
    // on the lots' doorsteps
    if (stepIn(sx, sz, inner)) {
      sx = inner.x;
      sz = inner.z;
      path.push(sx, sz);
    }
  }
  let ex = bx;
  let ez = bz;
  const post = townInterior(bx, bz) && !inSquare(bx, bz);
  let postIn = false;
  let px = 0;
  let pz = 0;
  if (post) {
    ex = clampX(bx);
    ez = clampZ(bz);
    px = ex;
    pz = ez;
    if (stepIn(ex, ez, inner)) {
      postIn = true;
      ex = inner.x;
      ez = inner.z;
    }
  }
  planPath(scratch, sx, sz, ex, ez, ignore);
  for (let i = 0; i < scratch.n; i++) path.push(scratch.x[i]!, scratch.z[i]!);
  if (postIn) path.push(px, pz);
  if (post) path.push(bx, bz);
}

/** How far into the square a route steps from a lot's doorstep before it turns along the square. */
const DOOR_STEP_IN = 1.1;
const inner = { x: 0, z: 0 };

/** The point DOOR_STEP_IN inside the square from edge point (x, z), if it is clear of the square's solids. */
function stepIn(x: number, z: number, out: { x: number; z: number }): boolean {
  out.x = Math.min(SQUARE.maxX - DOOR_STEP_IN, Math.max(SQUARE.minX + DOOR_STEP_IN, x));
  out.z = Math.min(SQUARE.maxZ - DOOR_STEP_IN, Math.max(SQUARE.minZ + DOOR_STEP_IN, z));
  if (Math.hypot(out.x - x, out.z - z) < 0.05) return false;
  return !insideObstacle(out.x, out.z);
}

/** The doorstep of market-town lot `lot` (just outside its footprint, on the side facing the square). */
export function lotDoor(lot: number, out: { x: number; z: number }): { x: number; z: number } {
  const l = LAYOUT.town.lots[lot]!;
  const d = LAYOUT.town.lotSize / 2 + 0.3;
  out.x = l.x + l.face.x * d;
  out.z = l.z + l.face.z * d;
  return out;
}

/** The nearest of `doors` to (x, z), or the corridor entrance when there is none (people live outside the town). */
export function nearestHome(x: number, z: number, doors: readonly { x: number; z: number }[], out: { x: number; z: number }): { x: number; z: number } {
  let best: { x: number; z: number } = LAYOUT.town.entrances[0]!;
  let bd = Infinity;
  for (const d of doors) {
    const dd = Math.hypot(d.x - x, d.z - z);
    if (dd < bd) {
      bd = dd;
      best = d;
    }
  }
  out.x = best.x;
  out.z = best.z;
  return out;
}

/** True when the straight walk A→B passes through a solid itself (no person margin; an end on a solid is allowed). */
export function solidBetween(ax: number, az: number, bx: number, bz: number): boolean {
  return blockers(ax, az, bx, bz, TIGHT_MARGIN) !== 0;
}

/** True when the point is inside any obstacle (with the person margin). */
export function insideObstacle(x: number, z: number, ignore = 0, extra = 0): boolean {
  for (const o of OBSTACLES) {
    if (o.owner === ignore) continue;
    if (distPointAxis(x, z, o) < o.r + PERSON_MARGIN + extra) return true;
  }
  return false;
}

/** Point on the bench seat `seat` (0 / 1) of bench `i`, and the approach point in front of it. */
export function seatPoint(i: number, seat: number, out: { x: number; z: number; yaw: number; ax: number; az: number }): void {
  const b = BENCHES[i]!;
  const k = seat === 0 ? -SEAT_OFFSET : SEAT_OFFSET;
  const rx = Math.cos(b.yaw);
  const rz = -Math.sin(b.yaw);
  const fx = Math.sin(b.yaw);
  const fz = Math.cos(b.yaw);
  out.x = b.x + rx * k + fx * 0.06;
  out.z = b.z + rz * k + fz * 0.06;
  out.yaw = b.yaw;
  out.ax = out.x + fx * 1.0;
  out.az = out.z + fz * 1.0;
}

export const NAV = {
  /** Number of waypoint-graph nodes (Dijkstra is O(nodes²) per leg). */
  nodes: NN,
  corridorZ: CORR_Z,
  gateStreet: GATE_STREET,
  gateSquare: GATE_SQUARE,
  /** Where villagers appear / leave: the yard gate at the north end of the street. */
  streetEntry: { x: (LAYOUT.village.gate.minX + LAYOUT.village.gate.maxX) / 2, z: STREET.minZ + 0.2 },
  square: SQUARE,
  street: STREET,
} as const;
