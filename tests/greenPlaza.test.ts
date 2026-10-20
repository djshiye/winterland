/**
 * 0.9.12 polish: the plaza walks on the big crew greens (eras/layout.ts greenPlaza, drawn by world/env/plots.ts
 * buildGreen). Nothing stands on them: every decor piece, the green's own benches and every activity spot keeps
 * PLAZA_CLEAR off the walks' edges, and the greens still have plenty of decor.
 */
import { describe, expect, it } from 'vitest';
import { greenActivities, greenPlaza, PLAZA_CLEAR, PLAZA_HALF, plazaDist, plotDecor, plotPlaces } from '../src/eras/layout';

/** Closest distance (m) from any point of an axis-aligned box to the plaza walks' centre lines (sampled every 5 cm). */
function boxDist(P: ReturnType<typeof plotPlaces>, x: number, z: number, hx: number, hz: number): number {
  let d = Infinity;
  for (let u = -hx; u <= hx + 1e-9; u += Math.max(0.05, hx / 8)) for (let v = -hz; v <= hz + 1e-9; v += Math.max(0.05, hz / 8)) d = Math.min(d, plazaDist(P, x + u, z + v));
  return d;
}

describe('plaza walks on the big greens', () => {
  it('only the big greens get one (eras V to X)', () => {
    for (let n = 2; n <= 4; n++) expect(greenPlaza(plotPlaces(n)), `era ${n}`).toBeNull();
    for (let n = 5; n <= 10; n++) expect(greenPlaza(plotPlaces(n)), `era ${n}`).not.toBeNull();
  });
  for (let n = 5; n <= 10; n++) {
    it(`era ${n}: no decor, bench or snowman spot stands on a walk`, () => {
      const P = plotPlaces(n);
      const keep = PLAZA_HALF + PLAZA_CLEAR - 0.15; // the planner's 0.25 m grid can round a corner in by a little
      const huts = plotDecor(n).filter((d) => d.zone === 'huts');
      expect(huts.length, 'the green still has decor').toBeGreaterThanOrEqual(4);
      for (const d of huts) expect(boxDist(P, d.x, d.z, d.hx, d.hz), `${d.kind} at ${d.x.toFixed(1)}, ${d.z.toFixed(1)}`).toBeGreaterThan(keep);
      // the green's own two benches either side of the centrepiece (buildGreen: 1.6 × 0.45 at c.x ± 3.2)
      const c = { x: (P.green.minX + P.green.maxX) / 2, z: (P.green.minZ + P.green.maxZ) / 2 };
      for (const s of [-1, 1]) expect(boxDist(P, c.x + s * 3.2, c.z, 0.8, 0.25), 'centre bench').toBeGreaterThan(keep);
      for (const a of greenActivities(n)) {
        const r = a.kind === 'snowman' ? 0.45 : 0.3;
        expect(plazaDist(P, a.x, a.z) - r, `${a.kind} at ${a.x.toFixed(1)}, ${a.z.toFixed(1)}`).toBeGreaterThan(PLAZA_HALF);
      }
      expect(greenActivities(n).some((a) => a.kind === 'snowman'), 'still a snowman spot').toBe(true);
    });
  }
});
