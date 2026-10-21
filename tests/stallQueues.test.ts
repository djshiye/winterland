/**
 * 0.9.13 (review idea 2, E6): residents' errands. Every era's huts green has a market stall with a line in front of it
 * (eras/layout.ts greenStalls), every hut's door spot can walk to the back of the line and home again, and every leg of
 * those walks keeps clear of the huts, the decor (snow piles too: snowmen grow there), the green's benches, the spots
 * people stand at and the centrepiece. The loader at the parked era vehicle (eras 6-8) works off every walkway.
 */
import { describe, expect, it } from 'vitest';
import { greenActivities, greenStalls, greenWalk, hutBox, plotDecor, plotKeepOuts, plotPlaces, plotRoutes, regionLayout, QUEUE_PLACES, type XZ } from '../src/eras/layout';
import { LOAD_DROP, LOAD_PICK } from '../src/world/life/RegionLife';

type R = { minX: number; maxX: number; minZ: number; maxZ: number };
const grow = (r: R, m: number): R => ({ minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m });
const inR = (r: R, q: XZ): boolean => q.x > r.minX && q.x < r.maxX && q.z > r.minZ && q.z < r.maxZ;
function* samples(a: XZ, b: XZ): Generator<XZ> {
  const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
  for (let i = 0; i <= k; i++) yield { x: a.x + ((b.x - a.x) * i) / k, z: a.z + ((b.z - a.z) * i) / k };
}
function distToSeg(p: XZ, a: XZ, b: XZ): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/** How far (m) an errand walk keeps from a stall or crate (measured from the footprint's edge). */
const MIN_CLEAR = 0.35;

describe('stall queues and errand walks', () => {
  for (let n = 2; n <= 10; n++) {
    it(`era ${n}: a stall line every hut can walk to and home from, every leg clear`, () => {
      const P = plotPlaces(n);
      const W = greenWalk(P);
      const Q = greenStalls(n);
      const D = plotDecor(n);
      expect(Q.length, 'stalls with a line').toBeGreaterThan(0);
      expect(Q.length).toBe(D.filter((d) => d.kind === 'stall' && d.zone === 'huts').length);
      // every hut reaches at least one stall
      P.huts.forEach((_, i) => expect(Q.some((q) => q.to[i] && q.from[i]), `hut ${i}`).toBe(true));
      const huts = P.huts.map((h) => grow(hutBox(h, true), 0.2));
      const benches = [-1, 1].map((s) => grow({ minX: W.c.x + s * 3.2 - 0.8, maxX: W.c.x + s * 3.2 + 0.8, minZ: W.c.z - 0.23, maxZ: W.c.z + 0.23 }, 0.2));
      const zone = regionLayout(n).zones.huts;
      const acts = greenActivities(n);
      for (const q of Q) {
        expect(q.places).toHaveLength(QUEUE_PLACES);
        const mine = D.filter((d) => (d.x === q.x && d.z === q.z) || (d.kind === 'crates' && Math.hypot(d.x - q.x, d.z - q.z) < 2));
        const others = D.filter((d) => !mine.includes(d)).map((d) => grow({ minX: d.x - d.hx, maxX: d.x + d.hx, minZ: d.z - d.hz, maxZ: d.z + d.hz }, 0.2));
        const check = (a: XZ, b: XZ, what: string, away: readonly XZ[] = []): void => {
          for (const s of samples(a, b)) {
            expect(inR(zone, s), `${what}: in the huts zone`).toBe(true);
            expect(huts.some((r) => inR(r, s)), `${what}: through a hut`).toBe(false);
            expect(benches.some((r) => inR(r, s)), `${what}: through a green bench`).toBe(false);
            expect(others.some((r) => inR(r, s)), `${what}: through decor`).toBe(false);
            expect(Math.hypot(s.x - W.c.x, s.z - W.c.z), `${what}: the centrepiece`).toBeGreaterThan(1.5);
            for (const p of away) expect(Math.hypot(s.x - p.x, s.z - p.z), `${what}: through the line`).toBeGreaterThan(0.5);
          }
        };
        check(q.places[0]!, q.entry, 'the line');
        // nobody stands in the line's way: ring spots, seats and snowman builders
        for (const p of [...W.ring, ...acts.map((a) => ({ x: a.x, z: a.z }))]) expect(distToSeg(p, q.places[0]!, q.entry), 'a standing spot on the line').toBeGreaterThan(0.5);
        q.to.forEach((t, i) => {
          if (!t) return;
          expect(t[t.length - 1]).toEqual(q.entry);
          [W.doors[i]!, ...t].forEach((p, k, a) => k && check(a[k - 1]!, p, `hut ${i} to the line`));
        });
        q.from.forEach((f, i) => {
          if (!f) return;
          expect(f[f.length - 1]).toEqual(W.doors[i]);
          [q.places[0]!, ...f].forEach((p, k, a) => k && check(a[k - 1]!, p, `hut ${i} home`, k > 1 ? q.places.slice(1) : []));
        });
      }
    });
  }
  for (let n = 2; n <= 10; n++) {
    it(`era ${n}: errand walks keep ${MIN_CLEAR} m off every stall and crate footprint`, () => {
      const W = greenWalk(plotPlaces(n));
      const props = plotDecor(n).filter((d) => d.kind === 'stall' || d.kind === 'crates');
      for (const q of greenStalls(n)) {
        const legs: [XZ, XZ, string][] = [];
        q.to.forEach((t, i) => t && [W.doors[i]!, ...t].forEach((p, k, a) => k && legs.push([a[k - 1]!, p, `hut ${i} to the line`])));
        q.from.forEach((f, i) => f && [q.places[0]!, ...f].forEach((p, k, a) => k && legs.push([a[k - 1]!, p, `hut ${i} home`])));
        for (const [a, b, what] of legs) {
          for (const s of samples(a, b)) {
            for (const d of props) {
              const gx = Math.max(Math.abs(s.x - d.x) - d.hx, 0);
              const gz = Math.max(Math.abs(s.z - d.z) - d.hz, 0);
              expect(Math.hypot(gx, gz), `${what}: ${d.kind} at (${d.x}, ${d.z})`).toBeGreaterThanOrEqual(MIN_CLEAR);
            }
          }
        }
      }
    }, 30000);
  }
  for (let n = 6; n <= 8; n++) {
    it(`era ${n}: the loader's two spots at the parked vehicle are off every walkway and keep-out`, () => {
      const v = plotDecor(n).find((d) => d.kind === 'van')!;
      const at = (q: XZ): XZ => ({ x: v.x + q.x * Math.cos(v.yaw) + q.z * Math.sin(v.yaw), z: v.z - q.x * Math.sin(v.yaw) + q.z * Math.cos(v.yaw) });
      const spots = [at(LOAD_PICK), at(LOAD_DROP)];
      for (const s of samples(spots[0]!, spots[1]!)) {
        for (const r of plotRoutes(n)) for (let k = 1; k < r.pts.length; k++) expect(distToSeg(s, r.pts[k - 1]!, r.pts[k]!), r.what).toBeGreaterThan(1.0);
        for (const k of plotKeepOuts(n)) expect(inR(k.r, s), k.what).toBe(false);
        for (const d of plotDecor(n)) if (d !== v) expect(inR(grow({ minX: d.x - d.hx, maxX: d.x + d.hx, minZ: d.z - d.hz, maxZ: d.z + d.hz }, 0.2), s), `decor ${d.kind}`).toBe(false);
      }
    });
  }
});
