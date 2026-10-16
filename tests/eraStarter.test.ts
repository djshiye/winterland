/** 0.9.7: the five-step starter guide of each new era region, and the era colour contrast check. */
import { describe, expect, it } from 'vitest';
import { EraStarter, NODE_LINGER, READ_SECONDS, RESOURCE_LINES, STARTER_STEPS, starterFlag, starterSteps, type StarterInput } from '../src/progression/eraStarter';
import { ERAS } from '../src/eras/data';
import { ERA_NODES } from '../src/assets/eraNodes';
import { contrast, readableOn } from '../src/ui/contrast';
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
    expect(starterSteps(10)[4]!.text).toContain('100 %');
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
