/**
 * [B6 — machines] Phase 3: blue wood processing machine (logs → square wooden crates).
 * STUB (functional piles + zones, no visuals/processing): replace/extend, keep the public API.
 *
 * Spec: "Builds a blue Wood Processing Machine ... Player picks up raw logs from the Drop Zone and
 * feeds them into the input hopper of the Processing Machine. The machine converts raw logs into
 * Square Wooden Crates on an output table."
 *
 * - Model (LAYOUT.processor): chunky blue machine body (PALETTE.machine, machineDark panels, yellow
 *   accent stripes, a round gauge/porthole, a short exhaust stack that puffs while working, blinking
 *   light), an open hopper/bin on its west face where logs pile (input), a chute on the south face
 *   feeding a wooden output table where crates pile (output). Colliders for body, hopper and table.
 * - input: Pile 'pile:processorIn' (accepts ['log'], hopper grid, rotationY π/2 so logs lie along Z).
 * - output: Pile 'pile:processorOut' (accepts ['crate'], outputTable grid) on the table top.
 * - Zones: player.arms → input over LAYOUT.processor.inputZone (kinds ['log'], dropInterval, marker);
 *   output → player.arms over outputZone (kinds ['crate'], pickupInterval, marker).
 * - Processing loop (every cycleTime while input has a log and output can accept a crate): take a log
 *   from input, animate it sliding/shrinking into the machine, squash the body (ctx.tweens.squash),
 *   then launchNew('crate') from the chute mouth into output (short arc); emit 'crate:made';
 *   stats.cratesMade++. Pauses (lights off, no puffs) when starved or the table is full.
 * - build(): popIn + squash, emit 'built' { what: 'processor', position, object }.
 */
import * as THREE from 'three';
import { LAYOUT, TIMING } from '../config';
import type { GameContext } from '../core/types';
import { Pile } from '../items/Pile';
import type { Zone } from '../items/Zones';

export class Processor {
  readonly object = new THREE.Group();
  readonly input: Pile;
  readonly output: Pile;
  readonly inputZone: Zone;
  readonly outputZone: Zone;

  constructor(readonly ctx: GameContext) {
    const P = LAYOUT.processor;
    this.input = new Pile(ctx, {
      id: 'pile:processorIn',
      accepts: ['log'],
      position: new THREE.Vector3(P.hopper.x, 0.15, P.hopper.z),
      rotationY: P.hopper.rotationY,
      grid: P.hopper.grid,
    });
    this.output = new Pile(ctx, {
      id: 'pile:processorOut',
      accepts: ['crate'],
      position: new THREE.Vector3(P.outputTable.x, P.outputTable.h, P.outputTable.z),
      grid: P.outputTable.grid,
    });
    this.inputZone = ctx.zones.addTransfer({
      id: 'pile:processorIn:feed',
      area: P.inputZone,
      from: ctx.player.arms,
      to: this.input,
      kinds: ['log'],
      interval: TIMING.dropInterval,
      marker: true,
    });
    this.outputZone = ctx.zones.addTransfer({
      id: 'pile:processorOut:pickup',
      area: P.outputZone,
      from: this.output,
      to: ctx.player.arms,
      kinds: ['crate'],
      interval: TIMING.pickupInterval,
      marker: true,
    });
  }

  build(): void {}

  update(_dt: number): void {}
}
