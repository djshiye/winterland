/** 0.9.6 clarity pass: era contracts and quest rewards (F9), MANAGE sign fade (F15), the Lv 10 rule text and gate groups. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONTRACTS, UPGRADES, VILLAGE } from '../src/config';
import { Contracts, contractItem, eraBonus, eraOffers } from '../src/core/Contracts';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { IncomeWindow, sig2Money } from '../src/core/incomeWindow';
import { QUEST_DEFS, QUEST_INCOME_SECONDS, Quests, questEra } from '../src/core/quests';
import { createGameState, type GameEvents, type GameState, type ItemKind } from '../src/core/types';
import { ERAS, MACHINES, MATERIALS, machinesOfEra, type MaterialKind } from '../src/eras/data';
import { eraGate, gateGroups, gateRuleShort, gateRuleText, openRows, waitsForSettlement } from '../src/eras/gate';
import { article } from '../src/ui/format';
import { MANAGE_FAR, MANAGE_NEAR, manageSignAlpha } from '../src/fx/manageSign';

function eraState(age: number): GameState {
  const s = createGameState();
  s.village.level = VILLAGE.levels.length - 1;
  s.village.greatLodge.tier = 0;
  s.eras.age = age;
  for (let n = 2; n <= age; n++) s.eras.regions[n]!.unlocked = true;
  return s;
}

function sale(events: EventBus<GameEvents>, kind: ItemKind, count: number, amount: number): void {
  events.emit('sale', { buyer: 'export', kind, count, amount, position: new THREE.Vector3() });
}

describe('era contracts (F9)', () => {
  it('era 1 keeps Survival offers; from era 2 a contract is one of the era goods its built machines make', () => {
    const s = eraState(5);
    expect(eraOffers(s, 5)).toEqual([]);
    const ids = machinesOfEra(5);
    s.eras.regions[5]!.slots[0] = { machine: ids[0]!, tier: 0, cash: 0, extra: 0 };
    s.eras.regions[5]!.slots[1] = { machine: ids[ids.length - 1]!, tier: -1, cash: 0, extra: 0 }; // not built yet
    const offers = eraOffers(s, 5);
    for (const o of offers) {
      expect(MATERIALS[o.kind as MaterialKind].era).toBe(5);
      expect(o.kind).toBe(MACHINES[ids[0]!].output);
    }
    const events = new EventBus<GameEvents>();
    const c = new Contracts(s, new Economy(events, s, 0), events);
    const offered: { kind: ItemKind; bonus: number; count: number }[] = [];
    events.on('contract:offered', (e) => offered.push(e));
    for (let i = 0; i < 10; i++) c.offer();
    for (const o of offered) {
      expect(CONTRACTS.offers.some((x) => x.kind === o.kind)).toBe(false); // never sausages or chairs
      expect(o.count).toBeGreaterThanOrEqual(CONTRACTS.era.count[0]);
      expect(o.count).toBeLessThanOrEqual(CONTRACTS.era.count[1]);
    }
    expect(offered.length).toBe(offers.length > 0 ? 10 : 0);
  });

  it('the bonus is a couple of minutes of recent sales, never less than half the goods are worth', () => {
    expect(eraBonus(0, 20, 1000)).toBe(sig2Money(20 * 1000 * CONTRACTS.era.minShare));
    expect(eraBonus(1e9, 20, 1000)).toBe(sig2Money(1e9 * CONTRACTS.era.incomeSeconds));
    const s = eraState(9);
    const events = new EventBus<GameEvents>();
    const c = new Contracts(s, new Economy(events, s, 0), events);
    for (let t = 0; t < 30; t++) {
      sale(events, 'stone' as ItemKind, 1, 1e9); // $1B a second for 30 s
      c.update(1);
    }
    expect(c.salesRate).toBeGreaterThan(5e8);
    const kind = Object.values(MATERIALS).find((m) => m.era === 9)!.kind as ItemKind;
    c.offer(kind);
    expect(s.contract.kind).toBe(kind);
    expect(s.contract.bonus).toBeGreaterThan(1e10); // not "+$2,500" at $218B
  });

  it('names era goods by their label', () => {
    expect(contractItem('brick' as ItemKind, 24)).toBe('24 bricks');
    expect(contractItem('bread', 2)).toBe('2 loaves');
  });
});

describe('quests from era 2 on (F9)', () => {
  it('show the current era first and pay at least a minute of sales', () => {
    const s = eraState(5);
    const events = new EventBus<GameEvents>();
    for (const d of QUEST_DEFS) if (d.progress(s) >= d.target) s.quests[d.id] = true; // met goals pay out first
    const q = new Quests(s, new Economy(events, s, 0), events);
    const active = q.active();
    expect(active.length).toBeGreaterThan(0);
    expect(questEra(active[0]!.def.id)).toBe(5);
    for (let t = 0; t < 60; t++) {
      sale(events, 'steel' as ItemKind, 1, 1e8);
      q.update(1);
    }
    const fresh = new Quests(s, new Economy(events, s, 0), events);
    for (let t = 0; t < 60; t++) {
      sale(events, 'steel' as ItemKind, 1, 1e8);
      fresh.update(1);
    }
    for (const a of fresh.active()) expect(a.reward).toBeGreaterThanOrEqual(Math.min(a.def.reward, 1e8 * QUEST_INCOME_SECONDS * 0.9));
  });

  it('era 1 rewards and order are exactly the authored ones', () => {
    const s = createGameState();
    const events = new EventBus<GameEvents>();
    const q = new Quests(s, new Economy(events, s, 0), events);
    const a = q.active();
    expect(a.map((x) => x.def.id)).toEqual(QUEST_DEFS.slice(0, a.length).map((d) => d.id));
    for (const x of a) expect(x.reward).toBe(x.def.reward);
  });

  it('questEra maps every quest to an era', () => {
    for (const d of QUEST_DEFS) {
      const e = questEra(d.id);
      expect(e, d.id).toBeGreaterThanOrEqual(1);
      expect(e, d.id).toBeLessThanOrEqual(10);
    }
    expect(questEra('planks10')).toBe(1);
    expect(questEra('gate3')).toBe(2);
    expect(questEra('trio4homes')).toBe(4);
  });
});

describe('MANAGE signs only nearby (F15)', () => {
  it('full within MANAGE_NEAR, fading to nothing at MANAGE_FAR', () => {
    expect(manageSignAlpha(0, 0)).toBe(1);
    expect(manageSignAlpha(MANAGE_NEAR, 0)).toBe(1);
    expect(manageSignAlpha(MANAGE_FAR, 0)).toBe(0);
    expect(manageSignAlpha(0, 40)).toBe(0);
    const mid = manageSignAlpha((MANAGE_NEAR + MANAGE_FAR) / 2, 0);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});

describe('the Lv 10 rule in words, and the gate groups', () => {
  it('names what to raise and what to buy', () => {
    expect(gateRuleText(2)).toBe(`Raise Survival's machines, crew and upgrades to Lv 10 and grow to Settlement 5, then buy ${ERAS[2]!.region}.`);
    expect(gateRuleText(3)).toBe(`Raise ${ERAS[2]!.region}'s machines, crew and upgrades to Lv 10 and grow to Settlement 10, then buy ${ERAS[3]!.region}.`);
    expect(gateRuleText(11)).toBe('');
    expect(gateRuleShort(4)).toContain(ERAS[3]!.region);
  });

  it('groups add up to every row of the gate', () => {
    const s = eraState(2);
    const g = eraGate(s, 3);
    const groups = gateGroups(g);
    expect(groups.reduce((n, c) => n + c.total, 0)).toBe(g.total);
    expect(groups.map((c) => c.label)).toContain('Machines');
    expect(groups.map((c) => c.label)).toContain('Crew');
    for (const r of g.rows) expect(UPGRADES[r.id]).toBeDefined();
  });
});

describe('validator nits (PR #34)', () => {
  it('a/an reads right for era machines', () => {
    expect(article('Uranium Mine')).toBe('a');
    expect(article('Oil Well')).toBe('an');
    expect(article('Coal Pit')).toBe('a');
    expect(article('Ice Saw')).toBe('an');
    expect(article('Utility Pole')).toBe('a');
    expect(article('Umbrella Stand')).toBe('an');
  });

  it('gate rows: something to do first, settlement-locked rows last', () => {
    for (const age of [3, 4, 8]) {
      const rows = openRows(eraGate(eraState(age), age + 1));
      const firstLocked = rows.findIndex(waitsForSettlement);
      if (firstLocked < 0) continue;
      expect(rows.slice(firstLocked).every(waitsForSettlement)).toBe(true);
      expect(firstLocked).toBeGreaterThan(0);
    }
  });
});

describe('IncomeWindow', () => {
  it('averages over what was played, at most five minutes', () => {
    const w = new IncomeWindow();
    w.add(1000);
    w.tick(10);
    expect(w.rate).toBe(100);
    for (let i = 0; i < 40; i++) w.tick(10);
    expect(w.rate).toBe(0);
    w.add(-5);
    w.add(Number.NaN);
    expect(w.rate).toBe(0);
  });
});
