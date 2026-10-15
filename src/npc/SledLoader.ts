/**
 * [Wave 11] Sled Loader: carries chairs from the workshop bench (level.workshop.output) to the dog-sled counter
 * (level.sledCounter.pile) and, when the hopper is low (PRIORITIES.workshopLow), fetches logs for the workshop
 * hopper (level.workshop.input) from the pine deck (level.treeFeller.deck) or else the yard drop zone pile.
 * Home: SLED_LOADER_HOME in crewHelpers.ts. Builder: see the Helper contract (think, go, move, settled).
 */
import type { GameContext } from '../core/types';
import type { Level } from '../level/Level';
import { Helper } from './crewHelpers';

export class SledLoader extends Helper {
  constructor(ctx: GameContext, level: Level, index = 0) {
    super(ctx, level, 'sledLoader', index, ['furniture', 'log']);
  }

  protected think(_dt: number): void {
    // TODO(sled loader builder)
  }
}
