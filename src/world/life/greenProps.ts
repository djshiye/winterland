/**
 * 0.9.12 (Dino: "people doing things"): the little props the greens' people use, as three small instanced meshes
 * (one draw call each, only while one shows): snowmen they build, brooms they sweep their doorsteps with, and the
 * snowballs kids throw. Owned by world/life/RegionLife.ts and city/DistrictLife.ts; nothing is saved.
 */
import * as THREE from 'three';
import { Batch, vcMat } from '../../render/batch';
import { geo } from '../../render/materials';

const SNOW = 0xf4f8fc;

function snowmanGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(geo.sphere(0.34, 14, 10), SNOW, 0, 0.3, 0, { sy: 0.9 });
  b.add(geo.sphere(0.25, 14, 10), SNOW, 0, 0.72, 0);
  b.add(geo.sphere(0.18, 12, 9), SNOW, 0, 1.05, 0);
  b.add(geo.torus(0.16, 0.05, 6, 16), 0xd9534f, 0, 0.9, 0, { rx: Math.PI / 2 });
  b.add(geo.box(0.07, 0.2, 0.04), 0xd9534f, 0.1, 0.8, 0.17, { rz: 0.3 });
  b.add(geo.cone(0.035, 0.18, 6), 0xf28c28, 0, 1.05, 0.25, { rx: Math.PI / 2 });
  for (const x of [-0.065, 0.065]) b.add(geo.sphere(0.025, 6, 4), 0x2b2b30, x, 1.11, 0.155);
  for (const y of [0.62, 0.74]) b.add(geo.sphere(0.028, 6, 4), 0x2b2b30, 0, y, 0.245);
  for (const s of [-1, 1]) b.add(geo.cylinder(0.015, 0.02, 0.36, 4), 0x6b4a36, s * 0.32, 0.82, 0, { rz: s * 1.0 });
  return b.geometry();
}

function broomGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(geo.cylinder(0.022, 0.022, 1.15, 6), 0x8a5a3a, 0, 0.62, 0);
  b.add(geo.cone(0.12, 0.3, 8), 0xd9b25e, 0, 0.12, 0, { rx: Math.PI });
  b.add(geo.cylinder(0.05, 0.05, 0.05, 8), 0x6e4a32, 0, 0.27, 0);
  return b.geometry();
}

function ballGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(geo.sphere(0.075, 8, 6), 0xffffff, 0, 0, 0);
  return b.geometry();
}

class Pool {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;

  constructor(g: THREE.BufferGeometry, max: number, name: string, cast: boolean) {
    this.mesh = new THREE.InstancedMesh(g, vcMat(), max);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.castShadow = cast;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  begin(): void {
    this.n = 0;
  }

  put(m: THREE.Matrix4): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    this.mesh.setMatrixAt(this.n++, m);
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** The three prop pools under one group. Call begin(), put what shows this frame, then end(). */
export class GreenProps {
  readonly group = new THREE.Group();
  private readonly snowmen = new Pool(snowmanGeometry(), 8, 'snowmen', true);
  private readonly brooms = new Pool(broomGeometry(), 4, 'brooms', false);
  private readonly balls = new Pool(ballGeometry(), 6, 'snowballs', false);

  constructor() {
    this.group.name = 'green-props';
    this.group.add(this.snowmen.mesh, this.brooms.mesh, this.balls.mesh);
  }

  begin(): void {
    this.snowmen.begin();
    this.brooms.begin();
    this.balls.begin();
  }

  /** A snowman at (x, z) facing `yaw`, grown `g` (0 … 1: a low lump rises into the full figure). */
  snowman(x: number, z: number, yaw: number, g: number): void {
    if (g <= 0.01) return;
    const k = 0.25 + 0.75 * g;
    this.snowmen.put(_m.compose(_p.set(x, 0, z), _q.setFromEuler(_e.set(0, yaw, 0)), _s.set(0.85 * (0.6 + 0.4 * g), 0.85 * k, 0.85 * (0.6 + 0.4 * g))));
  }

  /** A broom held by someone at (x, z) facing `yaw`, swept side to side by `sweep` (−1 … 1). */
  broom(x: number, z: number, yaw: number, sweep: number): void {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const bx = x + fx * 0.42 + Math.cos(yaw) * sweep * 0.18;
    const bz = z + fz * 0.42 - Math.sin(yaw) * sweep * 0.18;
    this.brooms.put(_m.compose(_p.set(bx, 0.02, bz), _q.setFromEuler(_e.set(-0.45, yaw, sweep * 0.35, 'YXZ')), _s.set(1, 1, 1)));
  }

  /** A snowball at (x, y, z). */
  ball(x: number, y: number, z: number): void {
    this.balls.put(_m.compose(_p.set(x, y, z), _q.identity(), _s.set(1, 1, 1)));
  }

  end(): void {
    this.snowmen.end();
    this.brooms.end();
    this.balls.end();
  }
}
