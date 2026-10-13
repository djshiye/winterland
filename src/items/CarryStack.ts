/**
 * [B2 — items] Vertical carried stack with spring sway (player's arms; NPC customers' hands).
 * STUB: replace bodies, keep the public API.
 *
 * - Items stack upward from `anchor` (an Object3D on the carrier, local +Y up, carrier faces +Z):
 *   item i centre y = Σ stackHeight(items below) + stackHeight(i)/2. Logs lie along anchor-local X
 *   (across the arms). Small random yaw jitter per item.
 * - take(kind) removes the TOPMOST item of that kind; items above it smoothly drop into place
 *   (fast exponential settle, ~0.08 s) instead of snapping.
 * - reserve() appends a placeholder at the top so in-flight items aim at the right height; the
 *   placeholder moves down with the stack if something below is taken.
 * - Sway: a damped spring "lean" (anchor-local XZ) driven by the carrier's acceleration and velocity
 *   (lean opposite to acceleration, trailing behind motion); each item's horizontal offset grows
 *   with its height (~ (h/H)^1.5) and items tilt slightly along the bend. Settles with a little
 *   overshoot wobble when the carrier stops. Must feel bouncy but never detach visually.
 * - While full, show a small "MAX" badge (sprite / canvas texture) floating above the top item.
 * - capacity counts landed + reserved items.
 */
import * as THREE from 'three';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';

export interface CarryStackOptions {
  id: string;
  accepts: readonly ItemKind[];
  capacity: number;
  anchor: THREE.Object3D;
}

export class CarryStack implements ItemHolder {
  readonly id: string;
  capacity: number;

  constructor(
    readonly ctx: GameContext,
    readonly opts: CarryStackOptions,
  ) {
    this.id = opts.id;
    this.capacity = opts.capacity;
  }

  // --- ItemHolder -----------------------------------------------------------
  canAccept(_kind: ItemKind): boolean {
    return false;
  }
  reserve(_item: Item): Slot {
    return { holder: this };
  }
  getSlotWorldPosition(_slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    return this.opts.anchor.getWorldPosition(out);
  }
  getSlotWorldQuaternion(_slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return this.opts.anchor.getWorldQuaternion(out);
  }
  receive(_item: Item, _slot: Slot): void {}
  cancel(_slot: Slot): void {}
  count(_kind?: ItemKind): number {
    return 0;
  }
  take(_kind?: ItemKind): Item | null {
    return null;
  }

  // --- extras ---------------------------------------------------------------
  /** Landed + reserved items. */
  get size(): number {
    return 0;
  }
  isFull(): boolean {
    return false;
  }
  /** Sway spring + smooth re-stacking. Call every frame with the carrier's world velocity. */
  update(_dt: number, _worldVelocity: THREE.Vector3): void {}
  /** Release every item back to the pool. */
  clear(): void {}
}
