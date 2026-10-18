/**
 * [PURE] Upgrade ladders to level 100 (docs/EXPANSION.md §A). Every read of an upgrade's effect or price goes
 * through here, so the authored tables (config UPGRADES) stay the 0.8.0 truth and the climb only extends them.
 *
 * Levels: GameState.upgrades[id], 0-based, as saved, is also the level the player sees (0.9.5 'literal' gate: every
 * era's own upgrades go Lv 1 → 10, eras/gate.ts). 0.9.10 (READINESS B5): the 0.9.0-0.9.4 'offset' rule, where era n's
 * ids showed stored + 10 · (n − 1), is gone; only core/refund.ts still prices its old levels, for old saves.
 *
 * Up to the authored max m (values.length − 1) valueAt / costAt return the tables unchanged (tests/era1Frozen.test.ts).
 * Past it the effect follows a per-display curve towards a hard cap. Whether levels past m may be bought at all (the
 * climb has started) is the caller's call: capStored(def, climb, age), which stops every upgrade at Lv 10 (R17).
 * 0.9.7: Mastery (points for levels past a hard cap) is gone from play; only the 0.9.6 refund still reads it, for old
 * saves (core/refund.ts legacyMastery).
 */
import { CLIMB, price3, type UpgradeDef } from '../config';

/**
 * The old climb's top level (0.9.0-0.9.4): a legacy clamp for old saves only. Nothing for sale goes past Lv 10 any more
 * (capStored); sanitizeState only keeps levels up to this so the 0.9.6 refund can pay an old save back for them.
 */
export const LEGACY_LEVEL_CAP = 100;

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
      // Strong Arms: +1 item per level up to 50 (render cap stays 40 meshes); the Sled Dog: +1 per level up to 12, so
      // every climb level adds an item (0.9.6: +1 per 2 levels left Lv 5, 7 and 9 dead).
      return def.id === 'carry' || def.id.endsWith('Carry') ? linear(1, 50) : linear(1, 12);
    case 'speed':
      return { dir: 'up', cap: 13.5, at: (vm, t) => 14 - (14 - vm) * 0.93 ** t };
    case 'rate':
      return interval(RATE_FLOOR[def.id] ?? 0.25 * def.values[0]!);
    case 'crew':
      return linear(0.2, 8);
    case 'belt':
      return linear(0.1, 4);
    case 'mult':
      // the five Survival price upgrades past the Great Lodge (every era id is authored to Lv 10): +0.5 a level, so Lv 10
      // pays ×4.5 (0.9.6: +0.1 made the post-Lodge climb the slowest stretch, 129 model minutes; now about 80,
      // CODE_AUDIT P1-9)
      return linear(0.5, null);
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

/** Shown-level offset of an id: 0 for every id since the 'offset' rule went (0.9.10); kept for the gate's readers. */
export function base(_def: UpgradeDef): number {
  return 0;
}

/** Authored max (stored). */
export function authoredMax(def: UpgradeDef): number {
  return def.values.length - 1;
}

/** Stored level as the player sees it (the same number since 0.9.10). */
export function shown(_def: UpgradeDef, stored: number): number {
  return stored;
}

/** Highest stored level a save may hold: the authored max before the climb, then the legacy clamp (old saves). */
export function maxStored(def: UpgradeDef, climb: boolean): number {
  return climb ? LEGACY_LEVEL_CAP : authoredMax(def);
}

/**
 * Highest level for sale (0.9.5, Dino): Lv 10 for every upgrade of every era, for good: each era's own upgrades go
 * 1 → 10 and earlier eras stay at 10.
 */
export function eraCapShown(): number {
  return CLIMB.bandSize;
}

/**
 * Highest stored level for sale now (Upgrades.maxLevel). Every upgrade, machines and crews alike, stops at Lv 10
 * (eraCapShown) once the climb is open. Levels already owned above it (older saves) are kept; the cap only stops new
 * purchases. `age` is the era the player is in (unused since the cap is the same in every era).
 */
export function capStored(def: UpgradeDef, climb: boolean, _age?: number): number {
  // before the climb the authored tables (all below 10 in era 1) are the limit, as in 0.8.0
  if (!climb) return authoredMax(def);
  return eraCapShown();
}

/**
 * Price offset of an id: the band its era's prices start in (10 · (introEra − 1)), whatever the display mode, so an
 * era's upgrades cost what that era earns (Dino, 0.9.5: "the economy needs to scale").
 */
export function priceBase(def: UpgradeDef): number {
  return CLIMB.bandSize * (introEra(def) - 1);
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

/** First stored level whose effect sits at the hard cap (null: uncapped, or not reached by shown LEGACY_LEVEL_CAP). */
export function hardCapStored(def: UpgradeDef): number | null {
  const key = def.id;
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
  return CLIMB.weights[def.group] * CLIMB.unit * CLIMB.bandGrowth ** (b - 2) * (CLIMB.bandTilt[Math.min(b, CLIMB.bandTilt.length - 1)] ?? 1) * (CLIMB.bandStep[Math.min(b, CLIMB.bandStep.length - 1)] ?? CLIMB.stepGrowth) ** j;
}

/**
 * Price of the step from stored level s to s + 1 (the caller checks s < maxStored). Survival ids and jack keep their
 * authored prices, then rise by legacyStep per level, never below the band price once shown level 10 is passed.
 * Ids from era 2 on price every step on the band curve. Always a multiple of 5, strictly rising.
 */
export function costAt(def: UpgradeDef, s: number): number {
  if (introEra(def) >= 2) return price3(bandPrice(def, priceBase(def) + s));
  return legacyCost(def, s);
}

/** The era-1 rule: the authored table, then legacyStep per level, never below the band price from shown level 10. */
function legacyCost(def: UpgradeDef, s: number): number {
  const m = authoredMax(def);
  if (s < m) return def.costs[s]!;
  const legacy = def.costs[m - 1]! * CLIMB.legacyStep ** (s - m + 1);
  return price3(s < CLIMB.bandSize ? legacy : Math.max(legacy, bandPrice(def, s)));
}

/**
 * The price the game charges (Upgrades.nextCost, the gate's costToNeed). The era-2+ ids carry no cost tables (the era
 * economy ×10, docs/EXPANSION.md R11), so this is costAt for every id: the readers keep one name for "what the next
 * level costs".
 */
export function stepCost(def: UpgradeDef, s: number): number {
  return costAt(def, s);
}

