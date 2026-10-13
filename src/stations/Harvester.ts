/**
 * [B6 — machines] Phase 2: blue track-mounted mechanical saw on the river bank.
 * Functional BASELINE (invisible; chops a piece every interval): replace the body, keep the API.
 *
 * Spec: "Spawns a blue track-mounted Mechanical Saw/Harvester next to the giant log. It automatically
 * moves back and forth along tracks, sawing the giant log and continuously launching raw wood pieces
 * into the Raw Log Drop Zone pile without player intervention."
 *
 * Art spec (AssetFactory createHarvester in assets/machines.ts — yours): TWO dark-steel rails parallel
 * to the log (along Z at LAYOUT.harvester.railX, railMinZ…railMaxZ, on sleepers); a blue (MACHINE_BLUE)
 * BOXY CHASSIS sliding on them; TWO HINGED blue BOOM ARMS (shoulder + elbow pivots) reaching −X over the
 * trunk and ending in a SPINNING CIRCULAR SAW with teeth (MACHINE_STEEL disc, SAW_GLOW accents);
 * continuous LOG_CORE chip particles at the blade while cutting.
 *
 * - Shuttles between minTravelZ and maxTravelZ with eased turnarounds, blade always spinning (faster
 *   while cutting), booms flexing slightly. Every LAYOUT.harvester.interval seconds, if the drop zone has
 *   room, calls log.chopPiece(blade contact point on the trunk, 'harvester') — JuiceDirector adds
 *   sawdust on 'log:chopped' — plus a little body judder. Idles (blade slows) when the pile is full.
 * - build(): appear with popIn + squash, emit 'built' { what: 'harvester', position, object }; register
 *   collider LAYOUT.harvester.collider. Not visible/active before build().
 */
import * as THREE from 'three';
import { LAYOUT } from '../config';
import { lerp } from '../core/math';
import type { GameContext } from '../core/types';
import type { GiantLog } from './GiantLog';

export interface HarvesterOptions {
  log: GiantLog;
}

export class Harvester {
  readonly object = new THREE.Group();
  private active = false;
  private baselineClock = 0;
  private travel = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly ctx: GameContext,
    readonly opts: HarvesterOptions,
  ) {}

  build(): void {
    this.active = true;
    this.ctx.colliders.addBox(LAYOUT.harvester.collider, 'harvester');
  }

  update(dt: number): void {
    // BASELINE (replace): invisible saw sweeping the trunk.
    if (!this.active) return;
    const H = LAYOUT.harvester;
    const G = LAYOUT.giantLog;
    this.travel += dt;
    this.baselineClock += dt;
    if (this.baselineClock < H.interval) return;
    this.baselineClock = 0;
    const z = lerp(H.minTravelZ, H.maxTravelZ, 0.5 + 0.5 * Math.sin(this.travel * 0.6));
    this.opts.log.chopPiece(this.tmp.set(G.x + G.radius * 0.8, 1.0, z), 'harvester');
  }
}
