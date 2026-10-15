/**
 * [eras] Pure rules of the era regions (no THREE, no GameContext): local → world frames, the geometry of a machine
 * cell and of the front-yard facilities, input caps, demolish price, choose-card texts, the info-card rows and the
 * "settle a fully paid slot" rule. Shared by Machine / Region / EraWorld; tested without WebGL.
 *
 * Frames: every placed thing (machine, depot, dock) has a LOCAL frame at its centre whose +Z is its front. The world
 * position of local (u, v) under yaw θ is (x + u·cosθ + v·sinθ, z − u·sinθ + v·cosθ) — the same rotation THREE applies
 * for `rotation.y = θ`, so a model, its piles and its zones all agree.
 */
import { formatMoney } from '../ui/format';
import type { ChooseOption, GameState } from '../core/types';
import { DEMOLISH_MIN, DEMOLISH_SHARE, ERAS, MACHINES, MACHINE_PILES, MATERIALS, isMaterial, machinesOfEra, type ERect, type MachineDef } from './data';
import type { XZ } from './layout';
import type { ItemKind } from '../core/types';

/** Local rectangle (u along the thing's X, v along its Z). */
export interface LRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** World XZ of local (u, v) of a thing at `at` turned by `yaw`. */
export function toWorld(at: XZ, yaw: number, u: number, v: number): XZ {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: at.x + u * c + v * s, z: at.z - u * s + v * c };
}

/** Axis-aligned world rect covering a local rect (exact for yaws that are multiples of 90°). */
export function worldRect(at: XZ, yaw: number, r: LRect): ERect {
  const a = toWorld(at, yaw, r.u0, r.v0);
  const b = toWorld(at, yaw, r.u1, r.v1);
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

export const slotKey = (n: number, i: number): string => `slot:${n}:${i}`;

// ---------------------------------------------------------------------------
// Machine cell
// ---------------------------------------------------------------------------

/** Pile centres sit this far left (input) / right (output) of the machine axis, just in front of its body. */
const PILE_U = 1.4;
const PILE_OUT_U = 1.5;
/** Pile centre is this far beyond the machine's front face. */
const PILE_V = 0.9;

export interface MachineFrame {
  /** Solid body (collider). */
  body: LRect;
  /** Pile centres (local). */
  inPile: { u: number; v: number };
  outPile: { u: number; v: number };
  /** Player zones: feed (arms → input), take (output → arms), info / demolish. They never overlap each other. */
  feed: LRect;
  take: LRect;
  manage: LRect;
  /** Where a worker stands to feed / take. */
  feedSpot: { u: number; v: number };
  takeSpot: { u: number; v: number };
  /** The machine's door: inputs are swallowed here, products pop out here. */
  door: { u: number; v: number; y: number };
}

/** Geometry of a machine whose solid body is `w` × `d` (model.w / model.d). */
export function machineFrame(w: number, d: number): MachineFrame {
  const front = d / 2;
  const pv = front + PILE_V;
  return {
    body: { u0: -w / 2, u1: w / 2, v0: -d / 2, v1: front },
    inPile: { u: -PILE_U, v: pv },
    outPile: { u: PILE_OUT_U, v: pv },
    feed: { u0: -PILE_U - 0.9, u1: -PILE_U + 0.9, v0: front + 0.2, v1: front + 1.8 },
    take: { u0: PILE_OUT_U - 1.0, u1: PILE_OUT_U + 1.0, v0: front + 0.2, v1: front + 1.8 },
    manage: { u0: w / 2 + 0.4, u1: w / 2 + 1.4, v0: -0.6, v1: 0.6 },
    feedSpot: { u: -PILE_U, v: pv + 0.75 },
    takeSpot: { u: PILE_OUT_U, v: pv + 0.75 },
    door: { u: 0, v: front, y: 1.0 },
  };
}

/** Facilities of the front yard (depot, dock): body footprint, zones and the worker spot, in the facility's local frame. */
export const DEPOT_FRAME = {
  body: { u0: -1.5, u1: 1.5, v0: -1.1, v1: 1.1 } as LRect,
  give: { u0: -1.4, u1: 1.4, v0: 1.3, v1: 2.9 } as LRect,
  spot: { u: 0, v: 2.1 },
  /** Where sold items fly to (above the freight door). */
  door: { u: 0, v: 0.2, y: 1.1 },
};
export const DOCK_FRAME = {
  body: { u0: -1.4, u1: 1.4, v0: -1.0, v1: 1.0 } as LRect,
  /** Player drops materials into the dock on the left half … */
  give: { u0: -1.5, u1: -0.1, v0: 1.2, v1: 2.8 } as LRect,
  /** … and takes them out on the right half (separate rects: give + take on one rect would ping-pong). */
  take: { u0: 0.1, u1: 1.5, v0: 1.2, v1: 2.8 } as LRect,
  spot: { u: 0, v: 1.9 },
  /** Pallet height the pile rests on. */
  palletY: 0.12,
  /** The dock's pile: 4 × 3 × 2. */
  grid: { cols: 4, rows: 3, layers: 2, spacing: { x: 0.5, y: 0.4, z: 0.5 } },
};

/** Shop mat of a region (centred on layout.shopMat). */
export const MAT_SIZE = { w: 2.2, d: 1.6 };

// ---------------------------------------------------------------------------
// Machines: inputs, price, cards
// ---------------------------------------------------------------------------

export const kindLabel = (kind: ItemKind): string => (isMaterial(kind) ? MATERIALS[kind].label : kind);

/** Input pile capacity (MACHINE_PILES.in). */
export const INPUT_CAPACITY = MACHINE_PILES.in.cols * MACHINE_PILES.in.rows * MACHINE_PILES.in.layers;
/** Output pile capacity (MACHINE_PILES.out). */
export const OUTPUT_CAPACITY = MACHINE_PILES.out.cols * MACHINE_PILES.out.rows * MACHINE_PILES.out.layers;

/** How many units of `kind` the hopper of `def` holds at most: three cycles' worth, and an even share of the pile. */
export function inputCap(def: MachineDef, kind: ItemKind): number {
  const inp = def.inputs.find((i) => i.kind === kind);
  if (!inp) return 0;
  return Math.max(inp.per, Math.min(inp.per * 3, Math.floor(INPUT_CAPACITY / def.inputs.length)));
}

/** Price to demolish a built machine (no refund): a share of its cash price, at least DEMOLISH_MIN. */
export function demolishCost(def: MachineDef): number {
  return Math.max(DEMOLISH_MIN, Math.round(def.cash * DEMOLISH_SHARE));
}

/** "$27,000 + 12 Stone". */
export function costText(def: MachineDef): string {
  return def.extra ? `${formatMoney(def.cash)} + ${def.extra.count} ${kindLabel(def.extra.kind)}` : formatMoney(def.cash);
}

/** The choose card's options for era n (every machine of the era). */
export function chooseOptions(n: number): ChooseOption[] {
  return machinesOfEra(n).map((id) => {
    const d = MACHINES[id];
    return { id, label: d.label, blurb: d.blurb, costText: costText(d) };
  });
}

/** Rows of a machine's info card. `have` = what sits in its piles now. */
export function machineStatRows(def: MachineDef, rigs: number, have: { input: Partial<Record<ItemKind, number>>; output: number }): { label: string; value: string }[] {
  const rows = [{ label: 'Makes', value: `${def.batch} ${kindLabel(def.output)} per cycle` }, { label: 'Cycle', value: `${(def.cycle / Math.max(0.1, rigs)).toFixed(1)} s (Rigs ×${rigs.toFixed(2).replace(/\.?0+$/, '')})` }];
  if (def.inputs.length > 0) {
    rows.push({ label: 'Needs', value: def.inputs.map((i) => `${i.per} ${kindLabel(i.kind)}`).join(' + ') });
    rows.push({ label: 'Hopper', value: def.inputs.map((i) => `${have.input[i.kind] ?? 0}/${inputCap(def, i.kind)} ${kindLabel(i.kind)}`).join(', ') });
  }
  rows.push({ label: 'Output', value: `${have.output}/${OUTPUT_CAPACITY} ${kindLabel(def.output)}` });
  return rows;
}

// ---------------------------------------------------------------------------
// State rules
// ---------------------------------------------------------------------------

/** Pad target of a chosen machine: cash + its extra material (never logs). */
export function slotTarget(def: MachineDef, paidCash: number, paidExtra: number): { label: string; logs: 0; cash: number; paidLogs: 0; paidCash: number; extra?: { kind: ItemKind; count: number; paid: number } } {
  return {
    label: def.label.toUpperCase(),
    logs: 0,
    cash: def.cash,
    paidLogs: 0,
    paidCash,
    ...(def.extra ? { extra: { kind: def.extra.kind, count: def.extra.count, paid: paidExtra } } : {}),
  };
}

/** Everything of a chosen machine has been paid. */
export function slotPaid(def: MachineDef, s: { cash: number; extra: number }): boolean {
  return s.cash >= def.cash && s.extra >= (def.extra?.count ?? 0);
}

/** Nothing has been paid on a chosen slot yet (the choice may still be changed). */
export function slotUntouched(s: { cash: number; extra: number }): boolean {
  return s.cash <= 0 && s.extra <= 0;
}

/**
 * A save written while a slot's last bundle was still flying holds a fully paid, never-completed machine: finish it
 * (tier 0, paid reset) before any pad is armed. Returns how many slots were settled (stats.machinesBuilt += n).
 */
export function settlePaidSlots(state: GameState): number {
  let n = 0;
  state.eras.regions.forEach((r, era) => {
    if (!r.unlocked) return;
    for (const s of r.slots) {
      if (s.machine === '' || s.tier >= 0 || era < 2) continue;
      if (!slotPaid(MACHINES[s.machine], s)) continue;
      s.tier = 0;
      s.cash = 0;
      s.extra = 0;
      n++;
    }
  });
  return n;
}

/** Display name of a region's slot ("Granite Hollow, bay 2"). */
export function slotTitle(n: number, i: number): string {
  return `${ERAS[n]!.region}, bay ${i + 1}`;
}
