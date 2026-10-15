/**
 * 0.9.0 city: the pure rules (lot layout, choosing, landmark limit, demolition, economy, rank) and the skyline slots.
 * No WebGL: city/rules.ts and the skyline slot table are pure.
 */
import { describe, expect, it } from 'vitest';
import { CITY_BUILDINGS, CITY_HAPPINESS_BONUS, CITY_RANKS, DEMOLISH_MIN, DEMOLISH_SHARE, DISTRICTS, cityBuildingsOfEra, districtDef, type CityBuildingId } from '../src/eras/data';
import { createGameState, type GameState } from '../src/core/types';
import { SKYLINE_AREA, SKYLINE_DIAGONAL, SKYLINE_MAX, skylineSlots } from '../src/world/env/skyline';
import {
  canChoose,
  chooseOptions,
  cityTotals,
  costText,
  demolishCost,
  demolishLot,
  districtLots,
  employment,
  incomePerSecond,
  incomeSplit,
  landmarkTaken,
  lockReason,
  paidFraction,
  rankFor,
  rectsOverlap,
  settlePaidCity,
  skylineCount,
  visualHeight,
} from '../src/city/rules';

function build(state: GameState, n: number, lot: number, id: CityBuildingId): void {
  const l = state.city.districts[n]!.lots[lot]!;
  l.building = id;
  l.tier = 0;
  l.cash = 0;
  l.extra = 0;
}

const fresh = (): GameState => {
  const s = createGameState();
  s.eras.age = 10;
  return s;
};

describe('district layout', () => {
  for (let n = 2; n <= 10; n++) {
    it(`district ${n}: every lot fits inside the district and none overlap`, () => {
      const def = districtDef(n);
      const lots = districtLots(n);
      expect(lots).toHaveLength(def.lots);
      const r = def.rect;
      for (const f of lots) {
        for (const box of [f.rect, f.zone]) {
          expect(box.minX).toBeGreaterThanOrEqual(r.minX + 1);
          expect(box.maxX).toBeLessThanOrEqual(r.maxX - 1);
          expect(box.minZ).toBeGreaterThanOrEqual(r.minZ + 1);
          expect(box.maxZ).toBeLessThanOrEqual(r.maxZ - 1);
        }
        expect(f.w).toBeGreaterThan(3);
        expect(f.d).toBeGreaterThan(3);
        // the pad sits in front (+Z) of its footprint
        expect(f.zone.minZ).toBeGreaterThan(f.rect.maxZ);
      }
      for (let i = 0; i < lots.length; i++) {
        for (let j = i + 1; j < lots.length; j++) {
          const a = lots[i]!;
          const b = lots[j]!;
          expect(rectsOverlap(a.rect, b.rect)).toBe(false);
          expect(rectsOverlap(a.rect, b.zone)).toBe(false);
          expect(rectsOverlap(a.zone, b.zone)).toBe(false);
        }
      }
    });
  }

  it('lots get smaller as the eras rise and buildings get taller', () => {
    expect(districtLots(10)[0]!.w).toBeLessThan(districtLots(2)[0]!.w);
    expect(CITY_BUILDINGS.aiHome.height).toBeGreaterThan(CITY_BUILDINGS.frontierHome.height);
    expect(visualHeight(111)).toBeLessThan(40);
    expect(visualHeight(5)).toBe(5);
  });

  it('every district has lots in the contract table order', () => {
    for (let n = 2; n <= 10; n++) expect(DISTRICTS[n]!.lots).toBe(createGameState().city.districts[n]!.lots.length);
  });
});

describe('choosing', () => {
  it('offers the four buildings of the era with a cost line', () => {
    const s = fresh();
    const opts = chooseOptions(s.city, 2, 0);
    expect(opts.map((o) => o.id).sort()).toEqual(cityBuildingsOfEra(2).sort());
    expect(costText(CITY_BUILDINGS.frontierHome)).toBe('$40,000 + 15 Bricks');
    expect(opts.every((o) => !o.locked)).toBe(true);
  });

  it('one landmark per district: the second is locked, the lot of the first may re-choose', () => {
    const s = fresh();
    build(s, 3, 0, 'ironLandmark');
    expect(landmarkTaken(s.city.districts[3]!.lots)).toBe(true);
    expect(lockReason(s.city, 3, 1, 'ironLandmark')).toBe('One landmark per district');
    expect(canChoose(s, 3, 1, 'ironLandmark')).toBe(false);
    expect(canChoose(s, 3, 1, 'ironHome')).toBe(true);
    // another district is not affected
    expect(canChoose(s, 4, 0, 'steamLandmark')).toBe(true);
    // a chosen, unpaid landmark also blocks (pad armed)
    const s2 = fresh();
    s2.city.districts[5]!.lots[2]!.building = 'industrialLandmark';
    expect(lockReason(s2.city, 5, 3, 'industrialLandmark')).toBe('One landmark per district');
    expect(lockReason(s2.city, 5, 2, 'industrialLandmark')).toBeUndefined();
  });

  it('only the district era, only open lots, only reached eras', () => {
    const s = fresh();
    expect(canChoose(s, 2, 0, 'ironHome')).toBe(false);
    s.eras.age = 3;
    expect(canChoose(s, 4, 0, 'steamHome')).toBe(false);
    s.eras.age = 10;
    s.city.districts[2]!.lots[0]!.cash = 100;
    s.city.districts[2]!.lots[0]!.building = 'frontierHome';
    expect(canChoose(s, 2, 0, 'frontierWork')).toBe(false);
    build(s, 2, 1, 'frontierHome');
    expect(canChoose(s, 2, 1, 'frontierWork')).toBe(false);
  });
});

describe('construction and demolition', () => {
  it('paid share and settling a fully paid lot', () => {
    const s = fresh();
    const l = s.city.districts[2]!.lots[0]!;
    l.building = 'frontierHome';
    expect(paidFraction(l)).toBe(0);
    l.cash = CITY_BUILDINGS.frontierHome.cash / 2;
    expect(paidFraction(l)).toBeCloseTo(0.25);
    l.cash = CITY_BUILDINGS.frontierHome.cash;
    l.extra = CITY_BUILDINGS.frontierHome.extra.count;
    expect(settlePaidCity(s)).toBe(1);
    expect(l.tier).toBe(0);
    expect(l.cash).toBe(0);
    expect(paidFraction(l)).toBe(1);
  });

  it('demolish cost is DEMOLISH_SHARE of the price, at least DEMOLISH_MIN', () => {
    expect(demolishCost(CITY_BUILDINGS.frontierHome)).toBe(Math.max(DEMOLISH_MIN, Math.round(40_000 * DEMOLISH_SHARE)));
    expect(demolishCost({ ...CITY_BUILDINGS.frontierHome, cash: 100 })).toBe(DEMOLISH_MIN);
  });

  it('demolishing resets the lot, counts the stat and frees the landmark slot', () => {
    const s = fresh();
    build(s, 3, 0, 'ironLandmark');
    expect(demolishLot(s, 3, 0)).toBe('ironLandmark');
    const l = s.city.districts[3]!.lots[0]!;
    expect(l).toEqual({ building: '', tier: -1, cash: 0, extra: 0 });
    expect(s.stats.demolished).toBe(1);
    expect(landmarkTaken(s.city.districts[3]!.lots)).toBe(false);
    expect(canChoose(s, 3, 0, 'ironLandmark')).toBe(true);
    // nothing built there any more: no second demolition
    expect(demolishLot(s, 3, 0)).toBe('');
    expect(s.stats.demolished).toBe(1);
    expect(cityTotals(s.city).buildings).toBe(0);
  });
});

describe('economy', () => {
  it('residents, jobs, rent and business come from built buildings only', () => {
    const s = fresh();
    build(s, 2, 0, 'frontierHome');
    build(s, 2, 1, 'frontierWork');
    s.city.districts[2]!.lots[2]!.building = 'frontierHome'; // chosen, not built
    const t = cityTotals(s.city);
    expect(t.residents).toBe(CITY_BUILDINGS.frontierHome.people);
    expect(t.jobs).toBe(CITY_BUILDINGS.frontierWork.jobs);
    expect(t.rent).toBe(CITY_BUILDINGS.frontierHome.income);
    expect(t.business).toBe(CITY_BUILDINGS.frontierWork.income);
    expect(t.buildings).toBe(2);
  });

  it('employment = min(1, residents / jobs), 1 without jobs', () => {
    expect(employment(0, 0)).toBe(1);
    expect(employment(40, 0)).toBe(1);
    expect(employment(15, 30)).toBe(0.5);
    expect(employment(90, 30)).toBe(1);
    expect(employment(0, 30)).toBe(0);
  });

  it('happiness sums parks + landmarks and is capped at 1', () => {
    const s = fresh();
    build(s, 2, 0, 'frontierPark');
    expect(cityTotals(s.city).happiness).toBeCloseTo(0.12);
    for (let n = 2; n <= 6; n++) build(s, n, 1, `${['frontier', 'iron', 'steam', 'industrial', 'electric'][n - 2]}Landmark` as CityBuildingId);
    expect(cityTotals(s.city).happiness).toBe(1);
  });

  it('income/s = (rent + business x employment) x (1 + bonus x happiness) x City Hall', () => {
    const s = fresh();
    build(s, 2, 0, 'frontierHome'); // 40 people, $4/s
    build(s, 2, 1, 'frontierWork'); // 30 jobs, $45/s
    build(s, 2, 2, 'frontierPark'); // 0.12 happiness
    const t = cityTotals(s.city);
    const k = 1 + CITY_HAPPINESS_BONUS * 0.12;
    expect(incomePerSecond(t, 1)).toBeCloseTo((4 + 45 * 1) * k);
    expect(incomePerSecond(t, 2)).toBeCloseTo((4 + 45) * k * 2);
    const split = incomeSplit(t, 1);
    expect(split.rent).toBeCloseTo(4 * k);
    expect(split.business).toBeCloseTo(45 * k);
    // understaffed: more jobs than residents
    build(s, 2, 3, 'frontierWork');
    build(s, 2, 4, 'frontierWork');
    const t2 = cityTotals(s.city);
    expect(t2.jobs).toBe(90);
    expect(incomePerSecond(t2, 1)).toBeCloseTo((4 + 135 * (40 / 90)) * k);
  });

  it('an empty city earns nothing', () => {
    expect(incomePerSecond(cityTotals(fresh().city), 3)).toBe(0);
  });
});

describe('rank', () => {
  it('needs both the population and the era', () => {
    expect(rankFor(0, 1)).toBe(0);
    expect(rankFor(600, 1)).toBe(0);
    expect(rankFor(600, 2)).toBe(1);
    expect(rankFor(6000, 3)).toBe(1);
    expect(rankFor(6000, 4)).toBe(2);
    expect(rankFor(50_000, 7)).toBe(3);
    expect(rankFor(200_000, 9)).toBe(3);
    expect(rankFor(200_000, 10)).toBe(CITY_RANKS.length - 1);
  });
});

describe('skyline', () => {
  it('grows with the population: none below 500 people, 220 at Metropolis', () => {
    expect(skylineCount(0)).toBe(0);
    expect(skylineCount(499)).toBe(0);
    expect(skylineCount(500)).toBeGreaterThan(0);
    expect(skylineCount(5_000)).toBeLessThan(skylineCount(40_000));
    expect(skylineCount(40_000)).toBeLessThan(skylineCount(100_000));
    expect(skylineCount(100_000)).toBe(SKYLINE_MAX);
    expect(skylineCount(1e7)).toBe(SKYLINE_MAX);
  });

  it('towers stand east / south-east, inside the area and behind the districts', () => {
    const slots = skylineSlots();
    expect(slots.length).toBeGreaterThan(150);
    expect(slots.length).toBeLessThanOrEqual(SKYLINE_MAX);
    const dist = Object.values(DISTRICTS).filter(Boolean);
    for (const t of slots) {
      expect(t.x - t.w / 2).toBeGreaterThanOrEqual(SKYLINE_AREA.minX);
      expect(t.x + t.w / 2).toBeLessThanOrEqual(SKYLINE_AREA.maxX);
      expect(t.z - t.d / 2).toBeGreaterThanOrEqual(SKYLINE_AREA.minZ);
      expect(t.z + t.d / 2).toBeLessThanOrEqual(SKYLINE_AREA.maxZ);
      expect(t.x - t.w / 2 - (t.z + t.d / 2)).toBeGreaterThanOrEqual(SKYLINE_DIAGONAL);
      for (const d of dist) expect(t.x - t.w / 2).toBeGreaterThan(d!.rect.maxX);
    }
  });
});
