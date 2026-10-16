/**
 * [MAIN] Village → demand helpers. Pure functions of GameState and the config tables, so every reader stays live
 * (call them at spawn / pay time; never cache the result).
 */
import { AMENITIES, AMENITY_IDS, BUSINESSES, DEMAND, ECONOMY, HAPPINESS, PRESTIGE, SETTLEMENT, UPGRADES, VILLAGE, type BusinessId, type DemandLevel, type ProductId } from '../config';
import { CITY_BUILDINGS, DISTRICTS, INVEST_MAX_POSITIONS, MAX_ERA, REGIONS } from '../eras/data';
import { cityTotals, type CityTotals } from '../city/rules';
import { masteryMult, masteryPoints, valueAt } from './ladder';
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
    m *= valueAt(d, state.upgrades[d.id] ?? 0);
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
 * pinePrice): times the village price multiplier, the product's Sales upgrades, the season bonus and the climb's Renown ×
 * Mastery (climbMult: 1 until settlement 6 and the first capped level, so era 1 pays exactly as before), rounded to the
 * nearest whole cash bundle (never below one bundle).
 */
export function salePrice(state: GameState, product: ProductId, unitPrice: number, count: number): number {
  const b = ECONOMY.cashBundleValue;
  const mult = demandOf(state).priceMult * productMult(state, product) * seasonMult(state) * happinessMult(state) * transientPriceMult * climbMult(state);
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

// ---------------------------------------------------------------------------
// Settlement levels 6..50 (docs/EXPANSION.md §B, config SETTLEMENT)
// ---------------------------------------------------------------------------

/** Region staff per built machine of era n (¼ of an era-n home): 10, 22, 48, 106 … */
export function machineStaff(n: number): number {
  return Math.round(SETTLEMENT.staffBase * SETTLEMENT.staffGrowth ** (n - 2));
}

/** Built machines in era n's region. */
export function builtMachines(state: Pick<GameState, 'eras'>, n: number): number {
  const r = state.eras.regions[n];
  return r ? r.slots.filter((x) => x.machine !== '' && x.tier >= 0).length : 0;
}

/** City population: district residents + region machine staff (the village and Market Town do not count, R9). */
export function cityPopulation(state: Pick<GameState, 'city' | 'eras'>): number {
  let n = cityTotals(state.city).residents;
  for (let e = 2; e <= MAX_ERA; e++) n += builtMachines(state, e) * machineStaff(e);
  return n;
}

/** Round to 2 significant figures (the threshold table reads 36 · 72 · … 230 · 290 · … 11k · 13k). */
const sig2 = (v: number): number => {
  if (v <= 0) return 0;
  const mag = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Math.round(v / mag) * mag;
};

/**
 * Settlement anchors A_k for k = 2..MAX_ERA (index = era; 0 and 1 are 0): anchorShare × the cumulative city capacity
 * through era k, where district k has (lots − 2) homes + one work building + one landmark and every region slot holds
 * a staffed machine. `slots(n)` is the slot count of region n (default REGIONS; the tests pass the 0.10 counts).
 */
export function settlementAnchors(slots: (n: number) => number = (n) => REGIONS[n]?.slots ?? 0): number[] {
  const out = [0, 0];
  let cap = 0;
  for (let k = 2; k <= MAX_ERA; k++) {
    const lots = DISTRICTS[k]?.lots ?? 0;
    const home = Object.values(CITY_BUILDINGS).find((d) => d.era === k && d.kind === 'home')?.people ?? 0;
    cap += Math.max(0, lots - 2) * home + slots(k) * machineStaff(k);
    out.push(sig2(SETTLEMENT.anchorShare * cap));
  }
  return out;
}

/**
 * City population each settlement level needs (index = level; levels below 6 are 0). Band 2 rises linearly from 0
 * (j · A₂ / 5), later bands geometrically from A_{k−1} to A_k, so each step is about one home of that era.
 */
export function settlementThresholds(anchors: readonly number[] = settlementAnchors()): number[] {
  const B = SETTLEMENT.band;
  const out = Array.from({ length: B + 1 }, () => 0);
  for (let k = 2; k <= MAX_ERA; k++) {
    const lo = anchors[k - 1]!;
    const hi = anchors[k]!;
    for (let j = 1; j <= B; j++) out.push(j === B ? hi : k === 2 ? Math.round((j * hi) / B) : sig2(lo * (hi / lo) ** (j / B)));
  }
  return out;
}

const THRESHOLDS = settlementThresholds();

/** City population settlement level `level` (6..50) needs, or null outside that range. */
export function settlementPop(level: number): number | null {
  return level > SETTLEMENT.band && level <= SETTLEMENT.max ? THRESHOLDS[level] ?? null : null;
}

/** The era band a settlement level belongs to (level 6..10 → 2, …); 1 for the village levels 0..5. */
export function settlementBand(level: number): number {
  return Math.max(1, Math.ceil(level / SETTLEMENT.band));
}

/** Highest settlement level ≥ 6 a city population reaches at this age (level 5(k − 1) + j needs age ≥ k), or 0. */
export function settlementLevelFor(cityPop: number, age: number): number {
  const top = Math.min(SETTLEMENT.max, SETTLEMENT.band * age);
  let level = 0;
  for (let L = SETTLEMENT.band + 1; L <= top; L++) {
    if (cityPop >= THRESHOLDS[L]!) level = L;
    else break;
  }
  return level;
}

/**
 * The settlement level: the village level (0..5) until Winterland, then the best level ever reached
 * (state.eras.settlement, never below 5). Era 1 therefore never passes 5.
 */
export function settlementLevel(state: Pick<GameState, 'village' | 'eras'>): number {
  return state.village.level < SETTLEMENT.band ? state.village.level : Math.max(SETTLEMENT.band, state.eras.settlement);
}

/**
 * Raise the saved best-ever level to what the city reaches now (after a build, a demolish, an era or a load; it never
 * goes down). Returns the saved value.
 */
export function refreshSettlement(state: Pick<GameState, 'city' | 'eras'>): number {
  const e = state.eras;
  e.settlement = Math.max(e.settlement, settlementLevelFor(cityPopulation(state), e.age));
  return e.settlement;
}

/** "Brick Town" for a level 6..50; the village level name for 0..5. */
export function settlementName(level: number): string {
  if (level <= SETTLEMENT.band) return VILLAGE.levels[Math.max(0, Math.min(VILLAGE.levels.length - 1, level))]!.name;
  return SETTLEMENT.names[Math.min(SETTLEMENT.max, level) - SETTLEMENT.band - 1] ?? '';
}

/**
 * Renown: × SETTLEMENT.renown per level past Winterland (sales, exports, city income), and × founder.renown from the
 * Founder's Scarf level on; exactly 1 below level 6.
 */
export function renownMult(state: Pick<GameState, 'village' | 'eras'>): number {
  return renownAt(settlementLevel(state));
}

/** Renown at a settlement level (renownMult; the settlement card's "Renown ×1.32"). */
export function renownAt(level: number): number {
  const over = level - SETTLEMENT.band;
  if (over <= 0) return 1;
  return SETTLEMENT.renown ** over * (founderScarf(level) ? SETTLEMENT.founder.renown : 1);
}

/** The Settlement 20 perk (SETTLEMENT.founder): the Founder's Scarf and its Renown bonus. */
export function founderScarf(level: number): boolean {
  return level >= SETTLEMENT.founder.level;
}

/**
 * Mastery points (docs/EXPANSION.md §A1): one per level bought while an upgrade's effect already sat at its hard cap,
 * summed over every upgrade. 0 before the climb: no authored table reaches a cap (core/ladder.ts hardCapStored).
 */
export function masteryTotal(state: Pick<GameState, 'upgrades'>): number {
  let points = 0;
  for (const d of Object.values(UPGRADES)) points += masteryPoints(d, state.upgrades[d.id] ?? 0);
  return points;
}

/**
 * Mastery: the bounded, logarithmic multiplier of masteryTotal (exactly 1 with no points), or the bonus an older save
 * keeps for good (state.legacy, frozen by the 0.9.6 Lv 10 refund in core/Save.ts), whichever is higher.
 */
export function masteryOf(state: Pick<GameState, 'upgrades'> & { legacy?: GameState['legacy'] }): number {
  return Math.max(masteryMult(masteryTotal(state)), state.legacy?.masteryMult ?? 1);
}

/**
 * What the climb adds to every sale, export and city income: Renown × Mastery. Exactly 1 in era 1 (settlement ≤ 5, no
 * level past a cap), so 0.8.0 prices are untouched.
 */
export function climbMult(state: Pick<GameState, 'village' | 'eras' | 'upgrades'> & { legacy?: GameState['legacy'] }): number {
  return renownMult(state) * masteryOf(state);
}

/** How many era bands a level has reached band position `j` in (level ≥ 5(k − 1) + j for k = 2..MAX_ERA). */
export function bandsWith(level: number, j: number): number {
  let n = 0;
  for (let k = 2; k <= MAX_ERA; k++) if (level >= SETTLEMENT.band * (k - 1) + j) n++;
  return n;
}

/** Perk j = 3: city happiness from the district decor of every band reached (added before the cap of 1). */
export function settlementHappiness(state: Pick<GameState, 'village' | 'eras'>): number {
  return SETTLEMENT.decorHappiness * bandsWith(settlementLevel(state), 3);
}

/** City totals with the j = 3 decor happiness added (still capped at 1): what city income and its panels read. */
export function settledCityTotals(state: Pick<GameState, 'city' | 'village' | 'eras'>): CityTotals {
  const t = cityTotals(state.city);
  t.happiness = Math.min(1, t.happiness + settlementHappiness(state));
  return t;
}

/** Most investment positions open at once: INVEST_MAX_POSITIONS + one per band whose j = 4 perk is reached. */
export function investMaxPositions(state: Pick<GameState, 'village' | 'eras'>): number {
  return INVEST_MAX_POSITIONS + SETTLEMENT.investPerBand * bandsWith(settlementLevel(state), 4);
}

/** Positions a save may ever hold (every band's j = 4 perk). */
export const INVEST_POSITIONS_CAP = INVEST_MAX_POSITIONS + SETTLEMENT.investPerBand * (MAX_ERA - 1);
