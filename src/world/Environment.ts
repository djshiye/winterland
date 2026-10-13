/**
 * [B3 — world] Static scenery + ambient animation. STUB: replace bodies, keep the public API.
 *
 * Builds (all procedural primitives, toon materials from materials.ts, PALETTE colours, receive
 * shadows; tall props cast shadows; merge/instance repeated props — trees, fence posts, rocks):
 * - Snow ground far beyond the play area (≥ 220×220), with low-poly snow mounds / drifts outside the yard.
 * - Yard ground: warm dirt (PALETTE.yardDirt) for LAYOUT.yard, a few darker dirt patches/tyre marks.
 * - River channel along -X (LAYOUT.river): the yard edge drops to a stone/timber bank lip at
 *   x≈-10.4; water surface at river.waterY with gently animated flow (+Z) — e.g. scrolling stripe
 *   texture or moving foam streaks + drifting ice floes; far bank of snow + pines at x < river.minX.
 * - River gate at LAYOUT.giantLog.gateZ: wooden posts + planks spanning the river (the giant log
 *   rests against it), foam where water passes.
 * - Wooden post-and-rail fences around the yard on the +Z, +X and -Z edges, with GAPS where the
 *   walk-in counter (x -5.7…-2.3 on z=10) and the SE counter (z 1.9…5.3 on x=10) sit. Keep the -Z
 *   fence as its own group so expand() can remove it.
 * - Customer path: fenced snow path (LAYOUT.customers.path) leading out from the walk-in counter.
 * - Tricycle road (LAYOUT.tricycles.road): packed-snow road with tyre ruts, snow banks either side.
 * - Highway (LAYOUT.highway) along X: asphalt with dashed yellow centre line, snow banks, a simple
 *   bridge where it crosses the river, entering a tunnel portal (LAYOUT.tunnel) in a rocky mountain
 *   spur; big low-poly snow-capped mountain range behind it (z < LAYOUT.mountains.z).
 * - Pine trees (stacked cones with snow caps), rocks, stumps scattered OUTSIDE the yard and off
 *   roads/paths/river; denser toward the edges of the world. A few in the -Z expansion strip
 *   (z ∈ [expandedMinZ, -10]) that expand() clears with puffs.
 * - Cosy log cabin at LAYOUT.cabin (register its collider), smoking chimney (soft puffs), a couple of
 *   lamp posts and a "WINTERLAND LUMBER CO." sign near the walk-in counter — off all paths in config.
 * - Gentle snowfall around the camera target (THREE.Points or instanced flakes, cheap).
 * Also: ctx.colliders.setBounds(LAYOUT.yard) and colliders for any solid decor inside the yard.
 */
import type { GameContext } from '../core/types';
import { LAYOUT } from '../config';

export class Environment {
  readonly waterY = LAYOUT.river.waterY;

  constructor(readonly ctx: GameContext) {
    ctx.colliders.setBounds(LAYOUT.yard);
  }

  update(_dt: number): void {}

  /**
   * Phase 5: grow the yard north (-Z) to LAYOUT.expandedMinZ over ~1.5 s — remove the -Z fence
   * (pop out), clear decor in the strip with puffs, extend the dirt ground, build the new fence at
   * the new edge with a gap for the truck counter (x -0.7…2.7), and update collider bounds.
   */
  expand(): void {}
}
