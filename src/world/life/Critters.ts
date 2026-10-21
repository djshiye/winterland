/**
 * 0.9.12 (Dino: "animals"): a little wildlife round the player, always near enough to see.
 *
 * - FINCHES: by day a small flock lands on a free patch of ground near the player and hops and pecks about. Walk up
 *   (or let your pal run at them) and they burst up and away, flapping, and are gone; another flock comes later.
 * - A CAT sits somewhere free near the player (by day and at dusk), watches you go by and grooms a paw; come too
 *   close and it trots off a few steps and sits again.
 * - DEER graze in the snow off the roads while you walk between the areas; they lift their heads, watch, and bound
 *   away if you come close.
 *
 * Purely scenery: no colliders, nothing saved, nothing to click. Each kind is one or two small instanced meshes (the
 * finches three), drawn only while one is out, so an empty moment costs nothing. Spots are checked against the
 * world's colliders and walk areas (finches and the cat land only on free walkable ground, deer only off it).
 */
import * as THREE from 'three';
import { approach, dampAngle } from '../../core/math';
import type { GameContext } from '../../core/types';
import { liveVehicles } from '../../npc/vehicleView';
import { Batch, vcMat } from '../../render/batch';
import { geo } from '../../render/materials';
import { bodyGeometry, wingGeometry } from '../sky/birds';

const FINCHES = 6;
/** Finches flee when the player (or the pal) comes this near (m); the cat this near; deer this near. */
const FINCH_SHY = 3.2;
const CAT_SHY = 1.7;
/** Finches and the cat move off for a vehicle this near (m). */
const VEHICLE_SHY = 4;
const DEER_SHY = 7.5;
/** Anything this far from the player is put away (m). */
const AWAY = 30;

type FinchState = 'peck' | 'fly';

interface Finch {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Next hop / peck. */
  t: number;
  hop: number;
  peck: number;
  vx: number;
  vy: number;
  vz: number;
  phase: number;
}

interface Cat {
  x: number;
  z: number;
  yaw: number;
  head: number;
  groom: number;
  /** Trotting off: where to. */
  to: { x: number; z: number } | null;
  bob: number;
  /** 0.9.13 (review E11): 0..1 grow-in / shrink-out scale, so it does not pop in or blink out at dusk. */
  fade: number;
  leaving: boolean;
  color: number;
}

interface Deer {
  x: number;
  z: number;
  yaw: number;
  /** 0 grazing (head down) … 1 alert. */
  alert: number;
  t: number;
  flee: boolean;
  jump: number;
}

const CAT_COATS = [0xe08a3c, 0x8e8e96, 0x3a3538, 0xf2e6d4] as const;

function catGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  // vertex colour 0xffffff is tinted per instance (setColorAt): the coat; the chest, nose and eyes keep their own
  b.add(geo.sphere(1, 12, 8), 0xffffff, 0, 0.17, -0.02, { sx: 0.13, sy: 0.17, sz: 0.16 });
  b.add(geo.sphere(1, 10, 8), 0xf6efe4, 0, 0.2, 0.08, { sx: 0.08, sy: 0.11, sz: 0.06 });
  for (const x of [-0.06, 0.06]) b.add(geo.sphere(1, 8, 6), 0xffffff, x, 0.04, 0.1, { sx: 0.04, sy: 0.035, sz: 0.06 });
  // head
  b.add(geo.sphere(0.105, 12, 9), 0xffffff, 0, 0.39, 0.06);
  for (const x of [-0.055, 0.055]) {
    b.add(geo.cone(0.035, 0.08, 4), 0xffffff, x, 0.49, 0.05, { rz: x > 0 ? -0.25 : 0.25 });
    b.add(geo.sphere(0.018, 6, 4), 0x2b2b30, x * 0.75, 0.41, 0.155);
  }
  b.add(geo.sphere(0.014, 6, 4), 0xe8909a, 0, 0.375, 0.165);
  return b.geometry();
}

function tailGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(geo.cylinder(0.022, 0.03, 0.32, 6), 0xffffff, 0, 0.03, -0.16, { rx: Math.PI / 2 - 0.15 });
  b.add(geo.cylinder(0.02, 0.022, 0.16, 6), 0xffffff, 0.04, 0.1, -0.33, { rx: 0.5, rz: -0.4 });
  return b.geometry();
}

function deerBodyGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  const coat = 0x9a6a44;
  b.add(geo.sphere(1, 14, 10), coat, 0, 0.98, 0, { sx: 0.24, sy: 0.27, sz: 0.55 });
  b.add(geo.sphere(1, 12, 8), 0xe8dcc8, 0, 0.88, 0.02, { sx: 0.18, sy: 0.17, sz: 0.42 });
  for (const x of [-0.13, 0.13]) {
    for (const z of [-0.36, 0.34]) {
      b.add(geo.cylinder(0.045, 0.035, 0.82, 6), 0x7a5236, x, 0.42, z);
      b.add(geo.cylinder(0.04, 0.04, 0.06, 6), 0x2e2622, x, 0.03, z);
    }
  }
  b.add(geo.sphere(1, 8, 6), 0xf8f4ee, 0, 1.06, -0.55, { sx: 0.08, sy: 0.1, sz: 0.06 });
  return b.geometry();
}

/** Neck and head, pivoting at the neck's base (the origin), looking +Z. */
function deerHeadGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  const coat = 0x9a6a44;
  b.add(geo.cylinder(0.08, 0.11, 0.5, 8), coat, 0, 0.2, 0.08, { rx: 0.45 });
  b.add(geo.sphere(1, 12, 9), coat, 0, 0.44, 0.24, { sx: 0.11, sy: 0.11, sz: 0.2 });
  b.add(geo.sphere(0.035, 6, 5), 0x2b2522, 0, 0.42, 0.43);
  for (const x of [-0.09, 0.09]) {
    b.add(geo.sphere(1, 8, 6), coat, x, 0.56, 0.16, { sx: 0.035, sy: 0.08, sz: 0.025 });
    b.add(geo.sphere(0.022, 6, 4), 0x1f1b1a, x * 0.8, 0.48, 0.3);
  }
  return b.geometry();
}

/** 0.9.13 (review E11): seconds a critter takes to grow in / shrink out. */
const CAT_FADE = 0.5;

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

function mesh(g: THREE.BufferGeometry, n: number, name: string): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(g, vcMat(), n);
  m.name = name;
  m.count = 0;
  m.visible = false;
  m.castShadow = true;
  m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return m;
}

export class Critters {
  readonly group = new THREE.Group();
  private readonly finchBody = mesh(bodyGeometry(), FINCHES, 'finches');
  private readonly finchL = mesh(wingGeometry(-1), FINCHES, 'finch-wings-l');
  private readonly finchR = mesh(wingGeometry(1), FINCHES, 'finch-wings-r');
  private readonly catBody = mesh(catGeometry(), 1, 'cat');
  private readonly catTail = mesh(tailGeometry(), 1, 'cat-tail');
  private readonly deerBody = mesh(deerBodyGeometry(), 2, 'deer');
  private readonly deerHead = mesh(deerHeadGeometry(), 2, 'deer-heads');
  private readonly finches: Finch[] = [];
  private finchState: FinchState = 'peck';
  private cat: Cat | null = null;
  private readonly deer: Deer[] = [];
  private finchWait = 8;
  private catWait = 12;
  private deerWait = 10;
  private time = 0;
  /** 0.9.13 (review E11): 0..1 grow-in scale of the finch flock / deer (reset when they spawn). */
  private finchK = 1;
  private deerK = 1;

  constructor(private readonly ctx: GameContext) {
    this.group.name = 'critters';
    this.group.add(this.finchBody, this.finchL, this.finchR, this.catBody, this.catTail, this.deerBody, this.deerHead);
  }

  /** How many animals are out (tests). */
  get count(): number {
    return this.finches.length + (this.cat ? 1 : 0) + this.deer.length;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    const pl = this.ctx.player?.position;
    if (!pl) return;
    const dark = this.ctx.dayNight.darkness;
    const storm = this.ctx.worldEvents.active === 'snowstorm';
    const dog = this.ctx.player?.dog?.root.position ?? null;
    this.stepFinches(dt, pl, dog, !storm && dark < 0.35);
    this.stepCat(dt, pl, !storm && dark < 0.6);
    this.stepDeer(dt, pl, !storm && dark < 0.45);
    this.draw();
  }

  // ---- finches ------------------------------------------------------------------------------------------------------
  private stepFinches(dt: number, pl: THREE.Vector3, dog: THREE.Vector3 | null, allowed: boolean): void {
    if (this.finches.length === 0) {
      if (!allowed || (this.finchWait -= dt) > 0) return;
      this.finchWait = 18 + Math.random() * 22;
      const at = this.spot(pl, 5, 10, (x, z) => this.ctx.colliders.isFree(x, z, 0.8) && !this.ctx.zones?.nearAny(x, z, 1.4));
      if (!at) return;
      const n = 4 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 1.1;
        const x = at.x + Math.cos(a) * r;
        const z = at.z + Math.sin(a) * r;
        if (!this.ctx.colliders.isFree(x, z, 0.12)) continue;
        this.finches.push({ x, y: 0, z, yaw: Math.random() * 6.28, t: Math.random(), hop: 0, peck: 0, vx: 0, vy: 0, vz: 0, phase: Math.random() * 6.28 });
      }
      this.finchState = 'peck';
      this.finchK = 0;
      return;
    }
    this.finchK = approach(this.finchK, 1, dt / CAT_FADE);
    let from: THREE.Vector3 | null = null;
    if (this.finchState === 'peck') {
      if (!allowed || this.anyNear(pl, FINCH_SHY)) from = pl;
      else if (dog && this.anyNear(dog, FINCH_SHY * 0.8)) from = dog;
      // a cart, truck or sled rolling up scares them off the road too
      else for (const v of liveVehicles()) if (this.anyNear(v.root.position, VEHICLE_SHY)) from = v.root.position;
    }
    if (from) {
      // off they go: up and away from whatever came near, each its own way a little
      this.finchState = 'fly';
      for (const f of this.finches) {
        let ax = f.x - from.x;
        let az = f.z - from.z;
        const d = Math.hypot(ax, az) || 1;
        ax /= d;
        az /= d;
        const spread = (Math.random() - 0.5) * 0.9;
        const c = Math.cos(spread);
        const s = Math.sin(spread);
        const sp = 4.5 + Math.random() * 1.5;
        f.vx = (ax * c - az * s) * sp;
        f.vz = (ax * s + az * c) * sp;
        f.vy = 2.6 + Math.random();
        f.yaw = Math.atan2(f.vx, f.vz);
      }
    }
    let gone = 0;
    for (const f of this.finches) {
      if (this.finchState === 'fly') {
        f.x += f.vx * dt;
        f.z += f.vz * dt;
        f.y += f.vy * dt;
        f.vy = approach(f.vy, 0.6, dt * 1.5);
        if (Math.hypot(f.x - pl.x, f.z - pl.z) > AWAY) gone++;
        continue;
      }
      // hop about and peck
      f.t -= dt;
      f.peck = Math.max(0, f.peck - dt * 3);
      if (f.hop > 0) {
        f.hop = Math.max(0, f.hop - dt * 4);
        const k = dt * 1.6;
        const nx = f.x + Math.sin(f.yaw) * k;
        const nz = f.z + Math.cos(f.yaw) * k;
        if (this.ctx.colliders.isFree(nx, nz, 0.12)) {
          f.x = nx;
          f.z = nz;
        }
        f.y = Math.sin(f.hop * Math.PI) * 0.12;
      } else f.y = 0;
      if (f.t <= 0) {
        f.t = 0.4 + Math.random() * 1.1;
        if (Math.random() < 0.55) {
          f.yaw += (Math.random() - 0.5) * 2.2;
          // a finch never hops up to a standing player: near one, it turns the other way
          if (Math.hypot(f.x - pl.x, f.z - pl.z) < FINCH_SHY + 1.5) f.yaw = Math.atan2(f.x - pl.x, f.z - pl.z) + (Math.random() - 0.5) * 1.2;
          f.hop = 1;
        } else f.peck = 1;
      }
    }
    let strayed = false;
    for (let i = 0; i < this.finches.length && !strayed; i++) strayed = Math.hypot(this.finches[i]!.x - pl.x, this.finches[i]!.z - pl.z) > AWAY + 10;
    if (gone === this.finches.length || strayed) this.finches.length = 0;
  }

  /** 0.9.13 (review P4): is any finch within `r` of `who` (a plain loop, no per-frame closure). */
  private anyNear(who: THREE.Vector3, r: number): boolean {
    for (let i = 0; i < this.finches.length; i++) {
      const f = this.finches[i]!;
      if (Math.hypot(who.x - f.x, who.z - f.z) < r) return true;
    }
    return false;
  }

  // ---- the cat -------------------------------------------------------------------------------------------------------
  private stepCat(dt: number, pl: THREE.Vector3, allowed: boolean): void {
    if (!this.cat) {
      if (!allowed || (this.catWait -= dt) > 0) return;
      this.catWait = 40 + Math.random() * 40;
      const at = this.spot(pl, 4, 8, (x, z) => this.ctx.colliders.isFree(x, z, 0.5) && !this.ctx.zones?.nearAny(x, z, 0.8));
      if (!at) return;
      this.cat = { x: at.x, z: at.z, yaw: Math.random() * 6.28, head: 0, groom: 0, to: null, bob: 0, fade: 0, leaving: false, color: CAT_COATS[Math.floor(Math.random() * CAT_COATS.length)]! };
      return;
    }
    const c = this.cat;
    const dx = pl.x - c.x;
    const dz = pl.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d > AWAY) {
      this.cat = null;
      return;
    }
    if (!allowed) c.leaving = true;
    c.fade = approach(c.fade, c.leaving ? 0 : 1, dt / CAT_FADE);
    if (c.leaving) {
      if (c.fade <= 0) this.cat = null;
      return;
    }
    let fx = dx;
    let fz = dz;
    let scared = d < CAT_SHY;
    if (!scared)
      for (const v of liveVehicles()) {
        const vp = v.root.position;
        if (Math.hypot(vp.x - c.x, vp.z - c.z) < VEHICLE_SHY) {
          fx = vp.x - c.x;
          fz = vp.z - c.z;
          scared = true;
          break;
        }
      }
    if (!c.to && scared) {
      // a few steps away from you (or the cart), if there is room
      for (let k = 0; k < 6 && !c.to; k++) {
        const a = Math.atan2(-fx, -fz) + (Math.random() - 0.5) * 1.6;
        const x = c.x + Math.sin(a) * 3;
        const z = c.z + Math.cos(a) * 3;
        if (this.ctx.colliders.isFree(x, z, 0.4) && !this.ctx.zones?.nearAny(x, z, 0.8)) c.to = { x, z };
      }
    }
    if (c.to) {
      const tx = c.to.x - c.x;
      const tz = c.to.z - c.z;
      const td = Math.hypot(tx, tz);
      c.yaw = dampAngle(c.yaw, Math.atan2(tx, tz), 10, dt);
      const step = Math.min(td, dt * 2.2);
      c.x += (tx / (td || 1)) * step;
      c.z += (tz / (td || 1)) * step;
      c.bob += dt * 14;
      c.head = approach(c.head, 0, dt * 4);
      if (td < 0.05) c.to = null;
      return;
    }
    // sitting: watch the player when near, groom now and then
    const look = d < 7 ? Math.max(-1.1, Math.min(1.1, ((Math.atan2(dx, dz) - c.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI)) : 0;
    c.head = approach(c.head, look, dt * 3);
    c.groom = Math.max(0, c.groom - dt * 0.5);
    if (c.groom === 0 && Math.random() < dt * 0.07) c.groom = 1;
  }

  // ---- deer ----------------------------------------------------------------------------------------------------------
  private stepDeer(dt: number, pl: THREE.Vector3, allowed: boolean): void {
    if (this.deer.length === 0) {
      if (!allowed || (this.deerWait -= dt) > 0) return;
      this.deerWait = 30 + Math.random() * 30;
      // only out between the areas: the player on a road, the deer in the snow beside it
      const C = this.ctx.colliders;
      const at = this.spot(pl, 9, 13, (x, z) => !C.inBounds(x, z, 2.2) && !C.overlaps(x, z, 1.2) && !C.inBounds(x + 1.2, z + 1.2, 1) && !C.inBounds(x - 1.2, z - 1.2, 1));
      if (!at) return;
      const n = Math.random() < 0.5 ? 2 : 1;
      this.deerK = 0;
      for (let i = 0; i < n; i++) this.deer.push({ x: at.x + i * 1.3, z: at.z + i * 0.7, yaw: Math.random() * 6.28, alert: 0, t: 2 + Math.random() * 3, flee: false, jump: 0 });
      return;
    }
    this.deerK = approach(this.deerK, 1, dt / CAT_FADE);
    for (const d of this.deer) {
      const dx = d.x - pl.x;
      const dz = d.z - pl.z;
      const dist = Math.hypot(dx, dz);
      if (!d.flee && (dist < DEER_SHY || !allowed)) {
        d.flee = true;
        d.yaw = Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.5;
      }
      if (d.flee) {
        d.jump += dt * 2.3;
        d.x += Math.sin(d.yaw) * dt * 6.5;
        d.z += Math.cos(d.yaw) * dt * 6.5;
        d.alert = 1;
        continue;
      }
      // graze, look up now and then (and watch the player once near), take a step
      d.t -= dt;
      const want = dist < DEER_SHY + 5 ? 1 : d.t < 1.2 ? 1 : 0;
      d.alert = approach(d.alert, want, dt * 2.5);
      if (d.t <= 0) {
        d.t = 3 + Math.random() * 4;
        d.yaw += (Math.random() - 0.5) * 1.2;
      }
    }
    let near = false;
    for (let i = 0; i < this.deer.length && !near; i++) near = Math.hypot(this.deer[i]!.x - pl.x, this.deer[i]!.z - pl.z) <= AWAY;
    if (!near) this.deer.length = 0;
  }

  /** A random point `lo`…`hi` m from the player that `ok` accepts (a few tries), or null. */
  private spot(pl: THREE.Vector3, lo: number, hi: number, ok: (x: number, z: number) => boolean): { x: number; z: number } | null {
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = lo + Math.random() * (hi - lo);
      const x = pl.x + Math.cos(a) * r;
      const z = pl.z + Math.sin(a) * r;
      if (ok(x, z)) return { x, z };
    }
    return null;
  }

  // ---- drawing -------------------------------------------------------------------------------------------------------
  private draw(): void {
    // finches (the sky's bullfinch, a little smaller on the ground)
    const fb = this.finchBody;
    let n = 0;
    for (const f of this.finches) {
      const flying = this.finchState === 'fly';
      const k = (flying ? 0.9 : 0.8) * Math.max(0.01, this.finchK);
      const pitch = flying ? -0.2 : f.peck > 0 ? Math.sin(f.peck * Math.PI) * 0.7 : 0;
      _e.set(pitch, f.yaw, 0, 'YXZ');
      _m.compose(_p.set(f.x, f.y + 0.1 * k, f.z), _q.setFromEuler(_e), _s.set(k, k, k));
      fb.setMatrixAt(n, _m);
      const beat = flying ? Math.sin(this.time * 28 + f.phase) * 0.9 : 0;
      for (const [w, s] of [[this.finchL, -1], [this.finchR, 1]] as const) {
        _q.setFromEuler(_e.set(0, 0, flying ? s * beat : -s * 0.15, 'XYZ'));
        _m2.compose(_p.set(s * 0.075, 0.06, 0), _q, _s.set(flying ? 1 : 0.55, 1, 1)).premultiply(_m);
        w.setMatrixAt(n, _m2);
      }
      n++;
    }
    for (const m of [fb, this.finchL, this.finchR]) this.show(m, n);

    // the cat
    const c = this.cat;
    if (c) {
      const bob = c.to ? Math.abs(Math.sin(c.bob)) * 0.03 : 0;
      _e.set(0, c.yaw, 0, 'YXZ');
      _m.compose(_p.set(c.x, bob, c.z), _q.setFromEuler(_e), _s.setScalar(Math.max(0.01, c.fade)));
      this.catBody.setMatrixAt(0, _m);
      this.catBody.setColorAt(0, _c.setHex(c.color));
      // tail swish (faster while it walks)
      const sw = Math.sin(this.time * (c.to ? 7 : 1.6)) * (c.to ? 0.25 : 0.45);
      _q.setFromEuler(_e.set(0, sw, 0));
      _m2.compose(_p.set(0, 0, 0), _q, _s.set(1, 1, 1)).premultiply(_m);
      this.catTail.setMatrixAt(0, _m2);
      this.catTail.setColorAt(0, _c);
      for (const m of [this.catBody, this.catTail]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.show(this.catBody, c ? 1 : 0);
    this.show(this.catTail, c ? 1 : 0);

    // deer
    let k = 0;
    for (const d of this.deer) {
      const leap = d.flee ? Math.abs(Math.sin(d.jump * Math.PI)) : 0;
      _e.set(d.flee ? -Math.cos(d.jump * Math.PI) * 0.18 : 0, d.yaw, 0, 'YXZ');
      _m.compose(_p.set(d.x, leap * 0.55, d.z), _q.setFromEuler(_e), _s.setScalar(Math.max(0.01, this.deerK)));
      this.deerBody.setMatrixAt(k, _m);
      // head: down grazing (bobbing as it nibbles), up when alert
      const graze = (1 - d.alert) * (1.25 + Math.sin(this.time * 3 + k) * 0.08);
      _q.setFromEuler(_e.set(graze, 0, 0));
      _m2.compose(_p.set(0, 1.12, 0.42), _q, _s.set(1, 1, 1)).premultiply(_m);
      this.deerHead.setMatrixAt(k, _m2);
      k++;
    }
    this.show(this.deerBody, k);
    this.show(this.deerHead, k);
  }

  private show(m: THREE.InstancedMesh, n: number): void {
    m.count = n;
    m.visible = n > 0;
    if (n > 0) m.instanceMatrix.needsUpdate = true;
  }
}
