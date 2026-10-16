/**
 * Era 2–4 expansion machine models (assets/eraMachines2.ts): all 12 build as exactly body + glow + one pivot,
 * stay inside the 5.2 × 5.2 × 6 m envelope with the animated part at any angle, move enough to read
 * (the guide: amplitude ≥ 0.35 m or rotation radius ≥ 0.6 m) and appear in the gallery.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ASSET_CATALOG } from '../src/assets/AssetFactory';
import { ERA_MACHINE_2_IDS, ERA_MACHINES_2, createEraMachine2Model, eraMachine2Catalog, eraMachine2Motion } from '../src/assets/eraMachines2';

const MAX_FOOTPRINT = 5.2;
const MAX_HEIGHT = 6.0;

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

describe('era 2–4 expansion machine models', () => {
  it('lists 12 machines, one of each role per era', () => {
    expect(ERA_MACHINE_2_IDS).toHaveLength(12);
    for (const era of [2, 3, 4]) {
      const roles = ERA_MACHINE_2_IDS.filter((id) => ERA_MACHINES_2[id].era === era).map((id) => ERA_MACHINES_2[id].role);
      expect(roles.sort()).toEqual(['cash', 'extractor', 'premium', 'processor']);
    }
  });

  for (const id of ERA_MACHINE_2_IDS) {
    describe(id, () => {
      const m = createEraMachine2Model(id);

      it('is exactly body + glow + pivot', () => {
        expect(m.root.name).toBe(`machine:${id}:${ERA_MACHINES_2[id].era}`);
        expect(meshes(m.root).map((x) => x.name).sort()).toEqual(['body', 'glow', 'pivot']);
        for (const x of meshes(m.root)) expect(x.geometry.getAttribute('position').count).toBeGreaterThan(0);
      });

      it('fits the envelope at rest, centred, and reports its footprint', () => {
        const box = bounds(m.root);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        expect(size.x).toBeLessThanOrEqual(MAX_FOOTPRINT);
        expect(size.z).toBeLessThanOrEqual(MAX_FOOTPRINT);
        expect(box.max.y).toBeLessThanOrEqual(MAX_HEIGHT);
        expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
        expect(m.w).toBeGreaterThanOrEqual(size.x - 0.01);
        expect(m.d).toBeGreaterThanOrEqual(size.z - 0.01);
        expect(Math.abs(centre.x)).toBeLessThan(0.3);
        expect(Math.abs(centre.z)).toBeLessThan(0.3);
      });

      it('animates inside the envelope and moves enough to read', () => {
        const pivot = m.root.getObjectByName('pivot')!;
        const spec = eraMachine2Motion(id);
        const start = pivot.matrix.clone();
        let worst = 0;
        let top = 0;
        let lo = Infinity;
        let hi = -Infinity;
        const far = new THREE.Vector3();
        // radius of the moving part from its pivot (largest vertex distance in the rotation plane)
        const pos = (pivot as THREE.Mesh).geometry.getAttribute('position');
        let radius = 0;
        for (let i = 0; i < pos.count; i++) {
          far.fromBufferAttribute(pos, i);
          radius = Math.max(radius, spec.axis === 'y' ? Math.hypot(far.x, far.z) : Math.hypot(far.x, far.y));
        }
        for (let i = 0; i < 400; i++) {
          m.animate(0.05, true);
          const box = bounds(m.root);
          const s = box.getSize(new THREE.Vector3());
          worst = Math.max(worst, s.x, s.z);
          top = Math.max(top, box.max.y);
          lo = Math.min(lo, pivot.position.y);
          hi = Math.max(hi, pivot.position.y);
        }
        expect(worst).toBeLessThanOrEqual(MAX_FOOTPRINT + 0.001);
        expect(top).toBeLessThanOrEqual(MAX_HEIGHT);
        pivot.updateMatrix();
        expect(pivot.matrix.equals(start)).toBe(false);
        if (spec.motion === 'bob') expect(hi - lo).toBeGreaterThanOrEqual(0.35);
        else expect(radius).toBeGreaterThanOrEqual(0.6);
        expect(() => m.animate(0.016, false)).not.toThrow();
        expect(() => m.animate(0, true)).not.toThrow();
      });
    });
  }

  it('shares geometry between instances', () => {
    const a = createEraMachine2Model('forge');
    const b = createEraMachine2Model('forge');
    expect(a.root).not.toBe(b.root);
    expect(meshes(a.root)[0]!.geometry).toBe(meshes(b.root)[0]!.geometry);
  });

  it('is in the gallery, singly and as one row per era', () => {
    expect(ASSET_CATALOG.eraMachines2).toBe(eraMachine2Catalog);
    for (const id of ERA_MACHINE_2_IDS) expect(eraMachine2Catalog[id]).toBeTypeOf('function');
    for (const era of [2, 3, 4]) {
      const sheet = eraMachine2Catalog[`newEra${era}`]!();
      expect(sheet.children).toHaveLength(4);
      let hooks = 0;
      sheet.traverse((o) => {
        if (typeof o.userData.galleryAnimate === 'function') hooks++;
      });
      expect(hooks).toBe(4);
    }
  });
});
