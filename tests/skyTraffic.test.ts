/** 0.9.12: each era's fliers over its area (world/life/SkyTraffic.ts). */
import { describe, expect, it } from 'vitest';
import { REGIONS } from '../src/eras/data';
import { kindFor, loopAt, loopsFor } from '../src/world/life/SkyTraffic';

describe('sky traffic', () => {
  it('sleighs over eras II-IV, airships over V-VII, drones over VIII-X', () => {
    expect([2, 3, 4].map(kindFor)).toEqual(['sleigh', 'sleigh', 'sleigh']);
    expect([5, 6, 7].map(kindFor)).toEqual(['airship', 'airship', 'airship']);
    expect([8, 9, 10].map(kindFor)).toEqual(['drone', 'drone', 'drone']);
    expect(kindFor(0)).toBeNull();
  });
  it('every loop shows over its own area (seen from the camera, a flier sits over the ground half its height nearer the far side), and a flier always faces the way it flies', () => {
    for (let n = 2; n <= 10; n++) {
      const R = REGIONS[n]!.rect;
      for (const l of loopsFor(n)) {
        for (let th = 0; th < Math.PI * 2; th += 0.05) {
          const a = loopAt(l, th);
          const b = loopAt(l, th + 0.01);
          const gx = a.x - l.y * 0.5;
          const gz = a.z - l.y * 0.5;
          expect(gx, `era ${n}`).toBeGreaterThan(R.minX);
          expect(gx, `era ${n}`).toBeLessThan(R.maxX);
          expect(gz, `era ${n}`).toBeGreaterThan(R.minZ);
          expect(gz, `era ${n}`).toBeLessThan(R.maxZ);
          const mx = b.x - a.x;
          const mz = b.z - a.z;
          expect((mx * a.fx + mz * a.fz) / Math.hypot(mx, mz)).toBeGreaterThan(0.99);
        }
      }
    }
  });
  it('fliers cruise clear of the roofs yet close enough that a flier and its shadow share the screen, and the shadows are one instanced draw', async () => {
    for (let n = 2; n <= 10; n++) for (const l of loopsFor(n)) {
      expect(l.y, `era ${n}`).toBeGreaterThanOrEqual(10);
      expect(l.y * 0.67, `era ${n}: flier and shadow on one 16 m screen`).toBeLessThanOrEqual(11);
    }
    const { SkyTraffic } = await import('../src/world/life/SkyTraffic');
    const THREE = await import('three');
    const ctx = { state: { eras: { age: 8 } }, player: { position: new THREE.Vector3() } } as never;
    const t = new SkyTraffic(ctx);
    t.update(0.1);
    const sh = t.group.children.find((c) => c.name === 'sky-shadows') as import('three').InstancedMesh;
    expect(sh.isInstancedMesh).toBe(true);
    expect(sh.count).toBe(9);
    expect(sh.frustumCulled).toBe(false);
  });
});

describe('sky traffic in the world', () => {
  it('each open era area gets its fliers, and only those', async () => {
    const { SkyTraffic } = await import('../src/world/life/SkyTraffic');
    const THREE = await import('three');
    const state = { eras: { age: 1 } };
    const ctx = { state, player: { position: new THREE.Vector3() } } as never;
    const t = new SkyTraffic(ctx);
    t.update(0.1);
    expect(t.shown).toBe(0);
    state.eras.age = 8;
    t.update(0.1);
    // sleighs II-IV, airships V-VII, three drones over VIII
    expect(t.shown).toBe(3 + 3 + 3);
  });
});
