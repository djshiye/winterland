/**
 * [MAIN — wave 9 contract] Fixed decor spots on the market square (LAYOUT.town.square). world/env/town.ts places
 * the props here (and their colliders); npc/Townsfolk.ts sends wanderers to them. Yaw: the way a seated / standing
 * person faces (radians, 0 = +Z).
 */
import type { XZ } from '../config';

export interface Spot extends XZ {
  yaw: number;
}

const toward = (from: XZ, to: XZ): number => Math.atan2(to.x - from.x, to.z - from.z);
const TREE = { x: 24.0, z: 27.1 };

/** Benches (2 seats each, seats ±0.45 m along the bench), facing the big tree. */
export const BENCHES: readonly Spot[] = [
  { x: 20.4, z: 24.7 },
  { x: 27.6, z: 24.7 },
  { x: 20.4, z: 29.5 },
  { x: 27.6, z: 29.5 },
].map((p) => ({ ...p, yaw: toward(p, TREE) }));

/** Market stalls (≈1.8 × 1.0 m, solid) by the corridor mouth; the stallholder stands behind, facing the yaw. */
export const STALLS: readonly Spot[] = [
  { x: 17.6, z: 23.4, yaw: Math.PI / 2 },
  { x: 17.6, z: 30.8, yaw: Math.PI / 2 },
];

/** A snowman (solid, r 0.5) kids gather around. */
export const SNOWMAN: Spot = { x: 30.0, z: 27.1, yaw: -Math.PI / 2 };

/** People stand around the big tree here (r ≈ 2.3 from it), facing it. */
export const TREE_RING: readonly Spot[] = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2 + 0.3;
  const p = { x: TREE.x + Math.sin(a) * 2.3, z: TREE.z + Math.cos(a) * 2.3 };
  return { ...p, yaw: toward(p, TREE) };
});
