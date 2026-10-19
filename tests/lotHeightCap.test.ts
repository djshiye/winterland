import { describe, expect, it } from 'vitest';
import { districtLots, lotHeightCap } from '../src/city/rules';

describe('Glass Heights steps down toward era 2 (0.9.11, review T1)', () => {
  it('the western lots of district 8 build lower, stepping up eastward', () => {
    const lots = districtLots(8);
    const west = Math.min(...lots.map((f) => f.x));
    for (const f of lots) {
      const cap = lotHeightCap(8, f.index);
      if (f.x === west) expect(cap).toBeLessThanOrEqual(8);
      else if (cap !== Infinity) expect(cap).toBeGreaterThan(8);
    }
    const byCol = [...new Set(lots.map((f) => f.x))].sort((a, b) => a - b).map((x) => lotHeightCap(8, lots.find((f) => f.x === x)!.index));
    for (let i = 1; i < byCol.length; i++) expect(byCol[i]).toBeGreaterThan(byCol[i - 1]!);
  });

  it('no other district is capped', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 9, 10]) for (const f of districtLots(n)) expect(lotHeightCap(n, f.index)).toBe(Infinity);
  });
});
