/**
 * [B4 — juice & HUD] Pooled particle effects.
 *
 * Every shape (cube / chip / sphere / puff / confetti / sparkle) is one InstancedMesh with a fixed
 * capacity and per-instance colour. Particles live in flat typed arrays and are swap-removed when
 * they die, so spawning and updating never allocate in steady state. Rings are a small pool of flat
 * meshes (each with its own fading material).
 * - burst: generic spray (chopping wood chips, sawdust, build debris).
 * - puff: soft white/grey spheres that expand then shrink away (footstep snow, smoke, poof).
 * - confetti: colourful flat chips raining down (pad unlock celebration).
 * - splash: water droplets + foam puffs + ring on the river (intro crash).
 * - sparkle: small twinkling stars (cash landing, crate made).
 * - ring: flat expanding ground ring/shockwave that fades (building spawn, pad unlock).
 * All timing runs on the simulation dt passed to update().
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../config';
import { geo, toon, basic } from '../render/materials';
import type { GameContext } from '../core/types';

export interface BurstOptions {
  colors?: number[];
  count?: number;
  /** Initial speed (units/s). */
  speed?: number;
  size?: number;
  gravity?: number;
  /** Lifetime (s). */
  life?: number;
  /** Cone half-angle (rad) around `direction`; Math.PI = full sphere. */
  spread?: number;
  /** Main emission direction (default up). */
  direction?: THREE.Vector3;
  shape?: 'cube' | 'chip' | 'sphere';
}

/** How a particle's scale evolves over its life. */
const Scale = {
  /** Full size, then shrinks to 0 over the last 40 %. */
  Shrink: 0,
  /** Grows quickly, holds, then shrinks (smoke/snow puffs). */
  Puff: 1,
  /** Twinkles: pulses in and out. */
  Twinkle: 2,
} as const;
type ScaleMode = (typeof Scale)[keyof typeof Scale];

const WOOD_COLORS = [PALETTE.bark, PALETTE.barkDark, PALETTE.woodEnd, PALETTE.woodRing, PALETTE.plank];
const CONFETTI_COLORS = [0xff4d6d, 0xffc43d, 0x5ee07a, 0x3fa7ff, 0xb066ff, 0xffffff];
const WATER_COLORS = [PALETTE.water, 0x8fd6ff, 0xffffff, 0xcdeeff];

const GRAVITY_DEFAULT = 14;

/** One InstancedMesh + SoA particle storage. */
class Pool {
  readonly mesh: THREE.InstancedMesh;
  count = 0;
  private readonly cap: number;
  // Per particle, stride 3 unless noted.
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly col: Float32Array;
  // Per particle, stride 1: life, maxLife, size, gravity, drag, floorY, scaleMode, stretch(unused y-scale)
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly floor: Float32Array;
  private readonly mode: Uint8Array;
  private readonly grow: Float32Array;

  private static readonly m4 = new THREE.Matrix4();
  private static readonly q = new THREE.Quaternion();
  private static readonly e = new THREE.Euler();
  private static readonly p = new THREE.Vector3();
  private static readonly s = new THREE.Vector3();

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    cap: number,
    scene: THREE.Object3D,
  ) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.rot = new Float32Array(cap * 3);
    this.spin = new Float32Array(cap * 3);
    this.col = this.mesh.instanceColor.array as Float32Array;
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.floor = new Float32Array(cap);
    this.mode = new Uint8Array(cap);
    this.grow = new Float32Array(cap);
  }

  /** Spawn one particle; recycles the oldest-ish slot when the pool is full. */
  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    color: THREE.Color,
    size: number, life: number, gravity: number,
    spinRate: number, mode: ScaleMode, drag = 0, floorY = 0.04, grow = 1,
  ): void {
    let i = this.count;
    if (i >= this.cap) i = (Math.random() * this.cap) | 0;
    else this.count++;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.rot[k] = Math.random() * 6.28; this.rot[k + 1] = Math.random() * 6.28; this.rot[k + 2] = Math.random() * 6.28;
    this.spin[k] = (Math.random() - 0.5) * 2 * spinRate;
    this.spin[k + 1] = (Math.random() - 0.5) * 2 * spinRate;
    this.spin[k + 2] = (Math.random() - 0.5) * 2 * spinRate;
    this.col[k] = color.r; this.col[k + 1] = color.g; this.col[k + 2] = color.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.grav[i] = gravity;
    this.drag[i] = drag;
    this.floor[i] = floorY;
    this.mode[i] = mode;
    this.grow[i] = grow;
  }

  update(dt: number): void {
    const { pos, vel, rot, spin } = this;
    let n = this.count;
    for (let i = 0; i < n; ) {
      const l = this.life[i]! - dt;
      if (l <= 0) {
        // swap-remove with the last live particle
        n--;
        if (i !== n) this.copy(n, i);
        continue;
      }
      this.life[i] = l;
      const k = i * 3;
      const d = this.drag[i]!;
      if (d > 0) {
        const f = Math.exp(-d * dt);
        vel[k] = vel[k]! * f; vel[k + 1] = vel[k + 1]! * f; vel[k + 2] = vel[k + 2]! * f;
      }
      vel[k + 1] = vel[k + 1]! - this.grav[i]! * dt;
      pos[k] = pos[k]! + vel[k]! * dt;
      pos[k + 1] = pos[k + 1]! + vel[k + 1]! * dt;
      pos[k + 2] = pos[k + 2]! + vel[k + 2]! * dt;
      if (pos[k + 1]! < this.floor[i]! && vel[k + 1]! < 0) {
        pos[k + 1] = this.floor[i]!;
        vel[k + 1] = -vel[k + 1]! * 0.32;
        vel[k] = vel[k]! * 0.6; vel[k + 2] = vel[k + 2]! * 0.6;
        spin[k] = spin[k]! * 0.5; spin[k + 1] = spin[k + 1]! * 0.5; spin[k + 2] = spin[k + 2]! * 0.5;
      }
      rot[k] = rot[k]! + spin[k]! * dt;
      rot[k + 1] = rot[k + 1]! + spin[k + 1]! * dt;
      rot[k + 2] = rot[k + 2]! + spin[k + 2]! * dt;
      this.write(i, l / this.maxLife[i]!);
      i++;
    }
    this.count = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceColor!.clearUpdateRanges();
    if (n > 0) {
      this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
      this.mesh.instanceColor!.addUpdateRange(0, n * 3);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.needsUpdate = true;
    }
  }

  private write(i: number, remain: number): void {
    const k = i * 3;
    const age = 1 - remain;
    let s: number;
    switch (this.mode[i]) {
      case Scale.Puff: {
        const g = this.grow[i]!;
        s = (0.45 + 0.55 * Math.min(1, age * 4)) * (1 + (g - 1) * age);
        if (remain < 0.5) s *= remain * 2;
        break;
      }
      case Scale.Twinkle:
        s = Math.sin(Math.PI * age);
        s *= 0.75 + 0.25 * Math.sin(age * 40);
        break;
      default:
        s = remain < 0.4 ? remain / 0.4 : 1;
    }
    s *= this.size[i]!;
    const e = Pool.e.set(this.rot[k]!, this.rot[k + 1]!, this.rot[k + 2]!);
    Pool.q.setFromEuler(e);
    Pool.p.set(this.pos[k]!, this.pos[k + 1]!, this.pos[k + 2]!);
    Pool.s.set(s, s, s);
    this.mesh.setMatrixAt(i, Pool.m4.compose(Pool.p, Pool.q, Pool.s));
  }

  private copy(from: number, to: number): void {
    const a = from * 3;
    const b = to * 3;
    for (let j = 0; j < 3; j++) {
      this.pos[b + j] = this.pos[a + j]!;
      this.vel[b + j] = this.vel[a + j]!;
      this.rot[b + j] = this.rot[a + j]!;
      this.spin[b + j] = this.spin[a + j]!;
      this.col[b + j] = this.col[a + j]!;
    }
    this.life[to] = this.life[from]!;
    this.maxLife[to] = this.maxLife[from]!;
    this.size[to] = this.size[from]!;
    this.grav[to] = this.grav[from]!;
    this.drag[to] = this.drag[from]!;
    this.floor[to] = this.floor[from]!;
    this.mode[to] = this.mode[from]!;
    this.grow[to] = this.grow[from]!;
  }
}

/** One expanding ground ring. */
interface RingSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  radius: number;
  active: boolean;
}

export class Particles {
  private readonly cube: Pool;
  private readonly chip: Pool;
  private readonly sphere: Pool;
  private readonly puffs: Pool;
  private readonly confettiPool: Pool;
  private readonly stars: Pool;
  private readonly rings: RingSlot[] = [];
  private ringCursor = 0;

  private readonly tmpColor = new THREE.Color();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpU = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(readonly ctx: GameContext) {
    const scene = ctx.scene;
    const white = new THREE.MeshToonMaterial({ color: 0xffffff });
    white.gradientMap = toon(0xffffff).gradientMap;
    this.cube = new Pool(geo.box(1, 1, 1), white, 220, scene);
    this.chip = new Pool(geo.box(1.5, 0.45, 0.8), white, 220, scene);
    this.sphere = new Pool(geo.sphere(0.5, 8, 6), white, 200, scene);
    const puffMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toon(0xffffff).gradientMap });
    this.puffs = new Pool(geo.sphere(0.5, 10, 8), puffMat, 160, scene);
    const flat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.confettiPool = new Pool(geo.plane(1, 0.62), flat, 260, scene);
    const star = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.stars = new Pool(Particles.starGeometry(), star, 120, scene);

    const ringGeo = geo.ringGround(0.8, 1, 48);
    for (let i = 0; i < 10; i++) {
      const mat = basic(0xffffff, { transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide }).clone();
      const m = new THREE.Mesh(ringGeo, mat);
      m.visible = false;
      m.castShadow = false;
      m.receiveShadow = false;
      m.renderOrder = 5;
      m.frustumCulled = false;
      scene.add(m);
      this.rings.push({ mesh: m, mat, age: 0, life: 1, radius: 1, active: false });
    }
  }

  /** Four-point star (flat, facing +Z) used by sparkles. */
  private static starGeometry(): THREE.BufferGeometry {
    const s = new THREE.Shape();
    const outer = 0.5;
    const inner = 0.14;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
      const r = i % 2 === 0 ? outer : inner;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    const a = new THREE.ShapeGeometry(s);
    const b = a.clone().rotateY(Math.PI / 2);
    return mergeGeometries([a, b])!;
  }

  /** Generic particle spray (wood chips, sawdust, debris). */
  burst(pos: THREE.Vector3, opts?: BurstOptions): void {
    const colors = opts?.colors ?? WOOD_COLORS;
    const count = opts?.count ?? 8;
    const speed = opts?.speed ?? 4;
    const size = opts?.size ?? 0.2;
    const gravity = opts?.gravity ?? GRAVITY_DEFAULT;
    const life = opts?.life ?? 0.7;
    const spread = opts?.spread ?? 0.9;
    const dir = this.tmpDir.copy(opts?.direction ?? Particles.UP).normalize();
    // orthonormal basis around dir
    const u = this.tmpU.crossVectors(dir, Math.abs(dir.y) > 0.9 ? this.tmpV.set(1, 0, 0) : Particles.UP).normalize();
    const v = this.tmpV.crossVectors(dir, u);
    const pool = opts?.shape === 'cube' ? this.cube : opts?.shape === 'sphere' ? this.sphere : this.chip;
    for (let i = 0; i < count; i++) {
      // uniform within the cone
      const cosT = 1 - Math.random() * (1 - Math.cos(spread));
      const sinT = Math.sqrt(1 - cosT * cosT);
      const phi = Math.random() * Math.PI * 2;
      const cx = Math.cos(phi) * sinT;
      const cy = Math.sin(phi) * sinT;
      const sp = speed * (0.55 + Math.random() * 0.7);
      this.tmpColor.setHex(colors[(Math.random() * colors.length) | 0]!);
      pool.spawn(
        pos.x + (Math.random() - 0.5) * 0.2, pos.y + (Math.random() - 0.5) * 0.1, pos.z + (Math.random() - 0.5) * 0.2,
        (u.x * cx + v.x * cy + dir.x * cosT) * sp,
        (u.y * cx + v.y * cy + dir.y * cosT) * sp,
        (u.z * cx + v.z * cy + dir.z * cosT) * sp,
        this.tmpColor,
        size * (0.7 + Math.random() * 0.6), life * (0.7 + Math.random() * 0.5), gravity,
        14, Scale.Shrink, 0.4,
      );
    }
  }

  /** Soft expanding cloud (snow poof, smoke). */
  puff(pos: THREE.Vector3, opts?: { color?: number; count?: number; size?: number; life?: number }): void {
    const count = opts?.count ?? 5;
    const size = opts?.size ?? 0.5;
    const life = opts?.life ?? 0.7;
    this.tmpColor.setHex(opts?.color ?? 0xffffff);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.5;
      const out = 0.6 + Math.random() * 1.1;
      this.puffs.spawn(
        pos.x + Math.cos(a) * r * 0.5, pos.y + Math.random() * 0.2, pos.z + Math.sin(a) * r * 0.5,
        Math.cos(a) * out, 0.9 + Math.random() * 1.0, Math.sin(a) * out,
        this.tmpColor,
        size * (0.6 + Math.random() * 0.6), life * (0.75 + Math.random() * 0.5), -0.3,
        0, Scale.Puff, 2.2, -10, 1.8,
      );
    }
  }

  /** Colourful flat chips raining down around `pos`. */
  confetti(pos: THREE.Vector3, count = 50): void {
    for (let i = 0; i < count; i++) {
      this.tmpColor.setHex(CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0]!);
      const a = Math.random() * Math.PI * 2;
      const out = 1.5 + Math.random() * 4.5;
      this.confettiPool.spawn(
        pos.x, pos.y + 0.8, pos.z,
        Math.cos(a) * out, 5 + Math.random() * 6, Math.sin(a) * out,
        this.tmpColor,
        0.32 + Math.random() * 0.2, 1.5 + Math.random() * 0.9, 9,
        12, Scale.Shrink, 1.6, 0.04, 1,
      );
    }
  }

  /** Water droplets, foam puffs and a ring (intro crash into the river). */
  splash(pos: THREE.Vector3, scale = 1): void {
    const n = Math.round(26 * scale);
    for (let i = 0; i < n; i++) {
      this.tmpColor.setHex(WATER_COLORS[(Math.random() * WATER_COLORS.length) | 0]!);
      const a = Math.random() * Math.PI * 2;
      const out = (0.8 + Math.random() * 3.2) * scale;
      this.sphere.spawn(
        pos.x + Math.cos(a) * 0.4, pos.y, pos.z + Math.sin(a) * 0.4,
        Math.cos(a) * out, (5 + Math.random() * 6) * Math.sqrt(scale), Math.sin(a) * out,
        this.tmpColor,
        (0.24 + Math.random() * 0.26) * scale, 0.9 + Math.random() * 0.5, 16,
        0, Scale.Shrink, 0, pos.y - 0.4,
      );
    }
    this.puff(pos, { color: 0xffffff, count: Math.round(7 * scale), size: 0.9 * scale, life: 0.9 });
    this.ring(pos, { color: 0xffffff, radius: 3.2 * scale, life: 0.8 });
    this.ring(pos, { color: 0xbfe8ff, radius: 2.0 * scale, life: 0.6 });
  }

  /** A few twinkling stars drifting up from `pos`. */
  sparkle(pos: THREE.Vector3, color = 0xffe066): void {
    this.tmpColor.setHex(color);
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.1 + Math.random() * 0.35;
      this.stars.spawn(
        pos.x + Math.cos(a) * r, pos.y + 0.2 + Math.random() * 0.3, pos.z + Math.sin(a) * r,
        Math.cos(a) * 0.4, 1.0 + Math.random() * 0.9, Math.sin(a) * 0.4,
        this.tmpColor,
        0.55 + Math.random() * 0.3, 0.45 + Math.random() * 0.25, 0,
        2, Scale.Twinkle, 1.5, -10,
      );
    }
  }

  /** Flat expanding ground ring that fades out. */
  ring(pos: THREE.Vector3, opts?: { color?: number; radius?: number; life?: number }): void {
    let slot: RingSlot | undefined;
    for (let i = 0; i < this.rings.length; i++) {
      const s = this.rings[(this.ringCursor + i) % this.rings.length]!;
      if (!s.active) {
        slot = s;
        this.ringCursor = (this.ringCursor + i + 1) % this.rings.length;
        break;
      }
    }
    if (!slot) {
      slot = this.rings[this.ringCursor]!;
      this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    }
    slot.active = true;
    slot.age = 0;
    slot.life = opts?.life ?? 0.6;
    slot.radius = opts?.radius ?? 2.5;
    slot.mat.color.setHex(opts?.color ?? 0xffffff);
    slot.mat.opacity = 0.9;
    slot.mesh.position.set(pos.x, pos.y + 0.07, pos.z);
    slot.mesh.scale.setScalar(0.1);
    slot.mesh.visible = true;
  }

  update(dt: number): void {
    this.cube.update(dt);
    this.chip.update(dt);
    this.sphere.update(dt);
    this.puffs.update(dt);
    this.confettiPool.update(dt);
    this.stars.update(dt);
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i]!;
      if (!r.active) continue;
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      r.mesh.scale.setScalar(Math.max(0.05, r.radius * (0.15 + 0.85 * e)));
      r.mat.opacity = 0.9 * (1 - k * k);
    }
  }
}
