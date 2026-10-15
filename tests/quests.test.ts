/** Wave 12: the amenity / happiness quests. */
import { describe, expect, it } from 'vitest';
import { AMENITIES, AMENITY_IDS } from '../src/config';
import { QUEST_DEFS } from '../src/core/quests';
import { createGameState } from '../src/core/types';

const def = (id: string) => QUEST_DEFS.find((q) => q.id === id)!;

describe('amenity quests', () => {
  it('are listed after the existing town quests with the specified targets and rewards', () => {
    const ids = QUEST_DEFS.map((q) => q.id);
    expect(ids.slice(-3)).toEqual(['amenity1', 'happy50', 'amenity4']);
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
