/**
 * [eras] Cosmetic freight at the export depot (idea "a working depot in every era"; no economy change). Every material the
 * depot receives adds one to a pending count (cap 4); while it is > 0 a loader (hand cart / forklift / hover bot, by era)
 * carries one crate from the depot platform's west end to a freight lift in the floor just west of it and sets it on the
 * platform. The 4th crate makes the lift sink with its crates, pause, and rise empty while the loader waits.
 * Pure parts (freightLayout, LiftCycle) are exported for tests. No colliders; the update allocates nothing and does
 * nothing at all while idle. Reduced motion: no hover bob, everything else identical.
 */
import * as THREE from 'three';
import { LIFT_HALF, LIFT_REST_Y, LIFT_TOP, LOADER_SPECS, CRATE, createCrates, createLiftModel, createLoaderModel, freightTier, type LoaderSpec } from '../assets/depotFreight';
import { reducedMotion } from '../fx/comfort';
import type { RegionLayout, XZ } from './layout';

export const MAX_PENDING = 4;
export const LIFT_CAPACITY = 4;
export const SINK_DEPTH = 1.3;
const FULL_PAUSE = 0.35;
const SINK_TIME = 1.5;
const HOLD_TIME = 0.6;
const RISE_TIME = 1.5;
const LOAD_TIME = 0.45;
const DROP_TIME = 0.45;
const TURN_RATE = 6;
/** Outer edge of the hatch curb (platform half + curb wall). */
const CURB_OUT = LIFT_HALF + 0.22;
/** Loader line sits this far toward the fence from the depot's centre line. */
const LOADER_OFFSET = 0.5;

export interface FreightLayout {
  lift: XZ;
  /** Loader line depth (z) and its two x ends for a loader with the given front clearance / reach. */
  loaderZ: number;
  homeX: number;
  stopX: (spec: LoaderSpec, front: number) => number;
  /** Lift frame depth range from the gate edge (for the yard band tests). */
  frameDepth: [number, number];
  slots: XZ[];
}

/** Where everything stands (world coordinates; west is always −X, the fence side is −inward). Pure. */
export function freightLayout(L: Pick<RegionLayout, 'depot' | 'inward' | 'gate'>): FreightLayout {
  const lift = { x: L.depot.x - 4.6, z: L.depot.z };
  const sz = -L.inward; // toward the fence
  const slots: XZ[] = [];
  for (const dx of [0.25, -0.25]) for (const dz of [sz * 0.25, -sz * 0.25]) slots.push({ x: lift.x + dx, z: lift.z + dz });
  const fd = (z: number): number => (z - L.gate.z) * L.inward;
  const a = fd(lift.z + sz * 1.03); // the frame's fence-side face
  const b = fd(lift.z - sz * CURB_OUT); // the hatch curb's yard-side face
  return {
    lift,
    loaderZ: L.depot.z + sz * LOADER_OFFSET,
    homeX: L.depot.x - 1.8,
    stopX: (_spec, front) => lift.x + CURB_OUT + front + 0.05,
    frameDepth: [Math.min(a, b), Math.max(a, b)],
    slots,
  };
}

export type LiftPhase = 'idle' | 'full' | 'sink' | 'hold' | 'rise';

/** The lift's crate stack and sink/rise cycle (pure). */
export class LiftCycle {
  crates = 0;
  phase: LiftPhase = 'idle';
  private t = 0;

  /** The loader may set a crate down. */
  get ready(): boolean {
    return this.phase === 'idle' && this.crates < LIFT_CAPACITY;
  }

  /** How far the platform has sunk, metres. */
  get sunk(): number {
    switch (this.phase) {
      case 'sink': return SINK_DEPTH * ease(this.t / SINK_TIME);
      case 'hold': return SINK_DEPTH;
      case 'rise': return SINK_DEPTH * (1 - ease(this.t / RISE_TIME));
      default: return 0;
    }
  }

  land(): void {
    if (!this.ready) return;
    this.crates++;
    if (this.crates >= LIFT_CAPACITY) this.go('full');
  }

  update(dt: number): void {
    if (this.phase === 'idle') return;
    this.t += dt;
    if (this.phase === 'full' && this.t >= FULL_PAUSE) this.go('sink');
    else if (this.phase === 'sink' && this.t >= SINK_TIME) this.go('hold');
    else if (this.phase === 'hold' && this.t >= HOLD_TIME) {
      this.crates = 0;
      this.go('rise');
    } else if (this.phase === 'rise' && this.t >= RISE_TIME) this.go('idle');
  }

  private go(p: LiftPhase): void {
    this.phase = p;
    this.t = 0;
  }
}

const ease = (k: number): number => {
  const x = k < 0 ? 0 : k > 1 ? 1 : k;
  return x * x * (3 - 2 * x);
};

type LoaderState = 'wait' | 'load' | 'turnOut' | 'goOut' | 'drop' | 'turnBack' | 'goBack';
const EAST = Math.PI / 2;
const WEST = -Math.PI / 2;
const FRONT = [0.4, 0.5, 0.45] as const;

export class DepotFreight {
  pending = 0;
  readonly lift = new LiftCycle();
  readonly fl: FreightLayout;
  private readonly spec: LoaderSpec;
  private readonly front: number;
  private readonly liftRoot: THREE.Group;
  private readonly platform: THREE.Mesh;
  private readonly loader: THREE.Group;
  private readonly crates: THREE.InstancedMesh;
  private readonly slotCount = 4;
  private state: LoaderState = 'wait';
  private t = 0;
  private x: number;
  private yaw = EAST;
  private fromX = 0;
  private stopX: number;
  private clock = 0;
  private readonly dropFrom = new THREE.Vector3();
  private readonly dropTo = new THREE.Vector3();
  private readonly m4 = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scl = new THREE.Vector3();
  private readonly eul = new THREE.Euler();
  private carrying = false;
  private carryScale = 1;

  constructor(
    readonly era: number,
    L: Pick<RegionLayout, 'depot' | 'inward' | 'gate' | 'facilityYaw'>,
    private readonly parent: THREE.Object3D,
  ) {
    const tier = freightTier(era);
    this.spec = LOADER_SPECS[tier];
    this.front = FRONT[tier]!;
    this.fl = freightLayout(L);
    this.x = this.fl.homeX;
    this.stopX = this.fl.stopX(this.spec, this.front);

    const lm = createLiftModel(era);
    this.liftRoot = lm.root;
    this.platform = lm.platform;
    this.liftRoot.position.set(this.fl.lift.x, 0, this.fl.lift.z);
    this.liftRoot.rotation.y = L.facilityYaw;

    this.loader = createLoaderModel(era).root;
    this.loader.rotation.order = 'YXZ';
    this.crates = createCrates(era, this.slotCount + 1);
    parent.add(this.liftRoot, this.loader, this.crates);
    this.place();
    this.writeCrates();
  }

  /** Called by the depot for every delivered material. */
  push(): void {
    if (this.pending < MAX_PENDING) this.pending++;
  }

  update(dt: number): void {
    if (!this.parent.visible) return;
    const idle = this.state === 'wait' && this.pending === 0 && this.lift.phase === 'idle';
    if (idle) return;
    if (dt > 0.1) dt = 0.1;
    this.clock += dt;
    this.lift.update(dt);
    this.stepLoader(dt);
    this.place();
    this.writeCrates();
  }

  private stepLoader(dt: number): void {
    switch (this.state) {
      case 'wait':
        if (this.pending > 0 && this.lift.ready) {
          this.pending--;
          this.state = 'load';
          this.t = 0;
          this.carrying = true;
          this.carryScale = 0;
        }
        break;
      case 'load':
        this.t += dt;
        this.carryScale = ease(this.t / LOAD_TIME);
        if (this.t >= LOAD_TIME) this.state = 'turnOut';
        break;
      case 'turnOut':
        if (this.turn(WEST, dt)) {
          this.state = 'goOut';
          this.fromX = this.x;
        }
        break;
      case 'goOut':
        if (this.drive(this.stopX, dt)) {
          this.state = 'drop';
          this.t = 0;
          this.carryPoint(this.dropFrom);
          const s = this.fl.slots[this.lift.crates]!;
          this.dropTo.set(s.x, LIFT_TOP + CRATE / 2, s.z);
        }
        break;
      case 'drop':
        this.t += dt;
        if (this.t >= DROP_TIME) {
          this.carrying = false;
          this.lift.land();
          this.state = 'turnBack';
        }
        break;
      case 'turnBack':
        if (this.turn(EAST, dt)) {
          this.state = 'goBack';
          this.fromX = this.x;
        }
        break;
      case 'goBack':
        if (this.drive(this.fl.homeX, dt)) this.state = 'wait';
        break;
    }
  }

  private turn(target: number, dt: number): boolean {
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const step = TURN_RATE * dt;
    if (Math.abs(d) <= step) {
      this.yaw = target;
      return true;
    }
    this.yaw += Math.sign(d) * step;
    return false;
  }

  private drive(target: number, dt: number): boolean {
    const dir = Math.sign(target - this.x);
    const left = Math.abs(target - this.x);
    const done = Math.abs(this.x - this.fromX);
    const k = Math.min(1, 0.25 + Math.min(left, done) / 0.35);
    const step = this.spec.speed * k * dt;
    if (left <= step) {
      this.x = target;
      return true;
    }
    this.x += dir * step;
    return false;
  }

  private carryPoint(out: THREE.Vector3): THREE.Vector3 {
    const r = this.spec.reach;
    return out.set(this.x + Math.sin(this.yaw) * r, this.spec.carryY + this.spec.hover, this.fl.loaderZ + Math.cos(this.yaw) * r);
  }

  private place(): void {
    const L = this.loader;
    const moving = this.state === 'goOut' || this.state === 'goBack';
    const bob = this.spec.bob > 0 && !reducedMotion() ? Math.sin(this.clock * 3.2) * this.spec.bob : 0;
    L.position.set(this.x, this.spec.hover + bob, this.fl.loaderZ);
    L.rotation.y = this.yaw;
    // the cart rocks over the planks while it rolls
    L.rotation.z = moving && freightTier(this.era) === 0 ? Math.sin(this.x * 14) * 0.03 : 0;
    const sunk = this.lift.sunk;
    this.platform.position.y = LIFT_REST_Y - sunk;
  }

  private writeCrates(): void {
    const inst = this.crates;
    const sunk = this.lift.sunk;
    const n = this.lift.crates;
    this.quat.identity();
    this.scl.set(1, 1, 1);
    for (let i = 0; i < this.slotCount; i++) {
      if (i >= n) {
        this.scl.set(0, 0, 0);
        this.pos.set(0, -5, 0);
      } else {
        const s = this.fl.slots[i]!;
        this.pos.set(s.x, LIFT_TOP - sunk + CRATE / 2, s.z);
        this.scl.set(1, 1, 1);
      }
      this.m4.compose(this.pos, this.quat, this.scl);
      inst.setMatrixAt(i, this.m4);
    }
    // the carried crate (instance 4)
    if (this.carrying) {
      if (this.state === 'drop') {
        const k = ease(this.t / DROP_TIME);
        this.pos.lerpVectors(this.dropFrom, this.dropTo, k);
        this.pos.y += Math.sin(k * Math.PI) * 0.22;
      } else {
        this.carryPoint(this.pos);
      }
      this.eul.set(0, this.yaw, 0);
      this.quat.setFromEuler(this.eul);
      const cs = this.state === 'drop' ? 1 : this.carryScale;
      this.scl.set(cs, cs, cs);
    } else {
      this.scl.set(0, 0, 0);
      this.pos.set(0, -5, 0);
    }
    this.m4.compose(this.pos, this.quat, this.scl);
    inst.setMatrixAt(this.slotCount, this.m4);
    inst.instanceMatrix.needsUpdate = true;
  }
}
