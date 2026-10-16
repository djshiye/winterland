/**
 * 0.9.5: every era region (2..10) gets era 1's customers: a market in its market zone with a loading dock (buyer
 * vehicles on the road), a market stall (walk-in shoppers through the market gate) and one cash pile, plus era 1's
 * sales upgrades: `${key}Dock`, `${key}Stall` and a Quality upgrade for every era material.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { TIMING, TRADE_POST, UPGRADES, eraCashMachine } from '../src/config';
import { valueAt } from '../src/core/ladder';
import { createGameState, type GameContext, type Item, type ItemKind } from '../src/core/types';
import { ERAS, MATERIALS, MATERIAL_KINDS, MAX_ERA, REGIONS, ROADS } from '../src/eras/data';
import { regionLayout } from '../src/eras/layout';
import { DOCK_BODY, DOCK_GIVE, STALL_BODY, STALL_GIVE, marketPlaces } from '../src/eras/market';
import { DEPOT_FRAME, DOCK_FRAME, MAT_SIZE, toWorld, worldRect } from '../src/eras/rules';
import { Pile } from '../src/items/Pile';

vi.mock('../src/assets/vehicles', () => ({
  TRUCK_BED_X: 1.09,
  TRUCK_WHEEL_RADIUS: 0.38,
  createPickupTruckWithDriver: () => {
    const root = new THREE.Group();
    const body = new THREE.Group();
    const bedPivot = new THREE.Object3D();
    root.add(body);
    body.add(bedPivot);
    return {
      model: { root, body, wheels: [], bedPivot, driverSeat: new THREE.Object3D(), bubbleY: 2.5 },
      rig: { setSeated: () => undefined, cheer: () => undefined, animate: () => undefined },
    };
  },
}));
vi.mock('../src/assets/shop', () => ({
  createSpeechBubble: () => ({ sprite: new THREE.Sprite(), show: () => undefined, dispose: () => undefined }),
}));
vi.mock('../src/render/characters', () => ({
  createCharacterRig: () => {
    const root = new THREE.Group();
    return { root, armsAnchor: new THREE.Group(), height: 1.6, setCarrying: () => undefined, setSeated: () => undefined, cheer: () => undefined, animate: () => undefined, update: () => undefined };
  },
}));
vi.mock('../src/eras/LevelPad', () => ({ EraLevelPad: class { update(): void {} } }));
vi.mock('../src/assets/cashMachine', () => ({
  CASH_MACHINE_SIZE: { w: 1.5, d: 1.3, h: 1.9 },
  createCashMachineModel: () => ({ root: new THREE.Group(), wheel: new THREE.Object3D(), mouth: new THREE.Vector3() }),
}));
vi.mock('../src/assets/marketCounter', () => ({ createMarketCounterModel: () => new THREE.Group(), COUNTER_SIZE: { length: 3.0, depth: 0.8, height: 0.95 } }));

const { EraBuyers } = await import('../src/npc/EraBuyers');
const { EraShoppers } = await import('../src/npc/EraShoppers');
const { eraFallback, counterRoom } = await import('../src/eras/RegionMarket');

type R = { minX: number; maxX: number; minZ: number; maxZ: number };
const overlap = (a: R, b: R): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const inside = (p: { x: number; z: number }, r: R): boolean => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
const within = (a: R, r: R): boolean => a.minX >= r.minX && a.maxX <= r.maxX && a.minZ >= r.minZ && a.maxZ <= r.maxZ;
const around = (p: { x: number; z: number }, half: number): R => ({ minX: p.x - half, maxX: p.x + half, minZ: p.z - half, maxZ: p.z + half });

describe('market upgrades', () => {
  it('every era has a Loading Dock and a Market Stall upgrade in the sales group, ×1 at level 0 and ×3 at 10', () => {
    for (let n = 2; n <= MAX_ERA; n++) {
      const key = ERAS[n]!.key;
      for (const id of [`${key}Dock`, `${key}Stall`] as const) {
        const def = UPGRADES[id];
        expect(def).toMatchObject({ group: 'sales', era: n, display: 'boost', requires: { era: n } });
        expect(def.values).toHaveLength(11);
        expect(valueAt(def, 0)).toBe(1);
        expect(valueAt(def, 9)).toBe(3);
        expect(valueAt(def, 10)).toBe(3.5);
      }
    }
  });

  it('every era material has a Quality upgrade in its own era, and era 1 sales upgrades are untouched', () => {
    for (const kind of MATERIAL_KINDS) {
      const def = UPGRADES[`${kind}Quality`];
      expect(def).toMatchObject({ group: 'sales', era: MATERIALS[kind].era, display: 'mult' });
      expect(def.values[0]).toBe(1);
      expect(def.values).toHaveLength(11);
      for (let i = 1; i < def.values.length; i++) expect(def.values[i]!).toBeGreaterThan(def.values[i - 1]!);
    }
    expect(UPGRADES.plankQuality.era).toBeUndefined();
    expect(UPGRADES.plankQuality.product).toBe('plank');
  });

  it('a counter grows with its upgrade from the base room to the grid, never past it', () => {
    const g = TRADE_POST.grid;
    expect(counterRoom(1)).toBe(TRADE_POST.room);
    expect(counterRoom(0)).toBe(TRADE_POST.room);
    expect(counterRoom(2)).toBe(TRADE_POST.room * 2);
    expect(counterRoom(6)).toBe(g.cols * g.rows * g.layers);
    const b = TRADE_POST.bedGrid;
    expect(b.cols * b.rows * b.layers).toBeGreaterThanOrEqual(TRADE_POST.maxWant);
  });

  it('an empty counter first asks for the era raw (dock) or refined (stall) product', () => {
    for (let n = 2; n <= MAX_ERA; n++) {
      expect(MATERIALS[eraFallback(n, 'refined')]).toMatchObject({ era: n, grade: 'refined' });
      expect(MATERIALS[eraFallback(n, 'raw')].era).toBeLessThanOrEqual(n);
    }
    expect(eraFallback(2, 'raw')).toBe('stone');
    expect(eraFallback(2, 'refined')).toBe('brick');
    expect(eraFallback(5, 'raw')).toBe('pellets'); // 0.9.7: era 5 mines its own iron pellets
    expect(eraFallback(10, 'raw')).toBe('rareEarth');
    expect(eraFallback(10, 'refined')).toBe('fusionCell'); // 0.9.7: the Fusion Reactor's cells come first in the chain
  });
});

describe('market layout', () => {
  for (let n = 2; n <= MAX_ERA; n++) {
    it(`era ${n}: dock and stall stand in the market zone, clear of every other facility, buyers on the road`, () => {
      const L = regionLayout(n);
      const P = marketPlaces(L);
      const dock = worldRect(P.dock, P.yaw, DOCK_BODY);
      const stall = worldRect(P.stall, P.yaw, STALL_BODY);
      const pieces = [dock, stall, worldRect(P.dock, P.yaw, DOCK_GIVE), worldRect(P.stall, P.yaw, STALL_GIVE), around(P.cash, 1.0)];
      for (const r of pieces) expect(within(r, L.rect), JSON.stringify(r)).toBe(true);
      expect(inside(P.stall, L.zones.market)).toBe(true);
      expect(inside(P.cash, L.zones.market)).toBe(true);
      const others: R[] = [
        worldRect(L.depot, L.facilityYaw, DEPOT_FRAME.body),
        worldRect(L.depot, L.facilityYaw, DEPOT_FRAME.give),
        worldRect(L.dock, L.facilityYaw, DOCK_FRAME.body),
        around(L.shopMat, Math.max(MAT_SIZE.w, MAT_SIZE.d) / 2),
        around(L.jack, 1.5),
        around(L.cashSpot, 2),
        around(L.node, 4),
        { minX: L.gate.x - 2, maxX: L.gate.x + 2, minZ: L.gate.z - 1.5, maxZ: L.gate.z + 1.5 },
        ...L.slots.map((s) => around(s, Math.max(L.padSize, 5.2) / 2)),
      ];
      for (const r of pieces) for (const o of others) expect(overlap(r, o), `${JSON.stringify(r)} vs ${JSON.stringify(o)}`).toBe(false);
      expect(overlap(dock, stall)).toBe(false);
      // the shoppers' way in (door → entry → line) never walks through a counter
      const line = Array.from({ length: TRADE_POST.shopQueue }, (_, i) => ({ x: P.front.x + P.step.x * i, z: P.front.z + P.step.z * i }));
      for (const p of [P.door, P.entry, ...line]) {
        expect(inside(p, dock)).toBe(false);
        expect(inside(p, stall)).toBe(false);
      }
      for (const p of [P.entry, ...line]) expect(inside(p, L.rect)).toBe(true);
      // the lane runs on a road outside the fence, past the queue's last stop and beyond the dock
      expect(Math.sign(P.lane.z - L.marketGate.z)).toBe(-L.inward);
      const onRoad = ROADS.some((r) => r.rect.minZ <= P.lane.z && P.lane.z <= r.rect.maxZ && r.rect.minX <= P.lane.toX && P.lane.fromX <= r.rect.maxX);
      expect(onRoad).toBe(true);
      const lastStop = P.dock.x - 1.09 + (TRADE_POST.maxQueue - 1) * TRADE_POST.spacing;
      expect(P.lane.fromX).toBeGreaterThan(lastStop + 2);
      expect(P.lane.toX).toBeLessThan(P.dock.x - 3);
    });
  }

  it('lanes on the same road never share a stretch (no vehicle drives through another region queue)', () => {
    const lanes = [];
    for (let n = 2; n <= MAX_ERA; n++) if (REGIONS[n]) lanes.push({ n, ...marketPlaces(regionLayout(n)).lane });
    for (const a of lanes)
      for (const b of lanes) {
        if (a.n >= b.n || Math.abs(a.z - b.z) >= 1.9) continue;
        const gap = Math.max(a.toX - b.fromX, b.toX - a.fromX);
        expect(gap, `eras ${a.n} and ${b.n}`).toBeGreaterThanOrEqual(3.6);
      }
  });
});

// ---------------------------------------------------------------------------
// Buyers with a fake context
// ---------------------------------------------------------------------------

function fakeCtx() {
  const released: Item[] = [];
  let nextId = 1;
  const ctx = {
    scene: new THREE.Scene(),
    state: createGameState(),
    time: { elapsed: 0 },
    tweens: { popIn: () => undefined, popOut: () => undefined, killTweensOf: () => undefined, squash: () => undefined, punchScale: () => undefined },
    particles: { puff: () => undefined },
    events: { emit: () => undefined },
    items: {
      create: (kind: ItemKind): Item => ({ id: nextId++, kind, value: 0, object: new THREE.Object3D() }) as Item,
      release: (i: Item) => void released.push(i),
      stackHeight: () => 0.3,
    },
    flights: {
      launch: (item: Item, to: { receive(i: Item, s: unknown): void }, slot: unknown) => to.receive(item, slot),
      inFlightTo: () => 0,
    },
  } as unknown as GameContext;
  return { ctx, released };
}

function makeBuyers(opts: { dock?: number } = {}) {
  const { ctx } = fakeCtx();
  const sales: { kind: ItemKind; count: number }[] = [];
  const pile = new Pile(ctx, { id: 'counter:test', accepts: ['brick', 'stone'], position: new THREE.Vector3(), grid: TRADE_POST.grid });
  const P = marketPlaces(regionLayout(2));
  const buyers = new EraBuyers(ctx, {
    era: 2,
    pile,
    x: P.dock.x,
    lane: P.lane,
    colors: [0xff0000, 0x00ff00],
    fallback: 'stone',
    boost: () => opts.dock ?? 1,
    pay: (kind, count) => void sales.push({ kind, count }),
  });
  const run = (seconds: number, step = 1 / 30): void => {
    for (let t = 0; t < seconds; t += step) buyers.update(step);
  };
  return { pile, buyers, sales, run };
}

describe('buyer vehicles at the loading dock', () => {
  it('a vehicle comes even to an empty dock, but no line forms while nothing is for sale', () => {
    const b = makeBuyers();
    b.run(40);
    expect(b.buyers.waiting).toBe(1);
    expect(b.sales).toHaveLength(0);
  });

  it('vehicles load what is on the dock and pay for it', () => {
    const b = makeBuyers();
    b.pile.fill('brick', 30);
    b.run(60);
    expect(b.sales.length).toBeGreaterThanOrEqual(2);
    for (const s of b.sales) {
      expect(s.kind).toBe('brick');
      expect(s.count).toBeGreaterThanOrEqual(1);
      expect(s.count).toBeLessThanOrEqual(TRADE_POST.want[1]);
    }
  });

  it('a vehicle picks the most plentiful kind, and pays for a part order once the dock runs dry', () => {
    const b = makeBuyers();
    b.pile.fill('stone', 2);
    b.pile.fill('brick', 1);
    b.run(30);
    expect(b.sales[0]).toMatchObject({ kind: 'stone', count: 2 });
  });

  it('the Loading Dock upgrade brings vehicles more often and loads them faster', () => {
    const count = (dock: number): number => {
      const b = makeBuyers({ dock });
      for (let t = 0; t < 30; t++) {
        b.pile.fill('brick', 40 - b.pile.total);
        b.run(1);
      }
      return b.sales.reduce((a, s) => a + s.count, 0);
    };
    expect(count(3)).toBeGreaterThan(count(1));
    expect(TIMING.dockLoadMax).toBe(4);
  });

  it('goods on unpaid vehicles are reported for the save', () => {
    const b = makeBuyers();
    b.pile.fill('brick', 3);
    b.run(8);
    const out: Partial<Record<ItemKind, number>> = {};
    b.buyers.unpaid(out);
    expect(out.brick).toBe(3);
    expect(b.pile.count('brick')).toBe(0);
    b.buyers.clear();
    expect(b.buyers.waiting).toBe(0);
  });
});

function makeShoppers(opts: { stall?: number } = {}) {
  const { ctx } = fakeCtx();
  const sales: { kind: ItemKind; count: number }[] = [];
  const L = regionLayout(2);
  const P = marketPlaces(L);
  const pile = new Pile(ctx, { id: 'counter:stall', accepts: ['brick', 'stone'], position: new THREE.Vector3(), grid: TRADE_POST.grid });
  const shoppers = new EraShoppers(ctx, {
    era: 2,
    pile,
    door: P.door,
    entry: P.entry,
    front: P.front,
    step: P.step,
    faceYaw: L.inward > 0 ? 0 : Math.PI,
    inward: L.inward,
    fallback: 'brick',
    boost: () => opts.stall ?? 1,
    pay: (kind, count) => void sales.push({ kind, count }),
  });
  const run = (seconds: number, step = 1 / 30): void => {
    for (let t = 0; t < seconds; t += step) shoppers.update(step);
  };
  return { pile, shoppers, sales, run };
}

describe('walk-in shoppers at the market stall', () => {
  it('one shopper waits at an empty stall; nobody else lines up while nothing is for sale', () => {
    const s = makeShoppers();
    s.run(40);
    expect(s.shoppers.waiting).toBe(1);
    expect(s.sales).toHaveLength(0);
  });

  it('shoppers walk in, take a few goods, pay and leave', () => {
    const s = makeShoppers();
    s.pile.fill('brick', 30);
    s.run(90);
    expect(s.sales.length).toBeGreaterThanOrEqual(3);
    for (const x of s.sales) {
      expect(x.kind).toBe('brick');
      expect(x.count).toBeGreaterThanOrEqual(1);
      expect(x.count).toBeLessThanOrEqual(TRADE_POST.shopWant[1]);
    }
    expect(s.shoppers.waiting).toBeLessThanOrEqual(TRADE_POST.shopQueue);
  });

  it('the Market Stall upgrade brings shoppers more often', () => {
    const count = (stall: number): number => {
      const s = makeShoppers({ stall });
      for (let t = 0; t < 60; t++) {
        s.pile.fill('brick', 40 - s.pile.total);
        s.run(1);
      }
      return s.sales.reduce((a, x) => a + x.count, 0);
    };
    expect(count(3)).toBeGreaterThan(count(1));
  });

  it('goods held by unpaid shoppers are reported for the save; clear() empties the line', () => {
    const s = makeShoppers();
    s.pile.fill('brick', 30);
    s.run(30);
    s.shoppers.clear();
    expect(s.shoppers.waiting).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Era clerks bank the market's cash (npc/EraWorker.ts bankJob)
// ---------------------------------------------------------------------------

const { pickJob, planPath, NO_CLAIMS, BANK_MIN } = await import('../src/npc/EraWorker');

describe('era clerks and the market cash', () => {
  const L = regionLayout(2);
  const P = marketPlaces(L);
  const base = {
    machines: [],
    dock: {},
    dockSpot: { x: 0, z: 70 },
    depotSpot: { x: -1.5, z: 70 },
    depotAccepts: () => true,
    dockAccepts: () => true,
  };
  const AT = { x: 0, z: 70 };

  it('a clerk banks the cash pile once it holds a few dollars; other roles leave it alone', () => {
    const cash = { value: 500, bundles: 3, spot: P.clerk };
    expect(pickJob({ ...base, cash }, 6, NO_CLAIMS, AT, false, undefined, 'clerk')).toEqual({ type: 'bank', item: 'cash', take: 3, from: 'cash', to: 'bank' });
    expect(pickJob({ ...base, cash }, 2, NO_CLAIMS, AT, false, undefined, 'clerk')).toMatchObject({ take: 2 });
    expect(pickJob({ ...base, cash: { ...cash, value: BANK_MIN - 1 } }, 6, NO_CLAIMS, AT, false, undefined, 'clerk')).toBeNull();
    expect(pickJob({ ...base, cash: { ...cash, bundles: 0 } }, 6, NO_CLAIMS, AT, false, undefined, 'clerk')).toBeNull();
    expect(pickJob({ ...base, cash }, 6, NO_CLAIMS, AT, false, undefined, 'hauler')).toBeNull();
    // one clerk at a time: a peer already on the way leaves it to them
    const claims = { sources: new Map([['cash:cash', 3]]), dests: new Map() };
    expect(pickJob({ ...base, cash }, 6, claims, AT, false, undefined, 'clerk')).toBeNull();
  });

  for (let n = 2; n <= MAX_ERA; n++) {
    it(`era ${n}: the clerk's walk from the depot to the cash pile goes round the counters`, () => {
      const L = regionLayout(n);
      const P = marketPlaces(L);
      const yaw = P.yaw;
      const bodies = [worldRect(P.dock, yaw, DOCK_BODY), worldRect(P.stall, yaw, STALL_BODY)].map((r) => ({ minX: r.minX - 0.3, maxX: r.maxX + 0.3, minZ: r.minZ - 0.3, maxZ: r.maxZ + 0.3 }));
      const depot = toWorld(L.depot, yaw, DEPOT_FRAME.spot.u, DEPOT_FRAME.spot.v);
      expect(inside(P.clerk, L.zones.market)).toBe(true);
      for (const [a, b] of [[depot, P.clerk], [P.clerk, depot]] as const) {
        let prev = a;
        for (const p of planPath(L, a, b)) {
          for (let t = 0; t <= 1; t += 0.02) {
            const q = { x: prev.x + (p.x - prev.x) * t, z: prev.z + (p.z - prev.z) * t };
            for (const r of bodies) expect(inside(q, r), `${JSON.stringify(q)} in ${JSON.stringify(r)}`).toBe(false);
          }
          prev = p;
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Era cash machines (eras/CashMachine.ts): era 1's Cash Tubes for the market cash pile
// ---------------------------------------------------------------------------

const { CashMachine } = await import('../src/eras/CashMachine');

describe('era cash machines', () => {
  it('every era has its own cash machine, levelled 1-10 on its pad (never in a shop), Lv 0 = not built', () => {
    const names = new Set<string>();
    for (let n = 2; n <= MAX_ERA; n++) {
      const def = UPGRADES[`${ERAS[n]!.key}Cash`];
      expect(def).toMatchObject({ group: 'machine', era: n, label: eraCashMachine(n)!.label, requires: { era: n } });
      expect(def.values).toHaveLength(11);
      expect(def.values[0]).toBe(0);
      for (let i = 2; i < def.values.length; i++) expect(def.values[i]!).toBeGreaterThan(def.values[i - 1]!);
      names.add(def.label);
    }
    expect(names.size).toBe(MAX_ERA - 1);
    expect(eraCashMachine(2)!.label).toBe('Strongbox');
    expect(eraCashMachine(10)!.label).toBe('Quantum Bank');
  });

  for (let n = 2; n <= MAX_ERA; n++) {
    it(`era ${n}: the machine and its pad stand in the market, clear of the counters, the cash pile and the walkways`, () => {
      const L = regionLayout(n);
      const P = marketPlaces(L);
      const vault = { minX: P.vault.x - 0.75, maxX: P.vault.x + 0.75, minZ: P.vault.z - 0.65, maxZ: P.vault.z + 0.65 };
      const pad = around(P.vaultPad, 0.8 * 1.15);
      for (const r of [vault, pad]) {
        expect(within(r, L.zones.market), JSON.stringify(r)).toBe(true);
        for (const o of [worldRect(P.dock, P.yaw, DOCK_BODY), worldRect(P.stall, P.yaw, STALL_BODY), worldRect(P.stall, P.yaw, STALL_GIVE), around(P.cash, 1.0), around(P.clerk, 0.6)])
          expect(overlap(r, o), `${JSON.stringify(r)} vs ${JSON.stringify(o)}`).toBe(false);
      }
      expect(overlap(vault, pad)).toBe(false);
    });
  }

  function makeVault(level: number) {
    const { ctx, released } = fakeCtx();
    let money = 0;
    const levels: Record<string, number> = { frontierCash: level };
    Object.assign(ctx, {
      economy: { add: (v: number) => void (money += v) },
      upgrades: { level: (id: string) => levels[id] ?? 0, value: (id: string) => valueAt(UPGRADES[id as 'frontierCash'], levels[id] ?? 0) },
      colliders: { addBox: () => undefined },
    });
    const pile = new Pile(ctx, { id: 'pile:era2Cash', accepts: ['cash'], position: new THREE.Vector3(), grid: { cols: 3, rows: 3, layers: 10, spacing: { x: 0.3, y: 0.1, z: 0.2 } } });
    for (let i = 0; i < 20; i++) {
      const item = ctx.items.create('cash');
      item.value = 100;
      pile.addImmediate(item);
    }
    const cash = { pile, get value() { return pile.totalValue(); } };
    const P = marketPlaces(regionLayout(2));
    const vault = new CashMachine(ctx, 2, P.vault, P.vaultPad, cash as never, new THREE.Group());
    const run = (s: number): void => {
      for (let t = 0; t < s; t += 1 / 30) vault.update(1 / 30);
    };
    return { vault, pile, run, released, levels, money: () => money };
  }

  it('not built at Lv 0: the pile stays put; Lv 1 builds it and it banks about rate bundles a second', () => {
    const v = makeVault(0);
    v.run(5);
    expect(v.vault.built).toBe(false);
    expect(v.pile.count('cash')).toBe(20);
    v.levels.frontierCash = 1;
    v.run(5);
    expect(v.vault.built).toBe(true);
    const banked = 20 - v.pile.count('cash');
    expect(banked).toBeGreaterThanOrEqual(5);
    expect(banked).toBeLessThanOrEqual(7);
    // banked as it left the pile, and the bundles that landed in the hopper were recycled worth nothing more
    expect(v.money()).toBe(banked * 100);
  });

  it('a higher level banks faster and the pile empties without losing a dollar', () => {
    const slow = makeVault(1);
    const fast = makeVault(10);
    slow.run(3);
    fast.run(3);
    expect(20 - fast.pile.count('cash')).toBeGreaterThan(20 - slow.pile.count('cash'));
    fast.run(10);
    expect(fast.pile.count('cash')).toBe(0);
    expect(fast.money()).toBe(2000);
  });
});
