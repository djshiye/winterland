/**
 * The ladder wired into the game (docs/EXPANSION.md order, step 2): Upgrades, productMult, the Save clamp and
 * crewStats read core/ladder.ts; levels past the authored max are for sale only once the climb is open (the Great
 * Lodge). Era 1 below the Lodge stays 0.8.0 (tests/era1Frozen.test.ts).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CLIMB, GATE, UPGRADES, type UpgradeDef } from '../src/config';
import { productMult } from '../src/core/demand';
import { Market } from '../src/core/Market';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { authoredMax, costAt, introEra, LEVEL_CAP, maxStored, shown, stepCost, valueAt } from '../src/core/ladder';
import { mergeState, sanitizeState } from '../src/core/Save';
import { createGameState, type GameContext, type GameEvents, type UpgradeId } from '../src/core/types';
import { Upgrades } from '../src/core/Upgrades';
import { INVEST, MARKET } from '../src/eras/data';
import { climbOpen } from '../src/eras/gate';

const DEFS = Object.values(UPGRADES) as UpgradeDef[];

/** The 0.9.0 – 0.9.4 convention ('offset': era cap 10 · age) is still a switch; tests that pin it opt in. */
const OFFSET = (): void => {
  GATE.mode = 'offset';
};
afterEach(() => {
  GATE.mode = 'literal';
});

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

  it('offset mode: with the Lodge built the ladder runs on past the authored max, era cap by era cap, to shown level 100', () => {
    OFFSET();
    const { up, state, economy } = make(1e15, true);
    const id: UpgradeId = 'carry';
    const d = UPGRADES[id];
    while (up.level(id) < authoredMax(d)) expect(up.buy(id)).toBe(true);
    expect(up.isMax(id)).toBe(false);
    const before = economy.money;
    expect(up.nextCost(id)).toBe(costAt(d, authoredMax(d)));
    expect(up.nextValue(id)).toBe(valueAt(d, authoredMax(d) + 1));
    expect(up.buy(id)).toBe(true);
    expect(economy.money).toBe(before - costAt(d, authoredMax(d)));
    expect(up.value(id)).toBe(41);
    expect(up.describe(id)).toBe('41 items');
    // era 1 stops at shown level 10 (the era-2 gate) until the era-2 expansion is bought
    while (up.buy(id));
    expect(up.level(id)).toBe(10);
    expect(up.isMax(id)).toBe(true);
    expect(up.atEraCap(id)).toBe(true);
    expect(up.nextCost(id)).toBeNull();
    // each era lifts the cap by 10; era 10 reaches the final level
    for (let age = 2; age <= 10; age++) {
      state.eras.age = age;
      expect(up.isMax(id)).toBe(false);
      while (up.buy(id));
      expect(up.shownLevel(id)).toBe(10 * age);
    }
    expect(up.atEraCap(id)).toBe(false);
    expect(up.level(id)).toBe(LEVEL_CAP);
    expect(up.shownLevel(id)).toBe(LEVEL_CAP);
    expect(up.value(id)).toBe(50); // the hard cap
    // closing the climb again (debug) never takes bought levels away; it only stops further purchases
    state.village.greatLodge.tier = -1;
    expect(up.level(id)).toBe(LEVEL_CAP);
    expect(up.isMax(id)).toBe(true);
  });

  it('offset mode: the era cap stops machines and crews alike at shown level 10 · age, and old saves above it keep their levels', () => {
    OFFSET();
    const { up, state } = make(1e15, true);
    for (const id of ['harvester', 'processor', 'megaSaw', 'treeFeller', 'cashTubes', 'workshop'] as UpgradeId[]) {
      expect(UPGRADES[id].group).toBe('machine');
      expect(up.maxLevel(id)).toBe(10);
    }
    for (const id of up.group('crew').filter((i) => UPGRADES[i].era === undefined)) expect(up.maxLevel(id)).toBe(10);
    // an era-3 id starts at shown 20 (stored 0): in era 3 it caps at shown 30 (stored 10), like every older id
    state.eras.age = 3;
    expect(introEra(UPGRADES.ironRigs)).toBe(3);
    expect(up.maxLevel('ironRigs')).toBe(10);
    expect(up.maxLevel('harvester')).toBe(30);
    // a save from 0.9.0 with a machine already past the cap: nothing is taken away, it just can't go higher yet
    state.eras.age = 1;
    state.upgrades.harvester = 25;
    expect(up.level('harvester')).toBe(25);
    expect(up.isMax('harvester')).toBe(true);
    expect(up.nextCost('harvester')).toBeNull();
    expect(up.canBuy('harvester')).toBe(false);
    const before = state.stats.upgradesBought;
    up.levelUp('harvester', null);
    expect(up.level('harvester')).toBe(25);
    expect(state.stats.upgradesBought).toBe(before);
  });

  it('literal mode (0.9.5): every id stops at Lv 10 for good, era after era; prices still climb by era', () => {
    expect(GATE.mode).toBe('literal');
    const { up, state } = make(1e15, true);
    for (const age of [1, 2, 5, 10]) {
      state.eras.age = age;
      for (const id of ['carry', 'harvester', 'frontierCrew', 'frontierBelts', 'quarry', 'aiRigs'] as UpgradeId[]) {
        expect(up.maxLevel(id)).toBe(10);
        expect(up.atEraCap(id)).toBe(false);
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

  it('offset mode: setLevel jumps past the authored max (to shown 100 at most), climb open or not', () => {
    OFFSET();
    const { up } = make();
    up.setLevel('axe', 30);
    expect(up.level('axe')).toBe(30);
    expect(up.value('axe')).toBe(valueAt(UPGRADES.axe, 30));
    up.setLevel('axe', 500);
    expect(up.level('axe')).toBe(LEVEL_CAP);
    up.setLevel('ironRigs', 500);
    expect(up.level('ironRigs')).toBe(LEVEL_CAP - 20);
    expect(up.shownLevel('ironRigs')).toBe(LEVEL_CAP);
    up.setLevel('dog', -4);
    expect(up.level('dog')).toBe(0);
  });

  it('productMult reads the sales ladder past its table', () => {
    const s = createGameState();
    const d = UPGRADES.plankQuality;
    s.upgrades.plankQuality = authoredMax(d) + 5;
    expect(productMult(s, 'plank')).toBeCloseTo(valueAt(d, authoredMax(d) + 5), 9);
    expect(productMult(s, 'plank')).toBeCloseTo(2.5, 9);
  });
});

describe('broker past its table', () => {
  it('tightens the spread but pays bonds at most the authored top rate (docs/EXPANSION.md §A1)', () => {
    const { state, economy, up } = make(1e6, true);
    const events = new EventBus<GameEvents>();
    const market = new Market({ events, state, economy, upgrades: up } as unknown as GameContext);
    const d = UPGRADES.broker;
    up.setLevel('broker', authoredMax(d));
    const top = market.bondPayout();
    expect(top).toBeCloseTo(1 + INVEST.bond.rate * Math.sqrt(d.values[authoredMax(d)]!), 12);
    const spread = market.spread();
    up.setLevel('broker', authoredMax(d) + 20);
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

  it('offset mode: clamps walk, capacity and cadence separately past the table', () => {
    OFFSET();
    const { up } = make();
    const c = CLIMB.crew;
    up.setLevel('cashier', 100);
    let st = up.crewStats('cashier');
    expect(st.mult).toBe(8);
    expect(st.walk).toBe(c.walkMax);
    expect(st.capacity).toBe(c.capMaxSurvival);
    expect(st.cadence).toBe(c.cadenceMax);
    up.setLevel('frontierCrew', 100);
    st = up.crewStats('frontierCrew');
    expect(st.capacity).toBe(c.capMaxEra);
    expect(st.walk).toBe(c.walkMax);
  });
});

describe('Save clamp', () => {
  it('offset mode: keeps levels bought past the authored max, climb open or not', () => {
    OFFSET();
    const state = createGameState();
    mergeState(state, { upgrades: { carry: 17, frontierRigs: 40, aiTrade: 50, speed: 1e6 } });
    sanitizeState(state);
    expect(state.upgrades.carry).toBe(17);
    expect(state.upgrades.frontierRigs).toBe(40);
    expect(state.upgrades.aiTrade).toBe(LEVEL_CAP - 90);
    expect(state.upgrades.speed).toBe(LEVEL_CAP);
    expect(shown(UPGRADES.aiTrade, state.upgrades.aiTrade)).toBe(LEVEL_CAP);
  });
});
