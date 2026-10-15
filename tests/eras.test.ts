/** Wave 9 world: eras table, era registry, district keep-out, fireworks scheduler. */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT, VILLAGE } from '../src/config';
import type { GameContext } from '../src/core/types';
import { Fireworks } from '../src/fx/Fireworks';
import { STALLS } from '../src/town/spots';
import { blocked } from '../src/world/env/common';
import { buildLampSet, LAMP_HEAD, LAMP_TOP, type LampSpot } from '../src/world/env/lamps';
import { CORRIDOR_LAMPS, SQUARE_LAMPS } from '../src/world/env/town';
import { villageLamps } from '../src/world/env/village';
import { applyEra, currentEra, eraFor, eraLabel, registerEra, resetEras, romanNumeral } from '../src/world/env/eras';

// The halo mesh paints a canvas texture (DOM); everything else of glow.ts is real. Halos are checked separately.
vi.mock('../src/world/env/glow', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/world/env/glow')>();
  return { ...real, buildHalos: () => new THREE.Mesh() };
});

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
    expect(eraLabel(3)).toBe('Settlement III · Town');
    expect(eraLabel(4)).toBe('Settlement IV · Winter City');
    expect(eraLabel(5)).toBe('Settlement V · Winterland');
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

describe('lamp variants', () => {
  // Lamps are NOT instanced: each generation is one baked post mesh + one glow mesh (merged geometry), so the
  // "instance matrix" of a lamp is its vertices. Every vertex must be finite and stay within one lamp's footprint.
  const sets: ReadonlyArray<[string, readonly LampSpot[]]> = [
    ['village street', villageLamps()],
    ['town', [...SQUARE_LAMPS, ...CORRIDOR_LAMPS]],
  ];
  const kinds = ['torch', 'lantern', 'iron'] as const;
  const REACH = 0.6; // widest part of any lamp (iron roof / torch bowl) from its post
  const MAX_Y = 3.8; // iron finial is 3.58

  for (const [label, spots] of sets) {
    for (const kind of kinds) {
      it(`${label}: ${kind} lamps are finite, ground-standing and inside their own footprint`, () => {
        const group = buildLampSet(kind, spots);
        expect(group.name).toBe(`lamps-${kind}`);
        const meshes: THREE.Mesh[] = [];
        group.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
        });
        expect(meshes.length).toBeGreaterThanOrEqual(2);
        group.updateMatrixWorld(true);
        for (const m of meshes) {
          expect((m as unknown as THREE.InstancedMesh).isInstancedMesh).toBeFalsy();
          // a visible lamp part must not carry a scale at all (identity transform, nothing to go stale)
          const s = new THREE.Vector3().setFromMatrixScale(m.matrixWorld);
          expect([s.x, s.y, s.z]).toEqual([1, 1, 1]);
          const pos = m.geometry.getAttribute('position');
          if (!pos) continue; // stubbed halo
          let minY = Infinity;
          let maxY = -Infinity;
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            expect(Number.isFinite(x + y + z)).toBe(true);
            const near = spots.some((sp) => Math.abs(x - sp.x) <= REACH && Math.abs(z - sp.z) <= REACH);
            if (!near) throw new Error(`${kind} vertex (${x}, ${y}, ${z}) is not within ${REACH} m of any lamp`);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
          expect(minY).toBeGreaterThanOrEqual(-0.1);
          expect(maxY).toBeLessThanOrEqual(MAX_Y);
        }
      });
    }
  }

  it('every lamp head sits at its generation height and the strings attach above it', () => {
    for (const kind of kinds) expect(LAMP_TOP[kind]).toBeGreaterThan(LAMP_HEAD[kind]);
    expect(LAMP_HEAD.torch).toBeLessThan(LAMP_HEAD.lantern);
    expect(LAMP_HEAD.lantern).toBeLessThan(LAMP_HEAD.iron);
  });

  it('keeps the corridor-mouth lamp out of the village street and every lamp clear of the market stalls', () => {
    const street = LAYOUT.village.street;
    for (const sp of villageLamps()) expect(sp.x === street.minX + 0.05 || sp.x === street.maxX - 0.05).toBe(true);
    expect(villageLamps().some((sp) => sp.x === street.maxX - 0.05 && sp.z >= LAYOUT.town.gate.minZ - 0.8)).toBe(false);
    for (const st of STALLS) {
      for (const sp of [...SQUARE_LAMPS, ...CORRIDOR_LAMPS]) expect(Math.hypot(sp.x - st.x, sp.z - st.z)).toBeGreaterThan(1.2);
    }
  });
});
