/**
 * Save compatibility: real saves written by older builds must keep loading. `fixtures/save-v1-town.json` is a
 * mid-game save (Town, crew hired, machine levels) captured from the v1 format before wave 6. When the state grows,
 * these tests prove old saves still restore their progress and pick up defaults for the new fields.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAYNIGHT, OFFLINE, PRESTIGE, QUARTERS, SAVE, UPGRADES, VILLAGE } from '../src/config';
import { salePrice } from '../src/core/demand';
import { mergeState, newSeasonSave, offlineEarnings, sanitizeState, sanitizeWorld, type SaveData } from '../src/core/Save';
import { createGameState } from '../src/core/types';

const load = (name: string): SaveData => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const fixture = (): SaveData => load('save-v1-town.json');
/** Every real save captured from a released build: each must keep loading as the state grows. */
const FIXTURES = ['save-v1-town.json', 'save-v2-ridge.json', 'save-v3-market.json', 'save-v4-automation.json', 'save-v5-town-life.json', 'save-v6-events.json', 'save-v7-eras.json'];

describe.each(FIXTURES)('%s', (name) => {
  it('loads every saved field and the world', () => {
    const save = load(name);
    expect(save.v).toBe(SAVE.version);
    const state = createGameState();
    mergeState(state, save.state);
    expect(state.unlocked).toEqual({ ...state.unlocked, ...save.state.unlocked });
    expect(state.quarters).toEqual({ ...state.quarters, ...(save.state.quarters ?? {}) });
    expect(state.prestige.season).toBe(save.state.prestige?.season ?? 0);
    for (const [id, level] of Object.entries(save.state.upgrades)) expect(state.upgrades[id as keyof typeof state.upgrades]).toBe(level);
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
    for (const [id, level] of Object.entries(save.state.upgrades)) expect(state.upgrades[id as keyof typeof state.upgrades]).toBe(level);
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
      upgrades: { carry: 99, speed: -3, axe: 2.7 },
    });
    expect(state.village.plots[0]!.tier).toBe(VILLAGE.tiers.length - 1);
    expect(state.village.plots[1]!.tier).toBe(-1);
    expect(state.village.plots[2]!.tier).toBe(1);
    expect(state.village.greatLodge.tier).toBe(0);
    expect(state.village.level).toBe(VILLAGE.levels.length - 1);
    expect(state.quarters.tier).toBe(QUARTERS.tiers.length - 1);
    expect(state.upgrades.carry).toBe(UPGRADES.carry.values.length - 1);
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
    expect(world.eras.map((r) => r.slots.length)).toEqual([0, 0, 4, 4, 5, 5, 6, 6, 7, 7, 8]);
  });

  it('older saves start in the Survival era with an empty city and market', () => {
    const state = createGameState();
    mergeState(state, load('save-v6-events.json').state);
    sanitizeState(state);
    expect(state.eras.age).toBe(1);
    expect(state.eras.regions.every((r) => !r.unlocked)).toBe(true);
    expect(state.market.investments).toEqual([]);
    expect(sanitizeWorld(load('save-v6-events.json').world).eras[2]!.slots).toHaveLength(4);
  });
});
