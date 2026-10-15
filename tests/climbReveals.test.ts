/**
 * The new-land reveals moved to the climb (docs/EXPANSION.md R2, order step 3): Winter City (village level 4) shows
 * nothing new, as in 0.8.0; the land, its roads, the era-2 pad, the map / era chip / Industry tab and the era guide
 * wait for the Great Lodge (eras/gate.ts climbOpen) or era 2.
 */
import { describe, expect, it } from 'vitest';
import { VILLAGE } from '../src/config';
import { createGameState, type GameState } from '../src/core/types';
import { ERAS, MAX_ERA, ROADS } from '../src/eras/data';
import { climbOpen } from '../src/eras/gate';
import { expansionOffered, expansionPreview, travelPoints } from '../src/eras/layout';
import { eraChipVisible, reachNote, shopTabs } from '../src/ui/agesLogic';
import { landVisible, roadOpen } from '../src/world/env/frontier';

const WINTER_CITY = VILLAGE.levels.findIndex((l) => l.name === 'Winter City');

/** A settlement at Winter City (full population, every plot a lodge), the Great Lodge not built yet. */
function winterCity(): GameState {
  const s = createGameState();
  s.village.revealed = true;
  s.village.level = WINTER_CITY;
  s.village.population = VILLAGE.levels[WINTER_CITY]!.minPopulation + 40;
  return s;
}

describe('Winter City shows no new land (0.8.0)', () => {
  it('is the level before the Great Lodge', () => {
    expect(WINTER_CITY).toBe(4);
    expect(VILLAGE.greatLodge.requiresLevel).toBeLessThanOrEqual(WINTER_CITY);
  });

  it('keeps the land, every road and the era-2 pad hidden', () => {
    const s = winterCity();
    expect(climbOpen(s)).toBe(false);
    expect(landVisible(s)).toBe(false);
    expect(ROADS.filter((r) => roadOpen(s, r.opensAt))).toEqual([]);
    for (let n = 2; n <= MAX_ERA; n++) {
      expect(expansionOffered(s, n), `era ${n} offered`).toBe(false);
      expect(expansionPreview(s, n), `era ${n} preview`).toBe(false);
    }
  });

  it('keeps the map points, the era chip and the Industry tab closed', () => {
    const s = winterCity();
    expect(travelPoints(s).filter((p) => p.kind !== 'home').every((p) => !p.open)).toBe(true);
    expect(eraChipVisible(s.eras.age, expansionOffered(s, 2))).toBe(false);
    expect(shopTabs(s.eras.age, expansionOffered(s, 2))).not.toContain('industry');
    expect(reachNote(2)).toBe('Build the Great Lodge first');
  });
});

describe('the Great Lodge opens the new land', () => {
  it('shows the land and the first roads, and offers the era-2 pad', () => {
    const s = winterCity();
    s.village.greatLodge.tier = 0;
    s.village.level = VILLAGE.levels.length - 1;
    expect(landVisible(s)).toBe(true);
    expect(ROADS.filter((r) => roadOpen(s, r.opensAt)).map((r) => r.id)).toEqual(['southAvenue', 'r1', 'cityLink', 'cityWest']);
    expect(expansionOffered(s, 2)).toBe(true);
    expect(travelPoints(s).find((p) => p.id === 'region:2')!.open).toBe(true);
    expect(eraChipVisible(s.eras.age, expansionOffered(s, 2))).toBe(true);
  });

  it('a save already in era 2 keeps its land without the Lodge', () => {
    const s = createGameState();
    s.eras.age = 2;
    expect(landVisible(s)).toBe(true);
    expect(roadOpen(s, 2)).toBe(true);
  });
});

describe('expansionPreview', () => {
  it('is never on together with the offer, only for the next era, and only once the climb is open', () => {
    for (const lodge of [false, true]) {
      for (let age = 1; age <= MAX_ERA; age++) {
        const s = createGameState();
        s.village.greatLodge.tier = lodge ? 0 : -1;
        s.eras.age = age;
        for (let n = 2; n <= MAX_ERA + 1; n++) {
          const preview = expansionPreview(s, n);
          if (preview) {
            expect(lodge && age === n - 1 && !!ERAS[n]).toBe(true);
            expect(expansionOffered(s, n)).toBe(false);
          }
          if (!lodge) expect(preview).toBe(false);
        }
      }
    }
  });
});
