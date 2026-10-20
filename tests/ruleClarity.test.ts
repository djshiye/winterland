/** 0.9.12 full review bundle 6 (rule clarity): R3, R4, E1, E4. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VILLAGE } from '../src/config';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { IncomeWindow, INCOME_BUCKET, INCOME_BUCKETS } from '../src/core/incomeWindow';
import { Quests, trioRoomWarning } from '../src/core/quests';
import { mergeState, sanitizeState } from '../src/core/Save';
import { createGameState, type GameEvents, type GameState, type ItemKind } from '../src/core/types';
import { CITY_BUILDINGS, DISTRICTS, type CityBuildingId, type CityBuildingKind } from '../src/eras/data';
import { gateMoneyLine } from '../src/ui/agesLogic';

function eraState(age: number): GameState {
  const s = createGameState();
  s.village.level = VILLAGE.levels.length - 1;
  s.village.greatLodge.tier = 0;
  s.eras.age = age;
  for (let n = 2; n <= age; n++) s.eras.regions[n]!.unlocked = true;
  return s;
}

const sale = (events: EventBus<GameEvents>, amount: number): void =>
  events.emit('sale', { buyer: 'export', kind: 'brick' as ItemKind, count: 1, amount, position: new THREE.Vector3() });

describe('quest rewards stay put across a reload (E4)', () => {
  it('a shown reward is saved and read back, whatever the sales rate after loading', () => {
    const s = eraState(3);
    const events = new EventBus<GameEvents>();
    const q = new Quests(s, new Economy(events, s, 0), events);
    for (let t = 0; t < 120; t++) {
      sale(events, 50_000);
      q.update(1);
    }
    const before = new Quests(s, new Economy(events, s, 0), events).active();
    const shown = q.active().map((a) => [a.def.id, a.reward]);
    // a reload: the saved state goes through JSON, merge and sanitize into a fresh state; the sales window is empty
    const loaded = createGameState();
    mergeState(loaded, JSON.parse(JSON.stringify(s)));
    sanitizeState(loaded);
    const after = new EventBus<GameEvents>();
    const q2 = new Quests(loaded, new Economy(after, loaded, 0), after);
    expect(q2.active().map((a) => [a.def.id, a.reward])).toEqual(shown);
    expect(before.length).toBeGreaterThan(0);
  });

  it('the carried sales rate fills the unplayed part of the window', () => {
    const w = new IncomeWindow(100);
    expect(w.rate).toBeCloseTo(100);
    w.add(5000);
    w.tick(INCOME_BUCKET);
    expect(w.rate).toBeGreaterThan(100);
    for (let i = 0; i < INCOME_BUCKETS + 1; i++) w.tick(INCOME_BUCKET);
    expect(w.rate).toBe(0); // a full window played: only this session's sales count
    expect(new IncomeWindow().rate).toBe(0);
  });

  it('a malformed saved reward is dropped on load', () => {
    const s = createGameState();
    mergeState(s, { questRewards: { a: 5000, b: -1, c: 'x' } });
    sanitizeState(s);
    expect(s.questRewards).toEqual({ a: 5000 });
  });
});

describe('city choose card warns before a lot blocks the quest trio (R4)', () => {
  const ofKind = (n: number, kind: CityBuildingKind): CityBuildingId =>
    (Object.keys(CITY_BUILDINGS) as CityBuildingId[]).find((id) => CITY_BUILDINGS[id].era === n && CITY_BUILDINGS[id].kind === kind)!;

  it('says nothing while there is room, and warns on the lot that would take it', () => {
    const s = eraState(2);
    const lots = s.city.districts[2]!.lots;
    expect(lots.length).toBe(DISTRICTS[2]!.lots);
    expect(trioRoomWarning(s, 2, 0, 'park')).toBeUndefined();
    expect(trioRoomWarning(s, 2, 0, 'home')).toBeUndefined();
    // one park already: the next workplace would leave lots − 2 lots for lots − 2 homes + the landmark
    const homes = lots.length - 2;
    lots[0]!.building = ofKind(2, 'park');
    expect(trioRoomWarning(s, 2, 1, 'work')).toBe(`Leaves too few lots for your quests: ${homes} more homes and the landmark here`);
    // a home chosen elsewhere counts towards the goal
    lots[2]!.building = ofKind(2, 'home');
    expect(trioRoomWarning(s, 2, 1, 'work')).toContain(`${homes - 1} more homes`);
    expect(trioRoomWarning(s, 2, 1, 'home')).toBeUndefined();
    // both goals done: no warning
    s.quests.trio2homes = true;
    s.quests.trio2landmark = true;
    expect(trioRoomWarning(s, 2, 1, 'work')).toBeUndefined();
  });
});

describe('gate card leads with the real cost (E1)', () => {
  it('upgrades left and their price come before the expansion', () => {
    const line = gateMoneyLine(2, 12, 4_200_000);
    expect(line.startsWith('<b>Upgrades left: 12</b> (about $4.2M), then the expansion: $1.5M')).toBe(true);
    expect(gateMoneyLine(2, 0, 0).startsWith('Then the expansion: ')).toBe(true);
  });
});
