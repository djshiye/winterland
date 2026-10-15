/**
 * Wave 9 town assets (assets/town.ts, assets/items.ts createTownGood): draw-call budget, footprints, the clear front
 * strip, animation, glow registration and the goods' ITEM_SIZE boxes.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ITEM_SIZE, LAYOUT, type BusinessId } from '../src/config';
import { createTownGood } from '../src/assets/items';
import { createBusinessModel, createHopperBin, createLotForSale, createOutPallet, createShopCounter, createTownScaffold } from '../src/assets/town';

const IDS: BusinessId[] = ['farm', 'bakery', 'townhouse', 'ranch', 'butcher', 'toyFactory'];
const MAX = LAYOUT.town.lotSize - 0.6;
const TOL = 0.021; // float slack over the nominal 0.02
/** Roof edges, snow lips and drifts may overshoot the nominal 3.8 × 2.8 box by a hair. */
const BTOL = 0.06;

function meshes(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh);
  });
  return out;
}
function box(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
}
/** Bounding box of one mesh in the model's local space (its geometry only, ignoring the mesh transform's parent). */
function meshBox(m: THREE.Mesh): THREE.Box3 {
  m.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(m);
}

describe('business models', () => {
  for (const id of IDS) {
    describe(id, () => {
      const m = createBusinessModel(id);
      const b = box(m.root);
      const parts = meshes(m.root);
      it('is at most 3 meshes (body + glow + one pivot)', () => {
        expect(parts.length).toBeGreaterThanOrEqual(2);
        expect(parts.length).toBeLessThanOrEqual(3);
      });
      it('fits the lot and keeps the front strip clear', () => {
        const size = b.getSize(new THREE.Vector3());
        expect(size.x).toBeLessThanOrEqual(MAX + BTOL);
        expect(size.z).toBeLessThanOrEqual(m.d + BTOL);
        expect(m.w).toBeLessThanOrEqual(MAX + TOL);
        expect(b.min.x).toBeGreaterThanOrEqual(-MAX / 2 - BTOL);
        expect(b.max.x).toBeLessThanOrEqual(MAX / 2 + BTOL);
        expect(b.min.z).toBeGreaterThanOrEqual(-MAX / 2 - BTOL);
        // front (+Z): about 1 m of the 4.4 m lot stays free
        expect(b.max.z).toBeLessThanOrEqual(0.9 + BTOL);
        expect(b.min.y).toBeGreaterThanOrEqual(-0.15); // snow drifts are half buried
        expect(size.y).toBeGreaterThan(1.5);
      });
      it('has a chimney mouth inside the footprint (or none)', () => {
        if (m.chimney === null) return;
        expect(m.chimney.x).toBeGreaterThan(b.min.x);
        expect(m.chimney.x).toBeLessThan(b.max.x);
        expect(m.chimney.z).toBeGreaterThan(b.min.z);
        expect(m.chimney.z).toBeLessThan(b.max.z);
        expect(m.chimney.y).toBeGreaterThan(1.5);
        expect(m.chimney.y).toBeLessThanOrEqual(b.max.y + 0.3);
      });
      it('lists glow meshes with an emissive material that are in the model', () => {
        expect(m.glow.length).toBeGreaterThan(0);
        for (const g of m.glow) {
          expect(parts).toContain(g);
          const mat = g.material as THREE.MeshToonMaterial;
          expect(mat.emissiveIntensity).toBeGreaterThan(0);
          expect(g.castShadow).toBe(false);
        }
      });
      it('animates without throwing and without changing the mesh count', () => {
        for (let i = 0; i < 30; i++) m.animate(1 / 60, i < 20);
        expect(meshes(m.root).length).toBe(parts.length);
      });
    });
  }

  it('shares geometry between instances of one kind', () => {
    const a = createBusinessModel('bakery');
    const c = createBusinessModel('bakery');
    const ga = meshes(a.root).map((x) => x.geometry);
    const gc = meshes(c.root).map((x) => x.geometry);
    ga.forEach((g, i) => expect(g).toBe(gc[i]));
    expect(a.chimney).not.toBe(c.chimney);
  });

  it('moving parts move: windmill sails and factory gear turn while working, idle toy gear is still', () => {
    for (const id of ['farm', 'toyFactory'] as const) {
      const m = createBusinessModel(id);
      const pivot = meshes(m.root).find((x) => x.name.endsWith(':pivot'))!;
      expect(pivot).toBeDefined();
      const r0 = pivot.rotation.z;
      for (let i = 0; i < 60; i++) m.animate(1 / 60, true);
      expect(Math.abs(pivot.rotation.z - r0)).toBeGreaterThan(0.5);
    }
    const toy = createBusinessModel('toyFactory');
    const gear = meshes(toy.root).find((x) => x.name.endsWith(':pivot'))!;
    for (let i = 0; i < 60; i++) toy.animate(1 / 60, false);
    expect(gear.rotation.z).toBeCloseTo(0, 5);
  });

  it('bakery oven glow pulses with working and stays inside a sane range', () => {
    const m = createBusinessModel('bakery');
    const mat = (m.glow[0]!.material as THREE.MeshToonMaterial).emissive;
    const seen: number[] = [];
    for (let i = 0; i < 120; i++) {
      m.animate(1 / 60, true);
      seen.push(mat.r);
    }
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.05);
    expect(Math.min(...seen)).toBeGreaterThan(0.3);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1.05);
  });
});

describe('lot, scaffold and props', () => {
  it('lot for sale is one non-casting mesh within the lot, with the sign toward +Z', () => {
    const lot = createLotForSale();
    const ms = meshes(lot);
    expect(ms.length).toBe(1);
    expect(ms[0]!.castShadow).toBe(false);
    const b = box(lot);
    expect(b.max.x - b.min.x).toBeLessThanOrEqual(LAYOUT.town.lotSize);
    expect(b.max.z).toBeGreaterThan(1.5);
    expect(b.max.z).toBeLessThanOrEqual(LAYOUT.town.lotSize / 2);
  });

  it('scaffold is one mesh sized for a ~3.6 m building and grows with progress', () => {
    const s = createTownScaffold();
    expect(meshes(s.group).length).toBe(1);
    const b = box(s.group);
    s.setProgress(0);
    const h0 = box(s.group).max.y;
    s.setProgress(1);
    const h1 = box(s.group).max.y;
    expect(h1).toBeGreaterThan(h0 * 2);
    expect(b.max.x - b.min.x).toBeGreaterThan(3.2);
    expect(b.max.x - b.min.x).toBeLessThanOrEqual(MAX + 0.4);
    s.setProgress(5);
    expect(s.group.scale.y).toBeCloseTo(1, 5);
  });

  const props = [
    ['hopper bin', createHopperBin, 0.5, 1.1, 1.0],
    ['shop counter', createShopCounter, 0.9, 1.6, 0.8],
    ['out pallet', createOutPallet, 0.14, 1.4, 1.2],
  ] as const;
  for (const [name, make, topY, w, d] of props) {
    it(`${name}: one mesh, topY ${topY}, footprint ≈ ${w} × ${d}`, () => {
      const p = make();
      expect(meshes(p.root).length).toBe(1);
      expect(p.topY).toBe(topY);
      const b = box(p.root);
      expect(b.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(b.max.x - b.min.x).toBeGreaterThan(w - 0.15);
      expect(b.max.x - b.min.x).toBeLessThan(w + 0.15);
      expect(b.max.z - b.min.z).toBeGreaterThan(d - 0.15);
      expect(b.max.z - b.min.z).toBeLessThan(d + 0.25);
      // the surface a pile sits on is solid right up to topY: nothing of the prop pokes well above it (except the counter's awning)
      if (name !== 'shop counter') expect(b.max.y).toBeLessThanOrEqual(topY + 0.08);
      else expect(b.max.y).toBeGreaterThan(1.5);
    });
  }
});

describe('town goods', () => {
  for (const kind of ['wheat', 'bread', 'meat', 'sausage', 'toy'] as const) {
    it(`${kind}: one mesh centred on its origin, inside its ITEM_SIZE box`, () => {
      const m = createTownGood(kind);
      expect((m as THREE.Mesh).isMesh).toBe(true);
      const z = ITEM_SIZE[kind];
      const b = meshBox(m);
      const size = b.getSize(new THREE.Vector3());
      expect(size.x).toBeLessThanOrEqual(z.w + TOL);
      expect(size.y).toBeLessThanOrEqual(z.h + TOL);
      expect(size.z).toBeLessThanOrEqual(z.d + TOL);
      // fills a good part of the box so piles look right
      expect(size.x).toBeGreaterThan(z.w * 0.6);
      expect(size.y).toBeGreaterThan(z.h * 0.5);
      expect(size.z).toBeGreaterThan(z.d * 0.6);
      const c = b.getCenter(new THREE.Vector3());
      expect(Math.abs(c.x)).toBeLessThan(0.05);
      expect(Math.abs(c.y)).toBeLessThan(0.05);
      expect(Math.abs(c.z)).toBeLessThan(0.05);
      // stack pitch never exceeds the model so goods don't float apart
      expect(z.stackHeight).toBeLessThanOrEqual(z.h + 0.02);
    });
  }
});
