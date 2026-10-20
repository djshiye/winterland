import { describe, expect, it } from 'vitest';
import { DECOR_RADIUS, districtDecor, districtLamps } from '../src/city/decor';
import { districtGrid, districtInner, districtLots } from '../src/city/rules';
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
  it('three-row districts land among their lots, not on the south street', () => {
    for (let n = 2; n <= 10; n++) {
      if (districtGrid(DISTRICTS[n]!.lots).rows < 3) continue;
      const inner = districtInner(n);
      expect(districtArrival(n).z, `district ${n}`).toBeLessThan(inner.maxZ - 4);
    }
  });
});
