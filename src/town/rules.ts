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
import { AMENITIES, AMENITY_IDS, BUSINESSES, LAYOUT, TOWN, VILLAGE, type AmenityId, type BusinessDef, type BusinessId, type Rect, type XZ } from '../config';
import { CARRY_KINDS, LOT_COUNT, type CarryKind, type GameState } from '../core/types';
import { lotOffered } from './lane';
import { DEMOLISH_MIN, DEMOLISH_SHARE } from '../eras/data';

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

/** The choose() rule: revealed town, lot in range and offered (Lantern Lane once the new land shows), nothing paid, a visible building whose era has been reached. */
export function canChoose(state: GameState, lot: number, id: BusinessId): boolean {
  if (!state.town.revealed || !Number.isInteger(lot) || lot < 0 || lot >= LOT_COUNT) return false;
  if (!lotOffered(state, lot)) return false;
  if (!(id in BUSINESSES) || TOWN.hidden.includes(id)) return false;
  if (!lotOpen(state, lot)) return false;
  return BUSINESSES[id].era <= state.village.level;
}

// ---------------------------------------------------------------------------------------------------------------
// Demolish (0.9.0 Ages)
// ---------------------------------------------------------------------------------------------------------------

/** First era (state.eras.age) in which a built Market Town building can be demolished. */
export const DEMOLISH_FROM_ERA = 2;

/** Price to demolish a built business: a share of its cash price (no refund), never below DEMOLISH_MIN. */
export function demolishCost(id: BusinessId): number {
  return Math.max(DEMOLISH_MIN, Math.round(BUSINESSES[id].cash * DEMOLISH_SHARE));
}

/** True when lot `lot` shows its manage sign: the town is open, a building stands on it and era 2 has been reached. */
export function canManage(state: GameState, lot: number): boolean {
  const st = state.town.lots[lot];
  if (!st || !state.town.revealed || st.building === '' || st.tier < 0) return false;
  return (state.eras?.age ?? 1) >= DEMOLISH_FROM_ERA;
}

/**
 * Each lot's manage zone [u0, u1, v0, v1] (local frame): a 0.9 x 0.8 strip beyond the station strip (the hopper's feed
 * zone ends at v 3.9), on the side that clears the neighbouring lots, the stalls and the square's walls. Lot 5 sits one
 * step further out: lot 7's queue column runs across its front.
 */
const MANAGE_AT: readonly (readonly [number, number, number, number])[] = [
  [1.05, 1.95, 4.05, 4.85],
  [1.05, 1.95, 4.05, 4.85],
  [-1.95, -1.05, 4.05, 4.85],
  [-1.95, -1.05, 4.05, 4.85],
  [-1.95, -1.05, 4.05, 4.85],
  [-0.3, 0.6, 4.8, 5.6],
  [-1.95, -1.05, 4.05, 4.85],
  [-1.2, -0.3, 4.05, 4.85],
  // 0.9.12 Lantern Lane (lots 8..11 face the avenue): on the side away from the lane's other row of lots
  [1.05, 1.95, 4.05, 4.85],
  [-1.95, -1.05, 4.05, 4.85],
  [-1.95, -1.05, 4.05, 4.85],
  [1.05, 1.95, 4.05, 4.85],
];

/**
 * The manage zone of a built lot, in the lot's local frame: a small strip beyond the station strip. Clear of every business kind's zones, queue columns and props on all eight
 * lots: tests/townDemolish.test.ts sweeps them.
 */
export function manageLocal(lot: number): LRect {
  const r = MANAGE_AT[lot] ?? MANAGE_AT[0]!;
  return { u0: r[0], u1: r[1], v0: r[2], v1: r[3] };
}

/**
 * 0.9.10: a manage card opens once the player stops on the tile (slower than MANAGE_STILL_SPEED m/s) or has stayed on it
 * MANAGE_DWELL s; walking across it does not. Lot 6's tile sits where the walks from the corridor to the north-east
 * road and to the east gate cross (so do lots 1 and 4's on the shortest way to that road), and a full-speed step across
 * a 0.8 m tile takes ~0.13 s.
 */
export const MANAGE_STILL_SPEED = 1.5;
export const MANAGE_DWELL = 0.45;

/** True when a player `inFor` seconds on a manage tile, moving at `speed` m/s, gets its card. */
export function manageOpens(inFor: number, speed: number): boolean {
  return speed <= MANAGE_STILL_SPEED || inFor >= MANAGE_DWELL;
}

/** World rect of lot `lot`'s manage zone. */
export function manageRect(lot: number): Rect {
  const l = manageLocal(lot);
  return worldRect(lotFrame(lot), l.u0, l.u1, l.v0, l.v1);
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

/**
 * Wave 12: a save written while an amenity's last bundle was still flying holds a fully paid, never-completed site
 * (progress counts in-flight payments). Finish it silently (tier 0, paid reset), like settlePaidLots. Returns how
 * many were settled. (No stat counts amenities: happiness comes from the tiers.)
 */
export function settlePaidAmenities(state: GameState): number {
  let n = 0;
  for (const id of AMENITY_IDS) {
    const st = state.town.amenities[id];
    const def = AMENITIES[id];
    if (st.tier >= 0 || st.logs < def.logs || st.cash < def.cash) continue;
    st.tier = 0;
    st.logs = 0;
    st.cash = 0;
    n++;
  }
  return n;
}

/**
 * Wave 13: the Grand Market (the Winterland finale) can be fully paid in a save while its last bundle / toy was still
 * flying (progress counts in-flight payments). Finish it silently (tier 0, paid reset), like settlePaidAmenities.
 * Returns 1 when settled, else 0.
 */
export function settlePaidGrandMarket(state: GameState): number {
  const st = state.town.grandMarket;
  const def = VILLAGE.grandMarket;
  if (st.tier >= 0 || st.logs < def.logs || st.cash < def.cash || st.toys < def.toys) return 0;
  st.tier = 0;
  st.logs = 0;
  st.cash = 0;
  st.toys = 0;
  return 1;
}

/** True while the Grand Market's pad is offered: town revealed, village at the Winterland era, not built yet. */
export function grandMarketOffered(state: GameState): boolean {
  return state.town.revealed && state.village.level >= VILLAGE.grandMarket.requiresLevel && state.town.grandMarket.tier < 0;
}

/** True while amenity `id` is offered on the square: town revealed, village level reached, not built yet. */
export function amenityOffered(state: GameState, id: AmenityId): boolean {
  return state.town.revealed && state.village.level >= AMENITIES[id].era && state.town.amenities[id].tier < 0;
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
  /** Transfer zones (local rects): feeding the hopper, picking up the pallet (or a carryable shop's counter), collecting the till. */
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
/** Lateral clearance between a shop's queue column (u = counter u) and its carry-pickup strip. */
const PICKUP_QUEUE_GAP = 0.3;

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
    // A shop whose goods the player's arms can carry (the toy factory) also lets the player take them off the counter
    // pile: a strip beside the buyers' queue column, between it and the till's collect zone (never on a queue spot).
    if (def.output && (CARRY_KINDS as readonly string[]).includes(def.output as CarryKind)) {
      const c = L.collect;
      const tillEdge = PROP.till.w / 2 + 0.05; // keep clear of the till prop
      if (TILL_U > COUNTER_U) L.pickup = { u0: COUNTER_U + PICKUP_QUEUE_GAP, u1: TILL_U - tillEdge, v0: c.v0, v1: c.v1 };
      else L.pickup = { u0: TILL_U + tillEdge, u1: COUNTER_U - PICKUP_QUEUE_GAP, v0: c.v0, v1: c.v1 };
    }
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

// ---------------------------------------------------------------------------------------------------------------
// Amenity sites (wave 12)
// ---------------------------------------------------------------------------------------------------------------

export interface AmenityFrame {
  id: AmenityId;
  x: number;
  z: number;
  /** Group rotation.y that turns the model's +Z front toward the pad, snapped to the nearest axis. */
  yaw: number;
  /** The model's local footprint (w along local x, d along local z). */
  w: number;
  d: number;
  /** World footprint (axis-aligned: the yaw is a multiple of 90 degrees). */
  rect: Rect;
  pad: XZ;
  /** World tile of the pad (LAYOUT.town.amenityPadSize square). */
  padRect: Rect;
}

/** Where amenity `id` stands and which way it faces (toward its pad, along the dominant axis). */
export function amenityFrame(id: AmenityId): AmenityFrame {
  const a = T.amenities[id];
  const dx = a.pad.x - a.x;
  const dz = a.pad.z - a.z;
  const alongX = Math.abs(dx) > Math.abs(dz);
  const yaw = alongX ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : dz > 0 ? 0 : Math.PI;
  const ex = (alongX ? a.d : a.w) / 2;
  const ez = (alongX ? a.w : a.d) / 2;
  const ph = T.amenityPadSize / 2;
  return {
    id,
    x: a.x,
    z: a.z,
    yaw,
    w: a.w,
    d: a.d,
    rect: { minX: a.x - ex, maxX: a.x + ex, minZ: a.z - ez, maxZ: a.z + ez },
    pad: { x: a.pad.x, z: a.pad.z },
    padRect: { minX: a.pad.x - ph, maxX: a.pad.x + ph, minZ: a.pad.z - ph, maxZ: a.pad.z + ph },
  };
}

/** A model-local point (lx, lz) of amenity `f` in world XZ. */
export function amenityToWorld(f: AmenityFrame, lx: number, lz: number, out: XZ = { x: 0, z: 0 }): XZ {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  out.x = f.x + lx * c + lz * s;
  out.z = f.z - lx * s + lz * c;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Grand Market (wave 13)
// ---------------------------------------------------------------------------------------------------------------

export interface GrandMarketFrame {
  x: number;
  z: number;
  /**
   * Group rotation.y of the model. 0: its +Z front (colonnade, door, clock, lit window rows) faces SOUTH, the side the
   * isometric camera sees (it looks from +X / +Z); the pad stands on the hall's north side, toward the square.
   */
  yaw: number;
  w: number;
  d: number;
  /** World footprint (axis-aligned). */
  rect: Rect;
  pad: XZ;
  padSize: number;
  /** World tile of the pad. */
  padRect: Rect;
  /** Extra walkable rect (player centre) joining the square's corner to the pad (the pad lies outside T.walk). */
  walk: Rect;
}

/**
 * Where the Grand Market stands and which way it faces. Unlike the amenities (front toward the pad) the hall's front
 * faces +Z whatever side the pad is on: the camera only sees the +X and +Z sides of a building, and the showpiece
 * finale must show its colonnade, lanterns and window rows rather than its back wall.
 */
export function grandMarketFrame(): GrandMarketFrame {
  const m = T.grandMarket;
  const yaw = 0;
  const ex = m.w / 2;
  const ez = m.d / 2;
  const ph = m.padSize / 2;
  const sq = T.square;
  return {
    x: m.x,
    z: m.z,
    yaw,
    w: m.w,
    d: m.d,
    rect: { minX: m.x - ex, maxX: m.x + ex, minZ: m.z - ez, maxZ: m.z + ez },
    pad: { x: m.pad.x, z: m.pad.z },
    padSize: m.padSize,
    padRect: { minX: m.pad.x - ph, maxX: m.pad.x + ph, minZ: m.pad.z - ph, maxZ: m.pad.z + ph },
    // from just inside the square's SE corner east to past the pad, covering the pad tile (+ half a metre around it)
    walk: { minX: sq.maxX - 1.2, maxX: m.pad.x + ph + 0.5, minZ: sq.maxZ - 1.2, maxZ: m.pad.z + ph + 0.2 },
  };
}
