/** 0.9.12 people doing things on the era greens (eras/layout.ts greenActivities): every step off the ring is clear. */
import { describe, expect, it } from 'vitest';
import { greenActivities, greenWalk, hutBox, plotDecor, plotPlaces } from '../src/eras/layout';

type R = { minX: number; maxX: number; minZ: number; maxZ: number };
const inR = (r: R, x: number, z: number, m: number): boolean => x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m;

describe('greenActivities', () => {
  it('every era has something to do on its green', () => {
    let total = 0;
    for (let n = 2; n <= 10; n++) total += greenActivities(n).length;
    expect(total).toBeGreaterThan(20);
    for (let n = 2; n <= 10; n++) expect(greenActivities(n).some((a) => a.kind === 'snowman'), `era ${n}`).toBe(true);
  });

  for (let n = 2; n <= 10; n++) {
    it(`era ${n}: the walk from the ring spot keeps 0.3 m off every hut, other decor piece and the centrepiece`, () => {
      const P = plotPlaces(n);
      const W = greenWalk(P);
      const decor = plotDecor(n);
      for (const a of greenActivities(n)) {
        const ring = W.ring[a.ring]!;
        const pts = a.kind === 'sit' ? [ring, { x: a.ax, z: a.az }, { x: a.x, z: a.z }] : [ring, { x: a.x, z: a.z }];
        const own = decor.find((d) => (a.kind === 'sit' ? d.kind === 'bench' && Math.hypot(d.x - a.x, d.z - a.z) < 0.2 : d.kind === 'snow' && d.x === a.sx && d.z === a.sz));
        expect(own, `${a.kind} has its decor piece`).toBeDefined();
        for (let k = 1; k < pts.length; k++) {
          const p = pts[k - 1]!;
          const q = pts[k]!;
          for (let t = 0; t <= 1.0001; t += 0.05) {
            const x = p.x + (q.x - p.x) * t;
            const z = p.z + (q.z - p.z) * t;
            expect(Math.hypot(x - W.c.x, z - W.c.z), 'off the centrepiece').toBeGreaterThan(1.6);
            for (const h of P.huts) expect(inR(hutBox(h, true), x, z, 0.3), `through hut ${h.role}`).toBe(false);
            for (const d of decor) {
              if (d === own || d.kind === 'snow') continue;
              expect(inR({ minX: d.x - d.hx, maxX: d.x + d.hx, minZ: d.z - d.hz, maxZ: d.z + d.hz }, x, z, 0.3), `${a.kind} walk through a ${d.kind}`).toBe(false);
            }
          }
        }
      }
    });
  }
});
