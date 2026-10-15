/**
 * [B5 — commerce] Shared engine behind TricycleQueue and TruckQueue: a one-lane road queue of pooled
 * vehicles that arrive, load goods from a counter pile into their own cargo Pile, pay, and drive off.
 *
 * Every vehicle moves along a 1D travel coordinate `u` (increasing in the travel direction); subclasses
 * map `u` to a world pose. Smooth accelerate / brake (stopping distance v² / 2·decel), wheel spin from the
 * distance travelled, a bounce while riding and a brake/accelerate pitch.
 *
 * Entities (model + rider rig + cargo Pile + bubble canvas) are pooled per variant, so spawning is free
 * after warm-up and nothing leaks: on despawn the cargo is released to the item pool and the model is
 * detached.
 */
import * as THREE from 'three';
import type { DemandLevel, ProductId } from '../config';
import { approach, randRange } from '../core/math';
import { demandOf, salePrice } from '../core/demand';
import type { Buyer, GameContext, ItemKind } from '../core/types';
import { Pile } from '../items/Pile';
import { transferOne } from '../items/transfer';
import type { CharacterRig } from '../render/characters';
import { createSpeechBubble, type BubbleIcon, type SpeechBubble } from '../assets/shop';
import type { Counter } from '../stations/Counter';
import type { CashPile } from '../stations/CashPile';

export interface VehicleParts {
  root: THREE.Group;
  /** Everything except the wheels: bounces + pitches. */
  body: THREE.Group;
  wheels: THREE.Object3D[];
  wheelRadius: number;
  /** Rotation axis of the wheel pivots (`rotation.x` / `rotation.z`). */
  spinAxis: 'x' | 'z';
  /** Axis the body pitches about when braking / accelerating (nose down = positive). */
  pitchAxis: 'x' | 'z';
  /** Cargo pile parent (cargoPivot / bedPivot). */
  cargoParent: THREE.Object3D;
  bubbleY: number;
  rig: CharacterRig;
}

export interface VehicleQueueConfig {
  kind: ItemKind;
  buyer: Buyer;
  icon: BubbleIcon;
  /** What is sold (Sales upgrades) and its unit price (ECONOMY.*Price); the sale amount is
   *  salePrice(state, product, unitPrice, want), read at pay time. */
  product: ProductId;
  unitPrice: number;
  /** Live demand: spawn gap and order size for the current village level (read at spawn, never cached). */
  demand: (d: DemandLevel) => { gap: readonly [number, number]; want: readonly [number, number] };
  /** Hard cap for an order (the cargo holds this many). */
  maxWant: number;
  maxQueue: number;
  driveSpeed: number;
  spawnU: number;
  exitU: number;
  /** Travel coordinate where the i-th vehicle in line stops. */
  slotU: (index: number) => number;
  /** Seconds between two loaded units. */
  takeInterval: number;
  accel: number;
  decel: number;
  variants: number;
  /** Pile id prefix for cargo piles (e.g. 'npc:tricycle'). */
  idPrefix: string;
  cargoGrid: ConstructorParameters<typeof Pile>[1]['grid'];
  bubbleScale: number;
  /** Wave 8: divide the spawn gap by ctx.rush.spawnMult (read live at every spawn). Trikes only. */
  rushScaled?: boolean;
}

type Mode = 'queue' | 'paid' | 'leave';

export class Vehicle {
  readonly bubble: SpeechBubble;
  readonly cargo: Pile;
  mode: Mode = 'queue';
  u = 0;
  speed = 0;
  accelNow = 0;
  want = 0;
  atSlot = false;
  bubbleOn = false;
  bubbleTimer = 0;
  shown = -1;
  takeTimer = 0;
  timer = 0;
  bouncePhase = 0;
  pitch = 0;

  constructor(
    ctx: GameContext,
    readonly parts: VehicleParts,
    readonly variant: number,
    id: string,
    cfg: VehicleQueueConfig,
  ) {
    this.bubble = createSpeechBubble(cfg.bubbleScale);
    this.bubble.sprite.visible = false;
    this.bubble.sprite.position.set(0, parts.bubbleY, 0);
    parts.root.add(this.bubble.sprite);
    this.cargo = new Pile(ctx, {
      id,
      accepts: [cfg.kind],
      position: new THREE.Vector3(0, 0, 0),
      parent: parts.cargoParent,
      grid: cfg.cargoGrid,
    });
  }
}

const tmpV = new THREE.Vector3();

export abstract class VehicleQueue {
  /** Vehicles in line, front first (includes ones still driving in). */
  protected readonly queue: Vehicle[] = [];
  protected readonly leaving: Vehicle[] = [];
  private readonly pools: Vehicle[][];
  private spawnTimer = 1.5;
  private spawned = 0;

  constructor(
    readonly ctx: GameContext,
    protected readonly counter: Counter,
    protected readonly cash: CashPile,
    protected readonly cfg: VehicleQueueConfig,
  ) {
    this.pools = Array.from({ length: cfg.variants }, () => []);
  }

  /** Vehicles currently queued (including the one loading). */
  get waiting(): number {
    return this.queue.length;
  }

  /**
   * Goods sitting on queued, still UNPAID vehicles (landed or in flight): taken off the counter pile but not sold yet.
   * The save adds them back to the counter. Paid / leaving vehicles are excluded (already counted as sold).
   */
  get loadedUnits(): number {
    let n = 0;
    for (const v of this.queue) if (v.mode === 'queue') n += v.cargo.total;
    return n;
  }

  /** Subclass: build the model + rider for `variant` (rider already seated and attached). */
  protected abstract buildParts(variant: number): VehicleParts;
  /** Subclass: place the vehicle in the world for travel coordinate `v.u`. */
  protected abstract pose(v: Vehicle): void;
  /** Subclass: book-keeping + flavour when the order is paid. */
  protected abstract recordSale(v: Vehicle): void;

  update(dt: number): void {
    if (dt <= 0) return;
    this.spawnStep(dt);
    for (let i = 0; i < this.queue.length; i++) this.stepQueued(this.queue[i]!, i, dt);
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const v = this.leaving[i]!;
      this.stepLeaving(v, dt);
      if (v.u >= this.cfg.exitU) this.despawn(i);
    }
  }

  // --- spawning ---------------------------------------------------------------
  private spawnStep(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    if (this.queue.length >= this.cfg.maxQueue) {
      this.spawnTimer = 0.5;
      return;
    }
    const dm = this.cfg.demand(demandOf(this.ctx.state));
    this.spawnTimer = randRange(dm.gap[0], dm.gap[1]) / (this.cfg.rushScaled ? this.ctx.rush.spawnMult : 1);
    const variant = this.spawned++ % this.cfg.variants;
    let v = this.pools[variant]!.pop();
    if (!v) v = new Vehicle(this.ctx, this.buildParts(variant), variant, `${this.cfg.idPrefix}:${this.spawned}`, this.cfg);
    v.mode = 'queue';
    v.u = this.cfg.spawnU;
    v.speed = this.cfg.driveSpeed * 0.8;
    v.accelNow = 0;
    v.want = Math.min(this.cfg.maxWant, Math.round(randRange(dm.want[0] - 0.49, dm.want[1] + 0.49)));
    v.atSlot = false;
    v.bubbleOn = false;
    v.bubbleTimer = 0;
    v.shown = -1;
    v.takeTimer = 0;
    v.timer = 0;
    v.pitch = 0;
    v.bubble.sprite.visible = false;
    v.parts.rig.setSeated(true);
    v.parts.root.visible = true;
    this.ctx.scene.add(v.parts.root);
    this.pose(v);
    this.queue.push(v);
  }

  private despawn(index: number): void {
    const v = this.leaving[index]!;
    this.leaving.splice(index, 1);
    v.cargo.clear();
    this.ctx.tweens.killTweensOf(v.bubble.sprite);
    v.bubble.sprite.visible = false;
    v.parts.root.removeFromParent();
    v.parts.root.visible = false;
    this.pools[v.variant]!.push(v);
  }

  // --- driving ----------------------------------------------------------------
  /** Drive toward `target` (smooth accel + brake). Returns true while stopped on it. */
  private driveTo(v: Vehicle, target: number, dt: number): boolean {
    const cfg = this.cfg;
    const dist = target - v.u;
    const prev = v.speed;
    if (dist <= 0.01 && v.speed < 0.2) {
      v.u = target;
      v.speed = 0;
      v.accelNow = -prev / dt;
      return true;
    }
    const vmax = Math.min(cfg.driveSpeed, Math.sqrt(2 * cfg.decel * Math.max(0, dist)) + 0.35);
    v.speed = approach(v.speed, vmax, (v.speed > vmax ? cfg.decel : cfg.accel) * dt);
    const step = v.speed * dt;
    if (step >= dist) {
      v.u = target;
      v.speed = 0;
      v.accelNow = -prev / dt;
      return true;
    }
    v.u += step;
    v.accelNow = (v.speed - prev) / dt;
    return false;
  }

  private stepQueued(v: Vehicle, index: number, dt: number): void {
    v.atSlot = this.driveTo(v, this.cfg.slotU(index), dt);
    this.animate(v, dt);
    if (index !== 0 || !v.atSlot) return;
    if (v.mode === 'queue') this.serve(v, dt);
    else if (v.mode === 'paid') {
      v.timer -= dt;
      if (v.timer <= 0) this.sendAway(v);
    }
  }

  private serve(v: Vehicle, dt: number): void {
    const cfg = this.cfg;
    if (!v.bubbleOn) {
      v.bubbleOn = true;
      v.shown = -1;
      v.bubble.sprite.visible = true;
      this.ctx.tweens.popIn(v.bubble.sprite);
    }
    const have = v.cargo.count(cfg.kind);
    if (have !== v.shown) {
      v.shown = have;
      v.bubble.show(cfg.icon, `${have}/${v.want}`);
    }
    v.takeTimer -= dt;
    if (v.takeTimer <= 0 && v.cargo.total < v.want && this.counter.pile.count(cfg.kind) > 0) {
      v.takeTimer = cfg.takeInterval;
      transferOne(this.ctx, this.counter.pile, v.cargo, [cfg.kind], { duration: 0.28, arcHeight: 1.7 });
    }
    if (have >= v.want) this.pay(v);
  }

  private pay(v: Vehicle): void {
    const amount = salePrice(this.ctx.state, this.cfg.product, this.cfg.unitPrice, v.want);
    v.cargo.root.getWorldPosition(tmpV);
    tmpV.y += 0.7;
    this.cash.pay(amount, tmpV);
    this.recordSale(v);
    this.ctx.events.emit('sale', {
      buyer: this.cfg.buyer,
      kind: this.cfg.kind,
      count: v.want,
      amount,
      position: tmpV,
    });
    v.mode = 'paid';
    v.timer = 0.75;
    v.parts.rig.cheer();
    v.bubble.show('check');
    this.ctx.tweens.popIn(v.bubble.sprite, { duration: 0.35 });
  }

  private sendAway(v: Vehicle): void {
    const i = this.queue.indexOf(v);
    if (i >= 0) this.queue.splice(i, 1);
    this.leaving.push(v);
    v.mode = 'leave';
    v.bubbleTimer = 1.0;
    v.parts.cargoParent.getWorldPosition(tmpV);
    this.ctx.particles.puff(tmpV, { color: 0xffffff, count: 3, size: 0.45, life: 0.8 });
  }

  private stepLeaving(v: Vehicle, dt: number): void {
    const prev = v.speed;
    v.speed = approach(v.speed, this.cfg.driveSpeed * 1.15, this.cfg.accel * dt);
    v.accelNow = (v.speed - prev) / dt;
    v.u += v.speed * dt;
    if (v.bubbleOn) {
      v.bubbleTimer -= dt;
      if (v.bubbleTimer <= 0) {
        v.bubbleOn = false;
        this.ctx.tweens.popOut(v.bubble.sprite, { duration: 0.25 });
      }
    }
    this.animate(v, dt);
  }

  /** Pose + wheels + bounce + pitch + rider animation. */
  private animate(v: Vehicle, dt: number): void {
    const p = v.parts;
    this.pose(v);
    const spin = (v.speed * dt) / p.wheelRadius;
    for (let i = 0; i < p.wheels.length; i++) {
      if (p.spinAxis === 'x') p.wheels[i]!.rotation.x += spin;
      else p.wheels[i]!.rotation.z += spin;
    }
    const moving = Math.min(1, v.speed / (this.cfg.driveSpeed * 0.5));
    v.bouncePhase += v.speed * dt * 5.2;
    p.body.position.y = Math.abs(Math.sin(v.bouncePhase)) * 0.045 * moving;
    const targetPitch = Math.max(-0.05, Math.min(0.05, -v.accelNow * 0.006));
    v.pitch += (targetPitch - v.pitch) * Math.min(1, dt * 8);
    if (p.pitchAxis === 'x') p.body.rotation.x = v.pitch;
    else p.body.rotation.z = v.pitch;
    p.rig.animate(dt, 0);
    if (v.bubble.sprite.visible) {
      v.bubble.sprite.position.y = p.bubbleY + Math.sin((this.ctx.time.elapsed + v.u) * 4.5) * 0.04;
    }
  }
}

