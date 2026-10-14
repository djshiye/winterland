/**
 * [B6 — machines] Phase 5: massive automated river saw slicing the giant log.
 *
 * Spec: "Mega Sawmill Expansion ... slices the giant log with a massive automated river saw".
 * - Model (AssetFactory createMegaSaw in assets/machines.ts — yours; LAYOUT.megaSaw): steel
 *   (MACHINE_STEEL) gantry spanning the river at the log's upstream end (the log spans z ∈ [-8, 4];
 *   megaSaw.z = -8.6) with its yard-side base (collider megaSaw.base) and far-bank leg; MACHINE_BLUE
 *   housings; a giant circular blade (bladeRadius, teeth, SAW_GLOW hub/accents) on a carriage that
 *   plunges into the trunk and rises again each cycle (cycleTime), spinning fast, LOG_CORE sawdust.
 * - Each cycle at the bottom of the plunge: log.chopPiece(contact point, 'megaSaw') logsPerCycle times
 *   (staggered ~0.08 s), small camera shake via ctx.cameraRig.shake(0.08, 0.15).
 * - build(): rises out of the ground / pops in with squash, emit 'built' { what: 'megaSaw', ... };
 *   register collider megaSaw.base.
 */
import * as THREE from 'three';
import { COLORS, LAYOUT, PALETTE } from '../config';
import { createMegaSaw, type MegaSawModel } from '../assets/machines';
import { damp, lerp } from '../core/math';
import type { GameContext } from '../core/types';
import type { GiantLog } from './GiantLog';

export interface MegaSawOptions {
  log: GiantLog;
}

/** Cycle timeline (fractions of cycleTime): plunge, hold + cut, rise, rest. */
const P_PLUNGE = 0.22;
const P_HOLD = 0.34;
const P_RISE = 0.7;
const STAGGER = 0.08;
const DUST_COLORS = [COLORS.LOG_CORE, COLORS.LOG_CUT_BAND, PALETTE.woodRing];

const easeIn = (t: number): number => t * t * t;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);

export class MegaSaw {
  readonly object = new THREE.Group();
  readonly model: MegaSawModel;
  private built = false;
  /** Cycle phase 0…1 (0 = parked at the top). Advances by dt / cycle, so a level change never makes it jump. */
  private phase = 0;
  private bladeRate = 0;
  private cutting = false;
  private readonly bladeWorldZ: number;
  private readonly tmp = new THREE.Vector3();
  private readonly dust = new THREE.Vector3();

  constructor(
    readonly ctx: GameContext,
    readonly opts: MegaSawOptions,
  ) {
    const M = LAYOUT.megaSaw;
    this.model = createMegaSaw(M.bladeRadius);
    this.bladeWorldZ = M.z + this.model.bladeZ;
    this.object.add(this.model.root);
    this.object.position.set(M.x, 0, M.z);
    this.object.visible = false;
    ctx.scene.add(this.object);
  }

  /** instant (restoring a save): final state at once — no animation, no 'built' event, no sound. */
  build(instant = false): void {
    if (this.built) return;
    this.built = true;
    const ctx = this.ctx;
    const M = LAYOUT.megaSaw;
    ctx.colliders.addBox(M.base, 'megaSaw');
    this.phase = 0;
    this.model.badge.setLevel(ctx.upgrades.level('megaSaw'));
    ctx.events.on('upgrade:bought', ({ id }) => {
      if (id !== 'megaSaw') return;
      ctx.tweens.squash(this.object, 0.06, 0.5);
      this.tmp.set(M.x + 3.3, 2.2, M.z);
      ctx.particles.puff(this.tmp, { count: 8, size: 0.9, life: 1 });
    });
    if (instant) {
      this.object.visible = true;
      return;
    }
    ctx.tweens.popIn(this.object, { duration: 0.7 });
    ctx.tweens.delay(0.75, () => {
      ctx.tweens.squash(this.object, 0.08, 0.4);
      ctx.cameraRig.shake(0.12, 0.2);
    });
    ctx.events.emit('built', { what: 'megaSaw', position: new THREE.Vector3(M.x, 0, M.z), object: this.object });
  }

  /** Seconds per cut at the current level (read live). */
  get cycleTime(): number {
    return this.ctx.upgrades.value('megaSaw');
  }

  update(dt: number): void {
    if (!this.built) return;
    const m = this.model;
    const cycle = this.cycleTime;
    // 1 at level 0, ~1.8 at max: blade and beacons keep up with the cut rate
    const speed = LAYOUT.megaSaw.cycleTime / cycle;
    const full = this.opts.log.opts.dropZone.isFull;
    const atRest = this.phase >= P_RISE || this.phase === 0;
    m.badge.setLevel(this.ctx.upgrades.level('megaSaw'));

    // advance the cycle (a new one only starts when the drop zone has room)
    if (this.phase > 0 || !full) this.phase += dt / cycle;
    if (this.phase >= 1) {
      this.phase = full ? 0 : this.phase - 1;
      this.cutting = false;
    }
    const p = this.phase;

    let y = m.restY;
    if (p > 0 && p < P_PLUNGE) y = lerp(m.restY, m.cutY, easeIn(p / P_PLUNGE));
    else if (p >= P_PLUNGE && p < P_HOLD) y = m.cutY;
    else if (p >= P_HOLD && p < P_RISE) y = lerp(m.cutY, m.restY, easeOut((p - P_HOLD) / (P_RISE - P_HOLD)));
    m.carriage.position.y = y;
    m.updateRods();

    if (p >= P_PLUNGE && !this.cutting && p < P_HOLD) {
      this.cutting = true;
      this.cut(cycle);
    }

    // blade + beacons
    const busy = p > 0 && p < P_RISE;
    this.bladeRate = damp(this.bladeRate, (busy ? 46 : atRest && full ? 4 : 14) * (0.6 + 0.4 * speed), busy ? 10 : 3, dt);
    m.blade.rotation.z -= this.bladeRate * dt;
    for (const b of m.beacons) b.rotation.y += dt * 4 * speed;
  }

  // ---------------------------------------------------------------------------

  /** Bottom of the plunge: launch the pieces, spray sawdust, shake the camera. */
  private cut(cycle: number): void {
    const ctx = this.ctx;
    const M = LAYOUT.megaSaw;
    ctx.cameraRig.shake(0.08, 0.15);
    this.dust.set(M.x, 1.5, this.bladeWorldZ);
    ctx.particles.burst(this.dust, { colors: DUST_COLORS, count: 16, speed: 5, size: 0.2, spread: 1.2, life: 0.7, shape: 'chip' });
    this.dust.y = 1.2;
    ctx.particles.burst(this.dust, { colors: DUST_COLORS, count: 8, speed: 3.2, size: 0.14, spread: 1.5, life: 0.5, shape: 'cube', gravity: 8 });
    for (let i = 0; i < M.logsPerCycle; i++) {
      const fire = (): void => {
        this.tmp.set(M.x + 1.2 + (i - 1) * 0.35, 1.5 + i * 0.1, this.bladeWorldZ + 0.2 + i * 0.25);
        this.opts.log.chopPiece(this.tmp, 'megaSaw');
      };
      if (i === 0) fire();
      else ctx.tweens.delay(i * STAGGER * (cycle / LAYOUT.megaSaw.cycleTime), fire);
    }
  }
}
