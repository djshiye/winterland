/**
 * [B6 — machines] Phase 5: massive automated river saw slicing the giant log.
 * Functional BASELINE (invisible; chops logsPerCycle pieces every cycle): replace the body, keep the API.
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
import { LAYOUT } from '../config';
import type { GameContext } from '../core/types';
import type { GiantLog } from './GiantLog';

export interface MegaSawOptions {
  log: GiantLog;
}

export class MegaSaw {
  readonly object = new THREE.Group();
  private active = false;
  private baselineClock = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly ctx: GameContext,
    readonly opts: MegaSawOptions,
  ) {}

  build(): void {
    this.active = true;
    this.ctx.colliders.addBox(LAYOUT.megaSaw.base, 'megaSaw');
  }

  update(dt: number): void {
    // BASELINE (replace): invisible saw.
    if (!this.active) return;
    const M = LAYOUT.megaSaw;
    this.baselineClock += dt;
    if (this.baselineClock < M.cycleTime) return;
    this.baselineClock = 0;
    for (let i = 0; i < M.logsPerCycle; i++) {
      this.opts.log.chopPiece(this.tmp.set(M.x + 1.2, 1.2, M.z + 1.0 + i * 0.3), 'megaSaw');
    }
  }
}
