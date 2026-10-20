/** 0.9.12: the sledding hill and the skating pond by the village (world/life/WinterFun.ts). */
import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../src/config';
import { REGIONS, RIVER_POND, ROADS } from '../src/eras/data';
import { footpathRect } from '../src/world/env/wayfinding';
import { hillY, RUN_END_Z, SLED_HILL, TRACK_X, WinterFun } from '../src/world/life/WinterFun';
import { LANE } from '../src/town/lane';

const hit = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

describe('winter fun by the village', () => {
  it('the hill, its run-out and bench sit on open snow: off every road, region, the village, the lane, the pond and the footpath', () => {
    const F = WinterFun.FOOTPRINT;
    for (const r of ROADS) expect(hit(F, r.rect), r.id).toBe(false);
    for (const R of REGIONS) if (R) expect(hit(F, R.rect)).toBe(false);
    for (const o of [LAYOUT.village.area, LANE, RIVER_POND, footpathRect(), LAYOUT.tricycles.road]) expect(hit(F, o)).toBe(false);
  });
  it('the track runs downhill all the way to a flat run-out', () => {
    let last = Infinity;
    for (let z = SLED_HILL.z; z <= RUN_END_Z; z += 0.25) {
      const y = hillY(TRACK_X, z);
      expect(y).toBeLessThanOrEqual(last + 1e-9);
      last = y;
    }
    expect(hillY(TRACK_X, SLED_HILL.z)).toBeGreaterThan(2);
    expect(hillY(TRACK_X, RUN_END_Z)).toBe(0);
  });
});
