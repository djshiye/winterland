/** 0.9.12: the era towns' lantern garlands hang over everyone's heads and never run through a shop (world/env/plots.ts). */
import { describe, expect, it } from 'vitest';
import { plotPlaces } from '../src/eras/layout';
import { ropePoint, type V3 } from '../src/world/env/festive';
import { plotGarlands, shopFootprint } from '../src/world/env/plots';

describe('lantern garlands', () => {
  for (let n = 2; n <= 10; n++) {
    it(`era ${n}`, () => {
      const G = plotGarlands(n);
      expect(G.length).toBeGreaterThan(n >= 9 ? 1 : 6);
      const shops = plotPlaces(n).shops;
      const q: V3 = { x: 0, y: 0, z: 0 };
      for (const g of G) {
        for (let k = 0; k <= 20; k++) {
          ropePoint(g.a, g.b, g.sag, k / 20, q);
          // the lanterns hang 0.27 m under the wire: over a tall walker's head across the street, over the door under an eave
          expect(q.y - 0.27, `low at ${q.x.toFixed(1)},${q.z.toFixed(1)}`).toBeGreaterThan(g.eave ? 1.95 : 2.25);
          for (const s of shops) {
            const f = shopFootprint(s);
            const inside = q.x > f.minX + 0.05 && q.x < f.maxX - 0.05 && q.z > f.minZ + 0.05 && q.z < f.maxZ - 0.05;
            expect(inside && q.y < s.h, `through a shop at ${q.x.toFixed(1)},${q.z.toFixed(1)}`).toBe(false);
          }
        }
      }
    });
  }
});
