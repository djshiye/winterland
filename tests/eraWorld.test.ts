/**
 * 0.9.0 era regions: the pure rules (frames, input caps, demolish price, choose card, settle rule) and EraWorld with a
 * fake GameContext (pads, models, workers and the BUILD tile mocked: no canvas in node): silent restore, unlock events,
 * choose → pay → build, the machine cycles, demolish, the depot, market orders and the snapshot round trip.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import type { ConstructionPad } from '../src/stations/ConstructionPad';
import { meetGate } from './gateHelpers';
import { createGameState, REGION_SLOTS, type GameContext, type GameEvents, type GameState, type Item, type ItemKind, type ManageRequest, type ChooseRequest } from '../src/core/types';
import { DEMOLISH_MIN, ERAS, MACHINES, MACHINE_IDS, MAX_ERA, machinesOfEra, type MachineId } from '../src/eras/data';
import { DOCK_FRAME, DEPOT_FRAME, INPUT_CAPACITY, INPUT_CAPACITY_MAX, OUTPUT_CAPACITY, hopperSize, chooseOptions, costText, demolishCost, inputCap, machineFrame, machineStatRows, settlePaidSlots, slotPaid, slotTarget, toWorld, worldRect, type LRect } from '../src/eras/rules';

vi.mock('../src/assets/pads', () => ({
  createPadTexture: () => ({ image: null, dispose: () => undefined }),
  formatCost: (n: number) => `$${n}`,
  createConstructionTexture: () => ({ image: null }),
  createPadModel: () => new THREE.Group(),
  createPadSign: () => new THREE.Mesh(),
  setPadSignLabel: () => undefined,
  createMatModel: () => new THREE.Group(),
  createShopSign: () => new THREE.Mesh(),
}));
vi.mock('../src/town/LotPad', () => ({
  LotPad: class {
    object = new THREE.Group();
    visible = false;
    show(): void {
      this.visible = true;
    }
    hide(): void {
      this.visible = false;
    }
    update(): void {}
  },
}));
vi.mock('../src/assets/eraMachines', () => ({
  createMachineModel: () => ({ root: new THREE.Group(), w: 4, d: 4, animate: () => undefined }),
  createDepotModel: () => new THREE.Group(),
  createDockModel: () => new THREE.Group(),
}));
vi.mock('../src/npc/EraCrew', () => ({ EraCrew: class { ids: string[] = []; reconcile(): void {} update(): void {} carried(): Record<string, never> { return {}; } dispose(): void {} } }));
vi.mock('../src/assets/marketCounter', () => ({ createMarketCounterModel: () => new THREE.Group(), COUNTER_SIZE: { length: 3.0, depth: 0.8, height: 0.95 } }));
vi.mock('../src/npc/EraBuyers', () => ({ EraBuyers: class { waiting = 0; update(): void {} unpaid(): void {} clear(): void {} } }));
vi.mock('../src/npc/EraShoppers', () => ({ EraShoppers: class { waiting = 0; update(): void {} unpaid(): void {} clear(): void {} } }));
vi.mock('../src/stations/CashPile', () => ({
  CashPile: class {
    value = 0;
    pile = { id: 'pile:cash' };
    pay(amount: number): void { this.value += amount; }
    restoreValue(v: number): void { this.value = v; }
  },
}));
vi.mock('../src/npc/Jack', () => ({ JackCart: class { sink = { id: 'jack:sink' }; update(): void {} dispose(): void {} } }));

const { EraWorld } = await import('../src/eras/EraWorld');

const overlap = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const lr = (r: LRect): { minX: number; maxX: number; minZ: number; maxZ: number } => worldRect({ x: 0, z: 0 }, 0, r);

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

describe('rules', () => {
  it('local → world matches THREE rotation.y (yaw 0, π, π/2)', () => {
    for (const yaw of [0, Math.PI, Math.PI / 2, 0.7]) {
      const g = new THREE.Group();
      g.position.set(5, 0, -3);
      g.rotation.y = yaw;
      g.updateMatrixWorld(true);
      const p = new THREE.Vector3(1.4, 0, 2.3).applyMatrix4(g.matrixWorld);
      const w = toWorld({ x: 5, z: -3 }, yaw, 1.4, 2.3);
      expect(w.x).toBeCloseTo(p.x, 6);
      expect(w.z).toBeCloseTo(p.z, 6);
    }
  });

  it('a machine cell: zones are outside the body and never overlap each other', () => {
    for (const w of [3, 3.5, 4, 4.5, 5]) {
      for (const d of [3, 3.5, 4, 4.5, 5]) {
        const f = machineFrame(w, d);
        const body = lr(f.body);
        const [feed, take, manage] = [lr(f.feed), lr(f.take), lr(f.manage)];
        expect(overlap(feed, body), `feed ${w}x${d}`).toBe(false);
        expect(overlap(take, body), `take ${w}x${d}`).toBe(false);
        expect(overlap(manage, body), `manage ${w}x${d}`).toBe(false);
        expect(overlap(feed, take)).toBe(false);
        expect(overlap(feed, manage)).toBe(false);
        expect(overlap(take, manage)).toBe(false);
        // piles and worker spots sit inside their zones' columns, in front of the body
        expect(f.inPile.v).toBeGreaterThan(d / 2);
        expect(f.feedSpot.u).toBe(f.inPile.u);
        expect(f.takeSpot.u).toBe(f.outPile.u);
      }
    }
  });

  it('the depot and dock zones are in front of their bodies; dock give / take do not overlap', () => {
    expect(overlap(lr(DEPOT_FRAME.give), lr(DEPOT_FRAME.body))).toBe(false);
    expect(overlap(lr(DOCK_FRAME.give), lr(DOCK_FRAME.body))).toBe(false);
    expect(overlap(lr(DOCK_FRAME.take), lr(DOCK_FRAME.body))).toBe(false);
    expect(overlap(lr(DOCK_FRAME.give), lr(DOCK_FRAME.take))).toBe(false);
    expect(DOCK_FRAME.grid.cols * DOCK_FRAME.grid.rows * DOCK_FRAME.grid.layers).toBe(24);
  });

  it('input caps: an even share of the hopper, never below one cycle', () => {
    expect(INPUT_CAPACITY).toBe(8);
    expect(OUTPUT_CAPACITY).toBe(12);
    expect(inputCap(MACHINES.kiln, 'stone')).toBe(8);
    expect(inputCap(MACHINES.kiln, 'brick')).toBe(0);
    expect(inputCap(MACHINES.steelMill, 'pellets')).toBe(4);
    expect(inputCap(MACHINES.steelMill, 'coke')).toBe(4);
    for (const id of MACHINE_IDS) {
      const d = MACHINES[id];
      for (const level of [0, 1, 5, 10]) {
        const sum = d.inputs.reduce((s, i) => s + inputCap(d, i.kind, level), 0);
        expect(sum, id).toBeLessThanOrEqual(hopperSize(level));
        for (const i of d.inputs) expect(inputCap(d, i.kind, level), `${id} ${i.kind}`).toBeGreaterThanOrEqual(i.per);
      }
    }
  });

  it('0.9.6: the hopper grows with the machine level, 8 at Lv 1 to 24 at Lv 10 (F3)', () => {
    expect([0, 1, 4, 7, 10].map(hopperSize)).toEqual([8, 8, 13, 19, 24]);
    expect(INPUT_CAPACITY_MAX).toBeGreaterThanOrEqual(24);
    expect(inputCap(MACHINES.kiln, 'stone', 10)).toBe(24);
    expect(inputCap(MACHINES.steelMill, 'coke', 10)).toBe(12);
    for (const id of MACHINE_IDS) for (const i of MACHINES[id].inputs) expect(inputCap(MACHINES[id], i.kind, 10)).toBeGreaterThan(inputCap(MACHINES[id], i.kind, 1));
  });

  it('demolish price = 20 % of the cash price, at least the minimum', () => {
    expect(demolishCost(MACHINES.kiln)).toBe(Math.round(MACHINES.kiln.cash * 0.2));
    for (const id of MACHINE_IDS) expect(demolishCost(MACHINES[id])).toBeGreaterThanOrEqual(DEMOLISH_MIN);
    expect(demolishCost({ ...MACHINES.quarry, cash: 100 })).toBe(DEMOLISH_MIN);
  });

  it('the choose card lists every machine of the era with its price', () => {
    expect(chooseOptions(2).map((o) => o.id)).toEqual(machinesOfEra(2));
    expect(costText(MACHINES.kiln)).toBe('$270,000 + 12 Stone');
    expect(costText(MACHINES.quarry)).toBe('$150,000');
    for (let n = 2; n <= MAX_ERA; n++) expect(chooseOptions(n).length).toBeGreaterThan(0);
  });

  it('stat rows show cycle at the current rigs and the hopper', () => {
    const rows = machineStatRows(MACHINES.kiln, 2, { input: { stone: 4 }, output: 3 });
    expect(rows.find((r) => r.label === 'Cycle')!.value).toContain(`${(MACHINES.kiln.cycle / 2).toFixed(1)} s`);
    expect(rows.find((r) => r.label === 'Hopper')!.value).toContain('4/8 Stone');
    expect(rows.find((r) => r.label === 'Output')!.value).toBe('3/12 Bricks');
  });

  it('slot target: cash + extra, never logs; a fully paid slot settles silently', () => {
    const t = slotTarget(MACHINES.kiln, 100, 3);
    expect(t.logs).toBe(0);
    expect(t.extra).toEqual({ kind: 'stone', count: 12, paid: 3 });
    expect(slotPaid(MACHINES.kiln, { cash: 270000, extra: 12 })).toBe(true);
    expect(slotPaid(MACHINES.kiln, { cash: 270000, extra: 11 })).toBe(false);
    const state = createGameState();
    state.eras.age = 2;
    state.eras.regions[2]!.unlocked = true;
    state.eras.regions[2]!.slots[0] = { machine: 'kiln', tier: -1, cash: 270000, extra: 12 };
    state.eras.regions[2]!.slots[1] = { machine: 'kiln', tier: -1, cash: 270000, extra: 3 };
    expect(settlePaidSlots(state)).toBe(1);
    expect(state.eras.regions[2]!.slots[0]).toEqual({ machine: 'kiln', tier: 0, cash: 0, extra: 0 });
    expect(state.eras.regions[2]!.slots[1]!.tier).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// EraWorld with a fake context
// ---------------------------------------------------------------------------

interface FakeZone {
  opts: { id: string; area: { minX: number; maxX: number; minZ: number; maxZ: number }; kinds?: readonly ItemKind[]; kind?: string };
  enabled: boolean;
  removed: boolean;
  setEnabled(on: boolean): void;
}

/** Prep: the Great Lodge is built (the climb is open: era 2's pad shows, locked on preview until its gate is met). */
const lodge = (s: GameState): void => void (s.village.greatLodge.tier = 0);
/** Prep: the Lodge built and era 2's gate met (every era-1 upgrade at Lv 10), so its pad takes payment. */
const gate2 = (s: GameState): void => meetGate(s, 2);

function makeWorld(age: number, villageLevel = 0, prep?: (s: GameState) => void) {
  const events = new EventBus<GameEvents>();
  const state = createGameState();
  state.eras.age = age;
  state.village.level = villageLevel;
  prep?.(state);
  const log: { type: string; payload: unknown }[] = [];
  for (const t of ['era:unlocked', 'expansion:offered', 'machine:built', 'machine:demolished', 'built', 'material:made', 'manage:open', 'manage:close', 'choose:open', 'choose:close', 'shop:open'] as const) {
    events.on(t, (payload: unknown) => void log.push({ type: t, payload }));
  }
  const zones: FakeZone[] = [];
  const makeZone = (opts: FakeZone['opts'], enabled = true): FakeZone => {
    const z: FakeZone = { opts, enabled, removed: false, setEnabled: (on) => void (z.enabled = on) };
    zones.push(z);
    return z;
  };
  const released: Item[] = [];
  let nextId = 1;
  const boxes = new Set<object>();
  const eco = { money: 0, add: (a: number) => void (eco.money += a), spend: (a: number) => (eco.money >= a ? ((eco.money -= a), true) : false) };
  const sold: { kind: ItemKind; count: number }[] = [];
  const ctx = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    events,
    state,
    time: { elapsed: 0, frame: 0 },
    addUpdatable: () => undefined,
    economy: eco,
    // 0.9.5: level pads read isMax / requirement (maxed here: no pad), belts read level (0: none)
    upgrades: { value: () => 1, level: () => 0, isMax: () => true, requirement: () => null, nextCost: () => 0, shownLevel: () => 0 },
    player: { arms: { id: 'arms', count: () => 0 }, back: {}, position: new THREE.Vector3(0, 0, 0) },
    zones: {
      add: (opts: FakeZone['opts'] & { enabled?: boolean }) => makeZone(opts, opts.enabled ?? true),
      addTransfer: (opts: FakeZone['opts'] & { enabled?: boolean }) => makeZone(opts, opts.enabled ?? true),
      remove: (z: FakeZone) => void (z.removed = true),
    },
    colliders: {
      addBox: () => {
        const h = {};
        boxes.add(h);
        return h;
      },
      remove: (h: object) => void boxes.delete(h),
    },
    tweens: { killTweensOf: () => undefined, popIn: () => undefined, run: () => ({}), punchScale: () => undefined, squash: () => undefined, delay: () => undefined },
    particles: { ring: () => undefined, puff: () => undefined, sparkle: () => undefined },
    audio: { play: () => undefined },
    items: {
      create: (kind: ItemKind): Item => ({ id: nextId++, kind, value: 0, object: new THREE.Object3D() }) as Item,
      release: (i: Item) => void released.push(i),
    },
    flights: {
      launch: (item: Item, to: { receive(i: Item, s: unknown): void }, slot: unknown) => to.receive(item, slot), // lands at once
      inFlightTo: () => 0,
    },
    market: {
      quote: () => 100,
      sellExport: (kind: ItemKind, count: number) => void sold.push({ kind, count }),
    },
  } as unknown as GameContext;
  const world = new EraWorld(ctx);
  const of = <T>(type: string): T[] => log.filter((l) => l.type === type).map((l) => l.payload as T);
  return { ctx, world, state, events, log, zones, released, boxes, eco, sold, of };
}

const run = (w: ReturnType<typeof makeWorld>, seconds: number, step = 1 / 30): void => {
  for (let t = 0; t < seconds; t += step) w.world.update(step);
};

describe('EraWorld construction', () => {
  it('a fresh game has no regions and no events; the pad of era 2 waits for the Great Lodge, not Winter City', () => {
    const w = makeWorld(1, 0);
    expect(w.world.region(2)).toBeNull();
    expect(w.log).toHaveLength(0);
    const city = makeWorld(1, 4);
    expect(city.zones.some((z) => z.opts.id.startsWith('pad:expansion:'))).toBe(false);
    const w2 = makeWorld(1, 5, lodge);
    expect(w2.zones.some((z) => z.opts.id === 'pad:expansion:2:logs')).toBe(true);
    expect(w2.log.filter((l) => l.type === 'expansion:offered')).toHaveLength(0); // restored on offer: silent
  });

  it('a restored game builds every region up to its age silently, with a runtime per region', () => {
    const w = makeWorld(3, 5, (s) => meetGate(s, 4));
    expect(w.log).toHaveLength(0);
    for (const n of [2, 3]) {
      const r = w.world.region(n)!;
      expect(r.era).toBe(n);
      expect(r.machines).toHaveLength(REGION_SLOTS[n]!);
      expect(r.dock.capacity).toBe(24);
      expect(r.depot.canAccept('stone')).toBe(true);
      expect(r.depot.canAccept('log')).toBe(false);
    }
    expect(w.world.region(4)).toBeNull();
    expect(w.state.eras.regions[2]!.unlocked).toBe(true);
    // era 4's pad is offered (age 3, its gate met)
    expect(w.zones.some((z) => z.opts.id === 'pad:expansion:4:logs')).toBe(true);
  });

  it('restores built and half-paid slots from state; a fully paid one is settled', () => {
    const w = makeWorld(2, 0, (st) => {
      const slots = st.eras.regions[2]!.slots;
      slots[0] = { machine: 'quarry', tier: 0, cash: 0, extra: 0 };
      slots[1] = { machine: 'kiln', tier: -1, cash: 50000, extra: 2 };
      slots[2] = { machine: 'kiln', tier: -1, cash: 270000, extra: 12 };
    });
    expect(w.log).toHaveLength(0);
    const r = w.world.region(2)!;
    expect(r.machines[0]!.def.id).toBe('quarry');
    expect(r.machines[1]).toBeNull();
    expect(r.machines[2]!.def.id).toBe('kiln');
    expect(w.state.stats.machinesBuilt).toBe(1);
    expect(w.state.eras.regions[2]!.slots[2]).toEqual({ machine: 'kiln', tier: 0, cash: 0, extra: 0 });
    // slot 1 shows its pad, with the partial progress; its choose zone is off (something is paid)
    expect(w.zones.some((z) => z.opts.id === 'pad:slot:2:1:logs')).toBe(true);
    expect(w.zones.find((z) => z.opts.id === 'slot:2:1:choose')!.enabled).toBe(false);
    expect(w.zones.find((z) => z.opts.id === 'slot:2:3:choose')!.enabled).toBe(true);
    expect(w.zones.find((z) => z.opts.id === 'slot:2:0:choose')!.enabled).toBe(false);
  });
});

describe('unlock', () => {
  it('emits era:unlocked for every newly opened era (also instant), raises the age, opens the next pad', () => {
    const w = makeWorld(1, 5, lodge);
    w.world.unlock(3, true);
    expect(w.of<{ era: number }>('era:unlocked').map((e) => e.era)).toEqual([2, 3]);
    expect(w.state.eras.age).toBe(3);
    expect(w.state.eras.regions[2]!.unlocked && w.state.eras.regions[3]!.unlocked).toBe(true);
    expect(w.world.region(3)).not.toBeNull();
    expect(w.zones.some((z) => z.opts.id === 'pad:expansion:4:logs')).toBe(true);
    w.world.unlock(3, true); // idempotent
    expect(w.of('era:unlocked')).toHaveLength(2);
    w.world.unlock(99);
    expect(w.state.eras.age).toBe(3);
  });

  it('pays the expansion pad: progress is kept in state, completing it opens the era', () => {
    const w = makeWorld(1, 5, gate2);
    const unlockCash = ERAS[2]!.unlock.cash;
    const extra = ERAS[2]!.unlock.extra;
    // the pad is a real ConstructionPad: reach it through its zones' holder via the world's private table
    const pad = (w.world as unknown as { pads: { payDirect(a: number): number; canAccept(k: ItemKind): boolean; reserve(i: Item): unknown; receive(i: Item, s: unknown): void }[] }).pads[2]!;
    expect(pad.payDirect(1000)).toBe(1000);
    expect(w.state.eras.regions[2]!.cash).toBe(1000);
    pad.payDirect(unlockCash - 1000);
    expect(w.world.region(2)).toBeNull(); // the extra material is still missing
    for (let i = 0; i < extra.count; i++) {
      const item = { id: i, kind: extra.kind, value: 0, object: new THREE.Object3D() } as Item;
      expect(pad.canAccept(extra.kind)).toBe(true);
      pad.receive(item, pad.reserve(item));
    }
    expect(w.world.region(2)).not.toBeNull();
    expect(w.state.eras.age).toBe(2);
    expect(w.state.eras.regions[2]!.cash).toBe(0);
    expect(w.of('era:unlocked')).toHaveLength(1);
  });

  it('at the Lodge the era-2 pad is on preview with the gate note, and turns payable once the gate is met', () => {
    const w = makeWorld(1, 5, lodge);
    const pad = (w.world as unknown as { pads: ConstructionPad[] }).pads[2]!;
    expect(pad.visible && pad.locked).toBe(true);
    expect(pad.payDirect(1000)).toBe(0);
    meetGate(w.state, 2);
    run(w, 1.1); // the one-second poll re-checks the offer
    expect(pad.locked).toBe(false);
    expect(w.of<{ era: number }>('expansion:offered').map((e) => e.era)).toEqual([2]);
    expect(pad.payDirect(1000)).toBe(1000);
  });

  it('a locked (preview) expansion pad stays shown but refuses payment until unlocked', () => {
    const w = makeWorld(1, 5, lodge);
    const extra = ERAS[2]!.unlock.extra;
    const pad = (w.world as unknown as { pads: ConstructionPad[] }).pads[2]!;
    const zone = (id: string): FakeZone => w.zones.find((z) => z.opts.id === `pad:expansion:2:${id}`)!;
    pad.setLocked('3/23 · S2/5');
    expect(pad.visible && pad.locked).toBe(true);
    expect(pad.payDirect(1000)).toBe(0);
    expect(pad.canAccept('cash') || pad.canAccept(extra.kind)).toBe(false);
    expect(zone('cash').enabled || zone('logs').enabled).toBe(false);
    expect(w.state.eras.regions[2]!.cash).toBe(0);
    pad.setLocked(null);
    expect(zone('cash').enabled && zone('logs').enabled).toBe(true);
    expect(pad.payDirect(1000)).toBe(1000);
  });
});

describe('machines', () => {
  it('0.9.6: building on the slot the player stands on steps them to the feed spot, clear of every machine (no shove over the fence)', () => {
    const r = 0.6; // about PLAYER.radius
    const hit = (x: number, z: number, b: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean => x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r;
    for (let n = 2; n <= MAX_ERA; n++) {
      const w = makeWorld(n);
      const region = w.world.region(n)!;
      const ids = machinesOfEra(n);
      for (let s = 0; s < REGION_SLOTS[n]!; s++) {
        const slot = region.layout.slots[s]!;
        w.ctx.player.position.set(slot.x, 0, slot.z); // standing on the slot's pad while it completes
        expect(w.world.build(n, s, ids[s % ids.length]!)).toBe(true);
        const m = region.machines[s]!;
        const p = w.ctx.player.position;
        expect(hit(p.x, p.z, m.body), `era ${n} slot ${s}`).toBe(false);
        expect(Math.hypot(p.x - slot.x, p.z - slot.z), `era ${n} slot ${s}`).toBeLessThan(8);
      }
      // every feed spot stays clear of all the built machines
      for (const m of region.machines) if (m) for (const o of region.machines) if (o) expect(hit(m.feedSpot.x, m.feedSpot.z, o.body), `era ${n} ${m.def.id}`).toBe(false);
    }
  });

  it('build(): false while locked, for a bad slot or another era; true builds with events and a collider', () => {
    const w = makeWorld(2);
    expect(w.world.build(3, 0, 'ironMine')).toBe(false);
    expect(w.world.build(2, 9, 'quarry')).toBe(false);
    expect(w.world.build(2, 0, 'ironMine')).toBe(false);
    expect(w.world.build(2, 0, 'quarry')).toBe(true);
    const r = w.world.region(2)!;
    expect(r.machines[0]!.def.id).toBe('quarry');
    expect(w.state.eras.regions[2]!.slots[0]).toEqual({ machine: 'quarry', tier: 0, cash: 0, extra: 0 });
    expect(w.state.stats.machinesBuilt).toBe(1);
    expect(w.of('machine:built')).toHaveLength(1);
    expect(w.of('built')).toHaveLength(0); // instant: no fanfare
    w.world.build(2, 1, 'kiln', false);
    expect(w.of('built')).toHaveLength(1);
  });

  it('an extractor makes its batch every cycle while the output has room, then waits', () => {
    const w = makeWorld(2);
    w.world.build(2, 0, 'quarry');
    const m = w.world.region(2)!.machines[0]!;
    const cyc = MACHINES.quarry.cycle;
    run(w, cyc * 0.55);
    expect(m.output.count('stone')).toBe(0);
    run(w, cyc * 0.55); // one cycle
    expect(m.output.count('stone')).toBe(1);
    expect(m.working).toBe(true);
    run(w, 60);
    expect(m.output.count('stone')).toBe(OUTPUT_CAPACITY); // full: stops
    expect(m.working).toBe(false);
    expect(w.state.stats.materialsMade).toBe(OUTPUT_CAPACITY);
    expect(w.of('material:made').length).toBe(OUTPUT_CAPACITY);
    // taking one restarts it
    m.output.take('stone');
    run(w, cyc * 1.15);
    expect(m.output.count('stone')).toBe(OUTPUT_CAPACITY);
  });

  it('Rigs divide the cycle', () => {
    const w = makeWorld(2);
    (w.ctx.upgrades as unknown as { value: (id: string) => number }).value = (id) => (id.endsWith('Rigs') ? 2 : 1);
    w.world.build(2, 0, 'quarry');
    const m = w.world.region(2)!.machines[0]!;
    run(w, MACHINES.quarry.cycle / 2 + 0.05); // half the cycle at ×2
    expect(m.output.count('stone')).toBe(1);
  });

  it('a processor consumes `per` inputs per cycle and pops its batch; it idles without inputs', () => {
    const w = makeWorld(2);
    w.world.build(2, 1, 'kiln');
    const m = w.world.region(2)!.machines[1]!;
    expect(m.input).not.toBeNull();
    run(w, 5);
    expect(m.output.count('brick')).toBe(0);
    expect(m.wants('stone')).toBe(8);
    expect(m.wants('brick')).toBe(0);
    m.input!.fill('stone', 6);
    expect(m.wants('stone')).toBe(2);
    run(w, 0.5);
    expect(m.input!.count('stone')).toBe(4); // two taken for the running cycle
    expect(m.working).toBe(true);
    run(w, MACHINES.kiln.cycle - 0.2); // one cycle
    expect(m.output.count('brick')).toBe(1);
    run(w, MACHINES.kiln.cycle * 2 + 0.6);
    expect(m.output.count('brick')).toBe(3);
    expect(m.input!.count('stone')).toBe(0);
    expect(m.working).toBe(false);
    expect(w.state.stats.materialsMade).toBe(3);
  });

  it('a multi-input processor needs every input; a reactor pops three cells per rod', () => {
    const w = makeWorld(9);
    w.world.build(9, 0, 'reactor');
    w.world.build(9, 1, 'enricher');
    const reactor = w.world.region(9)!.machines[0]!;
    reactor.input!.fill('fuelRod', 1);
    run(w, 4);
    expect(reactor.output.count('power')).toBe(3);
    const w2 = makeWorld(4);
    w2.world.build(4, 0, 'steamWorks');
    const sw = w2.world.region(4)!.machines[0]!;
    sw.input!.fill('scrap', 3);
    run(w2, 6);
    expect(sw.output.count('gear')).toBe(0); // no coal
    sw.input!.fill('coal', 1);
    run(w2, 5);
    expect(sw.output.count('gear')).toBe(1);
    expect(sw.input!.count('scrap')).toBe(2);
  });

  it('the hopper refuses kinds past their cap', () => {
    const w = makeWorld(5);
    w.world.build(5, 0, 'steelMill'); // pellets ×2 (cap 4), coke ×1 (cap 4)
    const m = w.world.region(5)!.machines[0]!;
    const it = (k: ItemKind): Item => ({ id: 1, kind: k, value: 0, object: new THREE.Object3D() }) as Item;
    for (let i = 0; i < 4; i++) m.input!.receive(it('pellets'), m.input!.reserve(it('pellets')));
    expect(m.input!.canAccept('pellets')).toBe(false);
    expect(m.input!.canAccept('coke')).toBe(true);
    expect(m.input!.canAccept('coal')).toBe(false);
    expect(m.input!.canAccept('stone')).toBe(false);
    expect(m.output.canAccept('steel')).toBe(true);
    expect(m.output.canAccept('ore')).toBe(false);
  });

  it('zones: extractors have no feed zone; processors feed in, take out (hold), info beside', () => {
    const w = makeWorld(2);
    w.world.build(2, 0, 'quarry');
    w.world.build(2, 1, 'kiln');
    const ids = w.zones.map((z) => z.opts.id);
    expect(ids).toContain('pile:era2m0Out:take');
    expect(ids).not.toContain('pile:era2m0In:feed');
    expect(ids).toContain('pile:era2m1In:feed');
    expect(w.zones.find((z) => z.opts.id === 'pile:era2m1Out:take')!.opts.kind).toBe('take');
    expect(w.zones.find((z) => z.opts.id === 'pile:era2Dock:take')!.opts.kind).toBe('take');
    expect(w.zones.find((z) => z.opts.id === 'depot:era2:give')!.opts.kinds!.length).toBeGreaterThan(10);
  });
});

describe('choose, pay, demolish', () => {
  it('an empty slot opens the choose card; choosing arms the pad; paying builds the machine', () => {
    const w = makeWorld(2);
    const choose = w.zones.find((z) => z.opts.id === 'slot:2:0:choose')!;
    expect(choose.enabled).toBe(true);
    // entering the zone
    const onEnter = (choose.opts as unknown as { onEnter(): void }).onEnter;
    onEnter();
    const req = w.of<ChooseRequest>('choose:open')[0]!;
    expect(req.key).toBe('slot:2:0');
    expect(req.options.map((o) => o.id)).toEqual(machinesOfEra(2));
    expect(req.onChoose('ironMine')).toBe(false); // another era
    expect(req.onChoose('kiln')).toBe(true);
    const st = w.state.eras.regions[2]!.slots[0]!;
    expect(st).toEqual({ machine: 'kiln', tier: -1, cash: 0, extra: 0 });
    expect(choose.enabled).toBe(true); // nothing paid yet: can change
    expect(req.onChoose('quarry')).toBe(true);
    expect(st.machine).toBe('quarry');
    // pay: the slot's pad is a real ConstructionPad
    type P = { payDirect(a: number): number };
    const pad = (w.world.region(2) as unknown as { slots: { pad: P }[] }).slots[0]!.pad;
    pad.payDirect(5000);
    expect(st.cash).toBe(5000);
    expect(choose.enabled).toBe(false); // first payment closes the card
    expect(req.onChoose('kiln')).toBe(false); // can't change once paid
    pad.payDirect(MACHINES.quarry.cash);
    expect(st.tier).toBe(0);
    expect(st.cash).toBe(0);
    expect(w.world.region(2)!.machines[0]!.def.id).toBe('quarry');
    expect(w.state.stats.machinesBuilt).toBe(1);
    expect(w.of('machine:built')).toHaveLength(1);
    expect(w.of('built')).toHaveLength(1); // live: fanfare
  });

  it('the info zone opens a manage card with the demolish price; demolishing clears everything', () => {
    const w = makeWorld(2);
    w.world.build(2, 1, 'kiln');
    const r = w.world.region(2)!;
    const m = r.machines[1]!;
    m.input!.fill('stone', 4);
    m.output.fill('brick', 2);
    const manage = w.zones.find((z) => z.opts.id === 'pile:era2m1:manage')!;
    (manage.opts as unknown as { onEnter(): void }).onEnter();
    const req = w.of<ManageRequest>('manage:open')[0]!;
    expect(req.key).toBe('slot:2:1');
    expect(req.title).toBe('Brick Kiln');
    expect(req.demolishCost).toBe(demolishCost(MACHINES.kiln));
    expect(req.stats!.length).toBeGreaterThan(3);
    // too poor
    w.eco.money = req.demolishCost! - 1;
    expect(req.onDemolish()).toBe(false);
    expect(r.machines[1]).toBe(m);
    // pays
    w.eco.money = req.demolishCost! + 7;
    const releasedBefore = w.released.length;
    expect(req.onDemolish()).toBe(true);
    expect(w.eco.money).toBe(7);
    expect(r.machines[1]).toBeNull();
    expect(w.state.eras.regions[2]!.slots[1]).toEqual({ machine: '', tier: -1, cash: 0, extra: 0 });
    expect(w.state.stats.demolished).toBe(1);
    expect(w.of('machine:demolished')).toHaveLength(1);
    expect(w.released.length - releasedBefore).toBe(6); // the 4 + 2 piled items went back to the pool
    expect(w.zones.filter((z) => z.opts.id.startsWith('pile:era2m1') && !z.removed)).toHaveLength(0);
    expect(w.boxes.size).toBe(5); // depot, import dock, hand node, loading dock and market stall colliders remain, the kiln's is gone
    expect(w.zones.find((z) => z.opts.id === 'slot:2:1:choose')!.enabled).toBe(true); // the slot is open again
    expect(req.onDemolish()).toBe(false); // already gone
    // a new machine can be chosen and built there
    expect(w.world.build(2, 1, 'quarry')).toBe(true);
  });

  it('switching the choice to a machine with another extra material gives the pad a zone for that material', () => {
    const w = makeWorld(2);
    const r = w.world.region(2) as unknown as { choose(i: number, id: string): boolean };
    expect(r.choose(0, 'quarry')).toBe(true);
    expect(r.choose(0, 'kiln')).toBe(true);
    const live = w.zones.filter((z) => z.opts.id === 'pad:slot:2:0:logs' && z.enabled);
    expect(live).toHaveLength(1);
    expect(live[0]!.opts.kinds).toEqual(['stone']);
    // back to the quarry: the first pad is reused, no zone pulls stone any more
    expect(r.choose(0, 'quarry')).toBe(true);
    expect(w.zones.filter((z) => z.opts.id === 'pad:slot:2:0:logs')).toHaveLength(2);
    expect(w.zones.some((z) => z.opts.id === 'pad:slot:2:0:logs' && z.enabled)).toBe(false);
  });
});

describe('depot, dock, orders', () => {
  it('0.9.5: the depot hands goods to the market (refined to the stall, raw to the dock, then the other), then sells at once', () => {
    const w = makeWorld(2);
    const r = w.world.region(2)!;
    const give = (id: number, kind: ItemKind): Item => {
      const item = { id, kind, value: 0, object: new THREE.Object3D() } as Item;
      r.depot.receive(item, r.depot.reserve(item));
      return item;
    };
    // raw stone goes to the loading dock, refined brick to the market stall (TRADE_POST.room each at ×1)
    for (let i = 0; i < 3; i++) give(300 + i, 'stone');
    expect(r.market.dockPile.count('stone')).toBe(3);
    for (let i = 0; i < 14; i++) give(100 + i, 'brick');
    expect(r.market.stallPile.count('brick')).toBe(14);
    // stall full: bricks spill onto the dock until that is full too
    for (let i = 0; i < 11; i++) give(150 + i, 'brick');
    expect(r.market.dockPile.count('brick')).toBe(11);
    expect(w.sold).toEqual([]);
    // both full: the depot sells the rest at once, as before 0.9.5
    const item = give(5, 'brick');
    expect(w.sold).toEqual([{ kind: 'brick', count: 1 }]);
    expect(w.released).toContain(item);
    expect(r.depot.count('brick')).toBe(0);
    expect(r.depot.take()).toBeNull();
  });

  it('0.9.5: the market counters and cash are saved and restored; older saves start empty', () => {
    const w = makeWorld(2);
    const r = w.world.region(2)!;
    for (let i = 0; i < 6; i++) {
      const item = { id: 200 + i, kind: i < 4 ? 'brick' : 'stone', value: 0, object: new THREE.Object3D() } as Item;
      r.depot.receive(item, r.depot.reserve(item));
    }
    (r.market.cash as unknown as { value: number }).value = 750;
    const snap = w.world.snapshot();
    expect(snap[2]!.market).toEqual({ dock: { stone: 2 }, stall: { brick: 4 }, cash: 750 });
    const w2 = makeWorld(2);
    w2.world.restore(snap);
    const r2 = w2.world.region(2)!;
    expect(r2.market.stallPile.count('brick')).toBe(4);
    expect(r2.market.dockPile.count('stone')).toBe(2);
    expect((r2.market.cash as unknown as { value: number }).value).toBe(750);
    expect(w2.eco.money).toBe(0);
    // an older save has no market entry: empty counters
    const w3 = makeWorld(2);
    w3.world.restore(snap.map((e) => ({ slots: e.slots, dock: e.dock })));
    expect(w3.world.region(2)!.market.stallPile.total).toBe(0);
    expect(w3.world.region(2)!.market.dockPile.total).toBe(0);
  });

  it('a market order lands on the dock; what does not fit is refunded at what it cost', () => {
    const w = makeWorld(2);
    const r = w.world.region(2)!;
    w.events.emit('market:order', { kind: 'stone', count: 20, era: 2, amount: 2640 });
    expect(r.dock.count('stone')).toBe(20);
    expect(w.eco.money).toBe(0);
    // 132 a unit (delivery, Trade and season included): the 6 that do not fit come back at that price
    w.events.emit('market:order', { kind: 'stone', count: 10, era: 2, amount: 1320 });
    expect(r.dock.count('stone')).toBe(24);
    expect(w.eco.money).toBe(6 * 132);
    // an order for a closed region comes back in full
    w.events.emit('market:order', { kind: 'ore', count: 3, era: 3, amount: 396 });
    expect(w.eco.money).toBe(6 * 132 + 396);
  });

  it("the shop mat opens the era's own shop on its Crew tab (0.9.5)", () => {
    const w = makeWorld(2);
    const mat = w.zones.find((z) => z.opts.id === 'shop:mat:era2')!;
    (mat.opts as unknown as { onEnter(): void }).onEnter();
    expect(w.of<{ tab?: string; era?: number }>('shop:open')[0]).toEqual({ tab: 'crew', era: 2 });
  });
});

describe('snapshot / restore', () => {
  it('has the REGION_SLOTS shape even when everything is locked', () => {
    const w = makeWorld(1);
    const s = w.world.snapshot();
    expect(s).toHaveLength(REGION_SLOTS.length);
    s.forEach((e, n) => {
      expect(e.slots).toHaveLength(REGION_SLOTS[n]!);
      expect(e.dock).toEqual({});
    });
  });

  it('round-trips machine piles and the dock; the crew-carried goods are added to the dock', () => {
    const w = makeWorld(2);
    w.world.build(2, 0, 'quarry');
    w.world.build(2, 1, 'kiln');
    const r = w.world.region(2)!;
    r.machines[0]!.output.fill('stone', 5);
    r.machines[1]!.input!.fill('stone', 3);
    r.machines[1]!.output.fill('brick', 2);
    r.dock.fill('stone', 4);
    r.dock.fill('brick', 1);
    const snap = w.world.snapshot();
    expect(snap[2]!.slots[0]).toEqual({ in: {}, out: 5 });
    expect(snap[2]!.slots[1]).toEqual({ in: { stone: 3 }, out: 2 });
    expect(snap[2]!.dock).toEqual({ stone: 4, brick: 1 });

    const w2 = makeWorld(2);
    w2.world.build(2, 0, 'quarry');
    w2.world.build(2, 1, 'kiln');
    w2.world.restore(snap);
    expect(w2.world.snapshot()).toEqual(snap);
    // over-full saves are capped
    const big = JSON.parse(JSON.stringify(snap)) as typeof snap;
    big[2]!.slots[0]!.out = 99;
    big[2]!.slots[1]!.in = { stone: 99 };
    big[2]!.dock = { stone: 99 };
    w2.world.restore(big);
    const again = w2.world.snapshot();
    expect(again[2]!.slots[0]!.out).toBe(OUTPUT_CAPACITY);
    expect(again[2]!.slots[1]!.in.stone).toBe(8);
    expect(again[2]!.dock.stone).toBe(24);
  });

  it('a mid-cycle save with a full hopper round-trips: the running cycle resumes and makes its batch', () => {
    const w = makeWorld(2);
    w.world.build(2, 1, 'kiln');
    const m = w.world.region(2)!.machines[1]!;
    m.input!.fill('stone', 4);
    run(w, 0.5); // cycle started: 2 stone taken
    m.input!.fill('stone', 6); // refilled to the cap (8) during the cycle
    const snap = w.world.snapshot();
    expect(snap[2]!.slots[1]!.in.stone).toBe(10);
    const w2 = makeWorld(2);
    w2.world.build(2, 1, 'kiln');
    w2.world.restore(snap);
    const m2 = w2.world.region(2)!.machines[1]!;
    expect(m2.input!.count('stone')).toBe(8);
    expect(w2.world.snapshot()).toEqual(snap); // nothing lost, idempotent
    run(w2, MACHINES.kiln.cycle + 0.2); // Rigs 1
    expect(m2.output.count('brick')).toBe(MACHINES.kiln.batch);
  });

  it('0.9.6: a hopper saved with an input its recipe no longer uses hands it to the import dock', () => {
    const w = makeWorld(5);
    w.world.build(5, 0, 'steelMill');
    const snap = w.world.snapshot();
    snap[5]!.slots[0] = { in: { ore: 3, coke: 2 }, out: 0 }; // 0.9.5: ore + 2 coal → steel
    w.world.restore(snap);
    const r = w.world.region(5)!;
    expect(r.machines[0]!.input!.count('coke')).toBe(2);
    expect(r.dock.count('ore')).toBe(3);
  });

  it('dock goods that no longer fit on restore are credited at the sell quote', () => {
    const w = makeWorld(2);
    const snap = w.world.snapshot();
    snap[2]!.dock = { stone: 24, brick: 6 }; // a full dock + a worker's load
    w.world.restore(snap);
    expect(w.world.region(2)!.dock.count('stone')).toBe(24);
    expect(w.eco.money).toBe(6 * 100);
  });

  it('materials still flying to the depot or Jack are saved on the dock (not sold yet)', () => {
    const w = makeWorld(2);
    const r = w.world.region(2)! as unknown as { depot: object; jack: { sink: object } };
    (w.ctx.flights as unknown as { inFlightTo(h: object, k?: ItemKind): number }).inFlightTo = (h, k) => (h === r.depot && k === 'brick' ? 2 : h === r.jack.sink && k === 'stone' ? 1 : 0);
    expect(w.world.snapshot()[2]!.dock).toEqual({ stone: 1, brick: 2 });
  });

  it('a save made mid-cycle keeps the inputs of the running cycle', () => {
    const w = makeWorld(2);
    w.world.build(2, 1, 'kiln');
    const m = w.world.region(2)!.machines[1]!;
    m.input!.fill('stone', 4);
    run(w, 0.5); // cycle started: 2 stone taken
    expect(m.input!.count('stone')).toBe(2);
    expect((m as unknown as { snapshot(): { in: { stone: number } } }).snapshot().in.stone).toBe(4);
  });
});

describe('data sanity for the world', () => {
  it('every machine of every era is buildable somewhere (era numbers line up)', () => {
    for (const id of MACHINE_IDS) {
      const d = MACHINES[id as MachineId];
      expect(ERAS[d.era]).toBeTruthy();
    }
  });
});
