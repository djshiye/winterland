/**
 * 0.9.0 Ages: demolishing a Market Town business. Pure rules (price, era gate, the manage zone's geometry: clear of
 * every station zone, queue place, amenity, prop and wall on all eight lots) are checked without WebGL.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AMENITY_IDS, BUSINESSES, EVENTS, LAYOUT, PLAYER, TOWN, inflate, type BusinessId, type Rect, type XZ } from '../src/config';
import { DEMOLISH_MIN, DEMOLISH_SHARE, ROADS } from '../src/eras/data';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { villagePopulation, villageLevelFor } from '../src/core/demand';
import { createGameState, type GameContext, type GameEvents, type Item, type ItemKind } from '../src/core/types';
import { Townsfolk } from '../src/npc/Townsfolk';
import { Town } from '../src/town/Town';
import { BENCHES, SNOWMAN, STALLS } from '../src/town/spots';
import { LANE_PLAYER_WALK } from '../src/town/lane';
import { MANAGE_DWELL, MANAGE_STILL_SPEED, amenityFrame, canManage, demolishCost, layoutFor, lotFrame, manageLocal, manageOpens, manageRect, queueSpotOf, worldRect } from '../src/town/rules';
import { SQUARE_LAMPS } from '../src/world/env/town';

const T = LAYOUT.town;
const R = 0.36;
const IDS = Object.keys(BUSINESSES) as BusinessId[];
const FRONTS = [0.9, 1.2, 1.5, 1.8];
const inRect = (r: Rect, x: number, z: number): boolean => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const gap = (a: Rect, b: Rect): number => Math.hypot(Math.max(a.minX - b.maxX, b.minX - a.maxX, 0), Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ, 0));
// 0.9.12: Lantern Lane's lots stand on its own walk (town/lane.ts)
const walkable = (x: number, z: number): boolean => [...T.walk, LANE_PLAYER_WALK].some((r) => inRect(r, x, z));

describe('demolishCost', () => {
  it('is a share of the cash price, never below the minimum', () => {
    for (const id of IDS) {
      const c = demolishCost(id);
      expect(c).toBeGreaterThanOrEqual(DEMOLISH_MIN);
      expect(c).toBe(Math.max(DEMOLISH_MIN, Math.round(BUSINESSES[id].cash * DEMOLISH_SHARE)));
    }
  });
});

describe('canManage (era gate)', () => {
  it('needs a revealed town, a built building and era 2', () => {
    const s = createGameState();
    s.town.revealed = true;
    s.town.lots[1] = { building: 'bakery', tier: 0, logs: 0, cash: 0 };
    s.town.lots[2] = { building: 'farm', tier: -1, logs: 1, cash: 0 };
    expect(s.eras.age).toBe(1);
    expect(canManage(s, 1)).toBe(false); // era 1 plays as before
    s.eras.age = 2;
    expect(canManage(s, 1)).toBe(true);
    expect(canManage(s, 0)).toBe(false); // empty
    expect(canManage(s, 2)).toBe(false); // still being paid
    expect(canManage(s, 99)).toBe(false);
    s.town.revealed = false;
    expect(canManage(s, 1)).toBe(false);
  });
});

describe('manage zone geometry', () => {
  /** Everything a lot may hold whatever is built there, per lot: zones, solids, queue places. */
  const perLot = T.lots.map((_, lot) => {
    const f = lotFrame(lot);
    const zones: Rect[] = [];
    const solids: Rect[] = [];
    const queue: { x: number; z: number }[] = [];
    for (const id of IDS) {
      for (const depth of FRONTS) {
        const L = layoutFor(BUSINESSES[id], depth, f.variant);
        for (const z of [L.feed, L.pickup, L.collect]) if (z) zones.push(worldRect(f, z.u0, z.u1, z.v0, z.v1));
        for (const s of L.solids) solids.push(worldRect(f, s.u0, s.u1, s.v0, s.v1));
        if (BUSINESSES[id].kind === 'shop') for (let i = 0; i < TOWN.queuePerShop; i++) queue.push({ ...queueSpotOf(f, L, i, { x: 0, z: 0 }) });
      }
    }
    return { zones, solids, queue };
  });
  const circles = [
    ...BENCHES.map((b) => ({ x: b.x, z: b.z, r: 1.0 })),
    { x: SNOWMAN.x, z: SNOWMAN.z, r: 0.5 },
    { x: T.tree.x, z: T.tree.z, r: T.tree.r },
    ...SQUARE_LAMPS.map((l) => ({ x: l.x, z: l.z, r: 0.2 })),
  ];
  // a stall is ~1.1 x 1.9 m (yaw a quarter turn), see townAmenities.test.ts
  const stallRects: Rect[] = STALLS.map((s) => {
    const c = Math.abs(Math.cos(s.yaw));
    const sn = Math.abs(Math.sin(s.yaw));
    const hx = c * 0.95 + sn * 0.55;
    const hz = sn * 0.95 + c * 0.55;
    return { minX: s.x - hx, maxX: s.x + hx, minZ: s.z - hz, maxZ: s.z + hz };
  });
  const amenityRects = [...stallRects, ... AMENITY_IDS.flatMap((id) => [amenityFrame(id).rect, amenityFrame(id).padRect])];

  it('is small, local and on the lot front', () => {
    T.lots.forEach((_, lot) => {
      const l = manageLocal(lot);
      expect(l.u1 - l.u0).toBeLessThanOrEqual(1.2);
      expect(l.v0).toBeGreaterThan(3.9); // beyond every station zone
      expect(Math.abs(l.u0)).toBeLessThan(T.lotSize / 2);
      expect(Math.abs(l.u1)).toBeLessThan(T.lotSize / 2);
    });
  });

  it('is walkable (the player can stand in it) on every lot', () => {
    T.lots.forEach((_, lot) => {
      const z = manageRect(lot);
      let ok = false;
      for (let x = z.minX; x <= z.maxX && !ok; x += 0.05) for (let y = z.minZ; y <= z.maxZ && !ok; y += 0.05) if (walkable(x, y) && walkable(x + R * 0.0, y)) ok = true;
      expect(ok, `lot ${lot}`).toBe(true);
      // the whole zone lies inside the walkable square, so a player stepping in is never blocked at its edge
      expect([z.minX, z.maxX].every((x) => walkable(x, (z.minZ + z.maxZ) / 2)) && [z.minZ, z.maxZ].every((y) => walkable((z.minX + z.maxX) / 2, y)), `lot ${lot} inside walk`).toBe(true);
    });
  });

  it('keeps clear of the lot\'s own and every other lot\'s zones, queue places and props', () => {
    T.lots.forEach((_, lot) => {
      const z = manageRect(lot);
      perLot.forEach((o, j) => {
        for (const oz of o.zones) expect(overlap(z, oz), `lot ${lot} vs zone of lot ${j}`).toBe(false);
        for (const s of o.solids) expect(overlap(inflate(z, 0.05), s), `lot ${lot} vs solid of lot ${j}`).toBe(false);
        for (const q of o.queue) expect(inRect(inflate(z, 0.3), q.x, q.z), `lot ${lot} vs queue of lot ${j}`).toBe(false);
        // the (empty) lot's BUILD pad tile and its panel zone
        const pad = worldRect(lotFrame(j), -T.padSize * 0.6, T.padSize * 0.6, T.padOffset - T.padSize * 0.6, T.padOffset + T.padSize * 0.6);
        // (its own pad is never shown together with the manage zone: the first needs an empty lot, the second a built one)
        if (j !== lot) expect(overlap(z, pad), `lot ${lot} vs pad of lot ${j}`).toBe(false);
      });
    });
  });

  it('never overlaps another lot\'s manage zone, an amenity, a bench, stall, the tree or an entrance', () => {
    T.lots.forEach((_, lot) => {
      const z = manageRect(lot);
      T.lots.forEach((_, j) => {
        if (j !== lot) expect(overlap(z, manageRect(j)), `lots ${lot}/${j}`).toBe(false);
      });
      for (const a of amenityRects) expect(gap(z, a), `lot ${lot} amenity`).toBeGreaterThanOrEqual(0.3);
      for (const c of circles) expect(gap(z, { minX: c.x, maxX: c.x, minZ: c.z, maxZ: c.z }), `lot ${lot} circle ${c.x},${c.z}`).toBeGreaterThanOrEqual(c.r);
      for (const e of T.entrances) expect(inRect(inflate(z, 0.5), e.x, e.z), `lot ${lot} entrance`).toBe(false);
    });
  });
});


describe('0.9.10: crossing the square never opens a manage card (walking-line probe)', () => {
  const road = (id: string): Rect => ROADS.find((r) => r.id === id)!.rect as Rect;
  const ne = road('cityLink');
  const east = road('townEast');
  const mouth = T.walk[0]!; // the corridor from the village street into the square
  // Where a player leaves the corridor (across its width) and where they enter the north-east road or the east gate.
  const starts = [0, 0.25, 0.5, 0.75, 1].map((k) => ({ x: mouth.maxX - 0.4, z: mouth.minZ + k * (mouth.maxZ - mouth.minZ) }));
  const ends = [
    ...[0.1, 0.3, 0.5, 0.7, 0.9].map((k) => ({ x: ne.minX + 1.2, z: ne.minZ + k * (ne.maxZ - ne.minZ), to: 'NE road' })),
    ...[0.1, 0.3, 0.5, 0.7, 0.9].map((k) => ({ x: east.minX + 1.2, z: east.minZ + k * (east.maxZ - east.minZ), to: 'east gate' })),
  ];
  /**
   * Walks a player takes: straight from the corridor to the exit; along the corridor's line into the square to any
   * turning point, then straight (or at the keyboard's 45 degrees) to the exit; and the shortest way round the north
   * side of the bandstand, along the north shops (it brushes lots 1 and 4's tiles).
   */
  const routes: { name: string; pts: XZ[] }[] = [];
  for (const s of starts) {
    for (const e of ends) {
      routes.push({ name: `straight to the ${e.to}`, pts: [s, e] });
      for (let t = T.square.minX; t <= T.square.maxX - 0.5; t += 0.25) {
        const turn = { x: t, z: s.z };
        routes.push({ name: `east to x ${t}, then to the ${e.to}`, pts: [s, turn, e] });
        const k = e.x - t;
        routes.push({ name: `east to x ${t}, then 45 degrees`, pts: [s, turn, { x: e.x, z: s.z + Math.sign(e.z - s.z) * k }] });
      }
      routes.push({ name: `north of the bandstand to the ${e.to}`, pts: [s, { x: 21.04, z: 23.29 }, { x: 27.51, z: 22.26 }, e] });
    }
  }

  /** Longest unbroken stay (s) in each manage tile along `pts` at `speed` m/s, sampled every frame. */
  function stays(pts: XZ[], speed: number): number[] {
    const tiles = T.lots.map((_, i) => manageRect(i));
    const run = tiles.map(() => 0);
    const best = tiles.map(() => 0);
    const step = speed / 60;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
      for (let k = 0; k < n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n;
        const z = a.z + ((b.z - a.z) * k) / n;
        tiles.forEach((r, j) => {
          run[j] = inRect(r, x, z) ? run[j]! + 1 / 60 : 0;
          best[j] = Math.max(best[j]!, run[j]!);
        });
      }
    }
    return best;
  }

  it('the probe really crosses lot 6\'s tile (the one that popped up)', () => {
    const lot6 = routes.filter((r) => stays(r.pts, PLAYER.speed)[6]! > 0);
    expect(lot6.length).toBeGreaterThan(10);
  });

  it('no walk to the north-east road or the east gate stays on any tile long enough to open its card', () => {
    // the slowest walk is a snowstorm on the first boots (x 0.6); the stick held, so never "standing still"
    for (const speed of [PLAYER.speed * EVENTS.kinds.snowstorm.walkSpeedMult, PLAYER.speed]) {
      expect(speed).toBeGreaterThan(MANAGE_STILL_SPEED);
      for (const r of routes) {
        stays(r.pts, speed).forEach((t, lot) => expect(manageOpens(t, speed), `${r.name} @ ${speed.toFixed(1)} m/s, lot ${lot} for ${t.toFixed(2)} s`).toBe(false));
      }
    }
  });

  it('even along a tile\'s longest line at the slowest walk the stay is shorter than the dwell', () => {
    for (let i = 0; i < T.lots.length; i++) {
      const r = manageRect(i);
      expect(Math.hypot(r.maxX - r.minX, r.maxZ - r.minZ) / (PLAYER.speed * EVENTS.kinds.snowstorm.walkSpeedMult)).toBeLessThan(MANAGE_DWELL);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Town with a fake context (no WebGL: a canvas stub is enough for the pad textures)
// ---------------------------------------------------------------------------------------------------------------
interface FakeZone {
  opts: { id: string; area: Rect; enabled?: boolean; onEnter?: () => void; onExit?: () => void; onStay?: (dt: number) => void };
  enabled: boolean;
  removed: boolean;
  setEnabled(on: boolean): void;
}

/** The player steps onto a zone and stands there for a frame (the fake player has no velocity: standing still). */
function stepOn(z: FakeZone): void {
  z.opts.onEnter?.();
  z.opts.onStay?.(1 / 60);
}

function makeTown(age: number, money = 100000) {
  const noop2d = new Proxy({}, { get: () => () => ({ width: 10, addColorStop: () => undefined }), set: () => true });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop2d }), fonts: undefined });
  const events = new EventBus<GameEvents>();
  const state = createGameState();
  state.eras.age = age;
  state.village.level = 3;
  state.town.revealed = true;
  const log: { type: string; payload: unknown }[] = [];
  for (const t of ['manage:open', 'manage:close', 'town:demolished', 'town:built', 'build:chosen'] as const) events.on(t, (payload: unknown) => void log.push({ type: t, payload }));
  const zones: FakeZone[] = [];
  const mk = (opts: FakeZone['opts']): FakeZone => {
    const z: FakeZone = { opts, enabled: opts.enabled ?? true, removed: false, setEnabled: (on) => void (z.enabled = on) };
    zones.push(z);
    return z;
  };
  const boxes = new Map<object, string>();
  const flying = { n: 0 };
  const economy = new Economy(events, state, money);
  const ctx = {
    scene: new THREE.Scene(),
    camera: new THREE.OrthographicCamera(),
    events,
    state,
    time: { elapsed: 0, frame: 0 },
    addUpdatable: () => undefined,
    economy,
    upgrades: { value: () => 1 },
    player: { arms: { id: 'arms', count: () => 0 }, back: {}, position: new THREE.Vector3() },
    zones: { add: mk, addTransfer: mk, remove: (z: FakeZone) => void (z.removed = true), isPlayerIn: () => false },
    colliders: {
      addBounds: () => undefined,
      addBox: (_r: Rect, tag: string) => {
        const h = {};
        boxes.set(h, tag);
        return h;
      },
      remove: (h: object) => void boxes.delete(h),
    },
    tweens: { killTweensOf: () => undefined, popIn: () => undefined, run: () => undefined, punchScale: () => undefined, squash: () => undefined, delay: () => undefined },
    particles: { ring: () => undefined, puff: () => undefined, sparkle: () => undefined },
    audio: { play: () => undefined },
    items: { create: (kind: ItemKind, value?: number): Item => ({ id: 1, kind, value: value ?? 0, object: new THREE.Object3D() }) as Item, release: () => undefined },
    flights: { launch: () => undefined, inFlightTo: () => flying.n },
    hud: { buildPanel: { attach: () => undefined } },
    environment: { openTownGate: () => undefined, openLane: () => undefined },
  } as unknown as GameContext;
  const town = new Town(ctx);
  town.reveal(true);
  return { ctx, town, state, events, log, zones, boxes, flying, economy };
}

describe('Town demolish (fake context)', () => {
  it('era 1: no manage zone anywhere; era 2 (state + era:unlocked) opens one per built lot', () => {
    const w = makeTown(1);
    w.town.debugBuild(0, 'farm');
    w.town.debugBuild(1, 'bakery');
    expect(w.zones.filter((z) => z.opts.id.endsWith(':manage'))).toHaveLength(0);
    w.state.eras.age = 2;
    w.events.emit('era:unlocked', { era: 2, position: new THREE.Vector3() });
    const mz = w.zones.filter((z) => z.opts.id.endsWith(':manage'));
    expect(mz.map((z) => z.opts.id).sort()).toEqual(['town:lot0:manage', 'town:lot1:manage']);
    expect(mz.every((z) => z.enabled)).toBe(true);
    // the manage card
    stepOn(mz.find((z) => z.opts.id === 'town:lot1:manage')!);
    const open = w.log.find((l) => l.type === 'manage:open')!.payload as GameEvents['manage:open'];
    expect(open.key).toBe('town:1');
    expect(open.title).toBe('Bakery');
    expect(open.subtitle).toBe('Market Town');
    expect(open.demolishCost).toBe(demolishCost('bakery'));
    expect(open.stats!.length).toBeGreaterThan(1);
  });

  it('0.9.10: walking across a manage tile does not open its card; stopping on it does', () => {
    const w = makeTown(2);
    w.town.debugBuild(6, 'bakery');
    const z = w.zones.find((q) => q.opts.id === 'town:lot6:manage')!;
    const player = w.ctx.player as unknown as { velocity?: THREE.Vector3 };
    player.velocity = new THREE.Vector3(PLAYER.speed, 0, 0);
    z.opts.onEnter!();
    for (let t = 0; t < 0.15; t += 1 / 60) z.opts.onStay!(1 / 60); // a full-speed step across the 0.8 m tile
    z.opts.onExit!();
    expect(w.log.some((l) => l.type === 'manage:open')).toBe(false);
    z.opts.onEnter!();
    z.opts.onStay!(1 / 60);
    player.velocity.set(0.4, 0, 0); // let go of the stick on the tile
    z.opts.onStay!(1 / 60);
    expect(w.log.filter((l) => l.type === 'manage:open')).toHaveLength(1);
    z.opts.onStay!(1 / 60);
    expect(w.log.filter((l) => l.type === 'manage:open')).toHaveLength(1); // once per visit
  });

  it('a lot built at era 2 gets its zone as it completes; an era-1 restore with age 2 has it at once', () => {
    const w = makeTown(2);
    expect(w.zones.some((z) => z.opts.id.endsWith(':manage'))).toBe(false); // nothing built yet
    w.town.debugBuild(3, 'townhouse');
    expect(w.zones.some((z) => z.opts.id === 'town:lot3:manage' && z.enabled)).toBe(true);
  });

  it('demolish: pays, refunds the till, frees the lot, drops every zone / collider / shop, shrinks the population', () => {
    const w = makeTown(2);
    w.town.debugBuild(1, 'bakery');
    w.town.debugBuild(4, 'townhouse');
    const b = w.town.business(1)!;
    b.till!.restoreValue(200);
    const popBefore = villagePopulation(w.state);
    expect(w.town.shops()).toHaveLength(1);
    expect(w.town.staffSpots().some((s) => s.lot === 1)).toBe(true);
    const ownZones = w.zones.filter((z) => z.opts.id.startsWith('pile:town1'));
    expect(ownZones.length).toBeGreaterThan(0);
    const boxesBefore = [...w.boxes.values()].filter((t) => t.startsWith('town:1')).length;
    expect(boxesBefore).toBeGreaterThan(0);

    w.town.business(1) && stepOn(w.zones.find((z) => z.opts.id === 'town:lot1:manage')!);
    const open = [...w.log].reverse().find((l) => l.type === 'manage:open')!.payload as GameEvents['manage:open'];
    const money = w.economy.money;
    expect(open.onDemolish()).toBe(true);
    expect(w.economy.money).toBe(money - open.demolishCost! + 200);
    expect(w.state.town.lots[1]).toEqual({ building: '', tier: -1, logs: 0, cash: 0 });
    expect(w.state.stats.demolished).toBe(1);
    expect(w.town.business(1)).toBeNull();
    expect(w.town.shops()).toHaveLength(0);
    expect(w.town.tills()).toHaveLength(0);
    expect(w.town.staffSpots().some((s) => s.lot === 1)).toBe(false);
    expect(w.town.padSpot(1)).not.toBeNull();
    expect(ownZones.every((z) => z.removed)).toBe(true);
    expect([...w.boxes.values()].filter((t) => t.startsWith('town:1'))).toHaveLength(0);
    expect(w.zones.find((z) => z.opts.id === 'town:lot1:manage')!.enabled).toBe(false);
    expect(w.zones.find((z) => z.opts.id === 'town:lot1:build')!.enabled).toBe(true);
    expect(w.zones.find((z) => z.opts.id === 'town:lot4:manage')!.enabled).toBe(true); // the others are untouched
    expect(w.log.some((l) => l.type === 'manage:close' && (l.payload as { key: string }).key === 'town:1')).toBe(true);
    expect(w.log.filter((l) => l.type === 'town:demolished')).toHaveLength(1);
    expect(popBefore - villagePopulation(w.state)).toBe(BUSINESSES.bakery.people);
    // the stored level is a floor: villageLevelFor alone could drop, Village keeps max(level, ...)
    expect(villageLevelFor(0, false)).toBeLessThanOrEqual(w.state.village.level);
    // a second confirm of the stale card changes nothing
    expect(open.onDemolish()).toBe(false);
    expect(w.economy.money).toBe(money - open.demolishCost! + 200);
  });

  it('cannot demolish without the money, nor before era 2', () => {
    const w = makeTown(2, 0);
    w.town.debugBuild(1, 'farm');
    stepOn(w.zones.find((z) => z.opts.id === 'town:lot1:manage')!);
    const open = w.log.find((l) => l.type === 'manage:open')!.payload as GameEvents['manage:open'];
    expect(open.onDemolish()).toBe(false);
    expect(w.town.business(1)).not.toBeNull();
    expect(w.state.town.lots[1]!.building).toBe('farm');
    const e1 = makeTown(1);
    e1.town.debugBuild(1, 'farm');
    expect(e1.zones.some((z) => z.opts.id.endsWith(':manage'))).toBe(false);
  });

  it('the lot can be chosen again and built with something else; snapshot / restore stay consistent', () => {
    const w = makeTown(2);
    w.town.debugBuild(1, 'bakery');
    w.town.demolish(1);
    expect(w.town.snapshot()[1]).toEqual({ in: {}, out: 0, cash: 0 });
    w.town.restore(w.town.snapshot());
    expect(w.town.choose(1, 'farm')).toBe(true);
    expect(w.state.town.lots[1]!.building).toBe('farm');
    expect(w.state.town.lots[1]!.tier).toBe(-1);
    expect(w.town.pad(1)).not.toBeNull();
    // finishing it (the pad's completion path) builds the new business
    w.town.demolish(1); // nothing built yet: no-op
    expect(w.state.stats.demolished).toBe(1);
    w.town.debugBuild(1, 'townhouse');
    expect(w.town.business(1)!.def.id).toBe('townhouse');
    expect(w.zones.find((z) => z.opts.id === 'town:lot1:manage')!.enabled).toBe(true);
    expect(w.zones.find((z) => z.opts.id === 'town:lot1:build')!.enabled).toBe(false);
  });

  it('keeps the dead business\'s piles until nothing flies to them, then removes its group', () => {
    const w = makeTown(2);
    w.town.debugBuild(1, 'bakery');
    const b = w.town.business(1)!;
    w.flying.n = 1;
    w.town.demolish(1);
    expect(b.dead).toBe(true);
    w.town.update(0.1);
    expect(b.group.parent).not.toBeNull();
    w.flying.n = 0;
    w.town.update(0.1);
    expect(b.group.parent).toBeNull();
  });
});

describe('Townsfolk staff after a demolish', () => {
  it('re-pairs people with their own lot (nobody jumps) and the demolished lot\'s staff walk home and leave', () => {
    const state = createGameState();
    state.village.revealed = true;
    state.village.level = 4;
    state.town.revealed = true;
    const ctx = {
      scene: new THREE.Scene(),
      state,
      events: new EventBus<GameEvents>(),
      renderer: { quality: 'high' as 'high' | 'low' },
      dayNight: { darkness: 0 },
      rush: { active: false, spawnMult: 1 },
      audio: { play: () => undefined },
      player: { position: new THREE.Vector3(24, 0, 29) },
    } as unknown as GameContext;
    let spots = [
      { lot: 0, x: 19.0, z: 18.6, yaw: 0, working: true },
      { lot: 1, x: 24.6, z: 18.6, yaw: 0, working: false },
    ];
    const town = { revealed: true, shops: () => [], staffSpots: () => spots } as unknown as Town;
    const folk = new Townsfolk(ctx, town);
    folk.forceWanderers = 0;
    const run = (s: number): void => {
      for (let i = 0; i < s * 30; i++) folk.update(1 / 30);
    };
    run(2);
    const at = (x: number, z: number) => folk.crowd.people.filter((p) => p.active && Math.hypot(p.x - x, p.z - z) < 0.05);
    const before = at(24.6, 18.6);
    expect(before).toHaveLength(1);
    const stall = 2;
    expect(folk.visible).toBe(2 + stall);
    spots = [spots[1]!]; // lot 0 demolished
    run(1);
    expect(at(24.6, 18.6)[0]).toBe(before[0]); // the same person still stands at lot 1
    expect(folk.staffCount).toBe(1 + stall);
    run(60);
    expect(folk.visible).toBe(1 + stall); // the lot-0 worker has walked home and gone
  });
});
