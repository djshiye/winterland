/**
 * [MAIN] Pure placement of everything inside an era region and the fast-travel destinations. Shared by the region
 * world (eras/EraWorld.ts), the era workers, Jack's carts, the world dressing and the map panel. Deterministic: same
 * input, same numbers. No THREE, no GameContext.
 *
 * Region anatomy (eras/data.ts REGIONS[n]; 0.9.5 plots are era-1 sized and split into era-1-style zones):
 *
 *   gate edge (road) ─────────────── gate ──────────────────── market gate ──
 *   │ YARD: depot · dock · [gate] · Jack · shop mat   │ MARKET: customers,    │
 *   ├─────────────────────────────────────────────────┤ counters, the vehicle │
 *   │ PROCESSING: the machine slots (centred grid)    │ stop on the road      │
 *   │                                                 ├───────────────────────┤
 *   ├─────────────────────────────────────────────────┤ HUTS: the era crew's  │
 *   │ HARVEST: the era's raw resource (hand nodes)    │ homes                 │
 *   far edge ─────────────────────────────────────────────────────────────────
 *
 * The west column (yard, processing, harvest) is at least 42 m wide (four 10 m machine cells); the east column
 * (market, huts) takes the rest. Machine cells are ≥ 10 m wide with rows ≥ 10.5 m apart, so a machine (≤ 5.2 m), its
 * level pad, its MANAGE zone, a belt lane and a walking aisle all fit (the era workers' belts and pads use them).
 * The GATE is the middle of the yard's road edge; the MARKET has its own 3 m gate onto the same road. The EXPANSION
 * PAD sits on the road just outside the gate. Machines face the yard (their feed / take side toward the gate).
 */
import { DISTRICTS, ERAS, REGIONS, ROADS, regionDef, type ERect, type GateSide } from './data';
import type { GameState } from '../core/types';
import { climbOpen, gateMet, padPaid } from './gate';
import { DISTRICT_MARGIN, districtGrid, districtInner } from '../city/rules';
import { DECOR_RADIUS, districtDecor, districtLamps } from '../city/decor';
import { CAMERA, TRADE_POST } from '../config';
import { marketPlaces } from './market';

export interface XZ {
  x: number;
  z: number;
}

export interface SlotPlace {
  /** Slot centre (world). */
  x: number;
  z: number;
  /** Yaw (radians about +Y) that turns a model's local +Z (its front) toward the front yard. */
  yaw: number;
}

/**
 * 0.9.5: the region's zones (world rects; together they tile the region rect exactly, no overlaps). Other systems
 * place their content inside these, never at hard-coded numbers: facilities in `yard`, machine slots in `processing`,
 * the era's raw resource in `harvest`, customers and counters in `market`, the crew's homes in `huts`.
 */
export interface RegionZones {
  yard: ERect;
  processing: ERect;
  harvest: ERect;
  market: ERect;
  huts: ERect;
}

export interface RegionLayout {
  n: number;
  rect: ERect;
  gate: { x: number; z: number; side: GateSide; width: number };
  /** Unit vector pointing from the gate INTO the region (+1 / −1 along Z). */
  inward: number;
  /** Fast-travel arrival point, 3 m inside the gate. */
  inside: XZ;
  /** Expansion pad centre (on the road outside the gate) and its tile size. */
  expansionPad: XZ;
  padSize: number;
  /** Front-yard facilities (world points; each faces into the region, yaw = facilityYaw). */
  depot: XZ;
  dock: XZ;
  jack: XZ;
  shopMat: XZ;
  /** Sign by the gate (region name / FOR SALE). */
  sign: XZ;
  facilityYaw: number;
  /** Machine slots (length = REGIONS[n].slots); each owns a `cell` (across, X) × `rowPitch` (deep, Z) metre cell. */
  slots: SlotPlace[];
  cell: number;
  rowPitch: number;
  /** The era's hand node in the harvest zone (yaw turns the model's +Z toward where the player stands, the gate side). */
  node: { x: number; z: number; yaw: number };
  /** A fixed spot in the yard (west of the depot) for an era's cash machine, should it be a facility. */
  cashSpot: { x: number; z: number; yaw: number };
  /** 0.9.5 zones (see RegionZones). */
  zones: RegionZones;
  /** 0.9.5: the market's own gate in the road edge (centre on the edge line, `width` metres wide). */
  marketGate: { x: number; z: number; width: number };
  /** Where vehicles stop for the market: on the road (lane centre) in front of the market gate. */
  vehicleStop: XZ;
  /** Where walking customers enter the market: 2 m inside the market gate. */
  customerEntry: XZ;
  /** The road the region's gates open onto (eras/data.ts ROADS id). */
  road: string;
}

/** Depth of the front yard band along the gate edge (metres). */
export const YARD_DEPTH = 8;
/** The west column (yard, processing, harvest) is never narrower than this. */
export const MIN_WEST = 42;
/** The harvest zone keeps at least this depth (room for the hand node's 8 × 6 m patch and its paths). */
export const MIN_HARVEST = 14;
/** Machine cell minimums (metres): across (X) and row pitch (Z). */
export const MIN_CELL = 10;
export const ROW_PITCH = 10.5;

/** World rect between depths d0..d1 into the region (from the gate edge) and x0..x1. */
function band(r: ERect, north: boolean, x0: number, x1: number, d0: number, d1: number): ERect {
  return north ? { minX: x0, maxX: x1, minZ: r.minZ + d0, maxZ: r.minZ + d1 } : { minX: x0, maxX: x1, minZ: r.maxZ - d1, maxZ: r.maxZ - d0 };
}

/** Layout of era n's region (2..10). */
export function regionLayout(n: number): RegionLayout {
  const def = regionDef(n);
  const r = def.rect;
  const W = r.maxX - r.minX;
  const D = r.maxZ - r.minZ;
  const north = def.gate === 'north';
  const inward = north ? 1 : -1;
  const edgeZ = north ? r.minZ : r.maxZ;
  // facilities face into the region: local +Z → world +Z (north gate) or −Z (south gate)
  const facilityYaw = north ? 0 : Math.PI;

  // ---- columns and zones
  const westW = Math.min(W, Math.max(MIN_WEST, Math.round(W * 0.6)));
  const splitX = r.minX + westW;
  const gx = r.minX + westW / 2;
  // 0.9.12: the yard, machine grid and hand node keep the depth they were laid out for (def.work); the plot past it
  // is extra market, huts and field
  const workD = Math.min(D, def.work ?? D);
  const inner = workD - YARD_DEPTH; // depth below the yard

  const room = Math.max(def.slots, def.room);
  // machine grid, laid out for the plot's room (the live slots take its first places): the widest cell (12 → 10 m) that fits every slot and still leaves the harvest zone its depth
  let cell = MIN_CELL;
  let cols = Math.max(1, Math.floor((westW - 2) / cell));
  for (const c of [12, 11, 10.5, MIN_CELL]) {
    const k = Math.max(1, Math.floor((westW - 2) / c));
    if (Math.ceil(room / k) * ROW_PITCH + 2 <= inner - MIN_HARVEST) {
      cell = c;
      cols = k;
      break;
    }
  }
  const rowPitch = ROW_PITCH;
  const rows = Math.ceil(room / cols);
  const procDepth = Math.min(inner - MIN_HARVEST, Math.max(rows * rowPitch + 2, Math.round(inner * 0.5)));
  const marketDepth = Math.round(D * 0.55);
  const zones: RegionZones = {
    yard: band(r, north, r.minX, splitX, 0, YARD_DEPTH),
    processing: band(r, north, r.minX, splitX, YARD_DEPTH, YARD_DEPTH + procDepth),
    harvest: band(r, north, r.minX, splitX, YARD_DEPTH + procDepth, D),
    market: band(r, north, splitX, r.maxX, 0, marketDepth),
    huts: band(r, north, splitX, r.maxX, marketDepth, D),
  };

  const slots: SlotPlace[] = [];
  const gridStart = edgeZ + inward * (YARD_DEPTH + 1); // first row's near edge
  for (let i = 0; i < def.slots; i++) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? room - row * cols : cols;
    const col = i - row * cols;
    const x = gx + (col - (inRow - 1) / 2) * cell;
    const z = gridStart + inward * (row + 0.5) * rowPitch;
    // machines face the gate: local +Z toward the front yard
    slots.push({ x, z, yaw: north ? Math.PI : 0 });
  }

  const bandZ = edgeZ + inward * (YARD_DEPTH / 2);
  const roadZ = edgeZ - inward * 2; // roads are 4 m wide and touch the gate edge
  const mx = (splitX + r.maxX) / 2;
  // the hand node: a third of the way across the harvest zone, halfway down it (clear of the paths along its edges)
  const H = band(r, north, r.minX, splitX, YARD_DEPTH + procDepth, workD);
  const node = { x: H.minX + (H.maxX - H.minX) * 0.35, z: (H.minZ + H.maxZ) / 2, yaw: north ? Math.PI : 0 };
  const road = ROADS.find((q) => q.rect.minX <= gx - 2 && q.rect.maxX >= gx + 2 && Math.abs((q.rect.minZ + q.rect.maxZ) / 2 - roadZ) < 0.01);
  return {
    n,
    rect: r,
    gate: { x: gx, z: edgeZ, side: def.gate, width: 4 },
    inward,
    inside: { x: gx, z: edgeZ + inward * 3 },
    expansionPad: { x: gx + 4.5, z: roadZ },
    padSize: 2.6,
    // the yard's facilities hug the gate: depot + dock west of it, Jack + the shop mat east of it
    depot: { x: gx - 10.5, z: bandZ },
    dock: { x: gx - 4.5, z: bandZ },
    jack: { x: gx + 4.5, z: bandZ },
    shopMat: { x: gx + 10.5, z: bandZ },
    sign: { x: gx - 4, z: edgeZ - inward * 0.6 },
    facilityYaw,
    slots,
    cell,
    rowPitch,
    node,
    cashSpot: { x: gx - 16.5, z: bandZ, yaw: facilityYaw },
    zones,
    marketGate: { x: mx, z: edgeZ, width: 3 },
    vehicleStop: { x: mx, z: roadZ },
    customerEntry: { x: mx, z: edgeZ + inward * 2 },
    road: road?.id ?? '',
  };
}

// ---- 0.9.7 era-1-style places in every plot ------------------------------------------------------------------------

/** One crew hut in the huts zone (`role` 0 = the hauler crew, 1..6 = config ERA_ROLES in order). */
export interface HutPlace {
  role: number;
  x: number;
  z: number;
  /** Turns the hut's local +Z (its door) toward the crew green. */
  yaw: number;
  w: number;
  d: number;
  /** Unit world direction the annex grows in: behind the hut, away from the green. */
  backX: number;
  backZ: number;
}

/** One shopfront on the market street (local +Z = its shop window, facing the street and the gate). */
export interface ShopPlace {
  x: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
  h: number;
  /** The open-air stall of the street (an awning and a counter instead of a shop). */
  stall: boolean;
}

/**
 * How each era lays its places out (R37: every era area has its own look, built around its resource). Eras 2-5 share
 * the era-1 pattern (an L of huts, rows of shops, rows of beds); from era 6 each era has a shape of its own:
 *  6 copper + quartz: an arcaded terrace boulevard, a grove of outcrops and crystal clumps
 *  7 crude + gas:     a trailer park, a roadside strip with a fuel canopy, scattered pumpjack pads and a tank farm
 *  8 silica + gold:   a modular terrace, a staggered tech campus, wind-swept dunes with a clean-room block
 *  9 uranium + graphite: quonset barracks, shops round a courtyard, a fenced hazard yard of pits
 * 10 rare earth + He-3: pods in an arc, a crescent of dome shops, a geode crater ringed with skimmer pads
 */
export type HutShape = 'L' | 'park' | 'terrace' | 'barracks' | 'arc';
export type StreetShape = 'rows' | 'arcade' | 'strip' | 'campus' | 'court' | 'crescent';
export type FieldShape = 'rows' | 'grove' | 'rigs' | 'dunes' | 'pits' | 'crater';

export interface PlotPlan {
  huts: HutShape;
  street: StreetShape;
  field: FieldShape;
}

const PLOT_PLAN: Readonly<Record<number, PlotPlan>> = {
  6: { huts: 'L', street: 'arcade', field: 'grove' },
  7: { huts: 'park', street: 'strip', field: 'rigs' },
  8: { huts: 'terrace', street: 'campus', field: 'dunes' },
  9: { huts: 'barracks', street: 'court', field: 'pits' },
  10: { huts: 'arc', street: 'crescent', field: 'crater' },
};

export function plotPlan(n: number): PlotPlan {
  return PLOT_PLAN[n] ?? { huts: 'L', street: 'rows', field: 'rows' };
}

/**
 * 0.9.13 (review E1): the field's earthworks keep this much of its far (from the camera) edges for themselves: `back`
 * metres along its gate-side edge (terraced quarry benches, a dune terrace, a retaining wall, a row of derricks) and
 * `side` metres along its hand-node edge (the haul ramp down into an open-cast pit). The beds fill what is left.
 * Era 10's crater keeps its rim inside the bowl it already has.
 */
export const FIELD_BANK: Readonly<Record<number, { back: number; side: number }>> = {
  2: { back: 2.7, side: 2.2 },
  3: { back: 2.7, side: 2.2 },
  4: { back: 2.7, side: 2.2 },
  5: { back: 2.7, side: 2.2 },
  6: { back: 2.7, side: 2.2 },
  7: { back: 2.6, side: 0 },
  8: { back: 1.8, side: 0 },
  9: { back: 1.8, side: 0 },
  10: { back: 0, side: 0 },
};

/** The part of a harvest field `F` its beds may use (FIELD_BANK keeps the rest for the earthworks). */
export function fieldBedArea(n: number, F: ERect): ERect {
  const b = FIELD_BANK[n] ?? { back: 0, side: 0 };
  return { minX: F.minX + b.side, maxX: F.maxX, minZ: F.minZ + b.back, maxZ: F.maxZ };
}

/** One resource bed of the harvest field; `k` picks the era's bed kind (0 = main resource, 1 = second, 2 = special). */
export type BedPlace = ERect & { k: 0 | 1 | 2 };

/** 0.9.7: where each era-1-style place of a region stands (R34). World rects / points, deterministic, pure. */
export interface PlotPlaces {
  plan: PlotPlan;
  /** Seven crew homes round a little green, one per crew role. */
  huts: HutPlace[];
  /** The crew green the huts face (a fire pit / well / kiosk stands in its middle). */
  green: ERect;
  /** The market's paved ground: streets, a forecourt or a plaza (1 to 3), each with its shopfronts beside it. */
  streets: ERect[];
  shops: ShopPlace[];
  lamps: XZ[];
  /** The processing yard's paved floor under the whole machine grid (room slots, not only the live ones). */
  yardPave: ERect;
  /** The harvest field: the era's resource beds east of the hand node. */
  field: ERect;
  beds: BedPlace[];
}

/** Hut body footprint limits (metres) and the depth the annex adds behind it. */
export const HUT_W = 4.4;
export const HUT_D = 3.6;
export const HUT_ANNEX = 1.8;
/** Shopfront depth and the street's width. */
export const SHOP_D = 3.6;
export const STREET_W = 3.2;
/** How far into the market (from the gate edge) the street may start: clear of the counters, cash pile and vault. */
export const STREET_MIN_DEPTH = 17.5;

const placesCache = new Map<string, PlotPlaces>();

/** World rect between depths d0..d1 (from the gate edge, along `inward`) and x0..x1. */
function depthRect(L: RegionLayout, x0: number, x1: number, d0: number, d1: number): ERect {
  const e = L.gate.z;
  const a = e + L.inward * d0;
  const b = e + L.inward * d1;
  return { minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(a, b), maxZ: Math.max(a, b) };
}

/** Depth (metres from the gate edge) of a world z. */
function depthOf(L: RegionLayout, z: number): number {
  return (z - L.gate.z) * L.inward;
}

// The places face the camera (it sits toward +X/+Z), so their doors, windows and awnings show: every gate is on the
// north edge since 0.9.5, so "toward the camera" is also "away from the gate" (south) and east.
const faceSouth = 0; // local +Z → world +Z
const faceEast = Math.PI / 2; // local +Z → world +X

/** The seven crew huts (roles 0..6, in order) and their green inside the huts area x0..x1 × z0..z1. */
function hutPlaces(shape: HutShape, hx0: number, hx1: number, hz0: number, hz1: number): { huts: HutPlace[]; green: ERect } {
  const huts: HutPlace[] = [];
  const south = (role: number, x: number, z: number, w: number): void => void huts.push({ role, x, z, yaw: faceSouth, w, d: HUT_D, backX: 0, backZ: -1 });
  const east = (role: number, x: number, z: number, w: number): void => void huts.push({ role, x, z, yaw: faceEast, w, d: HUT_D, backX: -1, backZ: 0 });
  switch (shape) {
    case 'park': {
      // a trailer park: two staggered rows, doors south, the second row in the gaps of the first
      const pitch = Math.min(9, (hx1 - hx0) / 4);
      const w = Math.min(HUT_W, pitch - 0.9);
      const zA = hz0 + HUT_ANNEX + HUT_D / 2;
      const zB = zA + HUT_D + HUT_ANNEX + 2.4;
      for (let i = 0; i < 4; i++) south(i, hx0 + pitch * (i + 0.5), zA, w);
      for (let i = 0; i < 3; i++) south(4 + i, hx0 + pitch * (i + 1), zB, w);
      return { huts, green: { minX: hx0 + 1, maxX: hx1 - 1, minZ: zB + HUT_D / 2 + 1.2, maxZ: hz1 } };
    }
    case 'terrace': {
      // one modular terrace of seven units side by side, doors south onto a wide plaza
      const pitch = (hx1 - hx0) / 7;
      const w = Math.min(HUT_W, pitch - 0.45);
      const z = hz0 + HUT_ANNEX + HUT_D / 2;
      for (let i = 0; i < 7; i++) south(i, hx0 + pitch * (i + 0.5), z, w);
      return { huts, green: { minX: hx0 + 1, maxX: hx1 - 1, minZ: z + HUT_D / 2 + 1.5, maxZ: hz1 } };
    }
    case 'barracks': {
      // two columns of quonset huts, doors east, the second column staggered; the parade green east of them
      const pitch = Math.min(9, (hz1 - hz0) / 4);
      const w = Math.min(HUT_W, pitch - 0.9);
      const xA = hx0 + HUT_ANNEX + HUT_D / 2;
      const xB = xA + HUT_D + HUT_ANNEX + 2.4;
      for (let i = 0; i < 4; i++) east(i, xA, hz0 + pitch * (i + 0.5), w);
      for (let i = 0; i < 3; i++) east(4 + i, xB, hz0 + pitch * (i + 1), w);
      return { huts, green: { minX: xB + HUT_D / 2 + 1.2, maxX: hx1, minZ: hz0 + 0.5, maxZ: hz1 - 0.5 } };
    }
    default: {
      // an L round the green: a row along the north edge (doors south) and a column along the west edge (doors
      // east); annexes grow behind them. 'arc' bends the L's ends toward the camera, round the green.
      const bend = shape === 'arc' ? [0, 0, 0.9, 2.0] : [0, 0, 0, 0];
      const bendCol = shape === 'arc' ? [0, 0.9, 2.0] : [0, 0, 0];
      const rowPitch = Math.min(9, (hx1 - hx0) / 4);
      const rowW = Math.min(HUT_W, rowPitch - 0.9);
      const rowZ = hz0 + HUT_ANNEX + HUT_D / 2;
      for (let i = 0; i < 4; i++) south(i, hx0 + rowPitch * (i + 0.5), rowZ + bend[i]!, rowW);
      const colTop = rowZ + HUT_D / 2 + 1.0;
      const colPitch = Math.min(9, (hz1 - colTop) / 3);
      const colW = Math.min(HUT_W, colPitch - 0.9);
      const colX = hx0 + HUT_ANNEX + HUT_D / 2;
      for (let i = 0; i < 3; i++) east(4 + i, colX + bendCol[i]!, colTop + colPitch * (i + 0.5), colW);
      const greenX1 = Math.min(hx1, hx0 + rowPitch * 4) - 0.6;
      const inX = shape === 'arc' ? 3.0 : 1.0;
      const minZ = shape === 'arc' ? rowZ + HUT_D / 2 + 3.0 : colTop;
      const green: ERect = { minX: colX + HUT_D / 2 + inX, maxX: Math.max(colX + HUT_D / 2 + inX + 4, greenX1), minZ, maxZ: Math.min(hz1, colTop + colPitch * 3) };
      return { huts, green };
    }
  }
}

/** The market's streets / forecourt / plaza with their shops and lamps, past the counters and the vault. */
function marketStreets(shape: StreetShape, L: RegionLayout, n: number): { streets: ERect[]; shops: ShopPlace[]; lamps: XZ[] } {
  const M = L.zones.market;
  const mFar = Math.max(depthOf(L, M.minZ), depthOf(L, M.maxZ));
  const mx0 = M.minX + 2.4;
  const mx1 = M.maxX - 1.4;
  const avail = mFar - 1.0 - STREET_MIN_DEPTH;
  const streets: ERect[] = [];
  const shops: ShopPlace[] = [];
  const lamps: XZ[] = [];
  const zAt = (depth: number): number => L.gate.z + L.inward * depth;
  const height = (i: number, row: number): number => 2.9 + ((i * 7 + n + row * 5) % 3) * 0.3;
  const lampRow = (x0: number, x1: number, depth: number, every: number): void => {
    const k = Math.max(2, Math.round((x1 - x0) / every));
    for (let i = 0; i < k; i++) lamps.push({ x: x0 + ((x1 - x0) * (i + 0.5)) / k, z: zAt(depth) });
  };
  /** Rows of shopfronts, each with its street in front (the era-1 pattern and its variants). */
  const rows = (o: { streetW: number; gap: number; shopW: (pitch: number) => number; minPitch: number; lampIn: boolean }): void => {
    const need = SHOP_D + 0.4 + o.streetW;
    const rowsN = Math.max(1, Math.min(3, Math.floor((avail + o.gap) / (need + o.gap))));
    const slack = Math.max(0, avail - rowsN * need - (rowsN - 1) * o.gap);
    const first = STREET_MIN_DEPTH + Math.min(3, slack / 2);
    const count = Math.max(3, Math.floor((mx1 - mx0) / o.minPitch));
    const pitch = (mx1 - mx0) / count;
    for (let row = 0; row < rowsN; row++) {
      const shopNear = first + row * (need + o.gap);
      const streetNear = shopNear + SHOP_D + 0.4;
      streets.push(depthRect(L, mx0, mx1, streetNear, streetNear + o.streetW));
      // the open stall sits mid-row on the first street, then shifts so the rows don't line up
      const stallAt = Math.floor((count - 1) / 2);
      for (let i = 0; i < count; i++) {
        const stall = row === 0 && i === stallAt;
        shops.push({ x: mx0 + pitch * (i + 0.5), z: zAt(shopNear + SHOP_D / 2), yaw: faceSouth, w: o.shopW(pitch), d: SHOP_D, h: stall ? 2.5 : height(i, row), stall });
      }
      lampRow(mx0, mx1, o.lampIn ? streetNear + o.streetW - 0.35 : streetNear + o.streetW + 0.45, 7);
    }
  };

  switch (shape) {
    case 'arcade':
      // attached shopfronts under one arcade along a broad boulevard; lamps stand on the boulevard's edge
      rows({ streetW: 3.8, gap: 0.6, shopW: (p) => p - 0.12, minPitch: 4.4, lampIn: true });
      break;
    case 'strip': {
      // a roadside strip: a few wide low shops behind a deep forecourt, the fuel canopy (the stall) at its east end
      const count = Math.max(3, Math.floor((mx1 - mx0) / 7.2));
      const pitch = (mx1 - mx0) / count;
      const shopNear = STREET_MIN_DEPTH + Math.min(2, Math.max(0, avail - 11) / 2);
      const courtNear = shopNear + SHOP_D + 0.4;
      streets.push(depthRect(L, mx0, mx1, courtNear, courtNear + 7));
      for (let i = 0; i < count; i++) {
        const stall = i === count - 1;
        shops.push({ x: mx0 + pitch * (i + 0.5), z: zAt(shopNear + SHOP_D / 2), yaw: faceSouth, w: Math.min(6.4, pitch - 0.8), d: SHOP_D, h: stall ? 3.0 : 2.6 + (i % 2) * 0.3, stall });
      }
      lampRow(mx0, mx1, courtNear + 7 + 0.45, 8);
      break;
    }
    case 'campus': {
      // a tech campus: two rows of mixed-width pavilions, every other one set back, with lawn between the rows
      const STAG = 1.2;
      const walk = 2.8;
      const gap = 2.0;
      const need = STAG + SHOP_D + 0.4 + walk;
      const rowsN = Math.max(1, Math.min(3, Math.floor((avail + gap) / (need + gap))));
      const widths = [6.0, 4.0, 4.4];
      for (let row = 0; row < rowsN; row++) {
        const base = STREET_MIN_DEPTH + row * (need + gap);
        const walkNear = base + STAG + SHOP_D + 0.4;
        streets.push(depthRect(L, mx0, mx1, walkNear, walkNear + walk));
        const placed: ShopPlace[] = [];
        let x = mx0;
        for (let i = 0; ; i++) {
          const w = widths[(i + row) % widths.length]!;
          if (x + w > mx1 + 1e-6) break;
          const back = (i + row) % 2 === 0 ? 0 : STAG;
          placed.push({ x: x + w / 2, z: zAt(base + back + SHOP_D / 2), yaw: faceSouth, w, d: SHOP_D, h: height(i, row), stall: false });
          x += w + 0.9;
        }
        if (row === 0) {
          const mid = placed[Math.floor((placed.length - 1) / 2)]!;
          mid.stall = true;
          mid.h = 2.5;
        }
        shops.push(...placed);
        lampRow(mx0, mx1, walkNear + walk + 0.45, 7);
      }
      break;
    }
    case 'court': {
      // shops round a courtyard: a row along its north side (fronts south) and a column down its west side (fronts east)
      const shopNear = STREET_MIN_DEPTH + 0.5;
      const plazaNear = shopNear + SHOP_D + 0.4;
      const plazaFar = Math.min(mFar - 1.6, plazaNear + 14);
      const px0 = mx0 + SHOP_D + 0.4;
      streets.push(depthRect(L, px0, mx1, plazaNear, plazaFar));
      const count = Math.max(3, Math.floor((mx1 - px0) / 5.4));
      const pitch = (mx1 - px0) / count;
      const stallAt = Math.floor((count - 1) / 2);
      for (let i = 0; i < count; i++) {
        const stall = i === stallAt;
        shops.push({ x: px0 + pitch * (i + 0.5), z: zAt(shopNear + SHOP_D / 2), yaw: faceSouth, w: Math.min(4.6, pitch - 0.7), d: SHOP_D, h: stall ? 2.5 : height(i, 0), stall });
      }
      const colN = Math.max(1, Math.floor((plazaFar - plazaNear) / 5.4));
      const colPitch = (plazaFar - plazaNear) / colN;
      for (let i = 0; i < colN; i++) {
        shops.push({ x: mx0 + SHOP_D / 2, z: zAt(plazaNear + colPitch * (i + 0.5)), yaw: faceEast, w: Math.min(4.6, colPitch - 0.7), d: SHOP_D, h: height(i, 1), stall: false });
      }
      lampRow(px0, mx1, plazaFar + 0.45, 7);
      break;
    }
    case 'crescent': {
      // dome shops on a shallow crescent, its ends swung toward the camera round a plaza
      const W = 4.0;
      const BEND = 2.4;
      const plazaD = 4.5;
      const count = Math.max(5, Math.floor((mx1 - mx0) / 5.0));
      const pitch = (mx1 - mx0) / count;
      const mid = (count - 1) / 2;
      const off = (i: number): number => BEND * ((i - mid) / mid) ** 2;
      const innerOff = off(1);
      const need = Math.max(BEND + W, innerOff + W + 0.4 + plazaD);
      const gap = 1.2;
      const rowsN = Math.max(1, Math.min(3, Math.floor((avail + gap) / (need + gap))));
      for (let row = 0; row < rowsN; row++) {
        const base = STREET_MIN_DEPTH + row * (need + gap);
        const plazaNear = base + innerOff + W + 0.4;
        streets.push(depthRect(L, mx0 + pitch + 0.3, mx1 - pitch - 0.3, plazaNear, plazaNear + plazaD));
        const stallAt = Math.floor(mid);
        for (let i = 0; i < count; i++) {
          const stall = row === 0 && i === stallAt;
          shops.push({ x: mx0 + pitch * (i + 0.5), z: zAt(base + off(i) + W / 2), yaw: faceSouth, w: Math.min(W, pitch - 0.6), d: W, h: stall ? 2.5 : height(i, row), stall });
        }
        lampRow(mx0 + pitch, mx1 - pitch, plazaNear + plazaD + 0.45, 6);
      }
      break;
    }
    default:
      rows({ streetW: STREET_W, gap: 1.6, shopW: (p) => Math.min(4.6, p - 0.7), minPitch: 5.4, lampIn: false });
  }
  return { streets, shops, lamps };
}

/** The resource beds of a harvest field `F` (world rect), laid out in the era's own pattern. */
function fieldBeds(shape: FieldShape, F: ERect): BedPlace[] {
  const beds: BedPlace[] = [];
  const bed = (x0: number, z0: number, x1: number, z1: number, k: 0 | 1 | 2): void => {
    const r = { minX: Math.max(F.minX + 0.4, x0), maxX: Math.min(F.maxX - 0.4, x1), minZ: Math.max(F.minZ + 0.4, z0), maxZ: Math.min(F.maxZ - 0.4, z1), k };
    if (r.maxX - r.minX >= 1.2 && r.maxZ - r.minZ >= 1.2) beds.push(r);
  };
  const W = F.maxX - F.minX;
  const D = F.maxZ - F.minZ;
  switch (shape) {
    case 'grove': {
      // clumps of copper outcrops and quartz crystals on an offset grid, with clearings
      for (let j = 0, z = F.minZ + 0.6; z + 2.0 <= F.maxZ - 0.4; j++, z += 3.9) {
        for (let i = 0, x = F.minX + 0.6 + (j % 2) * 2.0; x + 2.0 <= F.maxX - 0.4; i++, x += 4.0) {
          if ((i * 7 + j * 3) % 5 === 0) continue;
          const big = (i + j) % 3 !== 0;
          bed(x, z, x + (big ? 2.4 : 1.8), z + (big ? 2.4 : 1.8), big ? 0 : 1);
        }
      }
      break;
    }
    case 'rigs': {
      // pumpjack pads scattered over the field, a tank farm of gas spheres along its east side
      for (let j = 0, z = F.minZ + 0.8; z + 3.0 <= F.maxZ - 0.4; j++, z += 6.4) {
        for (let x = F.minX + 0.8 + (j % 2) * 3.6; x + 3.0 <= F.maxX - 6.0; x += 7.2) bed(x, z, x + 3.0, z + 3.0, 0);
      }
      for (let z = F.minZ + 1.0; z + 4.2 <= F.maxZ - 0.4; z += 5.4) bed(F.maxX - 4.8, z, F.maxX - 0.6, z + 4.2, 1);
      break;
    }
    case 'dunes': {
      // wind-swept dunes of silica sand in staggered swells, gold pans in the hollows, one clean-room block
      const room = { minX: F.maxX - 6.0, maxX: F.maxX - 0.6, minZ: F.maxZ - 5.0, maxZ: F.maxZ - 0.6 };
      bed(room.minX, room.minZ, room.maxX, room.maxZ, 2);
      const lens = [7, 5, 8, 6];
      for (let j = 0, z = F.minZ + 0.6; z + 3.0 <= F.maxZ - 0.4; j++, z += 4.4) {
        for (let i = 0, x = F.minX + 0.6 + (j % 2) * 2.6; x < F.maxX - 1.6; i++) {
          const pan = (i + j) % 3 === 2;
          const len = pan ? 2.6 : lens[(i + j) % lens.length]!;
          const d = pan ? 2.2 : 3.0;
          const x1 = Math.min(x + len, F.maxX - 0.4);
          const clear = x1 <= room.minX - 0.6 || z + d <= room.minZ - 0.6;
          if (clear) bed(x, z, x1, z + d, pan ? 1 : 0);
          x += len + 1.6;
        }
      }
      break;
    }
    case 'pits': {
      // a fenced hazard yard: square uranium pits in a grid, every third a stack of graphite bars
      const p = 2.4;
      const g = 1.4;
      for (let j = 0, z = F.minZ + 1.2; z + p <= F.maxZ - 1.0; j++, z += p + g) {
        for (let i = 0, x = F.minX + 1.2; x + p <= F.maxX - 1.0; i++, x += p + g) {
          // 0.9.13 (E1): every seventh cell left as trodden ground, and pits of three sizes in their cells
          if ((i * 5 + j * 3) % 7 === 3) continue;
          const q = p * (0.72 + 0.14 * ((i * 7 + j * 5) % 3));
          const o = (p - q) / 2;
          bed(x + o, z + o, x + o + q, z + o + q, (i + 2 * j) % 3 === 2 ? 1 : 0);
        }
      }
      break;
    }
    case 'crater': {
      // a geode crater: a big geode at its heart, a ring of geodes round it, helium-3 skimmer pads at the corners
      const cx = (F.minX + F.maxX) / 2;
      const cz = (F.minZ + F.maxZ) / 2;
      const R = Math.min(W, D) / 2 - 1.8;
      bed(cx - 1.4, cz - 1.4, cx + 1.4, cz + 1.4, 0);
      const ring = R * 0.62;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const x = cx + Math.cos(a) * ring;
        const z = cz + Math.sin(a) * ring;
        bed(x - 1.0, z - 1.0, x + 1.0, z + 1.0, 0);
      }
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const x = sx < 0 ? F.minX + 0.5 : F.maxX - 3.5;
        const z = sz < 0 ? F.minZ + 0.5 : F.maxZ - 3.5;
        bed(x, z, x + 3.0, z + 3.0, 1);
      }
      break;
    }
    default:
      for (let i = 0, z = F.minZ + 0.4; z + 1.4 <= F.maxZ - 0.2; i++, z += 2.6) beds.push({ minX: F.minX + 0.4, maxX: F.maxX - 0.4, minZ: z, maxZ: z + 1.4, k: (i % 2) as 0 | 1 });
  }
  return beds;
}

/** Era n's places (2..10). Cached per plot shape, so the slot / room numbers are part of the key. */
export function plotPlaces(n: number): PlotPlaces {
  const def = regionDef(n);
  const key = `${n}|${def.slots}|${def.room}`;
  const hit = placesCache.get(key);
  if (hit) return hit;
  const L = regionLayout(n);
  const Z = L.zones;

  const plan = plotPlan(n);
  const H = Z.huts;
  const hx0 = H.minX + 3.2; // clear of the path along the column split (0.9.12: 3 m clear past the annexes, was 2.4)
  const hx1 = H.maxX - 1.4; // clear of the fence
  const hz0 = H.minZ + 1.2;
  const hz1 = H.maxZ - 1.2;
  const { huts, green } = hutPlaces(plan.huts, hx0, hx1, hz0, hz1);

  const { streets, shops, lamps } = marketStreets(plan.street, L, n);
  // ---- processing yard floor: the full room grid, so slots that open later already stand on paving
  const room = Math.max(def.slots, def.room);
  const cols = Math.max(1, L.slots.filter((s) => Math.abs(s.z - L.slots[0]!.z) < 0.01).length);
  const span = Math.min(Z.processing.maxX - Z.processing.minX - 2, cols * L.cell);
  const px = (Z.processing.minX + Z.processing.maxX) / 2;
  const rows = Math.ceil(room / cols);
  const yardPave = depthRect(L, px - span / 2, px + span / 2, YARD_DEPTH + 0.5, YARD_DEPTH + 1 + rows * L.rowPitch);

  // ---- harvest field: east of the hand node's patch, clear of the path along the harvest's near edge
  const F = Z.harvest;
  const fx0 = L.node.x + 7.5;
  const fx1 = F.maxX - 1.6;
  const fNear = Math.min(depthOf(L, F.minZ), depthOf(L, F.maxZ)) + 2;
  const fFar = Math.max(depthOf(L, F.minZ), depthOf(L, F.maxZ)) - 1.6;
  const field = depthRect(L, fx0, Math.max(fx0 + 4, fx1), fNear, fFar);
  const beds = fieldBeds(plan.field, fieldBedArea(n, field));

  const out: PlotPlaces = { plan, huts, green, streets, shops, lamps, yardPave, field, beds };
  placesCache.set(key, out);
  return out;
}

// ---- 1.0 lived-in market and huts (EM1) ------------------------------------------------------------------------------

/**
 * EM1 (audit-1.0 full-review): the market and huts zones were bare slab with one or two props. `plotDecor` fills their
 * free ground with small vignettes (goods stacks, benches and lamps, notice boards, hand carts, snow piles, one piece
 * of clutter built from the era's own resources) without ever standing on something somebody walks to or from.
 *
 * Who walks where in a bought region (the routes `plotRoutes` lists, each a centre line with a 2.5 m clear walkway):
 *  - shoppers (npc/EraShoppers.ts): the market gate → `entry` → their place in the queue (front + step · i, shopQueue
 *    places), and back out the same way;
 *  - buyer trucks (npc/EraBuyers.ts): along the road lane outside the fence (never inside the zones);
 *  - the player: market gate → `entry` → the clerk spot, cash pile and vault pad, and the path down the west edge of
 *    the market and huts (eras/data zones: the line between the west column and the east one) to the huts;
 *  - the era clerk (npc/EraWorker.ts planPath): cash pile → the front aisle (depth YARD_DEPTH + 0.5) west to the depot.
 *    The other crew roles only ever walk in the west column (yard, processing, harvest) and out of the gate;
 *  - the crew's families (world/life/RegionLife.ts): each built hut's door → its door spot on the green → along its
 *    spoke to the ring round the green's centrepiece (`greenWalk`, which RegionLife.greenSpots reads) and strolls on
 *    the ring's chords. The rest of the green is free ground.
 * Pads, counters, the cash pile, the vault, the queue, hut doors and annexes, shop fronts and streets are keep-outs.
 */
export type DecorKind = 'crates' | 'sacks' | 'barrels' | 'heap' | 'bench' | 'lamp' | 'snow' | 'notice' | 'cart' | 'sig' | 'fir' | 'shrub' | 'centre';

export interface DecorPlace {
  kind: DecorKind;
  x: number;
  z: number;
  /** Quarter turns only (0, π/2 ...): `hx` / `hz` already include the turn, so the footprint is the plain rect. */
  yaw: number;
  /** Footprint half sizes along world X / Z, and the height (metres). */
  hx: number;
  hz: number;
  h: number;
  /** 'sig' (the era's clutter piece): which of its three; the others: a colour / pose pick 0..2. */
  v: number;
  zone: 'market' | 'huts';
}

/** Half width of every walkway: a 3 m clear lane (0.9.12, Dino: "a lotta room to walk around to not collide"). */
export const ROUTE_HALF = 1.5;

export interface PlotRoute {
  what: string;
  /** Centre line of the walkway (world points, in walking order). */
  pts: XZ[];
}

export interface PlotKeepOut {
  what: string;
  r: ERect;
  /** A pad, counter or pile the camera must see: nothing tall may stand toward the camera (+X/+Z) of it either. */
  sight: boolean;
}

/** Footprint half sizes (x, z at yaw 0) and height of each decor kind (metres). */
export const DECOR_SIZE: Readonly<Record<DecorKind, readonly [number, number, number]>> = {
  crates: [0.55, 0.45, 1.3],
  sacks: [0.6, 0.45, 0.9],
  barrels: [0.65, 0.6, 1.15],
  heap: [0.9, 0.7, 1.0],
  bench: [0.85, 0.3, 1.0],
  lamp: [0.15, 0.15, 3.1],
  snow: [0.75, 0.55, 0.35],
  notice: [0.85, 0.2, 2.35],
  cart: [1.0, 0.55, 1.4],
  sig: [0.85, 0.85, 2.2],
  fir: [0.75, 0.75, 2.7],
  shrub: [0.55, 0.5, 0.8],
  // 0.9.12 the market's centrepiece: a statue, a fountain or a flower bed round a pillar (world/env/plots.ts)
  centre: [1.15, 1.15, 2.4],
};

const GREEN_CLEAR = 1.7; // RegionLife CLEAR: keep this far from the centrepiece

/** Hut body (or body + annex) footprint, pure (world/env/plots.ts hutFootprint delegates here). */
export function hutBox(h: HutPlace, annex: boolean): ERect {
  const hx = (h.backX !== 0 ? h.d : h.w) / 2;
  const hz = (h.backX !== 0 ? h.w : h.d) / 2;
  const r: ERect = { minX: h.x - hx, maxX: h.x + hx, minZ: h.z - hz, maxZ: h.z + hz };
  if (!annex) return r;
  if (h.backX < 0) return { ...r, minX: r.minX - HUT_ANNEX };
  if (h.backX > 0) return { ...r, maxX: r.maxX + HUT_ANNEX };
  if (h.backZ < 0) return { ...r, minZ: r.minZ - HUT_ANNEX };
  return { ...r, maxZ: r.maxZ + HUT_ANNEX };
}

const grow = (r: ERect, m: number): ERect => ({ minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m });
const around = (p: XZ, half: number): ERect => ({ minX: p.x - half, maxX: p.x + half, minZ: p.z - half, maxZ: p.z + half });
const hit = (a: ERect, b: ERect): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
const within = (a: ERect, o: ERect): boolean => a.minX >= o.minX && a.maxX <= o.maxX && a.minZ >= o.minZ && a.maxZ <= o.maxZ;

/**
 * The crew green's walking spots (world/life/RegionLife.ts walks the crew's families between them): the centre, a door
 * spot per hut (the door's point pulled onto the green), a ring of spots round the centrepiece, and `spoke[i]`, the
 * ring spot hut i's door opens onto. A walker leaves its door along its spoke to the ring, strolls the ring (chords
 * inside it) and goes home the same way, so the rest of the green stays free for decor. Pure.
 */
export function greenWalk(P: PlotPlaces): { c: XZ; doors: XZ[]; ring: XZ[]; spoke: number[]; r: number } {
  const G = P.green;
  const c = { x: (G.minX + G.maxX) / 2, z: (G.minZ + G.maxZ) / 2 };
  const clampX = (v: number): number => Math.min(G.maxX - 0.4, Math.max(G.minX + 0.4, v));
  const clampZ = (v: number): number => Math.min(G.maxZ - 0.4, Math.max(G.minZ + 0.4, v));
  const doors = P.huts.map((h) => {
    const lz = h.d / 2 + 0.7;
    return { x: clampX(h.x + lz * Math.sin(h.yaw)), z: clampZ(h.z + lz * Math.cos(h.yaw)) };
  });
  const r = Math.min(GREEN_CLEAR + 0.6, Math.max(GREEN_CLEAR, Math.min(G.maxX - G.minX, G.maxZ - G.minZ) / 2 - 0.5));
  const ring: XZ[] = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    const p = { x: clampX(c.x + Math.cos(a) * r), z: clampZ(c.z + Math.sin(a) * r) };
    if (Math.hypot(p.x - c.x, p.z - c.z) >= GREEN_CLEAR - 0.05) ring.push(p);
  }
  const spoke = doors.map((d) => {
    let best = 0;
    for (let k = 1; k < ring.length; k++) if (Math.hypot(ring[k]!.x - d.x, ring[k]!.z - d.z) < Math.hypot(ring[best]!.x - d.x, ring[best]!.z - d.z)) best = k;
    return best;
  });
  return { c, doors, ring, spoke, r };
}

/** 0.9.12 polish: the plaza walks a big green gets (world/env/plots.ts buildGreen draws them), their half width (m) and
 * the clearance (m) every decor piece and activity spot keeps from their edge so nothing stands on a walk. */
export const PLAZA_HALF = 0.2;
export const PLAZA_CLEAR = 0.8;
/** Greens at least this big (m²) get the plaza walks. */
const PLAZA_AREA = 400;

/**
 * A big crew green's plaza walks (pure): a ring walk of radius `R` (its outer edge; the band is 2·PLAZA_HALF wide) round
 * the centrepiece and four walks from it out toward the green's corners, as centre-line segments (`segs`,
 * the ring as a 48-sided polyline). Null for a green under PLAZA_AREA.
 */
export function greenPlaza(P: PlotPlaces): { c: XZ; R: number; corner: [XZ, XZ][]; segs: [XZ, XZ][] } | null {
  const G = P.green;
  const hw = (G.maxX - G.minX) / 2;
  const hd = (G.maxZ - G.minZ) / 2;
  if (hw * hd * 4 < PLAZA_AREA) return null;
  const c = { x: (G.minX + G.maxX) / 2, z: (G.minZ + G.maxZ) / 2 };
  // clear of the green's own benches (1.6 m long, 3.2 m either side of the centre)
  const R = Math.max(Math.min(hw, hd) * 0.58, 5.2);
  const corner: [XZ, XZ][] = [];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    // from the ring walk outward (inside the ring the lawn stays open for the benches and the snowball fights)
    const r0 = (R - PLAZA_HALF) / Math.hypot(hw, hd);
    const r1 = 0.82;
    corner.push([{ x: c.x + sx * hw * r0, z: c.z + sz * hd * r0 }, { x: c.x + sx * hw * r1, z: c.z + sz * hd * r1 }]);
  }
  const segs: [XZ, XZ][] = [...corner];
  const rc = R - PLAZA_HALF;
  for (let k = 0; k < 48; k++) {
    const a0 = (k / 48) * Math.PI * 2;
    const a1 = ((k + 1) / 48) * Math.PI * 2;
    segs.push([{ x: c.x + Math.cos(a0) * rc, z: c.z + Math.sin(a0) * rc }, { x: c.x + Math.cos(a1) * rc, z: c.z + Math.sin(a1) * rc }]);
  }
  return { c, R, corner, segs };
}

/** How far (m) the point is from the nearest plaza walk's centre line (Infinity without one). Pure. */
export function plazaDist(P: PlotPlaces, x: number, z: number): number {
  const pl = greenPlaza(P);
  let d = Infinity;
  if (pl) for (const [a, b] of pl.segs) d = Math.min(d, distToSeg(x, z, a, b));
  return d;
}

const routesCache = new Map<string, PlotRoute[]>();
const keepCache = new Map<string, PlotKeepOut[]>();
const decorCache = new Map<string, DecorPlace[]>();

/** Every walker route inside era n's market and huts zones (see the header above), as 2.5 m wide centre lines. Pure. */
export function plotRoutes(n: number): PlotRoute[] {
  const def = regionDef(n);
  const key = `${n}|${def.slots}|${def.room}`;
  const cached = routesCache.get(key);
  if (cached) return cached;
  const L = regionLayout(n);
  const P = plotPlaces(n);
  const M = marketPlaces(L);
  const into = L.inward;
  const q = TRADE_POST.shopQueue;
  const place = (i: number): XZ => ({ x: M.front.x + M.step.x * i, z: M.front.z + M.step.z * i });
  const out: PlotRoute[] = [];
  out.push({ what: 'customers: market gate to the head of the queue', pts: [M.door, M.entry, M.front] });
  for (let i = 0; i < q; i++) out.push({ what: `customers: entry to queue place ${i}`, pts: [M.entry, place(i)] });
  out.push({ what: 'customers: the queue', pts: [place(0), place(q)] });
  out.push({ what: 'customers: back out of the gate', pts: [M.entry, M.door, { x: M.door.x, z: M.door.z - into * 1.6 }] });
  out.push({ what: 'vehicles: the road lane and stop at the market', pts: [{ x: M.lane.fromX, z: M.lane.z }, { x: M.lane.toX, z: M.lane.z }, L.vehicleStop] });
  out.push({ what: 'player: entry to the clerk spot, cash pile and vault pad', pts: [M.entry, { x: M.clerk.x, z: M.front.z }, M.clerk, M.cash, { x: M.vaultPad.x, z: M.vaultPad.z - into * 2.3 }] });
  // planPath: step out to the front aisle (the band row 0 of the machine grid starts behind), west to the depot
  const aisle = L.gate.z + into * (YARD_DEPTH + 0.5);
  out.push({ what: 'clerk: cash pile along the front aisle to the depot', pts: [M.clerk, { x: M.clerk.x, z: aisle }, { x: L.depot.x, z: aisle }, L.depot] });
  const split = L.zones.yard.maxX;
  const farZ = into > 0 ? L.rect.maxZ - 1 : L.rect.minZ + 1;
  out.push({ what: 'player: the path down the west edge', pts: [{ x: split + 1.15, z: L.gate.z + into * YARD_DEPTH }, { x: split + 1.15, z: farZ }] });
  const W = greenWalk(P);
  P.huts.forEach((h, i) => {
    const door = { x: h.x + (h.d / 2 + 0.35) * Math.sin(h.yaw), z: h.z + (h.d / 2 + 0.35) * Math.cos(h.yaw) };
    out.push({ what: `hut ${h.role}: door out along its spoke to the green's ring`, pts: [door, W.doors[i]!, W.ring[W.spoke[i]!]!] });
  });
  // the ring: every chord between its spots (the walkers stroll from spot to spot), and the bend round the centrepiece
  W.ring.forEach((a, i) => W.ring.slice(i + 1).forEach((b) => out.push({ what: 'green: a stroll round the ring', pts: [a, b] })));
  const circle = (rad: number): XZ[] => Array.from({ length: 17 }, (_, k) => ({ x: W.c.x + Math.cos((k / 16) * Math.PI * 2) * rad, z: W.c.z + Math.sin((k / 16) * Math.PI * 2) * rad }));
  out.push({ what: 'green: the bend round the centrepiece', pts: circle(GREEN_CLEAR + 0.4) });
  routesCache.set(key, out);
  return out;
}

/** Ground nothing may stand on, besides the routes: pads, counters, the queue, huts and annexes, shops, streets, the green's centre. Pure. */
export function plotKeepOuts(n: number): PlotKeepOut[] {
  const def = regionDef(n);
  const key = `${n}|${def.slots}|${def.room}`;
  const cached = keepCache.get(key);
  if (cached) return cached;
  const L = regionLayout(n);
  const P = plotPlaces(n);
  const M = marketPlaces(L);
  const out: PlotKeepOut[] = [];
  for (const [what, p] of [['vault pad', M.vaultPad], ['cash pile', M.cash], ['vault', M.vault], ['dock counter', M.dock], ['stall counter', M.stall]] as const) out.push({ what, r: around(p, 3), sight: true });
  out.push({ what: 'market gate', r: { minX: M.door.x - 2.5, maxX: M.door.x + 2.5, minZ: Math.min(M.door.z, M.door.z + L.inward * 3), maxZ: Math.max(M.door.z, M.door.z + L.inward * 3) }, sight: false });
  for (const h of P.huts) out.push({ what: `hut ${h.role} and its annex`, r: grow(hutBox(h, true), 0.7), sight: false });
  for (const s of P.shops) {
    const turned = Math.abs(Math.sin(s.yaw)) > 0.5;
    const hx = (turned ? s.d : s.w) / 2;
    const hz = (turned ? s.w : s.d) / 2;
    out.push({ what: s.stall ? 'street stall' : 'shop', r: grow({ minX: s.x - hx, maxX: s.x + hx, minZ: s.z - hz, maxZ: s.z + hz }, 0.5), sight: false });
  }
  for (const S of P.streets) out.push({ what: 'street', r: grow(S, 0.4), sight: false });
  for (const l of P.lamps) out.push({ what: 'street lamp', r: around(l, 0.7), sight: false });
  const W = greenWalk(P);
  out.push({ what: 'green centrepiece', r: around(W.c, 1.4), sight: false });
  // eras 8-10 line the green with planters (world/env/ground/lateKit.ts greenBorder): a 1.4 m frame inside its edge
  if (n >= 8) {
    const G = P.green;
    for (const r of [{ ...G, maxZ: G.minZ + 1.4 }, { ...G, minZ: G.maxZ - 1.4 }, { ...G, maxX: G.minX + 1.4 }, { ...G, minX: G.maxX - 1.4 }]) out.push({ what: 'green border planters', r, sight: false });
  }
  for (const s of [-1, 1]) out.push({ what: 'green bench', r: grow({ minX: W.c.x + s * 3.2 - 0.8, maxX: W.c.x + s * 3.2 + 0.8, minZ: W.c.z - 0.23, maxZ: W.c.z + 0.23 }, 0.5), sight: false });
  keepCache.set(key, out);
  return out;
}

/** A vignette: items at offsets from its anchor (local frame, +Z toward the camera). */
interface VItem {
  kind: DecorKind;
  dx: number;
  dz: number;
  v?: number;
}

const VIGNETTES: Readonly<Record<string, readonly VItem[]>> = {
  goods: [{ kind: 'crates', dx: -0.75, dz: 0 }, { kind: 'sacks', dx: 0.85, dz: -0.05, v: 1 }, { kind: 'barrels', dx: -0.15, dz: 1.25, v: 2 }],
  stash: [{ kind: 'heap', dx: 0, dz: 0 }, { kind: 'barrels', dx: 1.85, dz: 0.15 }, { kind: 'sacks', dx: -0.2, dz: 1.35 }],
  clutter0: [{ kind: 'sig', dx: 0, dz: 0, v: 0 }, { kind: 'crates', dx: 1.8, dz: 0.25, v: 1 }],
  clutter1: [{ kind: 'sig', dx: 0, dz: 0, v: 1 }, { kind: 'sacks', dx: 1.7, dz: 0.3 }],
  clutter2: [{ kind: 'sig', dx: 0, dz: 0, v: 2 }, { kind: 'barrels', dx: 1.8, dz: 0.2, v: 1 }],
  bench: [{ kind: 'bench', dx: 0, dz: 0 }, { kind: 'lamp', dx: -1.4, dz: 0 }, { kind: 'snow', dx: 1.75, dz: 0.3 }],
  notice: [{ kind: 'notice', dx: 0, dz: 0 }, { kind: 'sacks', dx: 1.7, dz: 0.35, v: 2 }, { kind: 'snow', dx: -1.3, dz: 0.95 }],
  cart: [{ kind: 'cart', dx: 0, dz: 0 }, { kind: 'crates', dx: 1.85, dz: 0.1, v: 2 }],
  snows: [{ kind: 'snow', dx: 0, dz: 0 }, { kind: 'snow', dx: 1.7, dz: 0.65, v: 1 }],
  lampSnow: [{ kind: 'lamp', dx: 0, dz: 0 }, { kind: 'snow', dx: 1.15, dz: 0.3 }],
  // 0.9.12: greenery for the bigger greens and markets (a snowy grove, a pair of bushes, a lone fir with a bench)
  grove: [{ kind: 'fir', dx: 0, dz: 0 }, { kind: 'fir', dx: 1.65, dz: 0.55, v: 1 }, { kind: 'shrub', dx: 0.55, dz: 1.45 }],
  shrubs: [{ kind: 'shrub', dx: 0, dz: 0 }, { kind: 'shrub', dx: 1.2, dz: 0.25, v: 1 }],
  firBench: [{ kind: 'fir', dx: 0, dz: 0, v: 1 }, { kind: 'bench', dx: 1.75, dz: 0.2 }],
};

/** What each zone gets, in order (repeats when the free ground allows more). Every era's clutter piece comes early. */
const RECIPE: Readonly<Record<'market' | 'huts', readonly string[]>> = {
  market: ['clutter0', 'goods', 'bench', 'cart', 'notice', 'shrubs', 'clutter1', 'stash', 'lampSnow', 'goods', 'clutter2', 'grove', 'snows', 'cart', 'bench', 'goods', 'shrubs', 'notice', 'stash'],
  huts: ['stash', 'grove', 'bench', 'clutter1', 'shrubs', 'goods', 'lampSnow', 'firBench', 'cart', 'clutter2', 'grove', 'snows', 'goods', 'shrubs', 'clutter0', 'bench', 'grove', 'stash', 'cart', 'lampSnow', 'firBench', 'goods', 'shrubs'],
};

/** Metres of free ground per vignette, and the most each zone takes (more in the bigger zones of the later eras). */
const DECOR_AREA = 5;
const DECOR_MAX = 22;
const DECOR_MAX_AREA = 42;
const DECOR_CELL = 0.25;
const DECOR_STEP = 0.75;
const DECOR_GAP = 0.35;
/** Free ground (m) the market centrepiece keeps round it (Dino: 3 m to walk), or at the least CENTRE_ROOM_MIN in a tight market. */
export const CENTRE_ROOM = 3.0;
export const CENTRE_ROOM_MIN = 2.0;

function distToSeg(px: number, pz: number, a: XZ, b: XZ): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
  return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
}

/** Camera-shadow height classes of a decor piece (low, mid, tall): the keep-outs of pads grow toward the camera by its reach. */
const sightClass = (h: number): number => (h <= 1.0 ? 0 : h <= 1.3 ? 1 : 2);
const SIGHT_H = [1.0, 1.3, 3.0] as const;

/**
 * Era n's market and huts decor (2..10), at full growth. Greedy and deterministic: each vignette of a zone's recipe
 * goes where it fits (every item inside the zone, 1.25 m off every route, off every keep-out, the camera shadow of its
 * tall items off the pads) and farthest from the vignettes already placed, preferring a tucked corner. The ground is
 * rasterised once (0.25 m cells, conservative: a cell any route or keep-out touches is blocked). Pure.
 */
export function plotDecor(n: number): DecorPlace[] {
  const def = regionDef(n);
  const key = `${n}|${def.slots}|${def.room}`;
  const cached = decorCache.get(key);
  if (cached) return cached;
  const L = regionLayout(n);
  const Z = L.zones;
  const routes = plotRoutes(n);
  const keeps = plotKeepOuts(n);
  const reachK = 1 / Math.tan((CAMERA.pitchDeg * Math.PI) / 180) / Math.SQRT2;
  const zoneIn = { market: grow(Z.market, -0.8), huts: grow(Z.huts, -0.8) };

  const C = DECOR_CELL;
  const gx0 = Math.floor(L.zones.yard.maxX) - 1;
  const gz0 = Math.floor(L.rect.minZ) - 1;
  const NX = Math.ceil((L.rect.maxX - gx0) / C) + 4;
  const NZ = Math.ceil((L.rect.maxZ - gz0) / C) + 4;
  const cellsOf = (r: ERect): [number, number, number, number] => [Math.max(0, Math.floor((r.minX - gx0) / C + 1e-9)), Math.min(NX - 1, Math.ceil((r.maxX - gx0) / C - 1e-9) - 1), Math.max(0, Math.floor((r.minZ - gz0) / C + 1e-9)), Math.min(NZ - 1, Math.ceil((r.maxZ - gz0) / C - 1e-9) - 1)];
  const fill = (g: Uint8Array, r: ERect): void => {
    const [x0, x1, z0, z1] = cellsOf(r);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) g[iz * NX + ix] = 1;
  };
  // one static grid per height class: the routes, the keep-outs (pads grown toward the camera by the class's reach)
  const route = new Uint8Array(NX * NZ);
  for (const r of routes) {
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1]!;
      const b = r.pts[i]!;
      const [x0, x1, z0, z1] = cellsOf({ minX: Math.min(a.x, b.x) - ROUTE_HALF - C, maxX: Math.max(a.x, b.x) + ROUTE_HALF + C, minZ: Math.min(a.z, b.z) - ROUTE_HALF - C, maxZ: Math.max(a.z, b.z) + ROUTE_HALF + C });
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) if (!route[iz * NX + ix] && distToSeg(gx0 + (ix + 0.5) * C, gz0 + (iz + 0.5) * C, a, b) < ROUTE_HALF + C * 0.71) route[iz * NX + ix] = 1;
    }
  }
  // 0.9.12 polish: nothing stands on the big green's plaza walks
  const plaza = greenPlaza(plotPlaces(n));
  const PLAZA_KEEP = PLAZA_HALF + PLAZA_CLEAR;
  for (const [a, b] of plaza?.segs ?? []) {
    const [x0, x1, z0, z1] = cellsOf({ minX: Math.min(a.x, b.x) - PLAZA_KEEP - C, maxX: Math.max(a.x, b.x) + PLAZA_KEEP + C, minZ: Math.min(a.z, b.z) - PLAZA_KEEP - C, maxZ: Math.max(a.z, b.z) + PLAZA_KEEP + C });
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) if (!route[iz * NX + ix] && distToSeg(gx0 + (ix + 0.5) * C, gz0 + (iz + 0.5) * C, a, b) < PLAZA_KEEP + C * 0.71) route[iz * NX + ix] = 1;
  }
  const statics = SIGHT_H.map((hh) => {
    const g = route.slice();
    const reach = hh * reachK + 0.3;
    for (const k of keeps) fill(g, k.sight ? { minX: k.r.minX - 0.4, maxX: k.r.maxX + reach + 0.4, minZ: k.r.minZ - 0.4, maxZ: k.r.maxZ + reach + 0.4 } : k.r);
    return g;
  });
  const occ = new Uint8Array(NX * NZ);
  const rectOf = (d: { x: number; z: number; hx: number; hz: number }): ERect => ({ minX: d.x - d.hx, maxX: d.x + d.hx, minZ: d.z - d.hz, maxZ: d.z + d.hz });
  type Item = { kind: DecorKind; x: number; z: number; hx: number; hz: number; h: number; yaw: number; v: number };
  /** Does an item fit here? `pad` is extra clearance asked of everything (a tucked corner is when 0.9 m of it fails). */
  const fits = (d: Item, pad: number): boolean => {
    const r = grow(rectOf(d), pad);
    // the whole item sits inside one zone (the 0.9 m tuck test looks past the zone edge on purpose: see edgeNear)
    if (pad === 0 && !within(r, zoneIn.market) && !within(r, zoneIn.huts)) return false;
    const st = statics[sightClass(d.h)]!;
    const [x0, x1, z0, z1] = cellsOf(r);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) if (st[iz * NX + ix] || occ[iz * NX + ix]) return false;
    return true;
  };
  const edgeNear = (d: Item): boolean => {
    const r = grow(rectOf(d), 0.9);
    return !within(r, zoneIn.market) && !within(r, zoneIn.huts);
  };

  const make = (item: VItem, ax: number, az: number, turn: number, flip: number): Item => {
    const [sx, sz, h] = DECOR_SIZE[item.kind];
    const th = turn * (Math.PI / 2);
    const dx = item.dx * flip;
    const x = ax + dx * Math.cos(th) + item.dz * Math.sin(th);
    const z = az - dx * Math.sin(th) + item.dz * Math.cos(th);
    const odd = turn % 2 === 1;
    return { kind: item.kind, x, z, hx: odd ? sz : sx, hz: odd ? sx : sz, h, yaw: th, v: item.v ?? 0 };
  };

  const out: DecorPlace[] = [];
  for (const zone of ['market', 'huts'] as const) {
    const Zi = zoneIn[zone];
    // free ground: anchors where a 1.8 m square of a middling item fits (counts the room this zone has to fill)
    let free = 0;
    for (let x = Zi.minX; x <= Zi.maxX; x += DECOR_STEP) for (let z = Zi.minZ; z <= Zi.maxZ; z += DECOR_STEP) if (fits({ kind: 'sig', x, z, hx: 0.9, hz: 0.9, h: 1, yaw: 0, v: 0 }, 0)) free++;
    const cap = Math.max(DECOR_MAX, Math.round(((Zi.maxX - Zi.minX) * (Zi.maxZ - Zi.minZ)) / DECOR_MAX_AREA));
    const want = Math.min(cap, Math.round((free * DECOR_STEP * DECOR_STEP) / DECOR_AREA));
    // 0.9.12 (Dino: "plaza centrepieces"): first the market's centrepiece, in the open middle of its widest paving with
    // a wide ring of free ground round it (CENTRE_ROOM, more where it can), so it never narrows a way anyone walks
    if (zone === 'market') {
      let best: { pad: number; d: number; it: Item } | null = null;
      const mx = (Zi.minX + Zi.maxX) / 2;
      const mz = (Zi.minZ + Zi.maxZ) / 2;
      const [hx, hz, h] = DECOR_SIZE.centre;
      for (let x = Zi.minX; x <= Zi.maxX; x += 0.5) {
        for (let z = Zi.minZ; z <= Zi.maxZ; z += 0.5) {
          const it: Item = { kind: 'centre', x, z, hx, hz, h, yaw: 0, v: 0 };
          if (!fits(it, 0)) continue;
          const pad = [CENTRE_ROOM + 0.5, CENTRE_ROOM, CENTRE_ROOM_MIN].find((m) => fits(it, m));
          if (pad === undefined) continue;
          const d = Math.hypot(x - mx, z - mz);
          if (!best || pad > best.pad || (pad === best.pad && d < best.d)) best = { pad, d, it };
        }
      }
      if (best) {
        out.push({ ...best.it, zone: 'market' });
        fill(occ, grow(rectOf(best.it), Math.min(best.pad, CENTRE_ROOM)));
      }
    }
    const recipe = RECIPE[zone];
    for (let vi = 0; vi < want; vi++) {
      const tpl = VIGNETTES[recipe[vi % recipe.length]!]!;
      let best: { score: number; items: Item[] } | null = null;
      for (let x = Zi.minX; x <= Zi.maxX; x += DECOR_STEP) {
        for (let z = Zi.minZ; z <= Zi.maxZ; z += DECOR_STEP) {
          for (let turn = 0; turn < 2; turn++) {
            for (const flip of [1, -1]) {
              const first = make(tpl[0]!, x, z, turn, flip);
              if (!fits(first, 0)) continue;
              const items: Item[] = [first];
              for (let i = 1; i < tpl.length; i++) {
                const it = make(tpl[i]!, x, z, turn, flip);
                if (!fits(it, 0) || items.some((o) => hit(grow(rectOf(it), 0.05), rectOf(o)))) break;
                items.push(it);
              }
              if (items.length < tpl.length) continue;
              // farthest from what is placed, and tucked against a wall or a building when it can be
              const tucked = items.some((it) => edgeNear(it) || !fits(it, 0.9));
              let near = 7;
              for (const o of out) near = Math.min(near, Math.hypot(o.x - x, o.z - z));
              const score = near + (tucked ? 2.2 : 0) + ((Math.round(x * 7 + z * 13 + vi * 5) % 7) / 7) * 0.4;
              if (!best || score > best.score) best = { score, items };
            }
          }
        }
      }
      if (!best) continue;
      for (const it of best.items) {
        out.push({ ...it, zone: within(rectOf(it), zoneIn.market) ? 'market' : 'huts' });
        fill(occ, grow(rectOf(it), DECOR_GAP));
      }
    }
  }
  decorCache.set(key, out);
  return out;
}

/** 0.9.12 (Dino: "people doing things"): a place on era n's green where someone stops to do something. */
export interface GreenActivity {
  kind: 'sit' | 'snowman';
  /** Where they stand or sit, and the way they face. */
  x: number;
  z: number;
  yaw: number;
  /** The ring spot (greenWalk ring index) they walk from: the leg from it to (ax, az), then to (x, z), is clear. */
  ring: number;
  ax: number;
  az: number;
  /** A snowman's own spot (where it grows), beside the builder. */
  sx?: number;
  sz?: number;
}

const activityCache = new Map<string, GreenActivity[]>();

/**
 * Era n's activity places (pure, cached): a seat on every huts-zone bench, and a snowman beside a snow pile, each
 * with a ring spot whose straight leg to it keeps 0.35 m off every other decor piece, hut, annex and the centrepiece
 * (people stay walkers of the ring, they just step off it). Places no leg reaches are left out.
 */
export function greenActivities(n: number): GreenActivity[] {
  const def = regionDef(n);
  const key = `${n}|${def.slots}|${def.room}`;
  const cached = activityCache.get(key);
  if (cached) return cached;
  const P = plotPlaces(n);
  const W = greenWalk(P);
  const decor = plotDecor(n);
  const rectOf = (d: DecorPlace): ERect => ({ minX: d.x - d.hx, maxX: d.x + d.hx, minZ: d.z - d.hz, maxZ: d.z + d.hz });
  const huts = P.huts.map((h) => grow(hutBox(h, true), 0.35));
  const clear = (a: XZ, b: XZ, skip: DecorPlace | null): boolean => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / 0.15));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const q = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      if (Math.hypot(q.x - W.c.x, q.z - W.c.z) < GREEN_CLEAR) return false;
      const inR = (r: ERect): boolean => q.x > r.minX && q.x < r.maxX && q.z > r.minZ && q.z < r.maxZ;
      if (huts.some(inR)) return false;
      for (const d of decor) if (d !== skip && d.kind !== 'snow' && inR(grow(rectOf(d), 0.35))) return false;
    }
    return true;
  };
  const nearestRing = (p: XZ, skip: DecorPlace | null): number => {
    let best = -1;
    let bd = Infinity;
    W.ring.forEach((r, k) => {
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if (d < bd && clear(r, p, skip)) {
        bd = d;
        best = k;
      }
    });
    return best;
  };
  const out: GreenActivity[] = [];
  for (const d of decor) {
    if (d.zone !== 'huts') continue;
    if (d.kind === 'bench') {
      // the seat (its front is +Z turned by its yaw, the backrest behind), approached from 0.9 m in front
      const fx = Math.sin(d.yaw);
      const fz = Math.cos(d.yaw);
      const seat = { x: d.x + fx * 0.06, z: d.z + fz * 0.06 };
      const a = { x: d.x + fx * 0.9, z: d.z + fz * 0.9 };
      const ring = nearestRing(a, d);
      if (ring >= 0) out.push({ kind: 'sit', x: seat.x, z: seat.z, yaw: d.yaw, ring, ax: a.x, az: a.z });
    } else if (d.kind === 'snow' && d.v === 0) {
      // a snowman grows out of the snow pile (its ground is already clear of every walk and pad); the builder packs
      // it from 0.55 m off the pile's long side
      const alongX = d.hx >= d.hz;
      for (const side of [1, -1]) {
        const st = alongX ? { x: d.x, z: d.z + side * (d.hz + 0.55) } : { x: d.x + side * (d.hx + 0.55), z: d.z };
        if (plazaDist(P, st.x, st.z) < PLAZA_HALF + PLAZA_CLEAR) continue;
        const ring = nearestRing(st, d);
        if (ring < 0) continue;
        out.push({ kind: 'snowman', x: st.x, z: st.z, yaw: Math.atan2(d.x - st.x, d.z - st.z), ring, ax: st.x, az: st.z, sx: d.x, sz: d.z });
        break;
      }
    }
  }
  activityCache.set(key, out);
  return out;
}

/**
 * True while era n's expansion pad takes payment (docs/EXPANSION.md §C): era n is next, the climb is open (Great
 * Lodge), and its gate is met: every upgrade introduced before era n at shown level 10·(n − 1) and the settlement at
 * 5·(n − 1) (eras/gate.ts). A pad with anything already paid into it stays offered (grandfathered).
 */
export function expansionOffered(state: GameState, n: number): boolean {
  if (!ERAS[n] || state.eras.age !== n - 1 || !climbOpen(state)) return false;
  return padPaid(state, n) > 0 || gateMet(state, n);
}

/**
 * 0.9.12 (full review G8): the next expansion's cash is in and it still wants `kind` (era 2: crates). The crate
 * runner then leaves the processor's crates for the player instead of carrying them all to the tricycles.
 */
export function expansionWants(state: GameState, kind: string): boolean {
  const n = state.eras.age + 1;
  const era = ERAS[n];
  if (!era || era.unlock.extra.kind !== kind || !expansionOffered(state, n)) return false;
  const paid = state.eras.regions[n];
  return !!paid && paid.cash >= era.unlock.cash && paid.extra < era.unlock.extra.count;
}

/**
 * True while era n's land, roads and FOR SALE pad show but the pad does not take payment yet (docs/EXPANSION.md §C):
 * the climb is open, era n is next, and its pad is not offered. The pad tile is greyed and refuses payment.
 */
export function expansionPreview(state: GameState, n: number): boolean {
  return !!ERAS[n] && climbOpen(state) && state.eras.age === n - 1 && !expansionOffered(state, n);
}

export interface TravelPoint {
  id: string;
  label: string;
  /** Group for the map panel. */
  kind: 'home' | 'region' | 'district';
  era: number;
  x: number;
  z: number;
  /** Reachable now (home: always; region: unlocked, or its pad on offer → you arrive at the pad; district: era reached). */
  open: boolean;
}

/** Every fast-travel destination, in map order. */
export function travelPoints(state: GameState): TravelPoint[] {
  const out: TravelPoint[] = [
    { id: 'yard', label: 'Lumber Yard', kind: 'home', era: 1, x: 0, z: 2, open: true },
    { id: 'village', label: 'Village', kind: 'home', era: 1, x: 4.6, z: 20, open: state.village.revealed },
    // the corridor mouth on the square's west side (the square's centre is the solid fir)
    { id: 'town', label: 'Market Town', kind: 'home', era: 1, x: 17, z: 26.7, open: state.town.revealed },
  ];
  for (let n = 2; n < REGIONS.length; n++) {
    if (!REGIONS[n]) continue;
    const L = regionLayout(n);
    const unlocked = state.eras.age >= n;
    const offered = expansionOffered(state, n);
    const at = unlocked ? L.inside : { x: L.expansionPad.x - 2.5, z: L.expansionPad.z };
    out.push({ id: `region:${n}`, label: ERAS[n]!.region, kind: 'region', era: n, x: at.x, z: at.z, open: unlocked || offered });
  }
  for (let n = 2; n < DISTRICTS.length; n++) {
    const d = DISTRICTS[n];
    if (!d) continue;
    const at = districtArrival(n);
    out.push({ id: `district:${n}`, label: d.name, kind: 'district', era: n, x: at.x, z: at.z, open: state.eras.age >= n });
  }
  return out;
}

/**
 * Where fast travel to district n lands: on its front sidewalk (the south edge, on its street), on a column line near the
 * middle so it is on no lot pad, with every lot ahead of the player. The camera looks from +X/+Z, so nothing built stands
 * between it and the player and the whole town rises up the screen. (0.9.12 landed three-row districts one row in, on
 * the middle row's front walk: the front-row building then covered the player, who seemed to stand on its roof; review
 * U1.) The spot keeps clear of the street furniture and the lamps (city/decor.ts). Pure.
 */
export function districtArrival(n: number): XZ {
  const d = DISTRICTS[n]!;
  const inner = districtInner(n);
  const { cols } = districtGrid(d.lots);
  const cw = (inner.maxX - inner.minX) / cols;
  const z = d.rect.maxZ - DISTRICT_MARGIN / 2;
  const mid = (inner.minX + inner.maxX) / 2;
  const lines: number[] = [];
  for (let c = 1; c < cols; c++) lines.push(inner.minX + c * cw);
  lines.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  const items = districtDecor(n);
  const lamps = districtLamps(n);
  const clear = (x: number): boolean =>
    items.every((it) => Math.hypot(it.x - x, it.z - z) > DECOR_RADIUS[it.kind] * it.scale + 0.8) && lamps.every((l) => Math.hypot(l.x - x, l.z - z) > 1);
  for (const line of lines) for (const dx of [0, 0.6, -0.6, 1.2, -1.2]) if (clear(line + dx)) return { x: line + dx, z };
  return { x: lines[0] ?? mid, z };
}

/**
 * The era trail, the way to walk from the Market Town to era `upTo`'s gate (2..10) along the roads, as a polyline of
 * world points (x, z) through every earlier region's gate in era order. The map panel draws it so the next era is
 * always one line away. Points sit 1 m out on the road from each gate; a change of road goes down the link road that
 * touches both (0.9.5: the west link from R1 to R2, the east link from R2 to R3). Pure.
 */
export function eraTrail(upTo: number): XZ[] {
  const roadOf = (id: string): ERect => ROADS.find((r) => r.id === id)!.rect;
  const avenue = roadOf('southAvenue');
  const touches = (a: ERect, b: ERect): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minZ <= b.maxZ && b.minZ <= a.maxZ;
  const out: XZ[] = [{ x: (avenue.minX + avenue.maxX) / 2, z: avenue.minZ + 2 }];
  let prevRoad = '';
  for (let n = 2; n <= Math.min(upTo, REGIONS.length - 1); n++) {
    if (!REGIONS[n]) continue;
    const L = regionLayout(n);
    const next = { x: L.gate.x, z: L.gate.z - L.inward };
    const prev = out[out.length - 1]!;
    if (prevRoad && prevRoad !== L.road) {
      // another road: along this one to the link, down the link, then along the new road
      const a = roadOf(prevRoad);
      const b = roadOf(L.road);
      const link = ROADS.find((q) => q.id !== prevRoad && q.id !== L.road && q.rect.maxX - q.rect.minX < q.rect.maxZ - q.rect.minZ && touches(q.rect, a) && touches(q.rect, b))!.rect;
      const linkX = (link.minX + link.maxX) / 2;
      out.push({ x: linkX, z: prev.z }, { x: linkX, z: next.z });
    } else if (prev.z !== next.z) {
      out.push({ x: prev.x, z: next.z });
    }
    out.push(next);
    prevRoad = L.road;
  }
  return out;
}
