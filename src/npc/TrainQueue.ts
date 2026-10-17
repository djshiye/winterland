/**
 * [B5 — commerce] Freight trains on Timber Ridge: a toy locomotive + three flatcars (assets/train.ts) run along the
 * rail (LAYOUT.ridge.rail, +Z), stop with the flatcars beside the platform (stopZ), load pine logs from the
 * platform counter one by one (items/transfer.ts: the logs visibly fly onto the flatcars), pay
 * salePrice(state, 'pine', ECONOMY.pinePrice, want) into the platform cash pile, emit 'sale' {buyer: 'train',
 * kind: 'log'}, honk and back out into the tunnel (0.9.9: the line is a terminus, LAYOUT.ridge.rail.endZ). stats.logsSold
 * counts the logs.
 *
 * - Demand (trainGap between trains, trainWant for the order) is read live from DEMAND at spawn, never cached.
 * - One train at a time. With an empty counter the train waits patiently (bubble "n/want").
 * - Built when the ridge opens (Level), instantly on restore; nothing in the world until the first spawn.
 * - A loaded-but-unpaid train holds logs that no pile counts; `loadedLogs` reports them so the save can keep them.
 */
import * as THREE from 'three';
import { ECONOMY, LAYOUT, TIMING } from '../config';
import { approach, randRange } from '../core/math';
import { demandOf, salePrice } from '../core/demand';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';
import { transferOne } from '../items/transfer';
import { createSpeechBubble, type SpeechBubble } from '../assets/shop';
import { createTrain, TRAIN_AXLE_RADIUS, TRAIN_CARGO_CAPACITY, type TrainModel } from '../assets/train';
import type { CashPile } from '../stations/CashPile';
import type { Counter } from '../stations/Counter';

export interface TrainQueueOptions {
  counter: Counter;
  cash: CashPile;
}

const DRIVE_SPEED = 14;
const ACCEL = 5;
const DECEL = 7;
/** Seconds the first train takes to show up after the ridge opens. */
const FIRST_TRAIN_DELAY = 3;
const PAID_HOLD = 0.5; // 0.9.3: was 0.9

type Mode = 'idle' | 'arrive' | 'load' | 'paid' | 'leave';

/** The flatcars' log bed as an ItemHolder: landed logs become instances of the cargo mesh. */
class TrainCargo implements ItemHolder {
  readonly id = 'npc:train:cargo';
  /** Order size of the current train (0 = no train loading). */
  limit = 0;
  private reserved = 0;
  private landed = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly ctx: GameContext,
    private readonly model: TrainModel,
  ) {}

  /** Logs on board or still in flight. */
  get total(): number {
    return this.reserved;
  }

  reset(limit: number): void {
    this.limit = limit;
    this.reserved = 0;
    this.landed = 0;
    this.model.cargo.count = 0;
  }

  canAccept(kind: ItemKind): boolean {
    return kind === 'log' && this.reserved < Math.min(this.limit, TRAIN_CARGO_CAPACITY);
  }

  reserve(_item: Item): Slot {
    return { holder: this, index: this.reserved++ } as Slot;
  }

  getSlotWorldPosition(slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    this.model.root.updateMatrixWorld();
    this.model.slotLocal((slot as Slot & { index: number }).index, this.tmp);
    return this.model.root.localToWorld(out.copy(this.tmp));
  }

  getSlotWorldQuaternion(_slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return this.model.root.getWorldQuaternion(out);
  }

  receive(item: Item, _slot: Slot): void {
    this.ctx.items.release(item);
    this.landed++;
    this.model.cargo.count = Math.min(this.landed, TRAIN_CARGO_CAPACITY);
  }

  cancel(_slot: Slot): void {
    this.reserved = Math.max(0, this.reserved - 1);
  }

  count(kind?: ItemKind): number {
    return kind === undefined || kind === 'log' ? this.landed : 0;
  }

  take(_kind?: ItemKind): Item | null {
    return null;
  }
}

const tmpV = new THREE.Vector3();

export class TrainQueue {
  private mode: Mode = 'idle';
  private timer = FIRST_TRAIN_DELAY;
  private z = 0;
  private speed = 0;
  private accelNow = 0;
  private want = 0;
  private takeTimer = 0;
  private holdTimer = 0;
  private bubbleOn = false;
  private shown = -1;
  private smokeTimer = 0;
  private bouncePhase = 0;
  private pitch = 0;
  private model: TrainModel | null = null;
  private cargo: TrainCargo | null = null;
  private bubble: SpeechBubble | null = null;

  constructor(
    readonly ctx: GameContext,
    readonly opts: TrainQueueOptions,
  ) {}

  /** True while a train is in the world. */
  get active(): boolean {
    return this.mode !== 'idle';
  }

  /** True while the train is stopped at the platform wanting logs. */
  get loading(): boolean {
    return this.mode === 'load';
  }

  /**
   * True while the train may be inside a dog sled row. 0.9.9: never: the line ends at its buffer stop north of the sled
   * trail and the trains back out north, so SledQueue's crossing guard always finds the rail clear.
   */
  get sweeping(): boolean {
    return false;
  }

  /** Logs sitting on the train (landed or in flight, not yet paid; 'paid' is excluded because the sale already landed in the cash pile). The save adds them to the platform pile. */
  get loadedLogs(): number {
    return this.mode === 'load' ? (this.cargo?.total ?? 0) : 0;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    switch (this.mode) {
      case 'idle':
        this.timer -= dt;
        if (this.timer <= 0) this.spawn();
        return;
      case 'arrive':
        if (this.driveTo(LAYOUT.ridge.rail.stopZ, dt)) this.arrived();
        break;
      case 'load':
        this.load(dt);
        break;
      case 'paid':
        this.holdTimer -= dt;
        this.driveTo(LAYOUT.ridge.rail.stopZ, dt); // keeps the speed at zero
        if (this.holdTimer <= 0) this.mode = 'leave';
        break;
      case 'leave': {
        const prev = this.speed;
        this.speed = approach(this.speed, DRIVE_SPEED * 1.2, ACCEL * 1.3 * dt);
        this.accelNow = (this.speed - prev) / dt;
        this.z -= this.speed * dt; // backs out into the tunnel
        if (this.z <= LAYOUT.ridge.rail.spawnZ) {
          this.despawn();
          return;
        }
        break;
      }
    }
    this.animate(dt);
  }

  // --- life cycle ----------------------------------------------------------------------------
  private spawn(): void {
    if (!this.model) {
      this.model = createTrain();
      this.cargo = new TrainCargo(this.ctx, this.model);
      this.bubble = createSpeechBubble(1.5);
      this.bubble.sprite.visible = false;
      this.bubble.sprite.position.set(0, this.model.bubbleY, 0);
      this.model.root.add(this.bubble.sprite);
    }
    const dm = demandOf(this.ctx.state);
    this.want = Math.min(TRAIN_CARGO_CAPACITY, Math.round(randRange(dm.trainWant[0] - 0.49, dm.trainWant[1] + 0.49)));
    this.cargo!.reset(this.want);
    this.z = LAYOUT.ridge.rail.spawnZ;
    this.speed = DRIVE_SPEED * 0.8;
    this.accelNow = 0;
    this.pitch = 0;
    this.takeTimer = 0;
    this.bubbleOn = false;
    this.shown = -1;
    this.bubble!.sprite.visible = false;
    this.mode = 'arrive';
    this.ctx.scene.add(this.model.root);
    this.pose();
  }

  private despawn(): void {
    const m = this.model!;
    this.cargo!.reset(0);
    this.ctx.tweens.killTweensOf(this.bubble!.sprite);
    this.bubble!.sprite.visible = false;
    m.root.removeFromParent();
    this.mode = 'idle';
    // next train: gap read live from the village level
    const gap = demandOf(this.ctx.state).trainGap;
    this.timer = randRange(gap[0], gap[1]) / this.dock(); // 0.9.2: Rail Platform
  }

  private arrived(): void {
    this.mode = 'load';
    this.bubbleOn = true;
    this.shown = -1;
    this.bubble!.sprite.visible = true;
    this.ctx.tweens.popIn(this.bubble!.sprite);
    this.model!.root.updateMatrixWorld();
    this.honk(1);
  }

  /** 0.9.2: the Rail Platform upgrade's value (×1 at level 0): trains come that much more often, load up to 3× as fast. */
  private dock(): number {
    return Math.max(1, this.ctx.upgrades.value('railDock'));
  }

  // --- loading + payment -------------------------------------------------------------------------
  private load(dt: number): void {
    this.driveTo(LAYOUT.ridge.rail.stopZ, dt);
    const cargo = this.cargo!;
    const have = cargo.count('log');
    if (have !== this.shown) {
      this.shown = have;
      this.bubble!.show('log', `${have}/${this.want}`);
    }
    this.takeTimer -= dt;
    const pile = this.opts.counter.pile;
    if (this.takeTimer <= 0 && cargo.total < this.want && pile.count('log') > 0) {
      this.takeTimer = TIMING.dockTakeInterval / Math.min(TIMING.dockLoadMax, this.dock());
      transferOne(this.ctx, pile, cargo, ['log'], { duration: 0.28, arcHeight: 1.7 });
    }
    if (have >= this.want) this.pay();
  }

  private pay(): void {
    const state = this.ctx.state;
    const amount = salePrice(state, 'pine', ECONOMY.pinePrice, this.want);
    this.model!.root.localToWorld(tmpV.set(0, 1.2, 0));
    this.opts.cash.pay(amount, tmpV);
    state.stats.logsSold += this.want;
    this.ctx.events.emit('sale', { buyer: 'train', kind: 'log', count: this.want, amount, position: tmpV });
    this.mode = 'paid';
    this.holdTimer = PAID_HOLD;
    this.bubble!.show('check');
    this.ctx.tweens.popIn(this.bubble!.sprite, { duration: 0.35 });
    this.honk(2);
  }

  private honk(times: number): void {
    const m = this.model!;
    this.ctx.audio.play('chime', { pitch: 0.45, volume: 0.8 });
    if (times > 1) this.ctx.tweens.delay(0.22, () => this.ctx.audio.play('chime', { pitch: 0.5, volume: 0.8 }));
    this.ctx.tweens.squash(m.body, 0.06, 0.4);
    m.root.localToWorld(tmpV.copy(m.chimney));
    this.ctx.particles.puff(tmpV, { color: 0xffffff, count: 4, size: 0.7, life: 1.1 });
  }

  // --- driving ----------------------------------------------------------------------------------
  /** Drive toward `target` (smooth accel + brake). Returns true while stopped on it. */
  private driveTo(target: number, dt: number): boolean {
    const dist = target - this.z;
    const prev = this.speed;
    if (dist <= 0.01 && this.speed < 0.2) {
      this.z = target;
      this.speed = 0;
      this.accelNow = -prev / dt;
      return true;
    }
    const vmax = Math.min(DRIVE_SPEED, Math.sqrt(2 * DECEL * Math.max(0, dist)) + 0.35);
    this.speed = approach(this.speed, vmax, (this.speed > vmax ? DECEL : ACCEL) * dt);
    const step = this.speed * dt;
    if (step >= dist) {
      this.z = target;
      this.speed = 0;
      this.accelNow = -prev / dt;
      return true;
    }
    this.z += step;
    this.accelNow = (this.speed - prev) / dt;
    return false;
  }

  private pose(): void {
    this.model!.root.position.set(LAYOUT.ridge.rail.x, 0, this.z);
  }

  /** Pose + axle spin + bounce + pitch + chimney smoke + bubble bob. */
  private animate(dt: number): void {
    const m = this.model!;
    this.pose();
    const spin = (this.speed * dt) / TRAIN_AXLE_RADIUS;
    for (const a of m.axles) a.rotation.x += spin;
    this.bouncePhase += this.speed * dt * 2.4;
    const moving = Math.min(1, this.speed / (DRIVE_SPEED * 0.5));
    m.body.position.y = Math.abs(Math.sin(this.bouncePhase)) * 0.025 * moving;
    const targetPitch = Math.max(-0.025, Math.min(0.025, -this.accelNow * 0.004));
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 8);
    m.body.rotation.x = this.pitch;
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = this.speed > 1 ? 0.22 : 0.65;
      m.root.localToWorld(tmpV.copy(m.chimney));
      this.ctx.particles.puff(tmpV, { color: 0xf3f6f9, count: 1, size: 0.5, life: 1.2 });
    }
    if (this.bubbleOn && this.bubble!.sprite.visible) {
      this.bubble!.sprite.position.y = m.bubbleY + Math.sin(this.ctx.time.elapsed * 4.5) * 0.04;
    }
  }
}
