/**
 * 1.0 the era foreman delivers its district's material to chosen city lots (npc/EraWorker.ts lotJob, city/lotAccess.ts,
 * District.sitePad): the pure job choice (region sites first, full loads, peers' claims), the lot needs read from the
 * state, a silent on-demand pad, no double count of an item in flight, and a whole trip with a real worker walking out
 * of the gate, along the roads, to the lot and back. Fake contexts, no WebGL.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { createGameState, type GameContext, type GameEvents, type GameState, type Item, type ItemHolder, type ItemKind, type Slot } from '../src/core/types';
import { CITY_BUILDINGS, DISTRICT_MATERIAL, ROADS, districtDef, type CityBuildingId } from '../src/eras/data';
import { regionLayout } from '../src/eras/layout';
import { NO_CLAIMS, lotDest, lotDestId, pickJob, siteDest, type JobMachine, type JobView } from '../src/npc/EraWorker';
import { cityLotAccess, lotNeeds, registerCityLots } from '../src/city/lotAccess';
import { inRect, lotStandSpot } from '../src/city/roadRoute';
import { districtLots } from '../src/city/rules';

// canvas textures (glow halos, signs) draw into a 2D context nobody looks at here
const noop: unknown = new Proxy(() => noop, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop), apply: () => noop });
vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });

const { District } = await import('../src/city/District');
const { City } = await import('../src/city/City');
const { EraWorker } = await import('../src/npc/EraWorker');

const HOME: CityBuildingId = 'frontierHome';
const BRICK = DISTRICT_MATERIAL[2]!;

// ---------------------------------------------------------------------------
// pure job choice
// ---------------------------------------------------------------------------

const kilnPile = (outCount: number): JobMachine => ({
  slot: 1,
  extractor: false,
  inputs: [{ kind: 'stone', per: 2, room: 0, stock: 4 }],
  output: BRICK,
  outCount,
  outFull: false,
  feed: { x: 9, z: 80 },
  take: { x: 11, z: 80 },
});
const view = (over: Partial<JobView>): JobView => ({
  machines: [kilnPile(10)],
  dock: {},
  dockSpot: { x: 4.5, z: 70 },
  depotSpot: { x: -1.5, z: 70 },
  depotAccepts: () => true,
  dockAccepts: () => true,
  ...over,
});
const AT = { x: 0, z: 72 };
const lotSite = (slot: number, room: number) => ({ slot, kind: BRICK, room, spot: lotStandSpot(2, slot).spot });

describe('pickJob: the foreman and the city lots', () => {
  it('serves the region construction sites first, then the district lots', () => {
    const site = { slot: 3, kind: BRICK, room: 4, spot: { x: 5, z: 90 } };
    expect(pickJob(view({ sites: [site], lots: [lotSite(0, 15)] }), 6, NO_CLAIMS, AT, false, undefined, 'foreman')).toMatchObject({ to: siteDest(3), take: 4 });
    expect(pickJob(view({ sites: [], lots: [lotSite(0, 15)] }), 6, NO_CLAIMS, AT, false, undefined, 'foreman')).toEqual({
      type: 'build',
      item: BRICK,
      take: 6,
      from: 1,
      to: lotDest(0),
    });
  });

  it('takes from the import dock too, and never more than the lot still needs', () => {
    const v = view({ machines: [], dock: { [BRICK]: 9 }, lots: [lotSite(2, 3)] });
    expect(pickJob(v, 6, NO_CLAIMS, AT, false, undefined, 'foreman')).toMatchObject({ from: 'dock', to: lotDest(2), take: 3 });
  });

  it('waits for a full load for the long walk unless it has been idle a while', () => {
    const v = view({ machines: [kilnPile(2)], lots: [lotSite(0, 15)] });
    expect(pickJob(v, 6, NO_CLAIMS, AT, false, undefined, 'foreman')).toBeNull();
    expect(pickJob(v, 6, NO_CLAIMS, AT, true, undefined, 'foreman')).toMatchObject({ take: 2, to: lotDest(0) });
  });

  it("does not bring what a peer already carries to the same lot", () => {
    const claims = { sources: new Map<string, number>(), dests: new Map([[lotDestId(0, BRICK), 6]]) };
    const v = view({ lots: [lotSite(0, 6), lotSite(1, 6)] });
    expect(pickJob(v, 6, claims, AT, false, undefined, 'foreman')).toMatchObject({ to: lotDest(1) });
  });

  it('other roles never take lot jobs; no lots, no job', () => {
    const v = view({ lots: [lotSite(0, 15)] });
    for (const role of ['hauler', 'feeder', 'porter', 'gatherer', 'clerk'] as const) {
      const job = pickJob(v, 6, NO_CLAIMS, AT, true, undefined, role);
      expect(job?.to).not.toBe(lotDest(0));
    }
    expect(pickJob(view({}), 6, NO_CLAIMS, AT, true, undefined, 'foreman')).toBeNull();
  });
});

describe('lotNeeds', () => {
  it('chosen, unbuilt lots of the district with material still missing (in flight counted as paid)', () => {
    const st = createGameState();
    st.eras.age = 2;
    const count = CITY_BUILDINGS[HOME].extra.count;
    st.city.districts[2]!.lots[0] = { building: HOME, tier: -1, cash: 0, extra: 0 };
    st.city.districts[2]!.lots[1] = { building: HOME, tier: -1, cash: 500, extra: count - 2 };
    st.city.districts[2]!.lots[2] = { building: HOME, tier: 0, cash: 0, extra: 0 };
    st.city.districts[2]!.lots[3] = { building: HOME, tier: -1, cash: 0, extra: count };
    expect(lotNeeds(st, 2)).toEqual([
      { lot: 0, kind: BRICK, room: count },
      { lot: 1, kind: BRICK, room: 2 },
    ]);
    expect(lotNeeds(st, 3)).toEqual([]);
    st.eras.age = 1;
    expect(lotNeeds(st, 2)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// the district pad
// ---------------------------------------------------------------------------

function makeCtx(state: GameState) {
  const events = new EventBus<GameEvents>();
  const ctx = {
    scene: new THREE.Scene(),
    state,
    events,
    addUpdatable: () => undefined,
    time: { elapsed: 0 },
    camera: new THREE.PerspectiveCamera(),
    player: { position: new THREE.Vector3(), arms: { count: () => 0 }, back: {} },
    economy: { money: 1e9, spend: () => true, add: () => undefined },
    upgrades: { value: () => 1, level: () => 1, crewStats: () => ({ walk: 1, capacity: 1, cadence: 1 }) },
    colliders: { addBounds: () => undefined, addBox: () => ({}), remove: () => undefined },
    zones: {
      add: (opts: { area: unknown; enabled: boolean }) => ({ ...opts, playerInside: false, setEnabled(on: boolean) { this.enabled = on; } }),
      addTransfer: () => ({ enabled: false, setEnabled: () => undefined }),
      isPlayerIn: () => false,
    },
    tweens: { killTweensOf: () => undefined, popIn: () => undefined, run: () => ({}), punchScale: () => undefined, squash: () => undefined, delay: (_s: number, fn: () => void) => fn() },
    particles: { puff: () => undefined, ring: () => undefined },
    audio: { play: vi.fn() },
    items: { release: () => undefined, stackHeight: () => 0.3, create: (kind: ItemKind) => ({ kind, value: 1, object: new THREE.Object3D() }) },
    flights: { launch: (item: Item, to: ItemHolder, slot: Slot) => to.receive(item, slot), inFlightTo: () => 0 },
  } as unknown as GameContext;
  return { ctx, events };
}
const brick = (): Item => ({ kind: BRICK, value: 1, object: new THREE.Object3D() }) as unknown as Item;

describe('District.sitePad', () => {
  it('makes and shows the pad of a chosen lot silently, without waking the district', () => {
    const state = createGameState();
    state.eras.age = 2;
    state.city.districts[2]!.lots[0] = { building: HOME, tier: -1, cash: 1000, extra: 2 };
    const { ctx, events } = makeCtx(state);
    const heard = vi.fn();
    for (const e of ['built', 'city:built', 'construction:paid', 'pad:complete'] as const) events.on(e, heard);
    const d = new District(ctx, 2, () => undefined);
    expect(d.sitePad(1)).toBeNull(); // nothing chosen there
    const pad = d.sitePad(0)!;
    expect(pad.visible).toBe(true);
    expect(pad.extraRoom).toBe(CITY_BUILDINGS[HOME].extra.count - 2);
    expect(d.sitePad(0)).toBe(pad);
    expect(heard).not.toHaveBeenCalled();
    expect(ctx.audio.play).not.toHaveBeenCalled();
  });

  it('an item paid while flying counts once (the in-flight report no longer re-arms the pad)', () => {
    for (const active of [false, true]) {
      const state = createGameState();
      state.eras.age = 2;
      state.city.districts[2]!.lots[0] = { building: HOME, tier: -1, cash: 0, extra: 0 };
      const { ctx } = makeCtx(state);
      const d = new District(ctx, 2, () => undefined);
      if (active) d.activate();
      const pad = d.sitePad(0)!;
      const it1 = brick();
      const slot = pad.reserve(it1);
      expect(state.city.districts[2]!.lots[0]!.extra).toBe(1); // in flight counts as paid (save safety)
      expect(pad.extraRoom).toBe(CITY_BUILDINGS[HOME].extra.count - 1);
      pad.receive(it1, slot);
      expect(state.city.districts[2]!.lots[0]!.extra).toBe(1);
      expect(pad.extraLeft).toBe(CITY_BUILDINGS[HOME].extra.count - 1);
    }
  });

  it('City registers the lot access for its context; built or unchosen lots give no pad', () => {
    const state = createGameState();
    state.eras.age = 2;
    state.city.districts[2]!.lots[0] = { building: HOME, tier: -1, cash: 0, extra: 0 };
    state.city.districts[2]!.lots[1] = { building: HOME, tier: 0, cash: 0, extra: 0 };
    const { ctx } = makeCtx(state);
    expect(cityLotAccess(ctx)).toBeNull();
    new City(ctx);
    const access = cityLotAccess(ctx)!;
    expect(access.lotPad(2, 0)).not.toBeNull();
    expect(access.lotPad(2, 1)).toBeNull();
    expect(access.lotPad(2, 2)).toBeNull();
    expect(access.lotPad(3, 0)).toBeNull(); // era 3 not reached: no district
  });
});

// ---------------------------------------------------------------------------
// a whole trip
// ---------------------------------------------------------------------------

/** A plain landed-items holder (the import dock / depot). */
class Heap implements ItemHolder {
  readonly items: Item[] = [];
  constructor(readonly id: string) {}
  canAccept(): boolean {
    return true;
  }
  reserve(): Slot {
    return { holder: this, live: true } as unknown as Slot;
  }
  getSlotWorldPosition(_s: Slot, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, 0);
  }
  getSlotWorldQuaternion(_s: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return out.identity();
  }
  receive(item: Item): void {
    this.items.push(item);
  }
  cancel(): void {}
  count(kind?: ItemKind): number {
    return this.items.filter((i) => !kind || i.kind === kind).length;
  }
  take(kind?: ItemKind): Item | null {
    const i = this.items.findIndex((x) => !kind || x.kind === kind);
    return i < 0 ? null : this.items.splice(i, 1)[0]!;
  }
  addImmediate(item: Item): boolean {
    this.items.push(item);
    return true;
  }
  isFull(): boolean {
    return false;
  }
}

describe('a foreman trip to a city lot', () => {
  it('walks out of the gate, along the roads to the lot, unloads the material into its pad and walks back', () => {
    const state = createGameState();
    state.eras.age = 2;
    const need = CITY_BUILDINGS[HOME].extra.count;
    state.city.districts[2]!.lots[4] = { building: HOME, tier: -1, cash: 0, extra: 0 };
    const { ctx } = makeCtx(state);
    const L = regionLayout(2);
    const dock = new Heap('pile:dock');
    for (let i = 0; i < need + 4; i++) dock.items.push(brick());
    const depot = new Heap('depot');
    const region = {
      era: 2,
      layout: L,
      machines: [],
      depot,
      depotSpot: { x: L.depot.x, z: L.depot.z + 1 },
      dock,
      dockSpot: { x: L.dock.x, z: L.dock.z + 1 },
      sites: () => [],
      node: null,
      market: { dockPile: new Heap('a'), stallPile: new Heap('b'), cash: { pile: new Heap('c'), value: 0 }, clerkSpot: L.inside, cashSpot: L.inside, bank: new Heap('bank'), forward: () => false },
    };
    const d = new District(ctx, 2, () => undefined);
    registerCityLots(ctx, { lotPad: (n, lot) => (n === 2 ? d.sitePad(lot) : null) });
    const w = new EraWorker(ctx, region as never, 'frontierForeman' as never, 0, 'foreman');
    w.peers = [w];
    w.arrive(L.inside);
    const allowed = [...ROADS.filter((r) => r.opensAt <= 2).map((r) => r.rect), L.rect, districtDef(2).rect];
    const footprints = districtLots(2).map((f) => f.rect);
    let outside = false;
    let reachedLot = false;
    const spot = lotStandSpot(2, 4).spot;
    const dt = 1 / 30;
    let t = 0;
    for (; t < 400 && !(state.city.districts[2]!.lots[4]!.extra >= need && reachedLot && inRect(L.rect, w.group.position)); t += dt) {
      w.update(dt);
      const p = { x: w.group.position.x, z: w.group.position.z };
      expect(allowed.some((r) => inRect(r, p, 1e-3)), `off the way at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBe(true);
      for (const f of footprints) expect(p.x > f.minX && p.x < f.maxX && p.z > f.minZ && p.z < f.maxZ).toBe(false);
      if (!inRect(L.rect, p)) outside = true;
      if (Math.hypot(p.x - spot.x, p.z - spot.z) < 0.1) reachedLot = true;
    }
    expect(outside).toBe(true);
    expect(reachedLot).toBe(true);
    expect(state.city.districts[2]!.lots[4]!.extra).toBe(need);
    expect(dock.count(BRICK)).toBe(4);
    // only material: the cash is still the player's to pay, the lot is not built
    expect(state.city.districts[2]!.lots[4]!.cash).toBe(0);
    expect(state.city.districts[2]!.lots[4]!.tier).toBe(-1);
    // a reasonable trip: three loads over ~90 m each way at road speed, well under the time limit
    expect(t).toBeLessThan(200);
  });
});
