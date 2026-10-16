/**
 * [B6 — machines] The massive floating tree trunk + manual chopping.
 *
 * Spec: "The River & Giant Log (North-West): A river channel holding a massive, oversized tree trunk
 * floating against a wooden fence/gate." "Initial Event: A giant tree trunk floats down the river and
 * crashes into the yard's river gate." "Manual Chopping: When the player stands next to the giant log,
 * they swing an axe automatically. Chopped wood pieces fly out and land neatly in the grey 'Raw Log
 * Drop Zone' pile."
 *
 * Model: assets/machines.ts createGiantLog (r 1.8 × 12 bark cylinder along Z, LOG_CORE end caps with 3
 * darker rings, LOG_CUT_BAND notch at LAYOUT.giantLog.cutZ, foam ring at the waterline).
 *
 * - `object` moves with the log (x/y/z = LAYOUT.giantLog while resting); the model's `body` bobs, rolls and
 *   wobbles on top of that, the foam ring stays on the water.
 * - playIntro(onCrash, onSettled): starts at introStartZ, floats +Z (speeding up) for introDuration,
 *   its +Z end hits the gate (gateZ): 'intro:crash' { position: gate contact point }, onCrash(), bounces back
 *   ~0.7 and settles with a damped spring (~1 s), then onSettled(). placeAtRest() cancels a running intro
 *   and jumps to the resting pose (callbacks are NOT fired).
 * - Chopping: a zone over LAYOUT.chopZone (marker on) that, while enabled (setChoppable) and the player is
 *   inside, calls ctx.player.setChopTarget(surfacePoint(player position)) every step — or null when the
 *   drop zone is full; onExit → setChopTarget(null). 'player:chopHit' → chopPiece(point, 'player') (only
 *   while choppable).
 * - chopPiece(from, source): if the drop zone pile can accept a log → launchNew('log', from, pile, …);
 *   emit 'log:chopped'; stats.logsChopped++; trunk wobble + cut-band flash; return true. Else false. Used
 *   by the player, the Harvester and the MegaSaw.
 * - setSawMark(worldZ | null): the Harvester drags a thin cut ring along the trunk while it saws.
 */
import * as THREE from 'three';
import { LAYOUT, TIMING } from '../config';
import { clamp, lerp } from '../core/math';
import type { GameContext, LogSource } from '../core/types';
import { createGiantLog, type GiantLogModel } from '../assets/machines';
import { launchNew } from '../items/transfer';
import type { Zone } from '../items/Zones';
import type { DropZone } from './DropZone';

export interface GiantLogOptions {
  dropZone: DropZone;
}

type IntroPhase = 'idle' | 'float' | 'bounce' | 'settle';

/** Radius of the notch the axe bites into (matches the model's groove). */
const NOTCH_R = 1.68;
/** Distance the log bounces back from the gate. */
const BOUNCE_BACK = 0.7;
const BOUNCE_TIME = 0.28;
const SETTLE_TIME = 1.1;

/** A tiny damped spring on one scalar. */
class Spring {
  x = 0;
  v = 0;
  constructor(
    readonly k: number,
    readonly c: number,
  ) {}
  step(dt: number): void {
    this.v += (-this.k * this.x - this.c * this.v) * dt;
    this.x += this.v * dt;
  }
  reset(): void {
    this.x = 0;
    this.v = 0;
  }
}

export class GiantLog {
  readonly object = new THREE.Group();
  readonly model: GiantLogModel;
  readonly chopZone: Zone;
  private choppable = false;

  private phase: IntroPhase = 'idle';
  private phaseT = 0;
  private onCrash: (() => void) | null = null;
  private onSettled: (() => void) | null = null;
  private logZ: number = LAYOUT.giantLog.z;
  private readonly crashPos = new THREE.Vector3();
  private readonly chopTmp = new THREE.Vector3();

  private readonly wobX = new Spring(150, 9);
  private readonly wobRoll = new Spring(90, 5);
  private readonly wobPitch = new Spring(70, 4);
  private flash = 0;
  private floatAmp = 1;
  private sawMarkZ: number | null = null;

  constructor(
    readonly ctx: GameContext,
    readonly opts: GiantLogOptions,
  ) {
    this.model = createGiantLog();
    this.object.add(this.model.root);
    ctx.scene.add(this.object);
    this.placeAtRest();
    this.chopZone = ctx.zones.add({
      id: 'zone:chop',
      area: LAYOUT.chopZone,
      marker: true,
      onStay: () => {
        if (!this.choppable) return;
        ctx.player.setChopTarget(this.opts.dropZone.isFull ? null : this.surfacePoint(ctx.player.position, this.chopTmp));
      },
      onExit: () => ctx.player.setChopTarget(null),
    });
    ctx.events.on('player:chopHit', ({ position, node }) => {
      if (this.choppable && node === undefined) this.chopPiece(position, 'player');
    });
  }

  /** True while the intro cinematic is playing. */
  get introRunning(): boolean {
    return this.phase !== 'idle';
  }

  playIntro(onCrash: () => void, onSettled: () => void): void {
    const g = LAYOUT.giantLog;
    this.resetDynamics();
    this.onCrash = onCrash;
    this.onSettled = onSettled;
    this.phase = 'float';
    this.phaseT = 0;
    this.floatAmp = 2.2;
    this.logZ = g.introStartZ;
    this.object.position.set(g.x, g.y, this.logZ);
    this.applyPose(this.ctx.time.elapsed);
  }

  placeAtRest(): void {
    const g = LAYOUT.giantLog;
    this.phase = 'idle';
    this.onCrash = null;
    this.onSettled = null;
    this.floatAmp = 1;
    this.logZ = g.z;
    this.object.position.set(g.x, g.y, g.z);
    this.resetDynamics();
    this.applyPose(this.ctx.time.elapsed);
  }

  setChoppable(on: boolean): void {
    this.choppable = on;
    if (!on) this.ctx.player.setChopTarget(null);
  }

  /** Strike point on the cut band (trunk side facing the yard, roughly chest height). */
  surfacePoint(near: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const g = LAYOUT.giantLog;
    const p = this.object.position;
    const y = 0.8;
    const dy = y - p.y;
    const z = clamp(near.z, g.cutZ - 0.6, g.cutZ + 0.6);
    return out.set(p.x + Math.sqrt(Math.max(0.01, NOTCH_R * NOTCH_R - dy * dy)), y, z);
  }

  chopPiece(from: THREE.Vector3, source: LogSource): boolean {
    const item = launchNew(this.ctx, 'log', from, this.opts.dropZone.pile, {
      duration: TIMING.launchTime,
      arcHeight: TIMING.launchHeight,
      spin: 1,
    });
    if (!item) return false;
    this.ctx.state.stats.logsChopped++;
    this.ctx.events.emit('log:chopped', { position: from, source });
    this.punch(source === 'player' ? 1 : 0.5, Math.abs(from.z - LAYOUT.giantLog.cutZ) < 1.4);
    return true;
  }

  /** Drag a thin cut ring along the trunk at world Z (null hides it). */
  setSawMark(worldZ: number | null): void {
    this.sawMarkZ = worldZ;
    const mark = this.model.sawMark;
    if (worldZ === null) {
      mark.visible = false;
      return;
    }
    mark.visible = true;
    mark.position.z = worldZ - this.object.position.z;
  }

  update(dt: number): void {
    const g = LAYOUT.giantLog;
    switch (this.phase) {
      case 'float': {
        this.phaseT += dt;
        const k = Math.min(1, this.phaseT / g.introDuration);
        // speeds up on the way down the river
        const f = 0.55 * k + 0.45 * k * k;
        const contactZ = g.gateZ - g.length / 2;
        this.logZ = lerp(g.introStartZ, contactZ, f);
        if (k >= 1) this.crash(contactZ);
        break;
      }
      case 'bounce': {
        this.phaseT += dt;
        const k = Math.min(1, this.phaseT / BOUNCE_TIME);
        const contactZ = g.gateZ - g.length / 2;
        const e = 1 - (1 - k) * (1 - k) * (1 - k);
        this.logZ = lerp(contactZ, contactZ - BOUNCE_BACK, e);
        if (k >= 1) {
          this.phase = 'settle';
          this.phaseT = 0;
        }
        break;
      }
      case 'settle': {
        this.phaseT += dt;
        const d0 = g.z - (g.gateZ - g.length / 2 - BOUNCE_BACK); // start offset below the rest z (positive)
        const t = this.phaseT;
        const disp = -d0 * Math.exp(-4.2 * t) * (Math.cos(9 * t) + (4.2 / 9) * Math.sin(9 * t));
        this.logZ = g.z + disp;
        this.floatAmp = lerp(2.2, 1, Math.min(1, t));
        if (t >= SETTLE_TIME) {
          this.logZ = g.z;
          this.phase = 'idle';
          this.floatAmp = 1;
          const cb = this.onSettled;
          this.onCrash = null;
          this.onSettled = null;
          cb?.();
        }
        break;
      }
      default:
        break;
    }
    if (this.phase !== 'idle') this.object.position.z = this.logZ;

    this.wobX.step(dt);
    this.wobRoll.step(dt);
    this.wobPitch.step(dt);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4.5);
    this.applyPose(this.ctx.time.elapsed);
  }

  // ---------------------------------------------------------------------------

  private crash(contactZ: number): void {
    const g = LAYOUT.giantLog;
    this.logZ = contactZ;
    this.phase = 'bounce';
    this.phaseT = 0;
    this.wobPitch.v += 0.5;
    this.wobRoll.v += 0.6;
    this.flash = 1;
    this.object.position.z = contactZ;
    this.crashPos.set(g.x + 0.4, 0.5, g.gateZ);
    this.ctx.events.emit('intro:crash', { position: this.crashPos });
    this.onCrash?.();
  }

  private punch(strength: number, nearBand: boolean): void {
    // shove away from the yard (−X), tip a little, flash the band where the axe bites
    this.wobX.v -= 0.7 * strength;
    this.wobRoll.v += (Math.random() < 0.5 ? -1 : 1) * 0.12 * strength;
    this.wobPitch.v += 0.05 * strength;
    if (nearBand) this.flash = 1;
  }

  private resetDynamics(): void {
    this.wobX.reset();
    this.wobRoll.reset();
    this.wobPitch.reset();
    this.flash = 0;
    if (this.sawMarkZ !== null) this.setSawMark(this.sawMarkZ);
  }

  /** Bob / roll / wobble the body, pulse the foam, flash the cut band. */
  private applyPose(t: number): void {
    const m = this.model;
    const a = this.floatAmp;
    const body = m.body;
    body.position.set(this.wobX.x, Math.sin(t * 1.35) * 0.04 * a, 0);
    body.rotation.z = Math.sin(t * 0.9 + 1) * 0.014 * a + this.wobRoll.x;
    body.rotation.x = Math.sin(t * 0.62) * 0.006 * a + this.wobPitch.x;
    m.foam.scale.set(1 + Math.sin(t * 2.1) * 0.012, 1, 1 + Math.sin(t * 1.7 + 0.6) * 0.008);
    m.cutMaterial.emissiveIntensity = this.flash * 0.75;
    const s = 1 + this.flash * 0.025;
    m.cutBand.scale.set(s, s, 1);
    if (this.sawMarkZ !== null) m.sawMark.position.z = this.sawMarkZ - this.object.position.z;
  }
}
