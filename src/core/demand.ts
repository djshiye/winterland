/**
 * [MAIN] Village → demand helpers. Pure functions of GameState and the config tables, so every reader stays live
 * (call them at spawn / pay time; never cache the result).
 */
import { AMENITIES, AMENITY_IDS, BUSINESSES, DEMAND, ECONOMY, HAPPINESS, PRESTIGE, UPGRADES, VILLAGE, type BusinessId, type DemandLevel, type ProductId } from '../config';
import type { GameState } from './types';

/** Buyer behaviour for the current village level. */
export function demandOf(state: GameState): DemandLevel {
  return DEMAND[Math.max(0, Math.min(DEMAND.length - 1, state.village.level))]!;
}

/** Price multiplier from the Sales upgrades for one product (1 when none applies). */
export function productMult(state: GameState, product: ProductId): number {
  let m = 1;
  for (const d of Object.values(UPGRADES)) {
    if (d.group !== 'sales' || d.product !== product) continue;
    m *= d.values[Math.min(state.upgrades[d.id] ?? 0, d.values.length - 1)]!;
  }
  return m;
}

/** Wave 12: town happiness 0..1, the sum of the built amenities' shares (AMENITIES[id].happiness). */
export function townHappiness(state: GameState): number {
  let h = 0;
  for (const id of AMENITY_IDS) if (state.town.amenities[id].tier >= 0) h += AMENITIES[id].happiness;
  return Math.min(1, h);
}

/** Every sale pays up to HAPPINESS.priceBonus more at full happiness (scope: all buyers, village and town alike). */
export function happinessMult(state: GameState): number {
  return 1 + HAPPINESS.priceBonus * townHappiness(state);
}

/** Wave 13: a transient multiplier written by WorldEvents (the aurora); not part of the state, so never saved. */
let transientPriceMult = 1;
export function setTransientPriceMult(m: number): void {
  transientPriceMult = Number.isFinite(m) && m > 0 ? m : 1;
}
export function getTransientPriceMult(): number {
  return transientPriceMult;
}

/** Permanent price bonus from New Seasons (1 in the first season). */
export function seasonMult(state: GameState): number {
  return 1 + PRESTIGE.bonusPerSeason * Math.max(0, state.prestige.season);
}

/**
 * What a buyer pays for `count` items of `product` at `unitPrice` (ECONOMY.plankPrice / cratePrice / truckLogPrice /
 * pinePrice): times the village price multiplier, the product's Sales upgrades and the season bonus, rounded to the
 * nearest whole cash bundle (never below one bundle).
 */
export function salePrice(state: GameState, product: ProductId, unitPrice: number, count: number): number {
  const b = ECONOMY.cashBundleValue;
  const mult = demandOf(state).priceMult * productMult(state, product) * seasonMult(state) * happinessMult(state) * transientPriceMult;
  return Math.max(b, Math.round((unitPrice * count * mult) / b) * b);
}

/**
 * Residents of every built shelter (the Great Lodge houses nobody) + wave 9: the people every built town building
 * brings (jobs at producers / shops, residents of homes; BUSINESSES[id].people). Eras are the village levels, so
 * building up the town is what moves the settlement through them.
 */
export function villagePopulation(state: GameState): number {
  let n = 0;
  for (const p of state.village.plots) if (p.tier >= 0) n += VILLAGE.tiers[p.tier]!.residents;
  for (const lot of state.town.lots) if (lot.tier >= 0 && lot.building !== '') n += BUSINESSES[lot.building as BusinessId].people;
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
