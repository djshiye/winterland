/**
 * [PURE] 0.9.12 overhead links between the machines of an era region (Dino: "the era machine areas don't look as cool
 * as the starting area which has the cool pipes and connected conveyor belts"). Visual only: nothing rides them in the
 * game's books; the crew and the Belts upgrade (eras/belts.ts) still move every item. No THREE, no GameContext; tested
 * in tests/yardLinks.test.ts.
 *
 * Every two built machines side by side in a row are joined by one overhead link (assets/yardLinks.ts draws it in the
 * era's style: a chute, a ropeway, a tube, a pipe...). Each end stands on a RISER: a post inside the machine's own
 * solid body (its collider), at its back corner, so nothing new ever stands where anyone walks. From each riser's head
 * an arm reaches back over the strip behind the machines, and the span runs between the two arms' ends: high over the
 * gap between the machines (over the workers' aisle and the corridor belts, above the highest raised belt with an item
 * riding it). Why behind: seen from the camera (+X / +Z, 48° up) anything that high appears 2.4-3.3 m further toward
 * the gate; a span straight across the gap would cover the level pad, its sign or the MANAGE board standing in front
 * of the machine (#84) on that side. From BACK_REACH behind the body it lands on the free strip behind the pad.
 *
 * Flow: from the machine whose product the other one uses (a quarry into a kiln), else from the extractor into the
 * processor, else left to right. `kind` is what the producer makes (the carriers show it riding along).
 */
import type { MachineDef } from './data';
import type { RegionLayout, XZ } from './layout';
import { rowOf } from './belts';
import { toWorld } from './rules';

/** Riser inset from the body's side and from its back face (inside the body: under its collider). */
export const RISER_IN = 0.35;
/**
 * A riser on a body's west side (world −X) stands further in: its tall head, seen from the camera, appears ~3 m to the
 * west, where the west neighbour's level pad is (pads sit on a machine's east side).
 */
export const RISER_IN_WEST = 1.45;
export const RISER_BACK = 0.35;
/** The span runs this far behind the deeper machine's back face (the arms reach out to it). */
export const BACK_REACH = 0.85;
/** Height of the span's centre line at the risers (metres). */
export const SPAN_Y = 4.4;
/**
 * Nothing a link hangs or carries comes lower than this over the gap: the highest raised belt (EraBelts BELT_LIFT[2]
 * 2.6 + beltY 0.5) with a riding item (≤ 0.45) tops out at 3.55.
 */
export const SPAN_CLEAR = 3.75;

/** A built machine as the planner sees it: what it eats and makes, and its body's size (model w × d). */
export interface LinkMachine extends Pick<MachineDef, 'inputs' | 'output'> {
  w: number;
  d: number;
}

export interface YardRiser {
  slot: number;
  x: number;
  z: number;
}

export interface YardLink {
  /** Producer and consumer slots (flow runs from → to). */
  from: number;
  to: number;
  /** What the producer makes. */
  kind: string;
  /** Ground plan of the link from the producer's riser to the consumer's: riser, arm end, arm end, riser (world). */
  path: XZ[];
  /**
   * A machine alone in its row (the 9th spot of eras 8 and 9) joins the row in front with a BRANCH: from the front
   * row's span out over the aisle, across it halfway between the rows, and in to a riser inside its own front corner. Its row-side end is a joint on that
   * span (no riser) when the span is there, else the front machine's riser. Rigid kinds only draw it.
   */
  branch?: boolean;
}

export interface YardLinkPlan {
  links: YardLink[];
  risers: YardRiser[];
}

/** Local (u, v) of a machine's riser on side `side` (−1 / +1 along its local X): its back corner, inside the body. */
export function riserLocal(w: number, d: number, side: -1 | 1, inset = RISER_IN): { u: number; v: number } {
  return { u: side * (w / 2 - inset), v: -d / 2 + RISER_BACK };
}

/** The links a region shows for these built machines (slot → machine, null = empty). Deterministic. */
export function planYardLinks(L: RegionLayout, machines: readonly (LinkMachine | null)[]): YardLinkPlan {
  const links: YardLink[] = [];
  const risers: YardRiser[] = [];
  const riserAt = (i: number, worldDir: 1 | -1): XZ => {
    const m = machines[i]!;
    const p = L.slots[i]!;
    // the local side whose +u points along world +X (yaw 0) or −X (yaw PI)
    const side = (Math.cos(p.yaw) >= 0 ? worldDir : -worldDir) as 1 | -1;
    const l = riserLocal(m.w, m.d, side, worldDir < 0 ? RISER_IN_WEST : RISER_IN);
    const w = toWorld({ x: p.x, z: p.z }, p.yaw, l.u, l.v);
    if (!risers.some((r) => r.slot === i && Math.abs(r.x - w.x) < 1e-6 && Math.abs(r.z - w.z) < 1e-6)) risers.push({ slot: i, x: w.x, z: w.z });
    return w;
  };
  // rows, west to east
  const rows = new Map<number, number[]>();
  L.slots.forEach((_, i) => {
    const r = rowOf(L, i);
    const list = rows.get(r) ?? [];
    list.push(i);
    rows.set(r, list);
  });
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(r)!.sort((a, b) => L.slots[a]!.x - L.slots[b]!.x);
    for (let k = 1; k < row.length; k++) {
      const i = row[k - 1]!;
      const j = row[k]!;
      const mi = machines[i];
      const mj = machines[j];
      if (!mi || !mj) continue;
      // neighbours only (no link across an empty cell's gap)
      if (Math.abs(L.slots[j]!.x - L.slots[i]!.x - L.cell) > 0.01) continue;
      const feeds = (p: LinkMachine, c: LinkMachine): boolean => c.inputs.some((inp) => inp.kind === p.output);
      let forward = true;
      if (feeds(mi, mj)) forward = true;
      else if (feeds(mj, mi)) forward = false;
      else if (mj.inputs.length === 0 && mi.inputs.length > 0) forward = false;
      const a = riserAt(i, 1);
      const b = riserAt(j, -1);
      // the arms' ends: straight behind each riser, on one line BACK_REACH behind the deeper body
      const p = L.slots[i]!;
      const back = toWorld({ x: p.x, z: p.z }, p.yaw, 0, -(Math.max(mi.d, mj.d) / 2 + BACK_REACH));
      const ea = { x: a.x, z: back.z };
      const eb = { x: b.x, z: back.z };
      const path = [a, ea, eb, b];
      links.push(forward ? { from: i, to: j, kind: mi.output, path } : { from: j, to: i, kind: mj.output, path: path.reverse() });
    }
  }
  // a machine alone in its row: one branch to the nearest machine of the row in front
  const order = [...rows.keys()].sort((a, b) => a - b);
  for (let k = 1; k < order.length; k++) {
    const lone = rows.get(order[k]!)!;
    const front = rows.get(order[k - 1]!)!;
    if (lone.length !== 1) continue;
    const j = lone[0]!;
    const mj = machines[j];
    const q = L.slots[j]!;
    if (!mj) continue;
    // the front machine nearest in x, and its riser on the side facing the lone one
    let bi = -1;
    for (const i of front) if (machines[i] && (bi < 0 || Math.abs(L.slots[i]!.x - q.x) < Math.abs(L.slots[bi]!.x - q.x))) bi = i;
    if (bi < 0) continue;
    const mi = machines[bi]!;
    const pi = L.slots[bi]!;
    const dir = (q.x >= pi.x ? 1 : -1) as 1 | -1;
    const sideI = (Math.cos(pi.yaw) >= 0 ? dir : -dir) as 1 | -1;
    const li = riserLocal(mi.w, mi.d, sideI, dir < 0 ? RISER_IN_WEST : RISER_IN);
    const a = toWorld({ x: pi.x, z: pi.z }, pi.yaw, li.u, li.v);
    // the lone machine's riser: inside its front corner on the side facing the front machine
    const sideJ = (Math.cos(q.yaw) >= 0 ? -dir : dir) as 1 | -1;
    const lj = riserLocal(mj.w, mj.d, sideJ, dir > 0 ? RISER_IN_WEST : RISER_IN);
    const b = toWorld({ x: q.x, z: q.z }, q.yaw, lj.u, -lj.v);
    // start on the front row's span (where that riser's arm meets it), or at the riser when it has no span
    const same = (u: XZ, v: XZ): boolean => Math.abs(u.x - v.x) < 1e-6 && Math.abs(u.z - v.z) < 1e-6;
    const arm = links.find((l) => same(l.path[0]!, a) || same(l.path[3]!, a));
    const start = arm ? (same(arm.path[0]!, a) ? arm.path[1]! : arm.path[2]!) : a;
    if (Math.abs(b.z - start.z) < 1) continue;
    if (!arm) riserAt(bi, dir);
    risers.push({ slot: j, x: b.x, z: b.z });
    // out over the aisle, across it halfway between the rows, and in to the riser
    const mid = (start.z + b.z) / 2;
    const path = [{ x: start.x, z: start.z }, { x: start.x, z: mid }, { x: b.x, z: mid }, b];
    const feeds = (p: LinkMachine, c: LinkMachine): boolean => c.inputs.some((inp) => inp.kind === p.output);
    const forward = feeds(mi, mj) || (!feeds(mj, mi) && !(mj.inputs.length === 0 && mi.inputs.length > 0));
    links.push(forward ? { from: bi, to: j, kind: mi.output, path, branch: true } : { from: j, to: bi, kind: mj.output, path: path.reverse(), branch: true });
  }
  return { links, risers };
}
