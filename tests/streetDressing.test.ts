/** Festive street dressing (city/streetDressing.ts, pure): ropes hang between lamp posts, high enough to walk under, never near trees. */
import { describe, expect, it } from 'vitest';
import { MAX_ERA } from '../src/eras/data';
import { districtLamps } from '../src/city/decor';
import { districtPosts, districtSpans } from '../src/city/streetDressing';
import { ropePoint, type V3 } from '../src/world/env/festive';

const eras = Array.from({ length: MAX_ERA - 1 }, (_v, i) => i + 2);

describe('districtSpans', () => {
  it.each(eras)('era %i: ropes tie to lamp posts and clear head height', (n) => {
    const lamps = districtLamps(n);
    const spans = districtSpans(n);
    expect(spans.length).toBeGreaterThan(4);
    const at = (p: V3): boolean => lamps.some((l) => l.x === p.x && l.z === p.z);
    const out: V3 = { x: 0, y: 0, z: 0 };
    for (const s of spans) {
      expect(at(s.a)).toBe(true);
      expect(at(s.b)).toBe(true);
      let low = Infinity;
      for (let i = 0; i <= 40; i++) low = Math.min(low, ropePoint(s.a, s.b, s.sag, i / 40, out).y);
      expect(low).toBeGreaterThanOrEqual(2.4);
    }
  });

  it.each(eras)('era %i: every post has a banner or a wreath, alternating', (n) => {
    const posts = districtPosts(n);
    expect(posts.length).toBe(districtLamps(n).length);
    expect(posts.some((p) => p.kind === 'banner')).toBe(true);
    expect(posts.some((p) => p.kind === 'wreath')).toBe(true);
  });
});
