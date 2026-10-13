/**
 * [B6 — machines] Phase 3: blue wood processing machine (logs → square wooden crates).
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
import { LAYOUT, TIMING, rect } from '../config';
import { createProcessor, type ProcessorModel } from '../assets/machines';
import { damp, smoothstep } from '../core/math';
import type { GameContext, Item } from '../core/types';
import { Pile } from '../items/Pile';
import { launchNew } from '../items/transfer';
import type { Zone } from '../items/Zones';

/** Timeline (seconds after a log is taken): slide to the mouth, slide in, chew, crate pops out. */
const T_MOUTH = 0.22;
const T_IN = 0.5;
const T_POP = 0.85;
/** Log height while travelling into the tunnel. */
const LOG_Y = 0.6;

type State = 'idle' | 'busy' | 'blocked' | 'cooldown';

export class Processor {
  readonly object = new THREE.Group();
  readonly model: ProcessorModel;
  readonly input: Pile;
  readonly output: Pile;
  readonly inputZone: Zone;
  readonly outputZone: Zone;

  private built = false;
  private state: State = 'idle';
  private t = 0;
  private cur: Item | null = null;
  private swallowed = false;
  private puffClock = 0;
  private lamp = 0;
  private readonly start = new THREE.Vector3();
  private readonly mouth = new THREE.Vector3();
  private readonly inside = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(readonly ctx: GameContext) {
    const P = LAYOUT.processor;
    this.model = createProcessor();
    this.object.add(this.model.root);
    this.object.position.set(P.x, 0, P.z);
    ctx.scene.add(this.object);
    this.mouth.set(P.x - P.w / 2 - 0.3, LOG_Y, P.z);
    this.inside.set(P.x - 0.1, LOG_Y, P.z);

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

  /** Pop in with a squash, register the colliders, announce. */
  /** instant (restoring a save): final state at once — no animation, no 'built' event, no sound. TODO(owner): honour it. */
  build(instant = false): void {
    if (this.built) return;
    this.built = true;
    const ctx = this.ctx;
    const P = LAYOUT.processor;
    ctx.colliders.addBox(rect(P.x, P.z, P.w, P.d), 'processor');
    ctx.colliders.addBox(rect(P.hopper.x, P.hopper.z, P.hopper.w, P.hopper.d), 'processor:tray');
    ctx.colliders.addBox(rect(P.outputTable.x, P.outputTable.z, P.outputTable.w, P.outputTable.d), 'processor:bench');
    ctx.tweens.popIn(this.object, { duration: 0.5 });
    ctx.tweens.delay(0.55, () => ctx.tweens.squash(this.model.body, 0.15, 0.4));
    ctx.events.emit('built', { what: 'processor', position: new THREE.Vector3(P.x, 0, P.z), object: this.object });
  }

  update(dt: number): void {
    if (!this.built) return;
    const P = LAYOUT.processor;
    const body = this.model.body;

    if (this.state === 'idle') {
      if (this.input.count('log') > 0 && this.output.canAccept('crate')) this.startCycle();
    } else {
      this.t += dt;
      this.advance();
    }

    // chew shudder + status lamp + chimney smoke while busy
    const chewing = this.state === 'busy' && this.t >= T_IN && this.t < T_POP;
    body.position.x = chewing ? Math.sin(this.t * 70) * 0.014 : 0;
    this.lamp = damp(this.lamp, this.state === 'idle' ? 0 : 1, 10, dt);
    this.model.lampMaterial.emissiveIntensity = this.lamp * 1.3;
    if (this.state !== 'idle') {
      this.puffClock -= dt;
      if (this.puffClock <= 0) {
        this.puffClock = 0.28;
        this.tmp.set(P.x + this.model.chimney.x, this.model.chimney.y, P.z + this.model.chimney.z);
        this.ctx.particles.puff(this.tmp, { count: 2, size: 0.32, life: 0.9 });
      }
    }
  }

  // ---------------------------------------------------------------------------

  private startCycle(): void {
    const log = this.input.take('log');
    if (!log) return;
    this.cur = log;
    this.swallowed = false;
    this.start.copy(log.object.position);
    log.object.quaternion.identity();
    this.state = 'busy';
    this.t = 0;
    this.puffClock = 0;
  }

  /** Move the slide / fire the pop according to the timeline. */
  private advance(): void {
    const P = LAYOUT.processor;
    const cur = this.cur;
    if (cur && !this.swallowed) {
      if (this.t < T_MOUTH) {
        const k = smoothstep(0, T_MOUTH, this.t);
        cur.object.position.lerpVectors(this.start, this.mouth, k);
        cur.object.position.y += Math.sin(k * Math.PI) * 0.15;
      } else if (this.t < T_IN) {
        const k = smoothstep(T_MOUTH, T_IN, this.t);
        cur.object.position.lerpVectors(this.mouth, this.inside, k);
      } else {
        // fully inside: eaten
        this.swallowed = true;
        this.ctx.tweens.killTweensOf(cur.object);
        this.ctx.items.release(cur);
        this.cur = null;
        this.ctx.tweens.squash(this.model.body, 0.14, 0.4);
      }
    }
    if ((this.state === 'busy' || this.state === 'blocked') && this.t >= T_POP) {
      this.tmp.set(P.x + P.w / 2 - 0.2, 0.72, P.z);
      const crate = launchNew(this.ctx, 'crate', this.tmp, this.output, { duration: 0.38, arcHeight: 0.5, scaleFrom: 0.5 });
      if (crate) {
        this.ctx.state.stats.cratesMade++;
        this.tmp.x += 0.3;
        this.ctx.events.emit('crate:made', { position: this.tmp });
        this.ctx.tweens.punchScale(this.model.body, 0.05, 0.2);
        this.state = 'cooldown';
      } else {
        this.state = 'blocked';
      }
    }
    if (this.state === 'cooldown' && this.t >= P.cycleTime) this.state = 'idle';
  }
}
