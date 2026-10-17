/**
 * [PURE] 0.9.5 conveyor belts inside an era region (Dino: "no conveyor belts or automation"): which machines get a
 * belt and the path it runs. No THREE, no GameContext; tested in tests/eraBelts.test.ts.
 *
 * Who gets a belt (planBelts): every built processor input is linked to the nearest built machine (another slot) that
 * makes that kind, at most one belt into each input: first as many belts as fit with one belt out of each machine (a
 * maximum matching, shorter links preferred), then (0.9.6, F3) the inputs still without one, from a producer that
 * already feeds a belt (a splitter: two belts pull from one pile). Machines at most one row apart only. A belt never
 * shares its stretch of lane or corridor with another belt on the same level: when the ground level is taken there,
 * it runs on a raised level (an overhead conveyor, `level` 1 or 2), so nearly every input gets its belt in any build
 * order.
 * Whatever has no belt is still carried by the crew.
 *
 * The path (beltRoute): from just in front of the producer's output pile, along the producer row's BELT LANE (a line
 * in front of the machines' feed / take zones, toward the front yard), then, for a neighbouring row, down the column
 * gap between two cells (beside the workers' aisle, not on it) to the consumer row's lane, ending in front of the
 * consumer's input hopper. Items hop from the pile onto the belt and off it into the hopper (stations/Conveyor.ts).
 */
import type { MachineDef } from './data';
import type { RegionLayout, XZ } from './layout';
import { MACHINE_NOMINAL, toWorld } from './rules';

/**
 * Belt lane: this far in front of a machine's centre (its front face + the feed / take zones + half a belt), clear of
 * the workers' aisle on the row boundary (layout ROW_PITCH 10.5: the boundary is 5.25 in front of the centre).
 */
export const BELT_LANE = MACHINE_NOMINAL.d / 2 + 2.2;
/** Pile offsets the belt ends sit in front of (rules.ts PILE_OUT_U / PILE_U). */
const OUT_U = 1.5;
const IN_U = -1.4;
/**
 * A corridor belt runs this far beside the column boundary (the workers walk on the boundary itself), on the +u side
 * of a machine, never over the next machine's level pad or MANAGE zone (rules.ts, both on its −u side since 0.9.9).
 */
export const CORRIDOR_OFFSET = 0.6;
/** Belts closer than this (centre to centre) would touch. */
const CLEAR = 0.9;

/** 0.9.6: belt levels: 0 = on the ground (rollers at waist height), 1 and 2 = raised overhead (EraBelts BELT_LIFT). */
export const BELT_LEVELS = 3;

export interface BeltLink {
  /** Producer slot (its output pile feeds the belt). */
  from: number;
  /** Consumer slot (the belt ends at its input hopper). */
  to: number;
  kind: string;
  path: XZ[];
  /** 0.9.6: 0 on the ground, 1 or 2 raised (where the lower lanes are already taken). */
  level: number;
}

/** Row index of slot i (rows run away from the gate). */
export function rowOf(L: RegionLayout, i: number): number {
  const s0 = L.slots[0];
  const s = L.slots[i];
  if (!s0 || !s) return 0;
  return Math.round(((s.z - s0.z) * L.inward) / L.rowPitch);
}

/** World point of local (u, BELT_LANE) of slot i. */
function lanePoint(L: RegionLayout, i: number, u: number): XZ {
  const p = L.slots[i]!;
  return toWorld({ x: p.x, z: p.z }, p.yaw, u, BELT_LANE);
}

/** The belt path from slot `a`'s output pile to slot `b`'s input hopper, or null when they are more than a row apart. */
export function beltRoute(L: RegionLayout, a: number, b: number): XZ[] | null {
  return beltRoutes(L, a, b)[0] ?? null;
}

/**
 * Every way a belt can run from slot `a` to slot `b` (empty when they are more than a row apart): the straight lane
 * run in one row; into the next row down the corridor nearest the middle of the trip first, then (0.9.6) the corridors
 * nearest its start and its end, so a busy stretch of lane can be avoided.
 */
export function beltRoutes(L: RegionLayout, a: number, b: number): XZ[][] {
  if (a === b || !L.slots[a] || !L.slots[b]) return [];
  const ra = rowOf(L, a);
  const rb = rowOf(L, b);
  if (Math.abs(ra - rb) > 1) return [];
  const start = lanePoint(L, a, OUT_U);
  const end = lanePoint(L, b, IN_U);
  if (ra === rb) return [[start, end]];
  // column boundaries of the first row (it is always full: its boundaries exist)
  const s0 = L.slots[0]!;
  const cols = L.slots.filter((s) => Math.abs(s.z - s0.z) < 0.01).length;
  const boundary = (x: number): number => Math.min(cols - 1, Math.max(1, Math.round((x - (s0.x - L.cell / 2)) / L.cell)));
  // beside the boundary, on the MANAGE side (local +u, world +x for yaw 0): the cell left of the boundary has its +u
  // side there when +u points to +x, else the cell right of it does; the level pads sit on the other side
  const plusX = Math.cos(s0.yaw) > 0;
  const out: XZ[][] = [];
  for (const k of [boundary((start.x + end.x) / 2), boundary(start.x), boundary(end.x)]) {
    const xc = s0.x - L.cell / 2 + k * L.cell + (plusX ? -CORRIDOR_OFFSET : CORRIDOR_OFFSET);
    if (out.some((p) => Math.abs(p[1]!.x - xc) < 1e-6)) continue;
    out.push([start, { x: xc, z: start.z }, { x: xc, z: end.z }, end]);
  }
  return out;
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
  // every processor input with its options: each producer of the kind × each route, shortest first
  const inputs: { to: number; kind: string; opts: { from: number; path: XZ[]; len: number }[] }[] = [];
  machines.forEach((c, to) => {
    if (!c || c.kind !== 'processor') return;
    for (const inp of c.inputs) {
      const opts: { from: number; path: XZ[]; len: number }[] = [];
      machines.forEach((p, from) => {
        if (!p || from === to || p.output !== inp.kind) return;
        for (const path of beltRoutes(L, from, to)) opts.push({ from, path, len: len(path) });
      });
      if (opts.length === 0) continue;
      opts.sort((a, b) => a.len - b.len || a.from - b.from);
      inputs.push({ to, kind: inp.kind, opts });
    }
  });
  // a small exhaustive search (a region has at most a dozen inputs): the most belts, then the fewest splitters (two
  // belts out of one pile), then the fewest raised belts, then the shortest; ties keep the first found (deterministic)
  type Pick = { i: number; from: number; path: XZ[]; level: number; len: number };
  const segs: Seg[][][] = Array.from({ length: BELT_LEVELS }, () => []);
  const outs = new Map<number, number>();
  const cur: Pick[] = [];
  let best: Pick[] = [];
  let bestKey: number[] = [-1];
  let budget = 40_000;
  const key = (p: readonly Pick[]): number[] => {
    let splits = 0;
    for (const n of outs.values()) splits += Math.max(0, n - 1);
    return [p.length, -splits, -p.filter((x) => x.level > 0).length, -p.reduce((s, x) => s + x.len, 0)];
  };
  const better = (a: number[], b: number[]): boolean => {
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k]! > b[k]!;
    return false;
  };
  const dfs = (i: number): void => {
    if (budget-- <= 0) return;
    if (cur.length + (inputs.length - i) < bestKey[0]!) return;
    if (i === inputs.length) {
      const k = key(cur);
      if (better(k, bestKey)) {
        bestKey = k;
        best = [...cur];
      }
      return;
    }
    const inp = inputs[i]!;
    for (let level = 0; level < BELT_LEVELS; level++) {
      for (const o of inp.opts) {
        const s = segments(o.path);
        if (segs[level]!.some((t) => overlaps(s, t))) continue;
        segs[level]!.push(s);
        outs.set(o.from, (outs.get(o.from) ?? 0) + 1);
        cur.push({ i, from: o.from, path: o.path, level, len: o.len });
        dfs(i + 1);
        cur.pop();
        outs.set(o.from, outs.get(o.from)! - 1);
        segs[level]!.pop();
      }
    }
    dfs(i + 1); // this input without a belt (the crew carries it)
  };
  dfs(0);
  return best.map((p) => ({ from: p.from, to: inputs[p.i]!.to, kind: inputs[p.i]!.kind, path: p.path, level: p.level }));
}

/** Stable key of a belt (rebuild only what changed). */
export const beltKey = (b: Pick<BeltLink, 'from' | 'to' | 'kind'> & { level?: number }): string => `${b.from}>${b.to}:${b.kind}${b.level ? `^${b.level}` : ''}`;
