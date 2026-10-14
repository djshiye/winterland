/**
 * Layout validation for the wave-7 machines: the truck-loader belt and the cash-tube posts must not sit on pads,
 * colliders, player zones, the other belts or the scripted NPC routes (npc/crewHelpers.ts).
 */
import { describe, expect, it } from 'vitest';
import { LAYOUT, PADS, inflate, rect, type Rect, type XZ } from '../src/config';
import { ROUTES, TOWER } from '../src/stations/CashTubes';
import { TRUCK_BELT_PATH } from '../src/stations/TruckLoader';

const P = LAYOUT;
const pads: Rect[] = Object.values(PADS).map((p) => rect(p.x, p.z, p.size, p.size));
const solids: Rect[] = [
  P.dropZone.collider,
  P.megaSaw.base,
  P.harvester.collider,
  P.cabin,
  rect(P.processor.x, P.processor.z, 1.6, 1.4),
  rect(P.expansion.truckCounter.x, P.expansion.truckCounter.z, 1.6, 0.6),
  rect(P.walkInCounter.x, P.walkInCounter.z, 1.6, 0.6),
  rect(P.seCounter.x, P.seCounter.z, 0.6, 1.6),
  rect(TOWER.x, TOWER.z, 1.2, 1.0),
];
const zones: Rect[] = [
  P.dropZone.zone,
  P.walkInCounter.playerZone,
  P.walkInCash.zone,
  P.seCounter.playerZone,
  P.seCash.zone,
  P.processor.inputZone,
  P.processor.outputZone,
  P.shop.mat,
  P.expansion.truckCounter.playerZone,
  P.expansion.truckCash.zone,
  P.ridge.deck.zone,
  P.ridge.platform.playerZone,
  P.ridge.platformCash.zone,
];
const routes: XZ[][] = [
  [{ x: 7, z: -5.9 }, { x: 7.4, z: -2 }, { x: 7.4, z: 0.85 }, { x: 5.95, z: 0.85 }],
  [{ x: 7, z: -5.9 }, { x: 4.8, z: -5.3 }, { x: -1.5, z: -4.6 }, { x: -3, z: 1.4 }],
  [{ x: -3, z: 1.4 }, { x: -1.5, z: -3 }, { x: 0.5, z: -9 }, { x: 1, z: -18.8 }],
  [{ x: 7, z: -5 }, { x: 2.5, z: -4.6 }, { x: -2, z: 7.5 }],
  [{ x: 7, z: -5 }, { x: 4.8, z: -5.3 }, { x: 3.4, z: -12 }, { x: 2.9, z: -17.3 }],
  [{ x: 7, z: -5 }, { x: 8.9, z: 4.8 }],
  [{ x: -3, z: 1.4 }, { x: -4, z: 8.6 }],
  [{ x: 5.95, z: 0.85 }, { x: 9, z: 3.4 }],
];
const belts: XZ[][] = [
  [{ x: -4.4, z: 1.05 }, { x: -4.4, z: 9.2 }],
  [{ x: -3.8, z: -0.4 }, { x: 2.5, z: -0.4 }],
];

function distSeg(p: XZ, a: XZ, b: XZ): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}
function distPoly(p: XZ, poly: readonly XZ[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length - 1; i++) d = Math.min(d, distSeg(p, poly[i]!, poly[i + 1]!));
  return d;
}
function polyDist(a: readonly XZ[], b: readonly XZ[]): number {
  // sample a
  let d = Infinity;
  for (let i = 0; i < a.length - 1; i++) {
    const n = 40;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      d = Math.min(d, distPoly({ x: a[i]!.x + (a[i + 1]!.x - a[i]!.x) * t, z: a[i]!.z + (a[i + 1]!.z - a[i]!.z) * t }, b));
    }
  }
  return d;
}
const inRect = (r: Rect, p: XZ): boolean => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
function polyHitsRect(poly: readonly XZ[], r: Rect): boolean {
  for (let i = 0; i < poly.length - 1; i++) {
    for (let k = 0; k <= 80; k++) {
      const t = k / 80;
      if (inRect(r, { x: poly[i]!.x + (poly[i + 1]!.x - poly[i]!.x) * t, z: poly[i]!.z + (poly[i + 1]!.z - poly[i]!.z) * t })) return true;
    }
  }
  return false;
}

describe('truck loader belt', () => {
  const belt = TRUCK_BELT_PATH;
  const half = 0.4 + 0.2;
  it('stays off pads, colliders and player zones', () => {
    const tcRect = rect(P.expansion.truckCounter.x, P.expansion.truckCounter.z, 1.6, 0.6);
    for (const r of [...pads, ...solids, ...zones]) {
      // the belt starts at the drop zone and ends beside the truck counter by design: only its footprint must stay clear of it
      const m = r === solids[5] || r === P.dropZone.zone || r === P.expansion.truckCounter.playerZone ? 0.05 : half;
      expect(polyHitsRect(belt, inflate(r, m)), JSON.stringify(r)).toBe(false);
    }
    expect(solids[5]).toEqual(tcRect);
  });
  it('is walkable-clear of the NPC routes and the other belts', () => {
    for (const r of routes) expect(polyDist(belt, r)).toBeGreaterThan(1.0);
    for (const b of belts) expect(polyDist(belt, b)).toBeGreaterThan(0.8);
  });
  it('lies inside the expanded yard and ends beside the truck counter', () => {
    for (const p of belt) {
      expect(p.x).toBeGreaterThan(P.yard.minX + 0.6);
      expect(p.z).toBeGreaterThan(P.expandedMinZ + 0.6);
    }
    const end = belt[belt.length - 1]!;
    const tc = P.expansion.truckCounter;
    expect(Math.hypot(end.x - (tc.x - 0.8), end.z - tc.z)).toBeLessThan(1.1);
  });
});

describe('cash tube posts', () => {
  for (const [id, def] of Object.entries(ROUTES)) {
    it(`${id}: posts clear of pads, colliders, other belts and NPC routes; spans <= 9 m`, () => {
      for (const p of def.posts) {
        for (const r of pads) expect(inRect(inflate(r, 0.3), p), `${JSON.stringify(p)} pad`).toBe(false);
        for (const r of solids) expect(inRect(inflate(r, 0.3), p), `${JSON.stringify(p)} solid`).toBe(false);
        for (const r of routes) expect(distPoly(p, r), `${JSON.stringify(p)} route`).toBeGreaterThan(0.8);
        for (const b of belts) expect(distPoly(p, b), `${JSON.stringify(p)} belt`).toBeGreaterThan(0.7);
        expect(distPoly(p, TRUCK_BELT_PATH), `${JSON.stringify(p)} loader`).toBeGreaterThan(0.7);
      }
    });
    it(`${id}: posts stay out of the walking zones (pile-side posts may touch their own zone edge)`, () => {
      for (const p of def.posts) {
        for (const z of zones) {
          const inside = inRect(inflate(z, -0.12), p);
          expect(inside, `${JSON.stringify(p)} in zone ${JSON.stringify(z)}`).toBe(false);
        }
      }
    });
  }
});

describe('cash tower', () => {
  const tower = rect(TOWER.x, TOWER.z, 1.2, 1.0);
  it('stands clear of pads, other colliders, player zones and NPC routes', () => {
    for (const r of pads) expect(inRect(inflate(r, 0.1), { x: TOWER.x, z: TOWER.z }) || polyHitsRect([{ x: tower.minX, z: tower.minZ }, { x: tower.maxX, z: tower.minZ }, { x: tower.maxX, z: tower.maxZ }, { x: tower.minX, z: tower.maxZ }, { x: tower.minX, z: tower.minZ }], inflate(r, 0.1))).toBe(false);
    for (const r of [...solids.slice(0, 5), ...zones]) {
      const ring = [{ x: tower.minX, z: tower.minZ }, { x: tower.maxX, z: tower.minZ }, { x: tower.maxX, z: tower.maxZ }, { x: tower.minX, z: tower.maxZ }, { x: tower.minX, z: tower.minZ }];
      expect(polyHitsRect(ring, r), JSON.stringify(r)).toBe(false);
    }
    for (const r of routes) expect(distPoly(TOWER, r)).toBeGreaterThan(1.3);
  });
});
