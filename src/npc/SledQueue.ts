/**
 * [B5 — commerce] Dog sleds on Timber Ridge (wave 8): a wooden sled with a red blanket and a musher in a fur hat,
 * pulled by four huskies (assets/sled.ts), arrives along LAYOUT.ridge.sledLane from +X, stops with the sled beside
 * the sled counter, loads chairs from the counter pile one by one (items/transfer.ts: they visibly fly onto the
 * sled), pays salePrice(state, 'furniture', ECONOMY.furniturePrice, want) into the sled cash pile, emits 'sale'
 * {buyer: 'sled', kind: 'furniture'}, barks happily and leaves. stats.furnitureSold counts the chairs.
 *
 * - Demand (sledGap between sleds, sledWant for the order) is read live from DEMAND at spawn, never cached.
 * - One sled at a time. With an empty counter the sled waits patiently (bubble "n/want").
 * - Nothing is in the world until the first spawn (the packed-snow trail excepted: it is a flat decal).
 * - The route is a path (assets/sled.ts createSledTrack): in along the lane, stop at the counter, carry on west,
 *   U-turn on the open snow SOUTH of the lane and leave along a second line toward exitX. The dogs and the sled
 *   all follow the same path, so what the sled sweeps is exactly what tests/sled.test.ts validates.
 * - A loaded-but-unpaid sled holds chairs that no pile counts; `loadedPieces` reports them so the save keeps them.
 */
import * as THREE from 'three';
import { ECONOMY, LAYOUT, TIMING } from '../config';
import { approach, randRange } from '../core/math';
import { demandOf, salePrice } from '../core/demand';
import type { GameContext } from '../core/types';
import { Pile } from '../items/Pile';
import { transferOne } from '../items/transfer';
import {
  SLED_CARGO_BASE,
  SLED_CARGO_CAPACITY,
  TEAM_OFFSETS,
  createSled,
  createSledTrack,
  createSledTrail,
  sledCrossingBands,
  type CrossingBand,
  type PairPose,
  type SledModel,
  type SledTrack,
} from '../assets/sled';
import { createSpeechBubble, type SpeechBubble } from '../assets/shop';
import type { CashPile } from '../stations/CashPile';
import type { Counter } from '../stations/Counter';

export interface SledQueueOptions {
  counter: Counter;
  cash: CashPile;
  /**
   * True while a train sweeps the rail corridor (TrainQueue.sweeping). The sled lane and the return line both cross
   * the rail (LAYOUT.ridge.rail.x); the leaving train sweeps both rows, so a sled that has not yet committed to the
   * crossing waits in front of it. Optional: without it the sled never waits.
   */
  trainSweeping?: () => boolean;
}

const DRIVE_SPEED = 9;
const ACCEL = 5;
const DECEL = 7;
/** Speed limit through the U-turn. */
const TURN_SPEED = 4.6;
/** Seconds the first sled takes to show up once the workshop exists. */
const FIRST_SLED_DELAY = 4;
const PAID_HOLD = 1.0;
const HOP_TIME = 0.7;
/**
 * Braking lead (metres) in front of a rail crossing: the sled decides here whether to commit to the crossing or to
 * stop short of it. 9 m covers a stop from the leaving speed (10.35 m/s at 7 m/s^2 needs 7.7 m).
 */
const CROSSING_LEAD = 9;
/** A held sled stands this far before its crossing band. */
const CROSSING_STOP_GAP = 1;

type Mode = 'idle' | 'arrive' | 'load' | 'paid' | 'leave';

const tmpV = new THREE.Vector3();
const tmpP = new THREE.Vector3();

export class SledQueue {
  private mode: Mode = 'idle';
  private timer = FIRST_SLED_DELAY;
  /** Arc-length of the SLED along the track. */
  private s = 0;
  private speed = 0;
  private accelNow = 0;
  private want = 0;
  private takeTimer = 0;
  private holdTimer = 0;
  private bubbleTimer = 0;
  private bubbleOn = false;
  private shown = -1;
  private gait = 0;
  private bounce = 0;
  private pitch = 0;
  private hop = 0;
  private puffTimer = 0;
  private model: SledModel | null = null;
  private cargo: Pile | null = null;
  private bubble: SpeechBubble | null = null;
  private readonly track: SledTrack;
  /** Where the convoy overlaps the train corridor: on the arrival lane and on the return line. */
  private readonly bands: { arrive: CrossingBand; leave: CrossingBand };
  /** The sled has committed to cross (the train must not leave until it is through) on the arrival / return band. */
  private committedArrive = false;
  private committedLeave = false;
  private readonly pairs: PairPose[] = [
    { x: 0, z: 0, yaw: 0 },
    { x: 0, z: 0, yaw: 0 },
  ];

  constructor(
    readonly ctx: GameContext,
    readonly opts: SledQueueOptions,
  ) {
    this.track = createSledTrack();
    this.bands = sledCrossingBands(this.track, LAYOUT.ridge.rail.x);
    ctx.scene.add(createSledTrail(this.track));
  }

  /** True while a sled is in the world. */
  get active(): boolean {
    return this.mode !== 'idle';
  }

  /** True while the sled stands at the counter wanting chairs. */
  get loading(): boolean {
    return this.mode === 'load';
  }

  /** Chairs sitting on a loading, unpaid sled (landed or in flight). The save adds them to the sled counter. */
  get loadedPieces(): number {
    return this.mode === 'load' ? (this.cargo?.total ?? 0) : 0;
  }

  /**
   * True while the sled is committed to the rail crossing (some part of it is inside, or about to enter, the train
   * corridor and it will not stop short): the train must not start leaving. A sled held in front of the crossing, or
   * one that is through, is NOT on the crossing, so neither side can wait on the other.
   */
  get onCrossing(): boolean {
    if (this.mode === 'idle') return false;
    return (this.committedArrive && this.s <= this.bands.arrive.end) || (this.committedLeave && this.s <= this.bands.leave.end);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    switch (this.mode) {
      case 'idle':
        this.timer -= dt;
        if (this.timer <= 0) this.spawn();
        return;
      case 'arrive':
        if (this.holdForTrain(this.bands.arrive, true, dt)) break;
        if (this.driveTo(this.track.sStop, dt)) this.arrived();
        break;
      case 'load':
        this.load(dt);
        break;
      case 'paid':
        this.holdTimer -= dt;
        this.driveTo(this.track.sStop, dt); // keeps the speed at zero
        if (this.holdTimer <= 0) this.depart();
        break;
      case 'leave':
        this.leave(dt);
        if (this.s >= this.track.sExit) {
          this.despawn();
          return;
        }
        break;
    }
    this.animate(dt);
  }

  // --- life cycle ----------------------------------------------------------------------------
  private spawn(): void {
    if (!this.model) {
      this.model = createSled();
      this.cargo = new Pile(this.ctx, {
        id: 'npc:sled:cargo',
        accepts: ['furniture'],
        position: SLED_CARGO_BASE.clone(),
        parent: this.model.body,
        grid: { cols: 2, rows: 3, layers: SLED_CARGO_CAPACITY / 6, spacing: { x: 0.4, y: 0.5, z: 0.5 } },
      });
      this.bubble = createSpeechBubble(1.35);
      this.bubble.sprite.visible = false;
      this.bubble.sprite.position.set(0, this.model.bubbleY, 0);
      this.model.sled.add(this.bubble.sprite);
    }
    const dm = demandOf(this.ctx.state);
    this.want = Math.min(SLED_CARGO_CAPACITY, Math.max(1, Math.round(randRange(dm.sledWant[0] - 0.49, dm.sledWant[1] + 0.49))));
    this.cargo!.clear();
    this.s = this.track.sStart;
    this.committedArrive = false;
    this.committedLeave = false;
    this.speed = DRIVE_SPEED * 0.8;
    this.accelNow = 0;
    this.pitch = 0;
    this.hop = 0;
    this.takeTimer = 0;
    this.bubbleOn = false;
    this.shown = -1;
    this.bubble!.sprite.visible = false;
    this.mode = 'arrive';
    this.ctx.scene.add(this.model.root);
    this.pose();
    this.model.poseTeam(this.pairs, this.gait, 0, 0, 0); // the dogs must not flash at the neutral pose for a frame
  }

  private despawn(): void {
    this.cargo!.clear();
    this.ctx.tweens.killTweensOf(this.bubble!.sprite);
    this.bubble!.sprite.visible = false;
    this.model!.root.removeFromParent();
    this.mode = 'idle';
    // next sled: gap read live from the village level (same semantics as TrainQueue: counted from the departure)
    const gap = demandOf(this.ctx.state).sledGap;
    this.timer = randRange(gap[0], gap[1]) / this.dock(); // 0.9.2: Sled Dock
  }

  private arrived(): void {
    this.mode = 'load';
    this.bubbleOn = true;
    this.shown = -1;
    this.bubble!.sprite.visible = true;
    this.ctx.tweens.popIn(this.bubble!.sprite);
    this.bark(1);
  }

  private depart(): void {
    this.mode = 'leave';
    this.bubbleTimer = 0.4;
  }

  /** 0.9.2: the Sled Dock upgrade's value (×1 at level 0): sleds come that much more often, load up to 3× as fast. */
  private dock(): number {
    return Math.max(1, this.ctx.upgrades.value('sledDock'));
  }

  // --- loading + payment -------------------------------------------------------------------------
  private load(dt: number): void {
    this.driveTo(this.track.sStop, dt);
    const cargo = this.cargo!;
    const have = cargo.count('furniture');
    if (have !== this.shown) {
      this.shown = have;
      this.bubble!.show('furniture', `${have}/${this.want}`);
    }
    this.takeTimer -= dt;
    const pile = this.opts.counter.pile;
    if (this.takeTimer <= 0 && cargo.total < this.want && pile.count('furniture') > 0) {
      this.takeTimer = TIMING.npcTakeInterval / Math.min(3, this.dock());
      transferOne(this.ctx, pile, cargo, ['furniture'], { duration: 0.3, arcHeight: 1.6 });
    }
    if (have >= this.want) this.pay();
  }

  private pay(): void {
    const state = this.ctx.state;
    const amount = salePrice(state, 'furniture', ECONOMY.furniturePrice, this.want);
    const m = this.model!;
    m.sled.updateMatrixWorld(true);
    m.sled.localToWorld(tmpV.copy(m.payLocal)); // WORLD position: the pile / sled positions are parent-local
    this.opts.cash.pay(amount, tmpV);
    state.stats.furnitureSold += this.want;
    this.ctx.events.emit('sale', { buyer: 'sled', kind: 'furniture', count: this.want, amount, position: tmpV.clone() });
    this.mode = 'paid';
    this.holdTimer = PAID_HOLD;
    this.hop = HOP_TIME;
    this.bubble!.show('check');
    this.ctx.tweens.popIn(this.bubble!.sprite, { duration: 0.35 });
    this.ctx.tweens.squash(m.body, 0.07, 0.4);
    this.bark(3);
  }

  /** Happy yips. No dedicated sound exists yet: a pitched 'pop' stands in (hook: swap in a 'bark' SfxName). */
  private bark(times: number): void {
    for (let i = 0; i < times; i++) {
      const pitch = 1.7 + (i % 2) * 0.35;
      if (i === 0) this.ctx.audio.play('pop', { pitch, volume: 0.55 });
      else this.ctx.tweens.delay(0.17 * i, () => this.ctx.audio.play('pop', { pitch, volume: 0.55 }));
    }
  }

  // --- driving ----------------------------------------------------------------------------------
  /** Drive toward `target` (smooth accel + brake). Returns true while stopped on it. */
  private driveTo(target: number, dt: number): boolean {
    const dist = target - this.s;
    const prev = this.speed;
    if (dist <= 0.01 && this.speed < 0.2) {
      this.s = target;
      this.speed = 0;
      this.accelNow = -prev / dt;
      return true;
    }
    const vmax = Math.min(DRIVE_SPEED, Math.sqrt(2 * DECEL * Math.max(0, dist)) + 0.35);
    this.speed = approach(this.speed, vmax, (this.speed > vmax ? DECEL : ACCEL) * dt);
    const step = this.speed * dt;
    if (step >= dist) {
      this.s = target;
      this.speed = 0;
      this.accelNow = -prev / dt;
      return true;
    }
    this.s += step;
    this.accelNow = (this.speed - prev) / dt;
    return false;
  }

  /**
   * Rail crossing gate. Once the sled is CROSSING_LEAD short of `band` it either commits (no train sweeping: from now
   * on `onCrossing` keeps the train at the platform until the sled is through) or stands still CROSSING_STOP_GAP
   * before the band until the train has cleared. Returns true while it is holding (the driving is done here).
   */
  private holdForTrain(band: CrossingBand, arriving: boolean, dt: number): boolean {
    if (arriving ? this.committedArrive : this.committedLeave) return false;
    if (this.s < band.start - CROSSING_LEAD) return false;
    if (this.opts.trainSweeping?.()) {
      this.driveTo(band.start - CROSSING_STOP_GAP, dt);
      return true;
    }
    if (arriving) this.committedArrive = true;
    else this.committedLeave = true;
    return false;
  }

  /** Leaving: speed up, but ease through the U-turn (from the head entering the arc to the sled leaving it). */
  private leave(dt: number): void {
    if (this.holdForTrain(this.bands.leave, false, dt)) return;
    const t = this.track;
    const turning = this.s > t.sLoopStart - 1 && this.s < t.sLoopEnd + 0.5;
    const prev = this.speed;
    const vmax = turning ? TURN_SPEED : DRIVE_SPEED * 1.15;
    this.speed = approach(this.speed, vmax, (this.speed > vmax ? DECEL : ACCEL) * dt);
    this.accelNow = (this.speed - prev) / dt;
    this.s += this.speed * dt;
  }

  // --- pose + animation ---------------------------------------------------------------------------
  private pose(): void {
    const m = this.model!;
    const t = this.track;
    t.at(this.s, tmpP);
    m.sled.position.set(tmpP.x, m.sled.position.y, tmpP.z);
    m.sled.rotation.y = t.yawAt(this.s);
    for (let k = 0; k < 2; k++) {
      const so = this.s + TEAM_OFFSETS[k]!;
      t.at(so, tmpP);
      const pp = this.pairs[k]!;
      pp.x = tmpP.x;
      pp.z = tmpP.z;
      pp.yaw = t.yawAt(so);
    }
  }

  /** Pose + trot + bounce + pitch + hop + bubble bob + snow kicked up by the runners. */
  private animate(dt: number): void {
    const m = this.model!;
    this.pose();
    const moving = Math.min(1, this.speed / (DRIVE_SPEED * 0.5));
    this.gait += dt * (3 + this.speed * 1.9) * (this.speed > 0.3 || this.hop > 0 ? 1 : 0.2);
    this.bounce += this.speed * dt * 3.2;
    m.body.position.y = Math.abs(Math.sin(this.bounce)) * 0.03 * moving;
    const targetPitch = Math.max(-0.03, Math.min(0.03, -this.accelNow * 0.004));
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 8);
    m.body.rotation.x = this.pitch;
    let hopY = 0;
    if (this.hop > 0) {
      this.hop = Math.max(0, this.hop - dt);
      const u = 1 - this.hop / HOP_TIME;
      hopY = Math.abs(Math.sin(u * Math.PI * 3)) * 0.2 * (1 - u);
    }
    m.poseTeam(this.pairs, this.gait, Math.max(moving, this.hop > 0 ? 0.6 : 0), hopY, this.pitch * 2);
    if (this.bubbleOn && this.bubble!.sprite.visible) {
      this.bubble!.sprite.position.y = m.bubbleY + Math.sin(this.ctx.time.elapsed * 4.5) * 0.04;
      if (this.mode === 'leave') {
        this.bubbleTimer -= dt;
        if (this.bubbleTimer <= 0) {
          this.bubbleOn = false;
          this.ctx.tweens.popOut(this.bubble!.sprite, { duration: 0.25 });
        }
      }
    }
    this.puffTimer -= dt;
    if (this.puffTimer <= 0 && this.speed > 2) {
      this.puffTimer = 0.16;
      m.sled.localToWorld(tmpV.set(0, 0.1, -1.1));
      this.ctx.particles.puff(tmpV, { color: 0xffffff, count: 1, size: 0.35, life: 0.7 });
    }
  }
}
