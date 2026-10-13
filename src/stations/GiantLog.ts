/**
 * [B6 — machines] The massive floating tree trunk + manual chopping. STUB (functional baseline):
 * replace/extend, keep the public API.
 *
 * Spec: "The River & Giant Log (North-West): A river channel holding a massive, oversized tree trunk
 * floating against a wooden fence/gate." "Initial Event: A giant tree trunk floats down the river and
 * crashes into the yard's river gate." "Manual Chopping: When the player stands next to the giant log,
 * they swing an axe automatically. Chopped wood pieces fly out and land neatly in the grey 'Raw Log
 * Drop Zone' pile."
 *
 * - Model (LAYOUT.giantLog, axis along world Z): huge bark cylinder (PALETTE.bark) with darker bark
 *   ridges/strips, knots and a couple of broken branch stubs, snow lying along the top, end caps with
 *   light wood + concentric growth rings (canvas texture). Floats: slow bob + slight roll; a white
 *   foam/ripple ring where it meets the water (y = LAYOUT.river.waterY).
 * - playIntro(onCrash, onSettled): start at introStartZ, float +Z (speeding up a little) for
 *   introDuration, hit the gate: emit 'intro:crash' { position: gate contact point }, call onCrash,
 *   bounce back ~0.7 and settle with a damped spring (~1 s), then call onSettled. (Camera work is the
 *   caller's.) placeAtRest(): skip straight to the resting pose.
 * - Chopping: a zone over LAYOUT.chopZone (marker on) that, while enabled (setChoppable) and the player
 *   is inside, calls ctx.player.setChopTarget(surfacePoint(player position)) every step — or null when
 *   the drop zone is full; onExit → setChopTarget(null). Listen to 'player:chopHit' → chopPiece(point,
 *   'player') (only while choppable).
 * - chopPiece(from, source): if the drop zone pile can accept a log → launchNew('log', from, pile,
 *   { duration: TIMING.launchTime, arcHeight: TIMING.launchHeight, spin: 1 }); emit 'log:chopped';
 *   stats.logsChopped++; a small punch/wobble of the trunk; return true. Else false.
 *   Used by the player, the Harvester and the MegaSaw.
 */
import * as THREE from 'three';
import { LAYOUT, PALETTE, TIMING } from '../config';
import { clamp } from '../core/math';
import type { GameContext, LogSource } from '../core/types';
import { launchNew } from '../items/transfer';
import type { Zone } from '../items/Zones';
import { geo, mesh, toon } from '../render/materials';
import type { DropZone } from './DropZone';

export interface GiantLogOptions {
  dropZone: DropZone;
}

export class GiantLog {
  readonly object = new THREE.Group();
  readonly chopZone: Zone;
  private choppable = false;

  constructor(
    readonly ctx: GameContext,
    readonly opts: GiantLogOptions,
  ) {
    const g = LAYOUT.giantLog;
    const trunk = mesh(geo.cylinder(g.radius, g.radius, g.length, 20), toon(PALETTE.bark));
    trunk.rotation.x = Math.PI / 2;
    this.object.add(trunk);
    ctx.scene.add(this.object);
    this.placeAtRest();
    this.chopZone = ctx.zones.add({
      id: 'zone:chop',
      area: LAYOUT.chopZone,
      marker: true,
      onStay: () => {
        if (!this.choppable) return;
        const p = new THREE.Vector3();
        ctx.player.setChopTarget(this.opts.dropZone.isFull ? null : this.surfacePoint(ctx.player.position, p));
      },
      onExit: () => ctx.player.setChopTarget(null),
    });
    ctx.events.on('player:chopHit', ({ position }) => {
      if (this.choppable) this.chopPiece(position, 'player');
    });
  }

  playIntro(onCrash: () => void, onSettled: () => void): void {
    this.placeAtRest();
    onCrash();
    onSettled();
  }

  placeAtRest(): void {
    const g = LAYOUT.giantLog;
    this.object.position.set(g.x, g.y, g.z);
  }

  setChoppable(on: boolean): void {
    this.choppable = on;
    if (!on) this.ctx.player.setChopTarget(null);
  }

  /** Point on the trunk surface nearest to `near` (at roughly chest height). */
  surfacePoint(near: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const g = LAYOUT.giantLog;
    const p = this.object.position;
    const z = clamp(near.z, p.z - g.length / 2 + 0.4, p.z + g.length / 2 - 0.4);
    return out.set(p.x + g.radius * 0.85, 0.8, z);
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
    return true;
  }

  update(_dt: number): void {}
}
