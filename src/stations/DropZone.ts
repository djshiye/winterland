/**
 * [B6 — machines] Grey "Raw Log Drop Zone" slab + the log pile on it. STUB (functional baseline):
 * replace/extend, keep the public API.
 *
 * Spec: "a grey rectangular 'Raw Log Drop Zone' on the ground"; "Chopped wood pieces fly out and land
 * neatly in the grey 'Raw Log Drop Zone' pile"; "Player walks over the Raw Log Drop Zone to pick up
 * logs into their vertical carry stack."
 * - Slab: LAYOUT.dropZone.slab size, PALETTE.dropSlab with a darker bevelled edge (dropSlabEdge),
 *   maybe painted corner marks / a faint log icon. Pile sits on the slab top.
 * - pile id 'pile:dropZone', accepts ['log'], LAYOUT.dropZone.grid (capacity 60).
 * - zone: pile → player.arms (kinds ['log'], TIMING.pickupInterval, marker) over LAYOUT.dropZone.zone.
 * - Collider LAYOUT.dropZone.collider (the pile is solid; the player picks up from beside it).
 * - While full: a "FULL" badge (canvas sprite) above the pile, gently bobbing.
 */
import * as THREE from 'three';
import { LAYOUT, PALETTE, TIMING } from '../config';
import type { GameContext } from '../core/types';
import { Pile } from '../items/Pile';
import type { Zone } from '../items/Zones';
import { geo, mesh, toon } from '../render/materials';

/** Height of the slab top (the pile's base plane). */
export const DROP_SLAB_HEIGHT = 0.08;

export class DropZone {
  readonly object = new THREE.Group();
  readonly pile: Pile;
  readonly zone: Zone;

  constructor(readonly ctx: GameContext) {
    const dz = LAYOUT.dropZone;
    const slab = mesh(geo.boxBase(dz.slab.w, DROP_SLAB_HEIGHT, dz.slab.d), toon(PALETTE.dropSlab), { cast: false });
    this.object.add(slab);
    this.object.position.set(dz.x, 0, dz.z);
    ctx.scene.add(this.object);
    this.pile = new Pile(ctx, {
      id: 'pile:dropZone',
      accepts: ['log'],
      position: new THREE.Vector3(dz.x, DROP_SLAB_HEIGHT, dz.z),
      grid: dz.grid,
    });
    ctx.colliders.addBox(dz.collider, 'pile:dropZone');
    this.zone = ctx.zones.addTransfer({
      id: 'pile:dropZone:pickup',
      area: dz.zone,
      from: this.pile,
      to: ctx.player.arms,
      kinds: ['log'],
      interval: TIMING.pickupInterval,
      marker: true,
    });
  }

  get isFull(): boolean {
    return !this.pile.canAccept('log');
  }

  update(_dt: number): void {}
}
