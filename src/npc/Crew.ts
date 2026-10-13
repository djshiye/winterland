/**
 * [B5 — commerce/NPC] Hired helpers ('worker' characters) that automate the manual loops.
 *
 * CONTRACT (keep every public signature; B5 owns the implementation):
 * - A helper exists for every crew upgrade with level ≥ 1 (ctx.upgrades.isHired). The constructor spawns the
 *   already-hired ones AT ONCE at their posts, silently (restored save). On 'upgrade:bought' for a crew id at
 *   level 1, the helper walks out of the cabin door (LAYOUT.shop.door) and 'helper:hired' is emitted.
 * - Work speed / capacity = CREW[id] base × ctx.upgrades.value(id), read live (levels apply at once).
 * - crateRunner: processor output (bench) → SE counter. cashier: every cash pile → the cabin door, where the
 *   bundles fly in and their value is added to the money. logHauler: drop zone → truck counter (or the walk-in
 *   counter when the trucks are full). Scripted waypoint routes, no colliders; all moves via items/transfer.ts.
 *
 * STUB (main session): no helpers yet.
 */
import type { GameContext } from '../core/types';
import type { Level } from '../level/Level';

export class Crew {
  constructor(
    readonly ctx: GameContext,
    readonly level: Level,
  ) {}

  /** Helpers currently in the world. */
  get size(): number {
    return 0;
  }

  update(_dt: number): void {}
}
