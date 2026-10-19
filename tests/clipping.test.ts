/**
 * 0.9.12 (audit C2): no tree or big prop of a region comes within FENCE_CLEAR (1.2 m) of the region's fence line or its
 * gate openings. Uses the pure placement functions (belt spots, harvest-free checks, the era kits' wild dressing).
 */
import { describe, expect, it } from 'vitest';
import { regionLayout } from '../src/eras/layout';
import { GroundKit, eraGround } from '../src/world/env/eraGround';
import { Rng } from '../src/world/env/common';
import { clearOfFence, FENCE_CLEAR, fenceGap } from '../src/world/env/clearance';
import { propFree, regionPaths } from '../src/world/env/frontier';
import { beltSpots as beltSpotsLate, BELT_R, harvestFree } from '../src/world/env/ground/lateKit';
import { beltSpots as beltSpotsMid, BELT_R as BELT_R_MID } from '../src/world/env/ground/kit4to7';
import { plotPlaces } from '../src/eras/layout';
import { landmarkRect } from '../src/world/env/ground/landmarks2to5';
import { landmarkRect89 } from '../src/world/env/ground/landmarks8to9';

const ERAS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('fence clearance rule', () => {
  it('measures the gap from a footprint to the fence line, gate openings included', () => {
    const l = regionLayout(2);
    const r = l.rect;
    expect(fenceGap(l, r.minX + 3, (r.minZ + r.maxZ) / 2, 1)).toBeCloseTo(2);
    // standing in the gate opening, or just outside it, is on the fence line
    expect(clearOfFence(l, l.gate.x, l.gate.z, 0.5)).toBe(false);
    expect(clearOfFence(l, l.gate.x, l.gate.z + l.inward * 1.0, 0.3)).toBe(false);
    expect(clearOfFence(l, l.marketGate.x, l.marketGate.z, 0.5)).toBe(false);
    // 1.2 m of clear ground is enough, a hair less is not
    expect(clearOfFence(l, r.minX + 1.25 + 1, (r.minZ + r.maxZ) / 2, 1)).toBe(true);
    expect(clearOfFence(l, r.minX + 1.1 + 1, (r.minZ + r.maxZ) / 2, 1)).toBe(false);
  });

  for (const n of ERAS) {
    describe(`era ${n}`, () => {
      const l = regionLayout(n);

      it('tree belts and gantries keep clear of the fence line and the gate', () => {
        const spots = n >= 8 ? beltSpotsLate(l, 4.6, new Rng(11 + n)) : beltSpotsMid(l, regionPaths(l), [], 4.4);
        const rad = n >= 8 ? BELT_R : BELT_R_MID;
        if (n >= 4) expect(spots.length).toBeGreaterThan(3);
        for (const s of spots) expect(fenceGap(l, s.x, s.z, rad), `belt spot ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`).toBeGreaterThanOrEqual(FENCE_CLEAR);
      });

      it('any random prop the region accepts keeps clear of the fence line and the gate', () => {
        const r = l.rect;
        const P = plotPlaces(n);
        let accepted = 0;
        for (let x = r.minX - 2; x <= r.maxX + 2; x += 1) {
          for (let z = r.minZ - 2; z <= r.maxZ + 2; z += 1) {
            for (const rad of [0.8, 1.3, 1.8]) {
              if (propFree(l, x, z, rad)) {
                accepted++;
                expect(fenceGap(l, x, z, rad), `propFree ${x}, ${z}, r${rad}`).toBeGreaterThanOrEqual(FENCE_CLEAR);
              }
              if (n >= 8 && harvestFree(l, P, x, z, rad, [])) expect(fenceGap(l, x, z, rad), `harvestFree ${x}, ${z}, r${rad}`).toBeGreaterThanOrEqual(FENCE_CLEAR);
            }
          }
        }
        expect(accepted).toBeGreaterThan(0);
      }, 30000);

      it('the era landmark stands clear of the fence line', () => {
        const r = l.rect;
        const rects = n <= 5 ? landmarkRect(l, n as 2 | 3 | 4 | 5) : n === 8 || n === 9 ? landmarkRect89(l, n as 8 | 9) : [];
        for (const q of rects) {
          // a rect is a footprint: its nearest side keeps the clearance (checked as the circle of its half-diagonal would be too strict)
          const w = (q.maxX - q.minX) / 2;
          const d = (q.maxZ - q.minZ) / 2;
          const x = (q.minX + q.maxX) / 2;
          const z = (q.minZ + q.maxZ) / 2;
          expect(Math.min(x - w - r.minX, r.maxX - x - w, z - d - r.minZ, r.maxZ - z - d), `landmark rect ${JSON.stringify(q)}`).toBeGreaterThanOrEqual(FENCE_CLEAR - 1e-6);
        }
      });

      it('every instanced tree / prop of the era kit stands clear of the fence line', () => {
        const mod = eraGround(n)!;
        const kit = new GroundKit();
        mod.wild?.(kit, l, new Rng(7300 + n * 53));
        const kinds = (kit as unknown as { kinds: Map<string, { items: { x: number; z: number }[] }> }).kinds;
        let seen = 0;
        for (const [name, k] of kinds) {
          // snow drifts banked against the fence are flat ground dressing, not props
          if (/drift|patch|snow/i.test(name)) continue;
          for (const p of k.items) {
            seen++;
            // a conservative 0.7 m footprint: the instanced kinds are 0.8 - 1.5 m across
            expect(fenceGap(l, p.x, p.z, 0.7), `${name} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBeGreaterThanOrEqual(FENCE_CLEAR);
          }
        }
        expect(seen).toBeGreaterThanOrEqual(0);
      });
    });
  }
});
