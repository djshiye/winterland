/**
 * [MAIN] Pure placement of everything inside an era region and the fast-travel destinations. Shared by the region
 * world (eras/EraWorld.ts), the era workers, Jack's carts, the world dressing and the map panel. Deterministic: same
 * input, same numbers. No THREE, no GameContext.
 *
 * Region anatomy (eras/data.ts REGIONS[n]): the GATE is the middle of the gate edge (north = minZ, south = maxZ); a
 * 7 m FRONT YARD band runs along that edge (export depot + import dock left of the gate, Jack's cart + the era shop
 * mat right of it); MACHINE SLOTS fill the rest in a centred grid. The EXPANSION PAD sits on the road just outside
 * the gate. Machines face the front yard (their feed / take side toward the gate).
 */
import { FIRST_EXPANSION_VILLAGE_LEVEL, DISTRICTS, ERAS, REGIONS, regionDef, type ERect, type GateSide } from './data';
import type { GameState } from '../core/types';

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
  /** Machine slots (length = REGIONS[n].slots) and the square cell each one owns (metres). */
  slots: SlotPlace[];
  cell: number;
}

const BAND = 7;

/** Layout of era n's region (2..10). */
export function regionLayout(n: number): RegionLayout {
  const def = regionDef(n);
  const r = def.rect;
  const W = r.maxX - r.minX;
  const D = r.maxZ - r.minZ;
  const north = def.gate === 'north';
  const inward = north ? 1 : -1;
  const gx = (r.minX + r.maxX) / 2;
  const edgeZ = north ? r.minZ : r.maxZ;
  const bandZ = edgeZ + inward * (BAND / 2 + 0.5);
  // facilities face into the region: local +Z → world +Z (north gate) or −Z (south gate)
  const facilityYaw = north ? 0 : Math.PI;

  // machine grid: biggest cell (9 → 7 m) that fits every slot
  const free = D - BAND - 2;
  let cell = 7;
  let cols = Math.max(1, Math.floor((W - 2) / cell));
  for (const c of [9, 8.5, 8, 7.5, 7]) {
    const k = Math.max(1, Math.floor((W - 2) / c));
    if (Math.ceil(def.slots / k) * c <= free) {
      cell = c;
      cols = k;
      break;
    }
  }
  const rows = Math.ceil(def.slots / cols);
  const gridStart = edgeZ + inward * (BAND + 1); // first row's near edge
  const slots: SlotPlace[] = [];
  for (let i = 0; i < def.slots; i++) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? def.slots - row * cols : cols;
    const col = i - row * cols;
    const x = gx + (col - (inRow - 1) / 2) * cell;
    const z = gridStart + inward * (row + 0.5) * cell;
    // machines face the gate: local +Z toward the front yard
    slots.push({ x, z, yaw: north ? Math.PI : 0 });
  }

  const roadZ = edgeZ - inward * 2; // roads are 4 m wide and touch the gate edge
  return {
    n,
    rect: r,
    gate: { x: gx, z: edgeZ, side: def.gate, width: 4 },
    inward,
    inside: { x: gx, z: edgeZ + inward * 3 },
    expansionPad: { x: gx + 4.5, z: roadZ },
    padSize: 2.2,
    depot: { x: r.minX + 4.5, z: bandZ },
    dock: { x: r.minX + 10.5, z: bandZ },
    jack: { x: r.maxX - 10.5, z: bandZ },
    shopMat: { x: r.maxX - 4.5, z: bandZ },
    sign: { x: gx - 4, z: edgeZ - inward * 0.6 },
    facilityYaw,
    slots,
    cell,
  };
}

/** True once era n's expansion pad is offered (era 2: Winter City; later eras: the previous era reached). */
export function expansionOffered(state: GameState, n: number): boolean {
  if (!ERAS[n]) return false;
  if (state.eras.age >= n) return false;
  return n === 2 ? state.village.level >= FIRST_EXPANSION_VILLAGE_LEVEL || state.eras.age >= 2 : state.eras.age >= n - 1;
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
    { id: 'town', label: 'Market Town', kind: 'home', era: 1, x: 24, z: 27, open: state.town.revealed },
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
