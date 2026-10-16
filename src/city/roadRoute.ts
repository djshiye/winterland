/**
 * [city] 1.0 pure walking routes over rectangles: the roads (eras/data.ts ROADS) and a district's own walkways (the
 * sidewalk ring and the lanes in front of each lot row). No THREE, no GameContext.
 *
 * - `routeOver(rects, a, b)`: a waypoint polyline from `a` to `b` (a excluded, b last) whose every leg stays inside one
 *   rect (rects are convex, so a straight leg between two points of the same rect never leaves it). Rects that touch
 *   or overlap along at least PASS metres are joined at the centre of their overlap; the shortest chain wins
 *   (Dijkstra). Each leg walks the strip's centre line (a long strip's lane centre), so people keep to the middle of a
 *   road. A point outside every rect is first snapped onto the nearest one.
 * - `districtWalkways(n)`: the clear walk network of district n: a narrow inner sidewalk strip (clear of the street
 *   lamps on the outer ring), a walk band in front of each lot row (just south of the pads) and four short connectors
 *   from the district edge into the ring, set between the lamp posts, that touch the streets around the block.
 * - `cityRoute(era, a, b)`: the era foreman's way between its region's gate (on the region road) and a lot of its
 *   district, over the roads open by that era and that district's walkways.
 */
import { DISTRICTS, ROADS, districtDef, type ERect } from '../eras/data';
import { DISTRICT_MARGIN, LOT_PAD, districtLots, type LotFrame, type XZ } from './rules';

/** Shortest shared edge (metres) for two rects to count as joined. */
const PASS = 1;
const EPS = 1e-6;

export const inRect = (r: ERect, p: XZ, eps = 1e-4): boolean => p.x >= r.minX - eps && p.x <= r.maxX + eps && p.z >= r.minZ - eps && p.z <= r.maxZ + eps;

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
export function routeOver(rects: readonly ERect[], a: XZ, b: XZ): XZ[] | null {
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
      if (Math.max(maxX - minX, maxZ - minZ) < PASS) continue;
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
    pts.push(onCentre(r, from), onCentre(r, to), to);
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

const routeRects = new Map<number, ERect[]>();

/** Every rect a worker of era `era` may walk outside its region: the roads open by then + that era's district walkways. */
export function cityWalkRects(era: number): readonly ERect[] {
  const hit = routeRects.get(era);
  if (hit) return hit;
  const out = ROADS.filter((r) => r.opensAt <= era).map((r) => r.rect);
  if (DISTRICTS[era]) out.push(...districtWalkways(era));
  routeRects.set(era, out);
  return out;
}

/** Waypoints between two points of era `era`'s outside world (a region gate on its road, a lot's stand spot). */
export function cityRoute(era: number, a: XZ, b: XZ): XZ[] | null {
  return routeOver(cityWalkRects(era), a, b);
}

/** Where a region's workers step out onto its road: the lane centre in front of the gate. */
export function gateRoadSpot(L: { gate: { x: number; z: number }; inward: number }): XZ {
  return { x: L.gate.x, z: L.gate.z - L.inward * 2 };
}
