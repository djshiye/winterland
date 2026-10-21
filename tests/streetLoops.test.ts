/**
 * 0.9.13 (review idea 4): the city's street-vehicle loops stay in the lane on their block's side of the streets,
 * never touch a district, the era regions or road R2, never meet each other, drive on the right and close up.
 */
import { describe, expect, it } from 'vitest';
import { DISTRICTS, REGIONS, ROADS, type ERect } from '../src/eras/data';
import { roadOpenAt } from '../src/eras/traffic';
import { loopHeading, loopPoint, streetLoops } from '../src/city/streetLoops';

const HALF = 0.85;
const CITY = ['cityWest', 'cityV1', 'cityV2', 'cityH1', 'cityH2'];
const rect = (id: string): ERect => ROADS.find((r) => r.id === id)!.rect;
const inRect = (r: ERect, x: number, z: number): boolean => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const inRoads = (x: number, z: number): boolean => CITY.some((id) => inRect(rect(id), x, z));
const pt = { x: 0, z: 0 };
const hd = { x: 0, z: 0 };

describe('street loops', () => {
  const loops = streetLoops(10);

  it('has both blocks at age 10, closed loops of positive length', () => {
    expect(loops.map((l) => l.id)).toEqual(['block5', 'block6']);
    for (const l of loops) {
      expect(l.length).toBeGreaterThan(100);
      expect(l.x[0]).toBeCloseTo(l.x[l.x.length - 1]!, 9);
      expect(l.z[0]).toBeCloseTo(l.z[l.z.length - 1]!, 9);
    }
  });

  it('keeps a vehicle box inside the open city streets, off every district, region and R2', () => {
    for (const l of loops) {
      for (let s = 0; s < l.length; s += 0.25) {
        loopPoint(l, s, pt);
        loopHeading(l, s, hd);
        // centre and the two sides of the vehicle (±HALF across its heading)
        for (const k of [-1, 0, 1]) {
          const x = pt.x - hd.z * HALF * k;
          const z = pt.z + hd.x * HALF * k;
          expect(inRoads(x, z), `${l.id} s=${s} (${x}, ${z}) off the streets`).toBe(true);
          expect(z, `${l.id} on R2`).toBeLessThan(128);
          for (const d of DISTRICTS) if (d) expect(inRect(d.rect, x, z), `${l.id} s=${s} inside district ${d.n}`).toBe(false);
          for (const r of REGIONS) if (r) expect(inRect(r.rect, x, z), `${l.id} s=${s} inside region ${r.n}`).toBe(false);
        }
      }
    }
  });

  it('never brings the two loops closer than 1.6 m', () => {
    const [a, b] = loops;
    let min = Infinity;
    const q = { x: 0, z: 0 };
    for (let s = 0; s < a!.length; s += 0.25) {
      loopPoint(a!, s, pt);
      for (let t = 0; t < b!.length; t += 0.25) {
        loopPoint(b!, t, q);
        min = Math.min(min, Math.hypot(pt.x - q.x, pt.z - q.z));
      }
    }
    expect(min).toBeGreaterThanOrEqual(1.6);
  });

  it('opens each loop with its four streets', () => {
    for (let age = 0; age <= 10; age++) {
      const want = [
        ['cityWest', 'cityV1', 'cityH1', 'cityH2'],
        ['cityV1', 'cityV2', 'cityH1', 'cityH2'],
      ].flatMap((ids, i) => (ids.every((id) => roadOpenAt(age, id)) ? [`block${i + 5}`] : []));
      expect(streetLoops(age).map((l) => l.id)).toEqual(want);
    }
    expect(streetLoops(4)).toHaveLength(0);
    expect(streetLoops(5).map((l) => l.id)).toEqual(['block5']);
    expect(streetLoops(6)).toHaveLength(2);
  });

  it('drives on the right: the block is on the driver\'s right, and clockwise from above', () => {
    for (const [i, l] of loops.entries()) {
      const r = DISTRICTS[i === 0 ? 5 : 6]!.rect;
      // north edge midpoint: heads +x (east), the block lies south (+z) = to the right of +x seen from above
      let found = false;
      for (let t = 0; t < l.length; t += 0.5) {
        loopPoint(l, t, pt);
        if (Math.abs(pt.z - (r.minZ - 1)) < 1e-6 && pt.x > r.minX && pt.x < r.maxX) {
          loopHeading(l, t, hd);
          expect(hd.x).toBeCloseTo(1, 6);
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
      // everywhere on a straight edge the block centre is on the right: right of (hx, hz) is (−hz, hx) in x-east, z-south
      const cx = (r.minX + r.maxX) / 2;
      const cz = (r.minZ + r.maxZ) / 2;
      for (let t = 0; t < l.length; t += 1) {
        loopPoint(l, t, pt);
        loopHeading(l, t, hd);
        expect((cx - pt.x) * -hd.z + (cz - pt.z) * hd.x).toBeGreaterThan(0);
      }
    }
  });

  it('wraps: loopPoint at s and s + length coincide', () => {
    const q = { x: 0, z: 0 };
    for (const l of loops) {
      for (const s of [0, 3.3, 50, l.length - 0.1]) {
        loopPoint(l, s, pt);
        loopPoint(l, s + l.length, q);
        expect(q.x).toBeCloseTo(pt.x, 6);
        expect(q.z).toBeCloseTo(pt.z, 6);
        loopPoint(l, s - l.length, q);
        expect(q.x).toBeCloseTo(pt.x, 6);
      }
    }
  });
});
