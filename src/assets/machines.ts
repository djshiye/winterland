/**
 * [B6 — machines] AssetFactory: the giant log, the drop-zone slab and every machine. STUB — replace the
 * placeholder bodies; you own this file and its consumers (stations/*), so reshape the handle types
 * freely (expose whatever parts you animate).
 *
 * Art spec:
 * - GIANT LOG: cylinder r 1.8, length 12 in LOG_BARK along local Z; END CAPS r 1.65 in LOG_CORE with 3
 *   concentric darker rings; a lighter yellow CUT BAND (LOG_CUT_BAND #F7D070) around the trunk at the
 *   active chopping section (expose it so the station can place/flash it).
 * - DROP-ZONE SLAB: DROP_ZONE_GREY (#8E969E) slab with a DROP_ZONE_BORDER (#D6DCDF) rim.
 * - HARVESTER: two dark-steel rails parallel to the log; a blue (MACHINE_BLUE) boxy chassis sliding on
 *   them; two hinged blue boom arms ending in a spinning circular saw with teeth (MACHINE_STEEL disc,
 *   SAW_GLOW accents); continuous LOG_CORE chip particles come from the station, not the model.
 * - PROCESSOR: blue tunnel box 1.6 (X) × 1.5 (high) × 1.4 (Z) with dark openings on both ends (−X in,
 *   +X out) and hazard stripes or louver slats; a wooden output workbench in FENCE_WOOD.
 * - ROLLER CONVEYOR: steel side rails with closely spaced dark grey roller cylinders (separate objects or
 *   an InstancedMesh so they can spin); follows a waypoint spline through `path`.
 * - MEGA SAW (phase 5): steel gantry over the river, giant toothed blade on a carriage, MACHINE_BLUE
 *   housings, SAW_GLOW accents.
 */
import * as THREE from 'three';
import { COLORS, type XZ } from '../config';
import { geo, mesh, toon } from '../render/materials';

export interface GiantLogModel {
  root: THREE.Group;
  /** The LOG_CUT_BAND ring; local Z position = chopping section. */
  cutBand: THREE.Object3D;
}

export function createGiantLog(): GiantLogModel {
  const root = new THREE.Group();
  const trunk = mesh(geo.cylinder(1.8, 1.8, 12, 24), toon(COLORS.LOG_BARK));
  trunk.rotation.x = Math.PI / 2;
  const cutBand = mesh(geo.cylinder(1.82, 1.82, 0.5, 24), toon(COLORS.LOG_CUT_BAND));
  cutBand.rotation.x = Math.PI / 2;
  root.add(trunk, cutBand);
  return { root, cutBand };
}

export function createDropZoneSlab(w: number, d: number): THREE.Group {
  return new THREE.Group().add(mesh(geo.boxBase(w, 0.08, d), toon(COLORS.DROP_ZONE_GREY), { cast: false }));
}

export interface HarvesterModel {
  /** Rails + sleepers (static). */
  root: THREE.Group;
  /** Slides along the rails (local Z). */
  chassis: THREE.Object3D;
  /** Spinning blade (spin about its local axis). */
  saw: THREE.Object3D;
}

export function createHarvester(railLength: number): HarvesterModel {
  const root = new THREE.Group();
  root.add(mesh(geo.box(0.6, 0.1, railLength), toon(COLORS.MACHINE_STEEL)));
  const chassis = new THREE.Group();
  chassis.add(mesh(geo.boxBase(1.2, 1.0, 1.4), toon(COLORS.MACHINE_BLUE)));
  const saw = mesh(geo.cylinder(0.7, 0.7, 0.08, 24), toon(COLORS.MACHINE_STEEL));
  saw.position.set(-1.8, 1.0, 0);
  saw.rotation.z = Math.PI / 2;
  chassis.add(saw);
  root.add(chassis);
  return { root, chassis, saw };
}

export interface ProcessorModel {
  root: THREE.Group;
  /** Squash target. */
  body: THREE.Object3D;
}

export function createProcessor(): ProcessorModel {
  const root = new THREE.Group();
  const body = mesh(geo.boxBase(1.6, 1.5, 1.4), toon(COLORS.MACHINE_BLUE));
  root.add(body);
  return { root, body };
}

export interface RollerConveyorModel {
  root: THREE.Group;
  /** Roller objects to spin (or an InstancedMesh). */
  rollers: THREE.Object3D[];
}

export function createRollerConveyor(path: readonly XZ[], width: number, beltY: number): RollerConveyorModel {
  const root = new THREE.Group();
  const a = path[0]!;
  const b = path[path.length - 1]!;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const belt = mesh(geo.box(width, 0.1, len), toon(COLORS.MACHINE_STEEL));
  belt.position.set((a.x + b.x) / 2, beltY - 0.05, (a.z + b.z) / 2);
  belt.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  root.add(belt);
  return { root, rollers: [] };
}

export interface MegaSawModel {
  root: THREE.Group;
  /** Moves down/up each cycle. */
  carriage: THREE.Object3D;
  blade: THREE.Object3D;
}

export function createMegaSaw(bladeRadius: number): MegaSawModel {
  const root = new THREE.Group();
  const carriage = new THREE.Group();
  const blade = mesh(geo.cylinder(bladeRadius, bladeRadius, 0.12, 32), toon(COLORS.MACHINE_STEEL));
  blade.rotation.x = Math.PI / 2;
  carriage.add(blade);
  root.add(carriage);
  return { root, carriage, blade };
}

export const machineCatalog: Record<string, () => THREE.Object3D> = {
  giantLog: () => createGiantLog().root,
  dropZoneSlab: () => createDropZoneSlab(2.8, 2.7),
  harvester: () => createHarvester(6.6).root,
  processor: () => createProcessor().root,
  conveyor: () =>
    createRollerConveyor(
      [
        { x: 0, z: 0 },
        { x: 0, z: 4 },
      ],
      0.8,
      0.5,
    ).root,
  megaSaw: () => createMegaSaw(2.3).root,
};
