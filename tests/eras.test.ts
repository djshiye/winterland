/** Wave 9 world: eras table, era registry, district keep-out, fireworks scheduler. */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT, VILLAGE } from '../src/config';
import type { GameContext } from '../src/core/types';
import { Fireworks } from '../src/fx/Fireworks';
import { blocked } from '../src/world/env/common';
import { applyEra, currentEra, eraFor, eraLabel, registerEra, resetEras, romanNumeral } from '../src/world/env/eras';

afterEach(() => resetEras());

describe('eraFor', () => {
  it('gives torches, lanterns, then iron lamps; the street goes snow, gravel, cobbles', () => {
    expect(['torch', 'torch', 'lantern', 'iron', 'iron', 'iron']).toEqual(VILLAGE.levels.map((_, i) => eraFor(i).lamp));
    expect(['snow', 'snow', 'gravel', 'cobble', 'cobble', 'cobble']).toEqual(VILLAGE.levels.map((_, i) => eraFor(i).surface));
  });

  it('adds bunting at Town, festive lights at Winter City and sparkle at Winterland', () => {
    const flags = (l: number): string => {
      const e = eraFor(l);
      return `${+e.bunting}${+e.festive}${+e.sparkle}`;
    };
    expect(VILLAGE.levels.map((_, i) => flags(i))).toEqual(['000', '000', '000', '100', '110', '111']);
  });

  it('clamps out-of-range and junk levels', () => {
    expect(eraFor(-3).level).toBe(0);
    expect(eraFor(99).level).toBe(VILLAGE.levels.length - 1);
    expect(eraFor(Number.NaN).level).toBe(0);
    expect(eraFor(2.9).level).toBe(2);
  });
});

describe('era labels', () => {
  it('writes "Era III · Town" and leaves the Camp unnumbered', () => {
    expect(eraLabel(3)).toBe('Era III · Town');
    expect(eraLabel(4)).toBe('Era IV · Winter City');
    expect(eraLabel(5)).toBe('Era V · Winterland');
    expect(eraLabel(0)).toBe('Camp');
    expect(romanNumeral(0)).toBe('');
    expect(romanNumeral(4)).toBe('IV');
  });
});

describe('era registry', () => {
  it('calls listeners on change only, and brings late registrants up to date at once', () => {
    const a = vi.fn();
    registerEra(a);
    expect(a).not.toHaveBeenCalled();
    applyEra(2);
    applyEra(2);
    expect(a).toHaveBeenCalledTimes(1);
    applyEra(3);
    expect(a).toHaveBeenCalledTimes(2);
    expect(a.mock.calls[1]![0].lamp).toBe('iron');
    const late = vi.fn();
    registerEra(late);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late.mock.calls[0]![0].level).toBe(3);
    expect(currentEra()?.level).toBe(3);
  });
});

describe('decor keep-out', () => {
  const T = LAYOUT.town;
  const mid = (a: number, b: number): number => (a + b) / 2;

  it('keeps pines and rocks off the market district and its corridor', () => {
    expect(blocked(mid(T.area.minX, T.area.maxX), mid(T.area.minZ, T.area.maxZ), 1)).toBe(true);
    expect(blocked(T.tree.x, T.tree.z, 1)).toBe(true);
    for (const l of T.lots) expect(blocked(l.x, l.z, 1)).toBe(true);
    const c = T.walk[0]!;
    expect(blocked(mid(c.minX, c.maxX), mid(c.minZ, c.maxZ), 1)).toBe(true);
  });

  it('still keeps the sled lane clear and leaves open snow beyond the district', () => {
    expect(blocked(40, 9.2, 1)).toBe(true);
    expect(blocked(25, 7.8, 0.5)).toBe(true);
    expect(blocked(T.area.maxX + 6, mid(T.area.minZ, T.area.maxZ), 1)).toBe(false);
  });
});

describe('Fireworks', () => {
  function make(darkness = 0, townRevealed = false) {
    const rocket = vi.fn();
    const handlers = new Map<string, (e: unknown) => void>();
    const ctx = {
      addUpdatable: vi.fn(),
      events: { on: (n: string, f: (e: unknown) => void) => handlers.set(n, f) },
      dayNight: { darkness },
      state: { town: { revealed: townRevealed } },
      particles: { rocket },
      audio: { play: vi.fn() },
    } as unknown as GameContext;
    const fw = new Fireworks(ctx);
    return { fw, rocket, handlers, ctx };
  }
  const run = (fw: Fireworks, seconds: number): void => {
    for (let t = 0; t < seconds; t += 1 / 30) fw.update(1 / 30);
  };

  it('launches exactly `count` rockets over time and then goes idle', () => {
    const { fw, rocket } = make();
    fw.launch(new THREE.Vector3(24, 0, 27), 6, { interval: 0.3 });
    expect(fw.pending).toBe(6);
    expect(rocket).not.toHaveBeenCalled();
    run(fw, 8);
    expect(rocket).toHaveBeenCalledTimes(6);
    expect(fw.pending).toBe(0);
    const opts = rocket.mock.calls[0]![1] as { height: number };
    expect(opts.height).toBeGreaterThanOrEqual(7);
    expect(opts.height).toBeLessThanOrEqual(11);
  });

  it('is pooled: it never queues more than its fixed number of slots', () => {
    const { fw } = make();
    fw.launch(new THREE.Vector3(), 500);
    expect(fw.pending).toBe(40);
  });

  it('shows on level-ups from Town (3) up only, and more at night', () => {
    const day = make(0);
    day.handlers.get('village:levelUp')!({ level: 2, position: new THREE.Vector3() });
    expect(day.fw.pending).toBe(0);
    day.handlers.get('village:levelUp')!({ level: 3, position: new THREE.Vector3(4, 0, 20) });
    const dayCount = day.fw.pending;
    expect(dayCount).toBeGreaterThan(0);
    const night = make(1);
    night.handlers.get('village:levelUp')!({ level: 3, position: new THREE.Vector3(4, 0, 20) });
    expect(night.fw.pending).toBeGreaterThan(dayCount);
  });
});
