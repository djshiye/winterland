/**
 * 0.9.0 era material items (assets/eraItems.ts) and their icons (ui/materialIcons.ts): every material has ONE merged
 * mesh inside its size box (so stacks sit stackHeight apart), centred on the origin, no shadow casting, a complete
 * gallery catalog and an SVG icon + label for every item kind.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createItemModel } from '../src/assets/items';
import { createEraItemModel, eraItemCatalog } from '../src/assets/eraItems';
import { ALL_ITEM_KINDS, MATERIAL_KINDS } from '../src/core/types';
import { MATERIALS } from '../src/eras/data';
import { materialIcon, materialLabel } from '../src/ui/materialIcons';

describe('era item models', () => {
  for (const kind of MATERIAL_KINDS) {
    describe(kind, () => {
      const def = MATERIALS[kind];
      const mesh = createEraItemModel(kind);
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());

      it('is one named mesh that receives but does not cast shadows', () => {
        expect(mesh.isMesh).toBe(true);
        expect(mesh.children).toHaveLength(0);
        expect(mesh.name).toBe(`item:${kind}`);
        expect(mesh.castShadow).toBe(false);
        expect(mesh.receiveShadow).toBe(true);
      });

      it('fits its size box within 5 %', () => {
        expect(size.x).toBeGreaterThan(def.size.w * 0.95);
        expect(size.x).toBeLessThan(def.size.w * 1.05);
        expect(size.y).toBeGreaterThan(def.size.h * 0.95);
        expect(size.y).toBeLessThan(def.size.h * 1.05);
        expect(size.z).toBeGreaterThan(def.size.d * 0.95);
        expect(size.z).toBeLessThan(def.size.d * 1.05);
      });

      it('is centred on its origin (stacks sit stackHeight apart)', () => {
        expect(Math.abs(centre.x)).toBeLessThan(0.01);
        expect(Math.abs(centre.y)).toBeLessThan(0.01);
        expect(Math.abs(centre.z)).toBeLessThan(0.01);
      });

      it('has vertex colours and sane geometry', () => {
        const g = mesh.geometry;
        expect(g.getAttribute('color')).toBeDefined();
        expect(g.getAttribute('position').count).toBeGreaterThan(24);
        expect(g.getAttribute('position').count).toBeLessThan(6000);
      });

      it('shares one geometry between instances and routes through createItemModel', () => {
        expect(createEraItemModel(kind).geometry).toBe(mesh.geometry);
        expect(createItemModel(kind).geometry).toBe(mesh.geometry);
      });
    });
  }

  it('the gallery catalog has one entry per material', () => {
    expect(Object.keys(eraItemCatalog).sort()).toEqual([...MATERIAL_KINDS].sort());
    for (const kind of MATERIAL_KINDS) expect((eraItemCatalog[kind]!() as THREE.Mesh).isMesh).toBe(true);
  });
});

describe('material icons', () => {
  it('returns an inline SVG (48x48 viewBox) for every item kind', () => {
    for (const kind of ALL_ITEM_KINDS) {
      const s = materialIcon(kind);
      expect(s.startsWith('<svg')).toBe(true);
      expect(s).toContain('viewBox="0 0 48 48"');
      expect(s.trim().endsWith('</svg>')).toBe(true);
    }
  });

  it('every material has its own distinct icon', () => {
    const icons = new Set(MATERIAL_KINDS.map((k) => materialIcon(k)));
    expect(icons.size).toBe(MATERIAL_KINDS.length);
  });

  it('labels every item kind', () => {
    expect(materialLabel('stone')).toBe('Stone');
    expect(materialLabel('log')).toBe('Logs');
    expect(materialLabel('crate')).toBe('Crates');
    expect(materialLabel('fuelRod')).toBe(MATERIALS.fuelRod.label);
    for (const kind of ALL_ITEM_KINDS) expect(materialLabel(kind).length).toBeGreaterThan(0);
  });
});
