/**
 * Layout validation for the wave-7 machines: the truck-loader belt and the cash-tube posts must not sit on pads,
 * colliders, player zones, the other belts or the scripted NPC routes (npc/crewHelpers.ts).
 */
import { describe, expect, it } from 'vitest';
import { LAYOUT, PADS, inflate, rect, type Rect, type XZ } from '../src/config';
import { HOME, HOME_ROUTE } from '../src/npc/crewHelpers';
import { ROUTES, TOWER } from '../src/stations/CashTubes';
import { TRUCK_BELT_PATH } from '../src/stations/TruckLoader';
import { SLED_RETURN_Z } from '../src/assets/sled';
import { WORKSHOP_BENCH_BOX, WORKSHOP_HOPPER_BOX } from '../src/stations/Workshop';
import { TOWER_HEIGHT } from '../src/assets/ridgeMachines';

const P = LAYOUT;
const Q = P.ridge.quarters;
const WS = P.ridge.workshop;
const SC = P.ridge.sledCounter;
const PLAT = P.ridge.platform;
const workshopBody = rect(WS.x, WS.z, WS.w, WS.d);
const hopperBox = rect(WS.hopper.x, WS.hopper.z, WORKSHOP_HOPPER_BOX.w, WORKSHOP_HOPPER_BOX.d);
const benchBox = rect(WS.bench.x, WS.bench.z, WORKSHOP_BENCH_BOX.w, WORKSHOP_BENCH_BOX.d);
const sledCounterBox = rect(SC.x, SC.z, SC.length, SC.depth);
/** Every pad tile, plus the bunkhouse construction pad (it is not in PADS). */
const pads: Rect[] = [...Object.values(PADS).map((p) => rect(p.x, p.z, p.size, p.size)), rect(Q.pad.x, Q.pad.z, Q.padSize, Q.padSize)];
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
  // wave 8 (appended: indices above are used by name in the tests below)
  workshopBody,
  hopperBox,
  benchBox,
  rect(Q.x, Q.z, Q.w, Q.d),
  sledCounterBox,
  rect(PLAT.x, PLAT.z, PLAT.depth, PLAT.length),
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
  WS.hopper.zone,
  WS.bench.zone,
  P.ridge.sledCounter.playerZone,
  P.ridge.sledCash.zone,
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
/**
 * Ridge walking routes (npc/crewHelpers.ts): the pine hauler's trip from the cabin to its rest spot, and the deck ->
 * platform leg, and the cashier's ridge trip. DECK_TO_PLATFORM / PAD_BYPASS are not exported: this is a copy of their
 * points (PINE_JUNCTION, PAD_BYPASS, PLATFORM_POST), keep it in step with crewHelpers.
 */
const ridgeRoutes: XZ[][] = [
  HOME_ROUTE.pineHauler,
  [{ x: 21.4, z: -1.2 }, { x: 27.0, z: -1.2 }, { x: PLAT.playerZone.minX + 0.4, z: PLAT.z }],
  [{ x: 21.4, z: -1.2 }, { x: 27.0, z: -1.2 }],
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

// ---------------------------------------------------------------------------
// Wave 8: furniture workshop
// ---------------------------------------------------------------------------

const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const wsZones = [WS.hopper.zone, WS.bench.zone];
const wsSolids = [workshopBody, hopperBox, benchBox];
const workshopPad = PADS.workshop;
const workshopPadRect = rect(workshopPad.x, workshopPad.z, workshopPad.size, workshopPad.size);
/** The other solids / zones / pads (everything that is not part of the workshop itself). */
const sameRect = (a: Rect, b: Rect): boolean => a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;
const others = (list: readonly Rect[], own: readonly Rect[]): Rect[] => list.filter((r) => !own.some((o) => sameRect(o, r)));

describe('furniture workshop footprint', () => {
  it('stands on the open ridge (inside the walkable rect) with its hopper and bench', () => {
    const walk = P.ridge.walk[1]!;
    for (const r of [workshopBody, hopperBox, benchBox, ...wsZones]) {
      expect(r.minX, JSON.stringify(r)).toBeGreaterThan(walk.minX);
      expect(r.maxX, JSON.stringify(r)).toBeLessThan(walk.maxX);
      expect(r.minZ, JSON.stringify(r)).toBeGreaterThan(walk.minZ);
      expect(r.maxZ, JSON.stringify(r)).toBeLessThan(walk.maxZ);
    }
  });
  it('the cabin, hopper box and bench box do not overlap each other or any other collider', () => {
    for (const a of wsSolids) {
      for (const b of others(solids, wsSolids)) expect(overlap(a, b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(false);
    }
    expect(overlap(workshopBody, hopperBox)).toBe(false);
    expect(overlap(workshopBody, benchBox)).toBe(false);
  });
  it('keeps a walkable gap (> 2 x player radius) around the cabin from the other colliders, except the sled counter side', () => {
    // north: the pad lane; south: the corridor to the sled counter
    for (const b of others(solids, wsSolids)) {
      const gx = Math.max(b.minX - workshopBody.maxX, workshopBody.minX - b.maxX);
      const gz = Math.max(b.minZ - workshopBody.maxZ, workshopBody.minZ - b.maxZ);
      expect(Math.max(gx, gz), JSON.stringify(b)).toBeGreaterThan(0.72);
    }
  });
  it('the piles sit on their trough / bench: logs inside the hopper box, chairs inside the bench box', () => {
    const hg = WS.hopper.grid;
    const hx = (hg.cols * hg.spacing.x) / 2 - hg.spacing.x / 2 + 0.3; // log half length 0.3
    const hz = (hg.rows * hg.spacing.z) / 2 - hg.spacing.z / 2 + 0.12;
    expect(hx).toBeLessThanOrEqual(WORKSHOP_HOPPER_BOX.w / 2 + 1e-9);
    expect(hz).toBeLessThanOrEqual(WORKSHOP_HOPPER_BOX.d / 2 + 1e-9);
    const bg = WS.bench.grid;
    const bx = (bg.cols * bg.spacing.x) / 2 - bg.spacing.x / 2 + 0.21;
    const bz = (bg.rows * bg.spacing.z) / 2 - bg.spacing.z / 2 + 0.21;
    expect(bx).toBeLessThanOrEqual(WORKSHOP_BENCH_BOX.w / 2 + 1e-9);
    expect(bz).toBeLessThanOrEqual(WORKSHOP_BENCH_BOX.d / 2 + 1e-9);
  });
});

describe('workshop zones', () => {
  it('do not overlap each other or any other zone, collider (except their own trough / bench) or pad', () => {
    for (const z of wsZones) {
      for (const o of others(zones, wsZones)) expect(overlap(z, o), `${JSON.stringify(z)} vs zone ${JSON.stringify(o)}`).toBe(false);
      for (const pd of pads) expect(overlap(z, pd), `${JSON.stringify(z)} vs pad ${JSON.stringify(pd)}`).toBe(false);
      expect(overlap(z, workshopBody)).toBe(false);
      for (const c of others(solids, wsSolids)) expect(overlap(z, c), `${JSON.stringify(z)} vs ${JSON.stringify(c)}`).toBe(false);
    }
    expect(overlap(wsZones[0]!, wsZones[1]!)).toBe(false);
  });
  it('the hopper zone touches the hopper and the bench zone touches the bench, and each has standing room outside every collider', () => {
    const pl = 0.36; // PLAYER.radius
    const reachable = (z: Rect): number => {
      let n = 0;
      for (let x = z.minX; x <= z.maxX; x += 0.05) {
        for (let zz = z.minZ; zz <= z.maxZ; zz += 0.05) {
          if (![...solids].some((c) => inRect(inflate(c, pl), { x, z: zz }))) n++;
        }
      }
      return n;
    };
    expect(reachable(WS.hopper.zone)).toBeGreaterThan(40);
    expect(reachable(WS.bench.zone)).toBeGreaterThan(40);
    // close enough to the pile: the zone edge is within 0.4 m of the trough / bench
    expect(Math.abs(WS.hopper.zone.maxX - hopperBox.minX)).toBeLessThan(0.4);
    expect(Math.abs(WS.bench.zone.minX - benchBox.maxX)).toBeLessThan(0.4);
  });
  it('no crew / NPC post lies inside (or within 0.3 m of) a workshop zone, and no route point lies inside one', () => {
    // posts = where a helper rests (a pine hauler on the hopper zone would be walked into by the player)
    for (const pt of Object.values(HOME)) {
      for (const z of wsZones) expect(inRect(inflate(z, 0.3), pt), `post ${JSON.stringify(pt)} near zone ${JSON.stringify(z)}`).toBe(false);
    }
    for (const pt of [...Object.values(HOME_ROUTE).flat(), ...ridgeRoutes.flat()]) {
      for (const z of wsZones) expect(inRect(z, pt), `waypoint ${JSON.stringify(pt)} in zone ${JSON.stringify(z)}`).toBe(false);
    }
  });
});

describe('workshop pad', () => {
  it('is a 2 m tile in front of the site that overlaps no other pad, collider or zone', () => {
    expect(workshopPad.id).toBe('workshop');
    for (const pd of others(pads, [workshopPadRect])) expect(overlap(inflate(workshopPadRect, 0.2), pd), JSON.stringify(pd)).toBe(false);
    for (const c of solids) expect(overlap(inflate(workshopPadRect, 0.2), c), JSON.stringify(c)).toBe(false);
    for (const z of zones) expect(overlap(workshopPadRect, z), JSON.stringify(z)).toBe(false);
  });
  it('is walkable ridge ground and reachable from every side it is entered from (no collider within a player width)', () => {
    const walk = P.ridge.walk[1]!;
    expect(inRect(walk, { x: workshopPad.x, z: workshopPad.z })).toBe(true);
    // 0.9.2: beside the cabin's east wall (camera side), so the cabin no longer hides the tile and its price
    const gapToCabin = Math.max(workshopPadRect.minX - workshopBody.maxX, workshopBody.minZ - workshopPadRect.maxZ);
    expect(gapToCabin).toBeGreaterThan(0.2);
  });
  it('is not crossed by the crew routes (the pine hauler would walk over the tile): 0.25 m clearance', () => {
    for (const r of [...routes, ...ridgeRoutes]) expect(polyHitsRect(r, inflate(workshopPadRect, 0.25)), JSON.stringify(r)).toBe(false);
  });
  it('the crew routes stay out of the cabin, hopper and bench colliders', () => {
    for (const r of [...routes, ...ridgeRoutes]) {
      for (const c of wsSolids) expect(polyHitsRect(r, inflate(c, 0.2)), `${JSON.stringify(r)} vs ${JSON.stringify(c)}`).toBe(false);
    }
  });
});

describe('sled cash tube', () => {
  const route = ROUTES['pile:sledCash']!;
  const cash = P.ridge.sledCash;
  const laneZ = P.ridge.sledLane.z;
  const path: XZ[] = [{ x: cash.x, z: cash.z }, ...route.via, TOWER];
  it('exists, with its own height between the other tubes and the tower cap', () => {
    expect(route).toBeDefined();
    const heights = Object.entries(ROUTES).filter(([id]) => id !== 'pile:sledCash').map(([, r]) => r.height);
    for (const h of heights) expect(Math.abs(h - route.height)).toBeGreaterThanOrEqual(0.29);
    expect(route.height).toBeLessThan(TOWER_HEIGHT - 0.2);
  });
  it('runs overhead away from the sled lane: no segment crosses the lane corridor and no post is within 1.2 m of it', () => {
    for (const p of route.posts) expect(Math.abs(p.z - laneZ), JSON.stringify(p)).toBeGreaterThanOrEqual(1.2);
    for (const p of path) expect(Math.abs(p.z - laneZ), JSON.stringify(p)).toBeGreaterThanOrEqual(1.2);
  });
  it('stays clear of the workshop cabin, its hopper and bench, and the walkers: posts and path', () => {
    for (const c of wsSolids) {
      expect(polyHitsRect(path, inflate(c, 0.5)), JSON.stringify(c)).toBe(false);
      for (const p of route.posts) expect(inRect(inflate(c, 0.5), p), `${JSON.stringify(p)} vs ${JSON.stringify(c)}`).toBe(false);
    }
    for (const r of ridgeRoutes) for (const p of route.posts) expect(distPoly(p, r), JSON.stringify(p)).toBeGreaterThan(0.8);
  });
  it('starts at the pile: its first post is just outside the pile zone and the spans are <= 9 m', () => {
    const first = route.posts[0]!;
    expect(inRect(cash.zone, first)).toBe(false);
    expect(Math.hypot(first.x - cash.x, first.z - cash.z)).toBeLessThan(2.0);
    for (let i = 0; i < route.posts.length - 1; i++) {
      const a = route.posts[i]!;
      const b = route.posts[i + 1]!;
      expect(Math.hypot(a.x - b.x, a.z - b.z), `${JSON.stringify(a)} -> ${JSON.stringify(b)}`).toBeLessThanOrEqual(9);
    }
  });
  it('every tube post in the whole network keeps >= 0.7 m from the sled lane and its return line', () => {
    for (const [id, r] of Object.entries(ROUTES)) {
      for (const p of r.posts) {
        if (p.x < 15) continue; // the sled only runs on the ridge
        expect(Math.abs(p.z - laneZ), `${id} ${JSON.stringify(p)} lane`).toBeGreaterThanOrEqual(0.7);
        expect(Math.abs(p.z - SLED_RETURN_Z), `${id} ${JSON.stringify(p)} return`).toBeGreaterThanOrEqual(0.7);
      }
    }
  });
});
