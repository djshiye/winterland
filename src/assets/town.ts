/**
 * [T1 — assets] Wave 9 Market Town models (procedural, baked to 1–2 meshes each + pivots for animated parts).
 *
 * CONTRACT (keep every exported signature; T1 owns the implementation; town/Business.ts + town/Town.ts use them):
 * - Local frame: origin at the footprint centre on the ground, the FRONT (door, shop window) faces local +Z.
 *   Town rotates the model so +Z points along the lot's `face`. Footprint ≤ LAYOUT.town.lotSize − 0.6.
 * - BusinessModel.animate(dt, working): animated parts (farm windmill sails turn while working, bakery oven glow
 *   pulses, toy factory gears…); idle = slow / still. Must not allocate per frame.
 * - chimney: local chimney-mouth position (smoke source) or null. glow: meshes whose emissive the night lighting
 *   brightens (windows, oven) — see world/env/glow.ts for how existing windows glow.
 * - Draw calls: a building ≤ 3 meshes (baked body + glow mesh + one animated pivot).
 */
import * as THREE from 'three';
import type { BusinessId } from '../config';

export interface BusinessModel {
  readonly root: THREE.Group;
  /** Footprint (local X × Z) in metres. */
  readonly w: number;
  readonly d: number;
  /** Local chimney mouth (smoke) or null. */
  readonly chimney: THREE.Vector3 | null;
  /** Meshes that glow at night (window panes, oven mouth). */
  readonly glow: THREE.Mesh[];
  animate(dt: number, working: boolean): void;
}

/** One town building. Placeholder until T1 lands: a coloured box. */
export function createBusinessModel(id: BusinessId): BusinessModel {
  const colors: Record<BusinessId, number> = {
    farm: 0xb84a3a,
    bakery: 0xe8c08a,
    townhouse: 0x8fa9c9,
    ranch: 0x9b6b43,
    butcher: 0xd9d2c5,
    toyFactory: 0x7a8fa3,
  };
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 3.0), new THREE.MeshLambertMaterial({ color: colors[id] }));
  body.position.y = 1.3;
  root.add(body);
  return { root, w: 3.4, d: 3.0, chimney: new THREE.Vector3(1, 3, -0.6), glow: [], animate: () => {} };
}

/** An empty lot for sale: snowy staked plot + a little "FOR SALE" signboard near the front edge (local +Z). */
export function createLotForSale(): THREE.Group {
  const g = new THREE.Group();
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.06), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  sign.position.set(0, 0.9, 1.4);
  g.add(sign);
  return g;
}

/** Timber scaffold sized for a town lot, growing with the paid share (0…1). */
export interface TownScaffold {
  readonly group: THREE.Group;
  setProgress(p: number): void;
}
export function createTownScaffold(): TownScaffold {
  const group = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4, 3.0), new THREE.MeshLambertMaterial({ color: 0xc8a070, wireframe: true }));
  box.position.y = 1.2;
  group.add(box);
  return { group, setProgress: (p) => group.scale.set(1, 0.35 + 0.65 * p, 1) };
}

/** Station props in front of a business (local frames: +Z = toward the square). `topY` = where a pile's base sits. */
export interface StationProp {
  readonly root: THREE.Group;
  readonly topY: number;
}
/** Wooden hopper bin for a shop's inputs (≈1.1 × 1.0 m). */
export function createHopperBin(): StationProp {
  const root = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.0), new THREE.MeshLambertMaterial({ color: 0x8a5a3a }));
  m.position.y = 0.25;
  root.add(m);
  return { root, topY: 0.5 };
}
/** Shop counter with an awning (≈1.6 × 0.8 m, top at ~0.9 m) where goods sit for sale. */
export function createShopCounter(): StationProp {
  const root = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.8), new THREE.MeshLambertMaterial({ color: 0xa0704a }));
  m.position.y = 0.45;
  root.add(m);
  return { root, topY: 0.9 };
}
/** Low pallet a producer's goods pile up on (≈1.4 × 1.2 m). */
export function createOutPallet(): StationProp {
  const root = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.14, 1.2), new THREE.MeshLambertMaterial({ color: 0x9b7653 }));
  m.position.y = 0.07;
  root.add(m);
  return { root, topY: 0.14 };
}
