import { describe, expect, it } from 'vitest';
import { ROADS, type ERect } from '../src/eras/data';
import { centreDashes, crosswalkRect, crosswalks } from '../src/world/env/roadMarks';
import { isStreet } from '../src/world/env/roadJoins';

const inside = (r: ERect, q: ERect): boolean => q.minX >= r.minX - 1e-6 && q.maxX <= r.maxX + 1e-6 && q.minZ >= r.minZ - 1e-6 && q.maxZ <= r.maxZ + 1e-6;
const road = (id: string): ERect => ROADS.find((r) => r.id === id)!.rect;
const hits = (a: ERect, b: ERect): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

describe('road markings', () => {
  it('every crosswalk lies inside its road and clear of the other roads', () => {
    const list = crosswalks();
    expect(list.length).toBeGreaterThan(20);
    for (const c of list) {
      const q = crosswalkRect(c);
      expect(inside(road(c.road), q)).toBe(true);
      for (const o of ROADS) if (o.id !== c.road) expect(hits(q, o.rect)).toBe(false);
    }
  });

  it('has a crossing at every region gate, the town mouths and city connectors', () => {
    const list = crosswalks();
    expect(list.filter((c) => c.road === 'r1' || c.road === 'r2' || c.road === 'r3').length).toBeGreaterThanOrEqual(10);
    expect(list.some((c) => c.road === 'townEast')).toBe(true);
    expect(list.some((c) => c.road === 'cityLink')).toBe(true);
    expect(list.some((c) => c.road === 'cityWest' && c.axis === 'z')).toBe(true);
    expect(list.some((c) => c.road === 'cityH1' && c.axis === 'x')).toBe(true);
  });

  it('centre dashes are on city streets only, on the centre line, clear of crossings and junctions', () => {
    const dashes = centreDashes();
    expect(dashes.length).toBeGreaterThan(50);
    const cws = crosswalks();
    for (const d of dashes) {
      expect(isStreet(d.road)).toBe(true);
      const r = road(d.road);
      const q: ERect = d.axis === 'x' ? { minX: d.x - d.len / 2, maxX: d.x + d.len / 2, minZ: d.z - d.w / 2, maxZ: d.z + d.w / 2 } : { minX: d.x - d.w / 2, maxX: d.x + d.w / 2, minZ: d.z - d.len / 2, maxZ: d.z + d.len / 2 };
      expect(inside(r, q)).toBe(true);
      for (const o of ROADS) if (o.id !== d.road) expect(hits(q, o.rect)).toBe(false);
      for (const c of cws) if (c.road === d.road) expect(hits(q, crosswalkRect(c))).toBe(false);
    }
  });
});
