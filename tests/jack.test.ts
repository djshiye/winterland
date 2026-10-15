/** 0.9.0 Jack of all trades: offers, the sink, the zone delay / interval, visibility gating, dispose and the yard spot. */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { LAYOUT, TIMING, UPGRADES, type Rect } from '../src/config';
import { EventBus } from '../src/core/EventBus';
import { Market } from '../src/core/Market';
import { createGameState, type GameContext, type GameEvents, type Item, type ItemHolder, type ItemKind } from '../src/core/types';
import { Upgrades } from '../src/core/Upgrades';
import { JACK } from '../src/eras/data';
import { ZoneSystem } from '../src/items/Zones';
import { JACK_KINDS, JackCart, JackSink, jackColliderRect, jackInterval, jackZoneRect } from '../src/npc/Jack';
import { ColliderWorld } from '../src/world/Colliders';

const YARD_YAW = Math.PI / 2;
const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
/** Shortest distance between two rectangles (0 when they touch / overlap). */
const gap = (a: Rect, b: Rect): number => Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ));
const rectAround = (x: number, z: number, hw: number, hd: number): Rect => ({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd });

/** The player's arms: a list of items with the ItemHolder surface the zone needs. */
function arms(kinds: ItemKind[], scene: THREE.Scene): ItemHolder & { items: Item[] } {
  const items: Item[] = kinds.map((kind, id) => {
    const object = new THREE.Object3D();
    scene.add(object);
    return { id, kind, object, value: 0 };
  });
  const h = {
    id: 'player.arms',
    items,
    canAccept: () => true,
    reserve: () => ({ holder: h }),
    getSlotWorldPosition: (_s: unknown, out: THREE.Vector3) => out,
    getSlotWorldQuaternion: (_s: unknown, out: THREE.Quaternion) => out,
    receive: () => {},
    cancel: () => {},
    count: (k?: ItemKind) => (k ? items.filter((i) => i.kind === k).length : items.length),
    take: (k?: ItemKind) => {
      const i = items.findLastIndex((it) => !k || it.kind === k);
      return i < 0 ? null : items.splice(i, 1)[0]!;
    },
  };
  return h as unknown as ItemHolder & { items: Item[] };
}

function world(carried: ItemKind[] = []) {
  const state = createGameState();
  const events = new EventBus<GameEvents>();
  const scene = new THREE.Scene();
  const economy = {
    money: 0,
    add(v: number) {
      this.money += v;
    },
  };
  const sales: Array<{ kind: ItemKind; amount: number }> = [];
  events.on('sale', (e) => sales.push({ kind: e.kind, amount: e.amount }));
  const released: Item[] = [];
  const player = { position: new THREE.Vector3(0, 0, 0), arms: arms(carried, scene) };
  const ctx = {
    state,
    events,
    scene,
    economy,
    colliders: new ColliderWorld(),
    items: { release: (it: Item) => released.push(it) },
    particles: { burst: vi.fn() },
    audio: { play: vi.fn() },
    time: { elapsed: 0, frame: 0 },
    player,
    // goods land at once (the real flight takes 0.15 s)
    flights: { launch: (item: Item, to: ItemHolder, slot: never) => to.receive(item, slot) },
  } as unknown as GameContext & { economy: typeof economy };
  (ctx as unknown as { upgrades: Upgrades }).upgrades = new Upgrades(state, economy as never, events);
  (ctx as unknown as { market: Market }).market = new Market(ctx);
  const zones = new ZoneSystem(ctx);
  (ctx as unknown as { zones: ZoneSystem }).zones = zones;
  return { ctx, state, scene, economy, sales, released, player, zones };
}

type World = ReturnType<typeof world>;

/** Step the zones + the cart for `seconds` at 60 Hz. */
function run(w: World, cart: JackCart, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    w.zones.update(1 / 60);
    cart.update(1 / 60);
    w.ctx.time.elapsed += 1 / 60;
  }
}

/** Put the player in the middle of the cart's swap zone. */
function standInZone(w: World, cart: JackCart): void {
  const a = cart.zoneArea;
  w.player.position.set((a.minX + a.maxX) / 2, 0, (a.minZ + a.maxZ) / 2);
}

describe('Jack offers', () => {
  it('scale with the upgrade from 30% to 75% of the unit value', () => {
    const w = world();
    const m = w.ctx.market;
    const values = UPGRADES.jack.values;
    expect(values[0]).toBe(0.3);
    expect(values[values.length - 1]).toBe(0.75);
    let prev = 0;
    for (let lvl = 0; lvl < values.length; lvl++) {
      w.state.upgrades.jack = lvl;
      expect(w.ctx.upgrades.value('jack')).toBe(values[lvl]);
      for (const kind of JACK_KINDS) {
        expect(m.jackOffer(kind)).toBe(Math.max(1, Math.round(m.unitValue(kind) * values[lvl]!)));
      }
      const log = m.jackOffer('log');
      expect(log).toBeGreaterThanOrEqual(prev);
      prev = log;
    }
    w.state.upgrades.jack = 0;
    expect(m.jackOffer('crate')).toBeCloseTo(m.unitValue('crate') * 0.3, -1);
    w.state.upgrades.jack = values.length - 1;
    expect(m.jackOffer('crate')).toBeCloseTo(m.unitValue('crate') * 0.75, -1);
  });

  it('refuses cash and never pays less than $1 for anything else', () => {
    const w = world();
    expect(w.ctx.market.jackOffer('cash')).toBe(0);
    for (const kind of JACK_KINDS) expect(w.ctx.market.jackOffer(kind)).toBeGreaterThanOrEqual(1);
  });

  it('is never worth carrying a thing for more than it is worth (a discard, not an arbitrage)', () => {
    const w = world();
    w.state.upgrades.jack = UPGRADES.jack.values.length - 1;
    for (const kind of JACK_KINDS) expect(w.ctx.market.jackOffer(kind)).toBeLessThanOrEqual(Math.max(1, w.ctx.market.unitValue(kind)));
  });
});

describe('JackSink', () => {
  const make = () => {
    const w = world();
    const sink = new JackSink(w.ctx, 'jack:test', () => new THREE.Vector3(1, 1, 1));
    return { w, sink };
  };
  const item = (kind: ItemKind): Item => ({ id: 1, kind, object: new THREE.Object3D(), value: 0 });

  it('accepts every carry kind but cash, and nothing once disposed', () => {
    const { sink } = make();
    for (const kind of JACK_KINDS) expect(sink.canAccept(kind)).toBe(true);
    expect(sink.canAccept('cash')).toBe(false);
    expect(JACK_KINDS).not.toContain('cash');
    sink.disposed = true;
    expect(sink.canAccept('log')).toBe(false);
  });

  it('only pays on receive; reserve and cancel pay nothing and keep the in-flight count honest', () => {
    const { w, sink } = make();
    const a = item('log');
    const b = item('crate');
    const sa = sink.reserve(a);
    const sb = sink.reserve(b);
    expect(sink.pending).toBe(2);
    expect(w.economy.money).toBe(0);
    sink.cancel(sb);
    expect(sink.pending).toBe(1);
    expect(w.economy.money).toBe(0);
    expect(w.released).toHaveLength(0);
    sink.receive(a, sa);
    expect(sink.pending).toBe(0);
    expect(w.economy.money).toBe(w.ctx.market.jackOffer('log'));
    expect(w.state.stats.jackEarned).toBe(w.ctx.market.jackOffer('log'));
    expect(w.released).toEqual([a]);
    expect(w.sales).toEqual([{ kind: 'log', amount: w.ctx.market.jackOffer('log') }]);
  });

  it('holds nothing', () => {
    const { sink } = make();
    expect(sink.count()).toBe(0);
    expect(sink.take()).toBeNull();
  });
});

describe('JackCart zone', () => {
  const make = (carried: ItemKind[], id = 'jack:yard', flag = true) => {
    const w = world(carried);
    w.state.flags.shopRevealed = flag;
    const cart = new JackCart(w.ctx, JACK.yard, YARD_YAW, id);
    return { w, cart };
  };

  it('pays nothing before JACK.delay, then buys the carried goods one by one', () => {
    const { w, cart } = make(['log', 'log', 'log']);
    standInZone(w, cart);
    run(w, cart, JACK.delay - 0.1);
    expect(w.economy.money).toBe(0);
    expect(w.player.arms.count()).toBe(3);
    run(w, cart, 0.3);
    expect(w.economy.money).toBeGreaterThan(0);
    run(w, cart, 2);
    expect(w.player.arms.count()).toBe(0);
    expect(w.economy.money).toBe(3 * w.ctx.market.jackOffer('log'));
    expect(w.released).toHaveLength(3);
    cart.dispose();
  });

  it('never discards while the player only passes by (leaving resets the delay)', () => {
    const { w, cart } = make(['log', 'log']);
    for (let pass = 0; pass < 3; pass++) {
      standInZone(w, cart);
      run(w, cart, JACK.delay - 0.2);
      w.player.position.set(0, 0, 0);
      run(w, cart, 0.1);
    }
    expect(w.economy.money).toBe(0);
    expect(w.player.arms.count()).toBe(2);
    cart.dispose();
  });

  it('takes any mix of carried goods, cash never moves', () => {
    const { w, cart } = make(['log', 'crate', 'furniture', 'wheat', 'meat', 'toy', 'stone']);
    standInZone(w, cart);
    run(w, cart, 4);
    expect(w.player.arms.count()).toBe(0);
    expect(w.sales.map((s) => s.kind).sort()).toEqual(['crate', 'furniture', 'log', 'meat', 'stone', 'toy', 'wheat']);
    cart.dispose();
  });

  it('the interval shrinks with the jack upgrade', () => {
    const values = UPGRADES.jack.values;
    expect(jackInterval(values[0]!)).toBeCloseTo(JACK.interval, 6);
    let prev = Infinity;
    for (const v of values) {
      const i = jackInterval(v);
      expect(i).toBeLessThanOrEqual(prev);
      expect(i).toBeGreaterThanOrEqual(TIMING.minInterval);
      prev = i;
    }
    expect(jackInterval(values[values.length - 1]!)).toBeLessThan(JACK.interval / 2);

    const sold = (level: number): number => {
      const { w, cart } = make(Array<ItemKind>(80).fill('log'));
      w.state.upgrades.jack = level;
      standInZone(w, cart);
      run(w, cart, JACK.delay + 1.2);
      const n = w.sales.length;
      cart.dispose();
      return n;
    };
    expect(sold(values.length - 1)).toBeGreaterThan(sold(0));
  });

  it('the yard cart stays shut (hidden, no zone, no collider) until the shop is revealed', () => {
    const { w, cart } = make(['log'], 'jack:yard', false);
    expect(cart.object.visible).toBe(false);
    expect(cart.open).toBe(false);
    standInZone(w, cart);
    run(w, cart, JACK.delay + 1);
    expect(w.economy.money).toBe(0);
    const c = rectAround((cart.blockArea.minX + cart.blockArea.maxX) / 2, (cart.blockArea.minZ + cart.blockArea.maxZ) / 2, 0, 0);
    const probe = new THREE.Vector3(c.minX, 0, c.minZ);
    w.ctx.colliders.resolveCircle(probe, 0.3);
    expect(probe.x).toBeCloseTo(c.minX, 6);

    w.state.flags.shopRevealed = true;
    run(w, cart, JACK.delay + 1);
    expect(cart.object.visible).toBe(true);
    expect(cart.open).toBe(true);
    expect(w.economy.money).toBeGreaterThan(0);
    w.ctx.colliders.resolveCircle(probe, 0.3);
    expect(probe.x).not.toBeCloseTo(c.minX, 3);
    cart.dispose();
  });

  it('a region cart is open at once', () => {
    const { w, cart } = make(['log'], 'jack:era2', false);
    expect(cart.object.visible).toBe(true);
    standInZone(w, cart);
    run(w, cart, JACK.delay + 0.5);
    expect(w.economy.money).toBeGreaterThan(0);
    cart.dispose();
  });

  it('dispose removes the model, the zone and the collider', () => {
    const { w, cart } = make(['log', 'log']);
    expect(cart.object.parent).toBe(w.scene);
    const probe = new THREE.Vector3((cart.blockArea.minX + cart.blockArea.maxX) / 2, 0, (cart.blockArea.minZ + cart.blockArea.maxZ) / 2);
    cart.dispose();
    expect(cart.object.parent).toBeNull();
    standInZone(w, cart);
    run(w, cart, JACK.delay + 1);
    expect(w.economy.money).toBe(0);
    const before = probe.clone();
    w.ctx.colliders.resolveCircle(probe, 0.3);
    expect(probe.distanceTo(before)).toBeLessThan(1e-9);
    cart.dispose(); // idempotent
  });
});

describe('Jack in the yard', () => {
  const zone = jackZoneRect(JACK.yard, YARD_YAW);
  const block = jackColliderRect(JACK.yard, YARD_YAW);

  it('the zone sits in front of the counter (+X) and the solid cart inside the walkable yard', () => {
    expect(zone.minX).toBeGreaterThan(block.maxX - 0.7);
    expect(zone.maxX - zone.minX).toBeCloseTo(1.4, 6);
    expect(zone.maxZ - zone.minZ).toBeCloseTo(2, 6);
    expect(block.minX).toBeGreaterThanOrEqual(LAYOUT.yard.minX);
    expect(block.minZ).toBeGreaterThanOrEqual(LAYOUT.yard.minZ);
    expect(block.maxZ).toBeLessThanOrEqual(LAYOUT.yard.maxZ);
  });

  it('keeps the zone 1.5 m away from the routes and the cart off every station', () => {
    const L = LAYOUT;
    const belt = (p: { x: number; z: number }[], width: number): Rect => ({
      minX: Math.min(...p.map((q) => q.x)) - width / 2,
      maxX: Math.max(...p.map((q) => q.x)) + width / 2,
      minZ: Math.min(...p.map((q) => q.z)) - width / 2,
      maxZ: Math.max(...p.map((q) => q.z)) + width / 2,
    });
    const routes: Record<string, Rect> = {
      westConveyor: belt(L.westConveyor.path, L.westConveyor.width),
      eastConveyor: belt(L.eastConveyor.path, L.eastConveyor.width),
      dropZone: L.dropZone.zone,
      counterZone: L.walkInCounter.playerZone,
      cashZone: L.walkInCash.zone,
      chopZone: L.chopZone,
      harvester: L.harvester.collider,
      customerPath: L.customers.path,
      cabin: L.cabin,
      shopMat: L.shop.mat,
    };
    for (const [name, r] of Object.entries(routes)) {
      expect(gap(zone, r), `zone vs ${name}`).toBeGreaterThanOrEqual(1.5);
    }
    // the harvester rail runs along the river bank, north of the cart
    expect(L.harvester.collider.maxZ).toBeLessThan(block.minZ - 1);
    for (const [name, r] of Object.entries(routes)) expect(overlap(block, r), `cart vs ${name}`).toBe(false);
    // the walking line from the drop zone to the walk-in counter
    const a = { x: L.dropZone.x, z: L.dropZone.zone.maxZ };
    const b = { x: L.walkInCounter.x, z: L.walkInCounter.playerZone.minZ };
    let best = Infinity;
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      best = Math.min(best, gap(zone, { minX: px, maxX: px, minZ: pz, maxZ: pz }));
    }
    expect(best, 'zone vs drop-zone -> counter line').toBeGreaterThanOrEqual(1.5);
    // the village gate corridor at the south fence
    expect(overlap(zone, { minX: 3.4, maxX: 5.8, minZ: 9.5, maxZ: 11 })).toBe(false);
  });
});
