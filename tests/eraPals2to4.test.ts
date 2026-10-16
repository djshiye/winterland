/**
 * 0.9.5 era 2-4 pals (Pack Mule, Pit Pony, Brass Terrier): each keeps the companion dog's contract, stays cheap
 * (one body mesh + one instanced mesh for legs and tail), animates walking and sitting without throwing, rebuilds
 * only its body for the bag and the level band, and matches the pal names in the era table.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ERA2_4_PAL_NAMES, createEra2to4Pal, eraPal2to4Catalog, type Pal2to4Era } from '../src/assets/eraPals2to4';
import { eraContent } from '../src/eras/template';

function size(o: THREE.Object3D): THREE.Vector3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
}

describe('era 2-4 pals', () => {
  for (const era of [2, 3, 4] as Pal2to4Era[]) {
    describe(ERA2_4_PAL_NAMES[era], () => {
      it('is named like the era table says', () => {
        expect(ERA2_4_PAL_NAMES[era]).toBe(eraContent(era).player.pal);
      });

      it('is one body mesh plus one instanced mesh for the legs and tail', () => {
        const p = createEra2to4Pal(era);
        const meshes: THREE.Mesh[] = [];
        p.root.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh);
        });
        expect(meshes).toHaveLength(2);
        expect(meshes.filter((m) => (m as THREE.InstancedMesh).isInstancedMesh)).toHaveLength(1);
        p.dispose();
      });

      it('stands on the ground at a companion size', () => {
        const p = createEra2to4Pal(era);
        const s = size(p.root);
        expect(s.y).toBeGreaterThan(0.4);
        expect(s.y).toBeLessThan(1.6);
        expect(s.z).toBeLessThan(1.4);
        const box = new THREE.Box3().setFromObject(p.root);
        expect(box.min.y).toBeGreaterThan(-0.05);
        expect(box.min.y).toBeLessThan(0.1);
        p.dispose();
      });

      it('walks, sits, wags and swaps bag and band without throwing', () => {
        const p = createEra2to4Pal(era);
        const body = p.root.getObjectByName('palBody') as THREE.Mesh;
        const g0 = body.geometry;
        for (let i = 0; i < 60; i++) p.animate(i / 30, 2);
        p.sit = 1;
        p.tailYaw = 0.4;
        for (let i = 60; i < 90; i++) p.animate(i / 30, 0);
        p.setBag(true);
        expect(body.geometry).not.toBe(g0);
        const g1 = body.geometry;
        p.setBag(true);
        expect(body.geometry).toBe(g1);
        p.setLevel(3);
        expect(body.geometry).not.toBe(g1);
        p.dispose();
      });
    });
  }

  it('has a gallery entry per pal', () => {
    expect(Object.keys(eraPal2to4Catalog)).toHaveLength(3);
    for (const make of Object.values(eraPal2to4Catalog)) expect(make()).toBeInstanceOf(THREE.Group);
  });
});
