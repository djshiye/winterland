/**
 * [Wave 11] Foreman: the auto-builder. Picks the next construction that needs logs or cash, nearest first, among the
 * village plots (level.village.padSpot(i)), the town lots with a chosen building (level.town.padSpot(i)) and the crew
 * quarters (level.quarters?.padSpot()). NEVER the Great Lodge (the finale stays the player's press). Hauls logs from
 * the drop zone pile (or the pine deck when it is nearer) into the pad with move(), and pays cash in chunks with
 * ConstructionPad.payDirect() while the wallet keeps PRIORITIES.reserveShare / reserveMin. Home: FOREMAN_HOME.
 */
import type { GameContext } from '../core/types';
import type { Level } from '../level/Level';
import { Helper } from './crewHelpers';

export class Foreman extends Helper {
  constructor(ctx: GameContext, level: Level, index = 0) {
    super(ctx, level, 'foreman', index, ['log']);
  }

  protected think(_dt: number): void {
    // TODO(foreman builder)
  }
}
