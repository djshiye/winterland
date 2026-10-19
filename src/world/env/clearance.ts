/**
 * [0.9.12] Fence clearance (audit C2): no prop's footprint may come within FENCE_CLEAR metres of a region's fence line or
 * its gate opening, so trees, cranes and cacti never poke through the rails. Pure: world rects in, a boolean out. Every
 * placement function that puts a prop near a region edge (tree belts, harvest dressing, era landmarks) asks this.
 */
import type { Rect } from '../../config';

/** Metres of clear ground between a prop's footprint circle and the fence line. */
export const FENCE_CLEAR = 1.2;

/** The slice of RegionLayout this needs (so the test and the kits need not build the whole layout). */
export interface FenceFrame {
  rect: Rect;
  gate: { x: number; z: number; width: number };
  marketGate: { x: number; z: number; width: number };
}

/**
 * Clear metres between a footprint circle (centre x, z, radius rad) and the nearest fence line of the region rect, a
 * line being only as long as the rect side. The gate and market gate openings sit in the gate-edge line, so keeping
 * clear of that line keeps clear of them too. Infinite when the footprint is far from every line.
 */
export function fenceGap(f: FenceFrame, x: number, z: number, rad: number): number {
  const r = f.rect;
  let gap = Infinity;
  // the two Z-running sides (x = minX, maxX) and the two X-running sides (z = minZ, maxZ)
  if (z > r.minZ - rad && z < r.maxZ + rad) gap = Math.min(gap, Math.abs(x - r.minX) - rad, Math.abs(x - r.maxX) - rad);
  if (x > r.minX - rad && x < r.maxX + rad) gap = Math.min(gap, Math.abs(z - r.minZ) - rad, Math.abs(z - r.maxZ) - rad);
  return gap;
}

/** True when a footprint of radius rad at (x, z) keeps `margin` metres off the region's fence line and gate openings. */
export function clearOfFence(f: FenceFrame, x: number, z: number, rad: number, margin = FENCE_CLEAR): boolean {
  return fenceGap(f, x, z, rad) >= margin;
}
