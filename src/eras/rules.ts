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
import { regionLayout, type XZ } from './layout';
import { marketPlaces } from './market';
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
    // 0.9.11 (full review I4/O2): on the working side, in front of the level pad and beside the feed zone, so a swap
    // is a few steps along the front instead of a walk round the machine. 0.75 m clear of the feed zone, 0.35 m clear
    // of the pad behind it, short of the belt lane in front; the board stands at its camera-side edge (Machine.ts)
    manage: { u0: Math.min(-w / 2 - 0.6, -PILE_U - 1.75) - 1.6, u1: Math.min(-w / 2 - 0.6, -PILE_U - 1.75), v0: front + 0.35, v1: front + 1.75 },
    feedSpot: { u: -PILE_U, v: pv + 0.75 },
    takeSpot: { u: PILE_OUT_U, v: pv + 0.75 },
    door: { u: 0, v: front, y: 1.0 },
  };
}

/**
 * 0.9.11: where an era machine's MANAGE board stands (local u, v): just past the tile's front edge, near its outer end.
 * The camera looks from local −u/−v, so the tile shows in front of the board and the board's shadow on the view falls
 * on open ground in front of the machine, not on the feed zone (tests/manageBoards.test.ts).
 */
export function manageBoardLocal(f: Pick<MachineFrame, 'manage'>): { u: number; v: number } {
  return { u: f.manage.u0 + 0.35, v: f.manage.v1 + MANAGE_BOARD_GAP };
}
/** Gap between the tile's front edge and the board's post (fx/manageSign MANAGE_POST_GAP). */
const MANAGE_BOARD_GAP = 0.18;

/** 0.9.5: an era machine's level pad (the tile its type's level is bought on), beside the body away from MANAGE. */
export const LEVEL_PAD_SIZE = 1.9;
/** Gap between the machine body and its level pad. */
const LEVEL_PAD_GAP = 0.35;

/** Local centre of the level pad of a machine whose body is `w` × `d`: beside its left side, flush with its front. */
export function levelPadLocal(w: number, d: number): { u: number; v: number } {
  return { u: -(w / 2 + LEVEL_PAD_GAP + LEVEL_PAD_SIZE / 2), v: d / 2 - LEVEL_PAD_SIZE / 2 };
}

/** Footprint every era machine model stays within (assets/eraMachines.ts: 4.8..5.2 × 4.4..5.0); used where no model exists. */
export const MACHINE_NOMINAL = { w: 5.2, d: 5.0 } as const;

/**
 * Where the level pad of era machine `id` is (the first built machine of that type in its region carries it), and a spot
 * just in front of it to stand on without paying; null while none is built.
 */
export function machinePadTarget(state: Pick<GameState, 'eras'>, id: string): { pad: XZ; size: number; x: number; z: number } | null {
  // 0.9.5: the era cash machine's pad stands by the market cash pile from the start (eras/CashMachine.ts)
  const cashEra = ERAS.findIndex((e) => !!e && `${e.key}Cash` === id);
  if (cashEra >= 2) {
    if (!state.eras.regions[cashEra]?.unlocked) return null;
    const L = regionLayout(cashEra);
    const pad = marketPlaces(L).vaultPad;
    return { pad, size: LEVEL_PAD_SIZE, x: pad.x, z: pad.z - L.inward * (LEVEL_PAD_SIZE + 0.4) };
  }
  const def = (MACHINES as Record<string, MachineDef | undefined>)[id];
  if (!def) return null;
  const slots = state.eras.regions[def.era]?.slots ?? [];
  const i = slots.findIndex((sl) => sl.machine === id && sl.tier >= 0);
  if (i < 0) return null;
  const place = regionLayout(def.era).slots[i];
  if (!place) return null;
  const at = { x: place.x, z: place.z };
  const l = levelPadLocal(MACHINE_NOMINAL.w, MACHINE_NOMINAL.d);
  const pad = toWorld(at, place.yaw, l.u, l.v);
  const stand = toWorld(at, place.yaw, l.u, l.v + LEVEL_PAD_SIZE + 0.4);
  return { pad, size: LEVEL_PAD_SIZE, x: stand.x, z: stand.z };
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

/** Input hopper size at Lv 0-1 (MACHINE_PILES.hopper.base); it grows with the machine's level (hopperSize). */
export const INPUT_CAPACITY: number = MACHINE_PILES.hopper.base;
/** Input hopper size at Lv 10: the whole input pile grid (MACHINE_PILES.in). */
export const INPUT_CAPACITY_MAX = MACHINE_PILES.in.cols * MACHINE_PILES.in.rows * MACHINE_PILES.in.layers;
/** Output pile capacity (MACHINE_PILES.out). */
export const OUTPUT_CAPACITY = MACHINE_PILES.out.cols * MACHINE_PILES.out.rows * MACHINE_PILES.out.layers;

/** 0.9.6 (F3): hopper size of a machine type at `level` (its level pad): 8 at Lv 0-1 rising evenly to 24 at Lv 10. */
export function hopperSize(level = 0): number {
  const l = Math.min(10, Math.max(1, Math.floor(level)));
  return Math.round(INPUT_CAPACITY + ((Math.min(INPUT_CAPACITY_MAX, MACHINE_PILES.hopper.max) - INPUT_CAPACITY) * (l - 1)) / 9);
}

/**
 * How many units of `kind` the hopper of `def` holds at most at machine level `level`: an even share of the hopper
 * (0.9.6: the whole hopper for a one-input machine, so a long walk from its supplier never starves it); never below
 * one cycle.
 */
export function inputCap(def: MachineDef, kind: ItemKind, level = 0): number {
  const inp = def.inputs.find((i) => i.kind === kind);
  if (!inp) return 0;
  const size = hopperSize(level);
  return Math.max(inp.per, Math.floor(size / def.inputs.length));
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
export function machineStatRows(def: MachineDef, rigs: number, have: { input: Partial<Record<ItemKind, number>>; output: number }, level?: { shown: number; boost: number }): { label: string; value: string }[] {
  const boost = level?.boost ?? 1;
  const x = (v: number): string => v.toFixed(2).replace(/\.?0+$/, '');
  const rows = [{ label: 'Makes', value: `${def.batch} ${kindLabel(def.output)} per cycle` }, { label: 'Cycle', value: `${(def.cycle / Math.max(0.1, rigs * boost)).toFixed(1)} s (Rigs ×${x(rigs)})` }];
  // 0.9.5: the machine type's level (its level pad beside the first one built)
  if (level) rows.push({ label: 'Level', value: `${level.shown > 0 ? `LV ${level.shown}` : 'Base'} · ×${x(boost)} speed` });
  if (def.inputs.length > 0) {
    rows.push({ label: 'Needs', value: def.inputs.map((i) => `${i.per} ${kindLabel(i.kind)}`).join(' + ') });
    rows.push({ label: 'Hopper', value: def.inputs.map((i) => `${have.input[i.kind] ?? 0}/${inputCap(def, i.kind, level?.shown ?? 0)} ${kindLabel(i.kind)}`).join(', ') });
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
