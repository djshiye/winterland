/**
 * [B6 — machines] Phase 3: blue wood processing machine (logs → square wooden crates).
 * Functional BASELINE (piles + zones + instant conversion, no visuals): replace/extend, keep the API.
 *
 * Spec: "Builds a blue Wood Processing Machine ... Player picks up raw logs from the Drop Zone and
 * feeds them into the input hopper of the Processing Machine. The machine converts raw logs into
 * Square Wooden Crates on an output table."
 *
 * Art spec (AssetFactory createProcessor in assets/machines.ts — yours): blue (MACHINE_BLUE) TUNNEL box
 * 1.6 (X) × 1.5 (high) × 1.4 (Z) with dark openings on BOTH ends (−X = log intake, +X = crate exit) and
 * hazard stripes or louver slats; a wooden output WORKBENCH in FENCE_WOOD in front of the +X opening;
 * a small steel infeed tray in front of the −X opening. Steel (MACHINE_STEEL) details.
 * Layout: LAYOUT.processor (body x/z/w/d/h, hopper = infeed tray, outputTable = workbench).
 *
 * - input: Pile 'pile:processorIn' (accepts ['log'], hopper grid, rotationY 0 → logs lie along X,
 *   pointing into the tunnel) on the tray top.
 * - output: Pile 'pile:processorOut' (accepts ['crate'], outputTable grid) on the workbench top.
 * - Zones: player.arms → input over LAYOUT.processor.inputZone (kinds ['log'], dropInterval, marker);
 *   output → player.arms over outputZone (kinds ['crate'], pickupInterval, marker).
 * - Colliders: body, tray, workbench.
 * - Processing loop (every cycleTime while input has a log and output can accept a crate): take a log,
 *   animate it sliding into the −X opening, squash the body (ctx.tweens.squash), then launchNew('crate')
 *   from the +X opening onto the workbench (short arc); emit 'crate:made'; stats.cratesMade++.
 *   Idle look when starved or the bench is full.
 * - build(): popIn + squash, emit 'built' { what: 'processor', position, object }.
 */
import * as THREE from 'three';
import { LAYOUT, TIMING } from '../config';
import type { GameContext } from '../core/types';
import { Pile } from '../items/Pile';
import { launchNew } from '../items/transfer';
import type { Zone } from '../items/Zones';

export class Processor {
  readonly object = new THREE.Group();
  readonly input: Pile;
  readonly output: Pile;
  readonly inputZone: Zone;
  readonly outputZone: Zone;
  private baselineClock = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(readonly ctx: GameContext) {
    const P = LAYOUT.processor;
    this.input = new Pile(ctx, {
      id: 'pile:processorIn',
      accepts: ['log'],
      position: new THREE.Vector3(P.hopper.x, P.hopper.h, P.hopper.z),
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

  update(dt: number): void {
    // BASELINE (replace): instant log → crate conversion every cycleTime.
    const P = LAYOUT.processor;
    this.baselineClock = Math.min(this.baselineClock + dt, P.cycleTime);
    if (this.baselineClock < P.cycleTime) return;
    if (this.input.count('log') === 0 || !this.output.canAccept('crate')) return;
    const log = this.input.take('log');
    if (!log) return;
    this.baselineClock = 0;
    this.ctx.items.release(log);
    this.tmp.set(P.x + P.w / 2, P.h * 0.4, P.z);
    launchNew(this.ctx, 'crate', this.tmp, this.output, { duration: 0.3, arcHeight: 0.6 });
    this.ctx.state.stats.cratesMade++;
    this.ctx.events.emit('crate:made', { position: this.tmp });
  }
}
