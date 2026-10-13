/**
 * [B5 — commerce] AssetFactory: vehicles. STUB — replace the placeholder bodies; you own this file and
 * its consumers (npc/TricycleQueue.ts, npc/TruckQueue.ts), so reshape the handle types freely.
 *
 * Art spec:
 * - CARGO TRICYCLE: blue (MACHINE_BLUE) front fork; ONE front wheel r 0.25 in dark grey; a rear flatbed
 *   axle with TWO wheels; an open-top blue cargo tray 0.9 × 0.3 × 0.9 with a `cargoPivot` for up to 6
 *   crates; a rider (createCharacterRig('courier') — yellow helmet — seated on `riderSeat`). Faces +Z.
 * - PICKUP TRUCK (phase 5): chunky low-poly pickup ~3.6 long in PALETTE.truckRed / truckBlue: cab with
 *   windows, open bed with a `bedPivot` for logs, 4 wheels, headlights; driver on `driverSeat`. Faces −X.
 * Origin at ground level under the vehicle centre. Wheels are separate objects so they can spin.
 */
import * as THREE from 'three';
import { COLORS, PALETTE } from '../config';
import { geo, mesh, toon } from '../render/materials';

export interface TricycleModel {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  /** Crates stack from here (tray floor centre). */
  cargoPivot: THREE.Object3D;
  /** Rider's hips attach here. */
  riderSeat: THREE.Object3D;
}

export function createTricycle(): TricycleModel {
  const root = new THREE.Group();
  const tray = mesh(geo.boxBase(0.9, 0.3, 0.9), toon(COLORS.MACHINE_BLUE));
  tray.position.set(0, 0.35, -0.5);
  const cargoPivot = new THREE.Object3D();
  cargoPivot.position.set(0, 0.45, -0.5);
  const riderSeat = new THREE.Object3D();
  riderSeat.position.set(0, 0.6, 0.4);
  root.add(tray, cargoPivot, riderSeat);
  return { root, wheels: [], cargoPivot, riderSeat };
}

export interface PickupTruckModel {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  /** Logs stack from here (bed floor centre). */
  bedPivot: THREE.Object3D;
  driverSeat: THREE.Object3D;
}

export function createPickupTruck(color: number = PALETTE.truckRed): PickupTruckModel {
  const root = new THREE.Group();
  root.add(mesh(geo.boxBase(3.6, 1.2, 1.7), toon(color)));
  const bedPivot = new THREE.Object3D();
  bedPivot.position.set(0.9, 1.2, 0);
  const driverSeat = new THREE.Object3D();
  driverSeat.position.set(-0.7, 0.7, 0);
  root.add(bedPivot, driverSeat);
  return { root, wheels: [], bedPivot, driverSeat };
}

export const vehicleCatalog: Record<string, () => THREE.Object3D> = {
  tricycle: () => createTricycle().root,
  truckRed: () => createPickupTruck(PALETTE.truckRed).root,
  truckBlue: () => createPickupTruck(PALETTE.truckBlue).root,
};
