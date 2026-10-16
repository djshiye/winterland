/**
 * 0.9.5 era plots: every era 2..10 region is era-1 sized, bigger than the era before, and split into era-1-style
 * zones (yard, processing, harvest, market, huts) that tile it exactly. Everything the layout places sits in its zone,
 * and both gates (the main gate and the market gate) open onto the region's road.
 */
import { describe, expect, it } from 'vitest';
import type { Rect } from '../src/config';
import { REGIONS, ROADS } from '../src/eras/data';
import { MIN_WEST, regionLayout, YARD_DEPTH, type RegionZones } from '../src/eras/layout';
import { DEPOT_FRAME, DOCK_FRAME, worldRect } from '../src/eras/rules';
import { gateWalk, marketGateWalk, regionPaths, regionWalk } from '../src/world/env/frontier';

const EPS = 1e-6;
const area = (r: Rect): number => (r.maxX - r.minX) * (r.maxZ - r.minZ);
const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;
const inside = (a: Rect, outer: Rect): boolean => a.minX >= outer.minX - EPS && a.maxX <= outer.maxX + EPS && a.minZ >= outer.minZ - EPS && a.maxZ <= outer.maxZ + EPS;
const contains = (r: Rect, x: number, z: number): boolean => x >= r.minX - EPS && x <= r.maxX + EPS && z >= r.minZ - EPS && z <= r.maxZ + EPS;
const box = (x: number, z: number, half: number): Rect => ({ minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half });
const ERA_NS = REGIONS.filter((r) => r !== null).map((r) => r!.n);
const ZONE_KEYS: (keyof RegionZones)[] = ['yard', 'processing', 'harvest', 'market', 'huts'];

describe('0.9.5 era plot sizes', () => {
  it('makes every plot at least three times the 0.9.3 size and each era bigger than the one before', () => {
    let last = 0;
    for (const n of ERA_NS) {
      const a = area(REGIONS[n]!.rect);
      expect(a, `era ${n}`).toBeGreaterThanOrEqual(3 * 720);
      expect(a, `era ${n}`).toBeGreaterThan(last);
      last = a;
    }
  });

  it('keeps the whole new land on the 640 m ground plane', () => {
    for (const r of [...REGIONS.filter((q) => q).map((q) => q!.rect), ...ROADS.map((q) => q.rect)]) {
      expect(Math.max(Math.abs(r.minX), Math.abs(r.maxX), Math.abs(r.minZ), Math.abs(r.maxZ))).toBeLessThan(310);
    }
  });
});

describe('0.9.5 region zones', () => {
  for (const n of ERA_NS) {
    const L = regionLayout(n);
    const Z = L.zones;

    it(`era ${n}: the five zones tile the plot exactly, none overlapping`, () => {
      let sum = 0;
      for (const k of ZONE_KEYS) {
        expect(inside(Z[k], L.rect), k).toBe(true);
        expect(area(Z[k]), k).toBeGreaterThan(0);
        sum += area(Z[k]);
      }
      expect(sum).toBeCloseTo(area(L.rect), 6);
      for (let i = 0; i < ZONE_KEYS.length; i++) for (let j = i + 1; j < ZONE_KEYS.length; j++) expect(overlap(Z[ZONE_KEYS[i]!], Z[ZONE_KEYS[j]!]), `${ZONE_KEYS[i]} vs ${ZONE_KEYS[j]}`).toBe(false);
    });

    it(`era ${n}: every zone has room (yard ${YARD_DEPTH} m deep and ≥ ${MIN_WEST} m wide, harvest and huts ≥ 10 m, market ≥ 12 × 12 m)`, () => {
      expect(Z.yard.maxZ - Z.yard.minZ).toBeCloseTo(YARD_DEPTH);
      expect(Z.yard.maxX - Z.yard.minX).toBeGreaterThanOrEqual(MIN_WEST);
      expect(Z.harvest.maxZ - Z.harvest.minZ).toBeGreaterThanOrEqual(10);
      expect(Z.huts.maxZ - Z.huts.minZ).toBeGreaterThanOrEqual(10);
      expect(Z.market.maxX - Z.market.minX).toBeGreaterThanOrEqual(12);
      expect(Z.market.maxZ - Z.market.minZ).toBeGreaterThanOrEqual(12);
    });

    it(`era ${n}: machine slots sit whole cells inside the processing zone, apart from each other`, () => {
      expect(L.slots).toHaveLength(REGIONS[n]!.slots);
      L.slots.forEach((s, i) => {
        expect(inside(box(s.x, s.z, L.cell / 2), Z.processing), `slot ${i}`).toBe(true);
        L.slots.forEach((o, j) => {
          if (j > i) expect(overlap(box(s.x, s.z, L.cell / 2), box(o.x, o.z, L.cell / 2)), `slot ${i} vs ${j}`).toBe(false);
        });
      });
    });

    it(`era ${n}: the paths between the zones stay inside the plot and off the machine slots`, () => {
      for (const q of regionPaths(L)) {
        expect(inside(q, L.rect)).toBe(true);
        for (const sl of L.slots) expect(overlap(q, box(sl.x, sl.z, L.cell / 2 - 0.5))).toBe(false);
      }
    });

    it(`era ${n}: the yard holds the depot, dock, Jack and shop mat clear of each other and of the gate`, () => {
      const yaw = L.facilityYaw;
      const parts: [string, Rect][] = [
        ['depot', worldRect(L.depot, yaw, DEPOT_FRAME.body)],
        ['dock', worldRect(L.dock, yaw, DOCK_FRAME.body)],
        ['jack', box(L.jack.x, L.jack.z, 1.5)],
        ['shop', box(L.shopMat.x, L.shopMat.z, 1.2)],
        ['gate', { minX: L.gate.x - 2, maxX: L.gate.x + 2, minZ: Z.yard.minZ, maxZ: Z.yard.maxZ }],
      ];
      for (const [k, r] of parts) expect(inside(r, Z.yard), k).toBe(true);
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) expect(overlap(parts[i]![1], parts[j]![1]), `${parts[i]![0]} vs ${parts[j]![0]}`).toBe(false);
    });

    it(`era ${n}: both gates open onto the region's road; vehicles stop on it, walkers enter the market`, () => {
      const road = ROADS.find((r) => r.id === L.road);
      expect(road, 'road').toBeDefined();
      const rr = road!.rect;
      for (const [k, w] of [['gate', gateWalk(L)], ['market gate', marketGateWalk(L)]] as const) {
        expect(overlap(w, rr), `${k} on the road`).toBe(true);
        expect(overlap(w, regionWalk(L)), `${k} into the plot`).toBe(true);
      }
      expect(L.gate.x - L.gate.width / 2).toBeGreaterThanOrEqual(Z.yard.minX);
      expect(L.gate.x + L.gate.width / 2).toBeLessThanOrEqual(Z.yard.maxX);
      expect(L.marketGate.x - L.marketGate.width / 2).toBeGreaterThanOrEqual(Z.market.minX);
      expect(L.marketGate.x + L.marketGate.width / 2).toBeLessThanOrEqual(Z.market.maxX);
      expect(contains(rr, L.vehicleStop.x, L.vehicleStop.z), 'vehicle stop on the road').toBe(true);
      expect(contains(Z.market, L.customerEntry.x, L.customerEntry.z), 'customer entry in the market').toBe(true);
      // the expansion pad on the road stays clear of the market's vehicle stop
      expect(Math.abs(L.expansionPad.x - L.vehicleStop.x)).toBeGreaterThan(4);
    });
  }
});
