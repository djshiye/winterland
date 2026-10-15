/**
 * 0.9.0 market (core/Market.ts): deterministic prices (seeded RNG), Survival goods fixed, supply pressure, trading
 * spread and profit, physical orders, bonds (lock, maturity, early withdrawal, cap), index fund, net worth.
 * Built on a fake GameContext (real Economy + EventBus, a stub Upgrades).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { Market, ORDER_MAX_UNITS } from '../src/core/Market';
import { createGameState, type GameContext, type GameEvents } from '../src/core/types';
import { BOND_CAP_SHARE, INVEST, INVEST_MAX_POSITIONS, MARKET, MATERIALS, SURVIVAL_VALUE } from '../src/eras/data';

/** mulberry32: a small seeded generator. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setup(opts: { age?: number; money?: number; upgrades?: Record<string, number>; rng?: () => number } = {}) {
  const events = new EventBus<GameEvents>();
  const state = createGameState();
  state.eras.age = opts.age ?? 5;
  for (let n = 2; n <= state.eras.age; n++) if (state.eras.regions[n]) state.eras.regions[n]!.unlocked = true;
  const economy = new Economy(events, state, opts.money ?? 1e6);
  const levels = opts.upgrades ?? {};
  const ctx = { events, state, economy, upgrades: { value: (id: string) => levels[id] ?? 1 } } as unknown as GameContext;
  const market = new Market(ctx, { rng: opts.rng ?? seeded(7) });
  const log: { type: string; payload: unknown }[] = [];
  for (const t of ['market:trade', 'market:order', 'invest:changed', 'income', 'sale'] as const) events.on(t, (p) => void log.push({ type: t, payload: p }));
  return { ctx, state, economy, market, log, events };
}

const run = (market: Market, seconds: number, step = 0.5): void => {
  for (let t = 0; t < seconds; t += step) market.update(step);
};

describe('prices', () => {
  it('keeps Survival goods fixed at SURVIVAL_VALUE × the demand multiplier', () => {
    const { market, state } = setup();
    const mult = market.unitValue('log') / SURVIVAL_VALUE.log;
    run(market, 600);
    expect(market.unitValue('log')).toBeCloseTo(SURVIVAL_VALUE.log * mult, 9);
    expect(market.unitValue('toy')).toBeCloseTo(SURVIVAL_VALUE.toy * mult, 9);
    expect(Object.keys(state.market.index)).not.toContain('log');
    // selling Survival goods to an export depot does not press them
    market.sellExport('log', 100, new THREE.Vector3());
    expect(market.unitValue('log')).toBeCloseTo(SURVIVAL_VALUE.log * mult, 9);
  });

  it('only moves materials of reached eras and keeps every index inside the band', () => {
    const { market, state } = setup({ age: 4, rng: seeded(3) });
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 3000; i++) {
      market.update(MARKET.tick);
      for (const v of Object.values(state.market.index)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    expect(lo).toBeGreaterThanOrEqual(MARKET.min);
    expect(hi).toBeLessThanOrEqual(MARKET.max);
    expect(hi - lo).toBeGreaterThan(0.2);
    expect(state.market.index.stone).toBeDefined();
    expect(state.market.index.steel).toBeUndefined();
    expect(market.index('robot')).toBe(1);
    expect(market.tradable().every((k) => MATERIALS[k].era <= 4)).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const a = setup({ rng: seeded(11) });
    const b = setup({ rng: seeded(11) });
    run(a.market, 300);
    run(b.market, 300);
    expect(a.state.market.index).toEqual(b.state.market.index);
    expect(a.market.history('brick')).toEqual(b.market.history('brick'));
  });

  it('keeps a sparkline history of MARKET.history points (seeded, never flat) that rolls on ticks', () => {
    const { market } = setup();
    const h = market.history('stone');
    expect(h.length).toBe(MARKET.history);
    expect(new Set(h).size).toBeGreaterThan(5);
    expect(h[h.length - 1]).toBeCloseTo(market.unitValue('stone'), 9);
    run(market, MARKET.tick * 3);
    expect(market.history('stone').length).toBe(MARKET.history);
  });
});

describe('supply pressure', () => {
  it('builds up per unit sold (raw half), caps, lowers the price and decays', () => {
    const { market, state } = setup();
    const pos = new THREE.Vector3();
    const base = market.unitValue('brick');
    market.sellExport('brick', 50, pos);
    expect(state.market.pressure.brick).toBeCloseTo(50 * MARKET.pressurePerUnit, 9);
    expect(market.unitValue('brick')).toBeCloseTo(base * (1 - 50 * MARKET.pressurePerUnit), 6);
    market.sellExport('stone', 50, pos); // raw counts half
    expect(state.market.pressure.stone).toBeCloseTo(25 * MARKET.pressurePerUnit, 9);
    market.sellExport('brick', 5000, pos);
    expect(state.market.pressure.brick).toBe(MARKET.pressureMax);
    market.update(10);
    expect(state.market.pressure.brick).toBeCloseTo(MARKET.pressureMax - 10 * MARKET.pressureDecay, 9);
    market.update(1000);
    expect(state.market.pressure.brick).toBeUndefined();
    expect(market.pressure('brick')).toBe(0);
  });

  it('credits the export price and the stat, applies the era Trade upgrade', () => {
    const { market, economy, state } = setup({ money: 0, upgrades: { frontierTrade: 1.5 } });
    const expected = Math.round(market.unitValue('stone') * 10 * 1.5);
    const paid = market.sellExport('stone', 10, new THREE.Vector3());
    expect(paid).toBe(expected);
    expect(economy.money).toBe(expected);
    expect(state.stats.materialsSold).toBe(10);
  });
});

describe('trading', () => {
  it('quotes the spread, shrinking with the Broker upgrade', () => {
    const a = setup();
    const v = a.market.unitValue('stone');
    expect(a.market.quote('stone', 'buy')).toBeCloseTo(v * (1 + MARKET.spread), 9);
    expect(a.market.quote('stone', 'sell')).toBeCloseTo(v * (1 - MARKET.spread), 9);
    const b = setup({ upgrades: { broker: 2 } });
    expect(b.market.quote('stone', 'buy')).toBeCloseTo(v * (1 + MARKET.spread / 2), 9);
  });

  it('buys at the buy quote, tracks the average basis, refuses what it cannot afford or is not tradable', () => {
    const { market, economy, state, log } = setup({ money: 100_000 });
    expect(market.buy('stone', 10)).toBe(true);
    const cost1 = Math.round(1800 * 1.05 * 10); // stone: 180 × the era economy ×10
    expect(economy.money).toBe(100_000 - cost1);
    expect(market.holding('stone')).toBe(10);
    expect(state.market.basis.stone).toBeCloseTo(cost1 / 10, 9);
    // the price moves: the basis averages
    state.market.index.stone = 1.5;
    market.buy('stone', 10);
    const cost2 = Math.round(market.quote('stone', 'buy') * 10);
    expect(market.basis('stone')).toBeCloseTo((cost1 + cost2) / 20, 6);
    expect(log.filter((l) => l.type === 'market:trade').length).toBe(2);
    expect(market.buy('stone', 1_000_000)).toBe(false);
    expect(market.holding('stone')).toBe(20);
    expect(market.buy('robot', 1)).toBe(false); // era 10, not reached
    expect(market.buy('stone', 0)).toBe(false);
  });

  it('sells for the sell quote, counts only gains as tradeProfit, announces income for gains', () => {
    const { market, economy, state, log } = setup({ money: 1_000_000 });
    market.buy('brick', 10); // 7,000 base
    state.market.index.brick = 1.4;
    const money0 = economy.money;
    const q = market.quote('brick', 'sell');
    expect(market.sell('brick', 4)).toBe(true);
    const proceeds = Math.round(q * 4);
    expect(economy.money).toBe(money0 + proceeds);
    const profit = proceeds - market.basis('brick') * 4;
    expect(profit).toBeGreaterThan(0);
    expect(state.stats.tradeProfit).toBeCloseTo(profit, 6);
    expect(market.holding('brick')).toBe(6);
    const trade = log.filter((l) => l.type === 'market:trade').pop()!.payload as { side: string; profit: number; amount: number };
    expect(trade).toMatchObject({ side: 'sell', amount: proceeds });
    expect(trade.profit).toBeCloseTo(profit, 6);
    const income = log.filter((l) => l.type === 'income');
    expect(income.length).toBe(1);
    expect((income[0]!.payload as { source: string }).source).toBe('trade');
    // selling a loss adds nothing to the stat and no income event
    state.market.index.brick = 0.6;
    const before = state.stats.tradeProfit;
    market.sell('brick', 6);
    expect(state.stats.tradeProfit).toBe(before);
    expect(log.filter((l) => l.type === 'income').length).toBe(1);
    expect(market.holding('brick')).toBe(0);
    expect(state.market.basis.brick).toBeUndefined();
    expect(market.sell('brick', 1)).toBe(false);
  });

  it('a buy then an immediate sell always loses the spread', () => {
    const { market, economy } = setup({ money: 1_000_000 });
    const m0 = economy.money;
    market.buy('stone', 100);
    market.sell('stone', 100);
    expect(economy.money).toBeLessThan(m0);
  });

  it('selling held units presses the price (half a physical export)', () => {
    const { market, state } = setup();
    market.buy('brick', 100);
    market.sell('brick', 100);
    expect(state.market.pressure.brick).toBeCloseTo(100 * MARKET.pressurePerUnit * 0.5, 9);
  });
});

describe('physical orders', () => {
  it('spends the buy quote plus delivery and emits market:order, capped at 24 units', () => {
    const { market, economy, log } = setup({ money: 100_000 });
    const m0 = economy.money;
    expect(market.order('stone', 100, 2)).toBe(true);
    expect(m0 - economy.money).toBe(market.orderCost('stone', ORDER_MAX_UNITS));
    expect(m0 - economy.money).toBe(Math.round(market.quote('stone', 'buy') * 24 * (1 + MARKET.delivery)));
    expect(log.find((l) => l.type === 'market:order')!.payload).toEqual({ kind: 'stone', count: 24, era: 2, amount: m0 - economy.money });
  });

  it('refuses locked regions, untradable kinds and an empty wallet', () => {
    const { market, state } = setup({ age: 3, money: 100 });
    expect(market.order('stone', 1, 2)).toBe(false); // $100 < price
    state.eras.regions[4]!.unlocked = false;
    const rich = setup({ age: 3, money: 1e6 });
    expect(rich.market.order('stone', 5, 4)).toBe(false); // era 4 not reached
    expect(rich.market.order('coal', 5, 3)).toBe(false); // coal is era 4
    expect(rich.market.order('ore', 5, 3)).toBe(true);
    expect(rich.market.order('ore', 5, 1)).toBe(false);
  });

  it('an order carried straight to an export depot never earns more than it cost', () => {
    const { market } = setup({ upgrades: { frontierTrade: 2.4 } });
    expect(market.exportPrice('brick', 24)).toBeLessThan(market.orderCost('brick', 24));
  });

  it('Renown (settlement 50) and a maxed broker still leave the order → depot loop at a loss', () => {
    const { market, state } = setup({ age: 10, upgrades: { frontierTrade: 2.4, broker: 10 } });
    state.village.greatLodge.tier = 0;
    state.village.level = 5;
    state.eras.settlement = 50;
    expect(market.exportPrice('brick', 24)).toBeLessThan(market.orderCost('brick', 24));
  });
});

describe('investments', () => {
  it('lists products by era', () => {
    expect(setup({ age: 1 }).market.products()).toEqual([]);
    expect(setup({ age: 2 }).market.products()).toEqual(['bond', 'index']);
    expect(setup({ age: 3 }).market.products()).toEqual(['bond', 'index', 'venture']);
  });

  it('refuses below the minimum, above the wallet, locked products and a full book', () => {
    const { market, economy } = setup({ age: 3, money: 50_000 });
    expect(market.invest('bond', INVEST.bond.min - 1)).toBe(false);
    expect(market.invest('index', 1e9)).toBe(false);
    expect(market.invest('venture', INVEST.venture.min, 9)).toBe(false); // era 9 not reached
    expect(market.invest('venture', INVEST.venture.min - 1, 3)).toBe(false);
    expect(economy.money).toBe(50_000);
    for (let i = 0; i < INVEST_MAX_POSITIONS; i++) expect(market.invest('index', 1000)).toBe(true);
    expect(market.invest('index', 1000)).toBe(false);
    expect(economy.money).toBe(50_000 - 12_000);
    const none = setup({ age: 1, money: 1e6 });
    expect(none.market.invest('bond', 1000)).toBe(false);
  });

  it('bond: principal until the lock ends, then principal × (1 + rate × √broker)', () => {
    const { market, economy, log } = setup({ money: 100_000, upgrades: { broker: 2.25 } });
    expect(market.invest('bond', 10_000)).toBe(true);
    const pos = market.positions()[0]!;
    expect(pos.value).toBe(10_000);
    run(market, INVEST.bond.lock! - 5, 5);
    expect(pos.value).toBe(10_000);
    expect(market.maturesIn(pos)).toBeGreaterThan(0);
    const changed = log.filter((l) => l.type === 'invest:changed').length;
    run(market, 10, 5);
    expect(market.matured(pos)).toBe(true);
    expect(pos.value).toBeCloseTo(10_000 * (1 + INVEST.bond.rate * 1.5), 6);
    expect(log.filter((l) => l.type === 'invest:changed').length).toBe(changed + 1); // matured, announced once
    run(market, 600, 5);
    expect(pos.value).toBeCloseTo(10_000 * (1 + INVEST.bond.rate * 1.5), 6); // stays there
    const m0 = economy.money;
    const pay = market.withdraw(pos.id);
    expect(pay).toBe(Math.round(10_000 * (1 + INVEST.bond.rate * 1.5)));
    expect(economy.money).toBe(m0 + pay);
    expect(market.positions().length).toBe(0);
    expect(log.some((l) => l.type === 'income' && (l.payload as { source: string }).source === 'interest')).toBe(true);
  });

  it('withdrawing a bond early returns the principal only (no gain, no income)', () => {
    const { market, economy, state, log } = setup({ money: 100_000 });
    market.invest('bond', 10_000);
    run(market, 100, 5);
    const m0 = economy.money;
    expect(market.withdraw(market.positions()[0]!.id)).toBe(10_000);
    expect(economy.money).toBe(m0 + 10_000);
    expect(state.stats.investEarned).toBe(0);
    expect(log.some((l) => l.type === 'income')).toBe(false);
    expect(market.withdraw(999)).toBe(0);
  });

  it('caps the bonds at BOND_CAP_SHARE of net worth', () => {
    const { market, economy } = setup({ money: 100_000 });
    expect(market.bondRoom()).toBe(Math.floor(BOND_CAP_SHARE * 100_000));
    expect(market.invest('bond', 50_001)).toBe(false);
    expect(market.invest('bond', 30_000)).toBe(true);
    expect(market.bondRoom()).toBe(20_000); // net worth is unchanged by the deposit
    expect(market.invest('bond', 20_001)).toBe(false);
    expect(market.invest('bond', 20_000)).toBe(true);
    expect(economy.money).toBe(50_000);
    expect(market.invest('bond', 1000)).toBe(false);
    expect(market.invest('index', 1000)).toBe(true); // other products are not capped
  });

  it('index fund positions follow the fund; the fund drifts up and stays positive', () => {
    const { market, state } = setup({ age: 2, money: 100_000, rng: seeded(5) });
    market.invest('index', 10_000);
    const pos = market.positions()[0]!;
    const f0 = state.market.fund;
    run(market, 120, MARKET.tick);
    expect(state.market.fund).not.toBe(f0);
    expect(pos.value / pos.principal).toBeCloseTo(state.market.fund / f0, 6);
    let sum = 0;
    for (let k = 0; k < 20; k++) {
      const t = setup({ age: 2, rng: seeded(100 + k) });
      run(t.market, 1800, MARKET.tick);
      expect(t.state.market.fund).toBeGreaterThan(0);
      sum += t.state.market.fund;
    }
    expect(sum / 20).toBeGreaterThan(1); // positive drift over half an hour
  });

  it('venture positions move with their era and never go negative; withdraw pays value and counts the gain', () => {
    const { market, state, economy } = setup({ age: 3, money: 100_000, rng: seeded(9) });
    market.invest('venture', 20_000, 3);
    const pos = market.positions()[0]!;
    expect(pos.era).toBe(3);
    run(market, 600, MARKET.tick);
    expect(pos.value).toBeGreaterThanOrEqual(0);
    expect(pos.value).not.toBe(20_000);
    const m0 = economy.money;
    const pay = market.withdraw(pos.id);
    expect(pay).toBe(Math.round(pos.value));
    expect(economy.money).toBe(m0 + pay);
    expect(state.stats.investEarned).toBe(Math.max(0, pay - 20_000));
    market.invest('venture', 20_000); // era 0 = the newest era
    expect(market.positions()[0]!.era).toBe(3);
  });
});

describe('net worth', () => {
  it('adds holdings at the sell quote and the positions values to the cash', () => {
    const { market, economy, state } = setup({ money: 2_000_000 });
    expect(market.netWorth()).toBe(2_000_000);
    market.buy('stone', 100);
    market.invest('bond', 10_000);
    market.invest('index', 20_000);
    state.market.index.stone = 1.2;
    const expected = economy.money + 100 * market.quote('stone', 'sell') + 10_000 + 20_000;
    expect(market.netWorth()).toBeCloseTo(expected, 6);
  });
});

describe('jack', () => {
  it('pays the jack share of the unit value (at least $1, nothing for cash) and counts jackEarned', () => {
    const { market, economy, state } = setup({ money: 0, upgrades: { jack: 0.5 } });
    expect(market.jackOffer('cash')).toBe(0);
    expect(market.jackOffer('log')).toBe(Math.max(1, Math.round(market.unitValue('log') * 0.5)));
    expect(market.sellToJack('plank', new THREE.Vector3())).toBe(market.jackOffer('plank'));
    expect(economy.money).toBe(market.jackOffer('plank'));
    expect(state.stats.jackEarned).toBe(economy.money);
    expect(market.sellToJack('cash', new THREE.Vector3())).toBe(0);
  });
});

describe('money loops', () => {
  it('cannot print money by crashing a price with a sale and buying back cheap', () => {
    const { market, economy, state } = setup({ age: 2, money: 1e7, rng: () => 0.5 });
    const m0 = economy.money;
    expect(market.buy('brick', 400)).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(market.sell('brick', 400)).toBe(true);
      expect(state.market.pressure.brick).toBeGreaterThan(0);
      expect(market.buy('brick', 400)).toBe(true); // pressure lowers what sellers get, not what buyers pay
      run(market, 60);
    }
    market.sell('brick', 400);
    expect(economy.money).toBeLessThan(m0);
  });

  it('prices an order without the supply-pressure discount, so a crash-time order never exports at a profit', () => {
    const { market, state } = setup({ age: 2, rng: () => 0.5 });
    const calm = market.orderCost('brick', ORDER_MAX_UNITS);
    state.market.pressure.brick = MARKET.pressureMax;
    expect(market.orderCost('brick', ORDER_MAX_UNITS)).toBe(calm);
    expect(calm).toBeGreaterThan(market.exportPrice('brick', ORDER_MAX_UNITS) / (1 - MARKET.pressureMax));
  });

  it('does not count withdrawn principal or a sale\'s cost basis as money earned', () => {
    const { market, economy, state } = setup({ age: 2, money: 100_000, rng: () => 0.5 });
    const m0 = economy.money;
    expect(market.invest('bond', 20_000)).toBe(true);
    market.withdraw(state.market.investments[0]!.id); // early: principal back
    expect(economy.money).toBe(m0);
    expect(state.stats.moneyEarned).toBe(0);
    market.buy('brick', 10);
    market.sell('brick', 10); // a loss: nothing earned
    expect(state.stats.moneyEarned).toBe(0);
    // only the gain counts
    expect(market.invest('bond', 20_000)).toBe(true);
    const pos = state.market.investments[0]!;
    pos.age = INVEST.bond.lock ?? 0;
    pos.value = 21_000;
    market.withdraw(pos.id);
    expect(state.stats.moneyEarned).toBe(1_000);
  });

  it('Economy.add still counts plain income in full', () => {
    const { economy, state } = setup({ money: 0 });
    economy.add(500);
    expect(state.stats.moneyEarned).toBe(500);
    economy.add(300, 100);
    expect(economy.money).toBe(800);
    expect(state.stats.moneyEarned).toBe(600);
  });
});
