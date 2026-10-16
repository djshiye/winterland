/**
 * 0.9.5 era pals of eras 5, 6 and 7 (the `${key}Pal` player upgrade, docs/EXPANSION.md §D): the companion that
 * replaces the husky while the player is in that era's region. Each keeps the companion dog's contract
 * (assets/sled.ts DogModel), so entities/Dog.ts swaps the model without other changes:
 * - 5 Industrial: Draft Horse, a sturdy chestnut pony with a cream blaze, feathered hooves and a saddle blanket;
 * - 6 Electric Age: Lamp Cat, a round grey tabby with a little brass lamp on its collar that glows;
 * - 7 Oil Age: Snow Fox, a fluffy white fox with charcoal ear tips and a big plume of a tail.
 * All three are four-legged: one vertex-coloured body mesh (the level band and the bag baked in) + one InstancedMesh
 * for the four legs and the tail = 3 draw calls with the body's shadow, like the dog.
 */
import * as THREE from 'three';
import { Batch, vcMat } from '../render/batch';
import type { DogModel } from './sled';

export type Pal5to7Era = 5 | 6 | 7;

/** Display names (EXPANSION.md §D player column). */
export const ERA5_7_PAL_NAMES: Record<Pal5to7Era, string> = { 5: 'Draft Horse', 6: 'Lamp Cat', 7: 'Snow Fox' };

/** Band colour per pal level: level 1 era accent, then teal, gold, lavender (like the husky's scarf). */
const BAND: Record<Pal5to7Era, readonly number[]> = {
  5: [0xe08a2b, 0xe08a2b, 0x5fb3a8, 0xe8b341, 0xb9a6e0],
  6: [0xd97f38, 0xd97f38, 0x7ce8c8, 0xe8b341, 0xb9a6e0],
  7: [0xc44536, 0xc44536, 0x5fb3a8, 0xe8b341, 0xb9a6e0],
};
const bandOf = (era: Pal5to7Era, level: number): number => {
  const list = BAND[era];
  return list[Math.max(0, Math.min(list.length - 1, level))]!;
};

const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
const cyl = (r1: number, r2: number, h: number, seg = 10): THREE.BufferGeometry => new THREE.CylinderGeometry(r1, r2, h, seg);
const ball = (r: number): THREE.BufferGeometry => new THREE.SphereGeometry(r, 10, 8);
const cone = (r: number, h: number): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, 6);

interface BodyOpts {
  band: number;
  bag: boolean;
}

/** Per-pal shape: body builder, leg builder, hip spots (x, z, gait phase), hip height, tail anchor and scale. */
interface PalSpec {
  body: (o: BodyOpts) => THREE.BufferGeometry;
  leg: () => THREE.BufferGeometry;
  hips: readonly (readonly [number, number, number])[];
  hipY: number;
  tail: { y: number; z: number; scale: [number, number, number]; tilt: number };
  /** Stride speed factor (a horse plods, a cat pads quickly). */
  stride: number;
  /** How far the body drops when sitting. */
  sitDrop: number;
}

// ---------------------------------------------------------------------------
// 5 Draft Horse
// ---------------------------------------------------------------------------

const CHESTNUT = 0xa0623a;
const CHESTNUT_D = 0x7e4a2b;
const MANE = 0x4a2f22;
const BLAZE = 0xf1e6d2;
const HOOF = 0x3b3230;

function horseBody(o: BodyOpts): THREE.BufferGeometry {
  const b = new Batch();
  b.add(box(0.42, 0.38, 0.86), CHESTNUT, 0, 0.98, 0);
  b.add(ball(0.22), CHESTNUT, 0, 0.98, 0.36, { sx: 0.95, sy: 0.85 });
  b.add(ball(0.21), CHESTNUT, 0, 0.98, -0.36, { sx: 0.95, sy: 0.85 });
  // neck rising forward, head with a cream blaze, ears and a dark mane
  b.add(box(0.24, 0.42, 0.24), CHESTNUT, 0, 1.28, 0.44, { rx: 0.5 });
  b.add(box(0.24, 0.24, 0.42), CHESTNUT, 0, 1.48, 0.62);
  b.add(box(0.2, 0.18, 0.14), CHESTNUT_D, 0, 1.42, 0.84);
  b.add(box(0.08, 0.2, 0.02), BLAZE, 0, 1.5, 0.836);
  for (const s of [-1, 1]) {
    b.add(cone(0.04, 0.12), CHESTNUT_D, s * 0.08, 1.66, 0.56);
    b.add(box(0.03, 0.04, 0.02), 0x2b2522, s * 0.12, 1.53, 0.76);
  }
  b.add(box(0.06, 0.34, 0.4), MANE, 0, 1.42, 0.4, { rx: 0.5 });
  // saddle blanket in the level colour, with a cream fringe
  b.add(box(0.46, 0.06, 0.4), o.band, 0, 1.18, -0.02);
  for (const s of [-1, 1]) b.add(box(0.02, 0.2, 0.38), o.band, s * 0.23, 1.08, -0.02);
  for (const s of [-1, 1]) b.add(box(0.025, 0.03, 0.38), BLAZE, s * 0.235, 0.97, -0.02);
  if (o.bag) {
    // two steel-rivet saddlebags
    for (const s of [-1, 1]) {
      b.add(box(0.1, 0.2, 0.24), 0x6c7a83, s * 0.28, 1.0, -0.26);
      b.add(box(0.11, 0.04, 0.25), 0xd4a64a, s * 0.28, 1.07, -0.26);
    }
  }
  return b.geometry();
}

const HORSE_LEG = 0.8;
function horseLeg(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(box(0.14, HORSE_LEG * 0.6, 0.14), CHESTNUT, 0, -HORSE_LEG * 0.3, 0);
  b.add(box(0.11, HORSE_LEG * 0.3, 0.11), CHESTNUT_D, 0, -HORSE_LEG * 0.72, 0);
  // feathered fetlock + hoof
  b.add(cyl(0.09, 0.11, 0.1), BLAZE, 0, -HORSE_LEG + 0.12, 0);
  b.add(cyl(0.08, 0.09, 0.07), HOOF, 0, -HORSE_LEG + 0.035, 0);
  return b.geometry();
}

// ---------------------------------------------------------------------------
// 6 Lamp Cat
// ---------------------------------------------------------------------------

const TABBY = 0x9aa3ad;
const TABBY_D = 0x6f7882;
const TABBY_L = 0xe6e9ec;
const BRASS = 0xd4a64a;
const LAMP = 0xfff1c4;

function catBody(o: BodyOpts): THREE.BufferGeometry {
  const b = new Batch();
  b.add(ball(0.17), TABBY, 0, 0.3, -0.04, { sz: 1.45, sy: 0.9 });
  b.add(ball(0.13), TABBY_L, 0, 0.26, 0.06, { sz: 1.2, sy: 0.7 });
  for (let i = 0; i < 3; i++) b.add(box(0.3, 0.02, 0.04), TABBY_D, 0, 0.43, -0.14 + i * 0.1);
  // round head, cheeks, ears with pink insides, eyes
  b.add(ball(0.14), TABBY, 0, 0.46, 0.22);
  b.add(ball(0.07), TABBY_L, 0, 0.42, 0.32, { sx: 1.5, sy: 0.7 });
  for (const s of [-1, 1]) {
    b.add(cone(0.06, 0.1), TABBY, s * 0.08, 0.6, 0.2);
    b.add(cone(0.035, 0.06), 0xf2b8c0, s * 0.08, 0.6, 0.225);
    b.add(box(0.03, 0.04, 0.01), 0x2f3a33, s * 0.05, 0.48, 0.355);
  }
  b.add(box(0.03, 0.02, 0.02), 0xf2a0a8, 0, 0.44, 0.365);
  // collar in the level colour with the little brass lamp
  b.add(cyl(0.1, 0.1, 0.04, 12), o.band, 0, 0.38, 0.22, { rx: 0.4 });
  b.add(cyl(0.025, 0.03, 0.04), BRASS, 0, 0.33, 0.31);
  b.add(ball(0.035), LAMP, 0, 0.29, 0.31);
  if (o.bag) {
    // a tiny copper spool on each side
    for (const s of [-1, 1]) b.add(cyl(0.05, 0.05, 0.06, 10), 0xc9773a, s * 0.17, 0.32, -0.08, { rz: Math.PI / 2 });
  }
  return b.geometry();
}

const CAT_LEG = 0.22;
function catLeg(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(box(0.07, CAT_LEG * 0.85, 0.07), TABBY, 0, -CAT_LEG * 0.42, 0);
  b.add(ball(0.045), TABBY_L, 0, -CAT_LEG + 0.03, 0.01, { sy: 0.7 });
  return b.geometry();
}

// ---------------------------------------------------------------------------
// 7 Snow Fox
// ---------------------------------------------------------------------------

const FOX = 0xf4f1ea;
const FOX_SH = 0xd9dde4;
const FOX_TIP = 0x3a3b40;

function foxBody(o: BodyOpts): THREE.BufferGeometry {
  const b = new Batch();
  b.add(ball(0.18), FOX, 0, 0.4, -0.02, { sz: 1.6, sy: 0.85 });
  b.add(ball(0.14), FOX_SH, 0, 0.34, 0.08, { sz: 1.3, sy: 0.7 });
  // pointy head, snout and tall ears with charcoal tips
  b.add(ball(0.13), FOX, 0, 0.56, 0.3, { sz: 1.1 });
  b.add(cone(0.07, 0.18), FOX, 0, 0.53, 0.44, { rx: Math.PI / 2 });
  b.add(ball(0.025), FOX_TIP, 0, 0.53, 0.53);
  for (const s of [-1, 1]) {
    b.add(cone(0.06, 0.16), FOX, s * 0.07, 0.72, 0.26);
    b.add(cone(0.03, 0.06), FOX_TIP, s * 0.07, 0.79, 0.26);
    b.add(box(0.03, 0.035, 0.01), 0x2f3a33, s * 0.055, 0.59, 0.405);
  }
  // scarf in the level colour
  b.add(cyl(0.11, 0.12, 0.06, 12), o.band, 0, 0.47, 0.22, { rx: 0.35 });
  b.add(box(0.06, 0.14, 0.03), o.band, 0.06, 0.38, 0.3, { rz: 0.2 });
  if (o.bag) {
    // a pair of little fuel cans
    for (const s of [-1, 1]) b.add(box(0.07, 0.12, 0.1), 0xc44536, s * 0.17, 0.4, -0.1);
  }
  return b.geometry();
}

const FOX_LEG = 0.3;
function foxLeg(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(box(0.07, FOX_LEG * 0.7, 0.07), FOX, 0, -FOX_LEG * 0.35, 0);
  b.add(box(0.06, FOX_LEG * 0.3, 0.06), FOX_TIP, 0, -FOX_LEG * 0.85, 0);
  return b.geometry();
}

// ---------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------

const SPECS: Record<Pal5to7Era, PalSpec> = {
  5: {
    body: horseBody,
    leg: horseLeg,
    hips: [
      [0.14, 0.32, 0],
      [-0.14, 0.32, Math.PI],
      [0.14, -0.32, Math.PI],
      [-0.14, -0.32, 0],
    ],
    hipY: HORSE_LEG,
    tail: { y: 1.1, z: -0.46, scale: [1.3, 0.75, 1.1], tilt: 0.35 },
    stride: 0.8,
    sitDrop: 0.12,
  },
  6: {
    body: catBody,
    leg: catLeg,
    hips: [
      [0.08, 0.12, 0],
      [-0.08, 0.12, Math.PI],
      [0.08, -0.16, Math.PI],
      [-0.08, -0.16, 0],
    ],
    hipY: CAT_LEG,
    tail: { y: 0.36, z: -0.26, scale: [0.7, 1.6, 0.7], tilt: Math.PI * 0.8 },
    stride: 1.3,
    sitDrop: 0.08,
  },
  7: {
    body: foxBody,
    leg: foxLeg,
    hips: [
      [0.09, 0.16, 0],
      [-0.09, 0.16, Math.PI],
      [0.09, -0.2, Math.PI],
      [-0.09, -0.2, 0],
    ],
    hipY: FOX_LEG,
    tail: { y: 0.4, z: -0.3, scale: [2.6, 1.3, 2.6], tilt: Math.PI * 0.45 },
    stride: 1.1,
    sitDrop: 0.1,
  },
};

/** One era pal (5 Draft Horse, 6 Lamp Cat, 7 Snow Fox) with the companion dog's interface. */
export function createEra5to7Pal(era: Pal5to7Era): DogModel {
  const spec = SPECS[era];
  const root = new THREE.Group();
  root.name = `eraPal:${era}`;
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const opts: BodyOpts = { band: bandOf(era, 1), bag: false };
  const bodyMesh = new THREE.Mesh(spec.body(opts), vcMat());
  bodyMesh.name = 'palBody';
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyGroup.add(bodyMesh);
  const rebuild = (): void => {
    const old = bodyMesh.geometry;
    bodyMesh.geometry = spec.body(opts);
    old.dispose();
  };

  const legGeo = spec.leg();
  const parts = new THREE.InstancedMesh(legGeo, vcMat(), 5);
  parts.name = 'palParts';
  parts.castShadow = false;
  parts.receiveShadow = true;
  parts.frustumCulled = false;
  root.add(parts);

  const m = new THREE.Matrix4();
  const r = new THREE.Matrix4();
  const s = new THREE.Matrix4();
  const t2 = new THREE.Matrix4();
  let phase = 0;
  let lastT = Number.NaN;
  let gaitW = 0;

  const model: DogModel = {
    root,
    sit: 0,
    tailYaw: 0,
    animate(t, speed) {
      const dt = Number.isNaN(lastT) ? 0 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      const sit = Math.max(0, Math.min(1, model.sit));
      gaitW += (Math.min(1, speed / 1.2) * (1 - sit) - gaitW) * Math.min(1, dt * 12);
      phase += dt * Math.PI * 2 * (1.4 + speed * 0.4) * spec.stride * (speed > 0.3 ? 1 : 0.3);
      const bob = 0.03 * Math.abs(Math.sin(phase * 2)) * gaitW;
      bodyGroup.position.y = bob - spec.sitDrop * sit;
      bodyGroup.rotation.x = -0.3 * sit;
      for (let i = 0; i < 4; i++) {
        const [hx, hz, ph] = spec.hips[i]!;
        const rear = hz < 0;
        let ang = 0.6 * Math.sin(phase + ph) * gaitW;
        let sy = 1;
        if (rear && sit > 0) {
          ang = ang * (1 - sit) - 1.1 * sit;
          sy = 1 - 0.4 * sit;
        }
        m.makeTranslation(hx, spec.hipY + (rear ? Math.min(0, bodyGroup.position.y) : 0), hz).multiply(r.makeRotationX(ang)).multiply(s.makeScale(1, sy, 1));
        parts.setMatrixAt(i, m);
      }
      // tail: the leg instance swung up and back, scaled into a tail, wagging with tailYaw
      const tl = spec.tail;
      m.makeTranslation(0, tl.y + bodyGroup.position.y, tl.z)
        .multiply(r.makeRotationY(model.tailYaw))
        .multiply(s.makeRotationX(tl.tilt + 0.1 * Math.sin(t * 2.2)))
        .multiply(t2.makeScale(...tl.scale));
      parts.setMatrixAt(4, m);
      parts.instanceMatrix.needsUpdate = true;
    },
    setBag(on) {
      if (on === opts.bag) return;
      opts.bag = on;
      rebuild();
    },
    setLevel(level) {
      const band = bandOf(era, level);
      if (band === opts.band) return;
      opts.band = band;
      rebuild();
    },
    dispose() {
      bodyMesh.geometry.dispose();
      legGeo.dispose();
      parts.dispose();
    },
  };
  model.animate(0, 0);
  return model;
}

/** Gallery (--query gallery=eraPals5to7): one entry per pal. */
export const eraPal5to7Catalog: Record<string, () => THREE.Object3D> = {
  draftHorse: () => createEra5to7Pal(5).root,
  lampCat: () => createEra5to7Pal(6).root,
  snowFox: () => createEra5to7Pal(7).root,
};
