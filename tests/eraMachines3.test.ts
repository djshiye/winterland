/**
 * 1.0 expansion: the new era 5–7 machine models build, stay inside the 5.2 × 5.2 × 6 m envelope (even with the
 * animated part at any phase), use exactly body + glow + one pivot, and animate without throwing.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ERA5_7_MACHINE_ERA, ERA5_7_MACHINE_IDS, createEra5to7MachineModel, eraMachine3Catalog } from '../src/assets/eraMachines3';

const MAX_FOOTPRINT = 5.2;

function meshes(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh);
  });
  return out;
}

describe('era 5–7 machine models', () => {
  it('lists the 11 new machines with their eras and a gallery entry each', () => {
    expect(ERA5_7_MACHINE_IDS).toHaveLength(11);
    for (const id of ERA5_7_MACHINE_IDS) expect(eraMachine3Catalog[id]).toBeTypeOf('function');
    for (const era of [5, 6, 7]) expect(eraMachine3Catalog[`era${era}new`]).toBeTypeOf('function');
  });

  for (const id of ERA5_7_MACHINE_IDS) {
    describe(id, () => {
      const m = createEra5to7MachineModel(id);

      it('is body + glow + one pivot', () => {
        expect(m.root.name).toBe(`machine:${id}:${ERA5_7_MACHINE_ERA[id]}`);
        expect(meshes(m.root).map((x) => x.name).sort()).toEqual(['body', 'glow', 'pivot']);
      });

      it('fits the envelope, centred, and reports its footprint', () => {
        m.root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(m.root);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        expect(size.x).toBeLessThanOrEqual(MAX_FOOTPRINT);
        expect(size.z).toBeLessThanOrEqual(MAX_FOOTPRINT);
        expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
        expect(box.max.y).toBeLessThanOrEqual(6.0);
        expect(m.w).toBeGreaterThanOrEqual(size.x - 0.01);
        expect(m.d).toBeGreaterThanOrEqual(size.z - 0.01);
        expect(Math.abs(m.w - size.x)).toBeLessThanOrEqual(0.3);
        expect(Math.abs(m.d - size.z)).toBeLessThanOrEqual(0.3);
        expect(Math.abs(centre.x)).toBeLessThan(0.3);
        expect(Math.abs(centre.z)).toBeLessThan(0.3);
      });

      it('animates inside the envelope and the pivot really moves', () => {
        const pivot = m.root.getObjectByName('pivot')!;
        pivot.updateMatrix();
        const before = pivot.matrix.elements.join();
        let worst = 0;
        let top = 0;
        for (let i = 0; i < 400; i++) {
          m.animate(0.05, true);
          m.root.updateMatrixWorld(true);
          const b = new THREE.Box3().setFromObject(m.root, true);
          const s = b.getSize(new THREE.Vector3());
          worst = Math.max(worst, s.x, s.z);
          top = Math.max(top, b.max.y);
        }
        expect(worst).toBeLessThanOrEqual(MAX_FOOTPRINT + 0.001);
        expect(top).toBeLessThanOrEqual(6.0);
        expect(() => m.animate(0.016, false)).not.toThrow();
        pivot.updateMatrix();
        expect(pivot.matrix.elements.join()).not.toBe(before);
      });
    });
  }

  it('shares geometry between instances', () => {
    const a = createEra5to7MachineModel('cracker');
    const b = createEra5to7MachineModel('cracker');
    expect(a.root).not.toBe(b.root);
    expect(meshes(a.root)[0]!.geometry).toBe(meshes(b.root)[0]!.geometry);
  });
});
