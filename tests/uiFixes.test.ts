/** UI review fixes: the era chip's seed on load and the Market Town fast-travel point. */
import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/core/types';
import { CITY_BUILDINGS, CITY_RANKS } from '../src/eras/data';
import { travelPoints } from '../src/eras/layout';
import { cityStanding } from '../src/ui/agesLogic';
import { LAYOUT, PLAYER } from '../src/config';

describe('era chip seed', () => {
  it('is the village population and Town rank on a fresh (era 1) game', () => {
    const s = createGameState();
    expect(cityStanding(s)).toEqual({ population: s.village.population, rank: 0 });
  });

  it('counts district residents and the reached rank on a restored late save', () => {
    const s = createGameState();
    s.eras.age = 5;
    s.village.population = 180;
    const home = Object.values(CITY_BUILDINGS).find((d) => d.era === 4 && d.kind === 'home')!;
    for (const l of s.city.districts[4]!.lots) {
      l.building = home.id;
      l.tier = 0;
      l.cash = 0;
      l.extra = 0;
    }
    const seed = cityStanding(s);
    expect(seed.population).toBe(180 + home.people * s.city.districts[4]!.lots.length);
    s.village.population = 6000;
    expect(CITY_RANKS[cityStanding(s).rank]!.name).toBe('Big City');
  });
});

describe('Market Town travel point', () => {
  it('lands on the walkable square, clear of the fir', () => {
    const s = createGameState();
    s.town.revealed = true;
    const p = travelPoints(s).find((t) => t.id === 'town')!;
    expect(p.open).toBe(true);
    const T = LAYOUT.town;
    expect(Math.hypot(p.x - T.tree.x, p.z - T.tree.z)).toBeGreaterThan(T.tree.r + PLAYER.radius);
    expect(T.walk.some((r) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ)).toBe(true);
  });
});
