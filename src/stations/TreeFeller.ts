/**
 * [B6 — machines] Tree feller on Timber Ridge: a tracked forestry machine that drives to the nearest standing pine
 * (ridge.nearestStanding), swings its saw head through the trunk (ridge.fell → topples), loads the logs on its rack,
 * drives back and drops RIDGE.logsPerTree pine logs ('log' items) onto the log deck (LAYOUT.ridge.deck).
 * One tree every ctx.upgrades.value('treeFeller') seconds (read live).
 *
 * CONTRACT (keep every public signature; B6 owns the implementation):
 * - deck: Pile of logs at LAYOUT.ridge.deck; a transfer zone (deck.zone) lets the player pick logs up into the arms.
 *   The pine hauler (crew) and the player take logs from it to the rail platform.
 * - build(instant): visible + running; instant (restore) = final state, no animation / 'built' event / sound.
 * - The deck stops the feller when full (it idles at its home spot beside the deck).
 *
 * Model: assets/ridgeMachines.ts createTreeFeller. Cycle (fractions of the cycle time): drive out 0.36 · cut 0.20
 * (boom reaches the trunk, the turret slews the blade across it, the tree falls at the middle) · drive back 0.34 ·
 * drop 0.10. When a far tree would need an unreasonable speed (MAX_SPEED) the cycle simply lasts a little longer.
 * Logs are only created at the drop, but the tree is already cut at the felling moment. A save between the cut and the
 * last drop loses that tree's logs unless the snapshot adds `pendingLogs` (cut, not yet
 * thrown) to the deck count (the deck's own `total` already includes logs thrown and still in the air).
 * Level badge on the flank (LevelBadge, updated every frame like the other machines).
 */
import * as THREE from 'three';
import { COLORS, LAYOUT, PALETTE, RIDGE } from '../config';
import { createTreeFeller, type TreeFellerModel } from '../assets/ridgeMachines';
import { damp, dampAngle, lerp } from '../core/math';
import type { GameContext } from '../core/types';
import { Pile } from '../items/Pile';
import { launchNew } from '../items/transfer';
import type { Ridge } from '../ridge/Ridge';

/** Cycle timeline. */
const P_OUT = 0.36;
const P_CUT = P_OUT + 0.2;
const P_BACK = P_CUT + 0.34;
/** Fastest the tracks go (m/s); longer drives stretch the cycle instead. */
const MAX_SPEED = 8;
/** Distance from the machine centre to the trunk when sawing. */
const STOP_DIST = 2.45;
/** Boom poses (reach along the machine's +Z from the shoulder, height above the floor). */
const CARRY = { reach: 0.55, height: 1.95 };
const WORK_HEIGHT = 0.85;
const SLEW = 0.55;
const CHIP_COLORS = [COLORS.LOG_CORE, COLORS.LOG_CUT_BAND, PALETTE.woodRing];
const CHIP_DIR = new THREE.Vector3(0.4, 0.7, 0.2);

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

export class TreeFeller {
  readonly root = new THREE.Group();
  readonly deck: Pile;
  readonly model: TreeFellerModel;
  private running = false;
  private startAt = 0;

  /** Parked position: east of the deck, the rack facing it. */
  private readonly home = new THREE.Vector2();
  private readonly homeYaw: number;
  private yaw: number;

  // cycle state
  private cycling = false;
  private k = 0;
  private minT = 0;
  private treeX = 0;
  private treeZ = 0;
  private treeIndex = -1;
  private readonly stop = new THREE.Vector2();
  private bearing = 0;
  private reach = 1.2;
  private felled = false;
  private dropping = false;
  private pending = 0;
  /** Logs of the felled tree that have not been thrown onto the deck yet (see pendingLogs). */
  private owed = 0;
  private dropClock = 0;
  private chipClock = 0;
  private bladeRate = 2;
  private work = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly ctx: GameContext,
    readonly ridge: Ridge,
  ) {
    const d = LAYOUT.ridge.deck;
    this.deck = new Pile(ctx, { id: 'pile:deck', accepts: ['log'], position: new THREE.Vector3(d.x, 0, d.z), grid: d.grid });
    ctx.zones.addTransfer({ id: 'pile:deck:pickup', area: d.zone, from: this.deck, to: ctx.player.arms, kinds: ['log'] });

    this.model = createTreeFeller();
    this.root.add(this.model.root);
    this.home.set(d.x + 1.4, d.z - 2.1);
    // rack toward the deck: forward points away from it
    this.homeYaw = Math.atan2(this.home.x - d.x, this.home.y - d.z);
    this.yaw = this.homeYaw;
    this.placeAt(this.home.x, this.home.y);
    this.model.setBoom(CARRY.reach, CARRY.height);
    this.root.visible = false;
    ctx.scene.add(this.root);
  }

  /** instant (restoring a save): final state at once — no animation, no 'built' event, no sound. */
  build(instant = false): void {
    if (this.running) return;
    const ctx = this.ctx;
    this.running = true;
    this.model.badge.setLevel(ctx.upgrades.level('treeFeller'));
    ctx.events.on('upgrade:bought', ({ id }) => {
      if (id !== 'treeFeller') return;
      ctx.tweens.squash(this.root, 0.14, 0.45);
      this.tmp.set(this.root.position.x, 1.6, this.root.position.z);
      ctx.particles.puff(this.tmp, { count: 6, size: 0.6, life: 0.8 });
    });
    if (instant) {
      this.root.visible = true;
      this.startAt = ctx.time.elapsed;
      return;
    }
    this.startAt = ctx.time.elapsed + 0.8;
    ctx.tweens.popIn(this.root, { duration: 0.5 });
    ctx.tweens.delay(0.55, () => ctx.tweens.squash(this.root, 0.12, 0.35));
    ctx.events.emit('built', { what: 'treeFeller', position: new THREE.Vector3(this.home.x, 0, this.home.y), object: this.root });
  }

  /**
   * Logs of the tree just felled that are not on the deck or in the air yet (0 outside the cut-to-drop window).
   * A save must add this to the deck's log count.
   */
  get pendingLogs(): number {
    return this.owed;
  }

  /** Seconds per tree at the current level (read live). */
  get interval(): number {
    return this.ctx.upgrades.value('treeFeller');
  }

  update(dt: number): void {
    if (!this.running) return;
    const ctx = this.ctx;
    const m = this.model;
    m.badge.setLevel(ctx.upgrades.level('treeFeller'));
    const speed = 6 / this.interval;
    m.beacon.rotation.y += dt * 4 * Math.max(1, speed * 0.6);

    this.updateDrop(dt);

    if (!this.cycling && ctx.time.elapsed >= this.startAt && !this.dropping) this.tryStart();
    this.work = damp(this.work, this.cycling ? 1 : 0, 4, dt);

    if (this.cycling) this.stepCycle(dt);
    else {
      // parked: ease the pose back, turn the rack toward the deck
      this.yaw = dampAngle(this.yaw, this.homeYaw, 6, dt);
      m.turret.rotation.y = damp(m.turret.rotation.y, 0, 6, dt);
      this.root.rotation.y = this.yaw;
    }
    this.bladeRate = damp(this.bladeRate, this.cycling ? this.bladeTarget() : 2, 6, dt);
    m.blade.rotation.z -= this.bladeRate * dt;
  }

  // ---------------------------------------------------------------------------

  /** Start the next tree if the deck has room for its logs and a pine stands. */
  private tryStart(): void {
    if (this.deck.capacity - this.deck.total < RIDGE.logsPerTree) return;
    const d = LAYOUT.ridge.deck;
    const tree = this.ridge.nearestStanding(d.x, d.z);
    if (!tree) return;
    this.treeIndex = tree.index;
    this.treeX = tree.x;
    this.treeZ = tree.z;
    const dx = tree.x - this.home.x;
    const dz = tree.z - this.home.y;
    const dist = Math.hypot(dx, dz);
    this.bearing = Math.atan2(dx, dz);
    const run = Math.max(0, dist - STOP_DIST);
    this.stop.set(this.home.x + (dx / Math.max(dist, 1e-4)) * run, this.home.y + (dz / Math.max(dist, 1e-4)) * run);
    const toTrunk = Math.max(0.2, dist - run);
    this.reach = Math.max(0.7, Math.min(1.75, toTrunk - this.model.shoulder.z - 0.3));
    // drive legs need at least run / MAX_SPEED each way
    const minT = run / MAX_SPEED / Math.min(P_OUT, 1 - P_CUT - 0.1);
    this.minT = minT;
    this.k = 0;
    this.felled = false;
    this.cycling = true;
  }

  private bladeTarget(): number {
    const k = this.k;
    return k >= P_OUT && k < P_CUT + 0.02 ? 44 : 12;
  }

  private stepCycle(dt: number): void {
    const ctx = this.ctx;
    const m = this.model;
    // the cycle length follows the live upgrade value; a pending drop holds the very end
    this.k = Math.min(1, this.k + dt / Math.max(this.interval, this.minT));
    const k = this.k;
    let x = this.home.x;
    let z = this.home.y;
    let wantYaw = this.bearing;
    let reach = CARRY.reach;
    let height = CARRY.height;
    let slew = 0;

    if (k < P_OUT) {
      const e = ease(k / P_OUT);
      x = lerp(this.home.x, this.stop.x, e);
      z = lerp(this.home.y, this.stop.y, e);
    } else if (k < P_CUT) {
      const u = (k - P_OUT) / (P_CUT - P_OUT);
      x = this.stop.x;
      z = this.stop.y;
      const reachIn = easeOut(Math.min(1, u / 0.28));
      const reachOut = easeOut(Math.min(1, Math.max(0, (u - 0.78) / 0.22)));
      const w = reachIn * (1 - reachOut);
      reach = lerp(CARRY.reach, this.reach, w);
      height = lerp(CARRY.height, WORK_HEIGHT, w);
      slew = u < 0.28 ? SLEW : u < 0.78 ? lerp(SLEW, -SLEW, (u - 0.28) / 0.5) : lerp(-SLEW, 0, (u - 0.78) / 0.22);
      if (u >= 0.28 && u < 0.78) this.chips(dt);
      if (!this.felled && u >= 0.52) {
        this.felled = true;
        this.owed = RIDGE.logsPerTree;
        this.ridge.fell(this.treeIndex);
        this.tmp.set(this.treeX, 0.5, this.treeZ);
        ctx.particles.puff(this.tmp, { count: 5, size: 0.7, life: 0.7 });
      }
      if (u >= 0.8 && !m.bundle.visible) {
        m.bundle.visible = true;
        ctx.tweens.punchScale(m.bundle, 0.12, 0.25);
      }
    } else if (k < P_BACK) {
      const e = ease((k - P_CUT) / (P_BACK - P_CUT));
      x = lerp(this.stop.x, this.home.x, e);
      z = lerp(this.stop.y, this.home.y, e);
      wantYaw = this.bearing + Math.PI;
    } else {
      wantYaw = this.homeYaw;
      if (!this.dropping && this.pending === 0 && m.bundle.visible && k < 1) {
        this.dropping = true;
        this.pending = RIDGE.logsPerTree;
        this.dropClock = 0;
      }
    }

    this.yaw = dampAngle(this.yaw, wantYaw, 9, dt);
    this.placeAt(x, z);
    this.root.rotation.y = this.yaw;
    m.turret.rotation.y = damp(m.turret.rotation.y, slew, 14, dt);
    m.setBoom(reach, height);

    if (k >= 1 && !this.dropping && this.pending === 0) {
      this.cycling = false;
      this.k = 0;
    }
  }

  /** Throw the carried logs onto the deck, one after another (waits if the deck has no room). */
  private updateDrop(dt: number): void {
    if (!this.dropping) return;
    this.dropClock -= dt;
    if (this.dropClock > 0) return;
    if (!this.deck.canAccept('log')) return;
    this.tmp.copy(this.model.rack);
    this.root.localToWorld(this.tmp);
    launchNew(this.ctx, 'log', this.tmp, this.deck, { duration: 0.5, arcHeight: 1.6 });
    this.pending--;
    this.owed = Math.max(0, this.owed - 1);
    this.dropClock = 0.07;
    if (this.pending <= 0) {
      this.dropping = false;
      this.model.bundle.visible = false;
    }
  }

  private chips(dt: number): void {
    this.chipClock += dt;
    if (this.chipClock < 0.05) return;
    this.chipClock = 0;
    this.model.head.getWorldPosition(this.tmp);
    this.tmp.y -= 0.25;
    this.ctx.particles.burst(this.tmp, {
      colors: CHIP_COLORS,
      count: 2,
      speed: 3.2,
      size: 0.13,
      spread: 0.8,
      life: 0.5,
      direction: CHIP_DIR,
      shape: 'chip',
      gravity: 12,
    });
  }

  private placeAt(x: number, z: number): void {
    this.root.position.set(x, 0, z);
  }
}
