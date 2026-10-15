/**
 * Era 1 below the Great Lodge must play exactly like 0.8.0 (docs/EXPANSION.md §F). The tables are checked against
 * tests/fixtures/era1-0.8.0.json, dumped once from the v0.8.0 tag (jack from 0.9.0): the config, the ladder
 * (core/ladder.ts with the climb closed), Upgrades.describe and productMult must all reproduce it.
 */
import { describe, expect, it } from 'vitest';
import { DEMAND, QUARTERS, UPGRADES, VILLAGE, type UpgradeDef } from '../src/config';
import { productMult, renownMult, settlementLevel, settlementLevelFor } from '../src/core/demand';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { base, costAt, introEra, masteryMult, masteryPoints, maxStored, valueAt } from '../src/core/ladder';
import { createGameState, type GameEvents, type UpgradeId } from '../src/core/types';
import { Upgrades } from '../src/core/Upgrades';
import FROZEN from './fixtures/era1-0.8.0.json';

interface FrozenUpgrade {
  values: number[];
  costs: number[];
  maxLevel: number;
  describe: string[];
  productMult?: number[];
}

const frozen = FROZEN.upgrades as Record<string, FrozenUpgrade>;
/** The fixture stores Infinity as "Infinity"; compare the live tables in the same form. */
const asJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (x === Infinity ? 'Infinity' : x)));

describe('era 1 is frozen at 0.8.0', () => {
  it('the era-1 upgrade ids are exactly the 22 Survival ids + jack', () => {
    const era1 = (Object.values(UPGRADES) as UpgradeDef[]).filter((d) => introEra(d) === 1).map((d) => d.id);
    expect(era1.sort()).toEqual(Object.keys(frozen).sort());
  });

  const state = createGameState();
  const events = new EventBus<GameEvents>();
  const up = new Upgrades(state, new Economy(events, state), events);

  for (const [id, f] of Object.entries(frozen)) {
    it(`${id}: values, costs, max level, effect text and sale multiplier`, () => {
      const d = UPGRADES[id as UpgradeId];
      expect(d.values).toEqual(f.values);
      expect(d.costs).toEqual(f.costs);
      expect(base(d)).toBe(0);
      expect(maxStored(d, false)).toBe(f.maxLevel);
      expect(up.maxLevel(id as UpgradeId)).toBe(f.maxLevel);
      f.values.forEach((v, l) => {
        expect(valueAt(d, l)).toBe(v);
        expect(up.describe(id as UpgradeId, l)).toBe(f.describe[l]);
        expect(masteryPoints(d, l)).toBe(0);
      });
      f.costs.forEach((c, l) => expect(costAt(d, l)).toBe(c));
      if (f.productMult) {
        f.productMult.forEach((m, l) => {
          const s = createGameState();
          s.upgrades[id as UpgradeId] = l;
          expect(productMult(s, d.product!)).toBe(m);
        });
      }
    });
  }

  it('DEMAND, VILLAGE and QUARTERS', () => {
    expect(asJson(DEMAND)).toEqual(FROZEN.DEMAND);
    expect(asJson(VILLAGE)).toEqual(FROZEN.VILLAGE);
    expect(asJson(QUARTERS)).toEqual(FROZEN.QUARTERS);
  });

  it('no Mastery before the climb', () => {
    expect(masteryMult(0)).toBe(1);
  });

  it('age 1: settlement never passes 5 and Renown is 1 at every village level', () => {
    for (let lvl = 0; lvl < VILLAGE.levels.length; lvl++) {
      const s = createGameState();
      s.village.level = lvl;
      if (lvl === VILLAGE.levels.length - 1) s.village.greatLodge.tier = 0;
      expect(settlementLevel(s)).toBe(lvl);
      expect(settlementLevel(s)).toBeLessThanOrEqual(5);
      expect(renownMult(s)).toBe(1);
    }
    expect(settlementLevelFor(Number.MAX_SAFE_INTEGER, 1)).toBe(0);
  });
});
