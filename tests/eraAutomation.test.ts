/**
 * 0.9.5 era automation (Dino: "not enough workers, no conveyor belts or automation"): the six crew roles beside each
 * era's hauler (config ERA_ROLES, npc/EraWorker.ts pickJob's role), the conveyor belts between an era's machines
 * (eras/belts.ts planBelts / beltRoute) and the machine level pads beside every era machine (eras/rules.ts
 * levelPadLocal). Pure: small fakes and the real region layouts.
 */
import { describe, expect, it } from 'vitest';
import { ERA_ROLES, ERA_ROLE_NAMES, UPGRADES, eraRoleCount } from '../src/config';
import { costAt, introEra, valueAt } from '../src/core/ladder';
import { BELT_LANE, BELT_LEVELS, CORRIDOR_OFFSET, beltRoute, planBelts, rowOf, type SlotMachines } from '../src/eras/belts';
import { ERAS, MACHINES, MAX_ERA, machinesOfEra, type MachineId } from '../src/eras/data';
import { contentMachines } from '../src/eras/template';
import { regionLayout } from '../src/eras/layout';
import { LEVEL_PAD_SIZE, MACHINE_NOMINAL, levelPadLocal, machineFrame, toWorld } from '../src/eras/rules';
import { NO_CLAIMS, pickJob, type JobMachine, type JobView } from '../src/npc/EraWorker';
import { eraCrewDelta } from '../src/ui/agesLogic';

const AT = { x: 0, z: 66 };
const quarry = (outCount: number, over: Partial<JobMachine> = {}): JobMachine => ({
  slot: 0,
  extractor: true,
  inputs: [],
  output: 'stone',
  outCount,
  outFull: outCount >= 12,
  feed: { x: 0, z: 60 },
  take: { x: 2, z: 60 },
  ...over,
});
const kiln = (room: number, outCount = 0, over: Partial<JobMachine> = {}): JobMachine => ({
  slot: 1,
  extractor: false,
  inputs: [{ kind: 'stone', per: 2, room, stock: 0 }],
  output: 'brick',
  outCount,
  outFull: outCount >= 12,
  feed: { x: 9, z: 62 },
  take: { x: 11, z: 62 },
  ...over,
});
const view = (machines: JobMachine[], dock: JobView['dock'] = {}, sites: JobView['sites'] = []): JobView => ({
  machines,
  sites,
  dock,
  dockSpot: { x: 4.5, z: 70 },
  depotSpot: { x: -1.5, z: 70 },
  depotAccepts: () => true,
  dockAccepts: () => true,
});

describe('era crew roles', () => {
  it('every era 2..10 sells a hauler crew and six roles, each with its own name, bought at the era mat', () => {
    for (let n = 2; n <= MAX_ERA; n++) {
      const key = ERAS[n]!.key;
      expect(UPGRADES[`${key}Crew`].group, `era ${n}`).toBe('crew');
      expect(ERA_ROLE_NAMES[n]).toHaveLength(ERA_ROLES.length);
      expect(new Set(ERA_ROLE_NAMES[n]).size).toBe(ERA_ROLES.length);
      ERA_ROLES.forEach((r, i) => {
        const def = UPGRADES[`${key}${r.key}`];
        expect(def, `${key}${r.key}`).toBeTruthy();
        expect(def.group).toBe('crew');
        expect(def.era).toBe(n);
        expect(introEra(def)).toBe(n);
        expect(def.label).toBe(ERA_ROLE_NAMES[n]![i]);
      });
    }
  });

  it('a role hires 1 worker at Lv 1, 2 from Lv 4, 3 from Lv 7 (21 workers a region with the hauler crew)', () => {
    expect([0, 1, 3, 4, 6, 7, 10].map(eraRoleCount)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it('the later roles wait for the settlement: porter and gatherer +2, foreman and clerk +4 within the era', () => {
    expect(ERA_ROLES.map((r) => [r.role, r.settlement])).toEqual([
      ['feeder', 0],
      ['shipper', 0],
      ['porter', 2],
      ['gatherer', 2],
      ['foreman', 4],
      ['clerk', 4],
    ]);
  });

  it("the shop card's effect line says who a level hires, short enough for the card", () => {
    expect(eraCrewDelta(0, 0, 1)).toBe('Hires 1 worker');
    expect(eraCrewDelta(2, 1.1, 1.2)).toBe('×1.1 → ×1.2 speed');
    expect(eraCrewDelta(3, 1.2, 1.32)).toBe('1 → 2 workers · ×1.32');
    expect(eraCrewDelta(10, 2.4, null)).toBe('3 workers · ×2.4 (max)');
    for (let l = 0; l < 10; l++) expect(eraCrewDelta(l, 1 + l / 10, 1.1 + l / 10).length).toBeLessThanOrEqual(24);
  });

  it('every role wears its own scarf colour', () => {
    expect(new Set(ERA_ROLES.map((r) => r.scarf)).size).toBe(ERA_ROLES.length);
  });
});

describe('pickJob by role', () => {
  it('feeder: machine to machine only, never from the dock, never ships', () => {
    expect(pickJob(view([quarry(8), kiln(8)]), 6, NO_CLAIMS, AT, false, undefined, 'feeder')).toMatchObject({ type: 'feed', from: 0, to: 1 });
    expect(pickJob(view([kiln(8)], { stone: 8 }), 6, NO_CLAIMS, AT, false, undefined, 'feeder')).toBeNull();
    expect(pickJob(view([quarry(0), kiln(0, 8)]), 6, NO_CLAIMS, AT, false, undefined, 'feeder')).toBeNull();
  });

  it('porter: dock to machine only', () => {
    expect(pickJob(view([kiln(8)], { stone: 8 }), 6, NO_CLAIMS, AT, false, undefined, 'porter')).toMatchObject({ type: 'feed', from: 'dock', to: 1 });
    expect(pickJob(view([quarry(8), kiln(8)]), 6, NO_CLAIMS, AT, false, undefined, 'porter')).toBeNull();
  });

  it('shipper: finished goods first, then surplus, never feeds', () => {
    expect(pickJob(view([quarry(8), kiln(8, 5)]), 6, NO_CLAIMS, AT, false, undefined, 'shipper')).toMatchObject({ type: 'ship', item: 'brick' });
    expect(pickJob(view([quarry(5)]), 6, NO_CLAIMS, AT, false, undefined, 'shipper')).toMatchObject({ type: 'surplus', item: 'stone' });
    expect(pickJob(view([quarry(8), kiln(8)]), 6, NO_CLAIMS, AT, false, undefined, 'shipper')).toBeNull();
  });

  it('clerk: the fullest pile first, even a far one', () => {
    const near = kiln(0, 4, { slot: 1, take: { x: 1, z: 66 } });
    const full = kiln(0, 12, { slot: 2, take: { x: 40, z: 40 } });
    expect(pickJob(view([near, full]), 6, NO_CLAIMS, AT, false, undefined, 'clerk')).toMatchObject({ from: 2 });
    expect(pickJob(view([near, full]), 6, NO_CLAIMS, AT, false, undefined, 'hauler')).toMatchObject({ from: 1 }); // the hauler takes the near one
    const fuller = kiln(0, 9, { slot: 2, take: { x: 40, z: 40 } });
    expect(pickJob(view([near, fuller]), 6, NO_CLAIMS, AT, false, undefined, 'clerk')).toMatchObject({ from: 2 });
  });

  it('gatherer: the hand-node pile first (processors, then the depot), then extractors to processors, then a dock reserve', () => {
    const node = (count: number, full = false): JobView['node'] => ({ kind: 'stone', count, full, spot: { x: 20, z: 70 } });
    // 0.9.6 (eras 1-4 #4): the player's harvest goes to a hungry kiln before anything else
    expect(pickJob({ ...view([quarry(8), kiln(8)]), node: node(6) }, 6, NO_CLAIMS, AT, false, undefined, 'gatherer')).toMatchObject({ type: 'feed', from: 'node', to: 1 });
    // nobody wants it: a filling node pile goes to the depot, so the player can keep harvesting
    expect(pickJob({ ...view([quarry(8)]), node: node(18, true) }, 6, NO_CLAIMS, AT, false, undefined, 'gatherer')).toMatchObject({ type: 'surplus', from: 'node', to: 'depot' });
    expect(pickJob({ ...view([quarry(8)]), node: node(2) }, 6, NO_CLAIMS, AT, false, undefined, 'gatherer')).toBeNull();
    // 0.9.6 (F3): feeding comes before the dock reserve
    expect(pickJob(view([quarry(8), kiln(8)]), 6, NO_CLAIMS, AT, false, undefined, 'gatherer')).toMatchObject({ type: 'feed', from: 0, to: 1 });
    // the kiln is full: the filling quarry stocks the dock reserve the porters feed on
    expect(pickJob(view([quarry(8), kiln(0)]), 6, NO_CLAIMS, AT, false, undefined, 'gatherer')).toMatchObject({ type: 'stock', from: 0, to: 'dock' });
    expect(pickJob(view([quarry(8), kiln(0)], { stone: 12 }), 6, NO_CLAIMS, AT, false, undefined, 'gatherer')).toBeNull();
    // a raw material nobody here uses is the shipper's, not stocked
    expect(pickJob(view([quarry(8)]), 6, NO_CLAIMS, AT, false, undefined, 'gatherer')).toBeNull();
    // a pile still small waits
    expect(pickJob(view([quarry(3), kiln(0)]), 6, NO_CLAIMS, AT, false, undefined, 'gatherer')).toBeNull();
  });

  it('0.9.6 (F3): a full pile a processor still wants is fed, never sold; sold only when every hopper is full', () => {
    // shipper: the full quarry pile goes to the kiln, not the depot
    expect(pickJob(view([quarry(12), kiln(6)]), 6, NO_CLAIMS, AT, false, undefined, 'shipper')).toMatchObject({ type: 'feed', from: 0, to: 1 });
    expect(pickJob(view([quarry(12), kiln(0)]), 6, NO_CLAIMS, AT, false, undefined, 'shipper')).toMatchObject({ type: 'surplus', from: 0, to: 'depot' });
    // hauler: feeds first, and never sells a pile the kiln still has room for
    expect(pickJob(view([quarry(12), kiln(6)]), 6, NO_CLAIMS, AT, false, undefined, 'hauler')).toMatchObject({ type: 'feed' });
    const claims = { sources: new Map(), dests: new Map([['m1:stone', 6]]) };
    expect(pickJob(view([quarry(12), kiln(6)]), 6, claims, AT, false, undefined, 'hauler')).toMatchObject({ type: 'surplus', from: 0 });
    // clerk: never sells a wanted pile either
    expect(pickJob(view([quarry(12), kiln(6)]), 6, NO_CLAIMS, AT, false, undefined, 'clerk')).toBeNull();
  });

  it('foreman: material to a machine you are building, from a pile or the dock, and nothing else', () => {
    const site = { slot: 3, kind: 'stone' as const, room: 4, spot: { x: 20, z: 60 } };
    expect(pickJob(view([quarry(8)], {}, [site]), 6, NO_CLAIMS, AT, false, undefined, 'foreman')).toMatchObject({ type: 'build', item: 'stone', take: 4, from: 0 });
    expect(pickJob(view([], { stone: 2 }, [site]), 6, NO_CLAIMS, AT, false, undefined, 'foreman')).toMatchObject({ type: 'build', take: 2, from: 'dock' });
    expect(pickJob(view([quarry(8), kiln(8, 8)]), 6, NO_CLAIMS, AT, false, undefined, 'foreman')).toBeNull();
  });
});

describe('machine level upgrades', () => {
  it('one per era machine type, bought on its level pad, Lv 1 → 10 speeds the machine up to ×1.6', () => {
    for (let n = 2; n <= MAX_ERA; n++) {
      for (const id of machinesOfEra(n)) {
        const def = UPGRADES[id];
        expect(def.group, id).toBe('machine');
        expect(def.era).toBe(n);
        expect(def.label).toBe(MACHINES[id].label);
        expect(valueAt(def, 0)).toBe(1);
        expect(valueAt(def, 10)).toBeCloseTo(1.6, 6);
      }
    }
  });

  it('later eras cost more: every era starts its prices above the previous era\'s last level', () => {
    for (let n = 3; n <= MAX_ERA; n++) {
      const prev = ERAS[n - 1]!.key;
      expect(costAt(UPGRADES[`${ERAS[n]!.key}Rigs`], 0), `era ${n}`).toBeGreaterThan(costAt(UPGRADES[`${prev}Rigs`], 9));
    }
  });

  it('the level pad stands beside the machine, inside its cell, clear of the machine body and the next cell', () => {
    for (let n = 2; n <= MAX_ERA; n++) {
      const L = regionLayout(n);
      const p = levelPadLocal(MACHINE_NOMINAL.w, MACHINE_NOMINAL.d);
      const half = LEVEL_PAD_SIZE / 2;
      expect(-p.u - half, `era ${n}`).toBeGreaterThan(MACHINE_NOMINAL.w / 2); // off the machine
      expect(-p.u + half, `era ${n}`).toBeLessThan(L.cell / 2); // inside the cell
      expect(Math.abs(p.v) + half).toBeLessThanOrEqual(MACHINE_NOMINAL.d / 2 + 0.01);
      // 0.9.11: the MANAGE zone stands on the working side, in front of the level pad (never on it), clear of the feed
      // zone and short of the belt lane
      const f = machineFrame(MACHINE_NOMINAL.w, MACHINE_NOMINAL.d);
      const m = f.manage;
      expect(m.u1).toBeLessThan(-MACHINE_NOMINAL.w / 2);
      expect(m.u1 + 0.6).toBeLessThan(f.feed.u0);
      expect(-m.u0, `era ${n}`).toBeLessThan(L.cell / 2);
      expect(m.v0).toBeGreaterThan(p.v + half + 0.3);
      expect(m.v1).toBeLessThan(BELT_LANE - 0.35);
    }
  });
});

describe('conveyor belts (planBelts)', () => {
  const ext = { kind: 'extractor', inputs: [], output: 'stone' } as unknown as SlotMachines[number];
  const proc = { kind: 'processor', inputs: [{ kind: 'stone', per: 2 }], output: 'brick' } as unknown as SlotMachines[number];

  it('links each processor input to the nearest producer of that kind, one belt in and one out', () => {
    const L = regionLayout(2);
    const machines: SlotMachines = [ext, proc, ext, proc];
    const belts = planBelts(L, machines);
    expect(belts.length).toBe(2);
    expect(new Set(belts.map((b) => b.from)).size).toBe(2);
    expect(new Set(belts.map((b) => b.to)).size).toBe(2);
    for (const b of belts) expect(b.kind).toBe('stone');
  });

  it('0.9.6 (F3): a full era build belts every input in the natural order, and two thirds of them in any order', () => {
    for (let n = 2; n <= MAX_ERA; n++) {
      const L = regionLayout(n);
      const ids = contentMachines(n).filter((id): id is MachineId => id in MACHINES);
      const orders = [ids, [...ids].reverse(), [...ids.filter((id) => MACHINES[id].kind === 'processor'), ...ids.filter((id) => MACHINES[id].kind === 'extractor')]];
      for (const order of orders) {
        const machines: SlotMachines = L.slots.map((_, i) => MACHINES[order[i % order.length]!]);
        const belts = planBelts(L, machines);
        let inputs = 0;
        machines.forEach((m) => {
          if (m?.kind === 'processor') inputs += m.inputs.length;
        });
        expect(belts.length, `era ${n} ${order.join(',')}`).toBeGreaterThanOrEqual(order === ids && n <= 4 ? inputs : Math.floor((inputs * 2) / 3));
        expect(new Set(belts.map((b) => `${b.to}:${b.kind}`)).size).toBe(belts.length); // one belt into each input
        // two belts on the same level never share a stretch of lane
        for (const b of belts) expect(b.level).toBeLessThan(BELT_LEVELS);
      }
    }
  });

  it('nothing to link: no belts (an extractor alone, or a processor with no producer)', () => {
    const L = regionLayout(2);
    expect(planBelts(L, [ext] as never)).toEqual([]);
    expect(planBelts(L, [proc, null, proc] as never)).toEqual([]);
  });

  it('runs along the lane in front of the machines, and down a corridor beside a column boundary to the next row', () => {
    for (let n = 2; n <= MAX_ERA; n++) {
      const L = regionLayout(n);
      const cols = L.slots.filter((s) => Math.abs(s.z - L.slots[0]!.z) < 0.01).length;
      if (L.slots.length <= cols) continue;
      const same = beltRoute(L, 0, 1)!;
      expect(same).toHaveLength(2);
      const lane = toWorld(L.slots[0]!, L.slots[0]!.yaw, 0, BELT_LANE).z;
      expect(same[0]!.z).toBeCloseTo(lane, 6);
      // a belt into the next row: four points, the middle two on a corridor beside a boundary
      const down = beltRoute(L, 0, cols)!;
      expect(down, `era ${n}`).toHaveLength(4);
      const xb = down[1]!.x;
      const fromBoundary = (((xb - (L.slots[0]!.x - L.cell / 2)) % L.cell) + L.cell) % L.cell;
      expect(Math.min(fromBoundary, L.cell - fromBoundary), `era ${n}`).toBeCloseTo(CORRIDOR_OFFSET, 6);
      // two rows apart: no belt
      if (L.slots.length > 2 * cols) expect(beltRoute(L, 0, 2 * cols)).toBeNull();
      expect(rowOf(L, cols)).toBe(1);
    }
  });

  it('no belt runs over the workers\' row aisle or a level pad', () => {
    for (let n = 2; n <= MAX_ERA; n++) {
      const L = regionLayout(n);
      // the lane sits between the feed / take zones and the aisle on the row boundary (rowPitch / 2 in front)
      const frame = machineFrame(MACHINE_NOMINAL.w, MACHINE_NOMINAL.d);
      expect(BELT_LANE - 0.35).toBeGreaterThan(frame.feed.v1);
      expect(BELT_LANE + 0.35).toBeLessThan(L.rowPitch / 2);
      // a corridor belt on the +u side of the boundary (clear of that machine's body), clear of the next machine's
      // level pad and MANAGE zone on the other side
      const pad = levelPadLocal(MACHINE_NOMINAL.w, MACHINE_NOMINAL.d);
      expect(L.cell / 2 - CORRIDOR_OFFSET - 0.35).toBeGreaterThan(MACHINE_NOMINAL.w / 2);
      expect(L.cell / 2 - CORRIDOR_OFFSET + 0.35).toBeLessThan(L.cell + frame.manage.u0);
      expect(L.cell / 2 - CORRIDOR_OFFSET + 0.35).toBeLessThan(L.cell + pad.u - LEVEL_PAD_SIZE / 2);
      expect(L.cell / 2 + CORRIDOR_OFFSET + 0.35).toBeLessThan(L.cell + pad.u - LEVEL_PAD_SIZE / 2 + L.cell / 2);
    }
  });
});
