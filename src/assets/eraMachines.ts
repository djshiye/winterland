/**
 * [STUB — machine-models builder replaces] 0.9.0 era machine models (eras/data.ts MACHINES[id].style) and the region
 * facility models. Procedural, merged (render/batch.ts): ≤ 3 meshes per model (body, glow, one animated pivot).
 *
 * Local frame: origin at floor centre, +Z = front (the side facing the front yard: the machine's input hopper sits
 * front-left (−X), its output pile front-right (+X), both supplied by eras/Machine.ts, not part of the model).
 */
import * as THREE from 'three';
import type { MachineId } from '../eras/data';
import { MACHINES } from '../eras/data';
import { toon } from '../render/materials';

export interface MachineModel {
  root: THREE.Group;
  /** Footprint (metres) of the solid part, centred on the origin; ≤ slot cell − 2. */
  w: number;
  d: number;
  /** Advance animations (smoke, wheels, glow pulse); `working` = a cycle is running. */
  animate(dt: number, working: boolean): void;
}

export function createMachineModel(id: MachineId): MachineModel {
  const root = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), toon(0x888888));
  m.position.y = 1.5;
  root.add(m);
  root.name = `machine:${id}:${MACHINES[id].era}`;
  return { root, w: 4, d: 4, animate: () => {} };
}

/** Export depot (freight dock where materials are sold), era-styled. Origin floor centre, +Z front. ~3 × 2.4 m. */
export function createDepotModel(_era: number): THREE.Group {
  return new THREE.Group();
}

/** Import dock (pallet bay where market orders arrive), era-styled. Origin floor centre, +Z front. ~3 × 2.4 m. */
export function createDockModel(_era: number): THREE.Group {
  return new THREE.Group();
}

export const eraMachineCatalog: Record<string, () => THREE.Object3D> = {};
