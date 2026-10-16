/**
 * 1.0 expansion: the new era 8–10 machine models (assets/eraMachines4.ts). Each one is exactly body + glow + one pivot,
 * fits the 5.2 × 5.2 m footprint (even with the animated part at any angle), stays under 6 m, keeps the front pallet
 * spots clear and moves far enough to read from the default camera.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ERA4_MACHINE_IDS, ERA4_MACHINES, createEraMachine4, eraMachine4Catalog } from '../src/assets/eraMachines4';
import { ASSET_CATALOG } from '../src/assets/AssetFactory';

const MAX_FOOTPRINT = 5.2;

function meshes(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh);
  });
  return out;
}

function bounds(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o, true);
}

describe('era 8–10 machine models', () => {
  it('covers the nine new machines and is in the gallery', () => {
    expect(ERA4_MACHINE_IDS).toHaveLength(9);
    expect(ERA4_MACHINE_IDS.filter((id) => ERA4_MACHINES[id].era === 8)).toHaveLength(4);
    expect(ERA4_MACHINE_IDS.filter((id) => ERA4_MACHINES[id].era === 9)).toHaveLength(3);
    expect(ERA4_MACHINE_IDS.filter((id) => ERA4_MACHINES[id].era === 10)).toHaveLength(2);
    for (const id of ERA4_MACHINE_IDS) expect(eraMachine4Catalog[id]).toBeTypeOf('function');
    expect(ASSET_CATALOG.eraMachines4).toBe(eraMachine4Catalog);
    expect(meshes(eraMachine4Catalog.eras8to10!()).length).toBe(27);
  });

  for (const id of ERA4_MACHINE_IDS) {
    describe(id, () => {
      const m = createEraMachine4(id);

      it('is exactly body + glow + pivot', () => {
        expect(m.root.name).toBe(`machine:${id}:${ERA4_MACHINES[id].era}`);
        expect(meshes(m.root).map((x) => x.name)).toEqual(['body', 'glow', 'pivot']);
      });

      it('fits the 5.2 × 5.2 m footprint, under 6 m, centred, and reports its size', () => {
        const box = bounds(m.root);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        expect(size.x).toBeLessThanOrEqual(MAX_FOOTPRINT);
        expect(size.z).toBeLessThanOrEqual(MAX_FOOTPRINT);
        expect(box.max.y).toBeLessThanOrEqual(6.0);
        expect(m.w).toBeGreaterThanOrEqual(size.x - 0.01);
        expect(m.d).toBeGreaterThanOrEqual(size.z - 0.01);
        expect(Math.abs(centre.x)).toBeLessThan(0.5);
        expect(Math.abs(centre.z)).toBeLessThan(0.5);
      });

      it('keeps the input / output pallet spots clear', () => {
        // pallets are 1.2 × 1.2 m at (∓1.6, +1.8); only the plinth and snow drifts (below 0.4 m) may sit there
        for (const mesh of meshes(m.root)) {
          const pos = mesh.geometry.getAttribute('position');
          const v = new THREE.Vector3();
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            mesh.localToWorld(v);
            const onPallet = Math.abs(Math.abs(v.x) - 1.6) < 0.55 && v.z > 1.3 && v.z < 2.35;
            if (onPallet) expect(v.y).toBeLessThan(0.4);
          }
        }
      });

      it('animates visibly (≥ 0.35 m travel or ≥ 0.6 m radius) and stays inside 5.2 m', () => {
        const pivot = m.root.getObjectByName('pivot') as THREE.Mesh;
        pivot.geometry.computeBoundingBox();
        const gb = pivot.geometry.boundingBox!;
        const radius = Math.max(Math.abs(gb.min.x), Math.abs(gb.max.x), Math.abs(gb.min.y), Math.abs(gb.max.y), Math.abs(gb.min.z), Math.abs(gb.max.z));
        const start = pivot.position.clone();
        let travel = 0;
        let worst = 0;
        for (let i = 0; i < 400; i++) {
          m.animate(0.05, true);
          travel = Math.max(travel, pivot.position.distanceTo(start));
          const s = bounds(m.root).getSize(new THREE.Vector3());
          worst = Math.max(worst, s.x, s.z);
        }
        expect(worst).toBeLessThanOrEqual(MAX_FOOTPRINT + 0.001);
        expect(travel >= 0.35 || radius >= 0.6).toBe(true);
        expect(() => m.animate(0.016, false)).not.toThrow();
      });
    });
  }

  it('builds distinct instances that share geometry', () => {
    const a = createEraMachine4('quantumLab');
    const b = createEraMachine4('quantumLab');
    expect(a.root).not.toBe(b.root);
    expect(meshes(a.root)[0]!.geometry).toBe(meshes(b.root)[0]!.geometry);
  });
});
