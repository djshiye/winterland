/**
 * City district decoration (city/decor.ts, pure): every era's street furniture stays inside its district, off the walkways,
 * the lots (footprint, pad tile, front lane), the street lamps and each other; there is plenty of it and it never changes.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ERA, districtDef, type ERect } from '../src/eras/data';
import { districtWalkways } from '../src/city/roadRoute';
import { districtLots } from '../src/city/rules';
import { DECOR_RADIUS, LAMP_CLEAR, districtDecor, districtLamps, type DecorItem } from '../src/city/decor';

const eras = Array.from({ length: MAX_ERA - 1 }, (_v, i) => i + 2);
const radius = (it: DecorItem): number => DECOR_RADIUS[it.kind] * it.scale;
/** True when circle (x, z, r) overlaps rect `w` (touching does not count). */
const hits = (w: ERect, it: DecorItem): boolean => Math.hypot(Math.max(w.minX - it.x, 0, it.x - w.maxX), Math.max(w.minZ - it.z, 0, it.z - w.maxZ)) < radius(it);

describe('districtDecor', () => {
  it.each(eras)('era %i: inside the district, clear of walkways, lots, lanes and lamps', (n) => {
    const r = districtDef(n).rect;
    const walks = districtWalkways(n);
    const lamps = districtLamps(n);
    for (const it of districtDecor(n)) {
      const rad = radius(it);
      expect(it.x - rad).toBeGreaterThanOrEqual(r.minX);
      expect(it.x + rad).toBeLessThanOrEqual(r.maxX);
      expect(it.z - rad).toBeGreaterThanOrEqual(r.minZ);
      expect(it.z + rad).toBeLessThanOrEqual(r.maxZ);
      for (const w of walks) expect(hits(w, it), `${it.kind} at ${it.x},${it.z} on a walkway`).toBe(false);
      for (const f of districtLots(n)) {
        expect(hits(f.rect, it), `${it.kind} in lot ${f.index}`).toBe(false);
        expect(hits(f.zone, it), `${it.kind} on pad ${f.index}`).toBe(false);
        expect(hits({ minX: f.cell.minX, maxX: f.cell.maxX, minZ: f.rect.maxZ, maxZ: f.cell.maxZ }, it), `${it.kind} in lane ${f.index}`).toBe(false);
      }
      for (const l of lamps) expect(Math.hypot(l.x - it.x, l.z - it.z)).toBeGreaterThanOrEqual(LAMP_CLEAR);
    }
  });

  it.each(eras)('era %i: items do not overlap each other', (n) => {
    const items = districtDecor(n);
    for (let a = 0; a < items.length; a++) {
      for (let b = a + 1; b < items.length; b++) {
        const d = Math.hypot(items[a]!.x - items[b]!.x, items[a]!.z - items[b]!.z);
        expect(d, `${items[a]!.kind} / ${items[b]!.kind}`).toBeGreaterThanOrEqual(radius(items[a]!) + radius(items[b]!));
      }
    }
  });

  it.each(eras)('era %i: plenty of items, several kinds, deterministic', (n) => {
    const items = districtDecor(n);
    expect(items.length).toBeGreaterThanOrEqual(20);
    expect(new Set(items.map((i) => i.kind)).size).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(districtDecor(n))).toBe(JSON.stringify(items));
  });
});
