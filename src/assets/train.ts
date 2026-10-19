/**
 * [B5 — commerce] AssetFactory: the Timber Ridge freight train (npc/TrainQueue.ts).
 *
 * Toy-style steam locomotive (red boiler, yellow chimney band, white-roofed cab, cow-catcher, emissive headlamp)
 * with three flatcars between it and a second, mirrored engine (0.9.12: push-pull, so an engine leads both ways:
 * +Z in to the platform, −Z out to the tunnel). It runs on a straight rail, so everything rigid is baked
 * into ONE mesh (both engines + flatcars + their wheels + stakes). Only the big driving axles are separate pivots
 * (they spin). The pine cargo is ONE InstancedMesh: logs "land" by raising `cargo.count`, so a full train costs
 * the same as an empty one.
 *
 * Draw calls (shadow pass included): body 2 + 4 axles + lamps 2 + cargo 2 = 10, plus the speech bubble sprite.
 *
 * Origin: ground level under the CENTRE of the middle flatcar, so the flatcars (not the locomotive) line up with
 * the platform when the train stops at LAYOUT.ridge.rail.stopZ.
 */
import * as THREE from 'three';
import { COLORS, PALETTE } from '../config';
import { Batch, vcMat } from '../render/batch';
import { geo, toon } from '../render/materials';

export const TRAIN_AXLE_RADIUS = 0.42;
/** Z of the flatcar centres (local; the middle car sits on the origin). */
const CAR_Z = [-2.6, 0, 2.6] as const;
const CAR_LEN = 2.3;
const CAR_W = 1.7;
const DECK_Y = 0.62;
/** Log slots: 2 across × 7 along each car, 2 layers; filled layer by layer, round-robin over the cars. */
const COLS = 2;
const ROWS = 7;
const LAYERS = 2;
const PER_LAYER = CAR_Z.length * COLS * ROWS;
export const TRAIN_CARGO_CAPACITY = PER_LAYER * LAYERS;

export interface TrainModel {
  root: THREE.Group;
  /** Everything except the driving axles: bounces / pitches. */
  body: THREE.Group;
  /** Spinning driving axle pivots (rotate `rotation.x`). */
  axles: THREE.Object3D[];
  /** Pine cargo; `count` = logs shown. */
  cargo: THREE.InstancedMesh;
  /** Where the chimney puffs come from (root space): the front engine's chimney … */
  chimney: THREE.Vector3;
  /** … and the rear engine's (it leads when the train backs out). */
  chimneyRear: THREE.Vector3;
  /** Height of the speech bubble above the ground. */
  bubbleY: number;
  /** Root-space landing position of log slot `i` (fill order). */
  slotLocal(i: number, out: THREE.Vector3): THREE.Vector3;
}

/** One log of the cargo: bark cylinder along X + light end caps (same look as the loose item). */
function logGeometry(): THREE.BufferGeometry {
  const b = new Batch().add(geo.cylinder(0.12, 0.12, 0.6, 10), COLORS.LOG_BARK, 0, 0, 0, { rz: Math.PI / 2 });
  for (const s of [-1, 1]) {
    b.add(geo.cylinder(0.1, 0.1, 0.02, 10), COLORS.LOG_CORE, s * 0.301, 0, 0, { rz: Math.PI / 2 });
  }
  return b.geometry();
}

function slotPosition(i: number, out: THREE.Vector3): THREE.Vector3 {
  const layer = Math.floor(i / PER_LAYER);
  const j = i % PER_LAYER;
  const car = j % CAR_Z.length;
  const idx = Math.floor(j / CAR_Z.length);
  const col = idx % COLS;
  const row = Math.floor(idx / COLS);
  return out.set(
    (col - (COLS - 1) / 2) * 0.66,
    DECK_Y + 0.12 + layer * 0.24,
    CAR_Z[car]! + (row - (ROWS - 1) / 2) * 0.28,
  );
}

/**
 * One toy steam locomotive, its nose toward `s` × +Z (s = 1: the front engine, z 3.8 … 7.45; s = −1: the rear engine,
 * the mirror image). 0.9.12: the train is push-pull, an engine at each end, so whichever way it runs an engine leads.
 */
function addLocomotive(b: Batch, s: 1 | -1): void {
  const red = PALETTE.truckRed;
  const redDark = 0xb02f28;
  const blue = PALETTE.truckBlue;
  const dark = PALETTE.metalDark;
  const steel = COLORS.MACHINE_STEEL;
  const rubber = PALETTE.rubber;
  const yellow = COLORS.COURIER_YELLOW;
  const white = 0xffffff;
  const HALF = Math.PI / 2;
  b.add(geo.box(1.6, 0.26, 3.2), dark, 0, 0.4, s * 5.45); // frame
  b.add(geo.box(0.12, 0.1, 0.5), steel, 0, 0.5, s * 3.8); // coupler (rear)
  // boiler: cylinder along Z + front cap + dome + sand box
  b.add(geo.cylinder(0.56, 0.56, 2.0, 18), red, 0, 1.0, s * 6.0, { rx: HALF });
  b.add(geo.cylinder(0.58, 0.58, 0.14, 18), redDark, 0, 1.0, s * 7.04, { rx: HALF });
  b.add(geo.cylinder(0.3, 0.3, 0.06, 14), dark, 0, 1.0, s * 7.13, { rx: HALF });
  b.add(geo.cylinder(0.575, 0.575, 0.08, 18), yellow, 0, 1.0, s * 6.2, { rx: HALF }); // band
  b.add(geo.sphere(0.27, 12, 8), redDark, 0, 1.55, s * 5.5, { sy: 0.8 });
  // chimney: stem + flared yellow top
  b.add(geo.cylinder(0.16, 0.2, 0.55, 12), dark, 0, 1.72, s * 6.7);
  b.add(geo.cylinder(0.27, 0.16, 0.2, 12), yellow, 0, 2.08, s * 6.7);
  // cab: walls, windows, roof overhang
  b.add(geo.box(1.5, 1.45, 1.3), redDark, 0, 1.12, s * 4.6);
  for (const sx of [-1, 1]) {
    b.add(geo.box(0.04, 0.5, 0.6), COLORS.RIVER_FOAM, sx * 0.76, 1.42, s * 4.6);
  }
  b.add(geo.box(0.9, 0.4, 0.04), COLORS.RIVER_FOAM, 0, 1.42, s * 3.94);
  b.add(geo.box(1.7, 0.14, 1.6), white, 0, 1.92, s * 4.65);
  // a tiny engineer in the cab (head + hat), purely decorative
  b.add(geo.sphere(0.17, 10, 8), 0xf5cba7, 0.0, 1.5, s * 4.55);
  b.add(geo.cylinder(0.18, 0.2, 0.14, 10), blue, 0, 1.68, s * 4.55);
  // running boards, front buffer beam, cow-catcher wedge
  for (const sx of [-1, 1]) b.add(geo.box(0.16, 0.06, 2.0), steel, sx * 0.86, 0.62, s * 5.95);
  b.add(geo.box(1.7, 0.2, 0.18), yellow, 0, 0.5, s * 7.12);
  b.add(geo.cone(0.5, 0.7, 4), steel, 0, 0.36, s * 7.45, { rx: s * HALF, ry: Math.PI / 4, sx: 1.25 });
  // static lead wheels (the two big driving axles spin separately)
  for (const sx of [-1, 1]) {
    b.add(geo.cylinder(0.24, 0.24, 0.12, 12), rubber, sx * 0.74, 0.24, s * 6.7, { rz: HALF });
    b.add(geo.cylinder(0.12, 0.12, 0.14, 10), steel, sx * 0.74, 0.24, s * 6.7, { rz: HALF });
    // side rod linking the driving wheels (static: toy look)
    b.add(geo.box(0.05, 0.07, 1.25), steel, sx * 0.9, 0.42, s * 5.4);
  }
}

export function createTrain(): TrainModel {
  const root = new THREE.Group();
  root.name = 'freightTrain';
  const body = new THREE.Group();
  body.name = 'trainBody';
  root.add(body);

  const b = new Batch();
  const blue = PALETTE.truckBlue;
  const dark = PALETTE.metalDark;
  const steel = COLORS.MACHINE_STEEL;
  const rubber = PALETTE.rubber;
  const white = 0xffffff;
  const HALF = Math.PI / 2;

  // --- flatcars -----------------------------------------------------------------------------
  for (const z of CAR_Z) {
    b.add(geo.box(1.45, 0.18, CAR_LEN - 0.1), dark, 0, 0.42, z); // chassis
    b.add(geo.box(CAR_W, 0.14, CAR_LEN), blue, 0, DECK_Y - 0.07, z); // deck slab
    b.add(geo.box(CAR_W + 0.06, 0.05, CAR_LEN + 0.06), white, 0, DECK_Y - 0.135, z); // white skirt line
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // stakes at the corners keep the logs on
        b.add(geo.box(0.09, 0.62, 0.09), steel, sx * (CAR_W / 2 - 0.06), DECK_Y + 0.31, z + sz * (CAR_LEN / 2 - 0.08));
      }
      // wheels: two axles per car
      for (const az of [-0.78, 0.78]) {
        b.add(geo.cylinder(0.3, 0.3, 0.14, 14), rubber, sx * 0.74, 0.3, z + az, { rz: HALF });
        b.add(geo.cylinder(0.16, 0.16, 0.17, 10), steel, sx * 0.74, 0.3, z + az, { rz: HALF });
      }
    }
    b.add(geo.cylinder(0.04, 0.04, 1.5, 6), dark, 0, 0.3, z - 0.78, { rz: HALF });
    b.add(geo.cylinder(0.04, 0.04, 1.5, 6), dark, 0, 0.3, z + 0.78, { rz: HALF });
    // coupler bar toward the next car
    b.add(geo.box(0.12, 0.1, 0.5), steel, 0, 0.5, z + CAR_LEN / 2 + 0.08);
  }

  // --- locomotives: one at each end (push-pull, 0.9.12) ------------------------------------
  addLocomotive(b, 1);
  addLocomotive(b, -1);
  body.add(b.mesh({ cast: true, receive: true }));
  body.children[0]!.name = 'trainMesh';

  // headlamp (emissive, so its own mesh)
  const lampMat = toon(COLORS.COURIER_YELLOW, { emissive: COLORS.COURIER_YELLOW, emissiveIntensity: 0.8 });
  for (const s of [1, -1]) {
    const lamp = new THREE.Mesh(geo.sphere(0.14, 10, 8), lampMat);
    lamp.position.set(0, 1.45, s * 7.15);
    lamp.scale.set(1, 1, 0.7);
    body.add(lamp);
  }

  // --- spinning driving axles (big wheels with a spoke so the spin reads) -----------------------
  const axles: THREE.Object3D[] = [];
  for (const z of [4.95, 5.95, -4.95, -5.95]) {
    const pivot = new THREE.Group();
    pivot.name = 'trainAxle';
    pivot.position.set(0, TRAIN_AXLE_RADIUS, z);
    const a = new Batch();
    for (const sx of [-1, 1]) {
      a.add(geo.cylinder(TRAIN_AXLE_RADIUS, TRAIN_AXLE_RADIUS, 0.14, 18), rubber, sx * 0.74, 0, 0, { rz: HALF });
      a.add(geo.cylinder(0.2, 0.2, 0.17, 12), steel, sx * 0.74, 0, 0, { rz: HALF });
      a.add(geo.box(0.17, 0.66, 0.09), dark, sx * 0.74, 0, 0);
      a.add(geo.box(0.17, 0.09, 0.66), dark, sx * 0.74, 0, 0);
    }
    a.add(geo.cylinder(0.05, 0.05, 1.5, 6), dark, 0, 0, 0, { rz: HALF });
    pivot.add(a.mesh({ cast: false }));
    root.add(pivot);
    axles.push(pivot);
  }

  // --- cargo: one InstancedMesh for every log slot ---------------------------------------------
  const cargo = new THREE.InstancedMesh(logGeometry(), vcMat(), TRAIN_CARGO_CAPACITY);
  cargo.name = 'trainCargo';
  cargo.castShadow = true;
  cargo.receiveShadow = true;
  cargo.frustumCulled = false; // the base geometry's bounding sphere is one log; the instances span the cars
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < TRAIN_CARGO_CAPACITY; i++) {
    slotPosition(i, p);
    e.set(0, Math.sin(i * 12.9898) * 0.05, 0);
    q.setFromEuler(e);
    cargo.setMatrixAt(i, m.compose(p, q, s));
  }
  cargo.count = 0;
  cargo.instanceMatrix.needsUpdate = true;
  body.add(cargo);

  return {
    root,
    body,
    axles,
    cargo,
    chimney: new THREE.Vector3(0, 2.25, 6.7),
    chimneyRear: new THREE.Vector3(0, 2.25, -6.7),
    bubbleY: 3.1,
    slotLocal: slotPosition,
  };
}

export const trainCatalog: Record<string, () => THREE.Object3D> = {
  freightTrain: () => {
    const t = createTrain();
    t.cargo.count = 20;
    return t.root;
  },
};
