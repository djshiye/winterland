/**
 * The climb's UI logic (docs/EXPANSION.md order, step 7): the checklist order and helpers (eras/gate.ts openRows,
 * rowBuyable, raiseReserve, gateCount, nextGoal's banner hint), the presses behind it (Upgrades.buyMany / raiseTo /
 * raiseAll with the batch flag), the computed 'gate:progress' (eras/GateTracker.ts) and the shop's band view
 * (ui/agesLogic.ts bandView, gateRowLine). The panels only render what these say (checked by screenshots).
 */
import { describe, expect, it } from 'vitest';
import { PRIORITIES, QUARTERS, UPGRADES, VILLAGE } from '../src/config';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { base, stepCost } from '../src/core/ladder';
import { createGameState, type GameContext, type GameEvents, type GameState, type PadId, type UpgradeId } from '../src/core/types';
import { Upgrades } from '../src/core/Upgrades';
import { eraGate, gateCount, gateSize, nextGoal, openRows, raiseReserve, rowBuyable, settlementGoal } from '../src/eras/gate';
import { GateTracker } from '../src/eras/GateTracker';
import { bandView, BAND_PIPS, gateRowLine } from '../src/ui/agesLogic';
import { meetGate } from './gateHelpers';

/** Winterland with the Great Lodge built: the climb is open, nothing upgraded. */
function lodge(): GameState {
  const s = createGameState();
  s.village.revealed = true;
  s.village.level = VILLAGE.levels.length - 1;
  s.village.greatLodge.tier = 0;
  return s;
}

/** Every machine pad unlocked and the top bunkhouse built: no upgrade has an unmet requirement left. */
function allBuilt(s: GameState): GameState {
  for (const k of Object.keys(s.unlocked) as PadId[]) s.unlocked[k] = true;
  s.quarters.tier = QUARTERS.tiers.length - 1;
  return s;
}

const make = (state: GameState, money: number) => {
  const events = new EventBus<GameEvents>();
  const economy = new Economy(events, state, money);
  const bought: GameEvents['upgrade:bought'][] = [];
  events.on('upgrade:bought', (e) => bought.push(e));
  return { events, economy, up: new Upgrades(state, economy, events), bought };
};

describe('the checklist helpers', () => {
  it('openRows: prereqs first, then the cheapest to finish; done rows left out', () => {
    const s = lodge();
    s.unlocked.harvester = true;
    s.upgrades.carry = 10; // done
    const rows = openRows(eraGate(s, 2));
    expect(rows.some((r) => r.id === 'carry')).toBe(false);
    const firstLow = rows.findIndex((r) => r.state !== 'prereq');
    expect(firstLow).toBeGreaterThan(0);
    expect(rows.slice(firstLow).every((r) => r.state === 'low')).toBe(true);
    expect(rows.slice(0, firstLow).every((r) => r.state === 'prereq')).toBe(true);
    const low = rows.slice(firstLow).map((r) => r.costToNeed);
    expect(low).toEqual([...low].sort((a, b) => a - b));
  });

  it('rowBuyable: shop and Industry rows, never a machine level pad or a prereq', () => {
    const g = eraGate(allBuilt(lodge()), 2);
    for (const r of g.rows) expect(rowBuyable(r)).toBe(r.state === 'low' && r.where !== 'pad');
    expect(g.rows.some((r) => r.where === 'pad' && !rowBuyable(r))).toBe(true);
    expect(g.rows.some((r) => r.where === 'shop' && rowBuyable(r))).toBe(true);
  });

  it("raiseReserve keeps the foreman's max($500, 20 %)", () => {
    expect(raiseReserve(0)).toBe(PRIORITIES.reserveMin);
    expect(raiseReserve(1000)).toBe(PRIORITIES.reserveMin);
    expect(raiseReserve(1_000_000)).toBe(1_000_000 * PRIORITIES.reserveShare);
  });

  it('gateCount agrees with eraGate (rows, settlement, ready) and gateSize with its row count', () => {
    const s = allBuilt(lodge());
    for (const tweak of [() => {}, () => (s.upgrades.speed = 10), () => meetGate(s, 2)]) {
      tweak();
      const g = eraGate(s, 2);
      const c = gateCount(s, 2);
      expect([c.ok, c.total, c.settlement, c.settlementNeed, c.ready]).toEqual([g.ok, g.total, g.settlement.level, g.settlementNeed, g.ready]);
      expect(gateSize(2)).toBe(g.total);
    }
    expect(gateSize(11)).toBe(0);
  });

  it('nextGoal: "$X to go" carries a steady hint for the guide banner', () => {
    const s = allBuilt(lodge());
    const goal = nextGoal(s, 0)!;
    expect(goal.text).toMatch(/to go$/);
    expect(goal.hint).toMatch(/^Save up: /);
    expect(goal.hint).not.toMatch(/\$/);
    const rich = nextGoal(s, 1e12)!;
    expect(rich.hint).toBeUndefined();
  });

  it('settlementGoal: the village below Winterland, a home in the era district after it', () => {
    const s = lodge();
    s.village.level = 3;
    expect(settlementGoal(s, eraGate(s, 2)).action).toEqual({ kind: 'build', target: 'village' });
    const t = lodge();
    t.eras.age = 2;
    const g = eraGate(t, 3);
    expect(settlementGoal(t, g).text).toMatch(/^Build a home in .+ \(\+\d+\) → Settlement 6$/);
    expect(settlementGoal(t, g).action).toEqual({ kind: 'build', target: 'district:2' });
  });
});

describe('Buy ×10, Buy to target, Raise all', () => {
  it('buyMany stops at k or when the money runs out; batch only when several levels can come from one press', () => {
    const s = lodge();
    const { up, economy, bought } = make(s, 1e12);
    expect(up.buyMany('carry', 10)).toBe(10);
    expect(bought.every((e) => e.batch === true)).toBe(true);
    bought.length = 0;
    expect(up.buyMany('carry', 1)).toBe(1);
    expect(bought[0]!.batch).toBeUndefined();
    economy.spend(economy.money);
    expect(up.buyMany('carry', 10)).toBe(0);
    // a plain buy after a batch is not a batch
    economy.add(1e12);
    bought.length = 0;
    up.buy('speed');
    expect(bought[0]!.batch).toBeUndefined();
  });

  it('raiseTo buys up to the shown target (offset ids included) and never past it', () => {
    const s = lodge();
    s.eras.age = 2;
    const { up } = make(s, 1e15);
    const from = s.upgrades.speed;
    expect(up.raiseTo('speed', 10)).toBe(10 - from);
    expect(up.shownLevel('speed')).toBe(10);
    expect(up.raiseTo('speed', 10)).toBe(0);
    up.raiseTo('taxOffice', 20);
    expect(up.shownLevel('taxOffice')).toBe(20);
    expect(s.upgrades.taxOffice).toBe(20 - base(UPGRADES.taxOffice));
  });

  it('raiseAll: cheapest next level first, every row up to its need, skipping prereqs, above the reserve', () => {
    const s = lodge();
    s.unlocked.harvester = true;
    const { up, economy } = make(s, 1e15);
    const g = eraGate(s, 2);
    const rows = g.rows.map((r) => ({ id: r.id, need: r.need }));
    const n = up.raiseAll(rows, 0);
    expect(n).toBeGreaterThan(0);
    for (const r of eraGate(s, 2).rows) {
      if (r.state === 'prereq') expect(r.shown ?? 0, r.id).toBeLessThan(10);
      else expect(r.state, r.id).toBe('ok');
    }
    expect(up.shownLevel('carry')).toBe(10);
    expect(up.shownLevel('workshop')).toBe(0); // the workshop is not built: its row is a prereq
    expect(economy.money).toBeGreaterThan(0);
  });

  it('raiseAll keeps the reserve and buys the cheapest step first', () => {
    const s = allBuilt(lodge());
    const ids: UpgradeId[] = ['carry', 'speed', 'axe'];
    const costs = ids.map((id) => stepCost(UPGRADES[id], s.upgrades[id]));
    const cheapest = ids[costs.indexOf(Math.min(...costs))]!;
    const { up, economy, bought } = make(s, Math.min(...costs) + 1000);
    expect(up.raiseAll(ids.map((id) => ({ id, need: 10 })), 1000)).toBe(1);
    expect(bought[0]!.id).toBe(cheapest);
    expect(bought[0]!.batch).toBe(true);
    expect(economy.money).toBeGreaterThanOrEqual(1000);
    expect(up.raiseAll(ids.map((id) => ({ id, need: 10 })), 1000)).toBe(0);
  });
});

describe("GateTracker ('gate:progress')", () => {
  const ctxOf = (state: GameState) => {
    const events = new EventBus<GameEvents>();
    const updatables: Array<{ update(dt: number): void }> = [];
    const ctx = { state, events, addUpdatable: (u: { update(dt: number): void }) => updatables.push(u) } as unknown as GameContext;
    const seen: GameEvents['gate:progress'][] = [];
    events.on('gate:progress', (e) => seen.push(e));
    const tick = (): void => updatables.forEach((u) => u.update(1 / 60));
    return { events, seen, tick, tracker: new GateTracker(ctx) };
  };
  const bump = (events: EventBus<GameEvents>, id: UpgradeId) => events.emit('upgrade:bought', { id, level: 0, position: null });

  it('is silent on load and below the Great Lodge', () => {
    const below = createGameState();
    const a = ctxOf(below);
    bump(a.events, 'carry');
    a.tick();
    expect(a.seen).toEqual([]);
    const loaded = allBuilt(lodge());
    loaded.upgrades.carry = 10;
    const b = ctxOf(loaded);
    b.tick();
    expect(b.seen).toEqual([]);
  });

  it('one event per frame with the rows gained, readyNow once when the gate is met', () => {
    const s = allBuilt(lodge());
    const { events, seen, tick } = ctxOf(s);
    s.upgrades.carry = 10;
    s.upgrades.speed = 10;
    bump(events, 'carry');
    bump(events, 'speed');
    tick();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ era: 2, ok: 2, total: 23, gained: 2, ready: false, readyNow: false });
    tick();
    expect(seen).toHaveLength(1); // nothing new: no event
    bump(events, 'axe'); // a level that finishes no row
    tick();
    expect(seen).toHaveLength(1);
    meetGate(s, 2);
    bump(events, 'jack');
    tick();
    expect(seen[1]).toMatchObject({ ok: 23, gained: 21, ready: true, readyNow: true });
    bump(events, 'jack');
    tick();
    expect(seen).toHaveLength(2);
  });

  it('a new era starts the next gate from where the upgrades are, without an event', () => {
    const s = allBuilt(lodge());
    meetGate(s, 2);
    const { events, seen, tick } = ctxOf(s);
    s.eras.age = 2;
    events.emit('era:unlocked', { era: 2, position: null as never });
    tick();
    expect(seen).toEqual([]);
    s.upgrades.carry = 20;
    bump(events, 'carry');
    tick();
    expect(seen[0]).toMatchObject({ era: 3, ok: 1, gained: 1 });
  });
});

describe('the shop band view (R5)', () => {
  it('ten pips for the band that ends at the gate level, the bands done on the star', () => {
    expect(bandView(9, 9, 0, true, 10)).toEqual({ fill: 9, bands: 0, text: 'Lv 9 · need 10', tone: 'low' });
    expect(bandView(10, 10, 0, true, 10)).toEqual({ fill: 10, bands: 1, text: 'Lv 10 ✓', tone: 'ok' });
    expect(bandView(14, 14, 0, true, 10)).toMatchObject({ fill: 10, tone: 'ok' });
    expect(bandView(23, 13, 10, true, 30)).toEqual({ fill: 3, bands: 2, text: 'Lv 23 · need 30', tone: 'low' });
    expect(bandView(4, 4, 0, true, 30).fill).toBe(0); // lagging two bands: an empty bar, the badge says why
    for (let s = 0; s <= 100; s++) expect(bandView(s, s, 0, true, null).fill).toBeLessThanOrEqual(BAND_PIPS);
  });

  it('"Not hired" for a crew at 0, "era standard" for an era upgrade that arrived at its offset', () => {
    expect(bandView(0, 0, 0, false, 10).text).toBe('Not hired · need 10');
    expect(bandView(10, 0, 10, false, null).text).toBe('Not hired');
    expect(bandView(10, 0, 10, true, null)).toMatchObject({ text: 'Lv 10 · era standard', tone: '' });
    // on arrival inside the next gate it still reads "era standard", and stays 'low' (the tab's gold dot)
    expect(bandView(10, 0, 10, true, 20)).toEqual({ fill: 0, bands: 1, text: 'Lv 10 · era standard', tone: 'low' });
    expect(bandView(11, 1, 10, true, 20).text).toBe('Lv 11 · need 20');
    expect(bandView(47, 47, 0, true, null)).toEqual({ fill: 7, bands: 4, text: 'Lv 47', tone: '' });
  });

  it('gateRowLine uses the unit of the place the row is bought (R6)', () => {
    const g = eraGate(allBuilt(lodge()), 2);
    const pad = g.rows.find((r) => r.where === 'pad')!;
    expect(gateRowLine(pad)).toMatch(/^pad LV \d+ → LV 11 · \$/);
    const shop = g.rows.find((r) => r.id === 'carry')!;
    expect(gateRowLine(shop)).toMatch(/^Lv 0 → 10 · \$.+ in all$/);
    const crew = g.rows.find((r) => r.shown === null)!;
    expect(gateRowLine(crew)).toMatch(/^Not hired → 10/);
    const pre = eraGate(lodge(), 2).rows.find((r) => r.state === 'prereq')!;
    expect(gateRowLine(pre)).toBe(pre.prereq);
  });
});
