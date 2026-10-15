/**
 * [STUB — city builder replaces the body, keeps the public API] 0.9.0 city districts east of the Market Town: one per
 * era (eras/data.ts DISTRICTS), lots chosen through 'choose:open' and paid on construction pads (cash + the era's
 * refined material), demolished through 'manage:open'; population, happiness, rank (CITY_RANKS) and income (rent +
 * staffed businesses, credited every CITY_TICK as 'income'); an instanced skyline that grows with the population.
 */
import type { GameContext } from '../core/types';

export class City {
  constructor(protected readonly ctx: GameContext) {}

  /** Residents of every district (not counting the village / Market Town). */
  get population(): number {
    return 0;
  }

  /** Whole settlement: village + Market Town + districts. */
  get totalPopulation(): number {
    return this.ctx.state.village.population + this.population;
  }

  /** Index into CITY_RANKS. */
  get rank(): number {
    return 0;
  }

  /** City income per second right now (rent + staffed businesses, × happiness × City Hall). */
  get incomeRate(): number {
    return 0;
  }

  update(_dt: number): void {}
}
