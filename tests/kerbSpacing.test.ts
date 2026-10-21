/** Shoppers waiting at the kerb by the market gate spread out along it instead of stacking on one spot. */
import { describe, expect, it } from 'vitest';
import { KERB_SPACING, kerbShift } from '../src/npc/EraShoppers';

const X = { x: 1, z: 0 };

describe('kerb wait spacing', () => {
  it('leaves a shopper alone when nobody is within the spacing', () => {
    expect(kerbShift({ x: 0, z: 0 }, [{ x: KERB_SPACING + 0.01, z: 0 }], X, KERB_SPACING, 1)).toBe(0);
    expect(kerbShift({ x: 0, z: 0 }, [], X, KERB_SPACING, 1)).toBe(0);
  });
  it('moves away along the kerb, never across it', () => {
    const s = kerbShift({ x: 0, z: 5 }, [{ x: -0.3, z: 5 }], X, KERB_SPACING, 1);
    expect(s).toBeGreaterThan(0);
    expect(0 + s - -0.3).toBeCloseTo(KERB_SPACING, 6);
    expect(kerbShift({ x: 0, z: 5 }, [{ x: 0.3, z: 5 }], X, KERB_SPACING, 1)).toBeLessThan(0);
  });
  it('parts two shoppers on exactly the same spot (by tie side)', () => {
    expect(kerbShift({ x: 2, z: 2 }, [{ x: 2, z: 2 }], X, KERB_SPACING, 1)).toBeCloseTo(KERB_SPACING, 6);
    expect(kerbShift({ x: 2, z: 2 }, [{ x: 2, z: 2 }], X, KERB_SPACING, -1)).toBeCloseTo(-KERB_SPACING, 6);
  });
  it('a bunch of waiters settles at least 0.3 m (the soak stack distance) apart, in a few rounds', () => {
    const w = Array.from({ length: 5 }, (_, i) => ({ x: 10 + (i % 2) * 0.05, z: 3 }));
    for (let r = 0; r < 200; r++) w.forEach((p, i) => { p.x += kerbShift(p, w.filter((_, j) => j !== i), X, KERB_SPACING, i % 2 ? 1 : -1) * 0.3; });
    for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) expect(Math.hypot(w[i]!.x - w[j]!.x, w[i]!.z - w[j]!.z)).toBeGreaterThan(0.3);
  });
});
