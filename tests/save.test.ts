/**
 * Save compatibility: real saves written by older builds must keep loading. `fixtures/save-v1-town.json` is a
 * mid-game save (Town, crew hired, machine levels) captured from the v1 format before wave 6. When the state grows,
 * these tests prove old saves still restore their progress and pick up defaults for the new fields.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAYNIGHT, OFFLINE, PRESTIGE, QUARTERS, SAVE, UPGRADES, VILLAGE } from '../src/config';
import { salePrice } from '../src/core/demand';
import { authoredMax, LEVEL_CAP } from '../src/core/ladder';
import { EventBus } from '../src/core/EventBus';
import { legacyTradeDef } from '../src/core/salesMerge';
import { refundPrice } from '../src/core/refund';
import { mergeState, migrateState, newSeasonSave, offlineEarnings, SalesMeter, sanitizeState, sanitizeWorld, type SaveData } from '../src/core/Save';
import { createGameState, MATERIAL_KINDS, REGION_SLOTS, type GameContext, type GameEvents } from '../src/core/types';
import { MATERIALS } from '../src/eras/data';

const load = (name: string): SaveData => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const fixture = (): SaveData => load('save-v1-town.json');
/** Every real save captured from a released build: each must keep loading as the state grows. */
const FIXTURES = ['save-v1-town.json', 'save-v2-ridge.json', 'save-v3-market.json', 'save-v4-automation.json', 'save-v5-town-life.json', 'save-v6-events.json', 'save-v7-eras.json', 'save-v8-climb.json',
  // 0.9.6: one save written by each of 0.9.1-0.9.5 (tests/saveSafety.test.ts covers their migration)
  'save-v9-0.9.1-era3.json', 'save-v9-0.9.2-era5.json', 'save-v9-0.9.3-era7.json', 'save-v9-0.9.4-era10-mastery.json', 'save-v9-0.9.5-era4-lv10.json'];

describe('0.9.6 Trade merged into the material sales upgrades (migration 0.9.6-trade-merge)', () => {
  const era = (n: number) => MATERIAL_KINDS.filter((k) => MATERIALS[k].era === n);
  const loadOld = (upgrades: Record<string, number>) => {
    const state = createGameState();
    mergeState(state, { upgrades });
    sanitizeState(state);
    const report = migrateState(state, false, { salesRate: 0, upgrades });
    return { state, report };
  };

  it('every material takes max(its Fine level, the era\'s Trade level); the fixture keeps its Trade 5 as Fine 5', () => {
    const save = load('save-v8-climb.json');
    expect((save.state.upgrades as Record<string, number>).frontierTrade).toBe(5);
    const state = createGameState();
    mergeState(state, save.state);
    sanitizeState(state);
    const report = migrateState(state, false, { salesRate: 0, upgrades: save.state.upgrades });
    for (const k of era(2)) expect(state.upgrades[`${k}Quality`]).toBe(5);
    for (const k of era(3)) expect(state.upgrades[`${k}Quality`]).toBe(0);
    expect('frontierTrade' in state.upgrades).toBe(false);
    expect(report.tradeLevels).toBe(0); // no Fine levels yet: all five Trade levels carried over
    expect(report.applied).toContain('0.9.6-trade-merge');
  });

  it('refunds the Trade levels no material needs: both at Lv 10 keeps Lv 10 and pays all ten Trade levels back', () => {
    const fine = Object.fromEntries(era(2).map((k) => [`${k}Quality`, 10]));
    const { state, report } = loadOld({ frontierTrade: 10, ...fine });
    for (const k of era(2)) expect(state.upgrades[`${k}Quality`]).toBe(10);
    expect(report.tradeLevels).toBe(10);
    const def = legacyTradeDef(2);
    let want = 0;
    for (let s = 0; s < 10; s++) want += refundPrice(def, s);
    expect(report.refund).toBe(Math.floor(want));
    expect(report.refund).toBeGreaterThan(0);
  });

  it('a Trade level that lifts the lowest Fine is kept as Fine, not refunded; Trade past 10 is refunded', () => {
    const [a, ...rest] = era(2);
    const up: Record<string, number> = { frontierTrade: 6, [`${a}Quality`]: 2 };
    for (const k of rest) up[`${k}Quality`] = 8;
    const { state, report } = loadOld(up);
    expect(state.upgrades[`${a}Quality`]).toBe(6);
    for (const k of rest) expect(state.upgrades[`${k}Quality`]).toBe(8);
    expect(report.tradeLevels).toBe(2); // the lowest Fine (2) already had Trade levels 0 and 1
    const big = loadOld({ ironTrade: 14 });
    for (const k of era(3)) expect(big.state.upgrades[`${k}Quality`]).toBe(10);
    expect(big.report.tradeLevels).toBe(4);
  });

  it('runs once, and never on a fresh game', () => {
    const { state } = loadOld({ frontierTrade: 3 });
    const again = migrateState(state, false, { salesRate: 0, upgrades: { frontierTrade: 3 } });
    expect(again.tradeLevels).toBe(0);
    const fresh = createGameState();
    expect(migrateState(fresh, true, { salesRate: 0, upgrades: { frontierTrade: 3 } }).refund).toBe(0);
  });
});

describe.each(FIXTURES)('%s', (name) => {
  it('loads every saved field and the world', () => {
    const save = load(name);
    expect(save.v).toBe(SAVE.version);
    const state = createGameState();
    mergeState(state, save.state);
    expect(state.unlocked).toEqual({ ...state.unlocked, ...save.state.unlocked });
    expect(state.quarters).toEqual({ ...state.quarters, ...(save.state.quarters ?? {}) });
    expect(state.prestige.season).toBe(save.state.prestige?.season ?? 0);
    for (const [id, level] of Object.entries(save.state.upgrades)) {
      if (id.endsWith('Trade')) continue; // 0.9.6: merged into the material sales upgrades (below)
      expect(state.upgrades[id as keyof typeof state.upgrades]).toBe(level);
    }
    const world = sanitizeWorld(save.world);
    for (const [k, n] of Object.entries(save.world.piles)) expect(world.piles[k as keyof typeof world.piles]).toBe(n);
  });
});

describe('v1 save fixture', () => {
  it('is still the current save version', () => {
    expect(fixture().v).toBe(SAVE.version);
  });

  it('restores every saved field', () => {
    const save = fixture();
    const state = createGameState();
    mergeState(state, save.state);
    expect(state.phase).toBe(save.state.phase);
    expect(state.unlocked).toEqual({ ...state.unlocked, ...save.state.unlocked });
    expect(state.village.level).toBe(save.state.village.level);
    expect(state.village.plots.map((p) => p.tier)).toEqual(save.state.village.plots.map((p) => p.tier));
    expect(state.stats.moneyEarned).toBe(save.state.stats.moneyEarned);
    expect(state.playTime).toBe(save.state.playTime);
    for (const [id, level] of Object.entries(save.state.upgrades)) {
      if (id.endsWith('Trade')) continue; // 0.9.6: merged into the material sales upgrades (below)
      expect(state.upgrades[id as keyof typeof state.upgrades]).toBe(level);
    }
    for (const [flag, on] of Object.entries(save.state.flags)) expect(state.flags[flag as keyof typeof state.flags]).toBe(on);
  });

  it('gets defaults for fields added after v1', () => {
    const state = createGameState();
    mergeState(state, fixture().state);
    expect(state.upgrades.plankQuality).toBe(0);
    expect(state.upgrades.crateQuality).toBe(0);
    expect(state.upgrades.bulkDeals).toBe(0);
    expect(state.quarters).toEqual({ tier: -1, logs: 0, cash: 0 });
    expect(state.prestige).toEqual({ season: 0 });
  });

  it('ignores junk and wrong types', () => {
    const state = createGameState();
    mergeState(state, { phase: 7, playTime: Number.NaN, upgrades: { carry: 'x', speed: 2 }, unknown: { a: 1 }, village: { plots: 'no' } });
    expect(state.phase).toBe('intro');
    expect(state.playTime).toBe(0);
    expect(state.upgrades.carry).toBe(0);
    expect(state.upgrades.speed).toBe(2);
    expect(state.village.plots).toHaveLength(8);
    expect((state as unknown as Record<string, unknown>).unknown).toBeUndefined();
  });
});

describe('offline earnings', () => {
  const save = (rate: number, earned: number, awaySeconds: number): [SaveData, number] => {
    const s = fixture();
    s.salesRate = rate;
    s.state.stats.moneyEarned = earned;
    return [s, s.savedAt + awaySeconds * 1000];
  };

  it('pays nothing for short absences', () => {
    expect(offlineEarnings(...save(50, 1e6, 30)).amount).toBe(0);
  });

  it('is capped by time away and by the share of everything earned', () => {
    const [s, now] = save(1000, 1e9, 10 * 3600);
    expect(offlineEarnings(s, now).seconds).toBe(OFFLINE.maxSeconds);
    const capped = offlineEarnings(...save(1000, 20000, 3600)).amount;
    expect(capped).toBeLessThanOrEqual(20000 * OFFLINE.maxShareOfEarned);
    expect(capped % 5).toBe(0);
  });
});

describe('SalesMeter', () => {
  const meter = () => {
    const events = new EventBus<GameEvents>();
    const time = { elapsed: 0, frame: 0 };
    const sales = new SalesMeter({ events, time } as unknown as GameContext, 0);
    time.elapsed = OFFLINE.window;
    return { events, time, sales };
  };

  it('nets market orders out of the rate, so order-then-export churn adds nothing', () => {
    const { events, time, sales } = meter();
    events.emit('sale', { buyer: 'export', kind: 'brick', count: 24, amount: 6000, position: null as never });
    expect(sales.rate).toBeCloseTo(6000 / OFFLINE.window, 9);
    events.emit('market:order', { kind: 'brick', count: 24, era: 2, amount: 7000 });
    events.emit('sale', { buyer: 'export', kind: 'brick', count: 24, amount: 6000, position: null as never });
    expect(sales.rate).toBeCloseTo(5000 / OFFLINE.window, 9);
    // an order that leaves the window stops counting against the rate
    time.elapsed += OFFLINE.window + 1;
    events.emit('sale', { buyer: 'export', kind: 'brick', count: 1, amount: 300, position: null as never });
    expect(sales.rate).toBeCloseTo(300 / OFFLINE.window, 9);
  });

  it('counts city rent and business income, not trading profit or interest (0.9.6, CODE_AUDIT P2-15)', () => {
    const { events, sales } = meter();
    events.emit('income', { source: 'rent', amount: 400, position: null });
    events.emit('income', { source: 'business', amount: 600, position: null });
    events.emit('income', { source: 'trade', amount: 5000, position: null });
    events.emit('income', { source: 'interest', amount: 5000, position: null });
    expect(sales.rate).toBeCloseTo(1000 / OFFLINE.window, 9);
  });

  it('never goes negative', () => {
    const { events, sales } = meter();
    events.emit('market:order', { kind: 'brick', count: 24, era: 2, amount: 7000 });
    expect(sales.rate).toBe(0);
  });
});

describe('older world snapshots', () => {
  it('load with empty Timber Ridge piles', () => {
    const world = fixture().world;
    const raw = JSON.parse(JSON.stringify(world));
    expect(raw.piles.deck).toBeUndefined();
    expect(sanitizeWorld(raw).piles.deck).toBe(0);
    expect(sanitizeWorld(raw).cash.platform).toBe(0);
    expect(sanitizeWorld(raw).piles.dropZone).toBe(world.piles.dropZone);
  });
});

describe('new season (prestige)', () => {
  it('resets progress and stats, keeps hints, counts the season', () => {
    const prev = createGameState();
    mergeState(prev, fixture().state);
    prev.flags['seen:shop'] = true;
    prev.prestige.season = 1;
    const next = newSeasonSave(prev, 1000);
    expect(next.state.prestige.season).toBe(2);
    expect(next.money).toBe(PRESTIGE.startMoneyPerSeason * 2);
    expect(next.state.unlocked).toEqual(createGameState().unlocked);
    expect(next.state.upgrades).toEqual(createGameState().upgrades);
    expect(next.state.flags.introDone).toBe(prev.flags.introDone);
    expect(next.state.flags['seen:shop']).toBe(true);
    expect(next.state.stats).toEqual(createGameState().stats);
    expect(next.state.playTime).toBe(0);
    expect(next.world.piles.dropZone).toBe(0);
  });

  it('raises every sale price by the season bonus', () => {
    const s = createGameState();
    const base = salePrice(s, 'plank', 5, 20);
    s.prestige.season = 2;
    expect(salePrice(s, 'plank', 5, 20)).toBe(Math.round((base * (1 + 2 * PRESTIGE.bonusPerSeason)) / 5) * 5);
  });
});

describe('sanitizeState', () => {
  const merged = (saved: unknown) => {
    const state = createGameState();
    mergeState(state, saved);
    sanitizeState(state);
    return state;
  };

  it.each(FIXTURES)('leaves %s untouched', (name) => {
    const state = createGameState();
    mergeState(state, load(name).state);
    const before = structuredClone(state);
    sanitizeState(state);
    expect(state).toEqual(before);
  });

  it('leaves a fresh state untouched', () => {
    const state = createGameState();
    const before = structuredClone(state);
    sanitizeState(state);
    expect(state).toEqual(before);
  });

  it('clamps out-of-range tiers, levels and upgrade levels', () => {
    const state = merged({
      village: { level: 99, plots: [{ tier: 99, logs: 5, cash: 5 }, { tier: -7 }, { tier: 1.9 }], greatLodge: { tier: 99 } },
      quarters: { tier: 42 },
      upgrades: { carry: 999, speed: -3, axe: 2.7 },
    });
    expect(state.village.plots[0]!.tier).toBe(VILLAGE.tiers.length - 1);
    expect(state.village.plots[1]!.tier).toBe(-1);
    expect(state.village.plots[2]!.tier).toBe(1);
    expect(state.village.greatLodge.tier).toBe(0);
    expect(state.village.level).toBe(VILLAGE.levels.length - 1);
    expect(state.quarters.tier).toBe(QUARTERS.tiers.length - 1);
    expect(state.upgrades.carry).toBe(LEVEL_CAP); // shown level 100, climb open or not (docs/EXPANSION.md §F)
    expect(state.upgrades.speed).toBe(0);
    expect(state.upgrades.axe).toBe(2);
    // a maxed plot has nothing left to pay
    expect(state.village.plots[0]!.logs).toBe(0);
    expect(state.village.plots[0]!.cash).toBe(0);
  });

  it('resets unknown crew priorities to balanced', () => {
    const state = merged({ priorities: { wood: 'everything', town: 'toys' } });
    expect(state.priorities).toEqual({ wood: 'balanced', town: 'toys' });
  });

  it('clamps paid progress to the next tier cost', () => {
    const state = merged({ village: { plots: [{ tier: -1, logs: 9999, cash: -5 }] }, quarters: { tier: 0, logs: 1e9, cash: 1e9 } });
    expect(state.village.plots[0]!.logs).toBe(VILLAGE.tiers[0]!.logs);
    expect(state.village.plots[0]!.cash).toBe(0);
    expect(state.quarters.logs).toBe(QUARTERS.tiers[1]!.logs);
    expect(state.quarters.cash).toBe(QUARTERS.tiers[1]!.cash);
  });

  it('fixes the season, the clock, the phase and negative counters', () => {
    const state = merged({
      prestige: { season: -4 },
      clock: 1e9,
      phase: 'banana',
      playTime: -1,
      stats: { moneyEarned: -50 },
      padPaid: { 'pad:harvester': -10 },
    });
    expect(state.prestige.season).toBe(0);
    expect(state.clock).toBeGreaterThanOrEqual(0);
    expect(state.clock).toBeLessThan(DAYNIGHT.cycleSeconds);
    expect(state.phase).toBe('intro');
    expect(state.playTime).toBe(0);
    expect(state.stats.moneyEarned).toBe(0);
    expect(state.padPaid['pad:harvester']).toBe(0);
  });

  it('gives repeated investment ids fresh ones, so withdraw closes the position it is asked to', () => {
    const bond = { product: 'bond', era: 0, principal: 1000, value: 1000, age: 0 };
    const state = merged({ eras: { age: 3 }, market: { nextId: 1, investments: [bond, { ...bond, product: 'index' }, { ...bond, id: 5 }, { ...bond, id: 5 }] } });
    const ids = state.market.investments.map((p) => p.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids.slice(0, 3)).toEqual([0, 6, 5]);
    expect(state.market.nextId).toBeGreaterThan(Math.max(...ids));
  });
});

describe('v3 Market Town fixture', () => {
  it('restores lots (built, mid-payment, empty) and the town world untouched by sanitizeState', () => {
    const save = load('save-v3-market.json');
    const state = createGameState();
    mergeState(state, save.state);
    const before = JSON.stringify(state);
    sanitizeState(state);
    expect(JSON.stringify(state)).toBe(before);
    expect(state.town.revealed).toBe(true);
    expect(state.town.lots.map((l) => l.building)).toEqual(save.state.town.lots.map((l) => l.building));
    const mid = state.town.lots[5]!;
    expect(mid).toEqual({ building: 'bakery', tier: -1, logs: 7, cash: 1200 });
    const world = sanitizeWorld(save.world);
    expect(world.town).toEqual(save.world.town.map((t) => ({ ...t, in: Object.fromEntries(Object.entries(t.in).filter(([, n]) => (n ?? 0) > 0)) })));
  });

  it('older saves get an empty, hidden town', () => {
    for (const name of ['save-v1-town.json', 'save-v2-ridge.json']) {
      const state = createGameState();
      mergeState(state, load(name).state);
      sanitizeState(state);
      expect(state.town.revealed).toBe(false);
      expect(state.town.lots.every((l) => l.building === '' && l.tier === -1)).toBe(true);
      expect(sanitizeWorld(load(name).world).town.every((t) => t.out === 0 && t.cash === 0)).toBe(true);
    }
  });

  it('an unknown building id frees the lot; paid amounts are capped at the building cost', () => {
    const state = createGameState();
    state.town.lots[0] = { building: 'castle' as never, tier: 0, logs: 5, cash: 50 };
    state.town.lots[1] = { building: 'farm', tier: -1, logs: 999, cash: 1e9 };
    sanitizeState(state);
    expect(state.town.lots[0]).toEqual({ building: '', tier: -1, logs: 0, cash: 0 });
    expect(state.town.lots[1]!.logs).toBeLessThanOrEqual(24);
    expect(state.town.lots[1]!.cash).toBeLessThanOrEqual(2500);
  });
});

/** 0.9.0: a mid-game Ages save (era IV, machines, city lots, market positions, era piles). */
describe('v7 eras save fixture', () => {
  it('restores the ages, the city and the market', () => {
    const save = load('save-v7-eras.json');
    const state = createGameState();
    mergeState(state, save.state);
    sanitizeState(state);
    expect(state.eras.age).toBe(4);
    expect(state.eras.regions.map((r) => r.unlocked)).toEqual([false, false, true, true, true, false, false, false, false, false, false]);
    expect(state.eras.regions[2]!.slots[1]).toEqual({ machine: 'kiln', tier: 0, cash: 0, extra: 0 });
    expect(state.eras.regions[3]!.slots[1]).toEqual({ machine: 'smelter', tier: -1, cash: 12000, extra: 3 });
    expect(state.eras.regions[5]!.cash).toBe(100000);
    expect(state.city.districts[2]!.lots[0]!.building).toBe('frontierHome');
    expect(state.city.districts[2]!.lots[2]).toEqual({ building: 'frontierPark', tier: -1, cash: 5000, extra: 2 });
    expect(state.market.investments.map((p) => p.product)).toEqual(['bond', 'index']);
    expect(state.market.nextId).toBe(3);
    expect(state.upgrades.frontierRigs).toBe(2);
    const world = sanitizeWorld(save.world);
    expect(world.eras[2]!.slots[1]).toEqual({ in: { stone: 4 }, out: 3 });
    expect(world.eras[2]!.dock).toEqual({ ore: 5 });
    expect(world.eras.map((r) => r.slots.length)).toEqual([...REGION_SLOTS]);
  });

  it('older saves start in the Survival era with an empty city and market', () => {
    const state = createGameState();
    mergeState(state, load('save-v6-events.json').state);
    sanitizeState(state);
    expect(state.eras.age).toBe(1);
    expect(state.eras.regions.every((r) => !r.unlocked)).toBe(true);
    expect(state.market.investments).toEqual([]);
    expect(sanitizeWorld(load('save-v6-events.json').world).eras[2]!.slots).toHaveLength(REGION_SLOTS[2]!);
  });
});

/**
 * 0.9.0 climb: the Great Lodge built, levels past the authored tables, settlement 8, a half-paid era-3 pad. Saved while
 * the Steward auto-buyer existed (eras.steward true): the field is dropped on load (upgrades are hands-on).
 */
describe('v8 climb save fixture', () => {
  it('restores the climb untouched by sanitizeState', () => {
    const save = load('save-v8-climb.json');
    const state = createGameState();
    mergeState(state, save.state);
    const before = JSON.stringify(state);
    sanitizeState(state);
    expect(JSON.stringify(state)).toBe(before);
    expect(state.village.greatLodge.tier).toBeGreaterThanOrEqual(0);
    expect(state.eras.age).toBe(2);
    expect(state.eras.settlement).toBe(8);
    expect((save.state.eras as unknown as Record<string, unknown>).steward).toBe(true);
    expect('steward' in state.eras).toBe(false);
    expect(state.eras.regions[3]).toMatchObject({ unlocked: false, cash: 2_250_000, extra: 17 });
    expect(state.upgrades.carry).toBe(15);
    expect(state.upgrades.frontierRigs).toBe(5);
    expect(state.upgrades.carry).toBeGreaterThan(authoredMax(UPGRADES.carry));
  });

  it('round-trips: a save written from the restored state restores the same state and world', () => {
    const save = load('save-v8-climb.json');
    const a = createGameState();
    mergeState(a, save.state);
    sanitizeState(a);
    const b = createGameState();
    mergeState(b, JSON.parse(JSON.stringify(a)));
    sanitizeState(b);
    expect(b).toEqual(a);
    const world = sanitizeWorld(save.world);
    expect(sanitizeWorld(JSON.parse(JSON.stringify(world)))).toEqual(world);
    expect(world.eras[2]!.slots.length).toBe(REGION_SLOTS[2]!);
  });
});
