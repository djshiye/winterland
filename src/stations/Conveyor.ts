/**
 * [B6 — machines] Phase 4: roller conveyor that carries items from one holder to another.
 *
 * Spec: "West Conveyor: Builds a conveyor belt directly from the Raw Log Drop Zone to the Walk-in
 * Customer Counter. Logs now flow automatically to walk-in customers, generating passive cash piles."
 * "East Conveyor: Builds a conveyor belt from the Raw Log Drop Zone directly into the Wood Processing
 * Machine, fully automating crate production."
 *
 * Model: assets/machines.ts createRollerConveyor — steel side rails on legs, closely spaced dark grey
 * rollers (one InstancedMesh, spinning at belt speed), a blue drive motor. NO collider (walkable).
 *
 * Mechanics: the conveyor is itself an ItemHolder (id opts.id).
 * - Items ride a waypoint spline (BeltPath: polyline through `path` with rounded corners). `s` is the
 *   arclength; items move at `speed`, keep `spacing` to the item ahead and queue at the end when `to`
 *   refuses.
 * - Loading: when nothing is in flight to the belt, the last item is ≥ spacing past the start, the belt
 *   is not saturated and `to` can take more (or fewer than a few logs are queued), one item is pulled
 *   from `from` with transferOne(ctx, from, this, [kind]) (a short hop onto the belt start).
 * - Unloading: the lead item at the end of the belt is handed over with transferOne(ctx, this, to, [kind])
 *   as soon as `to.canAccept(kind)`.
 * - ItemHolder deviations (belt semantics): count(kind) only reports the lead item once it has reached
 *   the exit (so transferOne never yanks things off mid-belt) and take(kind) returns that lead (oldest)
 *   item rather than the most recently landed one. `load` counts everything on / heading to the belt.
 * - Logs lie across the belt at `itemYaw` (relative turning follows the path) and roll while they ride.
 * - build(): the segments pop in one after another from start to end (staggered back-out scale), then
 *   emit 'built' { what: opts.id, position: midpoint, object }. Inactive and invisible before build().
 */
import * as THREE from 'three';
import { ITEM_SIZE, type XZ } from '../config';
import { createRollerConveyor, type RollerConveyorModel } from '../assets/machines';
import { UP } from '../core/math';
import { Ease } from '../core/Tween';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';
import { transferOne } from '../items/transfer';
import { BeltPath } from './beltPath';

export interface ConveyorOptions {
  /** Holder id, e.g. 'conveyor:west'. */
  id: string;
  path: readonly XZ[];
  width: number;
  beltY: number;
  speed: number;
  spacing: number;
  from: ItemHolder;
  to: ItemHolder;
  kind: ItemKind;
  /** Yaw of items riding the belt (0 = log axis along world X). */
  itemYaw: number;
}

interface BeltItem {
  item: Item;
  /** Arclength from the belt start. */
  s: number;
}

class BeltSlot implements Slot {
  constructor(readonly holder: ItemHolder) {}
}

/** Seconds between the pop-in of consecutive segments, and the pop duration. */
const POP_STAGGER = 0.12;
const POP_TIME = 0.4;
/** Hop durations onto / off the belt. */
const LOAD_FLIGHT = { duration: 0.18, arcHeight: 0.55 } as const;
const UNLOAD_FLIGHT = { duration: 0.2, arcHeight: 0.5 } as const;

export class Conveyor implements ItemHolder {
  readonly id: string;
  readonly object = new THREE.Group();
  readonly model: RollerConveyorModel;
  readonly path: BeltPath;

  private active = false;
  private built = false;
  private buildT = 0;
  private readonly items: BeltItem[] = [];
  private pending = 0;
  private spin = 0;
  private spinRate = 0;
  private dead = false;
  private spillTo: ((item: Item) => void) | null = null;
  private readonly maxOnBelt: number;
  private readonly segScale: Float32Array;
  private readonly sample = BeltPath.makeSample();
  private readonly yaw0: number;
  private readonly qYaw = new THREE.Quaternion();
  private readonly qRoll = new THREE.Quaternion();
  private readonly axisX = new THREE.Vector3(1, 0, 0);
  private readonly itemY: number;

  constructor(
    readonly ctx: GameContext,
    readonly opts: ConveyorOptions,
  ) {
    this.id = opts.id;
    this.model = createRollerConveyor(opts.path, opts.width, opts.beltY);
    this.path = this.model.path;
    this.object.add(this.model.root);
    this.object.visible = false;
    ctx.scene.add(this.object);
    this.maxOnBelt = Math.max(1, Math.floor(this.path.length / opts.spacing));
    this.segScale = new Float32Array(this.model.segments.length);
    this.yaw0 = this.path.sample(0, this.sample).yaw;
    this.itemY = opts.beltY + ITEM_SIZE[opts.kind].stackHeight / 2;
  }

  /** Items currently riding the belt (or in the air heading for its start). */
  get load(): number {
    return this.items.length + this.pending;
  }

  /** Belt length along the spline. */
  get length(): number {
    return this.path.length;
  }

  /** instant (restoring a save): final state at once — no animation, no 'built' event, no sound. */
  build(instant = false): void {
    if (this.active) return;
    this.active = true;
    this.buildT = 0;
    this.object.visible = true;
    if (instant) {
      this.buildT = this.segScale.length * POP_STAGGER + POP_TIME;
      this.applyBuild();
      this.built = true;
      this.model.finalize();
      return;
    }
    this.applyBuild();
  }

  // --- ItemHolder -------------------------------------------------------------
  canAccept(kind: ItemKind): boolean {
    if (!this.active || kind !== this.opts.kind) return false;
    if (this.pending > 0 || this.items.length + this.pending >= this.maxOnBelt) return false;
    const last = this.items[this.items.length - 1];
    return !last || last.s >= this.opts.spacing - 1e-4;
  }

  reserve(_item: Item): Slot {
    this.pending++;
    return new BeltSlot(this);
  }

  getSlotWorldPosition(_slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    this.path.sample(0, this.sample);
    return out.set(this.sample.x, this.itemY, this.sample.z);
  }

  getSlotWorldQuaternion(_slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return out.setFromAxisAngle(UP, this.opts.itemYaw);
  }

  receive(item: Item, _slot: Slot): void {
    this.pending = Math.max(0, this.pending - 1);
    if (this.dead) {
      this.spill(item);
      return;
    }
    const b: BeltItem = { item, s: 0 };
    this.items.push(b);
    if (item.object.parent !== this.ctx.scene) this.ctx.scene.add(item.object);
    item.object.visible = true;
    this.place(b);
  }

  cancel(_slot: Slot): void {
    this.pending = Math.max(0, this.pending - 1);
  }

  count(kind?: ItemKind): number {
    const head = this.items[0];
    if (!head || (kind !== undefined && head.item.kind !== kind)) return 0;
    return head.s >= this.path.length - 0.02 ? 1 : 0;
  }

  take(kind?: ItemKind): Item | null {
    const head = this.items[0];
    if (!head || (kind !== undefined && head.item.kind !== kind)) return null;
    if (head.s < this.path.length - 0.02) return null; // only items that reached the exit leave the belt
    this.items.shift();
    if (head.item.object.parent !== this.ctx.scene) this.ctx.scene.attach(head.item.object);
    return head.item;
  }

  /** Items riding the belt (landed on it, not in the air), by kind (saves count them). */
  riding(kind: ItemKind): number {
    let n = 0;
    for (const b of this.items) if (b.item.kind === kind) n++;
    return n;
  }

  /**
   * 0.9.5 (era belts come and go with their machines): remove the belt for good. Riding items, and the ones still flying
   * onto it, go to `spill` (never lost; default: back to the pool).
   */
  dispose(spill?: (item: Item) => void): void {
    if (this.dead) return;
    this.dead = true;
    this.active = false;
    this.spillTo = spill ?? null;
    for (const b of this.items) {
      this.ctx.tweens.killTweensOf(b.item.object);
      this.spill(b.item);
    }
    this.items.length = 0;
    this.object.removeFromParent();
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).dispose();
      else if (m.isMesh) m.geometry.dispose();
    });
  }

  get disposed(): boolean {
    return this.dead;
  }

  private spill(item: Item): void {
    if (this.spillTo) this.spillTo(item);
    else this.ctx.items.release(item);
  }

  // --- simulation ---------------------------------------------------------------
  update(dt: number): void {
    if (!this.active) return;
    const o = this.opts;
    if (!this.built) {
      this.buildT += dt;
      this.applyBuild();
      if (this.buildT >= (this.segScale.length - 1) * POP_STAGGER + POP_TIME) {
        this.built = true;
        this.model.finalize();
        const p = this.path.sample(this.path.length / 2, this.sample);
        this.ctx.events.emit('built', {
          what: o.id,
          position: new THREE.Vector3(p.x, 0, p.z),
          object: this.object,
        });
      }
      return;
    }

    // ride + queue
    const L = this.path.length;
    const step = o.speed * dt;
    let moving = false;
    for (let i = 0; i < this.items.length; i++) {
      const b = this.items[i]!;
      const limit = i === 0 ? L : this.items[i - 1]!.s - o.spacing;
      const next = Math.min(b.s + step, limit);
      if (next > b.s + 1e-6) {
        b.s = next;
        moving = true;
      }
      this.place(b);
    }

    // hand over the lead item
    const head = this.items[0];
    if (head && head.s >= L - 0.02 && o.to.canAccept(o.kind)) {
      transferOne(this.ctx, this, o.to, [o.kind], UNLOAD_FLIGHT);
    }

    // pull the next item from the source
    if (this.canAccept(o.kind) && (o.to.canAccept(o.kind) || this.items.length < 3) && o.from.count(o.kind) > 0) {
      transferOne(this.ctx, o.from, this, [o.kind], LOAD_FLIGHT);
    }

    // rollers: spin at belt speed while anything moves, idle slowly otherwise
    const target = moving || this.pending > 0 ? o.speed / this.model.rollerRadius : (o.speed / this.model.rollerRadius) * 0.25;
    this.spinRate += (target - this.spinRate) * Math.min(1, dt * 6);
    this.spin += this.spinRate * dt;
    this.model.setRollers(this.spin);
  }

  // ---------------------------------------------------------------------------

  /** Pop the segments in sequence (also drives the roller scale). */
  private applyBuild(): void {
    const segs = this.model.segments;
    for (let i = 0; i < segs.length; i++) {
      const raw = Math.min(1, Math.max(0, (this.buildT - i * POP_STAGGER) / POP_TIME));
      const k = raw <= 0 ? 0.0001 : Ease.backOut(raw);
      this.segScale[i] = k;
      segs[i]!.scale.setScalar(Math.max(0.0001, k));
    }
    this.model.setRollers(this.spin, this.segScale);
  }

  /** Position + orientation of a riding item. */
  private place(b: BeltItem): void {
    const p = this.path.sample(b.s, this.sample);
    const o = b.item.object;
    o.position.set(p.x, this.itemY, p.z);
    this.qYaw.setFromAxisAngle(UP, this.opts.itemYaw + (p.yaw - this.yaw0));
    if (b.item.kind === 'log') {
      this.qRoll.setFromAxisAngle(this.axisX, b.s / ITEM_SIZE.log.radius);
      o.quaternion.copy(this.qYaw).multiply(this.qRoll);
    } else {
      o.quaternion.copy(this.qYaw);
    }
  }
}
