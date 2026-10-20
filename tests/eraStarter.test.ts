/** 0.9.7: the five-step starter guide of each new era region, and the era colour contrast check. */
import { describe, expect, it } from 'vitest';
import { EraStarter, NODE_LINGER, NODE_SECONDS, READ_SECONDS, WALK_SECONDS, RESOURCE_LINES, STARTER_STEPS, starterFlag, starterSteps, type StarterInput } from '../src/progression/eraStarter';
import { ERAS } from '../src/eras/data';
import { ERA_NODES } from '../src/assets/eraNodes';
import { contrast, readableOn } from '../src/ui/contrast';
import { regionLayout } from '../src/eras/layout';
import { DEPOT_FRAME, DOCK_FRAME, worldRect } from '../src/eras/rules';
import { DOCK_BODY, STALL_BODY, marketPlaces } from '../src/eras/market';
import { PLAYER } from '../src/config';
import type { ItemKind } from '../src/core/types';

const input = (over: Partial<StarterInput> = {}): StarterInput => ({
  here: 5,
  age: 5,
  started: false,
  flags: {},
  player: { x: -9999, z: -9999 },
  carrying: () => 0,
  ...over,
});

describe('era starter guide', () => {
  it('has five numbered steps for every era 2..10: resource, node, mat, dock, rule', () => {
    for (let n = 2; n <= 10; n++) {
      const steps = starterSteps(n);
      expect(steps).toHaveLength(STARTER_STEPS);
      steps.forEach((s, i) => expect(s.text.startsWith(`${i + 1}/5 · `)).toBe(true));
      expect(steps.map((s) => s.kind)).toEqual(['read', 'node', 'walk', 'walk', 'read']);
      expect(steps[0]!.text).toContain(ERAS[n]!.region);
      expect(steps[1]!.text).toContain(ERA_NODES[n]!.name);
      expect(steps[1]!.spot).not.toBeNull();
      expect(steps[2]!.text).toContain('shop mat');
      expect(steps[3]!.text).toContain('dock');
      expect(steps[4]!.text).toContain('Lv 10');
    }
    expect(starterSteps(1)).toEqual([]);
  });

  it("names era resources v2 (iron pellets + coke, chips from silicon, rare earths + helium-3)", () => {
    expect(RESOURCE_LINES[5]).toContain('iron pellets and coke');
    expect(RESOURCE_LINES[8]).toContain('silicon');
    expect(RESOURCE_LINES[8]).toContain('chips');
    expect(RESOURCE_LINES[10]).toContain('rare earths and helium-3');
    expect(starterSteps(10)[4]!.text).toContain('last pieces');
  });

  it('walks through the steps and marks the era done once', () => {
    const g = new EraStarter();
    const steps = starterSteps(5);
    const done: number[] = [];
    const tick = (s: StarterInput, dt = 0.25) => g.update(dt, s, (n) => done.push(n));
    expect(tick(input())!.text).toBe(steps[0]!.text);
    let cur = tick(input(), READ_SECONDS);
    expect(cur!.text).toBe(steps[1]!.text);
    // node: done once the raw is in hand
    const raw = ERA_NODES[5]!.yields as ItemKind;
    cur = tick(input({ carrying: (k) => (k === raw ? 1 : 0) }));
    expect(cur!.text).toBe(steps[2]!.text);
    // mat, then dock: done on stepping onto them
    cur = tick(input({ player: steps[2]!.spot! }));
    expect(cur!.text).toBe(steps[3]!.text);
    cur = tick(input({ player: steps[3]!.spot! }));
    expect(cur!.text).toBe(steps[4]!.text);
    expect(tick(input(), READ_SECONDS)).toBeNull();
    expect(done).toEqual([5]);
    expect(tick(input())).toBeNull();
  });

  it('a node visit counts after a short linger even before anything is picked up', () => {
    const g = new EraStarter();
    const steps = starterSteps(3);
    g.update(READ_SECONDS, input({ here: 3, age: 3 }), () => undefined);
    const at = input({ here: 3, age: 3, player: steps[1]!.spot! });
    expect(g.update(0.25, at, () => undefined)!.text).toBe(steps[1]!.text);
    g.update(0.25, at, () => undefined);
    expect(g.update(NODE_LINGER, at, () => undefined)!.text).toBe(steps[2]!.text);
  });

  it('the node step moves on by itself after NODE_SECONDS, so it never sticks either (0.9.10)', () => {
    const g = new EraStarter();
    const steps = starterSteps(4);
    const away = input({ here: 4, age: 4 });
    g.update(READ_SECONDS, away, () => undefined);
    expect(g.update(NODE_SECONDS - 1, away, () => undefined)!.text).toBe(steps[1]!.text);
    expect(g.update(1, away, () => undefined)!.text).toBe(steps[2]!.text);
  });

  it('never starts in an older region, a started one, or one already seen; leaving and coming back carries on', () => {
    expect(new EraStarter().update(1, input({ here: 4, age: 5 }), () => undefined)).toBeNull();
    expect(new EraStarter().update(1, input({ started: true }), () => undefined)).toBeNull();
    expect(new EraStarter().update(1, input({ flags: { [starterFlag(5)]: true } }), () => undefined)).toBeNull();
    const g = new EraStarter();
    g.update(READ_SECONDS, input(), () => undefined);
    g.update(0.25, input(), () => undefined);
    expect(g.update(0.25, input({ here: 0 }), () => undefined)).toBeNull();
    expect(g.update(0.25, input(), () => undefined)!.text).toBe(starterSteps(5)[1]!.text);
  });
});

describe('era starter targets are walkable', () => {
  type R = { minX: number; maxX: number; minZ: number; maxZ: number };
  /** The solid boxes a fresh region adds (nothing built yet), grown by the player's radius. */
  const solids = (n: number): R[] => {
    const L = regionLayout(n);
    const P = marketPlaces(L);
    const r = PLAYER.radius;
    return [
      worldRect(L.dock, L.facilityYaw, DOCK_FRAME.body),
      worldRect(L.depot, L.facilityYaw, DEPOT_FRAME.body),
      worldRect(P.dock, P.yaw, DOCK_BODY),
      worldRect(P.stall, P.yaw, STALL_BODY),
    ].map((b) => ({ minX: b.minX - r, maxX: b.maxX + r, minZ: b.minZ - r, maxZ: b.maxZ + r }));
  };
  const blocked = (x: number, z: number, boxes: R[]): boolean => boxes.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);

  it('every walking step can be reached: its centre is clear of every solid box (era 2..10)', () => {
    for (let n = 2; n <= 10; n++) {
      const boxes = solids(n);
      for (const s of starterSteps(n).filter((s) => s.kind === 'walk')) {
        expect(s.spot, `era ${n}: ${s.text}`).not.toBeNull();
        expect(blocked(s.spot!.x, s.spot!.z, boxes), `era ${n}: ${s.text}`).toBe(false);
      }
    }
  });

  it("the dock step points at the strip in front of the dock, never inside its body", () => {
    for (let n = 2; n <= 10; n++) {
      const L = regionLayout(n);
      const body = worldRect(L.dock, L.facilityYaw, DOCK_FRAME.body);
      const s = starterSteps(n)[3]!;
      const zone = { minX: s.spot!.x - s.w / 2, maxX: s.spot!.x + s.w / 2, minZ: s.spot!.z - s.d / 2, maxZ: s.spot!.z + s.d / 2 };
      const overlaps = zone.minX < body.maxX && zone.maxX > body.minX && zone.minZ < body.maxZ && zone.maxZ > body.minZ;
      expect(overlaps, `era ${n}`).toBe(false);
      // the same place the dock's give / take zones sit, so stepping there is what using the dock is
      const give = worldRect(L.dock, L.facilityYaw, DOCK_FRAME.give);
      expect(give.minX >= zone.minX - 1e-9 && give.maxX <= zone.maxX + 1e-9 && give.minZ >= zone.minZ - 1e-9 && give.maxZ <= zone.maxZ + 1e-9).toBe(true);
    }
  });

  it('a walking step moves on by itself after WALK_SECONDS, so the banner never sticks', () => {
    const g = new EraStarter();
    const steps = starterSteps(6);
    const at = input({ here: 6, age: 6 });
    g.update(READ_SECONDS, at, () => undefined);
    g.update(0.25, at, () => undefined);
    g.update(READ_SECONDS, at, () => undefined); // node: no spot reached, no raw
    expect(g.update(NODE_LINGER, input({ here: 6, age: 6, player: steps[1]!.spot! }), () => undefined)!.text).toBe(steps[2]!.text);
    expect(g.update(WALK_SECONDS - 1, at, () => undefined)!.text).toBe(steps[2]!.text);
    expect(g.update(1, at, () => undefined)!.text).toBe(steps[3]!.text);
    expect(g.update(WALK_SECONDS, at, () => undefined)!.text).toBe(steps[4]!.text);
  });
});

describe('era colour contrast', () => {
  it('lightened era accents read at 3:1 on the dark map blocks and cards', () => {
    for (let n = 2; n <= 10; n++) {
      const a = ERAS[n]!.colors.accent;
      for (const bg of [0x4a5672, 0x2a3652]) expect(contrast(readableOn(a, bg), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps an accent that already reads unchanged', () => {
    expect(readableOn(0xffd84a, 0x2a3652)).toBe(0xffd84a);
  });
});
