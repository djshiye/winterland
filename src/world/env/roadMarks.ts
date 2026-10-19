/**
 * Road markings: zebra crosswalks where people cross the roads (each region's market gate, the Market Town's east
 * mouths, the south avenue's end at R1, every city district connector that meets a street) and a soft dashed centre
 * line on the city streets. `crosswalks()` / `centreDashes()` are pure (tests check every mark lies on its road);
 * `addZebra` paints one into a batch (town.ts and frontier.ts merge them into their own static meshes, no extra draws).
 */
import { districtWalkways } from '../../city/roadRoute';
import { DISTRICTS, ROADS, type ERect } from '../../eras/data';
import { regionLayout } from '../../eras/layout';
import { geo } from '../../render/materials';
import type { Batch } from '../../render/batch';
import { isStreet, overlapArea } from './roadJoins';

export const ZEBRA_WHITE = 0xf7fbff;
export const ZEBRA_EDGE = 0xf6d04d;
export const DASH_CREAM = 0xf1e8d2;

export interface Crosswalk {
  /** The road it is painted on (ROADS id), or '' for a mark drawn by another module (the town corridor). */
  road: string;
  /** The traffic's direction: stripes run along it, people cross at right angles. */
  axis: 'x' | 'z';
  /** Centre of the crossing along the traffic axis. */
  at: number;
  /** The road's extent across the traffic. */
  lo: number;
  hi: number;
  /** Width of the crossing along the traffic axis (the stripes run `span + 0.3`, the edge lines stand beyond them). */
  span: number;
  /** Centre height of the stripes (0.03 = flush with the road surface, higher over paving). */
  y: number;
}

/** Zebra: white stripes along the traffic, spaced across the road, between two yellow edge lines. */
export function addZebra(b: Batch, c: Crosswalk): void {
  const alongZ = c.axis === 'z';
  const mid = (c.lo + c.hi) / 2;
  const put = (w: number, h: number, d: number, color: number, across: number, along: number): void => {
    b.add(geo.box(alongZ ? w : d, h, alongZ ? d : w), color, alongZ ? across : along, c.y, alongZ ? along : across);
  };
  for (let t = c.lo + 0.45; t < c.hi - 0.2; t += 0.78) put(0.42, 0.018, c.span + 0.3, ZEBRA_WHITE, t, c.at);
  for (const s of [-1, 1]) put(c.hi - c.lo - 0.5, 0.016, 0.1, ZEBRA_EDGE, mid, c.at + s * (c.span / 2 + 0.28));
}

const GATE_SPAN = 2.2;
const CONNECTOR_SPAN = 1.8;
/** Where a crossing is painted: just above the road surface (ROAD_Y 0.03 + ruts / cobble speckle), over a gate's paving. */
const Y_STREET = 0.052;
const Y_TRAIL = 0.056;
const Y_PAVED = 0.072;

const roadRect = (id: string): ERect => ROADS.find((r) => r.id === id)!.rect;
const alongX = (r: ERect): boolean => r.maxX - r.minX >= r.maxZ - r.minZ;

/** The rectangle a crossing paints (stripes plus both edge lines). */
export function crosswalkRect(c: Crosswalk): ERect {
  const h = c.span / 2 + 0.33;
  return c.axis === 'z' ? { minX: c.lo, maxX: c.hi, minZ: c.at - h, maxZ: c.at + h } : { minX: c.at - h, maxX: c.at + h, minZ: c.lo, maxZ: c.hi };
}

let cache: Crosswalk[] | null = null;

/** Every crosswalk on a ROADS road (the town corridor's own one, town.ts, is not in the list). */
export function crosswalks(): Crosswalk[] {
  if (cache) return cache;
  const out: Crosswalk[] = [];
  const add = (c: Crosswalk): void => {
    if (out.some((o) => o.road === c.road && o.axis === c.axis && Math.abs(o.at - c.at) < 0.5)) return;
    // never inside a junction owned by another road
    const q = crosswalkRect(c);
    if (ROADS.some((o) => o.id !== c.road && overlapArea(q, o.rect))) return;
    out.push(c);
  };
  // each region's market gate: shoppers cross the region road at the gate
  for (let n = 2; n <= 10; n++) {
    const l = regionLayout(n);
    const r = roadRect(l.road);
    add({ road: l.road, axis: 'x', at: l.gate.x, lo: r.minZ, hi: r.maxZ, span: GATE_SPAN, y: Y_PAVED });
  }
  // the south avenue's mouth on R1, just west of the T
  const av = roadRect('southAvenue');
  const r1 = roadRect('r1');
  add({ road: 'r1', axis: 'x', at: av.minX - 2.4, lo: r1.minZ, hi: r1.maxZ, span: GATE_SPAN, y: Y_TRAIL });
  // the Market Town's two east mouths, between the square and its fence
  for (const id of ['townEast', 'cityLink']) {
    const r = roadRect(id);
    add({ road: id, axis: 'x', at: 35, lo: r.minZ, hi: r.maxZ, span: CONNECTOR_SPAN, y: Y_STREET });
  }
  // each district's walk connectors that meet a street across the way
  for (let n = 2; n < DISTRICTS.length; n++) {
    for (const c of districtWalkways(n).slice(4, 8)) {
      const ns = c.maxX - c.minX < c.maxZ - c.minZ; // narrow in X: a north / south connector, its street runs along X
      for (const s of ROADS) {
        if (!isStreet(s.id)) continue;
        const r = s.rect;
        if (alongX(r) !== ns) continue;
        const e = 0.05;
        if (!ns) {
          // west / east connector: the street runs along Z beside it
          const touches = Math.abs(r.maxX - c.minX) < e || Math.abs(r.minX - c.maxX) < e;
          if (touches && c.minZ >= r.minZ && c.maxZ <= r.maxZ) add({ road: s.id, axis: 'z', at: (c.minZ + c.maxZ) / 2, lo: r.minX, hi: r.maxX, span: CONNECTOR_SPAN, y: Y_STREET });
        } else {
          const touches = Math.abs(r.maxZ - c.minZ) < e || Math.abs(r.minZ - c.maxZ) < e;
          if (touches && c.minX >= r.minX && c.maxX <= r.maxX) add({ road: s.id, axis: 'x', at: (c.minX + c.maxX) / 2, lo: r.minZ, hi: r.maxZ, span: CONNECTOR_SPAN, y: Y_STREET });
        }
      }
    }
  }
  cache = out;
  return out;
}

export interface Dash {
  road: string;
  x: number;
  z: number;
  /** Length along the street / width across it. */
  len: number;
  w: number;
  axis: 'x' | 'z';
}

const DASH_LEN = 0.9;
const DASH_PERIOD = 2.1;
const DASH_W = 0.13;
/** Dashes keep this far from a junction and from a crosswalk's edge lines. */
const DASH_GAP = 0.9;
export const DASH_Y = 0.048;

/** The dashed centre line of every city street, broken at junctions and crossings. */
export function centreDashes(): Dash[] {
  const out: Dash[] = [];
  const cws = crosswalks();
  for (const road of ROADS) {
    if (!isStreet(road.id)) continue;
    const r = road.rect;
    const ax = alongX(r) ? 'x' : 'z';
    const lo = ax === 'x' ? r.minX : r.minZ;
    const hi = ax === 'x' ? r.maxX : r.maxZ;
    const mid = ax === 'x' ? (r.minZ + r.maxZ) / 2 : (r.minX + r.maxX) / 2;
    const others = ROADS.filter((o) => o.id !== road.id).map((o) => o.rect);
    const marks = cws.filter((c) => c.road === road.id).map(crosswalkRect);
    for (let t = lo + 1.2; t + DASH_LEN < hi - 1.2; t += DASH_PERIOD) {
      const c = t + DASH_LEN / 2;
      const box: ERect = ax === 'x' ? { minX: c - DASH_LEN / 2 - DASH_GAP, maxX: c + DASH_LEN / 2 + DASH_GAP, minZ: mid - 0.1, maxZ: mid + 0.1 } : { minX: mid - 0.1, maxX: mid + 0.1, minZ: c - DASH_LEN / 2 - DASH_GAP, maxZ: c + DASH_LEN / 2 + DASH_GAP };
      if (others.some((o) => overlapArea(box, o)) || marks.some((m) => overlapArea(box, m))) continue;
      out.push({ road: road.id, x: ax === 'x' ? c : mid, z: ax === 'x' ? mid : c, len: DASH_LEN, w: DASH_W, axis: ax });
    }
  }
  return out;
}

/** Paint this road's crosswalks and (streets) its centre dashes into `b`. */
export function addRoadMarks(b: Batch, id: string): void {
  for (const c of crosswalks()) if (c.road === id) addZebra(b, c);
  for (const d of centreDashes()) {
    if (d.road === id) b.add(geo.box(d.axis === 'x' ? d.len : d.w, 0.012, d.axis === 'x' ? d.w : d.len), DASH_CREAM, d.x, DASH_Y, d.z);
  }
}
