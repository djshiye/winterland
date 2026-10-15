/**
 * [STUB — eras builder replaces the body, keeps the public API] 0.9.0 era regions at runtime: expansion pads (cash +
 * material) that unlock eras, machine slots (choose → construction pad → Machine), the export depot and import dock,
 * the era shop mat, Jack's cart and the era crew per unlocked region. Built once by Level from state (a restored game
 * builds everything instantly and silently, like Village / Town).
 */
import type { GameContext } from '../core/types';
import type { WorldSnapshot } from '../core/Save';
import type { RegionRuntime } from './runtime';

export class EraWorld {
  constructor(protected readonly ctx: GameContext) {}

  /** Region runtime for era n, or null while locked. */
  region(_n: number): RegionRuntime | null {
    return null;
  }

  update(_dt: number): void {}

  /** World snapshot of every region (machine piles + import docks; items carried by workers go back to their dock). */
  snapshot(): WorldSnapshot['eras'] {
    return [];
  }

  /** Refill piles from a save (after construction). */
  restore(_snap: WorldSnapshot['eras']): void {}
}
