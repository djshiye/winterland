/**
 * [B5 — commerce] AssetFactory: vehicles. You own this file and its consumers (npc/TricycleQueue.ts,
 * npc/TruckQueue.ts).
 *
 * Art spec:
 * - CARGO TRICYCLE: blue (MACHINE_BLUE) front fork; ONE front wheel r 0.25 in dark grey; a rear flatbed
 *   axle with TWO wheels; an open-top blue cargo tray 0.9 × 0.3 × 0.9 with a `cargoPivot` for up to 6
 *   crates; a rider (createCharacterRig('courier') — yellow helmet — seated on `riderSeat`). Faces +Z.
 * - PICKUP TRUCK (phase 5): chunky low-poly pickup ~3.6 long in PALETTE.truckRed / truckBlue: cab with
 *   windows, open bed with a `bedPivot` for logs, 4 wheels, headlights; driver on `driverSeat`. Faces −X.
 * Origin at ground level under the vehicle centre. Wheels are separate pivots (`wheels`) so they can
 * spin: rotate `pivot.rotation.x` (tricycle) / `pivot.rotation.z` (truck) by distance / radius.
 * Everything shares cached geometry + materials; the open cabs leave the seated rider visible.
 */
import * as THREE from 'three';
import { COLORS, PALETTE } from '../config';
import { createCharacterRig, type CharacterRig } from '../render/characters';
import { Batch, bake } from '../render/batch';
import { geo, mesh, toon } from '../render/materials';
import { trainCatalog } from './train';

export const TRIKE_WHEEL_RADIUS = 0.25;
export const TRUCK_WHEEL_RADIUS = 0.38;

/** Spinning wheel: a pivot that holds tyre + hub + spoke. `axis` is the axle direction. */
function createWheel(radius: number, width: number, axis: 'x' | 'z'): THREE.Group {
  const pivot = new THREE.Group();
  pivot.name = 'wheel';
  const parts = new THREE.Group();
  const tyre = mesh(geo.cylinder(radius, radius, width, 18), toon(PALETTE.rubber));
  const hub = mesh(geo.cylinder(radius * 0.55, radius * 0.55, width + 0.03, 12), toon(COLORS.MACHINE_STEEL));
  const spoke =
    axis === 'x'
      ? mesh(geo.box(width + 0.05, radius * 0.22, radius * 1.5), toon(PALETTE.metalDark))
      : mesh(geo.box(radius * 1.5, radius * 0.22, width + 0.05), toon(PALETTE.metalDark));
  if (axis === 'x') {
    tyre.rotation.z = Math.PI / 2;
    hub.rotation.z = Math.PI / 2;
  } else {
    tyre.rotation.x = Math.PI / 2;
    hub.rotation.x = Math.PI / 2;
  }
  parts.add(tyre, hub, spoke);
  // One mesh per wheel (tyre + hub + spoke baked); the pivot stays a separate node so it can spin.
  pivot.add(bake(parts, { name: 'wheelMesh' }));
  return pivot;
}

// ---------------------------------------------------------------------------
// Cargo tricycle
// ---------------------------------------------------------------------------

export interface TricycleModel {
  root: THREE.Group;
  /** Everything except the wheels (bounces while riding). */
  body: THREE.Group;
  /** Spinning wheel pivots (front, rear-left, rear-right). */
  wheels: THREE.Object3D[];
  /** Crates stack from here (tray floor centre, inside `body`). */
  cargoPivot: THREE.Object3D;
  /** Rider's hips attach here (saddle top, inside `body`). */
  riderSeat: THREE.Object3D;
  /** Height (above the ground) where a speech bubble sits. */
  bubbleY: number;
}

export function createTricycle(): TricycleModel {
  const root = new THREE.Group();
  root.name = 'tricycle';
  const body = new THREE.Group();
  root.add(body);
  // Everything static on the chassis is baked into ONE mesh at the end (body keeps the pivots).
  const parts = new THREE.Group();

  const blue = toon(COLORS.MACHINE_BLUE);
  const blueDark = toon(PALETTE.machineDark);
  const steel = toon(COLORS.MACHINE_STEEL);
  const dark = toon(PALETTE.rubber);

  // Wheels: one in front, two on the rear flatbed axle.
  const r = TRIKE_WHEEL_RADIUS;
  const front = createWheel(r, 0.14, 'x');
  front.position.set(0, r, 1.0);
  const rl = createWheel(r, 0.14, 'x');
  rl.position.set(-0.55, r, -0.6);
  const rr = createWheel(r, 0.14, 'x');
  rr.position.set(0.55, r, -0.6);
  root.add(front, rl, rr);

  // Front fork + head tube + handlebar.
  for (const sx of [-1, 1]) {
    const fork = mesh(geo.box(0.06, 0.66, 0.06), blue);
    fork.position.set(sx * 0.11, 0.56, 0.96);
    fork.rotation.x = -0.18;
    parts.add(fork);
  }
  const crown = mesh(geo.box(0.3, 0.07, 0.1), blue);
  crown.position.set(0, 0.88, 0.9);
  parts.add(crown);
  const head = mesh(geo.box(0.1, 0.34, 0.1), blueDark);
  head.position.set(0, 0.98, 0.88);
  parts.add(head);
  const bar = mesh(geo.box(0.62, 0.06, 0.06), steel);
  bar.position.set(0, 1.16, 0.86);
  parts.add(bar);
  for (const sx of [-1, 1]) {
    const grip = mesh(geo.box(0.12, 0.08, 0.08), dark);
    grip.position.set(sx * 0.34, 1.16, 0.86);
    parts.add(grip);
  }

  // Main frame tube, saddle post, saddle, pedals.
  const tube = mesh(geo.box(0.1, 0.1, 1.55), blue);
  tube.position.set(0, 0.42, 0.18);
  parts.add(tube);
  const post = mesh(geo.box(0.07, 0.3, 0.07), blueDark);
  post.position.set(0, 0.57, 0.02);
  parts.add(post);
  const saddle = mesh(geo.box(0.32, 0.08, 0.34), dark);
  saddle.position.set(0, 0.74, 0.0);
  parts.add(saddle);
  for (const sx of [-1, 1]) {
    const pedal = mesh(geo.box(0.14, 0.04, 0.2), dark);
    pedal.position.set(sx * 0.2, 0.3, 0.7);
    parts.add(pedal);
  }
  const axle = mesh(geo.box(1.2, 0.06, 0.06), steel);
  axle.position.set(0, r, -0.6);
  parts.add(axle);

  // Open-top cargo tray 0.9 × 0.3 × 0.9 on the rear flatbed.
  const trayZ = -0.6;
  const trayY = 0.32;
  const floor = mesh(geo.boxBase(0.9, 0.05, 0.9), blueDark);
  floor.position.set(0, trayY, trayZ);
  parts.add(floor);
  for (const sz of [-1, 1]) {
    const w = mesh(geo.boxBase(0.9, 0.3 - 0.02, 0.04), blue);
    w.position.set(0, trayY, trayZ + sz * 0.43);
    parts.add(w);
    const s = mesh(geo.boxBase(0.04, 0.3 - 0.02, 0.82), blue);
    s.position.set(sz * 0.43, trayY, trayZ);
    parts.add(s);
  }
  // Crates start here (tray floor surface).
  const cargoPivot = new THREE.Object3D();
  cargoPivot.name = 'cargoPivot';
  cargoPivot.position.set(0, trayY + 0.05, trayZ);
  body.add(cargoPivot);

  const riderSeat = new THREE.Object3D();
  riderSeat.name = 'riderSeat';
  riderSeat.position.set(0, 0.78, 0.0);
  body.add(riderSeat);

  body.add(bake(parts, { name: 'tricycleBody' }));
  return { root, body, wheels: [front, rl, rr], cargoPivot, riderSeat, bubbleY: 2.35 };
}

// ---------------------------------------------------------------------------
// Pickup truck
// ---------------------------------------------------------------------------

export interface PickupTruckModel {
  root: THREE.Group;
  /** Everything except the wheels (bounces / squashes). */
  body: THREE.Group;
  /** Spinning wheel pivots (front-left, front-right, rear-left, rear-right). */
  wheels: THREE.Object3D[];
  /** Logs stack from here (bed floor surface centre, inside `body`). */
  bedPivot: THREE.Object3D;
  /** Driver's hips attach here (inside `body`). The driver must be yawed −π/2 to face −X. */
  driverSeat: THREE.Object3D;
  /** Height (above the ground) where a speech bubble sits. */
  bubbleY: number;
}

/** Bed-floor centre along the truck's X axis (the bed centre lines up with the truck counter). */
export const TRUCK_BED_X = 1.09;

export function createPickupTruck(color: number = PALETTE.truckRed): PickupTruckModel {
  const root = new THREE.Group();
  root.name = 'pickupTruck';
  const body = new THREE.Group();
  root.add(body);
  // Static chassis parts are baked into ONE mesh at the end; emissive lamps stay small separate meshes.
  const parts = new THREE.Group();
  const headLamps = new Batch();
  const tailLamps = new Batch();

  const paint = toon(color);
  const trim = toon(0xffffff);
  const dark = toon(PALETTE.metalDark);
  const steel = toon(COLORS.MACHINE_STEEL);
  const glass = toon(COLORS.RIVER_FOAM);
  const seatMat = toon(PALETTE.rubber);
  const lamp = toon(COLORS.COURIER_YELLOW, { emissive: COLORS.COURIER_YELLOW, emissiveIntensity: 0.7 });
  const tail = toon(PALETTE.truckRed, { emissive: PALETTE.truckRed, emissiveIntensity: 0.6 });

  const floorY = 0.62;

  // Chassis + floor.
  const chassis = mesh(geo.boxBase(3.6, 0.32, 1.5), dark);
  chassis.position.y = 0.3;
  parts.add(chassis);

  // Hood (front, −X) + grille + bumpers + headlights.
  const hood = mesh(geo.boxBase(1.3, 0.5, 1.7), paint);
  hood.position.set(-1.15, 0.45, 0);
  parts.add(hood);
  const grille = mesh(geo.box(0.06, 0.28, 1.1), dark);
  grille.position.set(-1.82, 0.7, 0);
  parts.add(grille);
  const bumperF = mesh(geo.box(0.16, 0.16, 1.8), steel);
  bumperF.position.set(-1.8, 0.42, 0);
  parts.add(bumperF);
  for (const sz of [-1, 1]) {
    headLamps.add(geo.sphere(0.13, 10, 8), COLORS.COURIER_YELLOW, -1.82, 0.72, sz * 0.62, { sx: 0.6 });
  }

  // Open-top cab: doors, dashboard, rear wall with window, windshield, roll bar.
  const cabX = -0.1;
  for (const sz of [-1, 1]) {
    const door = mesh(geo.boxBase(0.95, 0.62, 0.08), paint);
    door.position.set(cabX, 0.55, sz * 0.81);
    parts.add(door);
    const stripe = mesh(geo.box(0.95, 0.07, 0.09), trim);
    stripe.position.set(cabX, 0.95, sz * 0.81);
    parts.add(stripe);
    const win = mesh(geo.box(0.7, 0.16, 0.04), glass, { cast: false });
    win.position.set(cabX - 0.02, 1.08, sz * 0.82);
    parts.add(win);
  }
  const dash = mesh(geo.boxBase(0.22, 0.58, 1.6), paint);
  dash.position.set(cabX - 0.37, 0.55, 0);
  parts.add(dash);
  const wind = mesh(geo.box(0.05, 0.52, 1.5), glass, { cast: false });
  wind.position.set(cabX - 0.5, 1.4, 0);
  wind.rotation.z = -0.35;
  parts.add(wind);
  for (const sz of [-1, 1]) {
    const pillar = mesh(geo.box(0.07, 0.62, 0.07), paint);
    pillar.position.set(cabX - 0.48, 1.38, sz * 0.78);
    pillar.rotation.z = -0.35;
    parts.add(pillar);
  }
  const rearWall = mesh(geo.boxBase(0.1, 0.82, 1.7), paint);
  rearWall.position.set(cabX + 0.5, 0.55, 0);
  parts.add(rearWall);
  const rearWin = mesh(geo.box(0.04, 0.3, 1.1), glass, { cast: false });
  rearWin.position.set(cabX + 0.46, 1.1, 0);
  parts.add(rearWin);
  const rollBar = mesh(geo.box(0.08, 0.08, 1.7), steel);
  rollBar.position.set(cabX + 0.5, 1.4, 0);
  parts.add(rollBar);
  // Seat (bench) + cab floor.
  const cabFloor = mesh(geo.boxBase(0.95, 0.06, 1.6), seatMat);
  cabFloor.position.set(cabX, floorY - 0.04, 0);
  parts.add(cabFloor);
  const seat = mesh(geo.boxBase(0.34, 0.16, 1.2), seatMat);
  seat.position.set(cabX + 0.28, floorY, 0);
  parts.add(seat);
  const seatBack = mesh(geo.boxBase(0.1, 0.5, 1.2), seatMat);
  seatBack.position.set(cabX + 0.4, floorY, 0);
  parts.add(seatBack);

  // Bed: floor + three walls (front wall = cab rear wall), open top.
  const bedLen = 1.4;
  const bedStart = 0.4;
  const bedFloor = mesh(geo.boxBase(bedLen, 0.06, 1.7), dark);
  bedFloor.position.set(bedStart + bedLen / 2, floorY - 0.04, 0);
  parts.add(bedFloor);
  for (const sz of [-1, 1]) {
    const w = mesh(geo.boxBase(bedLen, 0.46, 0.09), paint);
    w.position.set(bedStart + bedLen / 2, floorY - 0.04, sz * 0.8);
    parts.add(w);
    const cap = mesh(geo.box(bedLen, 0.05, 0.13), steel);
    cap.position.set(bedStart + bedLen / 2, floorY + 0.44, sz * 0.8);
    parts.add(cap);
  }
  const gate = mesh(geo.boxBase(0.09, 0.46, 1.7), paint);
  gate.position.set(bedStart + bedLen - 0.04, floorY - 0.04, 0);
  parts.add(gate);
  const bumperR = mesh(geo.box(0.14, 0.14, 1.7), steel);
  bumperR.position.set(1.85, 0.42, 0);
  parts.add(bumperR);
  for (const sz of [-1, 1]) {
    tailLamps.add(geo.box(0.05, 0.12, 0.2), PALETTE.truckRed, 1.8, 0.6, sz * 0.62);
  }

  // Fenders over the wheels.
  for (const x of [-1.05, 1.2]) {
    for (const sz of [-1, 1]) {
      const f = mesh(geo.box(0.95, 0.09, 0.3), dark);
      f.position.set(x, 0.78, sz * 0.9);
      parts.add(f);
    }
  }

  // Wheels (axle along Z).
  const wr = TRUCK_WHEEL_RADIUS;
  const wheels: THREE.Object3D[] = [];
  for (const x of [-1.05, 1.2]) {
    for (const sz of [-1, 1]) {
      const w = createWheel(wr, 0.24, 'z');
      w.position.set(x, wr, sz * 0.85);
      root.add(w);
      wheels.push(w);
    }
  }

  const bedPivot = new THREE.Object3D();
  bedPivot.name = 'bedPivot';
  bedPivot.position.set(TRUCK_BED_X - 0.02, floorY - 0.01, 0);
  body.add(bedPivot);

  // Driver on the camera-side (+Z) half of the bench.
  const driverSeat = new THREE.Object3D();
  driverSeat.name = 'driverSeat';
  driverSeat.position.set(cabX + 0.25, floorY + 0.16, 0.38);
  body.add(driverSeat);

  body.add(bake(parts, { name: 'truckBody' }));
  // Lamps need emissive materials, so they cannot join the vertex-coloured body: one mesh each (head / tail).
  body.add(headLamps.mesh({ material: lamp, cast: false }), tailLamps.mesh({ material: tail, cast: false }));
  return { root, body, wheels, bedPivot, driverSeat, bubbleY: 2.5 };
}

/** Rider hips sit on the saddle: the rig's origin is at its feet, so shift it down under `riderSeat`. */
const RIDER_Y = -0.3;
/** Driver hips sit on the bench seat. */
const DRIVER_Y = -0.3;

/** Tricycle with its courier (createCharacterRig('courier')) seated on it. */
export function createTricycleWithRider(variant = 0): { model: TricycleModel; rig: CharacterRig } {
  const model = createTricycle();
  const rig = createCharacterRig('courier', variant);
  rig.setSeated(true);
  rig.root.position.y = RIDER_Y;
  model.riderSeat.add(rig.root);
  return { model, rig };
}

/** Pickup truck with its driver (createCharacterRig('driver')) seated in the open cab, facing −X. */
export function createPickupTruckWithDriver(
  color: number = PALETTE.truckRed,
  variant = 0,
): { model: PickupTruckModel; rig: CharacterRig } {
  const model = createPickupTruck(color);
  const rig = createCharacterRig('driver', variant);
  rig.setSeated(true);
  rig.root.rotation.y = -Math.PI / 2;
  rig.root.position.y = DRIVER_Y;
  model.driverSeat.add(rig.root);
  return { model, rig };
}

export const vehicleCatalog: Record<string, () => THREE.Object3D> = {
  tricycle: () => createTricycleWithRider().model.root,
  truckRed: () => createPickupTruckWithDriver(PALETTE.truckRed, 1).model.root,
  truckBlue: () => createPickupTruckWithDriver(PALETTE.truckBlue, 0).model.root,
  ...trainCatalog,
};
