/** Upgrade table sanity and sale prices (pure functions of state + config). */
import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../src/config';
import { productMult, salePrice } from '../src/core/demand';
import { introEra } from '../src/core/ladder';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { createGameState, type GameEvents, type UpgradeId } from '../src/core/types';
import { Upgrades } from '../src/core/Upgrades';

describe('UPGRADES table', () => {
  for (const d of Object.values(UPGRADES)) {
    it(`${d.id}: one cost per level step (era 2+: none, priced by the ladder), multiples of 5, rising`, () => {
      expect(d.costs).toHaveLength(introEra(d) >= 2 ? 0 : d.values.length - 1);
      for (const c of d.costs) expect(c % 5).toBe(0);
      for (let i = 1; i < d.costs.length; i++) expect(d.costs[i]!).toBeGreaterThan(d.costs[i - 1]!);
    });
  }
});

describe('salePrice', () => {
  it('applies the village multiplier and rounds to whole bundles', () => {
    const s = createGameState();
    expect(salePrice(s, 'plank', 5, 3)).toBe(15);
    s.village.level = 4;
    expect(salePrice(s, 'plank', 5, 7) % 5).toBe(0);
  });

  it('applies only the matching Sales upgrade', () => {
    const s = createGameState();
    s.upgrades.plankQuality = UPGRADES.plankQuality.values.length - 1;
    expect(productMult(s, 'plank')).toBe(2);
    expect(productMult(s, 'crate')).toBe(1);
    expect(salePrice(s, 'plank', 5, 10)).toBe(100);
    expect(salePrice(s, 'crate', 15, 2)).toBe(30);
  });
});

describe('Upgrades', () => {
  const make = (money: number) => {
    const state = createGameState();
    const events = new EventBus<GameEvents>();
    const economy = new Economy(events, state, money);
    return { state, economy, up: new Upgrades(state, economy, events) };
  };

  it('buys a level and spends its cost', () => {
    const { up, economy } = make(1000);
    expect(up.buy('carry')).toBe(true);
    expect(up.level('carry')).toBe(1);
    expect(economy.money).toBe(1000 - UPGRADES.carry.costs[0]!);
  });

  it('respects requirements and max level', () => {
    const { up, state } = make(1e9);
    expect(up.buy('crateQuality')).toBe(false); // needs the processor
    state.unlocked.processor = true;
    expect(up.buy('crateQuality')).toBe(true);
    const id: UpgradeId = 'speed';
    while (up.buy(id));
    expect(up.isMax(id)).toBe(true);
    expect(up.level(id)).toBe(UPGRADES.speed.values.length - 1);
  });
});
