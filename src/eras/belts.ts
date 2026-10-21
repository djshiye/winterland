/**
 * [PURE] 0.9.5 conveyor belts inside an era region (Dino: "no conveyor belts or automation"): which machines get a
 * belt and the path it runs. No THREE, no GameContext; tested in tests/eraBelts.test.ts.
 *
 * Who gets a belt (planBelts): every built processor input is linked to the nearest built machine (another slot) that
 * makes that kind, at most one belt into each input: first as many belts as fit with one belt out of each machine (a
 * maximum matching, shorter links preferred), then (0.9.6, F3) the inputs still without one, from a producer that
 * already feeds a belt (a splitter: two belts pull from one pile). Machines at most MAX_ROW_GAP rows apart. A belt never
 * shares its stretch of lane or corridor with another belt on the same level: when the ground level is taken there,
 * it runs on a raised level (an overhead conveyor, `level` 1 or 2), and (0.9.12) never crosses one on the same
 * level either, so nearly every input gets its belt in any build
 * order. 0.9.14: two belts out of one pile may leave it back to back along the lane (a splitter), and two into one
 * hopper may arrive back to back (a merge); with the top lane level that belts every input of every era's full build.
 * 0.9.12 (Dino: "the conveyor doesn't go from the pellet mine to the steel mill"): the plan first gives every
 * processor that can have one at least one belt in, and only then the most belts, so a machine is never left standing
 * with no belt while its neighbours get two.
 * Whatever has no belt is still carried by the crew.
 *
 * The path (beltRoute): from just in front of the producer's output pile, along the producer row's BELT LANE (a line
 * in front of the machines' feed / take zones, toward the front yard), then, for a neighbouring row, down the column
 * gap between two cells (beside the workers' aisle, not on it; 0.9.12: past the row between, for a machine two rows
 * away) to the consumer row's lane, ending in front of the
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

/** 0.9.12: a belt reaches a machine at most this many rows away (was 1; the corridor runs past the row between). */
export const MAX_ROW_GAP = 2;

/**
 * 0.9.6: belt levels: 0 = on the ground (rollers at waist height), 1 and 2 = raised overhead (EraBelts BELT_LIFT).
 * 0.9.14: level 3, the highest, only for a straight run along one row's lane (TOP_LANE_ONLY): never down a corridor,
 * where the yard links' spans cross the gaps (eras/linkPlan.ts SPAN_CLEAR).
 */
export const BELT_LEVELS = 4;
/** 0.9.14: the top level (BELT_LEVELS - 1) carries only straight lane runs. */
export const TOP_LANE_ONLY = BELT_LEVELS - 1;

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

/** The belt path from slot `a`'s output pile to slot `b`'s input hopper, or null when they are too many rows apart. */
export function beltRoute(L: RegionLayout, a: number, b: number): XZ[] | null {
  return beltRoutes(L, a, b)[0] ?? null;
}

/**
 * Every way a belt can run from slot `a` to slot `b` (empty when they are more than MAX_ROW_GAP rows apart): the
 * straight lane run in one row; into another row down the corridor nearest the middle of the trip first, then (0.9.6)
 * the corridors nearest its start and its end, so a busy stretch of lane can be avoided.
 */
export function beltRoutes(L: RegionLayout, a: number, b: number): XZ[][] {
  if (a === b || !L.slots[a] || !L.slots[b]) return [];
  const ra = rowOf(L, a);
  const rb = rowOf(L, b);
  if (Math.abs(ra - rb) > MAX_ROW_GAP) return [];
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

/** A belt's straight runs, and its two ends (the producer's pile, the consumer's hopper). */
interface SegPath {
  segs: Seg[];
  start: XZ;
  end: XZ;
}

function segments(path: readonly XZ[]): SegPath {
  const out: Seg[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    if (Math.abs(a.z - b.z) < 1e-6) out.push({ dir: 'h', at: a.z, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    else out.push({ dir: 'v', at: a.x, lo: Math.min(a.z, b.z), hi: Math.max(a.z, b.z) });
  }
  return { segs: out, start: path[0]!, end: path[path.length - 1]! };
}

const same = (p: XZ, q: XZ): boolean => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.z - q.z) < 1e-6;

/**
 * Two belts would run into each other: parallel and overlapping (closer than CLEAR), or (0.9.12) crossing, where the
 * rollers would cut through each other (a two-row belt's corridor over the middle row's lane). Perpendicular runs
 * that stay more than CLEAR / 2 apart are fine.
 */
function overlaps(pa: SegPath, pb: SegPath): boolean {
  const half = CLEAR / 2;
  // 0.9.14: two belts out of one pile (or into one hopper) may leave (or arrive) back to back along the same lane: a
  // splitter (or a merge) at the shared end, as long as their runs only meet in that point
  const shared = same(pa.start, pb.start) ? pa.start : same(pa.end, pb.end) ? pa.end : null;
  for (const s of pa.segs) {
    for (const t of pb.segs) {
      if (s.dir !== t.dir) {
        // s runs along one axis at s.at, t along the other at t.at: they meet at (t.at on s, s.at on t)
        if (t.at > s.lo - half && t.at < s.hi + half && s.at > t.lo - half && s.at < t.hi + half) return true;
        continue;
      }
      if (Math.abs(s.at - t.at) >= CLEAR) continue;
      if (shared && Math.abs(s.at - t.at) < 1e-6) {
        const p = s.dir === 'h' ? shared.x : shared.z;
        const q = s.dir === 'h' ? shared.z : shared.x;
        // back to back: one run ends at the shared point and the other starts there
        if (Math.abs(q - s.at) < 1e-6 && ((Math.abs(s.hi - p) < 1e-6 && Math.abs(t.lo - p) < 1e-6) || (Math.abs(s.lo - p) < 1e-6 && Math.abs(t.hi - p) < 1e-6))) continue;
      }
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
  // a small exhaustive search (a region has at most a dozen inputs): the most processors with a belt in (0.9.12), then
  // the most belts, then the fewest splitters (two belts out of one pile), then the fewest on the top level (0.9.14),
  // then the fewest raised belts, then the shortest; ties keep the first found (deterministic)
  type Pick = { i: number; from: number; path: XZ[]; level: number; len: number };
  const segs: SegPath[][] = Array.from({ length: BELT_LEVELS }, () => []);
  const outs = new Map<number, number>();
  // belts into each processor so far, and the processors still ahead from input i on (for the bound below)
  const ins = new Map<number, number>();
  const ahead = inputs.map((_, i) => new Set(inputs.slice(i).map((x) => x.to)));
  const cur: Pick[] = [];
  let best: Pick[] = [];
  let bestKey: number[] = [-1, -1];
  let budget = 40_000;
  const fed = (): number => [...ins.values()].filter((n) => n > 0).length;
  const key = (p: readonly Pick[]): number[] => {
    let splits = 0;
    for (const n of outs.values()) splits += Math.max(0, n - 1);
    return [fed(), p.length, -splits, -p.filter((x) => x.level === TOP_LANE_ONLY).length, -p.filter((x) => x.level > 0).length, -p.reduce((s, x) => s + x.len, 0)];
  };
  const better = (a: number[], b: number[]): boolean => {
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k]! > b[k]!;
    return false;
  };
  const dfs = (i: number): void => {
    if (budget-- <= 0) return;
    // nothing down this branch can beat the best plan: too few processors fed, or as many but too few belts
    let canFeed = fed();
    if (i < inputs.length) for (const to of ahead[i]!) if (!ins.get(to)) canFeed++;
    if (canFeed < bestKey[0]! || (canFeed === bestKey[0] && cur.length + (inputs.length - i) < bestKey[1]!)) return;
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
        if (level === TOP_LANE_ONLY && o.path.length > 2) continue;
        const s = segments(o.path);
        if (segs[level]!.some((t) => overlaps(s, t))) continue;
        segs[level]!.push(s);
        outs.set(o.from, (outs.get(o.from) ?? 0) + 1);
        ins.set(inp.to, (ins.get(inp.to) ?? 0) + 1);
        cur.push({ i, from: o.from, path: o.path, level, len: o.len });
        dfs(i + 1);
        cur.pop();
        ins.set(inp.to, ins.get(inp.to)! - 1);
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
