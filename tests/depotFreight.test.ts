import { describe, expect, it } from 'vitest';
import { LIFT_CAPACITY, LiftCycle, SINK_DEPTH, freightLayout } from '../src/eras/DepotFreight';
import { LOADER_SPECS, freightTier } from '../src/assets/depotFreight';
import { regionLayout } from '../src/eras/layout';
import { DEPOT_FRAME, worldRect } from '../src/eras/rules';
import { regionPaths } from '../src/world/env/frontier';

const inRect = (r: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number, m = 0): boolean =>
  x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m;

describe('depot freight layout', () => {
  for (let era = 2; era <= 10; era++) {
    it(`era ${era}: positions sit in the yard band, off the depot and its give zone and the paths`, () => {
      const L = regionLayout(era);
      const F = freightLayout(L);
      const yaw = L.facilityYaw;
      const body = worldRect(L.depot, yaw, DEPOT_FRAME.body);
      const give = worldRect(L.depot, yaw, DEPOT_FRAME.give);
      const depth = (z: number): number => (z - L.gate.z) * L.inward;
      expect(F.lift.x).toBeCloseTo(L.depot.x - 4.6);
      expect(F.lift.z).toBeCloseTo(L.depot.z);
      expect(F.frameDepth[0]).toBeGreaterThanOrEqual(2.9);
      expect(F.frameDepth[1]).toBeLessThanOrEqual(5.2);
      const spec = LOADER_SPECS[freightTier(era)];
      const front = [0.4, 0.5, 0.45][freightTier(era)]!;
      const stop = F.stopX(spec, front);
      expect(stop).toBeLessThan(F.homeX);
      expect(stop).toBeGreaterThan(F.lift.x + 0.8);
      for (const x of [F.homeX, stop]) {
        expect(inRect(body, x, F.loaderZ, 0.3)).toBe(false);
        expect(inRect(give, x, F.loaderZ, 0.3)).toBe(false);
        expect(depth(F.loaderZ)).toBeGreaterThan(2.9);
        expect(depth(F.loaderZ)).toBeLessThan(5.2);
      }
      // the loader is on the fence side of the depot's centre line
      expect((F.loaderZ - L.depot.z) * L.inward).toBeLessThan(0);
      for (const q of regionPaths(L)) {
        expect(inRect(q, F.lift.x, F.lift.z, 1.1)).toBe(false);
        expect(inRect(q, F.homeX, F.loaderZ, 0.5)).toBe(false);
      }
      for (const s of F.slots) expect(Math.abs(s.x - F.lift.x) + Math.abs(s.z - F.lift.z)).toBeLessThan(0.6);
      // the lift stays inside the region
      expect(F.lift.x - 1.05).toBeGreaterThan(L.rect.minX);
    });
  }
});

describe('LiftCycle', () => {
  it('stacks four crates, sinks, holds, rises empty', () => {
    const c = new LiftCycle();
    for (let i = 0; i < LIFT_CAPACITY - 1; i++) {
      expect(c.ready).toBe(true);
      c.land();
      expect(c.phase).toBe('idle');
    }
    expect(c.crates).toBe(3);
    c.land();
    expect(c.crates).toBe(4);
    expect(c.phase).toBe('full');
    expect(c.ready).toBe(false);
    c.land(); // ignored while busy
    expect(c.crates).toBe(4);
    const seen = new Set<string>();
    let maxSunk = 0;
    for (let t = 0; t < 6; t += 1 / 60) {
      c.update(1 / 60);
      seen.add(c.phase);
      maxSunk = Math.max(maxSunk, c.sunk);
      if (c.phase === 'idle') break;
    }
    expect([...seen]).toEqual(expect.arrayContaining(['sink', 'hold', 'rise', 'idle']));
    expect(maxSunk).toBeCloseTo(SINK_DEPTH, 1);
    expect(c.crates).toBe(0);
    expect(c.sunk).toBe(0);
    expect(c.ready).toBe(true);
  });
});
