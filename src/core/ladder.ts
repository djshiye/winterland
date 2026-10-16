/**
 * [PURE] Upgrade ladders to level 100 (docs/EXPANSION.md §A). Every read of an upgrade's effect or price goes
 * through here, so the authored tables (config UPGRADES) stay the 0.8.0 truth and the climb only extends them.
 *
 * Two level numbers:
 * - stored: GameState.upgrades[id], 0-based, as saved.
 * - shown: stored + base(def), base = 10 · (introEra − 1) in GATE mode 'offset' (0 in 'literal'). Era n's gate needs
 *   every owned upgrade at shown level 10 · (n − 1).
 *
 * Up to the authored max m (values.length − 1) valueAt / costAt return the tables unchanged (tests/era1Frozen.test.ts).
 * Past it the effect follows a per-display curve towards a hard cap, after which further levels earn Mastery points.
 * Whether levels past m may be bought at all (the climb has started) is the caller's call: maxStored(def, climb).
 */
import { CLIMB, GATE, price3, type UpgradeDef } from '../config';

/** Highest shown level; the era-10 finale has everything here. */
export const LEVEL_CAP = CLIMB.levelCap;

/**
 * Effect past the authored max: value = curve(vₘ, t) with t = stored − m, clamped at `cap` (null = uncapped).
 * 'up' curves rise towards the cap, 'down' curves (machine intervals) fall towards it.
 */
interface Curve {
  dir: 'up' | 'down';
  cap: number | null;
  at: (vm: number, t: number) => number;
}

const linear = (step: number, cap: number | null): Curve => ({ dir: 'up', cap, at: (vm, t) => vm + step * t });
const interval = (floor: number): Curve => ({ dir: 'down', cap: floor, at: (im, t) => im * 0.96 ** t });

/** Interval floors (s): the belt limit 6.5 items/s, the 40 s pine regrow, the tube and joinery animations. */
const RATE_FLOOR: Partial<Record<string, number>> = {
  axe: 0.06,
  harvester: 0.154,
  processor: 0.154,
  megaSaw: 0.46,
  treeFeller: 2.0,
  cashTubes: 0.08,
  workshop: 0.4,
};

function curveOf(def: UpgradeDef): Curve {
  switch (def.display) {
    case 'count':
      // Strong Arms: +1 item per level up to 50 (render cap stays 40 meshes); dog and pals: +1 per 2 levels up to 12.
      return def.id === 'carry' ? linear(1, 50) : { dir: 'up', cap: 12, at: (vm, t) => vm + Math.floor(t / 2) };
    case 'speed':
      return { dir: 'up', cap: 13.5, at: (vm, t) => 14 - (14 - vm) * 0.93 ** t };
    case 'rate':
      return interval(RATE_FLOOR[def.id] ?? 0.25 * def.values[0]!);
    case 'crew':
      return linear(0.2, 8);
    case 'mult':
      return linear(0.1, null);
    case 'boost':
      return linear(0.1, 6);
    case 'income':
      return linear(0.12, null);
    case 'factor':
      return linear(0.15, 10);
    case 'share':
      // Jack pays share × value with no Trade, orders cost ≥ 1.1 × value: any share below 1 can never loop money.
      return linear(0.01, 0.9);
  }
}

/** Era the upgrade arrives in: Survival ids and jack 1, taxOffice / broker 2, era ids their own era. */
export function introEra(def: UpgradeDef): number {
  return def.era ?? def.requires?.era ?? 1;
}

/** Shown-level offset of an id (0 for every era-1 id, and for every id in 'literal' mode). */
export function base(def: UpgradeDef, mode: 'offset' | 'literal' = GATE.mode): number {
  return mode === 'literal' ? 0 : CLIMB.bandSize * (introEra(def) - 1);
}

/** Authored max (stored). */
export function authoredMax(def: UpgradeDef): number {
  return def.values.length - 1;
}

/** Stored level as the player sees it. */
export function shown(def: UpgradeDef, stored: number, mode: 'offset' | 'literal' = GATE.mode): number {
  return stored + base(def, mode);
}

/** Highest stored level: the authored max before the climb, then whatever reaches shown LEVEL_CAP. */
export function maxStored(def: UpgradeDef, climb: boolean, mode: 'offset' | 'literal' = GATE.mode): number {
  return climb ? LEVEL_CAP - base(def, mode) : authoredMax(def);
}

/** Highest shown level for sale while `age` is the highest era reached: the next gate's need, 10 · age (100 in era 10). */
export function eraCapShown(age: number): number {
  return Math.min(LEVEL_CAP, CLIMB.bandSize * Math.max(1, Math.floor(age)));
}

/**
 * Highest stored level for sale now (Upgrades.maxLevel). Every upgrade, machines and crews alike, stops at the era cap
 * (shown 10 · age) until the next era's expansion is bought: era 1 caps at shown level 10, era 2 at 20, and so on.
 * Levels already owned above it (older saves) are kept; the cap only stops new purchases.
 */
export function capStored(def: UpgradeDef, climb: boolean, age: number, mode: 'offset' | 'literal' = GATE.mode): number {
  // before the climb the authored tables (all below shown 10 in era 1) are the limit, as in 0.8.0
  if (!climb) return authoredMax(def);
  return Math.max(0, Math.min(maxStored(def, true, mode), eraCapShown(age) - base(def, mode)));
}

/** At the era cap but not at the final level: the next era's expansion lifts it. */
export function atEraCap(def: UpgradeDef, stored: number, age: number, mode: 'offset' | 'literal' = GATE.mode): boolean {
  return stored >= eraCapShown(age) - base(def, mode) && stored < maxStored(def, true, mode);
}

/** Uncapped curve value at stored level s > m (float noise trimmed so describe() never prints 3.4000000000000004). */
function rawPast(def: UpgradeDef, c: Curve, s: number): number {
  const m = authoredMax(def);
  return Math.round(c.at(def.values[m]!, s - m) * 1e6) / 1e6;
}

const atCap = (c: Curve, v: number): boolean => c.cap !== null && (c.dir === 'up' ? v >= c.cap - 1e-9 : v <= c.cap + 1e-9);

/** Effect at stored level s (see UpgradeDef.values): the table up to the authored max, then the curve to its cap. */
export function valueAt(def: UpgradeDef, s: number): number {
  const m = authoredMax(def);
  if (s <= m) return def.values[Math.max(0, s)]!;
  const c = curveOf(def);
  const v = rawPast(def, c, s);
  return atCap(c, v) ? c.cap! : v;
}

const capCache = new Map<string, number | null>();

/** First stored level whose effect sits at the hard cap (null: uncapped, or not reached by shown LEVEL_CAP). */
export function hardCapStored(def: UpgradeDef): number | null {
  const key = `${def.id}:${GATE.mode}`;
  const hit = capCache.get(key);
  if (hit !== undefined) return hit;
  const c = curveOf(def);
  let out: number | null = null;
  if (c.cap !== null) {
    for (let s = authoredMax(def) + 1, top = maxStored(def, true); s <= top; s++) {
      if (atCap(c, rawPast(def, c, s))) {
        out = s;
        break;
      }
    }
  }
  capCache.set(key, out);
  return out;
}

/** The climb's base price of the step from shown level A to A + 1 (unrounded). */
function bandPrice(def: UpgradeDef, A: number): number {
  const b = Math.floor(A / CLIMB.bandSize) + 1;
  const j = A % CLIMB.bandSize;
  return CLIMB.weights[def.group] * CLIMB.unit * CLIMB.bandGrowth ** (b - 2) * (CLIMB.bandTilt[b] ?? 1) * CLIMB.stepGrowth ** j;
}

/**
 * Price of the step from stored level s to s + 1 (the caller checks s < maxStored). Survival ids and jack keep their
 * authored prices, then rise by legacyStep per level, never below the band price once shown level 10 is passed.
 * Ids from era 2 on price every step on the band curve. Always a multiple of 5, strictly rising.
 */
export function costAt(def: UpgradeDef, s: number): number {
  if (introEra(def) >= 2) return price3(bandPrice(def, base(def) + s));
  return legacyCost(def, s);
}

/** The era-1 rule: the authored table, then legacyStep per level, never below the band price from shown level 10. */
function legacyCost(def: UpgradeDef, s: number): number {
  const m = authoredMax(def);
  const A = base(def) + s;
  if (s < m) return def.costs[s]!;
  const legacy = def.costs[m - 1]! * CLIMB.legacyStep ** (s - m + 1);
  return price3(A < CLIMB.bandSize ? legacy : Math.max(legacy, bandPrice(def, A)));
}

/**
 * The price the game charges (Upgrades.nextCost, the gate's costToNeed). The era-2+ ids carry no cost tables (the era
 * economy ×10, docs/EXPANSION.md R11), so this is costAt for every id: the readers keep one name for "what the next
 * level costs".
 */
export function stepCost(def: UpgradeDef, s: number): number {
  return costAt(def, s);
}

/** Mastery points from one upgrade at stored level s: the levels bought while its effect was already at the cap. */
export function masteryPoints(def: UpgradeDef, s: number): number {
  const hc = hardCapStored(def);
  return hc === null ? 0 : Math.max(0, s - hc);
}

/** Price multiplier from the total Mastery points: bounded and logarithmic (1 with no points). */
export function masteryMult(points: number): number {
  return 1 + CLIMB.masteryScale * Math.log2(1 + Math.max(0, points) / CLIMB.masteryPoints);
}
