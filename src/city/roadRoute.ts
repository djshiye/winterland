/**
 * [city] 1.0 pure walking routes over rectangles: the roads (eras/data.ts ROADS) and a district's own walkways (the
 * sidewalk ring and the lanes in front of each lot row). No THREE, no GameContext.
 *
 * - `routeOver(rects, a, b)`: a waypoint polyline from `a` to `b` (a excluded, b last) whose every leg stays inside one
 *   rect (rects are convex, so a straight leg between two points of the same rect never leaves it). Rects that touch
 *   or overlap along at least PASS metres (or cross, CROSS both ways) are joined at the centre of their overlap; the shortest chain wins
 *   (Dijkstra). Each leg walks the strip's centre line (a long strip's lane centre), so people keep to the middle of a
 *   road. A point outside every rect is first snapped onto the nearest one.
 * - `districtWalkways(n)`: the clear walk network of district n: a narrow inner sidewalk strip (clear of the street
 *   lamps on the outer ring), a walk band in front of each lot row (just south of the pads) and four short connectors
 *   from the district edge into the ring, set between the lamp posts, that touch the streets around the block.
 * - `cityRoute(era, a, b)`: the era foreman's way between its region's gate (on the region road) and a lot of its
 *   district, over the verges of the roads open by that era and that district's walkways. 0.9.12 (Dino: "clear roads
 *   where you're meant to walk on, the people and the cars"): people keep to a strip beside each road (`roadVerges`)
 *   and cross only straight over a road, on a band at a junction's edge or at the gate, so they never walk down the
 *   middle between the trucks' lanes or cut a corner through the traffic.
 */
import { LAYOUT } from '../config';
import { DISTRICTS, REGIONS, ROADS, districtDef, type ERect } from '../eras/data';
/** Streets (kerbed, in the city) vs trails (world/env/roadJoins.ts isStreet). */
const isStreet = (id: string): boolean => id.startsWith('city') || id === 'townEast';
import { DISTRICT_MARGIN, LOT_PAD, districtLots, type LotFrame, type XZ } from './rules';

/** Shortest shared edge (metres) for two rects to count as joined. */
const PASS = 1;
/** Two walk strips crossing (a verge corner) overlap this far both ways: they join there too. */
const CROSS = 0.29;
const EPS = 1e-6;

export const inRect = (r: ERect, p: XZ, eps = 1e-4): boolean => p.x >= r.minX - eps && p.x <= r.maxX + eps && p.z >= r.minZ - eps && p.z <= r.maxZ + eps;

/** A rect a route crosses straight from node to node (a junction), instead of along its centre line. */
export type WalkRect = ERect & { direct?: boolean };

const grow = (r: ERect, m: number): ERect => ({ minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m });

const dist = (a: XZ, b: XZ): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Nearest point of `r` to `p`. */
function clampTo(r: ERect, p: XZ): XZ {
  return { x: Math.min(r.maxX, Math.max(r.minX, p.x)), z: Math.min(r.maxZ, Math.max(r.minZ, p.z)) };
}

/** `p` moved onto the centre line of strip `r` (along its long side). */
function onCentre(r: ERect, p: XZ): XZ {
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  return w >= d ? { x: Math.min(r.maxX, Math.max(r.minX, p.x)), z: (r.minZ + r.maxZ) / 2 } : { x: (r.minX + r.maxX) / 2, z: Math.min(r.maxZ, Math.max(r.minZ, p.z)) };
}

/**
 * Waypoints from `a` to `b` over `rects` (see the file header). `a` is not included, `b` is last. Null when the rects
 * do not join `a` to `b` (or there are none).
 */
export function routeOver(rects: readonly WalkRect[], a: XZ, b: XZ): XZ[] | null {
  if (rects.length === 0) return null;
  const pre: XZ[] = [];
  const snap = (p: XZ): XZ => {
    if (rects.some((r) => inRect(r, p))) return p;
    let best = p;
    let bestD = Infinity;
    for (const r of rects) {
      const q = clampTo(r, p);
      const d = dist(p, q);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return best;
  };
  const sa = snap(a);
  if (sa !== a) pre.push(sa);
  const sb = snap(b);
  // nodes: 0 = start, 1 = end, then the junctions
  const nodes: XZ[] = [sa, sb];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const p = rects[i]!;
      const q = rects[j]!;
      const minX = Math.max(p.minX, q.minX);
      const maxX = Math.min(p.maxX, q.maxX);
      const minZ = Math.max(p.minZ, q.minZ);
      const maxZ = Math.min(p.maxZ, q.maxZ);
      if (maxX < minX - EPS || maxZ < minZ - EPS) continue;
      if (Math.max(maxX - minX, maxZ - minZ) < PASS && Math.min(maxX - minX, maxZ - minZ) < CROSS) continue;
      nodes.push({ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 });
    }
  }
  const N = nodes.length;
  // which rects hold each node
  const holds: number[][] = nodes.map((p) => {
    const out: number[] = [];
    rects.forEach((r, k) => {
      if (inRect(r, p)) out.push(k);
    });
    return out;
  });
  // Dijkstra (tiny graphs: a few dozen nodes)
  const best = new Array<number>(N).fill(Infinity);
  const prev = new Array<number>(N).fill(-1);
  const via = new Array<number>(N).fill(-1);
  const done = new Array<boolean>(N).fill(false);
  best[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < N; i++) if (!done[i] && best[i]! < Infinity && (u < 0 || best[i]! < best[u]!)) u = i;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (const k of holds[u]!) {
      for (let v = 0; v < N; v++) {
        if (done[v] || v === u || !holds[v]!.includes(k)) continue;
        const c = best[u]! + dist(nodes[u]!, nodes[v]!);
        if (c < best[v]! - 1e-9) {
          best[v] = c;
          prev[v] = u;
          via[v] = k;
        }
      }
    }
  }
  if (best[1] === Infinity) return null;
  const chain: number[] = [];
  for (let v = 1; v !== -1; v = prev[v]!) chain.push(v);
  chain.reverse();
  const pts: XZ[] = [...pre];
  for (let i = 1; i < chain.length; i++) {
    const from = nodes[chain[i - 1]!]!;
    const to = nodes[chain[i]!]!;
    const r = rects[via[chain[i]!]!]!;
    if (r.direct) pts.push(to);
    else pts.push(onCentre(r, from), onCentre(r, to), to);
  }
  if (sb !== b) pts.push(b);
  const out: XZ[] = [];
  let last = a;
  for (const p of pts) {
    if (dist(last, p) < 0.05) continue;
    out.push(p);
    last = p;
  }
  // the walk ends exactly on b (a centre-line point a hair away from it was kept instead)
  if (out.length === 0) out.push(b);
  else if (out[out.length - 1] !== b) out[out.length - 1] = b;
  return out;
}

// ---------------------------------------------------------------------------
// District walkways
// ---------------------------------------------------------------------------

/** Width of the walkable inner strip of the sidewalk ring (its inner side; the lamps stand on the outer side). */
const RING_WALK = 0.65;
/** Width of a connector from the district edge into the ring. */
const CONNECTOR = 1.2;
/** The walk band in front of a lot row starts this far past the building fronts (just south of the pads). */
const BAND_FROM = 0.6 + LOT_PAD + 0.05;
/** ...and reaches this far past the row's cell (the next row's buildings start ≥ 0.8 m into their cell). */
const BAND_PAST = 0.55;

const walkwayCache = new Map<number, ERect[]>();
const frameCache = new Map<number, LotFrame[]>();

/** districtLots(n), computed once (the foremen ask for a lot's stand spot on every job search). */
function frames(n: number): readonly LotFrame[] {
  let f = frameCache.get(n);
  if (!f) {
    f = districtLots(n);
    frameCache.set(n, f);
  }
  return f;
}

/** The clear walk network of district n (see the file header); cached per district. */
export function districtWalkways(n: number): readonly ERect[] {
  const hit = walkwayCache.get(n);
  if (hit) return hit;
  const r = districtDef(n).rect;
  const m = DISTRICT_MARGIN;
  const a = m - RING_WALK; // inner ring strip: from a to m in from the edge
  const out: ERect[] = [
    { minX: r.minX + a, maxX: r.maxX - a, minZ: r.minZ + a, maxZ: r.minZ + m }, // north
    { minX: r.minX + a, maxX: r.maxX - a, minZ: r.maxZ - m, maxZ: r.maxZ - a }, // south
    { minX: r.minX + a, maxX: r.minX + m, minZ: r.minZ + a, maxZ: r.maxZ - a }, // west
    { minX: r.maxX - m, maxX: r.maxX - a, minZ: r.minZ + a, maxZ: r.maxZ - a }, // east
  ];
  // connectors between the lamp posts (west / east lamps every 7 m from minZ + 4, north / south every 8 m from minX + 8)
  const cz = r.minZ + 14.5;
  const cx = r.minX + 12;
  const h = CONNECTOR / 2;
  out.push(
    { minX: r.minX, maxX: r.minX + m, minZ: cz - h, maxZ: cz + h },
    { minX: r.maxX - m, maxX: r.maxX, minZ: cz - h, maxZ: cz + h },
    { minX: cx - h, maxX: cx + h, minZ: r.minZ, maxZ: r.minZ + m },
    { minX: cx - h, maxX: cx + h, minZ: r.maxZ - m, maxZ: r.maxZ },
  );
  for (const z of rowFronts(n)) out.push({ minX: r.minX + a, maxX: r.maxX - a, minZ: z.front + BAND_FROM, maxZ: z.cellMaxZ + BAND_PAST });
  walkwayCache.set(n, out);
  return out;
}

/** Each lot row of district n: its building front line and its cells' south edge. */
function rowFronts(n: number): { front: number; cellMaxZ: number }[] {
  const out: { front: number; cellMaxZ: number }[] = [];
  for (const f of frames(n)) if (!out.some((o) => Math.abs(o.cellMaxZ - f.cell.maxZ) < 1e-6)) out.push({ front: f.rect.maxZ, cellMaxZ: f.cell.maxZ });
  return out;
}

/** The centre line z of the walk band in front of lot `lot` of district n. */
export function laneZ(n: number, lot: number): number {
  const f = frames(n)[lot]!;
  return (f.rect.maxZ + BAND_FROM + f.cell.maxZ + BAND_PAST) / 2;
}

/** Where the era foreman stands to unload into lot `lot`'s pad (in the walk band, just south of the tile), and the pad. */
export function lotStandSpot(n: number, lot: number): { spot: XZ; look: XZ } {
  const f = frames(n)[lot]!;
  return { spot: { x: f.pad.x, z: f.pad.z + f.padSize / 2 + 0.45 }, look: { x: f.pad.x, z: f.pad.z } };
}

// ---------------------------------------------------------------------------
// The foreman's road route
// ---------------------------------------------------------------------------

const routeRects = new Map<number, WalkRect[]>();

/** People walk this far (strip centre) outside a road's edge: on a street's kerbside walk, or on a trail's snow. */
const VERGE_STREET = 0.35;
const VERGE_TRAIL = 0.7;
/** Half the width of a verge strip. */
const VERGE_HALF = 0.15;
/** Ground no verge runs over: the era regions (behind their fences) and the Market Town (its fence). */
const VERGE_BLOCKS: readonly ERect[] = [...REGIONS.flatMap((d) => (d ? [grow(d.rect, 0.3)] : [])), grow(LAYOUT.town.area, 0.9)];
/** Roads whose sides are another walk already: the south avenue runs down Lantern Lane's own cobbled walk. */
const NO_VERGE = new Set(['southAvenue']);

/** Piece [lo, hi] of a line minus the blocked spans; pieces shorter than 1 m are dropped. */
function cut(lo: number, hi: number, spans: readonly [number, number][]): [number, number][] {
  let out: [number, number][] = [[lo, hi]];
  for (const [a, b] of spans) {
    const next: [number, number][] = [];
    for (const [p, q] of out) {
      if (b <= p || a >= q) next.push([p, q]);
      else {
        if (a > p) next.push([p, a]);
        if (b < q) next.push([b, q]);
      }
    }
    out = next;
  }
  return out.filter(([p, q]) => q - p >= 1);
}

/**
 * The walk strips beside road `r` (pure): one along each long edge, `VERGE_*` outside it, run past both ends so the
 * verges of joining roads meet, and cut where they would cross a region, the Market Town or another road's carriageway
 * (`others`: a walker crosses a road only on a crossing, never down a verge that runs into the traffic).
 */
export function roadVerges(r: ERect, street: boolean, others: readonly ERect[] = []): ERect[] {
  const o = street ? VERGE_STREET : VERGE_TRAIL;
  const ext = o + VERGE_HALF;
  const alongX = r.maxX - r.minX >= r.maxZ - r.minZ;
  const out: ERect[] = [];
  for (const side of [-1, 1]) {
    const c = alongX ? (side < 0 ? r.minZ - o : r.maxZ + o) : side < 0 ? r.minX - o : r.maxX + o;
    const lo = (alongX ? r.minX : r.minZ) - ext;
    const hi = (alongX ? r.maxX : r.maxZ) + ext;
    const spans: [number, number][] = [];
    for (const b of [...VERGE_BLOCKS, ...others.map((q) => grow(q, ROAD_EDGE))]) {
      const [c0, c1] = alongX ? [b.minZ, b.maxZ] : [b.minX, b.maxX];
      if (c + VERGE_HALF <= c0 || c - VERGE_HALF >= c1) continue;
      spans.push(alongX ? [b.minX, b.maxX] : [b.minZ, b.maxZ]);
    }
    for (const [p, q] of cut(lo, hi, spans)) {
      out.push(alongX ? { minX: p, maxX: q, minZ: c - VERGE_HALF, maxZ: c + VERGE_HALF } : { minX: c - VERGE_HALF, maxX: c + VERGE_HALF, minZ: p, maxZ: q });
    }
  }
  return out;
}

/** How far short of another road's carriageway a verge stops (it still overlaps that road's own verge). */
const ROAD_EDGE = 0.05;
/** Half the width of a crossing band. */
const CROSS_HALF = 0.6;

/**
 * Where two roads meet: a crossing band over each road, on the line of every verge of the other road that runs into it,
 * straight across at right angles like a zebra at the junction's edge (never diagonally through the junction).
 */
function junctionCrossings(roads: readonly { rect: ERect; street: boolean }[]): WalkRect[] {
  const out: WalkRect[] = [];
  for (const p of roads) {
    const pAlongX = p.rect.maxX - p.rect.minX >= p.rect.maxZ - p.rect.minZ;
    const o = p.street ? VERGE_STREET : VERGE_TRAIL;
    const lines = pAlongX ? [p.rect.minZ - o, p.rect.maxZ + o] : [p.rect.minX - o, p.rect.maxX + o];
    for (const q of roads) {
      if (q === p) continue;
      const r = q.rect;
      if (Math.max(p.rect.minX, r.minX) > Math.min(p.rect.maxX, r.maxX) + EPS || Math.max(p.rect.minZ, r.minZ) > Math.min(p.rect.maxZ, r.maxZ) + EPS) continue;
      const qAlongX = r.maxX - r.minX >= r.maxZ - r.minZ;
      if (qAlongX === pAlongX) continue; // a road running on: its verges carry on, nothing to cross
      const g = (q.street ? VERGE_STREET : VERGE_TRAIL) + VERGE_HALF + 0.05;
      for (const c of lines) {
        // p's verge on line c crosses q's carriageway: the band runs along c over q and both its verges
        if (qAlongX) {
          if (c < r.minX || c > r.maxX) continue;
          out.push({ minX: c - CROSS_HALF, maxX: c + CROSS_HALF, minZ: r.minZ - g, maxZ: r.maxZ + g, direct: true });
        } else {
          if (c < r.minZ || c > r.maxZ) continue;
          out.push({ minX: r.minX - g, maxX: r.maxX + g, minZ: c - CROSS_HALF, maxZ: c + CROSS_HALF, direct: true });
        }
      }
    }
  }
  return out;
}

/**
 * Every rect a worker of era `era` may walk outside its region: the verges and junctions of the roads open by then,
 * and that era's district walkways (their connectors meet the street verges on the district's own sidewalk).
 */
export function cityWalkRects(era: number): readonly WalkRect[] {
  const hit = routeRects.get(era);
  if (hit) return hit;
  const open = ROADS.filter((r) => r.opensAt <= era);
  const out: WalkRect[] = open.flatMap((r) => (NO_VERGE.has(r.id) ? [] : roadVerges(r.rect, isStreet(r.id), open.filter((o) => o !== r).map((o) => o.rect))));
  out.push(...junctionCrossings(open.map((r) => ({ rect: r.rect, street: isStreet(r.id) }))));
  if (DISTRICTS[era]) out.push(...districtWalkways(era));
  routeRects.set(era, out);
  return out;
}

/** Waypoints between two points of era `era`'s outside world (a region gate on its road, a lot's stand spot). */
export function cityRoute(era: number, a: XZ, b: XZ): XZ[] | null {
  const rects = cityWalkRects(era);
  const extra = [a, b].flatMap((p) => (rects.some((r) => inRect(r, p)) ? [] : crossingAt(era, p)));
  return routeOver(extra.length ? [...rects, ...extra] : rects, a, b);
}

/**
 * A point on a road (the gate's road spot): the crossing there, a 1.2 m band straight across the road and both its
 * verges, so the walk to it goes straight over the road like a crosswalk. None off the roads.
 */
export function crossingAt(era: number, p: XZ): WalkRect[] {
  const road = ROADS.find((r) => r.opensAt <= era && inRect(r.rect, p));
  if (!road) return [];
  const r = road.rect;
  const g = VERGE_TRAIL + VERGE_HALF + 0.05;
  return r.maxX - r.minX >= r.maxZ - r.minZ
    ? [{ minX: p.x - 0.6, maxX: p.x + 0.6, minZ: r.minZ - g, maxZ: r.maxZ + g, direct: true }]
    : [{ minX: r.minX - g, maxX: r.maxX + g, minZ: p.z - 0.6, maxZ: p.z + 0.6, direct: true }];
}

/** Where a region's workers step out onto its road: the lane centre in front of the gate. */
export function gateRoadSpot(L: { gate: { x: number; z: number }; inward: number }): XZ {
  return { x: L.gate.x, z: L.gate.z - L.inward * 2 };
}

/** A vehicle as the kerb check sees it: where it is and the way it heads (unit XZ). */
export interface KerbVehicle {
  x: number;
  z: number;
  fx: number;
  fz: number;
}

/** How far a vehicle heading for a crossing still makes a walker wait (m), and how near one always does. */
const KERB_SEE = 18;
const KERB_NEAR = 4.5;

/**
 * Pure: should a walker at `p`, about to step from the kerb toward `goal` over one of `roads`, wait for traffic? True
 * while `p` is off every carriageway, the way ahead runs onto one, and a vehicle is near that leg or coming at it.
 * (0.9.12: people look both ways, so they never walk out in front of a turning truck.)
 */
export function kerbWait(p: XZ, goal: XZ, roads: readonly ERect[], vehicles: Iterable<KerbVehicle>): boolean {
  const dx = goal.x - p.x;
  const dz = goal.z - p.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.05 || roads.some((r) => inRect(r, p))) return false;
  const k = Math.min(0.6, len) / len;
  const ahead = { x: p.x + dx * k, z: p.z + dz * k };
  if (!roads.some((r) => inRect(r, ahead))) return false;
  for (const v of vehicles) {
    // nearest point of the leg to the vehicle
    const t = Math.max(0, Math.min(1, ((v.x - p.x) * dx + (v.z - p.z) * dz) / (len * len)));
    const qx = p.x + dx * t - v.x;
    const qz = p.z + dz * t - v.z;
    const d = Math.hypot(qx, qz);
    if (d < KERB_NEAR) return true;
    if (d < KERB_SEE && qx * v.fx + qz * v.fz > 0) return true;
  }
  return false;
}
