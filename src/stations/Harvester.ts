/**
 * [B6 — machines] Phase 2: blue track-mounted mechanical saw on the river bank. STUB: replace bodies,
 * keep the public API.
 *
 * Spec: "Spawns a blue track-mounted Mechanical Saw/Harvester next to the giant log. It automatically
 * moves back and forth along tracks, sawing the giant log and continuously launching raw wood pieces
 * into the Raw Log Drop Zone pile without player intervention."
 *
 * - Model: rail track along the bank (LAYOUT.harvester rail: two metal rails + wooden sleepers from
 *   railMinZ to railMaxZ at railX); machine body (PALETTE.machine with machineDark trim, yellow accent
 *   stripes/hazard markings, small cab window, exhaust pipe) on wheels/bogies riding the rails; an arm
 *   reaching −X over the trunk carrying a big spinning circular saw blade (metal disc + teeth).
 * - Shuttles between minTravelZ and maxTravelZ with eased turnarounds (sine), blade always spinning
 *   (faster while cutting). Every LAYOUT.harvester.interval seconds, if the drop zone has room, calls
 *   log.chopPiece(blade contact point on the trunk, 'harvester') — sawdust comes from JuiceDirector via
 *   the 'log:chopped' event — plus a little body judder (squash). Idles (blade slows) when the pile is full.
 * - build(): appear with popIn + squash, emit 'built' { what: 'harvester', position, object }; register
 *   collider LAYOUT.harvester.collider. Not visible/active before build().
 */
import * as THREE from 'three';
import type { GameContext } from '../core/types';
import type { GiantLog } from './GiantLog';

export interface HarvesterOptions {
  log: GiantLog;
}

export class Harvester {
  readonly object = new THREE.Group();

  constructor(
    readonly ctx: GameContext,
    readonly opts: HarvesterOptions,
  ) {}

  build(): void {}

  update(_dt: number): void {}
}
