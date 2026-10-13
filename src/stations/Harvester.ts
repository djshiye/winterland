/**
 * [B6 — machines] Phase 2: blue track-mounted mechanical saw on the river bank.
 *
 * Spec: "Spawns a blue track-mounted Mechanical Saw/Harvester next to the giant log. It automatically
 * moves back and forth along tracks, sawing the giant log and continuously launching raw wood pieces
 * into the Raw Log Drop Zone pile without player intervention."
 *
 * Model: assets/machines.ts createHarvester — two dark-steel rails (LAYOUT.harvester.railX, on sleepers),
 * a blue boxy chassis on wheels, TWO hinged boom forks (shoulder + elbow, posed by 2-link IK) holding a
 * spinning toothed circular saw over the trunk, blinking beacon.
 *
 * - Shuttles between minTravelZ and maxTravelZ (sinusoidal, so the turnarounds are eased), blade always
 *   spinning (faster while cutting), booms flexing. Every LAYOUT.harvester.interval seconds, if the drop
 *   zone has room, calls log.chopPiece(blade contact point, 'harvester') — JuiceDirector adds the sawdust
 *   on 'log:chopped' — plus a plunge of the booms. LOG_CORE chips spray continuously from the cut while
 *   working. A LOG_CUT_BAND ring follows the blade along the trunk (log.setSawMark).
 * - Idles (stops, blade slows, no chips) when the drop-zone pile is full.
 * - build(): pop in + squash, emit 'built' { what: 'harvester', position, object }; register collider
 *   LAYOUT.harvester.collider. Invisible and inactive before build().
 */
import * as THREE from 'three';
import { COLORS, LAYOUT, PALETTE } from '../config';
import { createHarvester, type HarvesterModel } from '../assets/machines';
import { damp } from '../core/math';
import type { GameContext } from '../core/types';
import type { GiantLog } from './GiantLog';

export interface HarvesterOptions {
  log: GiantLog;
}

/** Seconds for one full back-and-forth trip. */
const SHUTTLE_PERIOD = 9;
const CHIP_INTERVAL = 0.045;
const CHIP_COLORS = [COLORS.LOG_CORE, COLORS.LOG_CUT_BAND, PALETTE.woodRing];
const CHIP_DIR = new THREE.Vector3(1, 0.55, 0.15);

export class Harvester {
  readonly object = new THREE.Group();
  readonly model: HarvesterModel;
  private active = false;
  private startAt = 0;
  private phase = 0;
  /** 0 = idle, 1 = fully working (smoothed). */
  private work = 0;
  private bladeRate = 0;
  private cutClock = 0;
  private chipClock = 0;
  private kick = 0;
  private readonly midZ = (LAYOUT.harvester.railMinZ + LAYOUT.harvester.railMaxZ) / 2;
  private readonly tmp = new THREE.Vector3();
  private readonly chipPos = new THREE.Vector3();

  constructor(
    readonly ctx: GameContext,
    readonly opts: HarvesterOptions,
  ) {
    const H = LAYOUT.harvester;
    this.model = createHarvester(H.railMaxZ - H.railMinZ);
    this.object.add(this.model.root);
    this.object.position.set(H.railX, 0, this.midZ);
    this.object.visible = false;
    this.placeChassis();
    ctx.scene.add(this.object);
  }

  /** instant (restoring a save): final state at once — no animation, no 'built' event, no sound. TODO(owner): honour it. */
  build(instant = false): void {
    if (this.active) return;
    const ctx = this.ctx;
    this.active = true;
    this.startAt = ctx.time.elapsed + 0.7;
    ctx.colliders.addBox(LAYOUT.harvester.collider, 'harvester');
    ctx.tweens.popIn(this.object, { duration: 0.5 });
    ctx.tweens.delay(0.55, () => ctx.tweens.squash(this.object, 0.12, 0.35));
    ctx.events.emit('built', { what: 'harvester', position: new THREE.Vector3(LAYOUT.harvester.railX, 0, this.midZ), object: this.object });
  }

  update(dt: number): void {
    if (!this.active) return;
    const ctx = this.ctx;
    const H = LAYOUT.harvester;
    const m = this.model;
    const t = ctx.time.elapsed;
    m.beacon.rotation.y += dt * 5;

    const running = t >= this.startAt;
    const canWork = running && !this.opts.log.opts.dropZone.isFull;
    this.work = damp(this.work, canWork ? 1 : 0, canWork ? 4 : 2.5, dt);

    // shuttle along the rails (eased turnarounds), slows to a stop when idle
    this.phase += dt * this.work * ((Math.PI * 2) / SHUTTLE_PERIOD);
    this.placeChassis();

    // blade
    this.bladeRate = damp(this.bladeRate, 4 + 24 * this.work, 5, dt);
    m.saw.rotation.z -= this.bladeRate * dt;

    // booms: plunge on every cut, small continuous flex
    this.kick = Math.max(0, this.kick - dt * 4);
    const flex = this.work;
    m.setBoom(
      m.restReach.x - 0.1 * this.kick + 0.04 * flex * Math.sin(t * 9),
      m.restReach.y + 0.05 * flex * Math.sin(t * 5.3) + 0.07 * this.kick,
    );

    if (this.work < 0.35) {
      return;
    }

    // chips (continuous) at the blade
    this.chipClock += dt;
    if (this.chipClock >= CHIP_INTERVAL) {
      this.chipClock -= CHIP_INTERVAL;
      this.sawWorld(this.chipPos);
      this.chipPos.x += 0.55;
      this.chipPos.y += 0.1;
      ctx.particles.burst(this.chipPos, {
        colors: CHIP_COLORS,
        count: 2,
        speed: 3.4,
        size: 0.13,
        spread: 0.65,
        life: 0.55,
        direction: CHIP_DIR,
        shape: 'chip',
        gravity: 12,
      });
    }

    // launch a log every interval
    this.cutClock += dt;
    if (this.cutClock >= H.interval) {
      this.sawWorld(this.tmp);
      this.tmp.x += 0.6;
      this.tmp.y += 0.35;
      if (this.opts.log.chopPiece(this.tmp, 'harvester')) {
        this.cutClock = 0;
        this.kick = 1;
        ctx.tweens.punchScale(m.chassis, 0.02, 0.18);
      } else {
        this.cutClock = H.interval;
      }
    }
  }

  // ---------------------------------------------------------------------------

  /** Chassis Z from the shuttle phase (starts at minTravelZ), mirrors the saw mark on the trunk. */
  private placeChassis(): void {
    const H = LAYOUT.harvester;
    const mid = (H.minTravelZ + H.maxTravelZ) / 2;
    const amp = (H.maxTravelZ - H.minTravelZ) / 2;
    const z = mid - amp * Math.cos(this.phase);
    this.model.chassis.position.z = z - this.midZ;
    this.opts.log.setSawMark(this.active ? z : null);
  }

  /** World position of the saw hub. */
  private sawWorld(out: THREE.Vector3): THREE.Vector3 {
    const c = this.model.chassis.position;
    const h = this.model.sawHead.position;
    return out.set(this.object.position.x + h.x, h.y, this.object.position.z + c.z + h.z);
  }
}
