/**
 * 0.9.6 (CODE_AUDIT P1-3, eras1-4 finding 7): every level for sale does something, and an era upgrade's Lv 10 is its
 * biggest step. 0.9.5 left the era Pal's Lv 10 and the Sled Dog's Lv 5, 7 and 9 dead (paid levels with no effect) and
 * filled most era upgrades' Lv 10 from the generic climb curve (Rigs ×3.0 → ×3.1).
 */
import { describe, expect, it } from 'vitest';
import { CLIMB, UPGRADES, type UpgradeDef } from '../src/config';
import { authoredMax, introEra, valueAt } from '../src/core/ladder';

const DEFS = Object.values(UPGRADES) as UpgradeDef[];
const TOP = CLIMB.bandSize;
/** The gain of the step to stored level s + 1, in the effect's direction (rates: swings per second). */
const gain = (d: UpgradeDef, s: number): number => (d.display === 'rate' ? 1 / valueAt(d, s + 1) - 1 / valueAt(d, s) : valueAt(d, s + 1) - valueAt(d, s));

describe('no dead levels', () => {
  for (const d of DEFS) {
    it(`${d.id}: every level 1..${TOP} changes the effect`, () => {
      for (let s = 0; s < TOP; s++) expect(gain(d, s), `${d.id} Lv ${s} → ${s + 1}`).toBeGreaterThan(1e-9);
    });
  }
});

describe('era upgrades: Lv 10 is authored and the biggest step', () => {
  const ERA = DEFS.filter((d) => introEra(d) >= 2);
  it('covers every era id (taxOffice and broker included)', () => {
    expect(ERA.length).toBeGreaterThan(200);
    expect(ERA.map((d) => d.id)).toContain('taxOffice');
    expect(ERA.map((d) => d.id)).toContain('frontierPal');
  });
  for (const d of ERA) {
    it(`${d.id}: eleven values, the last step at least as big as any after Lv 1`, () => {
      expect(d.values).toHaveLength(TOP + 1);
      expect(authoredMax(d)).toBe(TOP);
      const last = gain(d, TOP - 1);
      // Lv 0 → 1 builds, hires or adopts (Belts, crews, the pal, the cash machine): not a "step" to compare with
      for (let s = 1; s < TOP - 1; s++) expect(last, `${d.id}: Lv 10 vs Lv ${s + 1}`).toBeGreaterThanOrEqual(gain(d, s) - 1e-9);
    });
  }
});
