/**
 * 0.9.12: where roads meet. Pure helpers (no THREE) behind the road drawing in frontier.ts, kept apart so tests can
 * check the joins: which road owns a junction square, where the wheel ruts stop, the curved ruts round an L corner,
 * which ends are deliberate terminals, the paving in front of each region gate and the south avenue's apron into the town.
 */
import { LAYOUT, type Rect } from '../../config';
import { ROADS, type ERect } from '../../eras/data';
import { regionLayout } from '../../eras/layout';

export interface RoadDef {
  id: string;
  rect: ERect;
}

/** City streets and the lane out of the Market Town share one cobbled street style; everything else is the dirt trail. */
export const isStreet = (id: string): boolean => id.startsWith('city') || id === 'townEast';

const EPS = 1e-6;
/** Wheel ruts sit this far either side of a trail's centre line, 0.34 m wide. */
export const RUT_OFFSET = 0.8;
export const RUT_WIDTH = 0.34;

export const overlapArea = (a: Rect, b: Rect): Rect | null => {
  const r = { minX: Math.max(a.minX, b.minX), maxX: Math.min(a.maxX, b.maxX), minZ: Math.max(a.minZ, b.minZ), maxZ: Math.min(a.maxZ, b.maxZ) };
  return r.maxX - r.minX > EPS && r.maxZ - r.minZ > EPS ? r : null;
};

const alongX = (r: Rect): boolean => r.maxX - r.minX >= r.maxZ - r.minZ;

/** True if `a` runs on past `b` on both sides along a's own axis (a goes through the junction instead of ending in it). */
function passes(a: Rect, b: Rect): boolean {
  return alongX(a) ? a.minX < b.minX - EPS && a.maxX > b.maxX + EPS : a.minZ < b.minZ - EPS && a.maxZ > b.maxZ + EPS;
}

/**
 * The roads that own a road's overlaps: where a road ends in another one that runs on through, the through road owns the
 * junction square; two roads that both end there (an L corner) or both pass (a crossing) leave it to the one listed first.
 * Each junction square is therefore drawn once, by one road, in one material. Pure.
 */
export function cutters(roads: readonly RoadDef[], id: string): Rect[] {
  const idx = roads.findIndex((r) => r.id === id);
  const me = roads[idx]!.rect;
  const out: Rect[] = [];
  roads.forEach((o, j) => {
    if (j === idx || !overlapArea(me, o.rect)) return;
    const meThrough = passes(me, o.rect);
    const oThrough = passes(o.rect, me);
    if (oThrough && !meThrough) out.push(o.rect);
    else if (oThrough === meThrough && j < idx) out.push(o.rect);
  });
  return out;
}

/** `r` minus `cut` as up to four rects. Pure. */
export function subtract(r: Rect, cut: Rect): Rect[] {
  const c = overlapArea(r, cut);
  if (!c) return [r];
  const out: Rect[] = [];
  if (c.minZ - r.minZ > EPS) out.push({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: c.minZ });
  if (r.maxZ - c.maxZ > EPS) out.push({ minX: r.minX, maxX: r.maxX, minZ: c.maxZ, maxZ: r.maxZ });
  if (c.minX - r.minX > EPS) out.push({ minX: r.minX, maxX: c.minX, minZ: c.minZ, maxZ: c.maxZ });
  if (r.maxX - c.maxX > EPS) out.push({ minX: c.maxX, maxX: r.maxX, minZ: c.minZ, maxZ: c.maxZ });
  return out;
}

/** The surface of a road split into the pieces it owns (junction squares owned by another road are left out). Pure. */
export function surfacePieces(roads: readonly RoadDef[], id: string): Rect[] {
  let pieces: Rect[] = [roads.find((r) => r.id === id)!.rect];
  for (const c of cutters(roads, id)) pieces = pieces.flatMap((p) => subtract(p, c));
  return pieces;
}

// ---------------------------------------------------------------------------
// Road ends
// ---------------------------------------------------------------------------

export type RoadEnd = 'minX' | 'maxX' | 'minZ' | 'maxZ';

/** A road end that is NOT meant to touch another road: why, and the colour the road blends into there (if any). */
export interface Terminal {
  id: string;
  end: RoadEnd;
  why: string;
  blend?: number;
}

/** Colour of the Market Town's paving (the square's cobbles, assets groundTex STONES). */
export const TOWN_STONE = 0xb4c0d0;

/** Deliberate terminals. Every other road end must touch another road rect (tests/roadJoins.test.ts). */
export const TERMINALS: readonly Terminal[] = [
  { id: 'southAvenue', end: 'minZ', why: "through the Market Town's south fence gap; TOWN_APRON paves it on to the square", blend: TOWN_STONE },
  { id: 'r3', end: 'minX', why: "the trail's last stretch ends past era X's gate (0.9.9)" },
  { id: 'cityLink', end: 'minX', why: "runs into the Market Town's cobbled square (its east edge x 32.2)", blend: TOWN_STONE },
  { id: 'townEast', end: 'minX', why: "runs into the Market Town's cobbled square (its east edge x 32.2)", blend: TOWN_STONE },
  { id: 'cityWest', end: 'minZ', why: "the city grid's north edge (districts start at z 14)" },
  { id: 'cityV1', end: 'minZ', why: "the city grid's north edge (districts start at z 14)" },
  { id: 'cityV2', end: 'minZ', why: "the city grid's north edge (districts start at z 14)" },
  { id: 'cityH1', end: 'maxX', why: "the city grid's east edge (districts end at x 142)" },
  { id: 'cityH2', end: 'maxX', why: "the city grid's east edge (districts end at x 142)" },
];

/** The two ends of a road along its axis, as a thin strip just outside the end (to test for touching roads). Pure. */
export function endStrip(r: Rect, end: RoadEnd, d = 0.05): Rect {
  switch (end) {
    case 'minX':
      return { minX: r.minX - d, maxX: r.minX + d, minZ: r.minZ, maxZ: r.maxZ };
    case 'maxX':
      return { minX: r.maxX - d, maxX: r.maxX + d, minZ: r.minZ, maxZ: r.maxZ };
    case 'minZ':
      return { minX: r.minX, maxX: r.maxX, minZ: r.minZ - d, maxZ: r.minZ + d };
    default:
      return { minX: r.minX, maxX: r.maxX, minZ: r.maxZ - d, maxZ: r.maxZ + d };
  }
}

export const axisEnds = (r: Rect): [RoadEnd, RoadEnd] => (alongX(r) ? ['minX', 'maxX'] : ['minZ', 'maxZ']);

/** Road ends that touch no other road and are not listed terminals (dead ends in the snow). Pure. */
export function deadEnds(roads: readonly RoadDef[], terminals: readonly Terminal[] = TERMINALS): string[] {
  const out: string[] = [];
  for (const road of roads) {
    for (const end of axisEnds(road.rect)) {
      if (terminals.some((t) => t.id === road.id && t.end === end)) continue;
      const strip = endStrip(road.rect, end);
      // touching or overlapping another road's rect (strict overlap of the thin strip)
      const hit = roads.some((o) => o.id !== road.id && overlapArea(strip, o.rect));
      if (!hit) out.push(`${road.id}.${end}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wheel ruts
// ---------------------------------------------------------------------------

export interface RutLine {
  road: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** A quarter circle of rut round an L corner: centre (the corner's inner point), radius, start angle and signed sweep. */
export interface RutArc {
  /** The road that draws it (the first-listed of the two that meet on the corner). */
  road: string;
  cx: number;
  cz: number;
  r: number;
  a0: number;
  sweep: number;
}

export interface RutPlan {
  lines: RutLine[];
  arcs: RutArc[];
}

/**
 * The wheel ruts of every trail road. A rut stops at the edge of any road it ends in (a T's side road stops at the main
 * road; a trail ending in a city street stops at the kerb). Where two trail roads end on the same square (an L corner:
 * r1/westLink, westLink/r2, r2/eastLink, eastLink/r3) the two rut pairs join in one curved pair round the corner.
 * Main-road ruts run straight through a junction (nothing else draws ruts there). Pure.
 */
export function rutPlan(roads: readonly RoadDef[] = ROADS, margin = 0.5): RutPlan {
  const lines: RutLine[] = [];
  const arcs: RutArc[] = [];
  const trails = roads.filter((r) => !isStreet(r.id));
  for (const road of trails) {
    const r = road.rect;
    const ax = alongX(r);
    let a0 = (ax ? r.minX : r.minZ) + margin;
    let a1 = (ax ? r.maxX : r.maxZ) - margin;
    const cc = ax ? (r.minZ + r.maxZ) / 2 : (r.minX + r.maxX) / 2;
    for (const o of roads) {
      if (o.id === road.id) continue;
      const s = overlapArea(r, o.rect);
      if (!s) continue;
      const lo = ax ? s.minX : s.minZ;
      const hi = ax ? s.maxX : s.maxZ;
      // the junction square holds this road's start / end: the ruts stop at its inner edge
      if (lo <= (ax ? r.minX : r.minZ) + EPS) a0 = Math.max(a0, hi);
      if (hi >= (ax ? r.maxX : r.maxZ) - EPS) a1 = Math.min(a1, lo);
    }
    if (a1 - a0 < 1) continue;
    for (const side of [-RUT_OFFSET, RUT_OFFSET]) {
      lines.push(ax ? { road: road.id, x0: a0, z0: cc + side, x1: a1, z1: cc + side } : { road: road.id, x0: cc + side, z0: a0, x1: cc + side, z1: a1 });
    }
  }
  // L corners: two perpendicular trails that both end on the same square
  for (let i = 0; i < trails.length; i++) {
    for (let j = i + 1; j < trails.length; j++) {
      const h = alongX(trails[i]!.rect) ? trails[i]! : trails[j]!;
      const v = h === trails[i] ? trails[j]! : trails[i]!;
      if (!alongX(h.rect) || alongX(v.rect)) continue;
      const s = overlapArea(h.rect, v.rect);
      if (!s) continue;
      if (passes(h.rect, v.rect) || passes(v.rect, h.rect)) continue;
      const sx = h.rect.maxX > s.maxX + EPS ? 1 : -1; // H runs on east / west of the square
      const sz = v.rect.maxZ > s.maxZ + EPS ? 1 : -1; // V runs on south / north of it
      const ix = sx > 0 ? s.maxX : s.minX;
      const iz = sz > 0 ? s.maxZ : s.minZ;
      const zc = (h.rect.minZ + h.rect.maxZ) / 2;
      const xc = (v.rect.minX + v.rect.maxX) / 2;
      for (const k of [-1, 1]) {
        // k = 1: the rut on the inside of the turn, k = -1: the outside one
        const zr = zc + sz * RUT_OFFSET * k;
        const xr = xc + sx * RUT_OFFSET * k;
        const r = Math.abs(iz - zr);
        const startA = Math.atan2(zr - iz, 0);
        const endA = Math.atan2(0, xr - ix);
        let sweep = endA - startA;
        while (sweep > Math.PI) sweep -= 2 * Math.PI;
        while (sweep < -Math.PI) sweep += 2 * Math.PI;
        arcs.push({ road: trails[i]!.id, cx: ix, cz: iz, r, a0: startA, sweep });
      }
    }
  }
  return { lines, arcs };
}

/** Sample a rut arc as `n` short straight pieces. Pure. */
export function arcSegments(a: RutArc, n = 8): Array<[number, number, number, number]> {
  const pts: Array<[number, number]> = [];
  for (let k = 0; k <= n; k++) {
    const t = a.a0 + (a.sweep * k) / n;
    pts.push([a.cx + Math.cos(t) * a.r, a.cz + Math.sin(t) * a.r]);
  }
  return pts.slice(1).map((p, k) => [pts[k]![0], pts[k]![1], p[0], p[1]]);
}

// ---------------------------------------------------------------------------
// The town apron and the region gates' paving
// ---------------------------------------------------------------------------

/**
 * The south avenue's paving carried on through the Market Town's fence gap to the square's cobbles: the avenue's width,
 * from its north end (z 46.8, 0.6 m inside the fence) up to just inside the square's south edge.
 */
export function townApron(): Rect {
  const av = ROADS.find((r) => r.id === 'southAvenue')!.rect;
  return { minX: av.minX, maxX: av.maxX, minZ: LAYOUT.town.square.maxZ - 0.15, maxZ: av.minZ };
}

/** Length of the paved stretch in front of each region gate (metres). */
export const GATE_PAVING_LENGTH = 10;

export interface GatePaving {
  era: number;
  road: string;
  rect: Rect;
}

/** The 10 m of road in front of each region gate (eras 2..10), clipped to its road. Pure. */
export function gatePavings(): GatePaving[] {
  const out: GatePaving[] = [];
  for (let n = 2; n <= 10; n++) {
    let l;
    try {
      l = regionLayout(n);
    } catch {
      continue;
    }
    const road = ROADS.find((r) => r.id === l.road);
    if (!road) continue;
    const r = road.rect;
    const h = GATE_PAVING_LENGTH / 2;
    out.push({ era: n, road: road.id, rect: { minX: Math.max(r.minX, l.gate.x - h), maxX: Math.min(r.maxX, l.gate.x + h), minZ: r.minZ, maxZ: r.maxZ } });
  }
  return out;
}
