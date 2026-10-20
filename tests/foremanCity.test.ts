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
import { CITY_BUILDINGS, DISTRICT_MATERIAL, districtDef, type CityBuildingId } from '../src/eras/data';
import { regionLayout } from '../src/eras/layout';
import { NO_CLAIMS, PAY_STEPS, eraPayAmount, eraSpendable, walletRef, lotDest, lotDestId, payDestId, pickJob, pickPay, siteDest, type JobMachine, type JobView } from '../src/npc/EraWorker';
import { PRIORITIES } from '../src/config';
import { cityLotAccess, lotNeeds, registerCityLots } from '../src/city/lotAccess';
import { cityWalkRects, crossingAt, gateRoadSpot, inRect, lotStandSpot } from '../src/city/roadRoute';
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

/** A wallet that really spends (the foremen pay from it, 0.9.9). */
const wallet = (money: number) => ({
  money,
  spend(n: number): boolean {
    if (n > this.money) return false;
    this.money -= n;
    return true;
  },
  add(n: number): void {
    this.money += n;
  },
});

describe('a foreman trip to a city lot', () => {
  it('walks out of the gate, along the roads to the lot, unloads the material into its pad and walks back', () => {
    const state = createGameState();
    state.eras.age = 2;
    const need = CITY_BUILDINGS[HOME].extra.count;
    state.city.districts[2]!.lots[4] = { building: HOME, tier: -1, cash: 0, extra: 0 };
    const { ctx } = makeCtx(state);
    // an empty wallet: nothing to pay with, so this trip is all about the material
    (ctx as { economy: unknown }).economy = wallet(0);
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
    // 0.9.12: beside the roads (their verges), across them only at a crossing, and inside the region and district
    const allowed = [...cityWalkRects(2), ...crossingAt(2, gateRoadSpot(L)), L.rect, districtDef(2).rect];
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
    // an empty wallet pays nothing: the cash is still owed, the lot is not built
    expect(state.city.districts[2]!.lots[4]!.cash).toBe(0);
    expect(state.city.districts[2]!.lots[4]!.tier).toBe(-1);
    // a reasonable trip: three loads over ~90 m each way at road speed, well under the time limit
    expect(t).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// 0.9.9: the builders pay for what the player chose
// ---------------------------------------------------------------------------

describe('the foreman pays (0.9.9)', () => {
  const HOME_CASH = CITY_BUILDINGS[HOME].cash;

  it('pays in chunks sized to the price, keeps the wallet reserve and never dribbles', () => {
    // a $250 floor, else a fortieth of the price
    expect(eraPayAmount(HOME_CASH, HOME_CASH, 1e12)).toBe(Math.max(PRIORITIES.payChunk, Math.ceil(HOME_CASH / PAY_STEPS)));
    expect(eraPayAmount(4000, 4000, 1e12)).toBe(PRIORITIES.payChunk);
    // the last few dollars finish the building
    expect(eraPayAmount(7, HOME_CASH, 1e12)).toBe(7);
    // the wallet keeps max($500, 40 %) (0.9.10; Survival's foreman keeps 20 %): $600 → $100 spendable, $500 → nothing;
    // $1M → $600k spendable
    expect(PRIORITIES.eraReserveShare).toBe(0.4);
    expect(PRIORITIES.reserveShare).toBe(0.2);
    expect(eraPayAmount(4000, 4000, 600)).toBe(100);
    expect(eraPayAmount(4000, 4000, 500)).toBe(0);
    expect(eraPayAmount(2e6, 4e7, 1e6)).toBe(Math.min(1e6, 6e5));
    // a dribble (under a tenth of a chunk) waits for the wallet to grow
    const chunk = Math.ceil(HOME_CASH / PAY_STEPS);
    const money = 500 + Math.floor(chunk / 10) - 1;
    expect(eraPayAmount(HOME_CASH, HOME_CASH, money)).toBe(0);
  });

  it('0.9.10: chunk after chunk, the builders stop at 40 % of the wallet the player left them', () => {
    // 0.9.9 measured the reserve against the wallet at each chunk, so a run of chunks drained it to the $500 floor
    const key = {};
    let money = 1e6;
    walletRef(key, money);
    for (let i = 0; i < 400; i++) {
      const amount = eraPayAmount(4e7, 4e7, money, walletRef(key, money));
      money -= amount;
      walletRef(key, money, true);
    }
    expect(money).toBeGreaterThanOrEqual(0.4 * 1e6);
    expect(money).toBeLessThan(0.4 * 1e6 + 1e3);
    // income refills the wallet: the builders take only what is above 40 % of the new high
    money += 1e6;
    expect(eraSpendable(money, walletRef(key, money))).toBe(money - 0.4 * money);
    expect(eraSpendable(1e6)).toBe(6e5);
    expect(eraSpendable(5e5, 1e6)).toBe(1e5);
    expect(eraSpendable(3e5, 1e6)).toBe(0);
  });

  it('the reference wallet rises with the wallet, holds through builder payments and restarts after a player spend', () => {
    const key = {};
    expect(walletRef(key, 100)).toBe(100);
    expect(walletRef(key, 1000)).toBe(1000);
    expect(walletRef(key, 700, true)).toBe(1000); // a builder paid
    expect(walletRef(key, 700)).toBe(1000);
    expect(walletRef(key, 200)).toBe(200); // the player bought something
    expect(walletRef(key, 500)).toBe(500);
  });

  it('picks the nearest site the wallet can pay, skipping one a peer already pays', () => {
    const near = { to: lotDest(0), left: 1000, total: 1000, spot: { x: 1, z: 72 } };
    const far = { to: siteDest(2), left: 1000, total: 1000, spot: { x: 30, z: 72 } };
    expect(pickPay(view({ pays: [far, near] }), 1e6, NO_CLAIMS, AT)).toBe(near);
    const claims = { sources: new Map(), dests: new Map([[payDestId(near.to), 1]]) };
    expect(pickPay(view({ pays: [far, near] }), 1e6, claims, AT)).toBe(far);
    expect(pickPay(view({ pays: [far, near] }), 500, NO_CLAIMS, AT)).toBeNull(); // at the reserve
    expect(pickPay(view({}), 1e6, NO_CLAIMS, AT)).toBeNull();
  });

  /** A fake era-2 region with an empty dock (and optional chosen machine slots that owe cash). */
  const fakeRegion = (payPads?: () => unknown[]) => {
    const L = regionLayout(2);
    return {
      era: 2,
      layout: L,
      machines: [],
      depot: new Heap('depot'),
      depotSpot: { x: L.depot.x, z: L.depot.z + 1 },
      dock: new Heap('pile:dock'),
      dockSpot: { x: L.dock.x, z: L.dock.z + 1 },
      sites: () => [],
      ...(payPads ? { payPads } : {}),
      node: null,
      market: { dockPile: new Heap('a'), stallPile: new Heap('b'), cash: { pile: new Heap('c'), value: 0 }, clerkSpot: L.inside, cashSpot: L.inside, bank: new Heap('bank'), forward: () => false },
    };
  };

  it('walks to a chosen lot whose material is in, pays the rest of the price and the house goes up', () => {
    const state = createGameState();
    state.eras.age = 2;
    state.city.districts[2]!.lots[4] = { building: HOME, tier: -1, cash: 0, extra: CITY_BUILDINGS[HOME].extra.count };
    const { ctx, events } = makeCtx(state);
    const purse = wallet(10 * HOME_CASH);
    (ctx as { economy: unknown }).economy = purse;
    const built = vi.fn();
    events.on('city:built', built);
    const d = new District(ctx, 2, () => undefined);
    registerCityLots(ctx, { lotPad: (n, lot) => (n === 2 ? d.sitePad(lot) : null) });
    const L = regionLayout(2);
    const w = new EraWorker(ctx, fakeRegion() as never, 'frontierForeman' as never, 0, 'foreman');
    w.peers = [w];
    w.arrive(L.inside);
    const spot = lotStandSpot(2, 4).spot;
    let paidAt: { x: number; z: number } | null = null;
    const dt = 1 / 30;
    let t = 0;
    for (; t < 200 && state.city.districts[2]!.lots[4]!.tier < 0; t += dt) {
      const before = purse.money;
      w.update(dt);
      if (purse.money < before && !paidAt) paidAt = { x: w.group.position.x, z: w.group.position.z };
    }
    // paid standing at the lot, not from the region
    expect(paidAt).not.toBeNull();
    expect(Math.hypot(paidAt!.x - spot.x, paidAt!.z - spot.z)).toBeLessThan(0.1);
    expect(state.city.districts[2]!.lots[4]!.tier).toBe(0);
    expect(built).toHaveBeenCalledWith(expect.objectContaining({ era: 2, lot: 4, building: HOME }));
    expect(purse.money).toBe(9 * HOME_CASH);
    expect(t).toBeLessThan(120);
  });

  it('stops at the wallet reserve and leaves the rest owed', () => {
    const state = createGameState();
    state.eras.age = 2;
    state.city.districts[2]!.lots[0] = { building: HOME, tier: -1, cash: 0, extra: 0 };
    const { ctx } = makeCtx(state);
    const purse = wallet(HOME_CASH / 2);
    (ctx as { economy: unknown }).economy = purse;
    const d = new District(ctx, 2, () => undefined);
    registerCityLots(ctx, { lotPad: (n, lot) => (n === 2 ? d.sitePad(lot) : null) });
    const w = new EraWorker(ctx, fakeRegion() as never, 'frontierForeman' as never, 0, 'foreman');
    w.peers = [w];
    w.arrive(regionLayout(2).inside);
    for (let t = 0; t < 150; t += 1 / 30) w.update(1 / 30);
    const lot = state.city.districts[2]!.lots[0]!;
    expect(lot.tier).toBe(-1);
    expect(lot.cash).toBeGreaterThan(0);
    // what is left in the wallet is the reserve (at most one dribble above it)
    const reserve = Math.max(PRIORITIES.reserveMin, PRIORITIES.reserveShare * purse.money);
    expect(purse.money).toBeGreaterThanOrEqual(reserve);
    expect(lot.cash + purse.money).toBe(HOME_CASH / 2);
  });

  it('pays a chosen machine slot of its region too', () => {
    const state = createGameState();
    state.eras.age = 2;
    const { ctx } = makeCtx(state);
    const purse = wallet(1e6);
    (ctx as { economy: unknown }).economy = purse;
    const L = regionLayout(2);
    const pad = {
      left: 6000,
      visible: true,
      get cashLeft() {
        return this.left;
      },
      payDirect(n: number) {
        const c = Math.min(n, this.left);
        this.left -= c;
        return c;
      },
    };
    const p = L.slots[3]!;
    const spot = { x: p.x, z: p.z - L.inward * (L.padSize / 2 + 0.7) };
    const region = fakeRegion(() => (pad.left > 0 ? [{ slot: 3, pad, total: 6000, spot }] : []));
    const w = new EraWorker(ctx, region as never, 'frontierForeman' as never, 0, 'foreman');
    w.peers = [w];
    w.arrive(L.inside);
    for (let t = 0; t < 60 && pad.left > 0; t += 1 / 30) w.update(1 / 30);
    expect(pad.left).toBe(0);
    expect(purse.money).toBe(1e6 - 6000);
    expect(Math.hypot(w.group.position.x - spot.x, w.group.position.z - spot.z)).toBeLessThan(0.1);
  });
});
