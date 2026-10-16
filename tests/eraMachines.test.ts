/**
 * 0.9.0 era machine models: every MachineId builds, stays inside its footprint (even with the animated part at any
 * angle), uses ≤ 3 meshes (depot / dock ≤ 2) and animates without throwing.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MACHINE_IDS, MACHINES, MAX_ERA } from '../src/eras/data';
import { createDepotModel, createDockModel, createMachineModel, eraMachineCatalog } from '../src/assets/eraMachines';

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
  return new THREE.Box3().setFromObject(o);
}

describe('era machine models', () => {
  it('covers every machine id', () => {
    expect(MACHINE_IDS.length).toBeGreaterThanOrEqual(31); // 22 from 0.9.0 + 9 era 2-4 machines in 0.9.5
    for (const id of MACHINE_IDS) expect(eraMachineCatalog[id]).toBeTypeOf('function');
  });

  for (const id of MACHINE_IDS) {
    describe(id, () => {
      const m = createMachineModel(id);

      it('builds a named group with ≤ 3 meshes', () => {
        expect(m.root.name).toBe(`machine:${id}:${MACHINES[id].era}`);
        const list = meshes(m.root);
        expect(list.length).toBeGreaterThanOrEqual(1);
        expect(list.length).toBeLessThanOrEqual(3);
        expect(list.filter((x) => x.name === 'pivot').length).toBeLessThanOrEqual(1);
      });

      it('fits the 5.2 × 5.2 m footprint and reports it, centred', () => {
        const size = bounds(m.root).getSize(new THREE.Vector3());
        const centre = bounds(m.root).getCenter(new THREE.Vector3());
        expect(size.x).toBeLessThanOrEqual(MAX_FOOTPRINT);
        expect(size.z).toBeLessThanOrEqual(MAX_FOOTPRINT);
        expect(size.y).toBeLessThanOrEqual(6.6);
        expect(m.w).toBeGreaterThanOrEqual(size.x - 0.01);
        expect(m.d).toBeGreaterThanOrEqual(size.z - 0.01);
        expect(Math.abs(m.w - size.x)).toBeLessThanOrEqual(0.3);
        expect(Math.abs(m.d - size.z)).toBeLessThanOrEqual(0.3);
        expect(Math.abs(centre.x)).toBeLessThan(0.7);
        expect(Math.abs(centre.z)).toBeLessThan(0.7);
      });

      it('animates (working and idle) without throwing, and the animated part stays inside 5.2 m', () => {
        const pivot = m.root.getObjectByName('pivot');
        const before = pivot ? pivot.matrix.clone().elements.join() : '';
        let worst = 0;
        for (let i = 0; i < 400; i++) {
          m.animate(0.05, true);
          m.root.updateMatrixWorld(true);
          const s = new THREE.Box3().setFromObject(m.root, true).getSize(new THREE.Vector3());
          worst = Math.max(worst, s.x, s.z);
        }
        expect(worst).toBeLessThanOrEqual(MAX_FOOTPRINT + 0.001);
        expect(() => m.animate(0.016, false)).not.toThrow();
        expect(() => m.animate(0, true)).not.toThrow();
        if (pivot) {
          pivot.updateMatrix();
          expect(pivot.matrix.elements.join()).not.toBe(before);
        }
      });
    });
  }

  it('builds distinct instances that share geometry', () => {
    const a = createMachineModel('reactor');
    const b = createMachineModel('reactor');
    expect(a.root).not.toBe(b.root);
    expect(meshes(a.root)[0]!.geometry).toBe(meshes(b.root)[0]!.geometry);
  });
});

describe('era depot and dock', () => {
  for (let era = 2; era <= MAX_ERA; era++) {
    it(`era ${era}: depot and dock are ≤ 2 meshes, ~3 × 2.4 m`, () => {
      for (const g of [createDepotModel(era), createDockModel(era)]) {
        expect(meshes(g).length).toBeLessThanOrEqual(2);
        const size = bounds(g).getSize(new THREE.Vector3());
        expect(size.x).toBeGreaterThan(2.2);
        expect(size.x).toBeLessThanOrEqual(3.6);
        expect(size.z).toBeGreaterThan(1.6);
        expect(size.z).toBeLessThanOrEqual(3.0);
        expect(size.y).toBeLessThanOrEqual(3.2);
      }
    });
  }
});
