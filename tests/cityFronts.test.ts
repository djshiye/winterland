/**
 * 0.9.14 city street level: shopfronts, front doors, rooftop life, chimney / beacon positions. No WebGL: the buildings
 * are plain geometry; only the window material needs a (stubbed) canvas.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createCityBuilding } from '../src/assets/cityBuildings';
import { CITY_BUILDINGS, CITY_BUILDING_IDS } from '../src/eras/data';

const noop: unknown = new Proxy(() => noop, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop), apply: () => noop });
vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });

const EPS = 0.002;

function bodyOf(id: string, seed: number) {
  const m = createCityBuilding(id, seed);
  const body = m.root.getObjectByName('body') as THREE.Mesh;
  return { m, pos: body.geometry.getAttribute('position') as THREE.BufferAttribute };
}

describe('city fronts', () => {
  for (const id of CITY_BUILDING_IDS) {
    const def = CITY_BUILDINGS[id];
    for (const seed of [0, 1, 2]) {
      it(`${id} (seed ${seed}): chimneys, beacons and the street-level envelope`, () => {
        const { m, pos } = bodyOf(id, seed);
        expect(Array.isArray(m.chimneys)).toBe(true);
        expect(Array.isArray(m.beacons)).toBe(true);
        for (const p of [...m.chimneys, ...m.beacons]) {
          expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
          expect(Math.abs(p.x)).toBeLessThanOrEqual(m.w / 2 + 0.05);
          expect(Math.abs(p.z)).toBeLessThanOrEqual(m.d / 2 + 0.05);
          expect(p.y).toBeGreaterThan(0);
        }
        const tall = m.height >= 9 || def.kind === 'landmark';
        expect(m.beacons.length).toBe(tall ? 1 : 0);
        if (def.era >= 6 && def.era <= 9 && (def.kind === 'home' || def.kind === 'work')) expect(m.chimneys.length).toBeGreaterThanOrEqual(1);
        // beacons stay under the drawn silhouette of the model (at most 10 cm above the tallest body vertex, i.e. on the mount)
        let maxY = 0;
        let box = new THREE.Box3();
        for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
        for (const b of m.beacons) expect(b.y).toBeLessThanOrEqual(maxY + 0.1);
        box = box.setFromBufferAttribute(pos);
        expect(box.max.x).toBeLessThanOrEqual(m.w / 2 + 0.6);

        // homes and shops of eras 3..10 keep to the lot: sides within 5 cm, the front within 45 cm, and whatever
        // reaches past 35 cm in front of the wall (awnings, canopies, sign lamps) hangs above 2.05 m
        if ((def.kind === 'home' || def.kind === 'work') && def.era >= 3) {
          const hw = m.w / 2 + 0.05 + EPS;
          const hd = m.d / 2;
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            expect(Math.abs(x)).toBeLessThanOrEqual(hw);
            expect(z).toBeGreaterThanOrEqual(-hd - 0.05 - EPS);
            expect(z).toBeLessThanOrEqual(hd + 0.45 + EPS);
            if (z > hd + 0.35 + EPS) expect(y).toBeGreaterThanOrEqual(2.05 - EPS);
          }
        }
      });
    }
  }

  it('geometry (and its chimney / beacon lists) is cached per building', () => {
    const a = createCityBuilding('steamWork', 1);
    const b = createCityBuilding('steamWork', 1);
    expect(a.chimneys).toBe(b.chimneys);
    expect(a.beacons).toBe(b.beacons);
    expect((a.root.getObjectByName('body') as THREE.Mesh).geometry).toBe((b.root.getObjectByName('body') as THREE.Mesh).geometry);
  });

  it('every chimney top sits on a chimney of the model (home / work with a b.chimney call have at least one)', () => {
    for (const id of ['frontierHome', 'ironWork', 'steamHome', 'steamWork'] as const) expect(createCityBuilding(id, 1).chimneys.length).toBeGreaterThan(0);
  });
});
