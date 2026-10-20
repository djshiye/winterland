/** 0.9.12: footprints in the snow (world/life/Footprints.ts). */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { GameContext } from '../src/core/types';
import { Crowd } from '../src/npc/Crowd';
import { Footprints } from '../src/world/life/Footprints';

const stub = () => {
  const player = { position: new THREE.Vector3(0, 0, 0), dog: null };
  return { player, ctx: { player } as unknown as GameContext };
};

describe('footprints', () => {
  it('a walk leaves a print about every stride, left and right of the path, that fill back in', () => {
    const { ctx, player } = stub();
    const f = new Footprints(ctx);
    for (let t = 0; t < 4; t += 0.0125) {
      player.position.z += 0.05;
      f.update(0.0125);
    }
    // 16 m walked at a 0.42 m stride
    expect(f.live).toBeGreaterThan(34);
    expect(f.live).toBeLessThan(40);
    const xs = new Set<number>();
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < f.mesh.count; i++) {
      f.mesh.getMatrixAt(i, m);
      xs.add(Math.sign(p.setFromMatrixPosition(m).x));
    }
    expect([...xs].sort()).toEqual([-1, 1]);
    f.update(60);
    expect(f.live).toBe(0);
  });
  it('standing still or jumping across the map leaves none', () => {
    const { ctx, player } = stub();
    const f = new Footprints(ctx);
    for (let t = 0; t < 2; t += 0.05) f.update(0.05);
    player.position.set(40, 0, 40);
    f.update(0.05);
    expect(f.live).toBe(0);
  });
  it('townsfolk walking nearby leave prints; skaters and sitters do not', () => {
    const { ctx } = stub();
    const f = new Footprints(ctx);
    const walkers = new Crowd(4);
    const skaters = new Crowd(4);
    skaters.prints = false;
    const a = walkers.acquire(0xff0000, 0xffffff)!;
    const b = walkers.acquire(0xff0000, 0xffffff)!;
    const c = skaters.acquire(0xff0000, 0xffffff)!;
    for (const p of [a, b, c]) p.appear = 1;
    b.sit = 1;
    for (let t = 0; t < 2; t += 0.05) {
      for (const p of [a, b, c]) p.x += 0.1;
      f.update(0.05);
    }
    // one walker, 4 m: a print every stride (each one lands a little past 0.42 m at this pace)
    expect(f.live).toBeGreaterThanOrEqual(6);
    expect(f.live).toBeLessThanOrEqual(9);
    walkers.dispose();
    skaters.dispose();
  });
});
