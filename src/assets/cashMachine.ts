/**
 * 0.9.5 AssetFactory: an era's cash machine (eras/CashMachine.ts), a cosy little vault in the era's colours: a rounded
 * safe on a stone plinth with a gold wheel door facing the camera side, a tube that rises from the cash pile's side and
 * a coin-slot hopper on top. Static parts bake into one mesh; the door `wheel` spins while it banks.
 * Origin = floor centre, local −X = toward the cash pile (the tube's side).
 */
import * as THREE from 'three';
import { bake } from '../render/batch';
import { geo, mesh, toon } from '../render/materials';

export interface CashMachineModel {
  root: THREE.Group;
  /** The door's handle wheel (spins while a bundle is banked). */
  wheel: THREE.Object3D;
  /** World-local point the bundles fly into (the hopper). */
  mouth: THREE.Vector3;
}

/** Footprint (metres) for the collider. */
export const CASH_MACHINE_SIZE = { w: 1.5, d: 1.3, h: 1.9 } as const;

export function createCashMachineModel(accent: number, body: number, trim: number): CashMachineModel {
  const root = new THREE.Group();
  root.name = 'cashMachine';
  const parts = new THREE.Group();
  const stone = toon(0xc9c2b8);
  const safe = toon(body);
  const band = toon(accent);
  const gold = toon(0xffd84a);
  const dark = toon(trim);
  const glass = toon(0xbfe6ff);

  const plinth = mesh(geo.boxBase(1.5, 0.18, 1.3), stone);
  parts.add(plinth);
  const box = mesh(geo.boxBase(1.2, 1.15, 1.0), safe);
  box.position.y = 0.18;
  parts.add(box);
  const lid = mesh(geo.boxBase(1.3, 0.14, 1.1), band);
  lid.position.y = 1.33;
  parts.add(lid);
  // a gold-rimmed round door on the camera side (+Z)
  const rim = mesh(geo.cylinder(0.36, 0.36, 0.06, 20), gold);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 0.75, 0.52);
  parts.add(rim);
  const door = mesh(geo.cylinder(0.3, 0.3, 0.07, 20), band);
  door.rotation.x = Math.PI / 2;
  door.position.set(0, 0.75, 0.54);
  parts.add(door);
  // hopper on top, and the tube from the cash pile's side (−X)
  const hopper = mesh(geo.cylinder(0.26, 0.16, 0.3, 14), gold);
  hopper.position.set(0.15, 1.62, 0);
  parts.add(hopper);
  const tubeUp = mesh(geo.cylinder(0.09, 0.09, 1.4, 10), glass);
  tubeUp.position.set(-0.78, 0.9, 0);
  parts.add(tubeUp);
  const tubeOver = mesh(geo.cylinder(0.09, 0.09, 0.62, 10), glass);
  tubeOver.rotation.z = Math.PI / 2;
  tubeOver.position.set(-0.47, 1.6, 0);
  parts.add(tubeOver);
  for (const y of [0.35, 1.2]) {
    const clamp = mesh(geo.cylinder(0.12, 0.12, 0.08, 10), dark);
    clamp.position.set(-0.78, y, 0);
    parts.add(clamp);
  }
  // little feet
  for (const [x, z] of [[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.4], [0.5, 0.4]] as const) {
    const foot = mesh(geo.boxBase(0.16, 0.06, 0.16), dark);
    foot.position.set(x, 0.12, z);
    parts.add(foot);
  }
  root.add(bake(parts, { name: 'cashMachineParts' }));

  const wheel = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const spoke = mesh(geo.box(0.42, 0.05, 0.05), gold, { cast: false });
    spoke.rotation.z = (i * Math.PI) / 3;
    wheel.add(spoke);
  }
  const hub = mesh(geo.cylinder(0.07, 0.07, 0.06, 12), gold, { cast: false });
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  wheel.position.set(0, 0.75, 0.6);
  root.add(wheel);

  return { root, wheel, mouth: new THREE.Vector3(0.15, 1.8, 0) };
}
