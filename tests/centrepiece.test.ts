/** 0.9.12: one centrepiece in every era market, with room to walk round it (eras/layout.ts plotDecor). */
import { describe, expect, it } from 'vitest';
import { CENTRE_ROOM_MIN, DECOR_SIZE, plotDecor, plotRoutes, regionLayout } from '../src/eras/layout';
import { plotPlaces } from '../src/eras/layout';

describe('market centrepieces', () => {
  for (let n = 2; n <= 10; n++) {
    it(`era ${n}: one, inside the market, clear of every route, shop and decor piece`, () => {
      const all = plotDecor(n);
      const c = all.filter((d) => d.kind === 'centre');
      expect(c.length).toBe(1);
      const p = c[0]!;
      const M = regionLayout(n).zones.market;
      const [hx] = DECOR_SIZE.centre;
      expect(p.x - hx).toBeGreaterThan(M.minX);
      expect(p.x + hx).toBeLessThan(M.maxX);
      expect(p.z - hx).toBeGreaterThan(M.minZ);
      expect(p.z + hx).toBeLessThan(M.maxZ);
      const gap = (r: { minX: number; maxX: number; minZ: number; maxZ: number }): number =>
        Math.max(r.minX - (p.x + hx), p.x - hx - r.maxX, r.minZ - (p.z + hx), p.z - hx - r.maxZ);
      for (const d of all) if (d !== p && d.kind !== 'snow') expect(gap({ minX: d.x - d.hx, maxX: d.x + d.hx, minZ: d.z - d.hz, maxZ: d.z + d.hz }), d.kind).toBeGreaterThanOrEqual(CENTRE_ROOM_MIN - 0.3);
      for (const s of plotPlaces(n).shops) expect(gap({ minX: s.x - s.w / 2, maxX: s.x + s.w / 2, minZ: s.z - s.d / 2, maxZ: s.z + s.d / 2 })).toBeGreaterThanOrEqual(CENTRE_ROOM_MIN - 0.3);
      for (const r of plotRoutes(n)) for (const q of r.pts) expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeGreaterThan(hx + 1);
    });
  }
});
