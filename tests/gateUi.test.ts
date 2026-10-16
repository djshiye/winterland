/**
 * The climb's UI logic (docs/EXPANSION.md order, step 7): the checklist order and helpers (eras/gate.ts openRows,
 * rowBuyable, gateCount, nextGoal's banner hint), the checklist's Go targets (ui/GateCard.ts rowTarget / goTarget:
 * upgrades are hands-on, every row sends the player to the pad or shop mat where it is bought), the computed
 * 'gate:progress' (eras/GateTracker.ts) and the shop's band view (ui/agesLogic.ts bandView, gateRowLine). The panels
 * only render what these say (checked by screenshots).
 */
import { describe, expect, it } from 'vitest';
import { LAYOUT, QUARTERS, UPGRADES, VILLAGE } from '../src/config';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { createGameState, type GameContext, type GameEvents, type GameState, type PadId, type UpgradeId } from '../src/core/types';
import { Upgrades } from '../src/core/Upgrades';
import { eraGate, eraMatOf, gateCount, gateSize, nextGoal, openRows, padTarget, prereqTarget, rowBuyable, settlementGoal } from '../src/eras/gate';
import { GateTracker } from '../src/eras/GateTracker';
import { CITY_BUILDINGS, DISTRICTS } from '../src/eras/data';
import { bandView, BAND_PIPS, gateRowLine, shopDelta } from '../src/ui/agesLogic';
import { goTarget, rowTarget } from '../src/ui/GateCard';
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

  it('settlementGoal: a district with no free lot asks for a swap (a chosen, unpaid lot is taken)', () => {
    const t = lodge();
    t.eras.age = 2;
    const park = Object.values(CITY_BUILDINGS).find((d) => d.era === 2 && d.kind === 'park')!.id;
    const lots = t.city.districts[2]!.lots;
    lots.forEach((l, i) => Object.assign(l, { building: park, tier: i === 0 ? -1 : 0 }));
    const goal = settlementGoal(t, eraGate(t, 3));
    expect(goal.text).toBe(`Swap a park or shop for a home in ${DISTRICTS[2]!.name} → Settlement 6`);
    expect(goal.action).toEqual({ kind: 'build', target: 'district:2' });
    lots[0]!.building = '';
    expect(settlementGoal(t, eraGate(t, 3)).text).toMatch(/^Build a home in /);
  });
});

describe('upgrades are hands-on', () => {
  it('one level per buy, no multi-level or remote presses on Upgrades', () => {
    const s = lodge();
    const { up, bought } = make(s, 1e12);
    expect(up.buy('carry')).toBe(true);
    expect(bought).toHaveLength(1);
    expect(bought[0]).toEqual({ id: 'carry', level: s.upgrades.carry, position: null });
    for (const gone of ['buyMany', 'raiseTo', 'raiseAll']) expect(gone in up, gone).toBe(false);
  });

  it("every checklist row goes where it is bought: the cabin mat, its era's mat, the level pad, what unlocks it", () => {
    const s = lodge();
    s.eras.age = 3;
    for (let n = 2; n <= 3; n++) s.eras.regions[n]!.unlocked = true;
    const ctx = { state: s };
    const seen = new Set<string>();
    // era 2's gate is Survival's (cabin mat, machine pads); era 4's is era 3's own (its mat, its machines' level pads)
    for (const g of [eraGate(s, 2), eraGate(s, 4)]) {
      for (const r of g.rows) {
        const t = rowTarget(r, s);
        const e = eraMatOf(UPGRADES[r.id]);
        if (r.state === 'prereq') expect(t, r.id).toBe(prereqTarget(r.id, s));
        else if (r.where === 'pad') expect(t, r.id).toBe(padTarget(r.id));
        else if (e !== null) expect(t, r.id).toBe(`shop:${e}`);
        else expect(t, r.id).toBe('shop');
        seen.add(t.startsWith('shop:') ? 'era shop' : t.replace(/:.*/, ''));
        if (r.state !== 'prereq') expect(goTarget(ctx, t), r.id).not.toBeNull();
      }
    }
    for (const kind of ['shop', 'era shop', 'pad', 'region']) expect(seen.has(kind), kind).toBe(true);
    // the cabin's shop mat: the player lands on it, so the shop opens
    const m = LAYOUT.shop.mat;
    const at = goTarget(ctx, 'shop')!;
    expect(at.x).toBeGreaterThan(m.minX);
    expect(at.x).toBeLessThan(m.maxX);
    expect(at.z).toBeGreaterThan(m.minZ);
    expect(at.z).toBeLessThan(m.maxZ);
    // an era shop mat only once its region is reached
    expect(goTarget(ctx, 'shop:3')).not.toBeNull();
    expect(goTarget(ctx, 'shop:4')).toBeNull();
    expect(goTarget(ctx, 'shop:11')).toBeNull();
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
    expect(seen[0]).toMatchObject({ era: 2, ok: 2, total: 28, gained: 2, ready: false, readyNow: false });
    tick();
    expect(seen).toHaveLength(1); // nothing new: no event
    bump(events, 'axe'); // a level that finishes no row
    tick();
    expect(seen).toHaveLength(1);
    meetGate(s, 2);
    bump(events, 'jack');
    tick();
    expect(seen[1]).toMatchObject({ ok: 28, gained: 26, ready: true, readyNow: true });
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
    s.upgrades.frontierRigs = 10; // literal mode: era 3's gate is era 2's own upgrades
    bump(events, 'frontierRigs');
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
    expect(gateRowLine(pad)).toMatch(/^pad LV \d+ → LV 10 · \$/);
    const shop = g.rows.find((r) => r.id === 'carry')!;
    expect(gateRowLine(shop)).toMatch(/^Lv 0 → 10 · \$.+ in all$/);
    const crew = g.rows.find((r) => r.shown === null)!;
    expect(gateRowLine(crew)).toMatch(/^Not hired → 10/);
    const pre = eraGate(lodge(), 2).rows.find((r) => r.state === 'prereq')!;
    expect(gateRowLine(pre)).toBe(pre.prereq);
  });
});

describe("the shop card's effect line", () => {
  it('says a level past the hard cap only adds Mastery during the climb', () => {
    expect(shopDelta('40 items', '45 items', true)).toBe('40 items → 45 items');
    expect(shopDelta('50 items', '50 items', true)).not.toContain('Mastery'); // 0.9.6: never promises Mastery
    expect(shopDelta('50 items', null, false)).toBe('50 items (max)');
    expect(shopDelta('50 items', '50 items', false)).toBe('50 items → 50 items');
  });
});
