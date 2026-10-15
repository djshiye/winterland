/**
 * [B6 — machines] Furniture workshop on Timber Ridge (wave 8, pad 'workshop', LAYOUT.ridge.workshop). A cosy
 * log-cabin workshop: logs dropped in the west hopper become chairs ('furniture' items) on the east bench, one
 * every ctx.upgrades.value('workshop') seconds (read live). Dog sleds (npc/SledQueue) buy them at the sled
 * counter; the player carries them over.
 *
 * CONTRACT (keep every public signature; B6 owns the implementation):
 * - input: hopper Pile (logs); a transfer zone (hopper.zone) takes logs from the player's arms.
 * - output: bench Pile (furniture); a transfer zone (bench.zone) gives furniture to the player's arms.
 * - Each piece: take a log, animate it into the workshop (saw sound / sawdust), launchNew('furniture') onto the
 *   bench; emit 'built'-style juice as the other machines do; stats.furnitureMade++. Idles when starved / full.
 * - build(instant): visible + running; instant (restore) = final state, no animation / event / sound.
 * - Machine level badge like the other machines (upgrade 'workshop').
 *
 * Model: assets/ridgeMachines.ts createWorkshop (building + hopper trough + bench are one baked mesh, the circular
 * saw spins on its own pivot). Cycle, as fractions of the live cycle time T = value('workshop'): the log hops from
 * the hopper to the west hatch (0 → 0.2) and rides the table to the blade (0.2 → 0.42); the blade eats it with a
 * spray of sawdust (0.42 → 0.72); the chair pops out of the east hatch onto the bench (0.78); cooldown until T.
 * A cycle only starts when the bench has room, and the next one starts the same frame the previous one ends.
 * Colliders: the cabin, the hopper trough and the bench (sized so the transfer zones stay reachable).
 */
import * as THREE from 'three';
import { COLORS, LAYOUT, PALETTE, TIMING, rect } from '../config';
import { createWorkshop, WORKSHOP_BENCH_Y, WORKSHOP_HOPPER_Y, type WorkshopModel } from '../assets/ridgeMachines';
import { damp, smoothstep } from '../core/math';
import type { GameContext, Item } from '../core/types';
import { Pile } from '../items/Pile';
import { launchNew } from '../items/transfer';
import type { Zone } from '../items/Zones';

const F_MOUTH = 0.2;
const F_SAW = 0.42;
const F_CUT = 0.72;
const F_POP = 0.78;
const DUST_COLORS = [COLORS.LOG_CORE, PALETTE.woodRing, COLORS.PLANK_WOOD];
const DUST_DIR = new THREE.Vector3(0.35, 1, 0.9);
const SMOKE_COLOR = 0xe6edf3;
/** Collider sizes (centred on the pile spots). Hopper < 0.7 wide and bench ≤ 1.0 keep the player zones reachable. */
export const WORKSHOP_HOPPER_BOX = { w: 0.66, d: 1.1 };
export const WORKSHOP_BENCH_BOX = { w: 1.0, d: 1.1 };

type State = 'idle' | 'busy' | 'blocked' | 'cooldown';

export class Workshop {
  readonly root = new THREE.Group();
  readonly model: WorkshopModel;
  readonly input: Pile;
  readonly output: Pile;
  readonly inputZone: Zone;
  readonly outputZone: Zone;

  private built = false;
  private startAt = 0;
  private state: State = 'idle';
  private t = 0;
  private cycle = 3;
  private cur: Item | null = null;
  private eaten = false;
  private cutStarted = false;
  private dustClock = 0;
  private puffClock = 0;
  private bladeRate = 1.5;
  private readonly start = new THREE.Vector3();
  private readonly mouth = new THREE.Vector3();
  private readonly saw = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(readonly ctx: GameContext) {
    const W = LAYOUT.ridge.workshop;
    this.model = createWorkshop();
    this.root.add(this.model.root);
    this.root.position.set(W.x, 0, W.z);
    this.root.visible = false;
    this.input = new Pile(ctx, { id: 'pile:workshopIn', accepts: ['log'], position: new THREE.Vector3(W.hopper.x, WORKSHOP_HOPPER_Y, W.hopper.z), grid: W.hopper.grid });
    this.output = new Pile(ctx, { id: 'pile:workshopOut', accepts: ['furniture'], position: new THREE.Vector3(W.bench.x, WORKSHOP_BENCH_Y, W.bench.z), grid: W.bench.grid });
    this.inputZone = ctx.zones.addTransfer({ id: 'pile:workshopIn:feed', area: W.hopper.zone, from: ctx.player.arms, to: this.input, kinds: ['log'], interval: TIMING.dropInterval, marker: true });
    this.outputZone = ctx.zones.addTransfer({ id: 'pile:workshopOut:pickup', area: W.bench.zone, from: this.output, to: ctx.player.arms, kinds: ['furniture'], kind: 'take', interval: TIMING.pickupInterval, marker: true });
    this.mouth.set(W.x + this.model.mouth.x, this.model.mouth.y, W.z + this.model.mouth.z);
    this.saw.set(W.x + this.model.saw.x - 0.34, this.model.saw.y - 0.02, W.z + this.model.saw.z);
    ctx.scene.add(this.root);
  }

  /** Register the colliders, pop in with a squash and announce. instant (restoring a save): final state at once — no animation, no 'built' event, no sound. */
  build(instant = false): void {
    if (this.built) return;
    this.built = true;
    const ctx = this.ctx;
    const W = LAYOUT.ridge.workshop;
    ctx.colliders.addBox(rect(W.x, W.z, W.w, W.d), 'workshop');
    ctx.colliders.addBox(rect(W.hopper.x, W.hopper.z, WORKSHOP_HOPPER_BOX.w, WORKSHOP_HOPPER_BOX.d), 'workshop:hopper');
    ctx.colliders.addBox(rect(W.bench.x, W.bench.z, WORKSHOP_BENCH_BOX.w, WORKSHOP_BENCH_BOX.d), 'workshop:bench');
    this.model.badge.setLevel(ctx.upgrades.level('workshop'));
    ctx.events.on('upgrade:bought', ({ id }) => {
      if (id !== 'workshop') return;
      ctx.tweens.squash(this.model.body, 0.1, 0.45);
      this.tmp.set(W.x, 1.8, W.z);
      ctx.particles.puff(this.tmp, { count: 6, size: 0.6, life: 0.8 });
    });
    this.root.visible = true;
    if (instant) {
      this.startAt = ctx.time.elapsed;
      return;
    }
    this.startAt = ctx.time.elapsed + 0.9;
    ctx.tweens.popIn(this.root, { duration: 0.5 });
    ctx.tweens.delay(0.55, () => ctx.tweens.squash(this.model.body, 0.1, 0.4));
    ctx.events.emit('built', { what: 'workshop', position: new THREE.Vector3(W.x, 0, W.z), object: this.root });
  }

  update(dt: number): void {
    if (!this.built) return;
    const ctx = this.ctx;
    this.model.badge.setLevel(ctx.upgrades.level('workshop'));

    if (this.state === 'idle') {
      if (ctx.time.elapsed >= this.startAt && this.canStart()) this.startCycle();
    } else {
      this.t += dt;
      this.advance(dt);
      // back-to-back cycles keep the exact cycle time: start the next one in the same frame, carrying the leftover
      if (this.isIdle() && this.canStart()) {
        const over = this.t - this.cycle;
        this.startCycle();
        this.t = Math.max(0, over);
      }
    }

    // blade: lazy idle turn, screaming while cutting
    const cutting = this.state === 'busy' && this.t >= F_SAW * this.cycle - 0.05 && this.t < F_CUT * this.cycle + 0.1;
    this.bladeRate = damp(this.bladeRate, cutting ? 38 : this.state === 'idle' ? 1.2 : 9, cutting ? 12 : 5, dt);
    this.model.blade.rotation.z -= this.bladeRate * dt;
    this.model.body.position.x = cutting ? Math.sin(this.t * 80) * 0.01 : 0;

    // chimney: busy puffs, an occasional cosy wisp when idle
    this.puffClock -= dt;
    if (this.puffClock <= 0) {
      const W = LAYOUT.ridge.workshop;
      this.puffClock = this.state === 'idle' ? 1.7 : Math.max(0.2, 0.3 * this.cycle);
      this.tmp.set(W.x + this.model.chimney.x, this.model.chimney.y, W.z + this.model.chimney.z);
      this.ctx.particles.puff(this.tmp, { color: SMOKE_COLOR, count: this.state === 'idle' ? 1 : 2, size: this.state === 'idle' ? 0.26 : 0.34, life: 1.0 });
    }
  }

  // ---------------------------------------------------------------------------

  /**
   * 1 while a log has been taken from the hopper and its furniture has not been launched yet (busy / blocked), else 0.
   * Saves must add this to the hopper's log count (the log is gone from every holder meanwhile); once launched the
   * product is counted by ctx.flights.inFlightTo(output, 'furniture') and then by the output pile.
   */
  get inProcess(): number {
    return this.state === 'busy' || this.state === 'blocked' ? 1 : 0;
  }

  private isIdle(): boolean {
    return this.state === 'idle';
  }

  private canStart(): boolean {
    return this.input.count('log') > 0 && this.output.canAccept('furniture');
  }

  private startCycle(): void {
    const log = this.input.take('log');
    if (!log) return;
    this.cur = log;
    this.eaten = false;
    this.cutStarted = false;
    this.start.copy(log.object.position);
    log.object.quaternion.identity();
    this.cycle = Math.max(0.3, this.ctx.upgrades.value('workshop'));
    this.state = 'busy';
    this.t = 0;
    this.dustClock = 0;
  }

  private advance(dt: number): void {
    const ctx = this.ctx;
    const cur = this.cur;
    const cyc = this.cycle;
    const tMouth = F_MOUTH * cyc;
    const tSaw = F_SAW * cyc;
    const tCut = F_CUT * cyc;
    const tPop = F_POP * cyc;
    if (cur && !this.eaten) {
      const o = cur.object;
      if (this.t < tMouth) {
        const k = smoothstep(0, tMouth, this.t);
        o.position.lerpVectors(this.start, this.mouth, k);
        o.position.y += Math.sin(k * Math.PI) * 0.3;
      } else if (this.t < tSaw) {
        const k = smoothstep(tMouth, tSaw, this.t);
        o.position.lerpVectors(this.mouth, this.saw, k);
      } else if (this.t < tCut) {
        // the blade eats the log: the leading end stays at the blade while the rest is consumed
        if (!this.cutStarted) {
          this.cutStarted = true;
          ctx.audio.play('machine', { volume: 0.55, pitch: 1.25 });
        }
        const k = smoothstep(tSaw, tCut, this.t);
        const sx = Math.max(0.05, 1 - k);
        o.scale.x = sx;
        o.position.copy(this.saw);
        o.position.x -= 0.3 * (1 - sx);
        this.dustClock -= dt;
        if (this.dustClock <= 0) {
          this.dustClock = 0.05;
          this.tmp.copy(this.saw);
          this.tmp.x += 0.34;
          this.tmp.y += 0.08;
          ctx.particles.burst(this.tmp, { colors: DUST_COLORS, count: 2, speed: 2.8, size: 0.12, spread: 0.8, life: 0.45, direction: DUST_DIR, shape: 'chip', gravity: 10 });
        }
      } else {
        this.eaten = true;
        ctx.tweens.killTweensOf(o);
        ctx.items.release(cur);
        this.cur = null;
        ctx.tweens.punchScale(this.model.blade, 0.1, 0.15);
      }
    }
    if ((this.state === 'busy' || this.state === 'blocked') && this.t >= tPop) {
      const W = LAYOUT.ridge.workshop;
      this.tmp.set(W.x + this.model.exit.x, this.model.exit.y, W.z + this.model.exit.z);
      const chair = launchNew(ctx, 'furniture', this.tmp, this.output, { duration: Math.max(0.2, 0.34 * cyc), arcHeight: 0.45, scaleFrom: 0.5 });
      if (chair) {
        ctx.state.stats.furnitureMade++;
        this.tmp.x += 0.5;
        ctx.particles.sparkle(this.tmp, COLORS.LOG_CORE);
        ctx.tweens.punchScale(this.model.body, 0.025, Math.max(0.12, 0.2 * cyc));
        this.state = 'cooldown';
      } else {
        this.state = 'blocked';
      }
    }
    if (this.state === 'cooldown' && this.t >= cyc) this.state = 'idle';
  }
}
