/**
 * [PURE] 0.9.5: where a region market's pieces stand, from the region layout (eras/layout.ts zones.market, marketGate,
 * vehicleStop, customerEntry). No THREE, no GameContext; tests/regionMarket.test.ts checks every era's numbers.
 *
 *   road  ══ toX ◄═══ [bed] ═══ queue ═══ fromX ══      vehicles drive −X along the road in front of their own market
 *   fence ─────── [ DOCK ] ── market gate ─────────      the loading dock against the fence, west of the market gate
 *                            entry  shoppers ◄ queue      walk-ins come in through the gate and line up west of the stall
 *                                  [ STALL ]
 *                           clerk  ( cash ) [pad]       one cash pile for both, south of the stall; its cash
 *                                  [vault]             machine's level pad east of it, the machine south of it
 *
 * Counters lie along X (local −Z = toward the road); a region's facilityYaw turns them like the yard's facilities.
 */
import type { RegionLayout, XZ } from './layout';
import type { LRect } from './rules';

export interface MarketPlaces {
  /** Loading dock (vehicles) and market stall (walk-ins) counter centres. */
  dock: XZ;
  stall: XZ;
  /** Counter yaw (= the region's facilityYaw). */
  yaw: number;
  /** The shared cash pile and its walk-over zone centre. */
  cash: XZ;
  /**
   * Where an era clerk stands to collect the cash: west of the pile, so its walk along the first machine aisle
   * (npc/EraWorker.ts planPath) passes west of the stall instead of brushing its back.
   */
  clerk: XZ;
  /** The era cash machine (eras/CashMachine.ts), south of the cash pile, and its level pad east of the pile. */
  vault: XZ;
  vaultPad: XZ;
  /** Vehicle lane on the road: drive −X from fromX, the bed lines up with dock.x, gone at toX. */
  lane: { z: number; fromX: number; toX: number };
  /** Shoppers: appear at `door` (in the market gate), walk to `entry`, queue from `front` along −X; leave the same way. */
  door: XZ;
  entry: XZ;
  front: XZ;
  /** Unit step between two queued shoppers (world). */
  step: XZ;
}

/** Counter footprints in their local frame: the dock's runs back to the fence so nobody gets behind it. */
export const DOCK_BODY: LRect = { u0: -1.95, u1: 1.6, v0: -1.8, v1: 0.45 };
export const STALL_BODY: LRect = { u0: -1.95, u1: 1.6, v0: -0.45, v1: 0.45 };
/** Player drop zones (local): the yard side of each counter. */
export const DOCK_GIVE: LRect = { u0: -1.4, u1: 1.4, v0: 0.6, v1: 1.8 };
export const STALL_GIVE: LRect = { u0: -1.4, u1: 1.4, v0: 0.6, v1: 1.8 };

/** Truck bed offset from the truck's origin (assets/vehicles.ts TRUCK_BED_X). */
const BED_X = 1.09;

export function marketPlaces(L: RegionLayout): MarketPlaces {
  const into = L.inward;
  const edge = L.marketGate.z;
  const mg = L.marketGate.x;
  const dock = { x: mg - 3.5, z: edge + into * 1.9 };
  const stall = { x: mg + 2.5, z: edge + into * 8 };
  return {
    dock,
    stall,
    yaw: L.facilityYaw,
    cash: { x: stall.x, z: stall.z + into * 2.4 },
    clerk: { x: stall.x - 2.6, z: stall.z + into * 2.4 },
    vault: { x: stall.x - 0.4, z: stall.z + into * 5.0 },
    vaultPad: { x: stall.x + 2.6, z: stall.z + into * 2.4 },
    lane: { z: L.vehicleStop.z, fromX: L.zones.market.maxX + 1, toX: dock.x - BED_X - 8 },
    door: { x: mg, z: edge },
    entry: { x: L.customerEntry.x, z: L.customerEntry.z },
    front: { x: stall.x, z: stall.z - into * 1.05 },
    step: { x: -1.1, z: 0 },
  };
}
