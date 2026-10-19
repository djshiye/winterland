/**
 * Warm-up spots (eras 2-10): each era region has one low cozy spot on free harvest ground, clear of its landmark, the
 * region paths, the field, the hand node and the market keep-outs; the warming rule has on / off hysteresis.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GroundKit, eraGround, eraKeepOut } from '../src/world/env/eraGround';
import type { Rect } from '../src/config';
import { plotPlaces, regionLayout } from '../src/eras/layout';
import { stepWarm, WARM, type WarmState } from '../src/fx/WarmUp';
import { Rng } from '../src/world/env/common';
import { nodePatch, regionPaths } from '../src/world/env/frontier';
import { landmarkRect } from '../src/world/env/ground/landmarks2to5';
import { landmarkRect89 } from '../src/world/env/ground/landmarks8to9';
import { sightKeep } from '../src/world/env/ground/kit4to7';
import { WARM_ERAS, WARM_H, WARM_HALF, warmSpotFor, warmSpotGeo, warmSpotRect, type WarmEra } from '../src/world/env/ground/warmSpots';
import { warmExtra, warmSpot } from '../src/world/env/ground/warmSpotsAt';

const EPS = 1e-6;
const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;

function landmark(n: WarmEra, l = regionLayout(n)): Rect[] {
  if (n <= 5) return landmarkRect(l, n as 2 | 3 | 4 | 5, warmExtra(l, n));
  if (n === 8 || n === 9) return landmarkRect89(l, n);
  return [];
}

describe('warm spot placement', () => {
  for (const n of WARM_ERAS) {
    it(`era ${n}: a deterministic spot inside the harvest zone, off everything`, () => {
      const l = regionLayout(n);
      const s = warmSpot(l, n);
      expect(s, 'a spot exists').not.toBeNull();
      expect(warmSpot(regionLayout(n), n)).toEqual(s);
      const [r] = warmSpotRect(l, n, warmExtra(l, n));
      expect(r!.maxX - r!.minX).toBeCloseTo(2 * WARM_HALF);
      const H = l.zones.harvest;
      expect(r!.minX).toBeGreaterThanOrEqual(H.minX);
      expect(r!.maxX).toBeLessThanOrEqual(H.maxX);
      expect(r!.minZ).toBeGreaterThanOrEqual(H.minZ);
      expect(r!.maxZ).toBeLessThanOrEqual(H.maxZ);
      expect(r!.minX).toBeGreaterThanOrEqual(l.rect.minX);
      expect(r!.maxX).toBeLessThanOrEqual(l.rect.maxX);
      expect(r!.minZ).toBeGreaterThanOrEqual(l.rect.minZ);
      expect(r!.maxZ).toBeLessThanOrEqual(l.rect.maxZ);
      for (const lm of landmark(n, l)) expect(overlap(r!, lm), 'landmark').toBe(false);
      for (const lm of warmExtra(l, n)) expect(overlap(r!, lm), 'era keep-out').toBe(false);
      for (const p of regionPaths(l)) expect(overlap(r!, p), 'path').toBe(false);
      expect(overlap(r!, plotPlaces(n).field), 'field').toBe(false);
      for (const q of sightKeep(l, WARM_H)) expect(overlap(r!, q), 'sight keep').toBe(false);
      expect(overlap(r!, nodePatch(l)), 'node patch').toBe(false);
      // the gate-side market / yard stops the layout names
      for (const q of [l.depot, l.dock, l.jack, l.shopMat, l.cashSpot, l.marketGate, l.gate]) {
        expect(Math.hypot(q.x - s!.x, q.z - s!.z), 'facility').toBeGreaterThan(WARM_HALF + 1);
      }
    });

    it(`era ${n}: low, no collider, and kept out of the module's random props`, () => {
      const g = warmSpotGeo(n);
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y).toBeLessThanOrEqual(WARM_H + 1e-6);
      expect(g.boundingBox!.max.x).toBeLessThanOrEqual(WARM_HALF + 1e-6);
      expect(g.boundingBox!.min.x).toBeGreaterThanOrEqual(-WARM_HALF - 1e-6);
      expect(g.boundingBox!.max.z).toBeLessThanOrEqual(WARM_HALF + 1e-6);
      expect(g.boundingBox!.min.z).toBeGreaterThanOrEqual(-WARM_HALF - 1e-6);
      const l = regionLayout(n);
      const keep = eraKeepOut(n, l);
      const [r] = warmSpotRect(l, n, warmExtra(l, n));
      expect(keep.some((q) => q.minX <= r!.minX + EPS && q.maxX >= r!.maxX - EPS && q.minZ <= r!.minZ + EPS && q.maxZ >= r!.maxZ - EPS)).toBe(true);
    });

    it(`era ${n}: the wild dressing draws it into the solid and glow batches with a halo lamp`, () => {
      const l = regionLayout(n);
      const k = new GroundKit();
      eraGround(n)!.wild!(k, l, new Rng(7300 + n * 53));
      const s = warmSpot(l, n)!;
      expect(k.lamps.some((p) => Math.abs(p.x - s.x) < 1.3 && Math.abs(p.z - s.z) < 1.3)).toBe(true);
      k.lamps.length = 0; // the night halos need a DOM canvas
      const group = k.build(`t${n}`);
      const near = (suffix: string): boolean => {
        let hit = false;
        group.traverse((o) => {
          if (!(o instanceof THREE.Mesh) || !o.name.endsWith(suffix)) return;
          const pos = o.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i) - s.x) < WARM_HALF && Math.abs(pos.getZ(i) - s.z) < WARM_HALF) hit = true;
        });
        return hit;
      };
      expect(near(':solid'), 'solid').toBe(true);
      expect(near(':glow'), 'glow').toBe(true);
    });
  }

  it('is pure: the generic search agrees with the helper and prefers ground near the hand node', () => {
    for (const n of WARM_ERAS) {
      const l = regionLayout(n);
      expect(warmSpotFor(l, n, warmExtra(l, n))).toEqual(warmSpot(l, n));
      const s = warmSpot(l, n)!;
      const H = l.zones.harvest;
      const mid = Math.hypot((H.maxX - H.minX) / 2, (H.maxZ - H.minZ) / 2);
      expect(Math.hypot(s.x - l.node.x, s.z - l.node.z)).toBeLessThan(mid);
    }
  });
});

describe('warming rule', () => {
  const fresh = (): WarmState => ({ on: false, held: 0 });
  it('turns on after standing still within 1.4 m for 1 s', () => {
    const s = fresh();
    for (let i = 0; i < 50; i++) expect(stepWarm(s, 1.0, 0, 0.016)).toBe(false);
    for (let i = 0; i < 20; i++) stepWarm(s, 1.0, 0, 0.016);
    expect(s.on).toBe(true);
  });
  it('needs stillness and closeness: moving or standing off resets the count', () => {
    const s = fresh();
    stepWarm(s, 1.0, 0, 0.9);
    stepWarm(s, 1.0, WARM.speed + 0.1, 0.1);
    expect(s.held).toBe(0);
    stepWarm(s, 1.0, 0, 0.9);
    stepWarm(s, WARM.enter + 0.2, 0, 0.5);
    expect(s.on).toBe(false);
    expect(s.held).toBe(0);
    expect(stepWarm(s, 1.0, 0, 1.01)).toBe(true);
  });
  it('stays on between 1.4 and 1.8 m, even walking, and ends beyond 1.8 m', () => {
    const s = fresh();
    expect(stepWarm(s, 0.5, 0, 1.1)).toBe(true);
    expect(stepWarm(s, 1.6, 0, 0.1)).toBe(true);
    expect(stepWarm(s, 1.7, 2.0, 0.1)).toBe(true);
    expect(stepWarm(s, WARM.leave + 0.05, 0, 0.1)).toBe(false);
    // and must be earned again: just inside the enter radius, then a full second
    expect(stepWarm(s, 1.3, 0, 0.5)).toBe(false);
    expect(stepWarm(s, 1.3, 0, 0.6)).toBe(true);
  });
});
