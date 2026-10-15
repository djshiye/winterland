/**
 * The climb's step 8 (docs/EXPANSION.md §A1, §A2): Mastery (points past the hard caps → a bounded multiplier on sales,
 * exports and city income), the Steward toggle (the Settlement 20 perk), the Jack / Broker / bond caps, and the money
 * loops that must stay closed however far the climb goes: order → Jack, order → export depot, buy → sell.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CLIMB, ECONOMY, QUARTERS, UPGRADES, VILLAGE } from '../src/config';
import { climbMult, masteryOf, masteryTotal, renownMult, salePrice } from '../src/core/demand';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { hardCapStored, masteryMult, masteryPoints, maxStored, valueAt } from '../src/core/ladder';
import { Market, ORDER_MAX_UNITS } from '../src/core/Market';
import { mergeState, sanitizeState } from '../src/core/Save';
import { createGameState, type GameContext, type GameEvents, type GameState, type MaterialKind, type PadId, type UpgradeId } from '../src/core/types';
import { Upgrades } from '../src/core/Upgrades';
import { CITY_BUILDINGS, MARKET, MATERIALS, type CityBuildingId } from '../src/eras/data';
import { eraGate, raiseReserve, raiseRows, stewardActive, stewardUnlocked } from '../src/eras/gate';
import { Steward } from '../src/eras/Steward';
import { masteryLine, masteryTag } from '../src/ui/agesLogic';
import { settlementPerks } from '../src/ui/EraCard';
import { meetGate } from './gateHelpers';

// canvas textures (glow halos, signs) draw into a 2D context nobody looks at here
const noop: unknown = new Proxy(() => noop, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop), apply: () => noop });
vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });
const { City } = await import('../src/city/City');

const IDS = Object.keys(UPGRADES) as UpgradeId[];

/** Winterland with the Great Lodge built at `age` (regions up to it unlocked). */
function lodge(age = 1): GameState {
  const s = createGameState();
  s.village.revealed = true;
  s.village.level = VILLAGE.levels.length - 1;
  s.village.greatLodge.tier = 0;
  s.eras.age = age;
  for (let n = 2; n <= age; n++) s.eras.regions[n]!.unlocked = true;
  return s;
}

/** Every machine pad unlocked and the top bunkhouse built: no era-1 requirement left. */
function allBuilt(s: GameState): GameState {
  for (const k of Object.keys(s.unlocked) as PadId[]) s.unlocked[k] = true;
  s.quarters.tier = QUARTERS.tiers.length - 1;
  return s;
}

/** Everything at shown level 100 and Settlement 50: the far end of the climb. */
function finale(): GameState {
  const s = lodge(10);
  for (const id of IDS) s.upgrades[id] = maxStored(UPGRADES[id], true);
  s.eras.settlement = 50;
  s.prestige.season = 3;
  return s;
}

const make = (state: GameState, money: number) => {
  const events = new EventBus<GameEvents>();
  const economy = new Economy(events, state, money);
  const upgrades = new Upgrades(state, economy, events);
  const ctx = { events, state, economy, upgrades, addUpdatable: () => undefined } as unknown as GameContext;
  return { events, economy, upgrades, ctx };
};

describe('Mastery', () => {
  it('is 1 before the climb: no authored level reaches a cap, and nothing past the tables can be bought', () => {
    const s = allBuilt(createGameState());
    s.village.revealed = true;
    s.village.level = VILLAGE.levels.length - 2; // Winter City: everything era 1 sells, the Lodge not built
    const { upgrades } = make(s, 1e15);
    for (let pass = 0; pass < 20; pass++) for (const id of IDS) upgrades.buy(id);
    for (const id of IDS) if (UPGRADES[id].era === undefined && !UPGRADES[id].requires?.era) expect(s.upgrades[id], id).toBe(maxStored(UPGRADES[id], false));
    expect(masteryTotal(s)).toBe(0);
    expect(masteryOf(s)).toBe(1);
    expect(climbMult(s)).toBe(1);
  });

  it('counts one point per level bought at a hard cap, summed over every upgrade', () => {
    const s = lodge();
    const hc = hardCapStored(UPGRADES.carry)!;
    s.upgrades.carry = hc + 11;
    expect(masteryTotal(s)).toBe(11);
    s.upgrades.dog = hardCapStored(UPGRADES.dog)! + 4;
    expect(masteryTotal(s)).toBe(15);
    expect(masteryOf(s)).toBeCloseTo(masteryMult(15), 12);
    // the carry count itself stays at its cap
    expect(valueAt(UPGRADES.carry, s.upgrades.carry)).toBe(50);
    // at the finale every capped id pays its levels past the cap; uncapped ids (sales, taxOffice) none
    const f = finale();
    let want = 0;
    for (const id of IDS) want += masteryPoints(UPGRADES[id], f.upgrades[id]);
    expect(masteryTotal(f)).toBe(want);
    expect(want).toBeGreaterThan(500);
    expect(masteryOf(f)).toBeGreaterThan(1.5);
    expect(masteryOf(f)).toBeLessThan(2);
  });

  it('multiplies Survival sales (salePrice), exports and orders (Market) and city income alike', () => {
    const s = lodge(3);
    const before = { sale: salePrice(s, 'plank', ECONOMY.plankPrice, 400) };
    const m0 = make(s, 0);
    const market = new Market(m0.ctx, { rng: () => 0.5 });
    const exp0 = market.exportPrice('iron', 20);
    const ord0 = market.orderCost('iron', 20);
    s.upgrades.carry = hardCapStored(UPGRADES.carry)! + 40;
    const k = masteryMult(40);
    expect(climbMult(s)).toBeCloseTo(renownMult(s) * k, 12);
    expect(salePrice(s, 'plank', ECONOMY.plankPrice, 400) / before.sale).toBeCloseTo(k, 2);
    expect(market.exportPrice('iron', 20) / exp0).toBeCloseTo(k, 3);
    expect(market.orderCost('iron', 20) / ord0).toBeCloseTo(k, 3);
    // Jack pays no Mastery (share × unit value only)
    s.upgrades.carry = 0;
    const jack0 = market.jackOffer('iron');
    s.upgrades.carry = hardCapStored(UPGRADES.carry)! + 40;
    expect(market.jackOffer('iron')).toBe(jack0);
  });

  it('multiplies city income (City.incomeRate)', () => {
    const s = lodge(2);
    const home = Object.values(CITY_BUILDINGS).find((d) => d.era === 2 && d.kind === 'home')!.id as CityBuildingId;
    for (let i = 0; i < 3; i++) Object.assign(s.city.districts[2]!.lots[i]!, { building: home, tier: 0, cash: 0, extra: 0 });
    const city = new City(cityCtx(s));
    const r0 = city.incomeRate;
    expect(r0).toBeGreaterThan(0);
    s.upgrades.dog = hardCapStored(UPGRADES.dog)! + 30;
    expect(city.incomeRate / r0).toBeCloseTo(masteryMult(30), 9);
  });

  it('reads "✦ Mastery 340 · +41% on every sale" and the chip tag', () => {
    expect(masteryLine(340, masteryMult(340))).toBe(`✦ Mastery 340 · +${Math.round((masteryMult(340) - 1) * 100)}% on every sale`);
    expect(masteryTag(25, masteryMult(25))).toBe('✦ 25 · +12%');
  });
});

describe('caps', () => {
  it('Jack never pays a full unit value: share ≤ 0.90 at every level up to shown 100', () => {
    const d = UPGRADES.jack;
    for (let s = 0; s <= maxStored(d, true); s++) {
      expect(valueAt(d, s)).toBeLessThanOrEqual(0.9);
      expect(valueAt(d, s)).toBeLessThan(1);
    }
    expect(valueAt(d, maxStored(d, true))).toBe(0.9);
  });

  it('the Broker stops at 10 (a 0.5 % spread); bonds read it at most up to its authored top', () => {
    const d = UPGRADES.broker;
    for (let s = 0; s <= maxStored(d, true); s++) expect(valueAt(d, s)).toBeLessThanOrEqual(10);
    expect(valueAt(d, maxStored(d, true))).toBe(10);
    expect(valueAt(d, d.values.length - 1)).toBe(CLIMB.bondBrokerMax);
    const s = lodge(3);
    const { ctx } = make(s, 0);
    const market = new Market(ctx, { rng: () => 0.5 });
    s.upgrades.broker = d.values.length - 1;
    const top = market.bondPayout();
    const spreadTop = market.spread();
    s.upgrades.broker = maxStored(d, true);
    expect(market.bondPayout()).toBe(top);
    expect(market.spread()).toBeCloseTo(MARKET.spread / 10, 12);
    expect(market.spread()).toBeLessThan(spreadTop);
  });
});

describe('no money loop', () => {
  /** Every tradable material under every price extreme the market allows. */
  function* cases(s: GameState, market: Market): Generator<{ kind: MaterialKind; label: string }> {
    for (const kind of market.tradable()) {
      for (const index of [MARKET.min, 1, MARKET.max]) {
        for (const pressure of [0, MARKET.pressureMax]) {
          s.market.index[kind] = index;
          s.market.pressure[kind] = pressure;
          yield { kind, label: `${kind} index ${index} pressure ${pressure}` };
        }
      }
    }
  }

  const states: [string, () => GameState][] = [
    ['age 10, nothing upgraded, before the climb', () => {
      const s = createGameState();
      s.eras.age = 10;
      for (let n = 2; n <= 10; n++) s.eras.regions[n]!.unlocked = true;
      return s;
    }],
    ['mid climb (era 5 gate met, Settlement 20)', () => {
      const s = lodge(5);
      meetGate(s, 5);
      return s;
    }],
    ['the finale: every upgrade Lv 100, Settlement 50, full Mastery, season 3', finale],
  ];

  it.each(states)('order → Jack and order → export depot always lose money: %s', (_name, mk) => {
    const s = mk();
    const { ctx } = make(s, 0);
    const market = new Market(ctx, { rng: () => 0.5 });
    let n = 0;
    for (const { kind, label } of cases(s, market)) {
      for (const units of [1, 5, ORDER_MAX_UNITS]) {
        const cost = market.orderCost(kind, units);
        expect(market.exportPrice(kind, units), label).toBeLessThan(cost);
        expect(market.jackOffer(kind) * units, label).toBeLessThan(cost);
        expect(market.sellProceeds(kind, units), label).toBeLessThan(market.buyCost(kind, units));
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('an order carried to Jack loses at least 15 % even with the top Jack and the tightest spread', () => {
    const s = finale();
    const { ctx } = make(s, 0);
    const market = new Market(ctx, { rng: () => 0.5 });
    for (const kind of market.tradable()) {
      s.market.index[kind] = 1;
      expect(market.jackOffer(kind) * ORDER_MAX_UNITS / market.orderCost(kind, ORDER_MAX_UNITS), kind).toBeLessThan(0.85);
    }
    expect(Object.keys(MATERIALS).length).toBeGreaterThan(0);
  });
});

describe('the Steward (Settlement 20 perk)', () => {
  /** Era 4's gate open on a climbed state at Settlement `level`, every era-1 pad built. */
  function climbed(level: number): GameState {
    const s = allBuilt(lodge(3));
    meetGate(s, 3);
    s.eras.settlement = level;
    return s;
  }

  it('unlocks at Settlement 20 with the climb open, and works only while switched on with a next era', () => {
    expect(stewardUnlocked(climbed(19))).toBe(false);
    expect(stewardUnlocked(climbed(CLIMB.steward.settlement))).toBe(true);
    const s = climbed(20);
    expect(stewardActive(s)).toBe(false);
    s.eras.steward = true;
    expect(stewardActive(s)).toBe(true);
    s.eras.settlement = 15;
    expect(stewardActive(s)).toBe(false);
    const end = finale();
    end.eras.steward = true;
    expect(stewardUnlocked(end)).toBe(true);
    expect(stewardActive(end)).toBe(false); // past the last era: no checklist to raise
    const early = createGameState();
    early.eras.steward = true;
    early.eras.settlement = 25;
    expect(stewardActive(early)).toBe(false); // no Great Lodge: no climb
  });

  it('buys exactly one level per tick: the cheapest buyable row, above the reserve, silently', () => {
    const s = climbed(20);
    s.eras.steward = true;
    const { ctx, economy, events, upgrades } = make(s, 5e9);
    const bought: GameEvents['upgrade:bought'][] = [];
    events.on('upgrade:bought', (e) => bought.push(e));
    const steward = new Steward(ctx);
    const rows = raiseRows(eraGate(s, 4));
    expect(rows.length).toBeGreaterThan(0);
    const cheapest = rows.map((r) => ({ id: r.id, c: upgrades.nextCost(r.id)! })).sort((a, b) => a.c - b.c)[0]!;
    const before = economy.money;
    expect(steward.tick()).toBe(1);
    expect(bought).toHaveLength(1);
    expect(bought[0]).toMatchObject({ id: cheapest.id, batch: true });
    expect(economy.money).toBe(before - cheapest.c);
    // never a machine level pad (paid at the pad), never past the gate's need
    for (let i = 0; i < 50; i++) steward.tick();
    for (const e of bought) expect(UPGRADES[e.id].group).not.toBe('machine');
    for (const r of rows) expect(upgrades.shownLevel(r.id)).toBeLessThanOrEqual(r.need);
  });

  it('keeps the reserve and does nothing while off, below 20, or on a slow clock', () => {
    const s = climbed(20);
    const { ctx, economy } = make(s, 5e9);
    const steward = new Steward(ctx);
    expect(steward.tick()).toBe(0); // off
    s.eras.steward = true;
    s.eras.settlement = 19;
    expect(steward.tick()).toBe(0);
    s.eras.settlement = 20;
    // a wallet whose cheapest step would dig into the reserve
    const cheapest = Math.min(...raiseRows(eraGate(s, 4)).map((r) => ctx.upgrades.nextCost(r.id)!));
    economy.spend(economy.money - Math.floor(cheapest * 1.1));
    expect(economy.money - cheapest).toBeLessThan(raiseReserve(economy.money));
    expect(steward.tick()).toBe(0);
    // update() ticks once every CLIMB.steward.every seconds
    economy.add(5e9);
    let n = 0;
    const orig = steward.tick.bind(steward);
    steward.tick = () => {
      n++;
      return orig();
    };
    for (let t = 0; t < 10 * CLIMB.steward.every - 0.01; t += 0.1) steward.update(0.1);
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(10);
  });

  it('is saved: a boolean, false in every older save, kept on a round trip', () => {
    const s = createGameState();
    expect(s.eras.steward).toBe(false);
    const raw = JSON.parse(JSON.stringify(s));
    raw.eras.steward = 'yes';
    const t = createGameState();
    mergeState(t, raw);
    sanitizeState(t);
    expect(t.eras.steward).toBe(false);
    raw.eras.steward = true;
    const u = createGameState();
    mergeState(u, raw);
    sanitizeState(u);
    expect(u.eras.steward).toBe(true);
    delete raw.eras.steward;
    const v = createGameState();
    mergeState(v, raw);
    sanitizeState(v);
    expect(v.eras.steward).toBe(false);
  });

  it('the settlement card names the perk when Settlement 20 is crossed (once)', () => {
    expect(settlementPerks(20, 19, 1000)).toContain('Steward unlocked');
    expect(settlementPerks(22, 18, 1000)).toContain('Steward unlocked');
    expect(settlementPerks(21, 20, 1000)).not.toContain('Steward unlocked');
    expect(settlementPerks(19, 18, 1000)).not.toContain('Steward unlocked');
  });
});

/** A GameContext stub City can build on (no rendering is looked at). */
function cityCtx(state: GameState): GameContext {
  return {
    scene: new THREE.Scene(),
    state,
    events: new EventBus<GameEvents>(),
    addUpdatable: () => undefined,
    time: { elapsed: 0 },
    camera: new THREE.PerspectiveCamera(),
    player: { position: new THREE.Vector3(), arms: { count: () => 0 }, back: {} },
    economy: { money: 1e9, spend: () => true, add: () => undefined },
    upgrades: { value: () => 1 },
    colliders: { addBounds: () => undefined, addBox: () => ({}), remove: () => undefined },
    zones: {
      add: () => ({ enabled: false, setEnabled: () => undefined }),
      addTransfer: () => ({ enabled: false, setEnabled: () => undefined }),
      isPlayerIn: () => false,
    },
    tweens: { killTweensOf: () => undefined, popIn: () => undefined, run: () => undefined, punchScale: () => undefined, delay: () => undefined },
    particles: { puff: () => undefined, ring: () => undefined },
    audio: { play: () => undefined },
    items: { release: () => undefined, create: () => ({}) },
  } as unknown as GameContext;
}
