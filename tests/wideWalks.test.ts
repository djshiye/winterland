/**
 * 0.9.12 (Dino: "make sure … there's a lotta room to walk around to not collide when i'm trying to walk through the
 * towns and cities"): every main walk through a city district keeps at least WIDE_WALK metres clear of anything solid,
 * with every lot built at its widest footprint. The era regions' market and hut walks are held to the same 3 m by
 * eras/layout.ts ROUTE_HALF (tests/plotPlaces.test.ts checks every decor piece against every route).
 */
import { describe, expect, it } from 'vitest';
import { DISTRICTS, MAX_ERA, ROADS } from '../src/eras/data';
import { ROUTE_HALF } from '../src/eras/layout';
import { districtLots, rectsOverlap } from '../src/city/rules';
import { districtDecor } from '../src/city/decor';

const WIDE_WALK = 3;
const ERA_NS = Array.from({ length: MAX_ERA - 1 }, (_, i) => i + 2);

describe('wide walks (0.9.12)', () => {
  it('the era region walks are 3 m wide', () => {
    expect(2 * ROUTE_HALF).toBeGreaterThanOrEqual(WIDE_WALK);
  });

  it('between two rows of a district there is a 3 m walk the whole way across', () => {
    for (const n of ERA_NS) {
      const lots = districtLots(n);
      const rows = [...new Set(lots.map((f) => f.cell.minZ))].sort((a, b) => a - b);
      for (let r = 0; r + 1 < rows.length; r++) {
        const front = Math.max(...lots.filter((f) => f.cell.minZ === rows[r]).map((f) => f.rect.maxZ));
        const back = Math.min(...lots.filter((f) => f.cell.minZ === rows[r + 1]).map((f) => f.rect.minZ));
        expect(back - front, `district ${n} rows ${r}/${r + 1}`).toBeGreaterThanOrEqual(WIDE_WALK);
      }
    }
  });

  it('round every district, its sidewalk plus the street next to it give a 3 m walk past every building', () => {
    for (const n of ERA_NS) {
      const d = DISTRICTS[n]!.rect;
      const lots = districtLots(n);
      const minX = Math.min(...lots.map((f) => f.rect.minX)) - d.minX;
      const maxX = d.maxX - Math.max(...lots.map((f) => f.rect.maxX));
      const minZ = Math.min(...lots.map((f) => f.rect.minZ)) - d.minZ;
      const maxZ = d.maxZ - Math.max(...lots.map((f) => f.rect.maxZ));
      // each side either has a street along it (open, walkable) or the sidewalk alone is wide enough
      const street = (side: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean => ROADS.some((q) => rectsOverlap(q.rect, side));
      const sides = [
        { gap: minX, rect: { minX: d.minX - 4, maxX: d.minX, minZ: d.minZ + 1, maxZ: d.maxZ - 1 } },
        { gap: maxX, rect: { minX: d.maxX, maxX: d.maxX + 4, minZ: d.minZ + 1, maxZ: d.maxZ - 1 } },
        { gap: minZ, rect: { minX: d.minX + 1, maxX: d.maxX - 1, minZ: d.minZ - 4, maxZ: d.minZ } },
        { gap: maxZ, rect: { minX: d.minX + 1, maxX: d.maxX - 1, minZ: d.maxZ, maxZ: d.maxZ + 4 } },
      ];
      for (const s of sides) expect(s.gap >= WIDE_WALK || (s.gap >= 2 && street(s.rect)), `district ${n} side gap ${s.gap.toFixed(2)}`).toBe(true);
    }
  });

  it('street furniture never stands in the walk between two rows', () => {
    for (const n of ERA_NS) {
      const lots = districtLots(n);
      for (const it of districtDecor(n)) {
        for (const f of lots) {
          // the lane in front of every building, out to the cell edge, is the walk
          const lane = { minX: f.cell.minX, maxX: f.cell.maxX, minZ: f.rect.maxZ, maxZ: f.cell.maxZ };
          const inLane = it.x > lane.minX && it.x < lane.maxX && it.z > lane.minZ && it.z < lane.maxZ;
          expect(inLane, `district ${n} ${it.kind} at ${it.x.toFixed(1)},${it.z.toFixed(1)}`).toBe(false);
        }
      }
    }
  });
});
