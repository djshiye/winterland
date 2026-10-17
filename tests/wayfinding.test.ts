/**
 * 0.9.9: the fingerposts at the era trail's junctions and the customers' footpath on to R1 (world/env/wayfinding.ts).
 */
import { describe, expect, it } from 'vitest';
import { LAYOUT, type Rect } from '../src/config';
import { DISTRICTS, REGIONS, RIVER_POND, ROADS } from '../src/eras/data';
import { footpathRect, JUNCTIONS, signArms } from '../src/world/env/wayfinding';

const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
const inside = (r: Rect, x: number, z: number, m = 0): boolean => x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m;
const road = (id: string): Rect => ROADS.find((r) => r.id === id)!.rect;

describe('fingerposts', () => {
  it('stand beside their junction, off every road, region, district and the town', () => {
    for (const j of JUNCTIONS) {
      for (const id of j.roads) expect(ROADS.some((r) => r.id === id), `${j.id}: ${id}`).toBe(true);
      // the junction is where its roads meet
      for (const id of j.roads) expect(inside(road(id), j.at.x, j.at.z, 0.01), `${j.id} on ${id}`).toBe(true);
      expect(Math.hypot(j.post.x - j.at.x, j.post.z - j.at.z), j.id).toBeLessThan(6);
      for (const r of ROADS) expect(inside(r.rect, j.post.x, j.post.z, 0.4), `${j.id} post on ${r.id}`).toBe(false);
      for (const r of REGIONS) if (r) expect(inside(r.rect, j.post.x, j.post.z, 0.6), `${j.id} post in region ${r.n}`).toBe(false);
      for (const d of DISTRICTS) if (d) expect(inside(d.rect, j.post.x, j.post.z, 0.6), `${j.id} post in district ${d.n}`).toBe(false);
      expect(inside(LAYOUT.town.area, j.post.x, j.post.z, 0.6), `${j.id} post in town`).toBe(false);
    }
  });

  it('point down the trail: later eras one way, earlier the other, every arm along a road axis', () => {
    for (const j of JUNCTIONS) {
      const arms = signArms(j);
      expect(arms.length, j.id).toBeGreaterThanOrEqual(2);
      for (const a of arms) {
        expect(Math.abs(a.dir.x) + Math.abs(a.dir.z), j.id).toBe(1);
        expect(a.text.length, j.id).toBeGreaterThan(0);
      }
      // no two arms of a post point the same way
      const dirs = arms.map((a) => `${a.dir.x},${a.dir.z}`);
      expect(new Set(dirs).size, `${j.id}: ${dirs.join(' ')}`).toBe(dirs.length);
    }
    const arms = (id: string) => signArms(JUNCTIONS.find((j) => j.id === id)!);
    // from the town's avenue, era II is west along R1
    expect(arms('avenue')[0]).toEqual({ dir: { x: -1, z: 0 }, text: 'II Granite Hollow · III–X' });
    // the west corner turns down the link to era V, back east to IV
    expect(arms('westCorner').map((a) => a.dir)).toEqual([{ x: 0, z: 1 }, { x: 1, z: 0 }]);
    expect(arms('westCorner')[0]!.text.startsWith('V ')).toBe(true);
    expect(arms('westCorner')[1]!.text.startsWith('IV ')).toBe(true);
    // on R2 between VII and VIII
    expect(arms('cityV1Foot')[0]!.text.startsWith('VIII ')).toBe(true);
    expect(arms('cityV1Foot')[1]!.text.startsWith('VII ')).toBe(true);
    // the last junction: on to IX and X
    expect(arms('eastFoot')[0]!.text).toBe('IX Atom Valley · X');
  });
});

describe('the customers’ footpath', () => {
  it('runs from the end of their lane to R1, clear of the pond and of every region', () => {
    const F = footpathRect();
    const lane = LAYOUT.customers.path;
    expect(F.minZ).toBeLessThanOrEqual(lane.maxZ);
    expect(F.maxZ).toBeGreaterThan(road('r1').minZ);
    expect(F.minX).toBeGreaterThanOrEqual(lane.minX);
    expect(F.maxX).toBeLessThanOrEqual(lane.maxX);
    expect(overlap(F, { ...RIVER_POND, minX: RIVER_POND.minX - 1, maxX: RIVER_POND.maxX + 1 })).toBe(false);
    for (const r of REGIONS) if (r) expect(overlap(F, r.rect), `region ${r.n}`).toBe(false);
  });
});
