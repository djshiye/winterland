/**
 * [MAIN] Village → demand helpers. Pure functions of GameState and the config tables, so every reader stays live
 * (call them at spawn / pay time; never cache the result).
 */
import { DEMAND, ECONOMY, VILLAGE, type DemandLevel } from '../config';
import type { GameState } from './types';

/** Buyer behaviour for the current village level. */
export function demandOf(state: GameState): DemandLevel {
  return DEMAND[Math.max(0, Math.min(DEMAND.length - 1, state.village.level))]!;
}

/**
 * What a buyer pays for `count` items at `unitPrice` (ECONOMY.plankPrice / cratePrice / truckLogPrice): times the
 * village price multiplier, rounded to the nearest whole cash bundle (never below one bundle).
 */
export function salePrice(state: GameState, unitPrice: number, count: number): number {
  const b = ECONOMY.cashBundleValue;
  return Math.max(b, Math.round((unitPrice * count * demandOf(state).priceMult) / b) * b);
}

/** Residents of every built shelter (the Great Lodge houses nobody). */
export function villagePopulation(state: GameState): number {
  let n = 0;
  for (const p of state.village.plots) if (p.tier >= 0) n += VILLAGE.tiers[p.tier]!.residents;
  return n;
}

/** Village level for a population; the finale level (Winterland) only once the Great Lodge stands. */
export function villageLevelFor(population: number, greatLodgeBuilt: boolean): number {
  const levels = VILLAGE.levels;
  if (greatLodgeBuilt) return levels.length - 1;
  let level = 0;
  for (let i = 0; i < levels.length - 1; i++) if (population >= levels[i]!.minPopulation) level = i;
  return level;
}
