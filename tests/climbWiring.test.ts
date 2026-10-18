/**
 * The ladder wired into the game (docs/EXPANSION.md order, step 2): Upgrades, productMult, the Save clamp and
 * crewStats read core/ladder.ts; levels past the authored max are for sale only once the climb is open (the Great
 * Lodge). Era 1 below the Lodge stays 0.8.0 (tests/era1Frozen.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { CLIMB, GATE, UPGRADES, type UpgradeDef } from '../src/config';
import { productMult } from '../src/core/demand';
import { Market } from '../src/core/Market';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { authoredMax, costAt, introEra, LEGACY_LEVEL_CAP, maxStored, shown, stepCost, valueAt } from '../src/core/ladder';
import { mergeState, sanitizeState } from '../src/core/Save';
import { createGameState, type GameContext, type GameEvents, type UpgradeId } from '../src/core/types';
import { Upgrades } from '../src/core/Upgrades';
import { INVEST, MARKET } from '../src/eras/data';
import { climbOpen } from '../src/eras/gate';

const DEFS = Object.values(UPGRADES) as UpgradeDef[];

const make = (money = 1e15, lodge = false) => {
  const state = createGameState();
  if (lodge) state.village.greatLodge.tier = 0;
  const events = new EventBus<GameEvents>();
  const economy = new Economy(events, state, money);
  return { state, economy, up: new Upgrades(state, economy, events) };
};

describe('climbOpen', () => {
  it('opens with the Great Lodge', () => {
    const { state } = make();
    expect(climbOpen(state)).toBe(false);
    state.village.greatLodge.tier = 0;
    expect(climbOpen(state)).toBe(true);
  });
});

describe('Upgrades on the ladder', () => {
  it('below the Great Lodge every id stops at its authored max at the authored prices', () => {
    const { up } = make();
    for (const d of DEFS) {
      expect(up.maxLevel(d.id)).toBe(authoredMax(d));
      // era 1: the 0.8.0 tables; era 2+: no table, the band curve (era economy ×10)
      for (let s = 0; s < authoredMax(d); s++) expect(stepCost(d, s)).toBe(introEra(d) >= 2 ? costAt(d, s) : d.costs[s]);
    }
    while (up.buy('carry'));
    expect(up.level('carry')).toBe(authoredMax(UPGRADES.carry));
    expect(up.nextCost('carry')).toBeNull();
    expect(up.nextValue('carry')).toBeNull();
  });

  it('the Lv 10 cap stops machines and crews alike, and old saves above it keep their levels', () => {
    const { up, state } = make(1e15, true);
    for (const id of ['harvester', 'processor', 'megaSaw', 'treeFeller', 'cashTubes', 'workshop'] as UpgradeId[]) {
      expect(UPGRADES[id].group).toBe('machine');
      expect(up.maxLevel(id)).toBe(10);
    }
    for (const id of up.group('crew').filter((i) => UPGRADES[i].era === undefined)) expect(up.maxLevel(id)).toBe(10);
    // a save from 0.9.0 with a machine already past the cap: nothing is taken away, it just can't go higher
    state.upgrades.harvester = 25;
    expect(state.upgrades.harvester).toBe(25);
    expect(up.level('harvester')).toBe(10); // played at the Lv 10 cap
    expect(up.isMax('harvester')).toBe(true);
    expect(up.nextCost('harvester')).toBeNull();
    expect(up.canBuy('harvester')).toBe(false);
    const before = state.stats.upgradesBought;
    up.levelUp('harvester', null);
    expect(state.upgrades.harvester).toBe(25);
    expect(state.stats.upgradesBought).toBe(before);
  });

  it('literal mode (0.9.5): every id stops at Lv 10 for good, era after era; prices still climb by era', () => {
    expect(GATE.mode).toBe('literal');
    const { up, state } = make(1e15, true);
    for (const age of [1, 2, 5, 10]) {
      state.eras.age = age;
      for (const id of ['carry', 'harvester', 'frontierCrew', 'frontierBelts', 'quarry', 'aiRigs'] as UpgradeId[]) {
        expect(up.maxLevel(id)).toBe(10);
      }
    }
    // an era-n id shows its stored level (no offset) but is priced in era n's band: era 3 costs far more than era 2
    expect(up.shownLevel('ironRigs')).toBe(0);
    expect(costAt(UPGRADES.ironRigs, 0)).toBeGreaterThan(costAt(UPGRADES.frontierRigs, 9));
    // old saves above 10 keep their stored levels (never lost) but read Lv 10 for display and effect
    state.upgrades.carry = 17;
    expect(up.level('carry')).toBe(10);
    expect(up.value('carry')).toBe(valueAt(UPGRADES.carry, 10));
    expect(up.isMax('carry')).toBe(true);
    expect(state.upgrades.carry).toBe(17);
  });

  it('era-2+ ids have no cost table: every step is on the band curve and rises strictly', () => {
    for (const d of DEFS.filter((x) => introEra(x) >= 2)) {
      expect(d.costs).toHaveLength(0);
      let last = 0;
      for (let s = 0; s < maxStored(d, true); s++) {
        const c = stepCost(d, s);
        expect(c).toBe(costAt(d, s));
        expect(c % 5).toBe(0);
        expect(c).toBeGreaterThan(last);
        last = c;
      }
    }
    for (const d of DEFS.filter((x) => introEra(x) === 1)) {
      for (let s = 0; s < maxStored(d, true); s++) expect(stepCost(d, s)).toBe(costAt(d, s));
    }
  });

  it('setLevel keeps stored levels past the authored max (to 100 at most), climb open or not; play reads at most Lv 10', () => {
    const { up, state } = make();
    up.setLevel('axe', 30);
    expect(state.upgrades.axe).toBe(30);
    expect(up.level('axe')).toBe(10);
    expect(up.value('axe')).toBe(valueAt(UPGRADES.axe, 10));
    up.setLevel('axe', 500);
    expect(state.upgrades.axe).toBe(LEGACY_LEVEL_CAP);
    up.setLevel('ironRigs', 500);
    expect(state.upgrades.ironRigs).toBe(LEGACY_LEVEL_CAP);
    expect(shown(UPGRADES.ironRigs, state.upgrades.ironRigs)).toBe(LEGACY_LEVEL_CAP);
    up.setLevel('dog', -4);
    expect(state.upgrades.dog).toBe(0);
  });

  it('productMult reads the sales ladder past its table', () => {
    const s = createGameState();
    const d = UPGRADES.plankQuality;
    s.upgrades.plankQuality = authoredMax(d) + 5;
    expect(productMult(s, 'plank')).toBeCloseTo(valueAt(d, authoredMax(d) + 5), 9);
    expect(productMult(s, 'plank')).toBeCloseTo(4.5, 9); // 0.9.6: +0.5 a level past the table
  });
});

describe('broker past its table', () => {
  it('tightens the spread but pays bonds at most the authored top rate (docs/EXPANSION.md §A1)', () => {
    const { state, economy, up } = make(1e6, true);
    const events = new EventBus<GameEvents>();
    const market = new Market({ events, state, economy, upgrades: up } as unknown as GameContext);
    const d = UPGRADES.broker;
    // 0.9.6: Lv 10 is authored (4.2) but bonds still read at most bondBrokerMax, the 0.9.5 top (3.5)
    up.setLevel('broker', authoredMax(d) - 1);
    const top = market.bondPayout();
    expect(top).toBeCloseTo(1 + INVEST.bond.rate * Math.sqrt(CLIMB.bondBrokerMax), 12);
    const spread = market.spread();
    up.setLevel('broker', authoredMax(d));
    expect(up.value('broker')).toBeGreaterThan(CLIMB.bondBrokerMax);
    expect(market.bondPayout()).toBe(top);
    expect(market.spread()).toBeLessThan(spread);
    expect(market.spread()).toBeGreaterThanOrEqual(MARKET.spread / 10);
  });
});

describe('crewStats', () => {
  const crews = DEFS.filter((d) => d.display === 'crew');

  it('equals the old linear reads (0.5 floor) everywhere on the authored tables', () => {
    const { up } = make();
    for (const d of crews) {
      for (let s = 0; s <= authoredMax(d); s++) {
        up.setLevel(d.id, s);
        const v = d.values[s]!;
        const st = up.crewStats(d.id);
        expect(st.mult).toBe(v);
        expect(st.walk).toBe(Math.max(0.5, v));
        expect(st.capacity).toBe(v);
        expect(st.cadence).toBe(Math.max(0.5, v));
      }
    }
  });

  it('clamps walk, capacity and cadence separately past the table (a stored Lv 100 plays as Lv 10)', () => {
    const { up } = make();
    const c = CLIMB.crew;
    up.setLevel('cashier', 100);
    let st = up.crewStats('cashier');
    const v = valueAt(UPGRADES.cashier, 10);
    expect(st.mult).toBe(v);
    expect(st.walk).toBe(Math.min(v, c.walkMax));
    expect(st.capacity).toBe(Math.min(v, c.capMaxSurvival));
    expect(st.cadence).toBe(Math.min(v, c.cadenceMax));
    expect(st.capacity).toBe(c.capMaxSurvival); // 3.6 > 2.8: the Survival clamp bites
    up.setLevel('frontierCrew', 100);
    st = up.crewStats('frontierCrew');
    const w = valueAt(UPGRADES.frontierCrew, 10);
    expect(st.mult).toBe(w);
    expect(st.capacity).toBe(Math.min(w, c.capMaxEra));
    expect(st.walk).toBe(Math.min(w, c.walkMax));
  });
});

describe('Save clamp', () => {
  it('keeps levels bought past the authored max, climb open or not', () => {
    const state = createGameState();
    mergeState(state, { upgrades: { carry: 17, frontierRigs: 40, aiRigs: 150, speed: 1e6 } });
    sanitizeState(state);
    expect(state.upgrades.carry).toBe(17);
    expect(state.upgrades.frontierRigs).toBe(40);
    expect(state.upgrades.aiRigs).toBe(LEGACY_LEVEL_CAP);
    expect(state.upgrades.speed).toBe(LEGACY_LEVEL_CAP);
    expect(shown(UPGRADES.aiRigs, state.upgrades.aiRigs)).toBe(LEGACY_LEVEL_CAP);
  });
});
