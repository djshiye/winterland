/**
 * 0.9.12: the era buyers' routes (eras/traffic.ts). Dino: "the customers driving and disappearing randomly in the
 * middle of the road". Every route must stay on open roads, turn smoothly, park its queue in the stop lane clear of the
 * fence (review C1), and be long enough either side of the market to come and go out of sight.
 */
import { describe, expect, it } from 'vitest';
import { TRADE_POST } from '../src/config';
import { MAX_ERA, REGIONS, ROADS } from '../src/eras/data';
import { regionLayout } from '../src/eras/layout';
import { marketPlaces } from '../src/eras/market';
import { GATE_CLEAR, VEHICLE_NOSE, VEHICLE_TAIL, buyerRoute, headingAt, pointAt, queueSlots, roadOpenAt } from '../src/eras/traffic';
import { TRUCK_BED_X } from '../src/assets/vehicles';

/** Along-road distance past which a point is off screen at every zoom on a 16:9 screen (CAMERA: 25 m tall view). */
const OFF_SCREEN = 32;

const routeOf = (n: number, age = n) => {
  const L = regionLayout(n);
  const P = marketPlaces(L);
  return { L, P, r: buyerRoute(L.road, queueSlots(P.dock.x - TRUCK_BED_X, TRADE_POST.maxQueue, TRADE_POST.spacing, P.door.x), (id) => roadOpenAt(age, id)) };
};

describe('era buyer routes', () => {
  for (let n = 2; n <= MAX_ERA; n++) {
    if (!REGIONS[n]) continue;
    for (const age of [n, MAX_ERA]) {
      it(`era ${n} (world at era ${age}): on open roads only, smooth turns, queue in the stop lane`, () => {
        const { L, P, r } = routeOf(n, age);
        const open = ROADS.filter((q) => roadOpenAt(age, q.id));
        for (const p of r.pts) {
          const on = open.some((q) => p.x >= q.rect.minX - 0.01 && p.x <= q.rect.maxX + 0.01 && p.z >= q.rect.minZ - 0.01 && p.z <= q.rect.maxZ + 0.01);
          expect(on, `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}) off the open roads`).toBe(true);
        }
        // the nose never snaps round: at most 20° between headings 0.5 m apart
        let prev = headingAt(r, 0);
        for (let s = 0.5; s <= r.length; s += 0.5) {
          const h = headingAt(r, s);
          const cos = h.x * prev.x + h.z * prev.z;
          expect(cos, `heading snaps at s ${s}`).toBeGreaterThan(Math.cos((20 * Math.PI) / 180));
          prev = h;
        }
        // every queue slot sits in the stop lane, bed at the counter, the vehicle 1.3 m+ clear of the fence (C1)
        const road = ROADS.find((q) => q.id === L.road)!.rect;
        expect(r.slots.length).toBe(TRADE_POST.maxQueue);
        for (let i = 0; i < TRADE_POST.maxQueue; i++) {
          const s = r.slots[i]!;
          expect(s).toBeGreaterThan(r.sMerge);
          const p = pointAt(r, s);
          expect(p.z).toBeCloseTo(r.stopZ, 5);
          expect(road.maxZ - (p.z + 1.1)).toBeGreaterThanOrEqual(1.3);
          // 0.9.13: a queue's spacing apart (or more), and never parked across the market gate (the shoppers' walk)
          if (i > 0) expect(r.slots[i - 1]! - s).toBeGreaterThanOrEqual(TRADE_POST.spacing - 1e-6);
          expect(p.x - VEHICLE_NOSE >= P.door.x + GATE_CLEAR || p.x + VEHICLE_TAIL <= P.door.x - GATE_CLEAR, `slot ${i} at x ${p.x.toFixed(1)} across the gate at ${P.door.x}`).toBe(true);
        }
        expect(pointAt(r, r.sFront).x).toBeCloseTo(P.dock.x - TRUCK_BED_X, 1);
        // room to appear and vanish out of sight on a desktop screen
        expect(r.sFront).toBeGreaterThan(OFF_SCREEN);
        expect(r.length - r.sOut).toBeGreaterThan(OFF_SCREEN);
      });
    }
  }

  it('through traffic keeps to the drive lane, 2 m from the parked queue', () => {
    for (let n = 2; n <= MAX_ERA; n++) {
      if (!REGIONS[n]) continue;
      const { r } = routeOf(n, MAX_ERA);
      expect(r.driveZ - r.stopZ).toBeCloseTo(2, 5);
    }
  });
});
