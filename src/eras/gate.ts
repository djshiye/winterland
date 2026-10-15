/**
 * [PURE] The era gate (docs/EXPANSION.md §C). No THREE, no GameContext.
 *
 * The climb (upgrade levels past their authored max, the era checklist, the new land) opens with the Great Lodge,
 * the point where 0.8.0 shows its finale. Below it era 1 plays exactly like 0.8.0 (R1).
 */

/** The slice of the game state `climbOpen` reads (the frontier tests pass a plain object). */
export interface ClimbState {
  village: { greatLodge: { tier: number } };
}

/**
 * The Great Lodge is built: upgrade ladders run past their authored max towards shown level 100, and the new land,
 * its roads and the era-2 pad show (R2; 0.9 used to reveal them at Winter City).
 */
export function climbOpen(s: ClimbState): boolean {
  return s.village.greatLodge.tier >= 0;
}
