/** 0.9.12: finches, a cat and deer that come out near the player and keep their distance (world/life/Critters.ts). */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { GameContext } from '../src/core/types';
import { Critters } from '../src/world/life/Critters';

const stub = (dark: number) => {
  const player = { position: new THREE.Vector3(0, 0, 0), dog: null };
  const ctx = {
    player,
    dayNight: { darkness: dark },
    worldEvents: { active: null as string | null },
    colliders: { isFree: () => true, inBounds: () => true, overlaps: () => false },
  } as unknown as GameContext;
  return { ctx, player };
};
const run = (c: Critters, s: number) => {
  for (let t = 0; t < s; t += 0.1) c.update(0.1);
};
const birds = (c: Critters) => (c as unknown as { finches: { x: number; z: number; y: number }[] }).finches;

describe('critters', () => {
  it('finches land by day, fly off when the player walks up, and leave', () => {
    const { ctx, player } = stub(0);
    const c = new Critters(ctx);
    run(c, 60);
    expect(birds(c).length).toBeGreaterThan(0);
    const b = birds(c)[0];
    player.position.set(b.x + 1, 0, b.z);
    run(c, 0.5);
    expect(birds(c).every((f) => f.y > 0.3)).toBe(true);
    run(c, 15);
    expect(birds(c).length).toBe(0);
  });
  it('nothing comes out at night or in a storm', () => {
    const night = new Critters(stub(1).ctx);
    run(night, 90);
    expect(night.count).toBe(0);
    const s = stub(0);
    (s.ctx.worldEvents as { active: string | null }).active = 'snowstorm';
    const storm = new Critters(s.ctx);
    run(storm, 90);
    expect(storm.count).toBe(0);
  });
  it('every animal keeps its distance from the player', () => {
    const { ctx, player } = stub(0);
    const c = new Critters(ctx);
    const all = c as unknown as { cat: { x: number; z: number } | null; deer: { x: number; z: number }[] };
    let closest = Infinity;
    for (let t = 0; t < 240; t += 0.1) {
      player.position.x = Math.sin(t * 0.05) * 6;
      c.update(0.1);
      for (const a of [...(all.cat ? [all.cat] : []), ...all.deer]) closest = Math.min(closest, Math.hypot(a.x - player.position.x, a.z - player.position.z));
    }
    expect(closest).toBeGreaterThan(1);
  });
});
