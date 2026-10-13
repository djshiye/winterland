/**
 * [B6 — machines] Phase 4: roller conveyor that carries items from one holder to another.
 * Functional BASELINE (no belt: hops one item straight from `from` to `to` every spacing/speed s):
 * replace the body, keep the public API.
 *
 * Spec: "West Conveyor: Builds a conveyor belt directly from the Raw Log Drop Zone to the Walk-in
 * Customer Counter. Logs now flow automatically to walk-in customers, generating passive cash piles."
 * "East Conveyor: Builds a conveyor belt from the Raw Log Drop Zone directly into the Wood Processing
 * Machine, fully automating crate production."
 *
 * Art spec (AssetFactory createRollerConveyor in assets/machines.ts — yours): ROLLER conveyor — steel
 * (MACHINE_STEEL) side rails with CLOSELY SPACED dark grey ROLLER CYLINDERS (that visibly spin), short
 * legs; items follow a WAYPOINT SPLINE through `path` (polyline in XZ; may have more than 2 points —
 * round the corners, e.g. CatmullRom or arc fillets). Top of the rollers at beltY. NO collider (the
 * player may walk across).
 *
 * - Mechanics: the conveyor is itself an ItemHolder (id opts.id). Each step: if the last item on the
 *   belt has moved ≥ spacing from the start and `to` will be able to take more (items on belt <
 *   max-on-belt), pull one item from `from` with transferOne(ctx, from, this, [kind]) so it hops onto
 *   the belt start; items ride along the spline at `speed` (logs lying across the belt at itemYaw
 *   relative to the travel direction) and queue behind each other (spacing) when the end is blocked.
 *   An item at the end is handed over with transferOne(ctx, this, to, [kind]).
 * - `to` may be a converting holder (walk-in counter input: logs in, planks out) — just transfer into it.
 * - build(): segments pop in one after another from start to end (staggered popIn), then emit
 *   'built' { what: opts.id, position: midpoint, object }. Inactive before build().
 */
import * as THREE from 'three';
import type { XZ } from '../config';
import type { GameContext, ItemHolder, ItemKind } from '../core/types';
import { transferOne } from '../items/transfer';

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
  private active = false;
  private baselineClock = 0;

  constructor(
    readonly ctx: GameContext,
    readonly opts: ConveyorOptions,
  ) {}

  /** Items currently riding the belt. */
  get load(): number {
    return 0;
  }

  build(): void {
    this.active = true;
  }

  update(dt: number): void {
    // BASELINE (replace): teleport-hop items without a belt.
    if (!this.active) return;
    this.baselineClock += dt;
    if (this.baselineClock < this.opts.spacing / this.opts.speed) return;
    this.baselineClock = 0;
    transferOne(this.ctx, this.opts.from, this.opts.to, [this.opts.kind]);
  }
}
