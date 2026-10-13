/**
 * [B6 — machines] Phase 5: massive automated river saw slicing the giant log. STUB: replace bodies,
 * keep the public API.
 *
 * Spec: "Mega Sawmill Expansion ... slices the giant log with a massive automated river saw".
 * - Model (LAYOUT.megaSaw): steel gantry spanning the river at z ≈ megaSaw.z with its yard-side base
 *   (collider megaSaw.base) and far-bank leg; a giant circular blade (bladeRadius) on a carriage that
 *   plunges down into the trunk and rises again each cycle (cycleTime), spinning fast, sparks/sawdust.
 * - Each cycle at the bottom of the plunge: log.chopPiece(contact point, 'megaSaw') logsPerCycle times
 *   (staggered ~0.08 s), small camera shake via ctx.cameraRig.shake(0.08, 0.15).
 * - build(): rises out of the ground / pops in with squash, emit 'built' { what: 'megaSaw', ... }.
 */
import * as THREE from 'three';
import type { GameContext } from '../core/types';
import type { GiantLog } from './GiantLog';

export interface MegaSawOptions {
  log: GiantLog;
}

export class MegaSaw {
  readonly object = new THREE.Group();

  constructor(
    readonly ctx: GameContext,
    readonly opts: MegaSawOptions,
  ) {}

  build(): void {}

  update(_dt: number): void {}
}
