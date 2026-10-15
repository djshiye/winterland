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

  /**
   * Open era n now (the expansion pad completed, or debug): state.eras.age = max(age, n), build the region, emit
   * 'era:unlocked' (instant: no camera / effects, used for restores and debug).
   */
  unlock(_n: number, _instant = false): void {}

  /**
   * Debug / tests: put machine `id` on slot `slot` of era n, fully built (instant: no effects). False when the region is
   * locked, the slot is out of range or the machine is from another era.
   */
  build(_n: number, _slot: number, _id: string, _instant = true): boolean {
    return false;
  }

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
