/** 0.9.13 (review E5, E6): eras 6-10 stock the huts green with stalls and a snowman, eras 6-8 park their vehicle in the market. */
import { describe, expect, it } from 'vitest';
import type { Rect } from '../src/config';
import { DECOR_SIZE, GREEN_PIECE_R, plotDecor, plotKeepOuts, plotRoutes, ROUTE_HALF, TALL_SHOP_H } from '../src/eras/layout';
import { GREEN_PIECE_H, placeSolids } from '../src/world/env/plots';
import { plotPlaces } from '../src/eras/layout';

const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

function distToSeg(px: number, pz: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
  return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
}
/** Least distance from a rect's corners and edge samples to a polyline (never under-reports by more than 2 cm). */
function distRectToPath(r: Rect, pts: { x: number; z: number }[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    for (let x = r.minX; x <= r.maxX + 1e-9; x += Math.max(0.02, (r.maxX - r.minX) / 40)) {
      for (const z of [r.minZ, r.maxZ]) best = Math.min(best, distToSeg(x, z, pts[i - 1]!, pts[i]!));
    }
    for (let z = r.minZ; z <= r.maxZ + 1e-9; z += Math.max(0.02, (r.maxZ - r.minZ) / 40)) {
      for (const x of [r.minX, r.maxX]) best = Math.min(best, distToSeg(x, z, pts[i - 1]!, pts[i]!));
    }
  }
  return best;
}

describe('eras 6-10: huts green stalls and snowman, market vehicle', () => {
  for (let n = 6; n <= 10; n++) {
    it(`era ${n}: a stall and a snowman in the huts zone, clear of every route and keep-out`, () => {
      const D = plotDecor(n);
      const huts = D.filter((d) => d.zone === 'huts');
      expect(huts.some((d) => d.kind === 'stall'), 'a stall').toBe(true);
      expect(huts.some((d) => d.kind === 'snowman'), 'a snowman').toBe(true);
      const routes = plotRoutes(n);
      const keeps = plotKeepOuts(n);
      for (const d of D.filter((x) => x.kind === 'stall' || x.kind === 'snowman' || x.kind === 'van')) {
        const r: Rect = { minX: d.x - d.hx, maxX: d.x + d.hx, minZ: d.z - d.hz, maxZ: d.z + d.hz };
        expect(d.h, `${d.kind} height`).toBeLessThanOrEqual(DECOR_SIZE[d.kind][2] + 1e-9);
        for (const rt of routes) expect(distRectToPath(r, rt.pts), `${d.kind} too close to "${rt.what}"`).toBeGreaterThanOrEqual(ROUTE_HALF);
        for (const k of keeps) expect(overlap(r, k.r), `${d.kind} on "${k.what}"`).toBe(false);
      }
    });
    it(`era ${n}: the green's centrepiece stays within ${GREEN_PIECE_R} m and its height`, () => {
      const s = placeSolids(n).find((x) => x.what === 'green centre')!;
      expect((s.r.maxX - s.r.minX) / 2).toBeLessThanOrEqual(GREEN_PIECE_R + 1e-9);
      expect(s.h).toBe(GREEN_PIECE_H[n]);
      expect(s.h).toBeLessThanOrEqual(3.6);
    });
  }
  for (let n = 6; n <= 8; n++) {
    it(`era ${n}: one parked van in the market zone, clear of every route and keep-out`, () => {
      const vans = plotDecor(n).filter((d) => d.kind === 'van');
      expect(vans.length).toBe(1);
      expect(vans[0]!.zone).toBe('market');
      const d = vans[0]!;
      const r: Rect = { minX: d.x - d.hx, maxX: d.x + d.hx, minZ: d.z - d.hz, maxZ: d.z + d.hz };
      for (const rt of plotRoutes(n)) expect(distRectToPath(r, rt.pts), rt.what).toBeGreaterThanOrEqual(ROUTE_HALF);
      for (const k of plotKeepOuts(n)) expect(overlap(r, k.r), k.what).toBe(false);
    });
  }
  it('eras 6 and 7 have two-storey shops, the others none', () => {
    for (let n = 2; n <= 10; n++) {
      const tall = plotPlaces(n).shops.filter((s) => s.h === TALL_SHOP_H).length;
      if (n === 6 || n === 7) expect(tall, `era ${n}`).toBeGreaterThan(0);
      else expect(tall, `era ${n}`).toBe(0);
    }
  });
});
