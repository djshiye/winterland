/**
 * 0.9.0 region dressing models (world/env/frontier.ts): three low-poly props per era 2..10, each merged into ONE
 * vertex-coloured geometry so a whole kind is a single instanced draw (`eraPropGeometry`). Roles decide where
 * frontier.ts places them: `tall` stands on the region's west strip (the camera looks toward -X/-Z, so tall things
 * hide nothing there), `mid` and `low` fill the margins around the machine slots.
 *
 * Origin of every prop = the centre of its footprint on the ground (y = 0). Models are authored in metres.
 * Every model is also listed in `frontierCatalog` (shown by the ?gallery page: --query gallery=frontierProps).
 */
import * as THREE from 'three';
import { PALETTE } from '../config';
import { Batch, vcMat } from '../render/batch';
import { geo } from '../render/materials';

export type PropRole = 'tall' | 'mid' | 'low';
export const PROP_ROLES: readonly PropRole[] = ['tall', 'mid', 'low'];

/** Local positions (x, y, z) of the four wire insulators of the era 6 pylon (frontier.ts strings wires between them). */
export const PYLON_TIPS: readonly (readonly [number, number, number])[] = [
  [-1.2, 5.95, 0],
  [1.2, 5.95, 0],
  [-1.7, 4.75, 0],
  [1.7, 4.75, 0],
];

const SNOW = PALETTE.snow;
const Y = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();

/** Tiny modelling kit over Batch: base-anchored boxes / cylinders / cones, balls and slanted beams. */
class Kit {
  readonly b = new Batch();

  /** Box of size w × h × d whose bottom face centre is (x, y0, z). */
  box(w: number, h: number, d: number, color: number, x: number, y0: number, z: number, ry = 0): this {
    this.b.add(geo.box(w, h, d), color, x, y0 + h / 2, z, { ry });
    return this;
  }

  /** Upright cylinder (r at the top, rb at the bottom; default = r). */
  cyl(r: number, h: number, color: number, x: number, y0: number, z: number, rb = r, seg = 8): this {
    this.b.add(geo.cylinder(r, rb, h, seg), color, x, y0 + h / 2, z);
    return this;
  }

  /** Cylinder lying along X (rz = π/2) or Z (rx = π/2). */
  lying(axis: 'x' | 'z', r: number, len: number, color: number, x: number, y: number, z: number, seg = 8): this {
    this.b.add(geo.cylinder(r, r, len, seg), color, x, y, z, axis === 'x' ? { rz: Math.PI / 2 } : { rx: Math.PI / 2 });
    return this;
  }

  cone(r: number, h: number, color: number, x: number, y0: number, z: number, seg = 7, ry = 0): this {
    this.b.add(geo.cone(r, h, seg), color, x, y0 + h / 2, z, { ry });
    return this;
  }

  /** Low-poly lump (dodecahedron) scaled on each axis. */
  lump(r: number, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0): this {
    this.b.add(geo.dodecahedron(r, 0), color, x, y, z, { sx, sy, sz, ry });
    return this;
  }

  /** A thin white snow cap lying on a surface of size w × d at height y. */
  cap(w: number, d: number, x: number, y: number, z: number): this {
    return this.box(w, 0.07, d, SNOW, x, y, z);
  }

  /** Square-section beam from point a to point c. */
  beam(a: readonly [number, number, number], c: readonly [number, number, number], thick: number, color: number): this {
    _a.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const len = _a.length();
    _q.setFromUnitVectors(Y, _a.normalize());
    _v.set((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
    _s.set(1, 1, 1);
    this.b.addMatrix(geo.box(thick, len, thick), color, _m.compose(_v, _q, _s));
    return this;
  }

  geometry(): THREE.BufferGeometry {
    return this.b.geometry();
  }
}

// ---------------------------------------------------------------------------
// Era 2 — Frontier: stone, timber
// ---------------------------------------------------------------------------

function timberCrane(): THREE.BufferGeometry {
  const k = new Kit();
  const wood = 0x8a6a46;
  const dark = 0x5e452c;
  k.box(2.6, 0.3, 1.8, dark, 0, 0, 0);
  k.beam([-0.9, 0.3, 0], [0, 4.3, 0], 0.22, wood).beam([0.9, 0.3, 0], [0, 4.3, 0], 0.22, wood);
  k.beam([0, 0.3, -0.7], [0, 4.2, 0], 0.18, wood);
  k.beam([-0.1, 4.0, 0], [3.0, 3.5, 0], 0.18, dark); // jib
  k.beam([0, 4.4, 0], [3.0, 3.6, 0], 0.07, 0x3a2a1a);
  k.box(0.04, 1.4, 0.04, 0x3a2a1a, 2.8, 2.1, 0); // rope
  k.box(0.4, 0.3, 0.4, 0x6d5a48, 2.8, 1.8, 0); // hanging stone block
  k.box(0.5, 0.35, 0.4, 0xa7a39b, -1.6, 0.3, 0.2).cap(0.5, 0.4, -1.6, 0.65, 0.2);
  k.cap(0.34, 0.34, 0, 4.4, 0);
  return k.geometry();
}

function rockOutcrop(): THREE.BufferGeometry {
  const k = new Kit();
  k.lump(1.0, 0x9b968c, 0, 0.7, 0, 1.3, 0.85, 1.0, 0.3);
  k.lump(0.7, 0xa7a39b, 1.2, 0.45, 0.5, 1.1, 0.8, 1.2, 1.0);
  k.lump(0.55, 0x8a857c, -0.9, 0.35, 0.8, 1.2, 0.8, 1, 2.0);
  k.lump(0.45, SNOW, 0, 1.25, 0, 1.3, 0.35, 1.0, 0.3);
  k.lump(0.3, SNOW, 1.2, 0.8, 0.5, 1.1, 0.3, 1.2, 1.0);
  return k.geometry();
}

function stonePile(): THREE.BufferGeometry {
  const k = new Kit();
  const c = [0xa7a39b, 0xb2aea6, 0x8f8a82];
  for (let i = 0; i < 3; i++) k.box(1.0, 0.42, 0.7, c[i]!, (i - 1) * 0.55, 0, 0, 0.05 * i);
  for (let i = 0; i < 2; i++) k.box(0.9, 0.4, 0.65, c[(i + 1) % 3]!, (i - 0.5) * 0.6, 0.42, 0.02, -0.08 * i);
  k.box(0.9, 0.4, 0.65, c[0]!, 0, 0.82, 0, 0.12);
  k.cap(0.8, 0.55, 0, 1.22, 0);
  return k.geometry();
}

// ---------------------------------------------------------------------------
// Era 3 — Iron Age: ore, rails, timber props
// ---------------------------------------------------------------------------

function mineSupport(): THREE.BufferGeometry {
  const k = new Kit();
  const wood = 0x7a5a3a;
  k.box(0.3, 3.2, 0.3, wood, -1.2, 0, 0).box(0.3, 3.2, 0.3, wood, 1.2, 0, 0);
  k.box(3.2, 0.32, 0.4, 0x5e452c, 0, 3.1, 0);
  k.beam([-1.2, 2.2, 0], [-0.4, 3.1, 0], 0.14, wood).beam([1.2, 2.2, 0], [0.4, 3.1, 0], 0.14, wood);
  k.box(0.3, 0.3, 0.3, 0x3d3a3a, 0, 2.6, 0.05); // hanging lantern body
  k.box(0.6, 0.18, 0.6, 0x6d6a66, 0, 0.0, 0.4); // stones at the foot
  k.cap(3.2, 0.42, 0, 3.42, 0);
  k.lump(0.8, 0x77706a, 0.5, 0.45, -1.0, 1.4, 0.8, 1.0).lump(0.5, SNOW, 0.5, 0.78, -1.0, 1.3, 0.3, 1.0);
  return k.geometry();
}

function mineCart(): THREE.BufferGeometry {
  const k = new Kit();
  for (let i = 0; i < 6; i++) k.box(1.0, 0.07, 0.14, 0x5e452c, 0, 0, -1.25 + i * 0.5);
  for (const x of [-0.38, 0.38]) k.box(0.07, 0.1, 3.0, 0x4a4a4f, x, 0.07, 0);
  k.box(0.9, 0.5, 1.2, 0x3d3a3a, 0, 0.3, 0.2); // cart body
  k.box(0.98, 0.1, 1.28, 0x2c2a2a, 0, 0.78, 0.2);
  for (const x of [-0.42, 0.42]) for (const z of [-0.2, 0.6]) k.lying('x', 0.16, 0.08, 0x2c2a2a, x, 0.2, z, 8);
  k.cone(0.55, 0.45, 0x7c5a4a, 0, 0.8, 0.2, 6).cone(0.25, 0.25, 0xb0704e, 0.2, 1.05, 0.1, 5);
  return k.geometry();
}

function oreHeap(): THREE.BufferGeometry {
  const k = new Kit();
  k.cone(1.2, 1.0, 0x7c5a4a, 0, 0, 0, 7).cone(0.7, 0.8, 0x8a6650, 0.9, 0, 0.4, 6).cone(0.55, 0.6, 0x6e4e3f, -0.8, 0, 0.5, 6);
  k.lump(0.14, 0xb0704e, 0.3, 0.55, 0.5, 1, 0.8, 1).lump(0.12, 0xb0704e, -0.3, 0.45, 0.6, 1, 0.8, 1).lump(0.12, 0xc58b62, 0.7, 0.35, 0.8, 1, 0.8, 1);
  k.cone(0.4, 0.25, SNOW, 0, 0.8, 0, 7);
  return k.geometry();
}

// ---------------------------------------------------------------------------
// Era 4 — Steam Age: coal, pipes, water tower
// ---------------------------------------------------------------------------

function waterTower(): THREE.BufferGeometry {
  const k = new Kit();
  const wood = 0x5e4a34;
  for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]] as const) k.beam([x, 0, z], [x * 0.8, 3.4, z * 0.8], 0.2, wood);
  k.beam([-0.9, 0.6, -0.9], [0.9, 2.0, -0.9], 0.07, 0x2f2b2b).beam([0.9, 0.6, 0.9], [-0.9, 2.0, 0.9], 0.07, 0x2f2b2b);
  k.cyl(1.25, 1.5, 0x7a5a3a, 0, 3.4, 0, 1.25, 10); // tank
  for (const y of [3.7, 4.4]) k.cyl(1.3, 0.09, 0x2f2b2b, 0, y, 0, 1.3, 10);
  k.cone(1.45, 0.9, 0x3a3532, 0, 4.9, 0, 10);
  k.cone(1.0, 0.25, SNOW, 0, 5.4, 0, 10);
  k.cyl(0.14, 2.8, 0x2f2b2b, 1.3, 0.2, 0.0); // spout pipe
  return k.geometry();
}

function steamPipe(): THREE.BufferGeometry {
  const k = new Kit();
  const brass = 0xb08a3e;
  const iron = 0x4a4642;
  for (const x of [-1.5, 0, 1.5]) k.box(0.2, 0.7, 0.4, 0x3a3532, x, 0, 0);
  k.lying('x', 0.24, 4.2, iron, 0, 0.9, 0, 8);
  for (const x of [-1.5, 0, 1.5]) k.lying('x', 0.28, 0.14, brass, x, 0.9, 0, 8);
  k.cyl(0.2, 1.4, iron, 2.0, 0.9, 0).cyl(0.26, 0.12, brass, 2.0, 1.7, 0); // riser
  k.cyl(0.12, 0.4, iron, -0.6, 1.1, 0).lying('x', 0.2, 0.05, brass, -0.6, 1.55, 0); // valve wheel
  k.cap(4.2, 0.4, 0, 1.2, 0);
  return k.geometry();
}

function coalHeap(): THREE.BufferGeometry {
  const k = new Kit();
  k.cone(1.3, 1.1, 0x2c2b2e, 0, 0, 0, 7).cone(0.8, 0.8, 0x3a393d, 1.0, 0, 0.3, 6).cone(0.6, 0.6, 0x242326, -0.9, 0, 0.5, 6);
  k.lump(0.16, 0x4a484d, 0.4, 0.7, 0.4, 1, 0.8, 1).lump(0.14, 0x4a484d, -0.4, 0.5, 0.7, 1, 0.8, 1);
  k.cone(0.4, 0.28, SNOW, 0, 0.85, 0, 7);
  k.box(1.0, 0.1, 0.8, 0x6d5a48, 1.3, 0, -0.9).box(0.14, 0.5, 0.1, 0x6d5a48, 1.0, 0, -0.9); // shovel board
  return k.geometry();
}

// ---------------------------------------------------------------------------
// Era 5 — Industrial: girders, stacks, slag
// ---------------------------------------------------------------------------

function smokeStack(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(2.0, 0.5, 2.0, 0x50555b, 0, 0, 0);
  k.cyl(0.55, 7.4, 0x8a5a4a, 0, 0.5, 0, 0.9, 10); // brick shaft
  k.cyl(0.6, 0.3, 0xe8e2d4, 0, 6.0, 0, 0.64, 10); // white band
  k.cyl(0.7, 0.5, 0x2e3034, 0, 7.4, 0, 0.58, 10); // black rim
  k.cap(0.8, 0.8, 0, 7.9, 0);
  k.beam([0.9, 0.5, 0], [0.62, 6.4, 0], 0.06, 0x34383d); // ladder rail
  return k.geometry();
}

function slagHeap(): THREE.BufferGeometry {
  const k = new Kit();
  k.cone(1.4, 1.2, 0x3d3f44, 0, 0, 0, 7).cone(0.9, 0.9, 0x4b4d52, 1.1, 0, 0.5, 6).cone(0.7, 0.7, 0x34363a, -1.0, 0, 0.6, 6);
  for (const [x, y, z] of [[0.3, 0.7, 0.6], [-0.5, 0.45, 0.8], [0.9, 0.5, 0.95], [-1.0, 0.32, 1.0]] as const) k.box(0.2, 0.12, 0.2, 0xd0702a, x, y, z, 0.6);
  k.cone(0.4, 0.28, SNOW, 0, 0.95, 0, 7);
  return k.geometry();
}

function girderStack(): THREE.BufferGeometry {
  const k = new Kit();
  const steel = 0x7f8b99;
  for (const x of [-0.9, 0.9]) k.box(0.2, 0.2, 0.5, 0x5e452c, x, 0, 0);
  for (let i = 0; i < 3; i++) {
    for (const z of [-0.2, 0.2]) {
      k.box(2.8, 0.1, 0.32, steel, 0, 0.2 + i * 0.4, z * 1.2); // flanges
      k.box(2.8, 0.2, 0.08, 0x6b7785, 0, 0.3 + i * 0.4, z * 1.2);
    }
    k.box(0.14, 0.1, 1.1, 0x5e452c, -1.0 + i * 0.8, 0.5 + i * 0.4 - 0.1, 0);
  }
  k.box(2.8, 0.1, 0.32, 0xd0702a, 0, 1.4, 0.2).cap(2.8, 0.7, 0, 1.5, 0);
  return k.geometry();
}

// ---------------------------------------------------------------------------
// Era 6 — Electric: pylon, transformer, cable drum
// ---------------------------------------------------------------------------

function pylon(): THREE.BufferGeometry {
  const k = new Kit();
  const steel = 0x6f7f88;
  const legs: [number, number][] = [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]];
  k.box(2.4, 0.3, 2.4, 0x6d6a66, 0, 0, 0);
  for (const [x, z] of legs) k.beam([x, 0.3, z], [x * 0.2, 5.9, z * 0.2], 0.14, steel);
  for (const y of [1.4, 2.8, 4.2]) {
    const s = 0.9 * (1 - (y - 0.3) / 5.6 * 0.8);
    k.beam([-s, y, -s], [s, y, -s], 0.06, steel).beam([-s, y, s], [s, y, s], 0.06, steel).beam([-s, y, -s], [-s, y, s], 0.06, steel).beam([s, y, -s], [s, y, s], 0.06, steel);
    k.beam([-s, y, -s], [s * 0.8, y + 1.4, s * 0.8], 0.045, steel);
  }
  k.box(2.6, 0.14, 0.14, steel, 0, 5.9, 0).box(3.6, 0.14, 0.14, steel, 0, 4.7, 0); // the two cross arms
  k.cone(0.3, 0.7, steel, 0, 6.0, 0, 4);
  for (const [x, y, z] of PYLON_TIPS) k.cyl(0.07, 0.4, 0xb8d6d0, x, y - 0.38, z, 0.07, 5); // insulators
  return k.geometry();
}

function transformer(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(1.8, 0.2, 1.4, 0x6d6a66, 0, 0, 0);
  k.box(1.3, 1.4, 1.0, 0x2e4a5a, 0, 0.2, 0);
  for (let i = 0; i < 5; i++) k.box(0.08, 1.0, 0.18, 0x3f6074, -0.55 + i * 0.28, 0.35, 0.58);
  for (const x of [-0.4, 0, 0.4]) k.cyl(0.07, 0.5, 0xb8d6d0, x, 1.6, 0, 0.12, 6).cyl(0.14, 0.08, 0xc9773a, x, 2.0, 0);
  k.box(0.5, 0.5, 0.06, 0xf2d34a, 0, 0.7, -0.53); // warning plate
  k.cap(1.3, 1.0, 0, 1.6, 0);
  return k.geometry();
}

function cableDrum(): THREE.BufferGeometry {
  const k = new Kit();
  k.lying('x', 0.75, 0.1, 0x8a6a46, -0.45, 0.78, 0, 12).lying('x', 0.75, 0.1, 0x8a6a46, 0.45, 0.78, 0, 12);
  k.lying('x', 0.55, 0.8, 0xc9773a, 0, 0.78, 0, 10).lying('x', 0.3, 0.9, 0x5a3a20, 0, 0.78, 0, 8);
  k.box(1.2, 0.08, 0.7, 0x5e452c, 0, 0, -1.0).box(1.0, 0.12, 0.2, 0xc9773a, 0, 0.1, -1.0); // spare coil on a plank
  k.cap(1.0, 0.3, 0, 1.52, 0);
  return k.geometry();
}

// ---------------------------------------------------------------------------
// Era 7 — Oil: derrick, tank, barrels
// ---------------------------------------------------------------------------

function derrick(): THREE.BufferGeometry {
  const k = new Kit();
  const steel = 0xe0b03a;
  const dark = 0x272a30;
  k.box(2.4, 0.25, 2.4, dark, 0, 0, 0);
  const legs: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [x, z] of legs) k.beam([x, 0.25, z], [x * 0.25, 4.9, z * 0.25], 0.12, steel);
  for (const y of [1.2, 2.4, 3.6]) {
    const s = 1 - (y / 4.9) * 0.75;
    k.beam([-s, y, -s], [s, y, -s], 0.05, steel).beam([-s, y, s], [s, y, s], 0.05, steel).beam([-s, y, -s], [-s, y, s], 0.05, steel).beam([s, y, -s], [s, y, s], 0.05, steel);
    k.beam([-s, y, s], [s * 0.7, y + 1.2, s * 0.7], 0.04, steel);
  }
  k.box(0.5, 0.35, 0.5, dark, 0, 4.9, 0).cap(0.5, 0.5, 0, 5.25, 0);
  k.cyl(0.06, 4.0, 0x4a4d55, 0, 0.25, 0); // drill pipe
  return k.geometry();
}

function storageTank(): THREE.BufferGeometry {
  const k = new Kit();
  k.cyl(1.5, 2.8, 0x8f9298, 0, 0.2, 0, 1.5, 12);
  for (const y of [1.0, 2.0]) k.cyl(1.54, 0.08, 0x44474e, 0, y, 0, 1.54, 12);
  k.cyl(1.52, 0.4, 0xe0b03a, 0, 2.2, 0, 1.52, 12); // accent stripe
  k.cone(1.55, 0.55, 0x727880, 0, 3.0, 0, 12).cone(1.0, 0.2, SNOW, 0, 3.4, 0, 12);
  k.box(0.3, 3.0, 0.08, 0x44474e, 1.5, 0.2, 0.3, 0.5); // ladder
  k.box(1.4, 0.15, 1.4, 0x6d6a66, 0, 0, 0);
  return k.geometry();
}

function barrelRack(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(1.9, 0.12, 1.2, 0x6d5a48, 0, 0, 0);
  const barrel = (x: number, y0: number, z: number): void => {
    k.cyl(0.3, 0.85, 0x2a2d33, x, y0, z, 0.3, 8).cyl(0.31, 0.08, 0xe0b03a, x, y0 + 0.35, z, 0.31, 8);
  };
  for (const x of [-0.6, 0, 0.6]) for (const z of [-0.3, 0.3]) barrel(x, 0.12, z);
  barrel(-0.3, 0.97, 0);
  barrel(0.3, 0.97, 0);
  k.cap(1.3, 0.5, 0, 1.84, 0);
  return k.geometry();
}

// ---------------------------------------------------------------------------
// Era 8 — Computer: dish, solar panels, relay cabinet
// ---------------------------------------------------------------------------

function dish(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(1.6, 0.25, 1.6, 0x8a98a6, 0, 0, 0);
  k.cyl(0.14, 2.6, 0xdfe6ee, 0, 0.25, 0, 0.18, 8);
  // the bowl: a flattened sphere cap tilted toward the camera
  const bowl = new THREE.SphereGeometry(1.7, 14, 6, 0, Math.PI * 2, 0, 0.55);
  k.b.add(bowl, 0xf2f5f8, 0, 3.6, 0, { rx: 0.9, ry: 0.8, sx: 1, sy: 0.55, sz: 1 });
  k.b.add(geo.cylinder(0.05, 0.05, 1.5, 5), 0x3aa0d8, 0.3, 4.1, 0.4, { rx: -0.6, rz: 0.3 });
  k.box(0.22, 0.22, 0.22, 0x3aa0d8, 0.5, 4.8, 0.85);
  return k.geometry();
}

function solarArray(): THREE.BufferGeometry {
  const k = new Kit();
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 1.55;
    k.box(0.12, 0.7, 0.12, 0x8a98a6, x, 0, 0.45);
    k.b.add(geo.box(1.4, 0.07, 1.6), 0x244a78, x, 1.1, 0, { rx: 0.55 });
    k.b.add(geo.box(1.45, 0.03, 0.05), 0xdfe8f2, x, 1.12, 0.05, { rx: 0.55 });
    k.b.add(geo.box(0.05, 0.03, 1.55), 0xdfe8f2, x, 1.12, 0, { rx: 0.55 });
    k.b.add(geo.box(1.4, 0.06, 0.2), SNOW, x, 1.45, -0.55, { rx: 0.55 });
  }
  return k.geometry();
}

function relayBox(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(1.1, 1.5, 0.8, 0xdfe6ee, 0, 0, 0).box(1.2, 0.1, 0.9, 0x8a98a6, 0, 1.5, 0);
  for (let i = 0; i < 4; i++) k.box(0.7, 0.05, 0.02, i % 2 ? 0x3aa0d8 : 0x2a3a4a, 0, 0.25 + i * 0.28, 0.41);
  k.box(0.08, 1.3, 0.08, 0x8a98a6, 0.4, 1.6, 0.1).box(0.2, 0.2, 0.2, 0x3aa0d8, 0.4, 2.9, 0.1);
  k.cap(1.1, 0.8, 0, 1.6, 0);
  return k.geometry();
}

// ---------------------------------------------------------------------------
// Era 9 — Nuclear: light mast, lead wall, hazard barrels
// ---------------------------------------------------------------------------

function lightMast(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(1.2, 0.3, 1.2, 0x5a6470, 0, 0, 0);
  k.cyl(0.12, 5.0, 0x6e7d6a, 0, 0.3, 0, 0.18, 6);
  k.box(1.5, 0.35, 0.3, 0x2d3b2a, 0, 5.3, 0).box(0.3, 0.2, 0.1, 0xf5f1c0, -0.5, 5.4, 0.2).box(0.3, 0.2, 0.1, 0xf5f1c0, 0.5, 5.4, 0.2);
  // hazard sign (yellow plate with a green trefoil dot)
  k.box(0.9, 0.9, 0.08, 0xf2d34a, 0, 2.8, 0.22).box(0.4, 0.4, 0.1, 0x2d3b2a, 0, 3.05, 0.22).cone(0.25, 0.2, 0x7bd04a, 0, 2.95, 0.3, 3);
  k.cap(1.5, 0.3, 0, 5.65, 0);
  return k.geometry();
}

function leadWall(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(3.2, 1.8, 0.7, 0x6b7380, 0, 0, 0);
  for (let i = 0; i < 8; i++) k.box(0.4, 0.22, 0.74, i % 2 ? 0xf2d34a : 0x2d3b2a, -1.4 + i * 0.4, 1.8, 0, 0);
  k.box(3.4, 0.14, 0.9, 0x4f5662, 0, 0, 0).box(3.6, 0.2, 1.1, 0x4f5662, 0, -0.0, 0);
  k.cap(3.2, 0.7, 0, 2.02, 0);
  return k.geometry();
}

function hazardBarrels(): THREE.BufferGeometry {
  const k = new Kit();
  const barrel = (x: number, y0: number, z: number): void => {
    k.cyl(0.3, 0.9, 0xf2d34a, x, y0, z, 0.3, 8).cyl(0.31, 0.2, 0x2d3b2a, x, y0 + 0.35, z, 0.31, 8).cyl(0.2, 0.04, 0x7bd04a, x, y0 + 0.88, z, 0.2, 6);
  };
  barrel(-0.4, 0, 0);
  barrel(0.4, 0, 0.05);
  barrel(0, 0, 0.7);
  barrel(0, 0.9, 0.3);
  k.box(1.4, 0.1, 1.5, 0x6d5a48, 0, 0, 0.25);
  return k.geometry();
}

// ---------------------------------------------------------------------------
// Era 10 — AI: holo pylon, nano spire, server crate
// ---------------------------------------------------------------------------

function holoPylon(): THREE.BufferGeometry {
  const k = new Kit();
  k.cyl(0.9, 0.2, 0x2a2f55, 0, 0, 0, 1.1, 10);
  k.cyl(0.12, 5.0, 0x1f2240, 0, 0.2, 0, 0.3, 6);
  k.cyl(0.1, 0.2, 0x9b6cff, 0, 5.2, 0, 0.1, 6);
  k.b.add(geo.torus(0.85, 0.06, 5, 16), 0x9b6cff, 0, 3.3, 0, { rx: Math.PI / 2 });
  k.b.add(geo.torus(0.6, 0.05, 5, 16), 0xc8b0ff, 0, 4.3, 0, { rx: Math.PI / 2 });
  k.b.add(geo.icosahedron(0.32, 0), 0xe8dcff, 0, 5.6, 0);
  return k.geometry();
}

function nanoSpire(): THREE.BufferGeometry {
  const k = new Kit();
  k.cyl(1.3, 0.2, 0x1f2240, 0, 0, 0, 1.5, 8);
  for (const [x, z, h, c] of [[0, 0, 3.0, 0x9b6cff], [0.7, 0.3, 1.9, 0xc8b0ff], [-0.6, 0.5, 1.5, 0x7a4de0], [0.1, -0.7, 2.2, 0xb59bff]] as const) {
    k.cone(0.4, h, c, x, 0.2, z, 4, x);
  }
  return k.geometry();
}

function serverCrate(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(1.1, 1.3, 0.9, 0x1f2240, 0, 0, 0).box(1.16, 0.08, 0.96, 0x3a3f70, 0, 1.3, 0);
  for (let i = 0; i < 4; i++) {
    k.box(0.9, 0.08, 0.02, 0x0e1030, 0, 0.2 + i * 0.28, 0.46);
    k.box(0.1, 0.06, 0.03, i % 2 ? 0x9b6cff : 0x3aa0d8, -0.3 + (i % 3) * 0.3, 0.2 + i * 0.28, 0.47);
  }
  k.cap(1.1, 0.9, 0, 1.38, 0);
  return k.geometry();
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const BUILDERS: Record<number, Record<PropRole, { name: string; make: () => THREE.BufferGeometry }>> = {
  2: { tall: { name: 'timberCrane', make: timberCrane }, mid: { name: 'rockOutcrop', make: rockOutcrop }, low: { name: 'stonePile', make: stonePile } },
  3: { tall: { name: 'mineSupport', make: mineSupport }, mid: { name: 'mineCart', make: mineCart }, low: { name: 'oreHeap', make: oreHeap } },
  4: { tall: { name: 'waterTower', make: waterTower }, mid: { name: 'steamPipe', make: steamPipe }, low: { name: 'coalHeap', make: coalHeap } },
  5: { tall: { name: 'smokeStack', make: smokeStack }, mid: { name: 'slagHeap', make: slagHeap }, low: { name: 'girderStack', make: girderStack } },
  6: { tall: { name: 'pylon', make: pylon }, mid: { name: 'transformer', make: transformer }, low: { name: 'cableDrum', make: cableDrum } },
  7: { tall: { name: 'derrick', make: derrick }, mid: { name: 'storageTank', make: storageTank }, low: { name: 'barrelRack', make: barrelRack } },
  8: { tall: { name: 'dish', make: dish }, mid: { name: 'solarArray', make: solarArray }, low: { name: 'relayBox', make: relayBox } },
  9: { tall: { name: 'lightMast', make: lightMast }, mid: { name: 'leadWall', make: leadWall }, low: { name: 'hazardBarrels', make: hazardBarrels } },
  10: { tall: { name: 'holoPylon', make: holoPylon }, mid: { name: 'nanoSpire', make: nanoSpire }, low: { name: 'serverCrate', make: serverCrate } },
};

/** Footprint radius (m) of each role, for prop spacing. */
export const PROP_RADIUS: Record<PropRole, number> = { tall: 1.5, mid: 1.8, low: 1.3 };

/**
 * Sagging power lines between neighbouring era 6 pylons (placed with ry = 0, sorted along z): one merged geometry in
 * WORLD coordinates, or null when fewer than two pylons stand.
 */
export function strungWires(pylons: readonly { x: number; z: number }[]): THREE.BufferGeometry | null {
  if (pylons.length < 2) return null;
  const k = new Kit();
  const sorted = [...pylons].sort((a, b) => a.z - b.z);
  const SEG = 6;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const p = sorted[i]!;
    const q = sorted[i + 1]!;
    for (const [tx, ty, tz] of PYLON_TIPS) {
      let prev: [number, number, number] = [p.x + tx, ty - 0.4, p.z + tz];
      for (let s = 1; s <= SEG; s++) {
        const u = s / SEG;
        const cur: [number, number, number] = [p.x + tx + (q.x - p.x) * u, ty - 0.4 - 0.7 * 4 * u * (1 - u), p.z + tz + (q.z - p.z) * u];
        k.beam(prev, cur, 0.035, 0x23282c);
        prev = cur;
      }
    }
  }
  return k.geometry();
}

const cache = new Map<string, THREE.BufferGeometry>();

/** Shared merged geometry of era n's `role` prop (built once; never dispose). */
export function eraPropGeometry(n: number, role: PropRole): THREE.BufferGeometry {
  const key = `${n}:${role}`;
  let g = cache.get(key);
  if (!g) {
    const def = BUILDERS[n]?.[role];
    if (!def) throw new Error(`no frontier prop ${key}`);
    g = def.make();
    cache.set(key, g);
  }
  return g;
}

/** Name of era n's `role` prop ("timberCrane"). */
export function eraPropName(n: number, role: PropRole): string {
  return BUILDERS[n]![role].name;
}

export const frontierCatalog: Record<string, () => THREE.Object3D> = {};
for (const n of Object.keys(BUILDERS).map(Number)) {
  for (const role of PROP_ROLES) {
    frontierCatalog[`era${n}_${eraPropName(n, role)}`] = () => {
      const m = new THREE.Mesh(eraPropGeometry(n, role), vcMat());
      m.castShadow = true;
      m.receiveShadow = true;
      const g = new THREE.Group();
      g.add(m);
      return g;
    };
  }
}
