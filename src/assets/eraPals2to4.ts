/**
 * 0.9.5 era pals of eras 2, 3 and 4 (the `${key}Pal` player upgrade, docs/EXPANSION.md §D): the companion that
 * replaces the husky while the player is in that era's region. Each keeps the companion dog's contract
 * (assets/sled.ts DogModel), so entities/Dog.ts swaps the model without other changes:
 * - 2 Frontier: Pack Mule, a soft grey-brown mule with a pale muzzle, long ears and a blanket in the level colour;
 *   its bag is a pair of wicker panniers with stone blocks;
 * - 3 Iron Age: Pit Pony, a small shaggy dark-bay pony with a forelock over its eyes and a warm miner's lamp on its
 *   bridle; its bag is two little ore sacks;
 * - 4 Steam Age: Brass Terrier, a riveted clockwork terrier with a wind-up key on its back and a glowing boiler
 *   window on its chest; its bag is a tiny coal scuttle.
 * All three are four-legged: one vertex-coloured body mesh (the level band and the bag baked in) + one InstancedMesh
 * for the four legs and the tail = 3 draw calls with the body's shadow, like the dog. Same rig as eraPals5to7.ts.
 */
import * as THREE from 'three';
import { Batch, vcMat } from '../render/batch';
import type { DogModel } from './sled';

export type Pal2to4Era = 2 | 3 | 4;

/** Display names (EXPANSION.md §D player column; eras/template.ts ERA_CONTENT[n].player.pal). */
export const ERA2_4_PAL_NAMES: Record<Pal2to4Era, string> = { 2: 'Pack Mule', 3: 'Pit Pony', 4: 'Brass Terrier' };

/** Band colour per pal level: level 1 era accent, then teal, gold, lavender (like the husky's scarf). */
const BAND: Record<Pal2to4Era, readonly number[]> = {
  2: [0xb85239, 0xb85239, 0x5fb3a8, 0xe8b341, 0xb9a6e0],
  3: [0xff9233, 0xff9233, 0x5fb3a8, 0xe8b341, 0xb9a6e0],
  4: [0xd49a35, 0xd49a35, 0x5fb3a8, 0xe8b341, 0xb9a6e0],
};
const bandOf = (era: Pal2to4Era, level: number): number => {
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
  /** Stride speed factor (a mule plods, a terrier trots quickly). */
  stride: number;
  /** How far the body drops when sitting. */
  sitDrop: number;
  /** Root scale, so every pal stands about as tall as the husky (≈ 1.1 m to the ear tips). */
  scale: number;
}

const EYE = 0x2b2522;

// ---------------------------------------------------------------------------
// 2 Pack Mule
// ---------------------------------------------------------------------------

const MULE = 0x8e8075;
const MULE_D = 0x6e6259;
const MUZZLE = 0xe6ddd0;
const WICKER = 0xc49a5e;
const STONE = 0xa7a39b;

function muleBody(o: BodyOpts): THREE.BufferGeometry {
  const b = new Batch();
  b.add(box(0.36, 0.32, 0.7), MULE, 0, 0.8, 0);
  b.add(ball(0.19), MULE, 0, 0.8, 0.28, { sx: 0.95, sy: 0.85 });
  b.add(ball(0.18), MULE, 0, 0.8, -0.28, { sx: 0.95, sy: 0.85 });
  b.add(box(0.3, 0.06, 0.6), MUZZLE, 0, 0.65, 0);
  // neck forward, big gentle head with a pale muzzle, very long ears, a short upright mane
  b.add(box(0.2, 0.34, 0.2), MULE, 0, 1.04, 0.36, { rx: 0.55 });
  b.add(box(0.2, 0.2, 0.36), MULE, 0, 1.2, 0.52);
  b.add(box(0.18, 0.16, 0.12), MUZZLE, 0, 1.15, 0.7);
  for (const s of [-1, 1]) {
    b.add(box(0.06, 0.26, 0.04), MULE_D, s * 0.08, 1.42, 0.44, { rz: s * 0.25, rx: -0.2 });
    b.add(box(0.03, 0.16, 0.02), MUZZLE, s * 0.08, 1.41, 0.465, { rz: s * 0.25, rx: -0.2 });
    b.add(box(0.03, 0.035, 0.02), EYE, s * 0.1, 1.25, 0.62);
  }
  b.add(box(0.05, 0.12, 0.34), MULE_D, 0, 1.18, 0.34, { rx: 0.55 });
  // blanket in the level colour with a cream edge
  b.add(box(0.4, 0.05, 0.36), o.band, 0, 0.98, -0.02);
  for (const s of [-1, 1]) {
    b.add(box(0.02, 0.18, 0.34), o.band, s * 0.2, 0.88, -0.02);
    b.add(box(0.025, 0.03, 0.34), MUZZLE, s * 0.205, 0.79, -0.02);
  }
  if (o.bag) {
    // wicker panniers with stone blocks peeking out
    for (const s of [-1, 1]) {
      b.add(box(0.14, 0.22, 0.26), WICKER, s * 0.27, 0.86, -0.04);
      b.add(box(0.15, 0.03, 0.27), 0x8a6a3e, s * 0.27, 0.97, -0.04);
      b.add(box(0.1, 0.07, 0.1), STONE, s * 0.27, 1.0, -0.08);
      b.add(box(0.08, 0.06, 0.08), 0xc4c0b8, s * 0.27, 1.0, 0.04);
    }
  }
  return b.geometry();
}

const MULE_LEG = 0.64;
function muleLeg(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(box(0.11, MULE_LEG * 0.62, 0.11), MULE, 0, -MULE_LEG * 0.31, 0);
  b.add(box(0.09, MULE_LEG * 0.3, 0.09), MULE_D, 0, -MULE_LEG * 0.74, 0);
  b.add(cyl(0.06, 0.07, 0.06), 0x3b3230, 0, -MULE_LEG + 0.03, 0);
  return b.geometry();
}

// ---------------------------------------------------------------------------
// 3 Pit Pony
// ---------------------------------------------------------------------------

const BAY = 0x5c3b2a;
const BAY_D = 0x3e2a20;
const SHAG = 0x2e2420;
const LAMP_BRASS = 0xc9952e;
const LAMP_GLOW = 0xffd27a;
const SACK = 0xb4986a;

function ponyBody(o: BodyOpts): THREE.BufferGeometry {
  const b = new Batch();
  b.add(box(0.32, 0.3, 0.56), BAY, 0, 0.6, 0);
  b.add(ball(0.17), BAY, 0, 0.6, 0.22, { sx: 0.95, sy: 0.9 });
  b.add(ball(0.17), BAY, 0, 0.6, -0.22, { sx: 0.95, sy: 0.9 });
  // stocky neck, small head, shaggy forelock over the eyes and a thick mane
  b.add(box(0.2, 0.28, 0.2), BAY, 0, 0.82, 0.3, { rx: 0.45 });
  b.add(box(0.19, 0.18, 0.28), BAY, 0, 0.96, 0.44);
  b.add(box(0.16, 0.13, 0.1), BAY_D, 0, 0.92, 0.58);
  b.add(box(0.15, 0.06, 0.08), SHAG, 0, 1.03, 0.52, { rx: 0.4 });
  for (const s of [-1, 1]) {
    b.add(cone(0.035, 0.09), BAY_D, s * 0.07, 1.1, 0.4);
    b.add(box(0.03, 0.03, 0.02), EYE, s * 0.09, 0.99, 0.55);
  }
  b.add(box(0.07, 0.24, 0.32), SHAG, 0, 0.92, 0.28, { rx: 0.45 });
  // bridle in the level colour with a little miner's lamp on the brow band
  b.add(box(0.2, 0.03, 0.03), o.band, 0, 0.97, 0.59);
  for (const s of [-1, 1]) b.add(box(0.02, 0.12, 0.03), o.band, s * 0.1, 0.94, 0.5);
  b.add(cyl(0.035, 0.04, 0.06), LAMP_BRASS, 0, 1.05, 0.56);
  b.add(ball(0.03), LAMP_GLOW, 0, 1.05, 0.6);
  // collar pad
  b.add(cyl(0.13, 0.14, 0.05, 12), o.band, 0, 0.76, 0.26, { rx: 0.5 });
  if (o.bag) {
    // two tied ore sacks over the back
    for (const s of [-1, 1]) {
      b.add(ball(0.09), SACK, s * 0.2, 0.66, -0.06, { sy: 1.3 });
      b.add(box(0.05, 0.03, 0.05), 0x7a5a3a, s * 0.2, 0.78, -0.06);
      b.add(ball(0.03), 0xb0704e, s * 0.2, 0.8, -0.06);
    }
  }
  return b.geometry();
}

const PONY_LEG = 0.46;
function ponyLeg(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(box(0.1, PONY_LEG * 0.62, 0.1), BAY, 0, -PONY_LEG * 0.31, 0);
  b.add(box(0.08, PONY_LEG * 0.24, 0.08), BAY_D, 0, -PONY_LEG * 0.72, 0);
  // shaggy feathered fetlock + hoof
  b.add(cyl(0.07, 0.09, 0.09), SHAG, 0, -PONY_LEG + 0.1, 0);
  b.add(cyl(0.06, 0.07, 0.05), 0x2b2522, 0, -PONY_LEG + 0.025, 0);
  return b.geometry();
}

// ---------------------------------------------------------------------------
// 4 Brass Terrier
// ---------------------------------------------------------------------------

const BRASS = 0xd4a64a;
const BRASS_D = 0xa67c2e;
const IRON = 0x383d40;
const RIVET = 0xf0d48a;
const FIRE = 0xffbe55;

function terrierBody(o: BodyOpts): THREE.BufferGeometry {
  const b = new Batch();
  // barrel boiler body with iron bands and rivets
  b.add(cyl(0.13, 0.13, 0.42, 12), BRASS, 0, 0.32, -0.02, { rx: Math.PI / 2 });
  for (const z of [-0.16, 0.12]) b.add(cyl(0.135, 0.135, 0.035, 12), IRON, 0, 0.32, z, { rx: Math.PI / 2 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add(ball(0.014), RIVET, Math.cos(a) * 0.14, 0.32 + Math.sin(a) * 0.14, -0.02);
  }
  // glowing firebox window on the chest
  b.add(cyl(0.08, 0.08, 0.02, 10), IRON, 0, 0.3, 0.2, { rx: Math.PI / 2 });
  b.add(cyl(0.055, 0.055, 0.025, 10), FIRE, 0, 0.3, 0.205, { rx: Math.PI / 2 });
  // square terrier head, bristly brass beard, folded ears, bright button eyes
  b.add(box(0.18, 0.16, 0.2), BRASS, 0, 0.5, 0.2);
  b.add(box(0.12, 0.1, 0.1), BRASS_D, 0, 0.46, 0.33);
  b.add(box(0.13, 0.06, 0.06), RIVET, 0, 0.41, 0.34);
  b.add(ball(0.025), IRON, 0, 0.49, 0.385);
  for (const s of [-1, 1]) {
    b.add(box(0.06, 0.03, 0.08), BRASS_D, s * 0.08, 0.6, 0.16, { rz: s * 0.5 });
    b.add(ball(0.022), 0xfff2c0, s * 0.05, 0.53, 0.3);
  }
  // collar in the level colour, little chimney and the wind-up key on its back
  b.add(cyl(0.1, 0.1, 0.04, 12), o.band, 0, 0.44, 0.13, { rx: 0.5 });
  b.add(cyl(0.025, 0.03, 0.1), IRON, 0, 0.48, 0.0);
  b.add(cyl(0.035, 0.035, 0.02), BRASS_D, 0, 0.53, 0.0);
  b.add(cyl(0.015, 0.015, 0.08), BRASS_D, 0, 0.48, -0.12);
  b.add(box(0.16, 0.06, 0.02), BRASS, 0, 0.54, -0.12);
  if (o.bag) {
    // a tiny coal scuttle on each side
    for (const s of [-1, 1]) {
      b.add(box(0.07, 0.08, 0.12), IRON, s * 0.16, 0.3, -0.06);
      b.add(box(0.05, 0.03, 0.1), 0x2c2b2e, s * 0.16, 0.355, -0.06);
    }
  }
  return b.geometry();
}

const TERRIER_LEG = 0.2;
function terrierLeg(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(cyl(0.035, 0.035, TERRIER_LEG * 0.8, 8), BRASS_D, 0, -TERRIER_LEG * 0.4, 0);
  b.add(ball(0.03), IRON, 0, -TERRIER_LEG * 0.45, 0);
  b.add(box(0.07, 0.04, 0.09), IRON, 0, -TERRIER_LEG + 0.02, 0.01);
  return b.geometry();
}

// ---------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------

const SPECS: Record<Pal2to4Era, PalSpec> = {
  2: {
    body: muleBody,
    leg: muleLeg,
    hips: [
      [0.12, 0.26, 0],
      [-0.12, 0.26, Math.PI],
      [0.12, -0.26, Math.PI],
      [-0.12, -0.26, 0],
    ],
    hipY: MULE_LEG,
    tail: { y: 0.88, z: -0.36, scale: [0.6, 0.6, 0.6], tilt: 0.3 },
    stride: 0.85,
    sitDrop: 0.1,
    scale: 0.82,
  },
  3: {
    body: ponyBody,
    leg: ponyLeg,
    hips: [
      [0.1, 0.2, 0],
      [-0.1, 0.2, Math.PI],
      [0.1, -0.2, Math.PI],
      [-0.1, -0.2, 0],
    ],
    hipY: PONY_LEG,
    tail: { y: 0.66, z: -0.3, scale: [1.2, 0.8, 1.2], tilt: 0.35 },
    stride: 1.0,
    sitDrop: 0.08,
    scale: 1,
  },
  4: {
    body: terrierBody,
    leg: terrierLeg,
    hips: [
      [0.08, 0.12, 0],
      [-0.08, 0.12, Math.PI],
      [0.08, -0.15, Math.PI],
      [-0.08, -0.15, 0],
    ],
    hipY: TERRIER_LEG,
    tail: { y: 0.4, z: -0.24, scale: [0.6, 0.9, 0.6], tilt: Math.PI * 0.75 },
    stride: 1.3,
    sitDrop: 0.06,
    scale: 1.15,
  },
};

/** One era pal (2 Pack Mule, 3 Pit Pony, 4 Brass Terrier) with the companion dog's interface. */
export function createEra2to4Pal(era: Pal2to4Era): DogModel {
  const spec = SPECS[era];
  const root = new THREE.Group();
  root.name = `eraPal:${era}`;
  root.scale.setScalar(spec.scale);
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
      const bob = 0.025 * Math.abs(Math.sin(phase * 2)) * gaitW;
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

/** Gallery (--query gallery=eraPals2to4): one entry per pal. */
export const eraPal2to4Catalog: Record<string, () => THREE.Object3D> = {
  packMule: () => createEra2to4Pal(2).root,
  pitPony: () => createEra2to4Pal(3).root,
  brassTerrier: () => createEra2to4Pal(4).root,
};
