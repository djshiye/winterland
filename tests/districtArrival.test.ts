import { describe, expect, it } from 'vitest';
import { DECOR_RADIUS, decorColliders, districtDecor, districtLamps } from '../src/city/decor';
import { districtInner, districtLots } from '../src/city/rules';
import { DISTRICTS } from '../src/eras/data';
import { districtArrival } from '../src/eras/layout';

const inRect = (p: { x: number; z: number }, r: { minX: number; maxX: number; minZ: number; maxZ: number }, pad = 0): boolean => p.x > r.minX - pad && p.x < r.maxX + pad && p.z > r.minZ - pad && p.z < r.maxZ + pad;

describe('district arrival (0.9.12)', () => {
  for (let n = 2; n <= 10; n++) {
    it(`district ${n} lands on clear ground inside its own sidewalk ring`, () => {
      const at = districtArrival(n);
      const d = DISTRICTS[n]!;
      expect(inRect(at, d.rect), 'inside the district').toBe(true);
      for (const L of districtLots(n)) {
        expect(inRect(at, L.rect, 0.8), `off lot ${L.index}'s building`).toBe(false);
        expect(inRect(at, L.zone, 0.5), `off lot ${L.index}'s pad`).toBe(false);
      }
      for (const it of districtDecor(n)) expect(Math.hypot(it.x - at.x, it.z - at.z), `off the ${it.kind}`).toBeGreaterThan(DECOR_RADIUS[it.kind] * it.scale + 0.5);
      for (const l of districtLamps(n)) expect(Math.hypot(l.x - at.x, l.z - at.z), 'off a lamp').toBeGreaterThan(0.6);
    });
  }
  it('every district lands on its front sidewalk with all its lots ahead, so no building stands between the camera and the player', () => {
    for (let n = 2; n <= 10; n++) {
      const at = districtArrival(n);
      const inner = districtInner(n);
      expect(at.z, `district ${n} south of its lots`).toBeGreaterThan(inner.maxZ);
      // the camera looks from +X/+Z: nothing of a lot may lie on that side of the player
      for (const L of districtLots(n)) expect(L.rect.maxZ, `district ${n} lot ${L.index}`).toBeLessThan(at.z - 2);
      expect(Math.abs(at.x - (inner.minX + inner.maxX) / 2), `district ${n} near the middle`).toBeLessThan((inner.maxX - inner.minX) / 3);
    }
  });
  it('street furniture blocks inside its own footprint only (E9), so the walks stay free', () => {
    for (let n = 2; n <= 10; n++) {
      for (const it of districtDecor(n)) {
        for (const c of decorColliders(it)) expect(Math.hypot(c.x - it.x, c.z - it.z) + c.r, `district ${n} ${it.kind}`).toBeLessThanOrEqual(DECOR_RADIUS[it.kind] * it.scale + 1e-6);
      }
    }
  });
});
