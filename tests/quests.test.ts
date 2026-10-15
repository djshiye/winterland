/** Wave 12: the amenity / happiness quests. */
import { describe, expect, it } from 'vitest';
import { AMENITIES, AMENITY_IDS } from '../src/config';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { QUEST_DEFS, Quests } from '../src/core/quests';
import { createGameState, type GameEvents } from '../src/core/types';

const def = (id: string) => QUEST_DEFS.find((q) => q.id === id)!;

describe('amenity quests', () => {
  it('are listed after the existing town quests with the specified targets and rewards', () => {
    const ids = QUEST_DEFS.map((q) => q.id);
    const at = ids.indexOf('amenity1');
    expect(ids.slice(at, at + 3)).toEqual(['amenity1', 'happy50', 'amenity4']);
    // 0.9.0: only the era quests come after them.
    expect(ids[at + 3]).toBe('era2');
    expect(ids.indexOf('amenity1')).toBeGreaterThan(ids.indexOf('greatLodge'));
    expect([def('amenity1').target, def('happy50').target, def('amenity4').target]).toEqual([1, 50, 4]);
    expect(def('amenity1').reward).toBe(1500);
    expect(def('amenity4').reward).toBe(12000);
  });

  it('progress is zero on a fresh game', () => {
    const s = createGameState();
    for (const id of ['amenity1', 'happy50', 'amenity4']) expect(def(id).progress(s)).toBe(0);
  });

  it('counts built amenities and reports happiness in percent', () => {
    const s = createGameState();
    s.town.amenities.pond.tier = 0;
    expect(def('amenity1').progress(s)).toBe(1);
    expect(def('amenity4').progress(s)).toBe(1);
    expect(def('happy50').progress(s)).toBe(Math.round(AMENITIES.pond.happiness * 100));
    s.town.amenities.cafe.tier = 0;
    expect(def('amenity1').progress(s)).toBe(2);
    expect(def('happy50').progress(s)).toBeGreaterThanOrEqual(50);
  });

  it('every amenity built completes amenity4 and 100% happiness is capped', () => {
    const s = createGameState();
    for (const id of AMENITY_IDS) s.town.amenities[id].tier = 0;
    expect(def('amenity4').progress(s)).toBe(AMENITY_IDS.length);
    expect(def('happy50').progress(s)).toBeLessThanOrEqual(100);
    expect(def('happy50').progress(s)).toBeGreaterThanOrEqual(50);
  });
});

describe('era quests (0.9.0)', () => {
  it('come after every Survival quest and are untouched by a fresh game', () => {
    const ids = QUEST_DEFS.map((q) => q.id);
    expect(ids.indexOf('era2')).toBeGreaterThan(ids.indexOf('amenity4'));
    const s = createGameState();
    expect(def('era2').progress(s)).toBeLessThan(def('era2').target);
    expect(def('machine1').progress(s)).toBe(0);
    expect(def('city1').progress(s)).toBe(0);
  });

  it('track the age, machines and city builds', () => {
    const s = createGameState();
    s.eras.age = 3;
    s.stats.machinesBuilt = 2;
    s.eras.regions[2]!.slots[0] = { machine: 'quarry', tier: 0, cash: 0, extra: 0 };
    expect(def('era2').progress(s)).toBeGreaterThanOrEqual(def('era2').target);
    expect(def('era3').progress(s)).toBe(3);
    expect(def('era4').progress(s)).toBeLessThan(def('era4').target);
    expect(def('machines6').progress(s)).toBe(1);
  });
});

describe('quest counter (0.9.0)', () => {
  const make = () => {
    const state = createGameState();
    const events = new EventBus<GameEvents>();
    return { state, quests: new Quests(state, new Economy(events, state, 0), events) };
  };

  it('counts only the Survival quests in era 1, as 0.8.0 did', () => {
    const { state, quests } = make();
    const survival = QUEST_DEFS.findIndex((q) => q.id === 'era2');
    expect(quests.total).toBe(survival);
    state.eras.age = 2;
    expect(quests.total).toBe(QUEST_DEFS.length);
  });

  it('counts every quest once all Survival quests are done', () => {
    const { state, quests } = make();
    for (const q of QUEST_DEFS.slice(0, QUEST_DEFS.findIndex((d) => d.id === 'era2'))) state.quests[q.id] = true;
    expect(quests.total).toBe(QUEST_DEFS.length);
  });
});
