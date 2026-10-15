/**
 * The ladder wired into the game (docs/EXPANSION.md order, step 2): Upgrades, productMult, the Save clamp and
 * crewStats read core/ladder.ts; levels past the authored max are for sale only once the climb is open (the Great
 * Lodge). Era 1 below the Lodge stays 0.8.0 (tests/era1Frozen.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { CLIMB, UPGRADES, type UpgradeDef } from '../src/config';
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
      for (let s = 0; s < authoredMax(d); s++) expect(stepCost(d, s)).toBe(d.costs[s]);
    }
    while (up.buy('carry'));
    expect(up.level('carry')).toBe(authoredMax(UPGRADES.carry));
    expect(up.nextCost('carry')).toBeNull();
    expect(up.nextValue('carry')).toBeNull();
  });

  it('with the Lodge built the ladder runs on to shown level 100', () => {
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
    while (up.buy(id));
    expect(up.level(id)).toBe(LEVEL_CAP);
    expect(up.shownLevel(id)).toBe(LEVEL_CAP);
    expect(up.value(id)).toBe(50); // the hard cap
    // closing the climb again (debug) never takes bought levels away; it only stops further purchases
    state.village.greatLodge.tier = -1;
    expect(up.level(id)).toBe(LEVEL_CAP);
    expect(up.isMax(id)).toBe(true);
  });

  it('era-2+ ids keep their authored prices until step 6, then rise strictly past their max', () => {
    for (const d of DEFS.filter((x) => introEra(x) >= 2)) {
      let last = 0;
      for (let s = 0; s < maxStored(d, true); s++) {
        const c = stepCost(d, s);
        if (s < authoredMax(d)) expect(c).toBe(d.costs[s]);
        expect(c % 5).toBe(0);
        expect(c).toBeGreaterThan(last);
        last = c;
      }
    }
    for (const d of DEFS.filter((x) => introEra(x) === 1)) {
      for (let s = 0; s < maxStored(d, true); s++) expect(stepCost(d, s)).toBe(costAt(d, s));
    }
  });

  it('setLevel jumps past the authored max (to shown 100 at most), climb open or not', () => {
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

  it('clamps walk, capacity and cadence separately past the table', () => {
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
  it('keeps levels bought past the authored max, climb open or not', () => {
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
