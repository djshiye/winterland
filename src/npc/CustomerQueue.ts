/**
 * [B5 — commerce] Walk-in customers queueing at the walk-in counter.
 *
 * Spec: "Queued blue NPCs show a speech bubble requesting wood. They take [wood] from the counter, leave
 * Green Cash Bundles in a neat 3D grid pile right next to the counter, and walk away while the queue
 * advances."
 *
 * - Customers are built ONLY with createCharacterRig('customer', variant) and its public API; the speech
 *   bubble comes from assets/shop.ts (plank icon + "n/want" while first in line, a green check when done).
 * - Up to demand.customerQueue customers (core/demand.ts, read live); spawned every demand.customerGap seconds at `spawn`, they walk to the first
 *   free queue slot (slot i = front + i·spacing along +Z) and shuffle forward as slots free up.
 * - The customer at slot 0 pulls PLANK BUNDLES from the counter pile into its own CarryStack (anchor =
 *   rig.armsAnchor) one every TIMING.npcTakeInterval; when it holds `want` planks it pays
 *   want · plankPrice into the cash pile, emits 'sale', cheers, shows the check and walks the exit path
 *   carrying the planks; at the end of the path everything is released and the entity returns to a pool.
 * - Entities (rig + carry stack + bubble canvas) are pooled: nothing is created per customer after warm-up.
 */
import * as THREE from 'three';
import { ECONOMY, LAYOUT, PLAYER, TIMING } from '../config';
import { approach, dampAngle, randInt, randRange, yawFromDir } from '../core/math';
import { demandOf, salePrice } from '../core/demand';
import type { GameContext } from '../core/types';
import { CarryStack } from '../items/CarryStack';
import { transferOne } from '../items/transfer';
import { createCharacterRig, type CharacterRig } from '../render/characters';
import { createSpeechBubble, type SpeechBubble } from '../assets/shop';
import type { Counter } from '../stations/Counter';
import type { CashPile } from '../stations/CashPile';

export interface CustomerQueueOptions {
  counter: Counter;
  cash: CashPile;
}

type Mode = 'queue' | 'paid' | 'exit';

/** Seconds a happy customer lingers (cheering) at the counter before leaving. */
const CHEER_TIME = 0.7;
/** Seconds the check bubble stays up after the customer starts walking away. */
const CHECK_HOLD = 1.0;
const ACCEL = 14;
const TURN_LAMBDA = 14;
const BOB_RATE = 4.5;
const VARIANTS = 4;

const tmpV = new THREE.Vector3();

/** One pooled customer (model + hands + bubble). */
class Customer {
  readonly group = new THREE.Group();
  readonly rig: CharacterRig;
  readonly stack: CarryStack;
  readonly bubble: SpeechBubble;
  readonly baseScale: number;
  readonly bubbleY: number;
  readonly velocity = new THREE.Vector3();

  mode: Mode = 'queue';
  atSlot = false;
  want = 3;
  speed = 0;
  yaw = Math.PI;
  waypoint = 0;
  takeTimer = 0;
  timer = 0;
  bubbleTimer = 0;
  bubbleBase = 0;
  bubbleOn = false;
  shown = -1;
  bob = 0;
  paid = false;

  constructor(ctx: GameContext, n: number, variant: number) {
    this.rig = createCharacterRig('customer', variant);
    this.baseScale = this.rig.root.scale.x;
    this.group.add(this.rig.root);
    this.bubble = createSpeechBubble(1.05);
    this.bubble.sprite.visible = false;
    this.group.add(this.bubble.sprite);
    this.group.visible = false;
    this.bubbleY = this.rig.height + 0.4;
    this.stack = new CarryStack(ctx, { id: `npc:customer:${n}`, accepts: ['plank'], capacity: 8, anchor: this.rig.armsAnchor });
  }
}

export class CustomerQueue {
  /** Customers in line, front first (includes those still walking in). */
  private readonly queue: Customer[] = [];
  /** Customers walking away. */
  private readonly leaving: Customer[] = [];
  private readonly pool: Customer[] = [];
  private created = 0;
  private spawnTimer = 0.6;

  constructor(
    readonly ctx: GameContext,
    readonly opts: CustomerQueueOptions,
  ) {}

  /** Customers currently queued (including the one being served). */
  get waiting(): number {
    return this.queue.length;
  }

  /** True while the front customer stands at the counter wanting planks. */
  get frontWaiting(): boolean {
    const c = this.queue[0];
    return !!c && c.mode === 'queue' && c.atSlot;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.spawnStep(dt);
    for (let i = 0; i < this.queue.length; i++) this.stepQueued(this.queue[i]!, i, dt);
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      if (this.stepLeaving(this.leaving[i]!, dt)) this.despawn(this.leaving, i);
    }
  }

  // --- spawning -------------------------------------------------------------
  private spawnStep(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const dm = demandOf(this.ctx.state);
    if (this.queue.length >= dm.customerQueue || this.ctx.state.phase === 'intro') {
      this.spawnTimer = 0.25;
      return;
    }
    this.spawnTimer = randRange(dm.customerGap[0], dm.customerGap[1]);
    this.spawn(dm.customerWant);
  }

  private spawn(want: readonly [number, number]): void {
    let c = this.pool.pop();
    if (!c) {
      c = new Customer(this.ctx, this.created, this.created % VARIANTS);
      this.created++;
    }
    const f = randRange(0.94, 1.06);
    c.rig.root.scale.setScalar(c.baseScale * f);
    c.bubbleBase = c.bubbleY * f;
    c.bubble.sprite.position.set(0, c.bubbleBase, 0);
    c.want = randInt(want[0], want[1]);
    c.stack.setCapacity(c.want + 1); // never "full": no MAX badge over a happy customer
    c.mode = 'queue';
    c.atSlot = false;
    c.speed = 0;
    c.yaw = Math.PI;
    c.waypoint = 0;
    c.takeTimer = 0;
    c.timer = 0;
    c.bubbleOn = false;
    c.shown = -1;
    c.paid = false;
    c.bob = Math.random() * 6;
    c.velocity.set(0, 0, 0);
    c.rig.setCarrying(false);
    c.rig.setSeated(false);
    c.bubble.sprite.visible = false;
    const sp = LAYOUT.customers.spawn;
    c.group.position.set(sp.x + randRange(-0.15, 0.15), 0, sp.z);
    c.group.rotation.y = 0;
    c.rig.root.rotation.y = Math.PI;
    c.group.visible = true;
    this.ctx.scene.add(c.group);
    this.queue.push(c);
  }

  private despawn(list: Customer[], index: number): void {
    const c = list[index]!;
    list.splice(index, 1);
    c.stack.clear();
    this.ctx.tweens.killTweensOf(c.bubble.sprite);
    c.bubble.sprite.visible = false;
    c.group.removeFromParent();
    c.group.visible = false;
    c.rig.setCarrying(false);
    this.pool.push(c);
  }

  // --- queue ----------------------------------------------------------------
  private stepQueued(c: Customer, index: number, dt: number): void {
    const L = LAYOUT.customers;
    const arrived = this.moveToward(c, L.front.x, L.front.z + index * L.spacing, dt, false);
    this.faceStep(c, arrived ? Math.PI : null, dt);
    this.animate(c, dt);
    c.atSlot = arrived;
    if (index !== 0 || !arrived) return;
    if (c.mode === 'queue') this.serve(c, dt);
    else if (c.mode === 'paid') {
      c.timer -= dt;
      if (c.timer <= 0) this.sendAway(c);
    }
  }

  /** The front customer takes planks and pays. */
  private serve(c: Customer, dt: number): void {
    const counter = this.opts.counter;
    if (!c.bubbleOn) {
      c.bubbleOn = true;
      c.shown = -1;
      c.bubble.sprite.visible = true;
      this.ctx.tweens.popIn(c.bubble.sprite);
    }
    const have = c.stack.count();
    if (have !== c.shown) {
      c.shown = have;
      c.bubble.show('plank', `${have}/${c.want}`);
    }

    c.takeTimer -= dt;
    if (c.takeTimer <= 0 && c.stack.size < c.want && counter.pile.count(counter.displayKind) > 0) {
      c.takeTimer = TIMING.npcTakeInterval;
      if (transferOne(this.ctx, counter.pile, c.stack, [counter.displayKind])) c.rig.setCarrying(true);
    }

    if (c.stack.count() >= c.want) this.pay(c);
  }

  private pay(c: Customer): void {
    const amount = salePrice(this.ctx.state, 'plank', ECONOMY.plankPrice, c.want);
    c.rig.armsAnchor.getWorldPosition(tmpV);
    tmpV.y += 0.2;
    this.opts.cash.pay(amount, tmpV);
    const stats = this.ctx.state.stats;
    stats.planksSold += c.want;
    stats.customersServed++;
    this.ctx.events.emit('sale', {
      buyer: 'customer',
      kind: this.opts.counter.displayKind,
      count: c.want,
      amount,
      position: tmpV,
    });
    c.paid = true;
    c.mode = 'paid';
    c.timer = CHEER_TIME;
    c.rig.cheer();
    c.bubble.show('check');
    this.ctx.tweens.popIn(c.bubble.sprite, { duration: 0.35 });
  }

  private sendAway(c: Customer): void {
    const i = this.queue.indexOf(c);
    if (i >= 0) this.queue.splice(i, 1);
    this.leaving.push(c);
    c.mode = 'exit';
    c.waypoint = 0;
    c.bubbleTimer = CHECK_HOLD;
  }

  // --- leaving --------------------------------------------------------------
  /** Returns true when the customer reached the end of the exit path. */
  private stepLeaving(c: Customer, dt: number): boolean {
    const path = LAYOUT.customers.exitPath;
    const wp = path[c.waypoint]!;
    const arrived = this.moveToward(c, wp.x, wp.z, dt, true);
    this.faceStep(c, null, dt);
    this.animate(c, dt);
    if (c.bubbleOn) {
      c.bubbleTimer -= dt;
      if (c.bubbleTimer <= 0) {
        c.bubbleOn = false;
        this.ctx.tweens.popOut(c.bubble.sprite, { duration: 0.25 });
      }
    }
    if (arrived) {
      c.waypoint++;
      if (c.waypoint >= path.length) return true;
    }
    return false;
  }

  // --- movement -------------------------------------------------------------
  /**
   * Kinematic walk toward (tx, tz); returns true once there. With `passThrough` the walker keeps full
   * speed and "arrives" as soon as it reaches the point; otherwise it eases in and stops exactly on it.
   */
  private moveToward(c: Customer, tx: number, tz: number, dt: number, passThrough: boolean): boolean {
    const p = c.group.position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    const max = LAYOUT.customers.walkSpeed;
    if (dist < 0.02) {
      p.x = tx;
      p.z = tz;
      c.speed = passThrough ? c.speed : 0;
      c.velocity.set(0, 0, 0);
      return true;
    }
    const target = passThrough ? max : Math.min(max, 1.2 + dist * 4);
    c.speed = approach(c.speed, target, ACCEL * dt);
    const step = c.speed * dt;
    const nx = dx / dist;
    const nz = dz / dist;
    c.yaw = dampAngle(c.yaw, yawFromDir(dx, dz), TURN_LAMBDA, dt);
    if (step >= dist) {
      p.x = tx;
      p.z = tz;
      c.velocity.set(nx * c.speed, 0, nz * c.speed);
      if (!passThrough) c.speed = 0;
      return true;
    }
    p.x += nx * step;
    p.z += nz * step;
    c.velocity.set(nx * c.speed, 0, nz * c.speed);
    return false;
  }

  /** Face `yaw` when stopped (e.g. the counter), otherwise keep the travel heading. */
  private faceStep(c: Customer, stopYaw: number | null, dt: number): void {
    if (stopYaw !== null) c.yaw = dampAngle(c.yaw, stopYaw, TURN_LAMBDA, dt);
    c.rig.root.rotation.y = c.yaw;
  }

  private animate(c: Customer, dt: number): void {
    c.rig.animate(dt, c.speed / PLAYER.speed);
    c.stack.update(dt, c.velocity);
    if (c.bubble.sprite.visible) {
      c.bubble.sprite.position.y = c.bubbleBase + Math.sin((this.ctx.time.elapsed + c.bob) * BOB_RATE) * 0.04;
    }
  }
}
