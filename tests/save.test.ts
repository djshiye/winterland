/**
 * Save compatibility: real saves written by older builds must keep loading. `fixtures/save-v1-town.json` is a
 * mid-game save (Town, crew hired, machine levels) captured from the v1 format before wave 6. When the state grows,
 * these tests prove old saves still restore their progress and pick up defaults for the new fields.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OFFLINE, PRESTIGE, SAVE } from '../src/config';
import { salePrice } from '../src/core/demand';
import { mergeState, newSeasonSave, offlineEarnings, sanitizeWorld, type SaveData } from '../src/core/Save';
import { createGameState } from '../src/core/types';

const fixture = (): SaveData => JSON.parse(readFileSync(new URL('./fixtures/save-v1-town.json', import.meta.url), 'utf8'));

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
