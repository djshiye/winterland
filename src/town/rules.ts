/**
 * [T2 — town] Pure rules + geometry of the Market Town (no THREE / DOM, so tests run without WebGL):
 * which buildings can be chosen on a lot, settling fully-paid lots on a restore, and the station layout of a
 * business in its lot's local frame.
 *
 * Local frame of a lot (rotated by `yaw` so +v points along the lot's `face`, toward the square):
 *   u = lateral (+X of the rotated frame), v = depth from the lot centre toward the square.
 *   world = lot + u·(fz, −fx) + v·(fx, fz)   (before the optional mirror, which negates u).
 * The lot's front edge is at v = lotSize / 2 = 2.2; the pad of an empty lot is at v = padOffset (3.4). The player can
 * only stand where a walk rect allows (v ≥ ~3.2 on the north / south rows, ≥ ~2.8 on the east column), so props sit
 * in v 1.4…2.5 (solid) and their zones reach out to v ≈ 3.9.
 */
import { BUSINESSES, LAYOUT, TOWN, VILLAGE, type BusinessDef, type BusinessId, type Rect, type XZ } from '../config';
import { LOT_COUNT, type GameState } from '../core/types';

const T = LAYOUT.town;

// ---------------------------------------------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------------------------------------------

export interface ChoiceInfo {
  def: BusinessDef;
  available: boolean;
  /** Why it can't be chosen yet ("Needs Winter City"), when !available. */
  reason?: string;
}

/** Every offered building (BUSINESSES minus TOWN.hidden) with its era check against the village `level`. */
export function choicesFor(level: number): ChoiceInfo[] {
  const out: ChoiceInfo[] = [];
  for (const id of Object.keys(BUSINESSES) as BusinessId[]) {
    if (TOWN.hidden.includes(id)) continue;
    const def = BUSINESSES[id];
    const available = def.era <= level;
    const era = VILLAGE.levels[def.era]?.name ?? `Level ${def.era}`;
    out.push(available ? { def, available } : { def, available, reason: `Needs ${era}` });
  }
  return out;
}

/** True while lot `lot` has no building yet or one chosen but nothing paid (the choice may still change). */
export function lotOpen(state: GameState, lot: number): boolean {
  const st = state.town.lots[lot];
  return !!st && st.tier < 0 && st.logs <= 0 && st.cash <= 0;
}

/** The choose() rule: revealed town, lot in range, nothing paid, a visible building whose era has been reached. */
export function canChoose(state: GameState, lot: number, id: BusinessId): boolean {
  if (!state.town.revealed || !Number.isInteger(lot) || lot < 0 || lot >= LOT_COUNT) return false;
  if (!(id in BUSINESSES) || TOWN.hidden.includes(id)) return false;
  if (!lotOpen(state, lot)) return false;
  return BUSINESSES[id].era <= state.village.level;
}

/** Paid fraction toward the chosen building (0 when nothing is paid / chosen). */
export function paidFraction(state: GameState, lot: number): number {
  const st = state.town.lots[lot];
  if (!st || st.building === '' || st.tier >= 0) return 0;
  if (st.logs <= 0 && st.cash <= 0) return 0;
  const def = BUSINESSES[st.building];
  return Math.min(1, (st.logs / Math.max(1, def.logs) + st.cash / Math.max(1, def.cash)) / 2);
}

/**
 * A save written while a lot's last bundle was still flying holds a fully paid, never-completed building (progress
 * counts in-flight payments). State is the truth: finish it (tier 0, paid reset). Returns how many were settled so
 * the caller can count stats.townBuilt (the live path counts in its completion handler, which never ran).
 */
export function settlePaidLots(state: GameState): number {
  let n = 0;
  for (const st of state.town.lots) {
    if (st.building === '' || st.tier >= 0) continue;
    const def = BUSINESSES[st.building];
    if (st.logs < def.logs || st.cash < def.cash) continue;
    st.tier = 0;
    st.logs = 0;
    st.cash = 0;
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------------------------

export interface LotFrame {
  lot: number;
  x: number;
  z: number;
  fx: number;
  fz: number;
  /** Group rotation.y that turns the model's +Z front toward `face`. */
  yaw: number;
  /** Which way buyers face when standing at the counter (toward the building). */
  facing: number;
  /** Negate u (props on the other side); chosen per lot to keep neighbouring zones apart. */
  mirror: boolean;
  variant: Variant;
}

/**
 * Per-lot arrangement of the shop's three stations along the lot front. 'A' = hopper, counter, till (left to right);
 * 'B' = hopper, till, counter. `mirror` negates u (the whole row the other way round). Chosen so the zones and queues
 * of neighbouring lots never touch (tests/town.test.ts checks every pair); the south-east corner needs its own.
 */
export type Variant = 'A' | 'B';
export const VARIANT: Variant[] = ['A', 'A', 'A', 'A', 'A', 'B', 'A', 'B'];
export const MIRROR: boolean[] = [false, false, false, false, false, false, true, false];

export function lotFrame(lot: number): LotFrame {
  const l = T.lots[lot]!;
  return {
    lot,
    x: l.x,
    z: l.z,
    fx: l.face.x,
    fz: l.face.z,
    yaw: Math.atan2(l.face.x, l.face.z),
    facing: Math.atan2(-l.face.x, -l.face.z),
    mirror: MIRROR[lot] ?? false,
    variant: VARIANT[lot] ?? 'A',
  };
}

/** Lot-group-local X for lateral offset u (the group is rotated by yaw, so local z is v). */
export const localX = (f: LotFrame, u: number): number => (f.mirror ? -u : u);

export function toWorld(f: LotFrame, u: number, v: number, out: XZ = { x: 0, z: 0 }): XZ {
  const uu = localX(f, u);
  out.x = f.x + uu * f.fz + v * f.fx;
  out.z = f.z - uu * f.fx + v * f.fz;
  return out;
}

/** Local rect → axis-aligned world rect (lots face along an axis, so it stays a rect). */
export function worldRect(f: LotFrame, u0: number, u1: number, v0: number, v1: number): Rect {
  const a = toWorld(f, u0, v0);
  const b = toWorld(f, u1, v1);
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

export interface LRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Prop footprints (T1's station props): w along u, d along v. */
export const PROP = {
  hopper: { w: 1.1, d: 1.0 },
  counter: { w: 1.6, d: 0.8 },
  pallet: { w: 1.4, d: 1.2 },
  till: { w: 1.04, d: 0.74 },
} as const;

export interface Station {
  u: number;
  v: number;
}

export interface StationLayout {
  /** Front of the building body (v). */
  front: number;
  hopper: Station | null;
  counter: Station | null;
  till: Station | null;
  pallet: Station | null;
  /** Transfer zones (local rects): feeding the hopper, picking up the pallet, collecting the till. */
  feed: LRect | null;
  pickup: LRect | null;
  collect: LRect | null;
  /** Colliders (local rects). */
  solids: LRect[];
  /** Queue place i: u, v. */
  queueU: number;
  queueV0: number;
  queueStep: number;
  /** Visible workers (u, v), facing the square. */
  staff: Station[];
}

const HOPPER_U = -1.65;
/** [counter, till] u per variant. */
const SHOP_U: Record<Variant, readonly [number, number]> = { A: [-0.1, 1.42], B: [1.2, -0.45] };
const PALLET_U = 0.75;
export const QUEUE_V0 = 3.35;
export const QUEUE_STEP = 0.6;
const ZONE_V1 = 3.9;

const box = (s: Station, w: number, d: number): LRect => ({ u0: s.u - w / 2, u1: s.u + w / 2, v0: s.v - d / 2, v1: s.v + d / 2 });

/**
 * Where a business's stations go, given `front` = v of the front of the building body (the models' bodies sit toward
 * the back of the lot: T1's span v −1.9 … +0.9, so ~1.3 m of the 4.4 m lot stays free in front).
 */
export function layoutFor(def: BusinessDef, front: number, variant: Variant = 'A'): StationLayout {
  // Props start ~0.55 m in front of the body (room for a worker behind a counter), 1.05 m deep at most.
  const propV = Math.min(2.1, front + 1.05);
  const L: StationLayout = {
    front,
    hopper: null,
    counter: null,
    till: null,
    pallet: null,
    feed: null,
    pickup: null,
    collect: null,
    solids: [], // props only; Business adds the building footprint itself
    queueU: SHOP_U[variant][0],
    queueV0: QUEUE_V0,
    queueStep: QUEUE_STEP,
    staff: [],
  };
  const staffN = def.kind === 'home' ? 0 : Math.max(1, Math.round(def.people / 2));
  if (def.kind === 'shop') {
    const [COUNTER_U, TILL_U] = SHOP_U[variant];
    L.hopper = { u: HOPPER_U, v: propV + 0.05 };
    L.counter = { u: COUNTER_U, v: propV };
    L.till = { u: TILL_U, v: 3.3 };
    L.feed = { u0: HOPPER_U - 0.5, u1: HOPPER_U + 0.5, v0: 2.95, v1: ZONE_V1 };
    L.collect = { u0: TILL_U - 0.45, u1: TILL_U + 0.5, v0: 2.95, v1: 3.7 };
    L.solids = [box(L.hopper, PROP.hopper.w, PROP.hopper.d), box(L.counter, PROP.counter.w, PROP.counter.d)];
    const backV = propV - PROP.counter.d / 2;
    const sv = Math.min(backV - 0.2, (front + backV) / 2);
    for (let i = 0; i < staffN; i++) L.staff.push({ u: COUNTER_U + (i - (staffN - 1) / 2) * 0.6, v: sv });
  } else if (def.kind === 'producer') {
    L.pallet = { u: PALLET_U, v: propV + 0.2 };
    L.pickup = { u0: PALLET_U - 0.6, u1: PALLET_U + 0.7, v0: 2.95, v1: ZONE_V1 };
    // The pallet is low: its collider is the back 0.9 m only, so the player can stand against the stacked goods.
    const p = L.pallet;
    L.solids = [{ u0: p.u - PROP.pallet.w / 2, u1: p.u + PROP.pallet.w / 2, v0: p.v - PROP.pallet.d / 2, v1: p.v + PROP.pallet.d / 2 - 0.3 }];
    for (let i = 0; i < staffN; i++) L.staff.push({ u: -1.7 + i * 0.75, v: 2.45 });
  }
  return L;
}

/** World XZ of queue place `i` of a shop on lot `f`. */
export function queueSpotOf(f: LotFrame, L: StationLayout, i: number, out: XZ): XZ {
  return toWorld(f, L.queueU, L.queueV0 + L.queueStep * i, out);
}

// ---------------------------------------------------------------------------------------------------------------
// Station sizing
// ---------------------------------------------------------------------------------------------------------------

/** Hopper room per input kind: at least four cycles' worth, at least half the shop's counter capacity. */
export function hopperPerKind(def: BusinessDef): number {
  let per = 4;
  for (const i of def.inputs) per = Math.max(per, i.per * 4);
  return Math.max(per, Math.ceil(def.capacity / 2));
}

/** Grid layers for `slots` items on a 3 × 2 grid. */
export const layersFor = (slots: number): number => Math.max(1, Math.ceil(slots / 6));

/** Staff count shown for a business (about one worker per two jobs). */
export function staffCount(def: BusinessDef): number {
  return def.kind === 'home' ? 0 : Math.max(1, Math.round(def.people / 2));
}
