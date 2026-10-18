/** Wave 9 townsfolk: the instanced crowd (capacity / pooling / draw calls), crowd navigation, and the buyer state machine. */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AMENITY_IDS, BUSINESSES, LAYOUT, TOWN, rect, type XZ } from '../src/config';
import { salePrice } from '../src/core/demand';
import { EventBus } from '../src/core/EventBus';
import { createGameState, type GameContext, type GameEvents, type Item, type ItemHolder, type ItemKind, type Slot } from '../src/core/types';
import { Crowd } from '../src/npc/Crowd';
import { NAV, OBSTACLES, Path, PERSON_MARGIN, insideObstacle, ownerAmenity, planPath, planTownPath, seatPoint } from '../src/npc/CrowdNav';
import { Townsfolk, nearStandSpot } from '../src/npc/Townsfolk';
import type { ShopSpot } from '../src/town/types';
import { AMENITY_SPOTS, BENCHES, POND_POSTS, STALLS, TREE_RING } from '../src/town/spots';
import { amenityFrame, amenityToWorld } from '../src/town/rules';
import type { Town } from '../src/town/Town';

// The crowd rolls Math.random for walk-ins, picks and timings; seed it per test so these runs are repeatable.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(0x5eed));
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------------------------------
describe('Crowd (instanced people)', () => {
  it('pools its instances and never exceeds its capacity', () => {
    const crowd = new Crowd(6);
    const got = [];
    for (let i = 0; i < 6; i++) {
      const p = crowd.acquire(0xd9473f, 0xffffff);
      expect(p).not.toBeNull();
      got.push(p!);
    }
    expect(crowd.acquire(0, 0)).toBeNull();
    expect(crowd.count).toBe(6);
    expect(new Set(got.map((p) => p.id)).size).toBe(6);
    crowd.release(got[2]!);
    expect(crowd.count).toBe(5);
    const again = crowd.acquire(0x2f9e8f, 0xffd026)!;
    expect(again.id).toBe(got[2]!.id);
    // releasing twice is harmless
    crowd.release(again);
    crowd.release(again);
    expect(crowd.count).toBe(5);
  });

  it('costs a fixed handful of draw calls however many people there are, and none when empty', () => {
    const crowd = new Crowd(TOWN.crowdMax);
    crowd.update(0, 0, true);
    expect(crowd.drawCalls).toBe(0);
    for (let n = 1; n <= TOWN.crowdMax; n++) {
      const p = crowd.acquire(0xd9473f, 0xffffff)!;
      p.x = n;
      p.z = 20;
      p.appear = 1;
      p.walk = 1;
    }
    crowd.update(1, 0, true);
    expect(crowd.drawCalls).toBe(5); // no basket carried yet
    crowd.people[3]!.basket = true;
    crowd.update(1, 0, true);
    expect(crowd.drawCalls).toBe(6);
    expect(crowd.basketCount).toBe(1);
    crowd.update(1, 1, false);
    expect(crowd.drawCalls).toBe(6);
    // shadows follow the quality
    expect(crowd.meshes.filter((m) => m.castShadow).length).toBe(0);
    crowd.update(1, 0, true);
    expect(crowd.meshes.filter((m) => m.castShadow).length).toBe(6); // 5 + the basket mesh (shadow flag stays set)
    // every instanced mesh has a hand-set bounding sphere covering the settlement
    for (const m of crowd.meshes) {
      expect(m.boundingSphere).not.toBeNull();
      expect(m.boundingSphere!.containsPoint(new THREE.Vector3(24, 1, 27))).toBe(true);
      expect(m.boundingSphere!.containsPoint(new THREE.Vector3(4.6, 1, 18))).toBe(true);
    }
  });

  it('draws lanterns (+ halos) only for people carrying one, after dusk', () => {
    const crowd = new Crowd(8);
    const a = crowd.acquire(0xd9473f, 0xffffff)!;
    const b = crowd.acquire(0x2f9e8f, 0xffffff)!;
    a.appear = b.appear = 1;
    a.lantern = 1;
    crowd.update(0, 1, true);
    expect(crowd.lanternCount).toBe(1);
    expect(crowd.drawCalls).toBe(7); // 5 + lantern + halo
    a.lantern = 0;
    crowd.update(0.1, 1, true);
    expect(crowd.lanternCount).toBe(0);
    expect(crowd.drawCalls).toBe(5);
  });

  it('writes finite, non-degenerate matrices for every pose', () => {
    const crowd = new Crowd(4);
    const p = crowd.acquire(0xd9473f, 0xffffff)!;
    p.appear = 1;
    p.x = 3;
    p.z = 4;
    p.basket = true;
    p.walk = p.sit = p.cheer = p.wave = p.work = p.talk = p.carry = p.lantern = 1;
    for (let k = 0; k < 4; k++) {
      p.phase += 0.7;
      crowd.update(k * 0.3, 0.5, true);
    }
    for (const m of crowd.meshes) {
      const arr = m.instanceMatrix.array;
      const per = m.name === 'crowd' ? 16 : 16;
      for (let i = 0; i < per; i++) expect(Number.isFinite(arr[i])).toBe(true);
    }
    const torso = crowd.meshes[0]!;
    expect(torso.instanceMatrix.array[0]).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('CrowdNav', () => {
  const pts: XZ[] = [];
  const S = LAYOUT.town.square;
  for (let x = S.minX + 1; x < S.maxX; x += 2.1) {
    for (let z = S.minZ + 1; z < S.maxZ; z += 1.9) if (!insideObstacle(x, z, 0, 0.1)) pts.push({ x, z });
  }
  pts.push({ x: 4.6, z: 12 }, { x: 4.2, z: 22 }, { x: 15, z: 26.7 }, { x: 37.6, z: 33.6 });

  it('routes keep clear of the tree, the snowman, benches and stalls', () => {
    const path = new Path();
    let checked = 0;
    for (const a of pts) {
      for (const b of pts) {
        if (a === b) continue;
        planPath(path, a.x, a.z, b.x, b.z);
        let px = a.x;
        let pz = a.z;
        for (let i = 0; i < path.n; i++) {
          const x = path.x[i]!;
          const z = path.z[i]!;
          const len = Math.hypot(x - px, z - pz);
          const steps = Math.max(1, Math.ceil(len / 0.05));
          for (let k = 0; k <= steps; k++) {
            const sx = px + ((x - px) * k) / steps;
            const sz = pz + ((z - pz) * k) / steps;
            expect(insideObstacle(sx, sz, 0, -0.2), `(${a.x},${a.z})->(${b.x},${b.z}) hits an obstacle at ${sx.toFixed(2)},${sz.toFixed(2)}`).toBe(false);
          }
          px = x;
          pz = z;
        }
        expect(path.x[path.n - 1]).toBeCloseTo(b.x, 3);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  }, 30000); // pure maths, but ~6 s of it when the machine is busy

  it('the tree ring, bench approaches and stall browse spots are reachable and free', () => {
    // (the tree ring / bench approaches may sit within a person's margin of an amenity solid, TREE_RING[6] even inside the cafe footprint: a layout conflict reported separately; routes to them still work, an obstacle holding the end point is skipped)
    const solids = OBSTACLES.filter((o) => o.owner < ownerAmenity(AMENITY_IDS[0]!));
    const hitsSolid = (x: number, z: number): boolean =>
      solids.some((o) => {
        const dx = o.x2 - o.x;
        const dz = o.z2 - o.z;
        const l2 = dx * dx + dz * dz;
        const t = l2 < 1e-9 ? 0 : Math.min(1, Math.max(0, ((x - o.x) * dx + (z - o.z) * dz) / l2));
        return Math.hypot(x - o.x - dx * t, z - o.z - dz * t) < o.r + PERSON_MARGIN;
      });
    const inAnyFootprint = (x: number, z: number): boolean =>
      AMENITY_IDS.some((id) => {
        const r = amenityFrame(id).rect;
        return x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;
      });
    for (const s of TREE_RING) expect(hitsSolid(s.x, s.z)).toBe(false);
    for (let i = 0; i < BENCHES.length; i++) {
      const o: Parameters<typeof seatPoint>[2] = { x: 0, z: 0, yaw: 0, ax: 0, az: 0 };
      for (const seat of [0, 1]) {
        seatPoint(i, seat, o);
        expect(hitsSolid(o.ax, o.az)).toBe(false);
        expect(inAnyFootprint(o.ax, o.az)).toBe(false);
        expect(Math.hypot(o.x - BENCHES[i]!.x, o.z - BENCHES[i]!.z)).toBeLessThan(0.6);
      }
    }
    for (const s of STALLS) expect(hitsSolid(s.x + Math.sin(s.yaw) * 1.2, s.z + Math.cos(s.yaw) * 1.2)).toBe(false);
    // tree + snowman + benches + stalls + the four amenities (bitmasks are `1 << k`: keep the count well under 31)
    expect(OBSTACLES.length).toBe(2 + BENCHES.length + STALLS.length + AMENITY_IDS.length + POND_POSTS.length);
    expect(OBSTACLES.length).toBeLessThan(31);
  });

  /** Every 0.1 m along the polyline from (x, z) through the path's points. */
  const sampleRoute = (x: number, z: number, path: Path, visit: (x: number, z: number) => void): void => {
    let cx = x;
    let cz = z;
    for (let i = 0; i < path.n; i++) {
      const nx = path.x[i]!;
      const nz = path.z[i]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(nx - cx, nz - cz) / 0.1));
      for (let k = 0; k <= steps; k++) visit(cx + ((nx - cx) * k) / steps, cz + ((nz - cz) * k) / steps);
      cx = nx;
      cz = nz;
    }
  };

  it('routes walk around the pond (and the other solid amenities), not through them', () => {
    const path = new Path();
    const pond = amenityFrame('pond').rect;
    const inside = (r: typeof pond, x: number, z: number): boolean =>
      x > r.minX + 0.05 && x < r.maxX - 0.05 && z > r.minZ + 0.05 && z < r.maxZ - 0.05;
    planPath(path, 20, 25, 26, 31);
    expect(path.n).toBeGreaterThan(0);
    expect(path.x[path.n - 1]).toBeCloseTo(26, 3);
    expect(path.z[path.n - 1]).toBeCloseTo(31, 3);
    let samples = 0;
    sampleRoute(20, 25, path, (x, z) => {
      samples++;
      expect(inside(pond, x, z)).toBe(false);
    });
    expect(samples).toBeGreaterThan(50);
    // a straight line from the pond's west side to its east side must bend around it
    const w = { x: pond.minX - 0.8, z: (pond.minZ + pond.maxZ) / 2 };
    const e = { x: pond.maxX + 0.8, z: w.z };
    planPath(path, w.x, w.z, e.x, e.z);
    expect(path.n).toBeGreaterThan(1);
    sampleRoute(w.x, w.z, path, (x, z) => expect(inside(pond, x, z)).toBe(false));
    // the amenity pad tiles stay walkable (no obstacle covers them)
    for (const id of AMENITY_IDS) {
      const pad = LAYOUT.town.amenities[id].pad;
      expect(insideObstacle(pad.x, pad.z, 0, -PERSON_MARGIN)).toBe(false);
    }
  });

  it('the cafe stools are reachable (with the cafe mask, and without: only the kiosk body is solid)', () => {
    const f = amenityFrame('cafe');
    const stools = AMENITY_SPOTS.cafe;
    expect(stools.length).toBe(4);
    const path = new Path();
    for (const s of stools) {
      for (const ignore of [ownerAmenity('cafe'), 0]) {
        planTownPath(path, 20.2, 24.5, s.x, s.z, ignore);
        expect(path.n).toBeGreaterThan(0);
        expect(path.x[path.n - 1]).toBeCloseTo(s.x, 3);
        expect(path.z[path.n - 1]).toBeCloseTo(s.z, 3);
      }
      // no stool sits inside the (kiosk-only) obstacle
      expect(insideObstacle(s.x, s.z, 0, -PERSON_MARGIN + 0.02)).toBe(false);
      // the approach point from behind (as Townsfolk plans it, no mask) is reachable too
      const ax = s.x - Math.sin(s.yaw) * 0.9;
      const az = s.z - Math.cos(s.yaw) * 0.9;
      planTownPath(path, 20.2, 24.5, ax, az);
      expect(path.n).toBeGreaterThan(0);
    }
    // the kiosk body itself (the half away from the tables) is blocked for people
    const k = amenityToWorld(f, 0, -f.d / 2 + 0.42); // the kiosk's middle
    expect(insideObstacle(k.x, k.z)).toBe(true);
    expect(insideObstacle(k.x, k.z, ownerAmenity('cafe'))).toBe(false);
    expect(ownerAmenity('cafe')).not.toBe(ownerAmenity('pond'));
    expect(NAV.nodes).toBeGreaterThan(0);
  });

  it('a route from the village street to the square goes through the corridor', () => {
    const path = new Path();
    planPath(path, 4.6, 14, 24, 22);
    let inCorridor = false;
    for (let i = 0; i < path.n; i++) if (Math.abs(path.z[i]! - 26.7) < 0.3 && path.x[i]! > 4 && path.x[i]! < 17) inCorridor = true;
    expect(inCorridor).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// A minimal fake world for the buyer state machine.

const KIND: ItemKind = 'bread';

class FakeCounter implements ItemHolder {
  readonly id = 'pile:fake';
  items: Item[] = [];
  taken = 0;
  constructor(n: number) {
    for (let i = 0; i < n; i++) this.items.push({ id: i, kind: KIND, object: new THREE.Object3D(), value: 0 });
  }
  canAccept(): boolean {
    return false;
  }
  reserve(): Slot {
    throw new Error('not used');
  }
  getSlotWorldPosition(_s: Slot, out: THREE.Vector3): THREE.Vector3 {
    return out;
  }
  getSlotWorldQuaternion(_s: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return out;
  }
  receive(): void {}
  cancel(): void {}
  count(kind?: ItemKind): number {
    return kind === undefined || kind === KIND ? this.items.length : 0;
  }
  take(): Item | null {
    const it = this.items.pop() ?? null;
    if (it) this.taken++;
    return it;
  }
}

function makeWorld(stock: number) {
  const state = createGameState();
  state.village.revealed = true;
  state.village.level = 3;
  state.town.revealed = true;
  const events = new EventBus<GameEvents>();
  const sales: GameEvents['sale'][] = [];
  events.on('sale', (s) => sales.push({ ...s, position: s.position.clone() }));
  const scene = new THREE.Scene();
  const released: Item[] = [];
  const flights: { item: Item; to: ItemHolder; slot: Slot; t: number }[] = [];
  const ctx = {
    scene,
    state,
    events,
    renderer: { quality: 'high' as 'high' | 'low' },
    dayNight: { darkness: 0 },
    rush: { active: false, spawnMult: 1 },
    items: { release: (it: Item) => released.push(it) },
    flights: {
      launch: (item: Item, to: ItemHolder, slot: Slot) => {
        flights.push({ item, to, slot, t: 0.25 });
      },
    },
  } as unknown as GameContext;

  const counter = new FakeCounter(stock);
  const pays: { amount: number }[] = [];
  const def = BUSINESSES.bakery;
  const lot = 2;
  const front = LAYOUT.town.lots[lot]!;
  const shop: ShopSpot = {
    lot,
    def,
    counter: counter as unknown as ShopSpot['counter'],
    till: { pay: (amount: number) => pays.push({ amount }) } as unknown as ShopSpot['till'],
    queueSpot: (i: number, out: XZ) => {
      out.x = front.x;
      out.z = front.z + front.face.z * (2.2 + i * 0.9);
      return out;
    },
    facing: Math.PI,
    counterTop: new THREE.Vector3(front.x, 1, front.z + front.face.z * 1.3),
  };
  const town = {
    revealed: true,
    shops: () => [shop],
    staffSpots: () => [],
  } as unknown as Town;
  const folk = new Townsfolk(ctx, town);
  const step = (dt: number) => {
    folk.update(dt);
    // land flights (the real FlightSystem arcs the item for a fraction of a second)
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i]!;
      f.t -= dt;
      if (f.t <= 0) {
        flights.splice(i, 1);
        f.to.receive(f.item, f.slot);
      }
    }
  };
  return { ctx, folk, counter, pays, sales, state, shop, step, released, def };
}

describe('Townsfolk buyers', () => {
  it('queue, take goods, pay salePrice, count goodsSold, emit sale and leave', () => {
    const w = makeWorld(60);
    w.folk.forceWanderers = 0;
    let maxQueue = 0;
    for (let i = 0; i < 60 * 150; i++) {
      w.step(1 / 60);
      maxQueue = Math.max(maxQueue, w.folk.buyers);
      // every item taken off the counter is either sold or still in an unpaid basket
      const sold = w.state.stats.goodsSold;
      if (i % 5 === 0) expect(w.counter.taken).toBe(sold + w.folk.loadedByLot(w.shop.lot));
    }
    expect(w.state.stats.goodsSold).toBeGreaterThan(5);
    expect(w.sales.length).toBeGreaterThan(1);
    expect(w.pays.length).toBe(w.sales.length);
    for (let i = 0; i < w.sales.length; i++) {
      const s = w.sales[i]!;
      expect(s.buyer).toBe('townsfolk');
      expect(s.kind).toBe(KIND);
      expect(s.count).toBeGreaterThanOrEqual(w.def.want[0]);
      expect(s.count).toBeLessThanOrEqual(w.def.want[1]);
      expect(s.amount).toBe(salePrice(w.state, 'bread', w.def.price, s.count));
      expect(w.pays[i]!.amount).toBe(s.amount);
    }
    expect(w.state.stats.goodsSold).toBe(w.sales.reduce((n, s) => n + s.count, 0));
    // never more than the queue allows (plus the ones walking out)
    expect(maxQueue).toBeLessThanOrEqual(TOWN.queuePerShop + 6);
    // released items went back to the pool, none leaked into the world
    expect(w.released.length).toBeGreaterThanOrEqual(w.state.stats.goodsSold);
    expect(w.released.length).toBeLessThanOrEqual(w.counter.taken);
  });

  it('does not queue at a shop with nothing to sell', () => {
    const w = makeWorld(0);
    w.folk.forceWanderers = 0;
    for (let i = 0; i < 60 * 30; i++) w.step(1 / 60);
    expect(w.folk.buyers).toBe(0);
  });

  it('sends the queue away when the shop closes', () => {
    const w = makeWorld(0);
    w.folk.forceWanderers = 0;
    w.counter.items.push(...new FakeCounter(1).items);
    for (let i = 0; i < 60 * 8; i++) w.step(1 / 60);
    expect(w.folk.buyers).toBeGreaterThan(0);
    (w.folk.town as unknown as { shops: () => ShopSpot[] }).shops = () => [];
    for (let i = 0; i < 60 * 60; i++) w.step(1 / 60);
    expect(w.folk.buyers).toBe(0);
    expect(w.folk.loadedByLot(w.shop.lot)).toBe(0);
  });

  it('rush hours spawn buyers faster', () => {
    const run = (rush: boolean): number => {
      const w = makeWorld(400);
      w.folk.forceWanderers = 0;
      (w.ctx.rush as { active: boolean; spawnMult: number }).active = rush;
      (w.ctx.rush as { active: boolean; spawnMult: number }).spawnMult = rush ? 3 : 1;
      for (let i = 0; i < 60 * 120; i++) w.step(1 / 60);
      return w.sales.length;
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });
});

describe('Townsfolk wanderers', () => {
  const walk = [...LAYOUT.village.walk, ...LAYOUT.town.walk].map((r) => rect((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, r.maxX - r.minX + 1.4, r.maxZ - r.minZ + 1.4));
  const lane = { minX: LAYOUT.town.square.maxX - 2, maxX: 39, minZ: LAYOUT.town.square.maxZ - 2, maxZ: LAYOUT.town.entrances[1]!.z + 1.4 };
  const yardGate = { minX: 2.5, maxX: 7, minZ: 9, maxZ: 12 };
  const inside = (x: number, z: number): boolean => [...walk, lane, yardGate].some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);

  it('fill the target, stay on the walkways and out of the solids, and respect the capacity', () => {
    const w = makeWorld(0);
    w.folk.forceWanderers = TOWN.crowdMax + 20; // clamped to the capacity
    for (let i = 0; i < 60 * 90; i++) {
      w.step(1 / 30);
      if (i % 20 === 0) {
        expect(w.folk.visible).toBeLessThanOrEqual(TOWN.crowdMax);
        for (const p of w.folk.crowd.people) {
          if (!p.active || p.appear < 0.5) continue;
          expect(inside(p.x, p.z), `person at ${p.x.toFixed(2)},${p.z.toFixed(2)} left the walkways`).toBe(true);
        }
      }
    }
    expect(w.folk.wanderers).toBeGreaterThan(TOWN.crowdMax * 0.8);
    expect(w.folk.visible).toBeLessThanOrEqual(TOWN.crowdMax);
  });

  it('follow the level target, halve on Low quality and thin out at night', () => {
    const count = (setup: (w: ReturnType<typeof makeWorld>) => void): number => {
      const w = makeWorld(0);
      setup(w);
      for (let i = 0; i < 60 * 150; i++) w.step(1 / 30);
      return w.folk.wanderers;
    };
    const day = count((w) => {
      w.state.village.level = 4;
    });
    expect(day).toBe(TOWN.wanderers[4]);
    const low = count((w) => {
      w.state.village.level = 4;
      (w.ctx.renderer as { quality: string }).quality = 'low';
    });
    expect(low).toBe(Math.round(TOWN.wanderers[4]! / 2));
    const night = count((w) => {
      w.state.village.level = 3;
      (w.ctx.dayNight as { darkness: number }).darkness = 1;
    });
    expect(night).toBeLessThan(TOWN.wanderers[3]!);
    const none = count((w) => {
      w.state.village.revealed = false;
    });
    expect(none).toBe(0);
  });

  it('some carry lanterns at night', () => {
    const w = makeWorld(0);
    w.state.village.level = 5;
    (w.ctx.dayNight as { darkness: number }).darkness = 1;
    for (let i = 0; i < 60 * 60; i++) w.step(1 / 30);
    expect(w.folk.crowd.lanternCount).toBeGreaterThan(0);
  });
});

describe('0.9.10: strolls and chats keep off the spots people stand on', () => {
  it('every tree-ring, amenity and bench spot counts as taken for a stroll or a chat', () => {
    const spots: XZ[] = [...TREE_RING, ...AMENITY_IDS.flatMap((id) => AMENITY_SPOTS[id])];
    const seat = { x: 0, z: 0, yaw: 0, ax: 0, az: 0 };
    BENCHES.forEach((_, i) => {
      for (const k of [0, 1]) {
        seatPoint(i, k, seat);
        spots.push({ x: seat.x, z: seat.z }, { x: seat.ax, z: seat.az });
      }
    });
    for (const s of spots) {
      expect(nearStandSpot(s.x, s.z)).toBe(true);
      expect(nearStandSpot(s.x + 0.3, s.z - 0.3)).toBe(true); // 0.42 m off: still standing inside them
    }
    expect(nearStandSpot(LAYOUT.town.entrances[0]!.x, LAYOUT.town.entrances[0]!.z)).toBe(false);
  });
});
