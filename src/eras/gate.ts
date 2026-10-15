/**
 * [PURE] The era gate (docs/EXPANSION.md §C). No THREE, no GameContext.
 *
 * The climb (upgrade levels past their authored max, the era checklist, the new land) opens with the Great Lodge,
 * the point where 0.8.0 shows its finale. Below it era 1 plays exactly like 0.8.0 (R1).
 */
import type { GameState } from '../core/types';

/** The Great Lodge is built: upgrade ladders run past their authored max towards shown level 100. */
export function climbOpen(s: GameState): boolean {
  return s.village.greatLodge.tier >= 0;
}
