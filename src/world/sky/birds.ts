/**
 * [0.9.8 — sky] Little flocks of bullfinches crossing the sky by day (brief 16, ambient life).
 *
 * Every half minute or so (by day, when it is not snowing hard) a loose flock of 4-7 round plum-and-rose birds flies
 * across the view a few metres up, in the bounding flight of real finches: a burst of wing beats, then wings folded
 * and a gentle dip. Their shadows sweep over the snow on Medium and High. Code-built, three instanced meshes (body, left
 * wing, right wing), so a whole flock costs three draw calls (+3 in the shadow pass) and none while the sky is empty.
 * Comfort: no birds on Minimal effects; with Reduce motion they fly slower and flap less.
 */
import * as THREE from 'three';
import { Batch, vcMat } from '../../render/batch';
import { geo } from '../../render/materials';
import { GOLD, SKY, SNOW } from '../../render/palette';
import type { Rng } from '../env/common';

const MAX = 8;
/** Flight speed (m/s), height band (m). */
const SPEED = 4.2;
const Y0 = 4.5;
const Y1 = 6.5;
/** Model scale (the parts below are drawn at 1). */
const SIZE = 1.5;
/** Birds leave once this far from the camera target (m). */
const AWAY = 34;

function bodyGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(geo.sphere(1, 12, 8), SKY.birdBack, 0, 0, 0, { sx: 0.11, sy: 0.1, sz: 0.15 });
  b.add(geo.sphere(1, 12, 8), SKY.birdBreast, 0, -0.025, 0.035, { sx: 0.1, sy: 0.08, sz: 0.11 });
  b.add(geo.sphere(1, 10, 8), SKY.birdWing, 0, 0.045, 0.12, { sx: 0.075, sy: 0.07, sz: 0.075 });
  b.add(geo.cone(0.025, 0.05, 6), GOLD, 0, 0.04, 0.2, { rx: Math.PI / 2 });
  b.add(geo.box(0.07, 0.02, 0.12), SKY.birdWing, 0, 0.01, -0.17, { rx: -0.2 });
  b.add(geo.box(0.06, 0.03, 0.04), SNOW, 0, 0.02, -0.11); // the white rump
  return b.geometry().scale(SIZE, SIZE, SIZE);
}

function wingGeometry(side: 1 | -1): THREE.BufferGeometry {
  const b = new Batch();
  b.add(geo.box(0.2, 0.018, 0.11), SKY.birdBack, side * 0.1, 0, 0);
  b.add(geo.box(0.04, 0.02, 0.1), SNOW, side * 0.17, 0.008, 0); // the white wing bar
  b.add(geo.box(0.1, 0.016, 0.085), SKY.birdWing, side * 0.24, 0, -0.01);
  return b.geometry().scale(SIZE, SIZE, SIZE);
}

interface Bird {
  x: number;
  y: number;
  z: number;
  /** Offset from the flock leader (m). */
  ox: number;
  oz: number;
  phase: number;
}

export interface Birds {
  readonly group: THREE.Group;
  update(dt: number, center: THREE.Vector3, allowed: boolean, speed: number): void;
}

export function buildBirds(rng: Rng): Birds {
  const group = new THREE.Group();
  group.name = 'birds';
  const body = new THREE.InstancedMesh(bodyGeometry(), vcMat(), MAX);
  const left = new THREE.InstancedMesh(wingGeometry(-1), vcMat(), MAX);
  const right = new THREE.InstancedMesh(wingGeometry(1), vcMat(), MAX);
  for (const m of [body, left, right]) {
    m.castShadow = true;
    m.receiveShadow = false;
    m.frustumCulled = false;
    m.count = 0;
    group.add(m);
  }
  group.visible = false;

  const birds: Bird[] = [];
  const head = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let wait = rng.range(6, 14);
  let time = 0;
  const m4 = new THREE.Matrix4();
  const w4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qw = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const wingAt = new THREE.Vector3();
  const side = new THREE.Vector3();

  const launch = (center: THREE.Vector3): void => {
    // enter from one side of the view, fly across it at a slight angle
    const a = rng.range(0, Math.PI * 2);
    dir.set(Math.cos(a), 0, Math.sin(a));
    head.set(center.x - dir.x * (AWAY - 4), rng.range(Y0, Y1), center.z - dir.z * (AWAY - 4));
    head.x += -dir.z * rng.range(-8, 8);
    head.z += dir.x * rng.range(-8, 8);
    const n = 4 + Math.floor(rng.next() * 4);
    birds.length = 0;
    for (let i = 0; i < n; i++) {
      const row = Math.ceil(i / 2);
      const s = i % 2 === 0 ? 1 : -1;
      birds.push({ x: 0, y: 0, z: 0, ox: s * row * rng.range(0.55, 0.9), oz: -row * rng.range(0.6, 1.0), phase: rng.range(0, 6.28) });
    }
    group.visible = true;
  };

  return {
    group,
    update(dt, center, allowed, speed): void {
      time += dt;
      if (birds.length === 0) {
        if (!allowed) return;
        wait -= dt;
        if (wait <= 0) {
          wait = rng.range(22, 48);
          launch(center);
        } else return;
      }
      const v = SPEED * (0.7 + 0.3 * speed);
      head.addScaledVector(dir, v * dt);
      // gone: far past the camera
      const dx = head.x - center.x;
      const dz = head.z - center.z;
      if (dx * dir.x + dz * dir.z > AWAY) {
        birds.length = 0;
        group.visible = false;
        for (const m of [body, left, right]) m.count = 0;
        return;
      }
      const yaw = Math.atan2(dir.x, dir.z);
      side.set(dir.z, 0, -dir.x);
      for (let i = 0; i < birds.length; i++) {
        const b = birds[i]!;
        // bounding flight: ~0.55 s of wing beats, then ~0.7 s folded with a soft dip
        const cyc = ((time * 0.8 + b.phase / 6.28) % 1 + 1) % 1;
        const flapping = cyc < 0.45;
        const beat = flapping ? Math.sin(time * 26 * (0.6 + 0.4 * speed) + b.phase) : 0;
        const fold = flapping ? 0 : 1;
        const dip = flapping ? Math.sin((cyc / 0.45) * Math.PI) * 0.12 : -Math.sin(((cyc - 0.45) / 0.55) * Math.PI) * 0.16;
        b.x = head.x + side.x * b.ox + dir.x * b.oz;
        b.z = head.z + side.z * b.ox + dir.z * b.oz;
        b.y = head.y + dip + Math.sin(time * 0.9 + b.phase) * 0.15;
        e.set(dip * 0.6, yaw, 0, 'YXZ');
        q.setFromEuler(e);
        p.set(b.x, b.y, b.z);
        m4.compose(p, q, one);
        body.setMatrixAt(i, m4);
        // wings: flap around the body's long axis; folded = tucked along the back
        for (const [mesh, s] of [[left, -1], [right, 1]] as const) {
          const ang = fold ? -s * 0.15 : s * beat * 0.9;
          const tuck = fold ? 0.55 : 1;
          qw.setFromEuler(e.set(0, 0, ang, 'XYZ'));
          wingAt.set(s * 0.05 * SIZE, 0.04 * SIZE, 0.0);
          w4.compose(wingAt, qw, p.set(tuck, 1, 1));
          w4.premultiply(m4);
          mesh.setMatrixAt(i, w4);
        }
      }
      for (const m of [body, left, right]) {
        m.count = birds.length;
        m.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
