/** Upgrade ladders to level 100 (core/ladder.ts, docs/EXPANSION.md §A): frozen prefix, prices, caps, Mastery. */
import { describe, expect, it } from 'vitest';
import { CLIMB, GATE, price3, UPGRADES, type UpgradeDef } from '../src/config';
import { authoredMax, base, costAt, hardCapStored, introEra, LEVEL_CAP, masteryMult, masteryPoints, maxStored, shown, valueAt } from '../src/core/ladder';

const DEFS = Object.values(UPGRADES) as UpgradeDef[];
const ERA1 = DEFS.filter((d) => introEra(d) === 1);

describe('ladder: frozen prefix', () => {
  for (const d of DEFS) {
    it(`${d.id}: the authored table is returned unchanged up to its max`, () => {
      const m = authoredMax(d);
      expect(maxStored(d, false)).toBe(m);
      for (let s = 0; s <= m; s++) expect(valueAt(d, s)).toBe(d.values[s]);
      if (introEra(d) === 1) for (let s = 0; s < m; s++) expect(costAt(d, s)).toBe(d.costs[s]);
      for (let s = 0; s <= m; s++) expect(masteryPoints(d, s)).toBe(0);
    });
  }
});

describe('ladder: levels', () => {
  it('28 era-1 ids (22 Survival + jack + the five 0.9.2 docks) sit at offset 0; era-n ids at 10 · (n − 1) in offset mode', () => {
    expect(ERA1).toHaveLength(28);
    expect(ERA1.map((d) => d.id)).toContain('jack');
    for (const d of ERA1) expect(base(d, 'offset')).toBe(0);
    expect(base(UPGRADES.taxOffice, 'offset')).toBe(10);
    expect(base(UPGRADES.broker, 'offset')).toBe(10);
    expect(base(UPGRADES.frontierCrew, 'offset')).toBe(10);
    expect(base(UPGRADES.ironRigs, 'offset')).toBe(20);
    expect(base(UPGRADES.aiTrade, 'offset')).toBe(90);
    expect(shown(UPGRADES.ironRigs, 3, 'offset')).toBe(23);
  });

  it('the climb runs every id to shown level 100 (offset mode)', () => {
    for (const d of DEFS) {
      expect(maxStored(d, true, 'offset')).toBe(LEVEL_CAP - base(d, 'offset'));
      expect(shown(d, maxStored(d, true, 'offset'), 'offset')).toBe(LEVEL_CAP);
    }
  });

  it("'literal' mode (the 0.9.5 default) drops every offset", () => {
    expect(GATE.mode).toBe('literal');
    for (const d of DEFS) {
      expect(base(d, 'literal')).toBe(0);
      expect(maxStored(d, true, 'literal')).toBe(LEVEL_CAP);
    }
  });

  it('prices follow the era, not the display mode; caps follow GATE.mode (the cap cache is per mode)', () => {
    const rigs = UPGRADES.frontierRigs;
    // era 2's first step is band 2's price in either mode (Dino 0.9.5: the economy scales era by era)
    expect(costAt(rigs, 0)).toBe(price3((0.9 * CLIMB.unit * (CLIMB.bandTilt[2] ?? 1))));
    expect(hardCapStored(rigs)).toBe(39); // literal: 3.0 + 0.1 · 30 = 6 at stored 39
    expect(hardCapStored(UPGRADES.aiRigs)).toBe(39); // literal: reachable below 100
    for (const d of ERA1) expect(costAt(d, 0)).toBe(d.costs[0]);
    GATE.mode = 'offset';
    try {
      expect(costAt(rigs, 0)).toBe(price3((0.9 * CLIMB.unit * (CLIMB.bandTilt[2] ?? 1))));
      expect(hardCapStored(rigs)).toBe(39);
      expect(hardCapStored(UPGRADES.aiRigs)).toBeNull(); // offset: base 90 leaves only 10 levels
    } finally {
      GATE.mode = 'literal';
    }
  });
});

describe('ladder: costs', () => {
  for (const d of DEFS) {
    it(`${d.id}: multiples of 5, strictly rising to Lv 100`, () => {
      let prev = 0;
      for (let s = 0; s < maxStored(d, true); s++) {
        const c = costAt(d, s);
        expect(c % 5).toBe(0);
        expect(c).toBeGreaterThan(prev);
        prev = c;
      }
    });
  }

  it('matches the calibrated sample prices', () => {
    // design §A2 at U 250k, growth 2.6: $125k / $225k / $201M / $401M; the pacing model (core/pacing.ts) set
    // U 300k, growth 4.3; 0.9.0 (every era longer than the last): U 190k, growth 4.3 × bandTilt; 0.9.5 (literal gate)
    // re-solved bandTilt; again for the era 2-4 machines and six slots, and the era 5-7 content with the era player upgrades
    expect(costAt(UPGRADES.carry, 10)).toBe(183_000); // A 10, lumberjack
    expect(costAt(UPGRADES.frontierRigs, 0)).toBe(330_000); // A 10, industry: era 2's first level
    expect(costAt(UPGRADES.frontierRigs, 9)).toBe(660_000); // era 2's last level
    expect(costAt(UPGRADES.quarry, 0)).toBe(293_000); // A 10, machine level pad
    expect(costAt(UPGRADES.carry, 89)).toBe(13_700_000_000); // A 89, lumberjack
    expect(costAt(UPGRADES.taxOffice, 79)).toBe(27_500_000_000); // A 89, finance
  });

  it('a Survival id first continues its last authored price by 5 % a level', () => {
    expect(costAt(UPGRADES.dog, 4)).toBe(63_000);
    expect(costAt(UPGRADES.jack, 9)).toBe(788_000);
  });

  it('the era-2 gate (every era-1 id to Lv 10) costs about $11.8M over 102 steps (0.9.2: + the five docks)', () => {
    let steps = 0;
    let total = 0;
    for (const d of ERA1) {
      for (let s = authoredMax(d); s < 10; s++) {
        steps++;
        total += costAt(d, s);
      }
    }
    expect(steps).toBe(102);
    expect(total).toBeGreaterThan(11.8e6 * 0.95);
    expect(total).toBeLessThan(11.8e6 * 1.05);
  });
});

describe('ladder: effects past the authored max', () => {
  /** Stored level where the hard cap is first reached (Survival ids: stored = shown). */
  const CAPS: Partial<Record<string, number>> = {
    carry: 19, dog: 16, speed: 34, axe: 28, harvester: 19, processor: 25, megaSaw: 11, treeFeller: 11, cashTubes: 32, workshop: 34, jack: 24,
  };
  for (const [id, at] of Object.entries(CAPS)) {
    it(`${id} reaches its hard cap at Lv ${at}`, () => expect(hardCapStored(UPGRADES[id as keyof typeof UPGRADES])).toBe(at));
  }

  for (const d of DEFS) {
    it(`${d.id}: always improves or holds, never past its cap`, () => {
      const down = d.display === 'rate';
      const hc = hardCapStored(d);
      let prev = valueAt(d, 0);
      for (let s = 1; s <= maxStored(d, true); s++) {
        const v = valueAt(d, s);
        if (down) expect(v).toBeLessThanOrEqual(prev);
        else expect(v).toBeGreaterThanOrEqual(prev);
        if (hc !== null && s >= hc) expect(v).toBe(valueAt(d, hc));
        prev = v;
      }
      if (hc !== null) expect(masteryPoints(d, maxStored(d, true))).toBe(maxStored(d, true) - hc);
    });
  }

  it('Survival crews gain 0.2 a level up to ×8; sales gain 0.1 a level with no cap', () => {
    expect(valueAt(UPGRADES.cashier, 7)).toBeCloseTo(3.0, 9);
    expect(valueAt(UPGRADES.cashier, 100)).toBe(8);
    expect(valueAt(UPGRADES.plankQuality, 10)).toBeCloseTo(2.5, 9);
    expect(valueAt(UPGRADES.plankQuality, 90)).toBeCloseTo(10.5, 9);
    expect(hardCapStored(UPGRADES.plankQuality)).toBeNull();
    expect(hardCapStored(UPGRADES.taxOffice)).toBeNull();
  });

  it('Jack never pays the full value (no buy → sell money loop)', () => {
    for (let s = 0; s <= maxStored(UPGRADES.jack, true); s++) expect(valueAt(UPGRADES.jack, s)).toBeLessThan(1);
    expect(valueAt(UPGRADES.jack, 100)).toBe(0.9);
  });

  it('Rigs stop at ×6 and the broker at ×10', () => {
    expect(valueAt(UPGRADES.frontierRigs, 90)).toBe(6);
    expect(valueAt(UPGRADES.broker, 90)).toBe(10);
  });
});

describe('ladder: Mastery', () => {
  it('is 1 with no points, bounded and logarithmic after', () => {
    expect(masteryMult(0)).toBe(1);
    expect(masteryMult(500)).toBeCloseTo(1.53, 2);
    expect(masteryMult(1500)).toBeCloseTo(1.71, 2);
  });
});
