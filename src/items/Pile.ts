/**
 * [B2 — items] World pile laid out as a neat 3D grid (drop zone, counter tops, hopper, output
 * table, cash piles, vehicle cargo beds). STUB: replace bodies, keep the public API.
 *
 * Grid math (pile-local space, logs lie along local X):
 *   slot i → layer = floor(i / (cols*rows)); within layer: col = i % cols, row = floor(i / cols) % rows
 *   local position = ((col - (cols-1)/2)·sx, layer·sy + itemHalfHeight, (row - (rows-1)/2)·sz)
 *   so the grid is centred on the pile origin and layer 0 rests on the origin plane.
 * Fill order: layer by layer, bottom up. reserve() takes the LOWEST free slot index; take() removes
 * the HIGHEST landed slot (of that kind) — piles visibly grow upward and shrink from the top.
 * Items get a tiny random yaw jitter (±3°) for a hand-stacked look; landing gives a small scale punch.
 * `overflowMerge` (cash piles): when every slot is taken, canAccept('cash') stays true and arriving
 * bundles merge their value into the top item (so passive income never stalls).
 * Items are parented to `root` (which lives under opts.parent or ctx.scene), so piles on moving
 * parents (tricycle beds) carry their items along.
 */
import * as THREE from 'three';
import type { PileGrid } from '../config';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';

export interface PileOptions {
  id: string;
  accepts: readonly ItemKind[];
  /** Base centre in parent space (world when no parent). Layer 0 sits on this plane. */
  position: THREE.Vector3;
  rotationY?: number;
  parent?: THREE.Object3D;
  grid: PileGrid;
  overflowMerge?: boolean;
}

export class Pile implements ItemHolder {
  readonly id: string;
  readonly root = new THREE.Group();
  readonly capacity: number;

  constructor(
    readonly ctx: GameContext,
    readonly opts: PileOptions,
  ) {
    this.id = opts.id;
    this.capacity = opts.grid.cols * opts.grid.rows * opts.grid.layers;
    this.root.position.copy(opts.position);
    this.root.rotation.y = opts.rotationY ?? 0;
    (opts.parent ?? ctx.scene).add(this.root);
  }

  // --- ItemHolder -----------------------------------------------------------
  canAccept(_kind: ItemKind): boolean {
    return false;
  }
  reserve(_item: Item): Slot {
    return { holder: this };
  }
  getSlotWorldPosition(_slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    return this.root.getWorldPosition(out);
  }
  getSlotWorldQuaternion(_slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return this.root.getWorldQuaternion(out);
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
  get total(): number {
    return 0;
  }
  isFull(): boolean {
    return false;
  }
  isEmpty(): boolean {
    return true;
  }
  /** Place an item straight into the next free slot (no flight). False if full. */
  addImmediate(_item: Item): boolean {
    return false;
  }
  /** Create `n` items of `kind` from the pool and addImmediate them (setup / tests). */
  fill(_kind: ItemKind, _n: number): void {}
  /** Sum of landed item values (cash piles). */
  totalValue(): number {
    return 0;
  }
  /** World position just above the current top item (base when empty). */
  topWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.root.getWorldPosition(out);
  }
  /** Release every item back to the pool. */
  clear(): void {}
}
