/**
 * 0.9.0 market (core/Market.ts): deterministic prices (seeded RNG), Survival goods fixed, supply pressure, trading
 * spread and profit, physical orders, bonds (lock, maturity, early withdrawal, cap), index fund, net worth.
 * Built on a fake GameContext (real Economy + EventBus, a stub Upgrades).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { CLIMB, UPGRADES } from '../src/config';
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

  it('credits the export price and the stat, applies the material\'s sales upgrade (Trade and Fine merged, 0.9.6)', () => {
    const { market, economy, state } = setup({ money: 0, upgrades: { stoneQuality: 1.5 } });
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
    expect(market.invest('index', 1000)).toBe(true); // each product has its own room
  });

  it('index fund positions grow on the trend with a small wobble; the market mood stays in its band', () => {
    let sum = 0;
    for (let k = 0; k < 20; k++) {
      const t = setup({ age: 2, money: 100_000, rng: seeded(100 + k) });
      t.market.invest('index', 10_000);
      run(t.market, 600, MARKET.tick);
      expect(t.state.market.fund).toBeGreaterThan(1 - (INVEST.index.dip ?? 0) - 1e-9);
      expect(t.state.market.fund).toBeLessThan(1 + (INVEST.index.rise ?? 0) + 1e-9);
      sum += t.market.positions()[0]!.value / 10_000;
    }
    const trend = (1 + INVEST.index.rate) ** (600 / 3600);
    expect(sum / 20).toBeGreaterThan(trend * 0.97); // about the trend over 10 minutes
    expect(sum / 20).toBeLessThan(trend * 1.03);
  });

  // 0.9.6 (validation of PR #35): a little better than bonds (+12% per 10 minutes, locked), with no lock but some risk
  it('the fund beats a bond over 10 minutes on average; a venture beats the fund on average', () => {
    let idx = 0;
    let ven = 0;
    for (let k = 0; k < 40; k++) {
      const t = setup({ age: 5, money: 1e6, rng: seeded(900 + k) });
      t.market.invest('index', 100_000);
      t.market.invest('venture', 100_000, 5);
      run(t.market, 600, MARKET.tick);
      idx += t.market.positions()[0]!.value / 100_000 / 40;
      ven += t.market.positions()[1]!.value / 100_000 / 40;
    }
    expect(idx).toBeGreaterThan(1 + INVEST.bond.rate);
    expect(ven).toBeGreaterThan(idx);
  });

  // 0.9.6 (CODE_AUDIT P0-2): 0.9.5 compounded the fund and ventures per minute, uncapped ($1B overnight became >$1T)
  it('a night away never beats the ceiling: at most ×2 (fund) and ×3 (ventures) plus the wobble, for every seed', () => {
    for (const product of ['index', 'venture'] as const) {
      const def = INVEST[product];
      let worst = 0;
      for (let k = 0; k < 12; k++) {
        const t = setup({ age: 5, money: 1e9, rng: seeded(500 + k) });
        // a hot market (every index at the top) leans the wobble its way: still capped
        if (k % 2 === 0) for (const kind of Object.keys(MATERIALS) as (keyof typeof MATERIALS)[]) t.state.market.index[kind] = MARKET.max;
        expect(t.market.invest(product, 1e8, product === 'venture' ? 5 : 0)).toBe(true);
        run(t.market, 8 * 3600, MARKET.tick * 20); // 20 price ticks a step, the most one update runs
        worst = Math.max(worst, t.market.positions()[0]!.value / 1e8);
      }
      expect(worst, product).toBeLessThanOrEqual((def.top ?? 1) * (1 + (def.rise ?? 0)) + 1e-9);
      expect(worst, product).toBeGreaterThan(1.5);
    }
  }, 30_000); // eight simulated hours per seed

  // 0.9.6 (validation of PR #35): with caps from net worth alone, rolling bonds every 10 minutes and re-investing
  // the gains grew money ×1.76 an hour with the factories idle (×84 overnight). The caps now follow recent sales.
  it('caps each product at capMinutes of recent sales; with no sales nothing new goes in', () => {
    const t = setup({ age: 3, money: 1e9 });
    let rate = 1000;
    t.market.setSalesRate(() => rate);
    for (const p of ['bond', 'index', 'venture'] as const) {
      expect(t.market.room(p)).toBe(INVEST[p].capMinutes * 60 * 1000);
      expect(t.market.cappedBySales(p)).toBe(true);
    }
    rate = 0;
    expect(t.market.invest('bond', INVEST.bond.min)).toBe(false);
    expect(t.market.invest('index', INVEST.index.min)).toBe(false);
  });

  // 0.9.11: 0.9.6 allowed about +50% of sales (+58% with the Broker); the era pacing curve leaves investing out, so an
  // investor cleared eras a third faster. Every strategy below (hold to the top, sell on a wobble peak, churn on any
  // gain), checked every price tick, now adds about +10% to +14% of what the factories earn.
  it('no investing strategy adds more than ~15% to what the factories earn (a side bonus, not a second factory)', () => {
    const rate = 100_000; // $/s the meter reads, as if the factories kept selling (generous: no sales are paid in)
    const H = 3600;
    const strategies = {
      hold: (w: number, top: boolean) => top,
      peak: (w: number, top: boolean) => w >= 1.06 || (top && w >= 1),
      churn: (w: number) => w > 1.01,
    };
    for (const [broker, most] of [[1, 0.13], [CLIMB.bondBrokerMax, 0.16]] as const) {
      for (const [name, sell] of Object.entries(strategies)) {
        let sum = 0;
        for (const seed of [11, 12, 13]) {
          const t = setup({ age: 5, money: 1e12, rng: seeded(seed), upgrades: { broker } });
          t.market.setSalesRate(() => rate);
          const start = t.market.netWorth();
          for (let s = 0; s < 4 * H; s += MARKET.tick) {
            for (const p of [...t.market.positions()]) {
              if (p.product === 'bond') {
                if (t.market.matured(p)) t.market.withdraw(p.id);
                continue;
              }
              const def = INVEST[p.product];
              const trend = p.principal * Math.min(def.top ?? 1, (1 + def.rate) ** (p.age / H));
              if (sell(p.value / trend, trend >= p.principal * (def.top ?? 1) - 1e-6)) t.market.withdraw(p.id);
            }
            t.market.invest('bond', t.market.room('bond'));
            t.market.invest('index', t.market.room('index'));
            t.market.invest('venture', t.market.room('venture'), 5);
            t.market.update(MARKET.tick);
          }
          sum += (t.market.netWorth() - start) / (rate * 4 * H);
        }
        const share = sum / 3;
        expect(share, `broker ${broker} ${name}`).toBeGreaterThan(0.05); // still worth doing
        expect(share, `broker ${broker} ${name}`).toBeLessThan(most);
      }
    }
  }, 60_000);

  it('caps the index fund and ventures at their share of net worth, like bonds', () => {
    const { market } = setup({ age: 3, money: 100_000 });
    expect(market.room('index')).toBe(Math.floor(INVEST.index.cap * 100_000));
    expect(market.invest('index', market.room('index') + 1)).toBe(false);
    expect(market.invest('index', market.room('index'))).toBe(true);
    expect(market.room('index')).toBe(0);
    expect(market.invest('index', 1000)).toBe(false);
    expect(market.room('venture')).toBe(Math.floor(INVEST.venture.cap * 100_000));
    expect(market.invest('venture', market.room('venture') + 1, 3)).toBe(false);
    expect(market.invest('venture', market.room('venture'), 3)).toBe(true);
    expect(market.invest('bond', 10_000)).toBe(true); // each product has its own room
  });

  it('a position from an older save that already grew past the band keeps its value and stops growing', () => {
    const { market, state } = setup({ age: 3, money: 1e6, rng: seeded(3) });
    state.market.investments.push({ id: 99, product: 'venture', era: 3, principal: 10_000, value: 170_000, age: 3600 });
    run(market, 360, MARKET.tick);
    expect(state.market.investments[0]!.value).toBe(170_000);
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

  // 0.9.6 (CODE_AUDIT P0-1): 0.9.5's orderCost left the Quality bonus out, so an order sold at a region market counter
  // paid back ×0.87 at Fine Lv 0, ×1.42 at Lv 5 and ×2.06 at Lv 10
  it('an order carried to a region market counter never pays back its cost, at any sales level, season or index', () => {
    for (const kind of ['stone', 'brick'] as const) {
      for (let lv = 0; lv <= 10; lv++) {
        const q = UPGRADES[`${kind}Quality`].values[lv]!;
        for (const index of [MARKET.min, 1, MARKET.max]) {
          const { market, state } = setup({ age: 9, upgrades: { [`${kind}Quality`]: q }, rng: () => 0.5 });
          state.market.index[kind] = index;
          const cost = market.orderCost(kind, ORDER_MAX_UNITS);
          expect(market.marketPrice(kind, ORDER_MAX_UNITS), `${kind} Lv ${lv} @${index}`).toBeLessThan(cost);
          expect(market.exportPrice(kind, ORDER_MAX_UNITS), `${kind} Lv ${lv} @${index}`).toBeLessThan(cost);
        }
      }
    }
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
