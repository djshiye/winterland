/** 0.9.0 era workers: pure job selection, fallbacks and aisle routing over small fakes (npc/EraWorker.ts). */
import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/core/types';
import { meetGate } from './gateHelpers';
import { regionLayout } from '../src/eras/layout';
import { CITY_BUILDINGS, ERAS } from '../src/eras/data';
import { createEraWorkerModel } from '../src/assets/eraWorkers';
import {
  NO_CLAIMS,
  destId,
  fallbackDest,
  idleSpot,
  materialNeeds,
  pickJob,
  planPath,
  srcId,
  usedInRegion,
  type Claims,
  type JobMachine,
  type JobView,
} from '../src/npc/EraWorker';

const AT = { x: 9, z: 66 };
const quarry = (outCount: number, over: Partial<JobMachine> = {}): JobMachine => ({
  slot: 0,
  extractor: true,
  inputs: [],
  output: 'stone',
  outCount,
  outFull: outCount >= 12,
  feed: { x: 0, z: 0 },
  take: { x: 2, z: 60 },
  ...over,
});
const kiln = (room: number, stock = 0, over: Partial<JobMachine> = {}): JobMachine => ({
  slot: 1,
  extractor: false,
  inputs: [{ kind: 'stone', per: 2, room, stock }],
  output: 'brick',
  outCount: 0,
  outFull: false,
  feed: { x: 9, z: 62 },
  take: { x: 11, z: 62 },
  ...over,
});
const view = (machines: JobMachine[], dock: JobView['dock'] = {}): JobView => ({
  machines,
  dock,
  dockSpot: { x: 4.5, z: 70 },
  depotSpot: { x: -1.5, z: 70 },
  depotAccepts: () => true,
  dockAccepts: () => true,
});
const claim = (sources: Array<[string, number]>, dests: Array<[string, number]>): Claims => ({ sources: new Map(sources), dests: new Map(dests) });

describe('pickJob: feed', () => {
  it('carries stone from the quarry pile to a kiln that wants it, up to capacity', () => {
    const job = pickJob(view([quarry(8), kiln(8)]), 6, NO_CLAIMS, AT)!;
    expect(job).toEqual({ type: 'feed', item: 'stone', take: 6, from: 0, to: 1 });
  });

  it('never takes more than the hopper wants or the pile holds', () => {
    expect(pickJob(view([quarry(8), kiln(3)]), 6, NO_CLAIMS, AT)!.take).toBe(3);
    expect(pickJob(view([quarry(4), kiln(8)]), 6, NO_CLAIMS, AT)!.take).toBe(4);
  });

  it('does not make a trip for fewer than one cycle of input (unless lenient)', () => {
    expect(pickJob(view([quarry(1), kiln(8)]), 6, NO_CLAIMS, AT)).toBeNull();
    expect(pickJob(view([quarry(1), kiln(8)]), 6, NO_CLAIMS, AT, true)).toMatchObject({ type: 'feed', take: 1 });
  });

  it('takes inputs from the import dock too', () => {
    const job = pickJob(view([kiln(8)], { stone: 5 }), 6, NO_CLAIMS, AT)!;
    expect(job).toMatchObject({ type: 'feed', item: 'stone', take: 5, from: 'dock', to: 1 });
  });

  it('serves a starving hopper before a stocked one', () => {
    const near = kiln(8, 6, { slot: 1, feed: { x: 9, z: 66 } });
    const hungry = kiln(8, 0, { slot: 2, feed: { x: 20, z: 66 } });
    expect(pickJob(view([quarry(10), near, hungry]), 6, NO_CLAIMS, AT)!.to).toBe(2);
  });

  it('does not chase a pile or hopper a peer has claimed', () => {
    const v = view([quarry(8), kiln(8)]);
    // the peer already reserved all 8 stones at the quarry
    expect(pickJob(v, 6, claim([[srcId(0, 'stone'), 8]], []), AT)).toBeNull();
    // the peer is carrying 6 toward a hopper that takes 8: only 2 left to bring
    expect(pickJob(v, 6, claim([], [[destId(1, 'stone'), 6]]), AT)!.take).toBe(2);
  });

  it('feeds a processor from another processor (fuel rods into a reactor)', () => {
    const enricher = kiln(0, 0, { slot: 0, output: 'fuelRod', outCount: 3, inputs: [{ kind: 'uranium', per: 2, room: 0, stock: 4 }] });
    const reactor = kiln(6, 0, { slot: 1, output: 'power', inputs: [{ kind: 'fuelRod', per: 1, room: 6, stock: 0 }] });
    expect(pickJob(view([enricher, reactor]), 6, NO_CLAIMS, AT)).toMatchObject({ type: 'feed', item: 'fuelRod', from: 0, to: 1, take: 3 });
  });
});

describe('pickJob: ship and surplus', () => {
  it('ships finished goods to the depot once a few are ready', () => {
    const v = view([quarry(0), kiln(0, 4, { outCount: 4 })]);
    expect(pickJob(v, 6, NO_CLAIMS, AT)).toEqual({ type: 'ship', item: 'brick', take: 4, from: 1, to: 'depot' });
  });

  it('waits for a few goods unless lenient or the pile is full', () => {
    const one = view([kiln(0, 4, { outCount: 1 })]);
    expect(pickJob(one, 6, NO_CLAIMS, AT)).toBeNull();
    expect(pickJob(one, 6, NO_CLAIMS, AT, true)).toMatchObject({ type: 'ship', take: 1 });
  });

  it('feeding comes before shipping', () => {
    const v = view([quarry(8), kiln(8, 0, { outCount: 5 })]);
    expect(pickJob(v, 6, NO_CLAIMS, AT)!.type).toBe('feed');
  });

  it('sends raw material nobody uses to the depot as surplus', () => {
    const v = view([quarry(5)]);
    expect(pickJob(v, 6, NO_CLAIMS, AT)).toEqual({ type: 'surplus', item: 'stone', take: 5, from: 0, to: 'depot' });
  });

  it('keeps raw material a processor uses until the pile is full, then ships the overflow', () => {
    const noRoom = kiln(0);
    expect(pickJob(view([quarry(8), noRoom]), 6, NO_CLAIMS, AT)).toBeNull();
    expect(pickJob(view([quarry(12), noRoom]), 6, NO_CLAIMS, AT)).toEqual({ type: 'surplus', item: 'stone', take: 6, from: 0, to: 'depot' });
  });

  it('respects what the depot accepts', () => {
    const v = { ...view([quarry(5)]), depotAccepts: () => false };
    expect(pickJob(v, 6, NO_CLAIMS, AT)).toBeNull();
  });

  it('finished goods before surplus', () => {
    const v = view([quarry(6), kiln(0, 4, { outCount: 3 })]);
    // the kiln uses stone, so the quarry has no surplus anyway; the bricks go first
    expect(pickJob(v, 6, NO_CLAIMS, AT)!.type).toBe('ship');
  });
});

describe('pickJob: idle', () => {
  it('has nothing to do in an empty or quiet region', () => {
    expect(pickJob(view([]), 6, NO_CLAIMS, AT)).toBeNull();
    expect(pickJob(view([quarry(0), kiln(0)]), 6, NO_CLAIMS, AT)).toBeNull();
  });

  it('knows which kinds the region uses', () => {
    expect(usedInRegion([quarry(0), kiln(0)], 'stone')).toBe(true);
    expect(usedInRegion([quarry(0), kiln(0)], 'brick')).toBe(false);
  });
});

describe('fallbackDest', () => {
  it('prefers another processor that wants the goods, else the depot', () => {
    const other = kiln(4, 0, { slot: 2 });
    expect(fallbackDest(view([quarry(0), other]), 'stone', NO_CLAIMS, AT, 1, false)).toBe(2);
    expect(fallbackDest(view([quarry(0)]), 'stone', NO_CLAIMS, AT, 1, false)).toBe('depot');
  });

  it('puts imports back on the dock', () => {
    expect(fallbackDest(view([]), 'stone', NO_CLAIMS, AT, null, true)).toBe('dock');
    expect(fallbackDest({ ...view([]), dockAccepts: () => false }, 'stone', NO_CLAIMS, AT, null, true)).toBe('depot');
  });

  it('holds on when nothing takes the load', () => {
    const v = { ...view([]), depotAccepts: () => false, dockAccepts: () => false };
    expect(fallbackDest(v, 'stone', NO_CLAIMS, AT, null, false)).toBeNull();
  });
});

describe('planPath', () => {
  for (const n of [2, 3, 4, 7, 10]) {
    const L = regionLayout(n);
    const slotSpot = (i: number): { x: number; z: number } => {
      const s = L.slots[i]!;
      return { x: s.x, z: s.z - L.inward * (L.cell / 2 - 1.4) }; // in front of the machine, inside its cell
    };

    it(`era ${n}: ends at the target and every leg is axis-aligned`, () => {
      const last = L.slots.length - 1;
      const path = planPath(L, L.dock, slotSpot(last));
      expect(path[path.length - 1]).toEqual(slotSpot(last));
      let prev = L.dock;
      for (const p of path) {
        expect(Math.abs(p.x - prev.x) < 1e-6 || Math.abs(p.z - prev.z) < 1e-6).toBe(true);
        prev = p;
      }
    });

    it(`era ${n}: changes rows along a column boundary, never through a machine column`, () => {
      const a = slotSpot(L.slots.length - 1);
      const path = planPath(L, a, L.depot);
      const row0 = L.slots.filter((s) => Math.abs(s.z - L.slots[0]!.z) < 0.01);
      const multiRow = L.slots.some((s) => Math.abs(s.z - L.slots[0]!.z) > 0.01);
      if (!multiRow) return;
      // step-out, corridor top, corridor bottom, ...: the corridor legs share one x on a cell boundary
      expect(path[1]!.x).toBeCloseTo(path[2]!.x, 6);
      for (const s of row0) expect(Math.abs(path[1]!.x - s.x)).toBeGreaterThan(L.cell / 2 - 0.01);
    });
  }

  it('is a single hop to a spot in the same place', () => {
    const L = regionLayout(2);
    expect(planPath(L, L.dock, L.dock)).toEqual([L.dock]);
  });

  it('idle posts of a crew are spread along the band', () => {
    const L = regionLayout(2);
    const xs = [0, 1, 2].map((i) => idleSpot(L, i).x);
    expect(new Set(xs).size).toBe(3);
    for (const i of [0, 1, 2]) expect(idleSpot(L, i).z).toBe(L.depot.z);
  });
});

describe('era worker models', () => {
  it('has an outfit for every era with the rig parts CharacterRig needs', () => {
    for (let n = 2; n <= 10; n++) {
      expect(ERAS[n]).toBeTruthy();
      const m = createEraWorkerModel(n, n);
      expect(m.height).toBeGreaterThan(1);
      expect(m.carryPivot).toBeTruthy();
      expect(m.legL).toBeTruthy();
      expect(m.armR).toBeTruthy();
    }
  });
});

describe('owed materials', () => {
  const owes = (kind: string, n: number): Map<never, number> => new Map([[kind as never, n]]);

  it('keeps the owed amount of finished goods and ships only the excess', () => {
    const v = view([quarry(0), kiln(0, 4, { outCount: 5 })]);
    expect(pickJob(v, 6, NO_CLAIMS, AT)).toMatchObject({ type: 'ship', item: 'brick', take: 5 });
    expect(pickJob(v, 6, NO_CLAIMS, AT, false, owes('brick', 5))).toBeNull();
    expect(pickJob(v, 6, NO_CLAIMS, AT, true, owes('brick', 5))).toBeNull();
    expect(pickJob(v, 6, NO_CLAIMS, AT, true, owes('brick', 3))).toMatchObject({ type: 'ship', item: 'brick', take: 2 });
    expect(pickJob(v, 6, NO_CLAIMS, AT, false, owes('brick', 2))).toMatchObject({ type: 'ship', item: 'brick', take: 3 });
  });

  it('counts the import dock as stock', () => {
    const v = view([kiln(0, 4, { outCount: 4 })], { brick: 2 });
    // stock 6, owed 3: 3 may ship
    expect(pickJob(v, 6, NO_CLAIMS, AT, false, owes('brick', 3))).toMatchObject({ type: 'ship', take: 3 });
    expect(pickJob(v, 6, NO_CLAIMS, AT, false, owes('brick', 6))).toBeNull();
  });

  it('holds back surplus and a full pile only down to the owed amount', () => {
    expect(pickJob(view([quarry(12)]), 6, NO_CLAIMS, AT, false, owes('stone', 12))).toBeNull();
    expect(pickJob(view([quarry(12)]), 6, NO_CLAIMS, AT, false, owes('stone', 9))).toEqual({ type: 'surplus', item: 'stone', take: 3, from: 0, to: 'depot' });
    const two = view([quarry(5, { output: 'ore' }), kiln(0, 4, { outCount: 4 })]);
    expect(pickJob(two, 6, NO_CLAIMS, AT, false, owes('brick', 4))).toMatchObject({ type: 'surplus', item: 'ore' });
  });

  it('does not stop feeding a processor with an owed input kind', () => {
    expect(pickJob(view([quarry(8), kiln(8)]), 6, NO_CLAIMS, AT, false, owes('stone', 50))).toMatchObject({ type: 'feed', item: 'stone' });
  });

  it('a leftover load goes to the dock only while the stock is at or below the owed amount', () => {
    expect(fallbackDest(view([]), 'brick', NO_CLAIMS, AT, null, false, owes('brick', 1))).toBe('dock');
    expect(fallbackDest(view([], { brick: 4 }), 'brick', NO_CLAIMS, AT, null, false, owes('brick', 4))).toBe('dock');
    expect(fallbackDest(view([], { brick: 5 }), 'brick', NO_CLAIMS, AT, null, false, owes('brick', 4))).toBe('depot');
    expect(fallbackDest(view([]), 'brick', NO_CLAIMS, AT, null, false)).toBe('depot');
  });
});

describe('materialNeeds', () => {
  it('is empty on a fresh game', () => {
    expect(materialNeeds(createGameState()).size).toBe(0);
  });

  it('owes the next expansion extra while offered and unpaid', () => {
    const st = createGameState();
    meetGate(st, 2); // era 2's pad is on offer; its extra is crates (not a material)
    expect(materialNeeds(st).size).toBe(0);
    st.eras.age = 2; // era 3 on preview only (its gate is not met): nothing owed yet
    expect(materialNeeds(st).size).toBe(0);
    meetGate(st, 3); // era 3 offered: 35 bricks
    expect(materialNeeds(st).get('brick')).toBe(35);
    st.eras.regions[3]!.extra = 30;
    expect(materialNeeds(st).get('brick')).toBe(5);
    st.eras.regions[3]!.extra = 35;
    expect(materialNeeds(st).size).toBe(0);
  });

  it('sums unpaid machine and city lot extras per kind, and drops them once paid or built', () => {
    const st = createGameState();
    st.eras.age = 2;
    meetGate(st, 3); // era 3's pad on offer too (35 bricks)
    st.eras.regions[2]!.slots[1] = { machine: 'kiln', tier: -1, cash: 0, extra: 3 }; // needs 12 stone, 9 owed
    const brickKind = CITY_BUILDINGS.frontierHome.extra.kind;
    st.city.districts[2]!.lots[0] = { building: 'frontierHome', tier: -1, cash: 0, extra: 0 };
    st.city.districts[2]!.lots[1] = { building: 'frontierHome', tier: -1, cash: 0, extra: 0 };
    const needs = materialNeeds(st);
    expect(needs.get('stone')).toBe(9);
    expect(needs.get(brickKind as never)).toBe(CITY_BUILDINGS.frontierHome.extra.count * 2 + (brickKind === 'brick' ? 35 : 0));
    st.eras.regions[2]!.slots[1]!.extra = 12;
    expect(materialNeeds(st).has('stone')).toBe(false);
    st.eras.regions[2]!.slots[1] = { machine: 'kiln', tier: 0, cash: 0, extra: 0 };
    expect(materialNeeds(st).has('stone')).toBe(false);
  });
});
