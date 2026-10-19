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
  const inner = D - YARD_DEPTH; // depth below the yard

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
  const H = zones.harvest;
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
        for (let i = 0, x = F.minX + 1.2; x + p <= F.maxX - 1.0; i++, x += p + g) bed(x, z, x + p, z + p, (i + 2 * j) % 3 === 2 ? 1 : 0);
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
  const hx0 = H.minX + 2.4; // clear of the path along the column split
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
  const beds = fieldBeds(plan.field, field);

  const out: PlotPlaces = { plan, huts, green, streets, shops, lamps, yardPave, field, beds };
  placesCache.set(key, out);
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
    out.push({ id: `district:${n}`, label: d.name, kind: 'district', era: n, x: d.rect.minX - 2, z: (d.rect.minZ + d.rect.maxZ) / 2, open: state.eras.age >= n });
  }
  return out;
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
