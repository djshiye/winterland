/** EM3: the snowy verge outside open district edges sits outside every district and off every road, with 2.5 m clear of road ends. */
import { describe, expect, it } from 'vitest';
import { DISTRICTS, MAX_ERA, ROADS, districtDef } from '../src/eras/data';
import { VERGE_ROAD_CLEAR, districtVerge, outerSides } from '../src/city/verge';

const eras = Array.from({ length: MAX_ERA - 1 }, (_v, i) => i + 2);
const overlap = (p: { x: number; z: number; hx: number; hz: number }, r: { minX: number; maxX: number; minZ: number; maxZ: number }, m = 0): boolean =>
  p.x + p.hx > r.minX - m && p.x - p.hx < r.maxX + m && p.z + p.hz > r.minZ - m && p.z - p.hz < r.maxZ + m;

describe('districtVerge', () => {
  it('the top row and the east column face open snow', () => {
    expect(outerSides(2)).toContain('n');
    expect(outerSides(4)).toEqual(expect.arrayContaining(['n', 'e']));
    expect(outerSides(7)).toContain('e');
    expect(outerSides(7)).not.toContain('w');
  });

  it.each(eras)('era %i: outside every district, off every road, clear of road ends', (n) => {
    const def = districtDef(n).rect;
    const near = { x: (def.minX + def.maxX) / 2, z: (def.minZ + def.maxZ) / 2, hx: (def.maxX - def.minX) / 2 + 1, hz: (def.maxZ - def.minZ) / 2 + 1 };
    for (const p of districtVerge(n)) {
      for (const d of DISTRICTS) if (d) expect(overlap(p, d.rect), `${p.kind} at ${p.x},${p.z} in a district`).toBe(false);
      for (const r of ROADS) {
        expect(overlap(p, r.rect), `${p.kind} at ${p.x},${p.z} on ${r.id}`).toBe(false);
        if (overlap(near, r.rect)) expect(overlap(p, r.rect, VERGE_ROAD_CLEAR - 1e-6), `${p.kind} at ${p.x},${p.z} too close to ${r.id}`).toBe(false);
      }
    }
  });

  it('is stable and present on open edges only', () => {
    expect(districtVerge(4).length).toBeGreaterThan(20);
    expect(districtVerge(4)).toBe(districtVerge(4));
    expect(districtVerge(5).length).toBe(0);
  });
});
