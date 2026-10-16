/**
 * [PURE] 0.9.5 conveyor belts inside an era region (Dino: "no conveyor belts or automation"): which machines get a
 * belt and the path it runs. No THREE, no GameContext; tested in tests/eraBelts.test.ts.
 *
 * Who gets a belt (planBelts): every built processor input is linked to the nearest built machine (another slot) that
 * makes that kind, at most one belt into each input and one belt out of each machine, shortest links first. Machines
 * at most one row apart only, and a belt never shares its stretch of lane or corridor with another belt. Whatever has
 * no belt is still carried by the crew.
 *
 * The path (beltRoute): from just in front of the producer's output pile, along the producer row's BELT LANE (a line
 * in front of the machines' feed / take zones, toward the front yard), then, for a neighbouring row, down the column
 * gap between two cells (beside the workers' aisle, not on it) to the consumer row's lane, ending in front of the
 * consumer's input hopper. Items hop from the pile onto the belt and off it into the hopper (stations/Conveyor.ts).
 */
import type { MachineDef } from './data';
import type { RegionLayout, XZ } from './layout';
import { MACHINE_NOMINAL, toWorld } from './rules';

/** Belt lane: this far in front of a machine's centre (its front face + the feed / take zones + half a belt). */
export const BELT_LANE = MACHINE_NOMINAL.d / 2 + 2.3;
/** Pile offsets the belt ends sit in front of (rules.ts PILE_OUT_U / PILE_U). */
const OUT_U = 1.5;
const IN_U = -1.4;
/** A corridor belt runs this far beside the column boundary (the workers walk on the boundary itself). */
export const CORRIDOR_OFFSET = 0.75;
/** Belts closer than this (centre to centre) would touch. */
const CLEAR = 0.9;

export interface BeltLink {
  /** Producer slot (its output pile feeds the belt). */
  from: number;
  /** Consumer slot (the belt ends at its input hopper). */
  to: number;
  kind: string;
  path: XZ[];
}

/** Row index of slot i (rows run away from the gate). */
export function rowOf(L: RegionLayout, i: number): number {
  const s0 = L.slots[0];
  const s = L.slots[i];
  if (!s0 || !s) return 0;
  return Math.round(((s.z - s0.z) * L.inward) / L.cell);
}

/** World point of local (u, BELT_LANE) of slot i. */
function lanePoint(L: RegionLayout, i: number, u: number): XZ {
  const p = L.slots[i]!;
  return toWorld({ x: p.x, z: p.z }, p.yaw, u, BELT_LANE);
}

/** The belt path from slot `a`'s output pile to slot `b`'s input hopper, or null when they are more than a row apart. */
export function beltRoute(L: RegionLayout, a: number, b: number): XZ[] | null {
  if (a === b || !L.slots[a] || !L.slots[b]) return null;
  const ra = rowOf(L, a);
  const rb = rowOf(L, b);
  if (Math.abs(ra - rb) > 1) return null;
  const start = lanePoint(L, a, OUT_U);
  const end = lanePoint(L, b, IN_U);
  if (ra === rb) return [start, end];
  // the column boundary nearest the middle of the trip (first row is always full: its boundaries exist)
  const s0 = L.slots[0]!;
  const cols = L.slots.filter((s) => Math.abs(s.z - s0.z) < 0.01).length;
  const mid = (start.x + end.x) / 2;
  const k = Math.min(cols - 1, Math.max(1, Math.round((mid - (s0.x - L.cell / 2)) / L.cell)));
  const xb = s0.x - L.cell / 2 + k * L.cell;
  // beside the boundary, on the side of the trip's middle (never on the workers' aisle)
  const xc = xb + (mid >= xb ? CORRIDOR_OFFSET : -CORRIDOR_OFFSET);
  return [start, { x: xc, z: start.z }, { x: xc, z: end.z }, end];
}

/** Built machines as planBelts sees them: slot → def (null = empty / under construction). */
export type SlotMachines = readonly (Pick<MachineDef, 'kind' | 'inputs' | 'output'> | null)[];

interface Seg {
  /** 'h' runs along X at z = at; 'v' along Z at x = at. */
  dir: 'h' | 'v';
  at: number;
  lo: number;
  hi: number;
}

function segments(path: readonly XZ[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    if (Math.abs(a.z - b.z) < 1e-6) out.push({ dir: 'h', at: a.z, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    else out.push({ dir: 'v', at: a.x, lo: Math.min(a.z, b.z), hi: Math.max(a.z, b.z) });
  }
  return out;
}

/** Two belts would run on top of each other (parallel and overlapping, closer than CLEAR). Crossings are allowed. */
function overlaps(a: readonly Seg[], b: readonly Seg[]): boolean {
  for (const s of a) {
    for (const t of b) {
      if (s.dir !== t.dir || Math.abs(s.at - t.at) >= CLEAR) continue;
      if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > -CLEAR) return true;
    }
  }
  return false;
}

const len = (p: readonly XZ[]): number => p.reduce((sum, q, i) => (i === 0 ? 0 : sum + Math.abs(q.x - p[i - 1]!.x) + Math.abs(q.z - p[i - 1]!.z)), 0);

/** The belts a region should have now (see the file header). Deterministic: same machines, same belts. */
export function planBelts(L: RegionLayout, machines: SlotMachines): BeltLink[] {
  const cands: BeltLink[] = [];
  machines.forEach((c, to) => {
    if (!c || c.kind !== 'processor') return;
    for (const inp of c.inputs) {
      machines.forEach((p, from) => {
        if (!p || from === to || p.output !== inp.kind) return;
        const path = beltRoute(L, from, to);
        if (path) cands.push({ from, to, kind: inp.kind, path });
      });
    }
  });
  cands.sort((a, b) => len(a.path) - len(b.path) || a.from - b.from || a.to - b.to);
  const out: BeltLink[] = [];
  const usedFrom = new Set<number>();
  const usedIn = new Set<string>();
  const segs: Seg[][] = [];
  for (const c of cands) {
    if (usedFrom.has(c.from) || usedIn.has(`${c.to}:${c.kind}`)) continue;
    const s = segments(c.path);
    if (segs.some((t) => overlaps(s, t))) continue;
    out.push(c);
    segs.push(s);
    usedFrom.add(c.from);
    usedIn.add(`${c.to}:${c.kind}`);
  }
  return out;
}

/** Stable key of a belt (rebuild only what changed). */
export const beltKey = (b: Pick<BeltLink, 'from' | 'to' | 'kind'>): string => `${b.from}>${b.to}:${b.kind}`;
