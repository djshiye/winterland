/**
 * 0.9.7 era plots (R34, R22): every era 2..10 region gets era-1-style places (crew huts around a green, a market street
 * with shops and a stall, a paved processing yard, a harvest field of resource beds). They sit inside their zones, off
 * the paths, clear of every counter, pile and pad, and nothing tall stands between a pad and the camera.
 */
import { describe, expect, it } from 'vitest';
import type { Rect } from '../src/config';
import { CAMERA } from '../src/config';
import { REGIONS } from '../src/eras/data';
import { HUT_ANNEX, HUT_D, plotDecor, plotKeepOuts, plotPlaces, plotRoutes, regionLayout, ROUTE_HALF, STREET_MIN_DEPTH, type PlotPlaces, type RegionLayout } from '../src/eras/layout';
import { marketPlaces, DOCK_BODY, STALL_BODY } from '../src/eras/market';
import { LEVEL_PAD_SIZE, levelPadLocal, MACHINE_NOMINAL, machineFrame, toWorld, worldRect } from '../src/eras/rules';
import { nodePatch, regionPaths } from '../src/world/env/frontier';
import { HUT_MAX_H, hutFootprint, placeSolids, shopFootprint, SHOP_MAX_H } from '../src/world/env/plots';
import { greenLegs, greenSpots } from '../src/world/life/RegionLife';

const EPS = 1e-6;
const ERA_NS = REGIONS.filter((r) => r !== null).map((r) => r!.n);
const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;
const inside = (a: Rect, outer: Rect): boolean => a.minX >= outer.minX - EPS && a.maxX <= outer.maxX + EPS && a.minZ >= outer.minZ - EPS && a.maxZ <= outer.maxZ + EPS;
const box = (x: number, z: number, hx: number, hz = hx): Rect => ({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });
const grow = (r: Rect, m: number): Rect => ({ minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m });

/** The ground a solid of height h hides from the isometric camera (which sits toward +X/+Z): its footprint swept toward −X/−Z. */
function shadow(r: Rect, h: number): Rect {
  const reach = h / Math.tan((CAMERA.pitchDeg * Math.PI) / 180) / Math.SQRT2;
  return { minX: r.minX - reach, maxX: r.maxX, minZ: r.minZ - reach, maxZ: r.maxZ };
}

/** Distance from a point to a rect (0 inside). */
const distToRect = (x: number, z: number, r: Rect): number => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));

/** The least distance from a rect to a polyline, sampled every 5 cm (never under-reports: sampling only overstates the gap by under 5 cm). */
function distRectToPath(r: Rect, pts: { x: number; z: number }[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
    for (let k = 0; k <= steps; k++) best = Math.min(best, distToRect(a.x + ((b.x - a.x) * k) / steps, a.z + ((b.z - a.z) * k) / steps, r));
  }
  return best;
}

/** Every pad, counter and pile of a region the player has to see and reach (slots at full room, so later slots count). */
function mustSee(L: RegionLayout, n: number): { what: string; r: Rect }[] {
  const out: { what: string; r: Rect }[] = [];
  const def = REGIONS[n]!;
  const saved = def.slots;
  (def as { slots: number }).slots = Math.max(def.slots, def.room);
  try {
    const full = regionLayout(n);
    full.slots.forEach((s, i) => {
      const l = levelPadLocal(MACHINE_NOMINAL.w, MACHINE_NOMINAL.d);
      const p = toWorld(s, s.yaw, l.u, l.v);
      out.push({ what: `slot ${i} level pad`, r: box(p.x, p.z, LEVEL_PAD_SIZE / 2) });
      out.push({ what: `slot ${i} build tile`, r: box(s.x, s.z, L.padSize / 2) });
      const f = machineFrame(MACHINE_NOMINAL.w, MACHINE_NOMINAL.d);
      out.push({ what: `slot ${i} feed`, r: worldRect(s, s.yaw, f.feed) });
      out.push({ what: `slot ${i} take`, r: worldRect(s, s.yaw, f.take) });
    });
  } finally {
    (def as { slots: number }).slots = saved;
  }
  const P = marketPlaces(L);
  out.push({ what: 'vault pad', r: box(P.vaultPad.x, P.vaultPad.z, LEVEL_PAD_SIZE / 2) });
  out.push({ what: 'cash pile', r: box(P.cash.x, P.cash.z, 1) });
  out.push({ what: 'vault', r: box(P.vault.x, P.vault.z, 1.1, 1) });
  out.push({ what: 'dock counter', r: worldRect(P.dock, P.yaw, DOCK_BODY) });
  out.push({ what: 'stall counter', r: worldRect(P.stall, P.yaw, STALL_BODY) });
  out.push({ what: 'shopper queue', r: { minX: P.front.x - 9, maxX: P.front.x + 0.6, minZ: P.front.z - 0.6, maxZ: P.front.z + 0.6 } });
  out.push({ what: 'hand node', r: nodePatch(L) });
  for (const k of ['depot', 'dock', 'jack', 'shopMat', 'cashSpot'] as const) out.push({ what: k, r: box(L[k].x, L[k].z, 1.6) });
  return out;
}

describe('0.9.7 era plot places', () => {
  for (const n of ERA_NS) {
    const L = regionLayout(n);
    const P: PlotPlaces = plotPlaces(n);
    const Z = L.zones;
    const paths = regionPaths(L);
    // body plus the annex behind it (the biggest a hut grows)
    const hutRect = (h: PlotPlaces['huts'][number]): Rect => hutFootprint(h, true);

    it(`era ${n}: seven crew huts, one per role, inside the huts zone, apart, off the paths, around a green`, () => {
      expect(P.huts.map((h) => h.role)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      for (const h of P.huts) {
        const r = hutRect(h);
        expect(inside(r, Z.huts), `hut ${h.role}`).toBe(true);
        expect(h.w, `hut ${h.role} width`).toBeGreaterThanOrEqual(3.2);
        for (const q of paths) expect(overlap(r, q), `hut ${h.role} on a path`).toBe(false);
        expect(overlap(r, P.green), `hut ${h.role} on the green`).toBe(false);
      }
      for (let i = 0; i < P.huts.length; i++) for (let j = i + 1; j < P.huts.length; j++) expect(overlap(grow(hutRect(P.huts[i]!), 0.2), hutRect(P.huts[j]!)), `huts ${i}/${j}`).toBe(false);
      // doors face the camera (+X / +Z) so they read on screen; the annex adds its depth behind
      for (const h of P.huts) {
        expect(Math.sin(h.yaw) >= -EPS && Math.cos(h.yaw) >= -EPS, `hut ${h.role} faces away`).toBe(true);
        const a = hutRect(h);
        const b = hutFootprint(h, false);
        expect((a.maxX - a.minX) * (a.maxZ - a.minZ)).toBeCloseTo(h.w * h.d + HUT_ANNEX * h.w, 6);
        expect((b.maxX - b.minX) * (b.maxZ - b.minZ)).toBeCloseTo(h.w * HUT_D, 6);
      }
      expect(inside(P.green, Z.huts)).toBe(true);
      expect(P.green.maxZ - P.green.minZ).toBeGreaterThanOrEqual(4);
      expect(P.green.maxX - P.green.minX).toBeGreaterThanOrEqual(4);
    });

    it(`era ${n}: market streets behind the counters, each lined with shops, one open stall`, () => {
      const depth = (z: number): number => (z - L.gate.z) * L.inward;
      expect(P.streets.length).toBeGreaterThanOrEqual(1);
      for (const S of P.streets) {
        expect(inside(S, Z.market)).toBe(true);
        expect(Math.min(depth(S.minZ), depth(S.maxZ))).toBeGreaterThanOrEqual(STREET_MIN_DEPTH - EPS);
        expect(S.maxZ - S.minZ).toBeGreaterThanOrEqual(2.5);
        for (const q of paths) expect(overlap(S, q), 'street on a path').toBe(false);
      }
      expect(P.shops.length).toBeGreaterThanOrEqual(3 * P.streets.length);
      expect(P.shops.filter((s) => s.stall).length).toBe(1);
      const rects = P.shops.map(shopFootprint);
      rects.forEach((r, i) => {
        expect(inside(r, Z.market), 'shop in market').toBe(true);
        for (const S of P.streets) expect(overlap(r, S), 'shop on a street').toBe(false);
        for (const q of paths) expect(overlap(r, q), 'shop on a path').toBe(false);
        for (let j = i + 1; j < rects.length; j++) expect(overlap(r, rects[j]!), `shops ${i}/${j}`).toBe(false);
      });
      for (const l of P.lamps) expect(inside(box(l.x, l.z, 0.2), Z.market)).toBe(true);
    });

    it(`era ${n}: the yard floor covers every room slot and the field beds lie in the harvest, clear of the hand node`, () => {
      expect(inside(P.yardPave, Z.processing)).toBe(true);
      const def = REGIONS[n]!;
      const saved = def.slots;
      (def as { slots: number }).slots = def.room;
      try {
        for (const s of regionLayout(n).slots) expect(inside(box(s.x, s.z, 2.6, 2.5), P.yardPave), `slot at ${s.x},${s.z}`).toBe(true);
      } finally {
        (def as { slots: number }).slots = saved;
      }
      expect(P.beds.length).toBeGreaterThanOrEqual(2);
      for (const b of P.beds) {
        expect(inside(b, Z.harvest)).toBe(true);
        expect(inside(b, P.field)).toBe(true);
        expect(overlap(b, nodePatch(L))).toBe(false);
        for (const q of paths) expect(overlap(b, q), 'bed on a path').toBe(false);
      }
    });

    it(`era ${n}: EM1 decor lives in the market and huts zones and keeps every walkway 1.25 m clear`, () => {
      const D = plotDecor(n);
      const routes = plotRoutes(n);
      const keeps = plotKeepOuts(n);
      const rectOf = (d: (typeof D)[number]): Rect => box(d.x, d.z, d.hx, d.hz);
      // lived in: both zones got something, a piece of the era's own clutter and a lamp for the night
      expect(D.filter((d) => d.zone === 'market').length, 'market decor').toBeGreaterThanOrEqual(6);
      expect(D.filter((d) => d.zone === 'huts').length, 'huts decor').toBeGreaterThanOrEqual(4);
      expect(D.some((d) => d.kind === 'sig'), 'era clutter').toBe(true);
      expect(D.some((d) => d.kind === 'lamp'), 'a lamp for the night').toBe(true);
      // the routes found: shoppers, the clerk's aisle, the player's way, the vehicle lane and every hut door
      const names = routes.map((r) => r.what).join('|');
      for (const w of ['customers: market gate', 'customers: the queue', 'vehicles', 'player: entry', 'clerk: cash pile', 'player: the path down the west edge', 'hut 0: door', 'hut 6: door', 'green: a stroll round the ring']) expect(names, w).toContain(w);
      D.forEach((d, i) => {
        const r = rectOf(d);
        expect(inside(r, Z[d.zone]), `${d.kind} ${i} inside the ${d.zone} zone`).toBe(true);
        expect(d.h, `${d.kind} ${i} height`).toBeLessThanOrEqual(3.2);
        for (const rt of routes) expect(distRectToPath(r, rt.pts), `${d.kind} ${i} at ${d.x.toFixed(1)},${d.z.toFixed(1)} too close to "${rt.what}"`).toBeGreaterThanOrEqual(ROUTE_HALF);
        for (const k of keeps) expect(overlap(r, k.r), `${d.kind} ${i} on "${k.what}"`).toBe(false);
        for (let j = i + 1; j < D.length; j++) expect(overlap(r, rectOf(D[j]!)), `decor ${i}/${j}`).toBe(false);
        for (const q of paths) expect(overlap(r, q), `${d.kind} ${i} on a path`).toBe(false);
        // hut doors, annexes and shop fronts stay free too
        for (const h of P.huts) expect(overlap(r, hutRect(h)), `${d.kind} ${i} on hut ${h.role} or its annex`).toBe(false);
        for (const sh of P.shops) expect(overlap(r, shopFootprint(sh)), `${d.kind} ${i} on a shop`).toBe(false);
        for (const S of P.streets) expect(overlap(r, S), `${d.kind} ${i} on a street`).toBe(false);
      });
      // the hut routes use the same door spots, spokes and ring RegionLife walks the crew's families along
      const spots = greenSpots(P, P.huts.map(() => true));
      const at = (p: { x: number; z: number }): Rect => ({ minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z });
      for (const sp of spots) {
        const on = routes.some((rt) => distRectToPath(at(sp), rt.pts) < 0.02);
        expect(on, `green spot ${sp.x.toFixed(2)},${sp.z.toFixed(2)} is on a route`).toBe(true);
      }
      // and every leg of every walk between two spots (greenLegs) is 1.25 m clear of every decor piece
      spots.forEach((a, ia) =>
        spots.forEach((_, ib) => {
          let p: { x: number; z: number } = a;
          for (const q of greenLegs(spots, ia, ib)) {
            for (const d of D) expect(distRectToPath(rectOf(d), [p, q]), `${d.kind} at ${d.x.toFixed(1)},${d.z.toFixed(1)} on the green walk ${ia}->${ib}`).toBeGreaterThanOrEqual(ROUTE_HALF);
            p = q;
          }
        }),
      );
    });

    it(`era ${n}: nothing new stands on, or hides from the camera, a pad, counter, pile or the hand node (R22)`, () => {
      const solids = placeSolids(n);
      expect(solids.length).toBeGreaterThan(10);
      for (const s of solids) {
        expect(s.h, s.what).toBeLessThanOrEqual(Math.max(HUT_MAX_H, SHOP_MAX_H));
        for (const m of mustSee(L, n)) {
          expect(overlap(s.r, m.r), `${s.what} stands on ${m.what}`).toBe(false);
          expect(overlap(shadow(s.r, s.h), m.r), `${s.what} hides ${m.what}`).toBe(false);
        }
      }
    });
  }
});
