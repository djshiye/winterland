/**
 * [town] 0.9.12 Lantern Lane (Dino: "the town areas should be much larger, with more areas to build on"): the Market
 * Town grows south, through its south fence gap, along the south avenue down to road R1. Four more lots (LAYOUT.town.lots
 * 8..11) face the avenue from either side; lamps, trees and benches line it. Pure: no THREE, no GameContext.
 *
 * - The lane opens with the new land (the Great Lodge built, the same moment the south avenue opens: eras/gate.ts
 *   climbOpen), so era 1 (the frozen benchmark) never sees it and its first hour plays exactly as before.
 * - Everyone who walks there (townsfolk, porters, cashiers, the foreman) keeps to the SPINE: the avenue's centre line,
 *   joined to the square through the south fence gap (GAP_IN inside the square, GAP_OUT just past the fence). The lane's
 *   lots, their stations and its props all stay outside LANE_WALK, which is the avenue widened to 8 m between the two
 *   rows of stations, so every walk there is at least 3 m clear (tests/townLane.test.ts).
 */
import { LAYOUT, type Rect, type XZ } from '../config';
import { TOWN_SQUARE_LOTS } from '../core/types';

const T = LAYOUT.town;

/** The town's south fence line (the lane starts here). */
export const TOWN_SOUTH = T.area.maxZ;
/** The whole lane (ground, fence line): from the town's south fence down to 0.6 m short of road R1 (z 62). */
export const LANE: Rect = { minX: T.area.minX, maxX: 39.4, minZ: TOWN_SOUTH, maxZ: 61.4 };
/** The avenue's centre line, the lane's walking spine. */
export const SPINE_X = 28;
/** Where walkers keep to inside the lane: between the two rows of lot stations (x 22.5 / 33.1) and their MANAGE tiles. */
export const LANE_WALK: Rect = { minX: 23.6, maxX: 32.4, minZ: TOWN_SOUTH + 0.4, maxZ: LANE.maxZ - 0.4 };
/** The player's walk rect for the lane (lot footprints and props keep their own colliders). */
export const LANE_PLAYER_WALK: Rect = { minX: LANE.minX + 0.4, maxX: LANE.maxX - 0.4, minZ: TOWN_SOUTH - 0.2, maxZ: LANE.maxZ };
/** The walk through the south fence gap between the square and the lane (the avenue's own, world/env/frontier.ts TOWN_GAPS). */
export const LANE_GAP_WALK: Rect = { minX: 26.2, maxX: 29.8, minZ: T.square.maxZ - 0.2, maxZ: TOWN_SOUTH + 0.2 };
/** Inside the square at the south fence gap, and just past the fence in the lane. */
export const GAP_IN: XZ = { x: SPINE_X, z: T.square.maxZ - 0.6 };
export const GAP_OUT: XZ = { x: SPINE_X, z: TOWN_SOUTH + 1.0 };

/** True for the lane's lots. */
export const isLaneLot = (lot: number): boolean => lot >= TOWN_SQUARE_LOTS;

/** True for points south of the town's fence inside the lane (where the square's planners do not reach). */
export function inLane(p: XZ): boolean {
  return p.z > TOWN_SOUTH - 0.05 && p.z <= LANE.maxZ + 0.6 && p.x >= LANE.minX - 0.3 && p.x <= LANE.maxX + 0.3;
}

/** The slice of the state the lane follows (the tests pass a plain object). */
export interface LaneState {
  village: { greatLodge: { tier: number } };
  eras?: { age: number };
}

/** True once the lane (and its lots) is open: the Great Lodge is built, or a later era was reached. */
export function laneOpen(s: LaneState): boolean {
  return s.village.greatLodge.tier >= 0 || (s.eras?.age ?? 1) >= 2;
}

/** True when lot `lot` may be offered in this state (the square's lots always; the lane's once it is open). */
export function lotOffered(s: LaneState, lot: number): boolean {
  return !isLaneLot(lot) || laneOpen(s);
}

/** `p` clamped into the lane's walk rect. */
export function clampToLane(p: XZ): XZ {
  return { x: Math.min(LANE_WALK.maxX, Math.max(LANE_WALK.minX, p.x)), z: Math.min(LANE_WALK.maxZ, Math.max(LANE_WALK.minZ, p.z)) };
}

/** Waypoints inside the lane from `from` (excluded) to `to` (included): onto the spine, along it, off it. */
export function laneLeg(from: XZ, to: XZ): XZ[] {
  const out: XZ[] = [];
  if (Math.abs(from.x - SPINE_X) > 0.05) out.push({ x: SPINE_X, z: from.z });
  if (Math.abs(to.z - from.z) > 0.05) out.push({ x: SPINE_X, z: to.z });
  out.push(to);
  return out;
}

/**
 * Route `from` → `to` where either end may lie in the lane: `square(a, b)` plans the square part (the caller's own
 * planner); the lane part runs along the spine through the gap. Both ends in the square: just `square(from, to)`.
 */
export function viaLane(from: XZ, to: XZ, square: (a: XZ, b: XZ) => XZ[]): XZ[] {
  const a = inLane(from);
  const b = inLane(to);
  if (!a && !b) return square(from, to);
  if (a && b) return laneLeg(from, to);
  if (b) return [...square(from, GAP_IN), GAP_OUT, ...laneLeg(GAP_OUT, to)];
  return [...laneLeg(from, GAP_OUT), GAP_IN, ...square(GAP_IN, to)];
}
