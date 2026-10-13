/**
 * [B6 — machines] Phase 4: conveyor belt that carries items from one holder to another.
 * STUB: replace bodies, keep the public API.
 *
 * Spec: "West Conveyor: Builds a conveyor belt directly from the Raw Log Drop Zone to the Walk-in
 * Customer Counter. Logs now flow automatically to walk-in customers, generating passive cash piles."
 * "East Conveyor: Builds a conveyor belt from the Raw Log Drop Zone directly into the Wood Processing
 * Machine, fully automating crate production."
 *
 * - Model: straight belt along `path` (polyline in XZ; config uses 2 points): metal side rails
 *   (PALETTE.metal/metalDark), dark rubber belt (PALETTE.rubber) whose surface visibly scrolls (animated
 *   texture offset or moving slats), rollers at both ends, short legs, top surface at beltY.
 *   Collider = the belt footprint (width × length).
 * - Mechanics: the conveyor is itself an ItemHolder (id opts.id). Each step: if the last item on the
 *   belt has moved ≥ spacing from the start and `to` will be able to take more (items on belt <
 *   max-on-belt), pull one item from `from` with transferOne(ctx, from, this, [kind]) so it hops onto
 *   the belt start; items ride along the path at `speed` (logs lying across the belt at itemYaw) and
 *   stop behind each other (spacing) when the end is blocked. An item at the end is offered via
 *   take() → transferOne(ctx, this, to, [kind]) hops it into the destination.
 * - build(): segments pop in one after another from start to end (staggered popIn), then emit
 *   'built' { what: opts.id, position: midpoint, object }. Inactive before build().
 */
import * as THREE from 'three';
import type { XZ } from '../config';
import type { GameContext, ItemHolder, ItemKind } from '../core/types';

export interface ConveyorOptions {
  /** Holder id, e.g. 'conveyor:west'. */
  id: string;
  path: readonly XZ[];
  width: number;
  beltY: number;
  speed: number;
  spacing: number;
  from: ItemHolder;
  to: ItemHolder;
  kind: ItemKind;
  /** Yaw of items riding the belt (0 = log axis along world X). */
  itemYaw: number;
}

export class Conveyor {
  readonly object = new THREE.Group();

  constructor(
    readonly ctx: GameContext,
    readonly opts: ConveyorOptions,
  ) {}

  /** Items currently riding the belt. */
  get load(): number {
    return 0;
  }

  build(): void {}

  update(_dt: number): void {}
}
