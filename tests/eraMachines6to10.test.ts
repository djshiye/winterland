/**
 * 0.9.8 machines, second half: the toy machines of eras 6-10 (assets/eraMachines6to10.ts). Every production machine
 * of those eras comes from this file, is exactly body + glow + one pivot, fits the 5.2 × 5.2 m footprint under 6 m (even
 * with the pivot at any phase), keeps the front pallet spots clear, moves far enough to read, shares its geometry
 * between instances and takes its colours only from the palette module.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TOY_MACHINES, TOY_MACHINE_IDS, createToyMachine, eraMachine6to10Catalog } from '../src/assets/eraMachines6to10';
import { createMachineModel } from '../src/assets/eraMachines';
import { ASSET_CATALOG } from '../src/assets/AssetFactory';
import { MACHINES, machinesOfEra } from '../src/eras/data';

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

describe('era 6-10 toy machines', () => {
  it('builds every production machine of eras 6-10, with the right era, and is in the gallery', () => {
    for (let era = 6; era <= 10; era++) {
      const ids = machinesOfEra(era);
      expect(ids.length).toBeGreaterThanOrEqual(5);
      for (const id of ids) expect(TOY_MACHINES[id as keyof typeof TOY_MACHINES], id).toBe(era);
    }
    expect(TOY_MACHINE_IDS).toHaveLength(26);
    for (const id of TOY_MACHINE_IDS) {
      expect(MACHINES[id].era).toBe(TOY_MACHINES[id]);
      expect(eraMachine6to10Catalog[id]).toBeTypeOf('function');
      // the game's builder hands out these models
      expect(createMachineModel(id).root.name).toBe(`machine:${id}:${TOY_MACHINES[id]}`);
    }
    for (const era of [6, 7, 8, 9, 10]) expect(eraMachine6to10Catalog[`toys${era}`]).toBeTypeOf('function');
    expect(ASSET_CATALOG.eraMachines6to10).toBe(eraMachine6to10Catalog);
  });

  for (const id of TOY_MACHINE_IDS) {
    describe(id, () => {
      const m = createToyMachine(id);

      it('is exactly body + glow + pivot', () => {
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
        expect(Math.abs(m.w - size.x)).toBeLessThanOrEqual(0.3);
        expect(Math.abs(m.d - size.z)).toBeLessThanOrEqual(0.3);
        expect(Math.abs(centre.x)).toBeLessThan(0.5);
        expect(Math.abs(centre.z)).toBeLessThan(0.5);
      });

      it('keeps the input / output pallet spots and the worker spot clear', () => {
        const v = new THREE.Vector3();
        for (const mesh of meshes(m.root)) {
          const pos = mesh.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            mesh.localToWorld(v);
            const onPallet = Math.abs(Math.abs(v.x) - 1.6) < 0.55 && v.z > 1.3 && v.z < 2.35;
            const onWorker = Math.abs(v.x) < 0.35 && v.z > 1.95;
            if (onPallet || onWorker) expect(v.y, `${mesh.name} at ${v.x.toFixed(2)}, ${v.z.toFixed(2)}`).toBeLessThan(0.4);
          }
        }
      });

      it('animates visibly (≥ 0.35 m travel or ≥ 0.6 m radius) and stays inside 5.2 m and 6 m', () => {
        const pivot = m.root.getObjectByName('pivot') as THREE.Mesh;
        pivot.geometry.computeBoundingBox();
        const gb = pivot.geometry.boundingBox!;
        const radius = Math.max(Math.abs(gb.min.x), Math.abs(gb.max.x), Math.abs(gb.min.y), Math.abs(gb.max.y), Math.abs(gb.min.z), Math.abs(gb.max.z));
        const start = pivot.position.clone();
        const before = pivot.matrix.elements.join();
        let travel = 0;
        let worst = 0;
        let top = 0;
        for (let i = 0; i < 400; i++) {
          m.animate(0.05, true);
          travel = Math.max(travel, pivot.position.distanceTo(start));
          const b = bounds(m.root);
          const s = b.getSize(new THREE.Vector3());
          worst = Math.max(worst, s.x, s.z);
          top = Math.max(top, b.max.y);
        }
        expect(worst).toBeLessThanOrEqual(MAX_FOOTPRINT + 0.001);
        expect(top).toBeLessThanOrEqual(6.0);
        expect(travel >= 0.35 || radius >= 0.6).toBe(true);
        pivot.updateMatrix();
        expect(pivot.matrix.elements.join()).not.toBe(before);
        expect(() => m.animate(0.016, false)).not.toThrow();
        expect(() => m.animate(0, true)).not.toThrow();
      });
    });
  }

  it('builds distinct instances that share geometry (three draw calls per machine, however many are built)', () => {
    const a = createToyMachine('reactor');
    const b = createToyMachine('reactor');
    expect(a.root).not.toBe(b.root);
    const ma = meshes(a.root);
    const mb = meshes(b.root);
    for (let i = 0; i < 3; i++) expect(ma[i]!.geometry).toBe(mb[i]!.geometry);
  });

  it('keeps no palette of its own: colours come from render/palette.ts and the era materials', () => {
    const src = readFileSync(resolve(__dirname, '..', 'src/assets/eraMachines6to10.ts'), 'utf8');
    expect(src).not.toMatch(/0x[0-9a-fA-F]{6}/);
  });
});
