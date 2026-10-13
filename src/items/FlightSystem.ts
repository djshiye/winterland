/**
 * [B2 — items] Parabolic item flights. STUB: replace bodies, keep the public API.
 *
 * - Every item movement between holders flies along a fast parabola: horizontal linear in t,
 *   vertical + 4·h·t·(1−t) (see math.arcPoint). Default duration TIMING.arcTime (0.15 s, spec),
 *   default height TIMING.arcHeight (may grow slightly with distance).
 * - The destination is re-evaluated EVERY frame via to.getSlotWorldPosition(slot) so items land
 *   correctly on moving holders (player stack, NPCs, vehicles).
 * - Orientation slerps from launch orientation to to.getSlotWorldQuaternion(slot); optional `spin`
 *   adds whole turns around a random horizontal axis (nice for chopped logs).
 * - Optional scaleFrom: item scales from that value to 1 during the flight.
 * - Arrival: to.receive(item, slot); emit 'item:landed' { item, holder: to, position }; then
 *   opts.onLand?.(item). No per-frame allocations (reuse temp vectors).
 */
import type { GameContext, Item, ItemHolder, Slot } from '../core/types';

export interface FlightOptions {
  /** Seconds (default TIMING.arcTime). */
  duration?: number;
  /** Apex height above the straight line (default TIMING.arcHeight). */
  arcHeight?: number;
  /** Extra full rotations during the flight (default 0). */
  spin?: number;
  /** Scale at launch, tweened to 1 on arrival (default: keep current scale). */
  scaleFrom?: number;
  onLand?: (item: Item) => void;
}

export class FlightSystem {
  constructor(readonly ctx: GameContext) {}

  launch(item: Item, to: ItemHolder, slot: Slot, opts?: FlightOptions): void {
    to.receive(item, slot);
    opts?.onLand?.(item);
  }

  get activeCount(): number {
    return 0;
  }

  update(_dt: number): void {}
}
