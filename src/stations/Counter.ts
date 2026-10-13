/**
 * [B5 — commerce] Wooden sales counter with an item pile on top. STUB (functional baseline without
 * visuals): replace/extend, keep the public API.
 *
 * - Model (local space, long axis along local X, front = local +Z faces the buyers OUTSIDE the yard
 *   for the walk-in counter... see note): sturdy plank top (PALETTE.plank) on a darker body
 *   (PALETTE.fenceDark), front panel planks, little awning or sign post with an icon (log / crate)
 *   telling what is sold here. Size opts.length × opts.height × opts.depth. Root at floor centre,
 *   rotated by opts.rotationY. Casts/receives shadows. Collider = footprint (account for rotation).
 *   Note: buyers stand on the far side from the player zone; you don't need to know which side —
 *   the player zone rect and the NPC queue positions come from config.
 * - pile: Pile on the top surface (parent = this.object, so rotation applies and appear() scales it).
 * - zone: player.arms → pile transfer zone (kinds [opts.accepts], TIMING.dropInterval, marker).
 * - appear(): scale-bounce in (ctx.tweens.popIn) + emit 'built' { what: opts.id, position, object }.
 *   Counters created at level start call nothing (they are simply there).
 */
import * as THREE from 'three';
import { TIMING, rect, type PileGrid, type Rect } from '../config';
import type { GameContext, ItemKind } from '../core/types';
import { Pile } from '../items/Pile';
import type { Zone } from '../items/Zones';

export interface CounterOptions {
  /** Holder id of the top pile, e.g. 'counter:walkIn'. */
  id: string;
  x: number;
  z: number;
  length: number;
  depth: number;
  height: number;
  rotationY: number;
  accepts: ItemKind;
  grid: PileGrid;
  playerZone: Rect;
}

export class Counter {
  readonly object = new THREE.Group();
  readonly pile: Pile;
  readonly zone: Zone;

  constructor(
    readonly ctx: GameContext,
    readonly opts: CounterOptions,
  ) {
    this.object.position.set(opts.x, 0, opts.z);
    this.object.rotation.y = opts.rotationY;
    ctx.scene.add(this.object);
    const alongZ = Math.abs(Math.sin(opts.rotationY)) > 0.5;
    ctx.colliders.addBox(
      rect(opts.x, opts.z, alongZ ? opts.depth : opts.length, alongZ ? opts.length : opts.depth),
      opts.id,
    );
    this.pile = new Pile(ctx, {
      id: opts.id,
      accepts: [opts.accepts],
      position: new THREE.Vector3(0, opts.height, 0),
      parent: this.object,
      grid: opts.grid,
    });
    this.zone = ctx.zones.addTransfer({
      id: `${opts.id}:drop`,
      area: opts.playerZone,
      from: ctx.player.arms,
      to: this.pile,
      kinds: [opts.accepts],
      interval: TIMING.dropInterval,
      marker: true,
    });
  }

  /** World position on top of the counter (for guide arrows / effects). */
  topWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.pile.topWorldPosition(out);
  }

  appear(): void {
    this.ctx.tweens.popIn(this.object);
  }
}
