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
    padSize: 2.2,
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
