/**
 * 0.9.5 era pals of eras 8, 9 and 10 (the `${key}Pal` player upgrade, docs/EXPANSION.md §D): the companion that
 * replaces the husky while the player is in that era's region. Each one keeps the companion dog's contract
 * (assets/sled.ts DogModel), so entities/Dog.ts can swap the model without other changes:
 * - 8 Computer Age: Rover Bot, a beige six-wheeled rover with a teal screen face and a little dish;
 * - 9 Nuclear Power: Rad Drone, a cream ceramic quad-rotor that hovers at knee height and lands to "sit";
 * - 10 AI Era: Robo Pup, a warm cream robot dog with a slate visor and gold paws.
 * Cozy high-tech (docs/art/guide.md): warm creams and soft glows, nothing neon. Three draw calls each, like the dog:
 * the body (one vertex-coloured mesh, the bag and the level band baked in), one instanced moving part (wheels, rotors
 * or legs + tail) and nothing else that casts a shadow.
 */
import * as THREE from 'three';
import { Batch, vcMat } from '../render/batch';
import type { DogModel } from './sled';

export type PalEra = 8 | 9 | 10;

/** Display names (EXPANSION.md §D player column). */
export const ERA_PAL_NAMES: Record<PalEra, string> = { 8: 'Rover Bot', 9: 'Rad Drone', 10: 'Robo Pup' };

/** Band colour per pal level, like the husky's scarf: level 1 era accent, then teal, gold, lavender. */
const BAND: Record<PalEra, readonly number[]> = {
  8: [0x45858c, 0x45858c, 0x66e0a3, 0xe8b341, 0xb9a6e0],
  9: [0x4ea885, 0x4ea885, 0x70f5d9, 0xe8b341, 0xb9a6e0],
  10: [0xe8a848, 0xe8a848, 0x70c6e8, 0xffe082, 0xb9a6e0],
};
const bandOf = (era: PalEra, level: number): number => {
  const list = BAND[era];
  return list[Math.max(0, Math.min(list.length - 1, level))]!;
};

const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
const cyl = (r1: number, r2: number, h: number, seg = 12): THREE.BufferGeometry => new THREE.CylinderGeometry(r1, r2, h, seg);
const ball = (r: number): THREE.BufferGeometry => new THREE.SphereGeometry(r, 10, 8);

interface BodyOpts {
  band: number;
  bag: boolean;
}

// ---------------------------------------------------------------------------
// bodies (local +Z = forward, feet on y = 0)
// ---------------------------------------------------------------------------

const CREAM = 0xe6dec8;
const CREAM_L = 0xf5f0e6;
const SLATE = 0x526475;
const PEWTER = 0x7c858e;
const GLOW_MINT = 0xbff0e2;
const GOLD = 0xe8b341;

function roverBody(o: BodyOpts): THREE.BufferGeometry {
  const b = new Batch();
  b.add(box(0.62, 0.26, 0.78), CREAM, 0, 0.36, 0);
  b.add(box(0.66, 0.06, 0.82), PEWTER, 0, 0.24, 0);
  // screen face with two happy eyes
  b.add(box(0.44, 0.18, 0.02), 0x2b3b39, 0, 0.4, 0.4);
  b.add(box(0.08, 0.05, 0.01), GLOW_MINT, -0.1, 0.42, 0.415);
  b.add(box(0.08, 0.05, 0.01), GLOW_MINT, 0.1, 0.42, 0.415);
  // level band round the deck
  b.add(box(0.64, 0.04, 0.8), o.band, 0, 0.5, 0);
  // mast + dish
  b.add(cyl(0.025, 0.025, 0.28), PEWTER, 0.16, 0.64, -0.22);
  b.add(cyl(0.14, 0.04, 0.06), CREAM_L, 0.16, 0.8, -0.22, { rx: -0.6 });
  b.add(ball(0.025), GOLD, 0.16, 0.83, -0.19);
  if (o.bag) {
    // a smart-cart tray with two tiny chips on the back deck
    b.add(box(0.36, 0.08, 0.26), 0x45858c, -0.08, 0.56, -0.2);
    b.add(box(0.12, 0.03, 0.12), 0x2f6f4e, -0.15, 0.61, -0.2);
    b.add(box(0.12, 0.03, 0.12), 0x2f6f4e, 0, 0.61, -0.2);
  }
  return b.geometry();
}

function droneBody(o: BodyOpts): THREE.BufferGeometry {
  const b = new Batch();
  b.add(ball(0.24), CREAM_L, 0, 0, 0, { sy: 0.7 });
  b.add(cyl(0.245, 0.245, 0.06, 16), o.band, 0, 0, 0);
  b.add(box(0.2, 0.08, 0.04), 0x3d5259, 0, 0.03, 0.22);
  b.add(box(0.05, 0.04, 0.01), 0x70f5d9, -0.05, 0.035, 0.243);
  b.add(box(0.05, 0.04, 0.01), 0x70f5d9, 0.05, 0.035, 0.243);
  // four arms out to the rotor hubs
  for (const [x, z] of HUBS) {
    b.add(box(0.05, 0.04, Math.hypot(x, z)), PEWTER, x / 2, 0.02, z / 2, { ry: Math.atan2(x, z) });
    b.add(cyl(0.05, 0.05, 0.06, 10), 0x3d5259, x, 0.04, z);
  }
  // little landing skids
  b.add(box(0.04, 0.12, 0.04), PEWTER, -0.14, -0.2, 0);
  b.add(box(0.04, 0.12, 0.04), PEWTER, 0.14, -0.2, 0);
  b.add(box(0.06, 0.03, 0.36), PEWTER, -0.14, -0.27, 0);
  b.add(box(0.06, 0.03, 0.36), PEWTER, 0.14, -0.27, 0);
  if (o.bag) {
    // a lead tote slung underneath with a honey hazard stripe
    b.add(box(0.2, 0.14, 0.16), 0x5a6470, 0, -0.2, 0);
    b.add(box(0.21, 0.03, 0.17), 0xe0a83a, 0, -0.17, 0);
  }
  return b.geometry();
}
const HUBS: readonly (readonly [number, number])[] = [
  [0.32, 0.32],
  [-0.32, 0.32],
  [0.32, -0.32],
  [-0.32, -0.32],
];
/** Height the drone hovers at (its body centre), and where it rests when it "sits". */
const HOVER_Y = 0.85;
const LANDED_Y = 0.3;

function pupBody(o: BodyOpts): THREE.BufferGeometry {
  const b = new Batch();
  b.add(box(0.36, 0.28, 0.66), CREAM_L, 0, 0.62, 0);
  b.add(box(0.38, 0.06, 0.5), SLATE, 0, 0.78, -0.02);
  // head with a slate visor and sun-gold eyes, ears like little fins
  b.add(box(0.32, 0.26, 0.3), CREAM_L, 0, 0.86, 0.38);
  b.add(box(0.26, 0.1, 0.02), SLATE, 0, 0.88, 0.535);
  b.add(box(0.06, 0.04, 0.01), 0xffe082, -0.06, 0.885, 0.548);
  b.add(box(0.06, 0.04, 0.01), 0xffe082, 0.06, 0.885, 0.548);
  b.add(box(0.12, 0.1, 0.14), CREAM, 0, 0.78, 0.55);
  b.add(box(0.05, 0.14, 0.1), SLATE, -0.14, 1.04, 0.34, { rz: 0.25 });
  b.add(box(0.05, 0.14, 0.1), SLATE, 0.14, 1.04, 0.34, { rz: -0.25 });
  // collar band
  b.add(box(0.34, 0.06, 0.06), o.band, 0, 0.74, 0.24);
  b.add(ball(0.035), GOLD, 0, 0.7, 0.28);
  if (o.bag) {
    // saddle panniers with a glowing cell each
    for (const s of [-1, 1]) {
      b.add(box(0.08, 0.16, 0.24), SLATE, s * 0.22, 0.62, -0.08);
      b.add(box(0.02, 0.06, 0.06), 0x70f5d9, s * 0.265, 0.64, -0.08);
    }
  }
  return b.geometry();
}

// ---------------------------------------------------------------------------
// moving parts
// ---------------------------------------------------------------------------

const WHEELS: readonly (readonly [number, number])[] = [
  [0.36, 0.28],
  [-0.36, 0.28],
  [0.36, 0],
  [-0.36, 0],
  [0.36, -0.28],
  [-0.36, -0.28],
];
const WHEEL_R = 0.13;

function wheelGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(cyl(WHEEL_R, WHEEL_R, 0.08, 12), 0x3b3a3e, 0, 0, 0, { rz: Math.PI / 2 });
  b.add(cyl(0.06, 0.06, 0.09, 8), GOLD, 0, 0, 0, { rz: Math.PI / 2 });
  // a cream spoke so the spin reads
  b.add(box(0.1, 0.2, 0.03), CREAM, 0, 0, 0);
  return b.geometry();
}

function rotorGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(box(0.36, 0.012, 0.05), 0xd8cfbd, 0, 0, 0);
  b.add(cyl(0.03, 0.03, 0.03, 8), GOLD, 0, 0, 0);
  return b.geometry();
}

/** A leg from the hip (y = 0) down to the paw (y = -LEG); the tail reuses it scaled. */
const LEG = 0.48;
function legGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(box(0.1, LEG * 0.55, 0.1), CREAM, 0, -LEG * 0.275, 0);
  b.add(ball(0.055), PEWTER, 0, -LEG * 0.55, 0);
  b.add(box(0.08, LEG * 0.4, 0.08), SLATE, 0, -LEG * 0.75, 0);
  b.add(box(0.12, 0.06, 0.15), GOLD, 0, -LEG + 0.03, 0.02);
  return b.geometry();
}
const PUP_HIPS = [
  [0.13, 0.22, 0],
  [-0.13, 0.22, Math.PI],
  [0.13, -0.22, Math.PI],
  [-0.13, -0.22, 0],
] as const;
const PUP_HIP_Y = LEG;

// ---------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------

const BODIES: Record<PalEra, (o: BodyOpts) => THREE.BufferGeometry> = { 8: roverBody, 9: droneBody, 10: pupBody };

/** One era pal (8 Rover Bot, 9 Rad Drone, 10 Robo Pup) with the companion dog's interface. */
export function createEraPal(era: PalEra): DogModel {
  const root = new THREE.Group();
  root.name = `eraPal:${era}`;
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const opts: BodyOpts = { band: bandOf(era, 1), bag: false };
  const bodyMesh = new THREE.Mesh(BODIES[era](opts), vcMat());
  bodyMesh.name = 'palBody';
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyGroup.add(bodyMesh);
  const rebuild = (): void => {
    const old = bodyMesh.geometry;
    bodyMesh.geometry = BODIES[era](opts);
    old.dispose();
  };

  const partGeo = era === 8 ? wheelGeometry() : era === 9 ? rotorGeometry() : legGeometry();
  const partCount = era === 8 ? WHEELS.length : era === 9 ? HUBS.length : 5;
  const parts = new THREE.InstancedMesh(partGeo, vcMat(), partCount);
  parts.name = 'palParts';
  parts.castShadow = false; // the body's shadow is enough (3 draw calls, like the dog)
  parts.receiveShadow = true;
  parts.frustumCulled = false;
  // rotors live in the drone's body frame; wheels and legs in the root frame (they stay on the ground)
  (era === 9 ? bodyGroup : root).add(parts);

  const m = new THREE.Matrix4();
  const r = new THREE.Matrix4();
  const s = new THREE.Matrix4();
  let phase = 0;
  let spin = 0;
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
      if (era === 8) {
        // wheels roll with the ground speed; the body settles on its suspension to "sit" and wiggles to "wag"
        spin += (dt * speed) / WHEEL_R;
        bodyGroup.position.y = -0.06 * sit + 0.008 * Math.sin(t * 9) * gaitW;
        bodyGroup.rotation.z = model.tailYaw * 0.15;
        for (let i = 0; i < WHEELS.length; i++) {
          const [x, z] = WHEELS[i]!;
          m.makeTranslation(x, WHEEL_R, z).multiply(r.makeRotationX(spin));
          parts.setMatrixAt(i, m);
        }
      } else if (era === 9) {
        // hover with a slow breath, lean into the flight, land to sit; rotors idle slower when landed
        const y = HOVER_Y + (LANDED_Y - HOVER_Y) * sit + 0.05 * Math.sin(t * 2.4) * (1 - sit);
        bodyGroup.position.y = y;
        bodyGroup.rotation.x = 0.18 * gaitW;
        bodyGroup.rotation.z = model.tailYaw * 0.2;
        spin += dt * (sit > 0.9 ? 4 : 30);
        for (let i = 0; i < HUBS.length; i++) {
          const [x, z] = HUBS[i]!;
          m.makeTranslation(x, 0.09, z).multiply(r.makeRotationY(spin * (i % 2 === 0 ? 1 : -1)));
          parts.setMatrixAt(i, m);
        }
      } else {
        // trot like the husky: alternate legs, body bob; rear legs fold to sit; tail = the 5th instance
        phase += dt * Math.PI * 2 * (1.5 + speed * 0.42) * (speed > 0.3 ? 1 : 0.3);
        const bob = 0.035 * Math.abs(Math.sin(phase * 2)) * gaitW;
        bodyGroup.position.y = bob - 0.18 * sit;
        bodyGroup.rotation.x = -0.35 * sit;
        for (let i = 0; i < 4; i++) {
          const [hx, hz, ph] = PUP_HIPS[i]!;
          const rear = hz < 0;
          let ang = 0.7 * Math.sin(phase + ph) * gaitW;
          let sy = 1;
          if (rear && sit > 0) {
            ang = ang * (1 - sit) - 1.1 * sit;
            sy = 1 - 0.4 * sit;
          }
          m.makeTranslation(hx, PUP_HIP_Y + (rear ? Math.min(0, bodyGroup.position.y) : 0), hz).multiply(r.makeRotationX(ang)).multiply(s.makeScale(1, sy, 1));
          parts.setMatrixAt(i, m);
        }
        // tail: a short stub leg pointing up and back, wagging with tailYaw
        m.makeTranslation(0, 0.7 + bodyGroup.position.y, -0.33)
          .multiply(r.makeRotationY(model.tailYaw))
          .multiply(s.makeRotationX(Math.PI * 0.75))
          .multiply(new THREE.Matrix4().makeScale(0.6, 0.45, 0.6));
        parts.setMatrixAt(4, m);
      }
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
      partGeo.dispose();
      parts.dispose();
    },
  };
  model.animate(0, 0);
  return model;
}

/** Gallery (--query gallery=eraPals4): one entry per pal. */
export const eraPal4Catalog: Record<string, () => THREE.Object3D> = {
  roverBot: () => createEraPal(8).root,
  radDrone: () => createEraPal(9).root,
  roboPup: () => createEraPal(10).root,
};
