/**
 * [B2 — items] World pile laid out as a neat 3D grid (drop zone, counter tops, hopper, output
 * table, cash piles, vehicle cargo beds).
 *
 * Grid math (pile-local space, logs lie along local X):
 *   slot i → layer = floor(i / (cols*rows)); within layer: col = i % cols, row = floor(i / cols) % rows
 *   local position = ((col - (cols-1)/2)·sx, layer·sy + itemHalfHeight, (row - (rows-1)/2)·sz)
 *   so the grid is centred on the pile origin and layer 0 rests on the origin plane.
 * Fill order: layer by layer, bottom up. reserve() takes the LOWEST free slot index; take() removes
 * the HIGHEST landed slot (of that kind) — piles visibly grow upward and shrink from the top.
 * Items get a tiny fixed yaw jitter (±3° per slot) for a hand-stacked look; landing gives a small scale punch.
 * `overflowMerge` (cash piles): when every slot is taken, canAccept('cash') stays true and arriving
 * bundles merge their value into the top item (so passive income never stalls).
 * Items are parented to `root` (which lives under opts.parent or ctx.scene), so piles on moving
 * parents (tricycle beds) carry their items along.
 * Hidden interior (0.9.0, draw calls): on a single-kind pile that does not move (no parent, or `occlude`), an item whose top and
 * camera-facing sides are covered by landed neighbours cannot be seen from the fixed isometric camera, so it is
 * not drawn (a full drop zone draws 48 logs instead of 84). Taken items are visible again.
 */
import * as THREE from 'three';
import { CAMERA, ECONOMY, ITEM_SIZE, type PileGrid } from '../config';
import { UP } from '../core/math';
import { MATERIAL_KINDS, type GameContext, type Item, type ItemHolder, type ItemKind, type Slot } from '../core/types';

export interface PileOptions {
  id: string;
  accepts: readonly ItemKind[];
  /** Base centre in parent space (world when no parent). Layer 0 sits on this plane. */
  position: THREE.Vector3;
  rotationY?: number;
  parent?: THREE.Object3D;
  grid: PileGrid;
  overflowMerge?: boolean;
  /** Hide covered interior items (default: only piles placed straight in the world). Pass true for a static parent. */
  occlude?: boolean;
}

const KIND_INDEX = { log: 0, crate: 1, cash: 2, plank: 3, furniture: 4, wheat: 5, bread: 6, meat: 7, sausage: 8, toy: 9, ...Object.fromEntries(MATERIAL_KINDS.map((k, i) => [k, 10 + i])) } as Record<ItemKind, number>;
/** Max yaw jitter in radians (±3°). */
const JITTER = (3 * Math.PI) / 180;

const tmpQuat = new THREE.Quaternion();

/** Pile landing reservation. `index` is -1 for an overflow-merge reservation. */
class PileSlot implements Slot {
  constructor(
    readonly holder: ItemHolder,
    readonly index: number,
    readonly kind: ItemKind,
  ) {}
}

export class Pile implements ItemHolder {
  readonly id: string;
  readonly root = new THREE.Group();
  readonly capacity: number;

  /** Landed item per grid slot. */
  private readonly landed: (Item | null)[];
  /** Reservation flag per grid slot. */
  private readonly reserved: Uint8Array;
  /** Per-slot deterministic yaw jitter. */
  private readonly jitter: Float32Array;
  private readonly kindCounts = Object.values(KIND_INDEX).map(() => 0);
  private landedTotal = 0;
  private reservedTotal = 0;
  private overflowReserved = 0;
  /** Highest slot index that may hold a landed item (-1 when none). */
  private hi = -1;
  /** Value of merged cash that arrived while no landed item existed. */
  private pendingValue = 0;
  /** Hide fully covered interior items (single kind, no moving parent); toward-camera grid steps in local col / row. */
  private readonly occlude: boolean;
  private readonly towardCol: number;
  private readonly towardRow: number;

  constructor(
    readonly ctx: GameContext,
    readonly opts: PileOptions,
  ) {
    this.id = opts.id;
    this.capacity = opts.grid.cols * opts.grid.rows * opts.grid.layers;
    this.landed = new Array<Item | null>(this.capacity).fill(null);
    this.reserved = new Uint8Array(this.capacity);
    this.jitter = new Float32Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) this.jitter[i] = (Math.random() * 2 - 1) * JITTER;
    this.root.position.copy(opts.position);
    this.root.rotation.y = opts.rotationY ?? 0;
    this.root.name = opts.id;
    (opts.parent ?? ctx.scene).add(this.root);
    // the camera looks from yaw CAMERA.yawDeg; express that direction in the pile's local grid axes
    const yaw = (CAMERA.yawDeg * Math.PI) / 180 - (opts.rotationY ?? 0) - (opts.parent?.rotation.y ?? 0);
    this.towardCol = Math.sign(Math.round(Math.sin(yaw) * 1000));
    this.towardRow = Math.sign(Math.round(Math.cos(yaw) * 1000));
    this.occlude = (opts.occlude ?? !opts.parent) && opts.accepts.length === 1 && opts.grid.layers > 1;
  }

  // --- ItemHolder -----------------------------------------------------------
  canAccept(kind: ItemKind): boolean {
    if (!this.opts.accepts.includes(kind)) return false;
    if (this.landedTotal + this.reservedTotal < this.capacity) return true;
    return !!this.opts.overflowMerge && kind === 'cash';
  }

  reserve(item: Item): Slot {
    const i = this.lowestFree();
    if (i < 0) {
      this.overflowReserved++;
      return new PileSlot(this, -1, item.kind);
    }
    this.reserved[i] = 1;
    this.reservedTotal++;
    return new PileSlot(this, i, item.kind);
  }

  getSlotWorldPosition(slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    const s = slot as PileSlot;
    this.root.updateWorldMatrix(true, false);
    if (s.index < 0) {
      // Overflow: aim at the top landed item.
      const top = this.hi >= 0 ? this.landed[this.hi] : null;
      if (top) return out.copy(top.object.position).applyMatrix4(this.root.matrixWorld);
      return out.set(0, 0, 0).applyMatrix4(this.root.matrixWorld);
    }
    this.slotLocal(s.index, s.kind, out);
    return out.applyMatrix4(this.root.matrixWorld);
  }

  getSlotWorldQuaternion(slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    const s = slot as PileSlot;
    this.root.updateWorldMatrix(true, false);
    this.root.getWorldQuaternion(out);
    if (s.index >= 0) out.multiply(tmpQuat.setFromAxisAngle(UP, this.jitter[s.index]!));
    return out;
  }

  receive(item: Item, slot: Slot): void {
    const s = slot as PileSlot;
    let i = s.index;
    if (i < 0) {
      this.overflowReserved = Math.max(0, this.overflowReserved - 1);
      this.mergeIntoTop(item);
      return;
    }
    if (this.reserved[i]) {
      this.reserved[i] = 0;
      this.reservedTotal--;
    }
    if (this.landed[i]) {
      // Stale slot (pile was cleared / reshuffled while the item flew): find another place.
      i = this.lowestFree();
      if (i < 0) {
        if (this.opts.overflowMerge && item.kind === 'cash') this.mergeIntoTop(item);
        else this.ctx.items.release(item);
        return;
      }
    }
    this.place(item, i);
    this.ctx.tweens.punchScale(item.object, 0.14, 0.2);
  }

  cancel(slot: Slot): void {
    const s = slot as PileSlot;
    if (s.index < 0) {
      this.overflowReserved = Math.max(0, this.overflowReserved - 1);
      return;
    }
    if (this.reserved[s.index]) {
      this.reserved[s.index] = 0;
      this.reservedTotal--;
    }
  }

  count(kind?: ItemKind): number {
    return kind === undefined ? this.landedTotal : this.kindCounts[KIND_INDEX[kind]]!;
  }

  take(kind?: ItemKind): Item | null {
    for (let i = this.hi; i >= 0; i--) {
      const item = this.landed[i];
      if (!item || (kind !== undefined && item.kind !== kind)) continue;
      this.landed[i] = null;
      this.landedTotal--;
      this.kindCounts[KIND_INDEX[item.kind]]!--;
      while (this.hi >= 0 && !this.landed[this.hi]) this.hi--;
      this.ctx.tweens.killTweensOf(item.object);
      item.object.visible = true;
      this.ctx.scene.attach(item.object);
      this.refreshHidden();
      return item;
    }
    return null;
  }

  // --- extras ---------------------------------------------------------------
  /** Landed + reserved items. */
  get total(): number {
    return this.landedTotal + this.reservedTotal;
  }

  isFull(): boolean {
    return this.landedTotal + this.reservedTotal >= this.capacity;
  }

  /** True when nothing has landed (nothing can be taken). */
  isEmpty(): boolean {
    return this.landedTotal === 0;
  }

  /** Place an item straight into the next free slot (no flight). False if full. */
  addImmediate(item: Item): boolean {
    const i = this.lowestFree();
    if (i < 0) return false;
    this.place(item, i);
    return true;
  }

  /** Create `n` items of `kind` from the pool and addImmediate them (setup / tests / restore). */
  fill(kind: ItemKind, n: number, value?: number): void {
    for (let k = 0; k < n; k++) {
      const item = this.ctx.items.create(kind, value);
      if (!this.addImmediate(item)) {
        this.ctx.items.release(item);
        return;
      }
    }
  }

  /**
   * Restore helper for cash piles: add bundles until the pile's value (landed + merged) reaches `target`.
   * Every bundle is worth ECONOMY.cashBundleValue; once the grid is full (or the target is not a multiple of a
   * bundle) the remainder is merged into the top bundle, exactly like overflow merging. No-op if already >= target.
   */
  fillValue(target: number): void {
    const unit = ECONOMY.cashBundleValue;
    let need = target - this.totalValue();
    while (need >= unit && this.landedTotal + this.reservedTotal < this.capacity) {
      const item = this.ctx.items.create('cash', unit);
      if (!this.addImmediate(item)) {
        this.ctx.items.release(item);
        break;
      }
      need -= unit;
    }
    if (need > 0) {
      const top = this.hi >= 0 ? this.landed[this.hi] : null;
      if (top) top.value += need;
      else this.pendingValue += need;
    }
  }

  /** Sum of landed item values (cash piles). */
  totalValue(): number {
    let v = this.pendingValue;
    for (let i = 0; i <= this.hi; i++) {
      const item = this.landed[i];
      if (item) v += item.value;
    }
    return v;
  }

  /** World position just above the current top item (base when empty). */
  topWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true, false);
    const top = this.hi >= 0 ? this.landed[this.hi] : null;
    if (top) {
      out.copy(top.object.position);
      out.y += ITEM_SIZE[top.kind].stackHeight / 2;
    } else {
      out.set(0, 0, 0);
    }
    return out.applyMatrix4(this.root.matrixWorld);
  }

  /** Release every item back to the pool and forget all reservations. */
  clear(): void {
    for (let i = 0; i <= this.hi; i++) {
      const item = this.landed[i];
      if (item) this.ctx.items.release(item);
      this.landed[i] = null;
    }
    this.reserved.fill(0);
    this.kindCounts.fill(0);
    this.landedTotal = 0;
    this.reservedTotal = 0;
    this.overflowReserved = 0;
    this.hi = -1;
    this.pendingValue = 0;
  }

  /** Clear and detach the pile from the scene. */
  dispose(): void {
    this.clear();
    this.root.removeFromParent();
  }

  // --- internals ------------------------------------------------------------
  private lowestFree(): number {
    for (let i = 0; i < this.capacity; i++) {
      if (!this.landed[i] && !this.reserved[i]) return i;
    }
    return -1;
  }

  /** Pile-local rest position of grid slot `i` for an item of `kind`. */
  private slotLocal(i: number, kind: ItemKind, out: THREE.Vector3): THREE.Vector3 {
    const g = this.opts.grid;
    const perLayer = g.cols * g.rows;
    const layer = Math.floor(i / perLayer);
    const col = i % g.cols;
    const row = Math.floor(i / g.cols) % g.rows;
    return out.set(
      (col - (g.cols - 1) / 2) * g.spacing.x,
      layer * g.spacing.y + ITEM_SIZE[kind].stackHeight / 2,
      (row - (g.rows - 1) / 2) * g.spacing.z,
    );
  }

  private place(item: Item, i: number): void {
    this.landed[i] = item;
    this.landedTotal++;
    this.kindCounts[KIND_INDEX[item.kind]]!++;
    if (i > this.hi) this.hi = i;
    const o = item.object;
    this.root.add(o);
    this.slotLocal(i, item.kind, o.position);
    o.quaternion.setFromAxisAngle(UP, this.jitter[i]!);
    o.scale.set(1, 1, 1);
    o.visible = true;
    if (this.pendingValue > 0 && item.kind === 'cash') {
      item.value += this.pendingValue;
      this.pendingValue = 0;
    }
    this.refreshHidden();
  }

  /** Landed item at grid (col, row, layer), or null outside the grid. */
  private at(col: number, row: number, layer: number): Item | null {
    const g = this.opts.grid;
    if (col < 0 || col >= g.cols || row < 0 || row >= g.rows || layer < 0 || layer >= g.layers) return null;
    return this.landed[layer * g.cols * g.rows + row * g.cols + col] ?? null;
  }

  /** Show every landed item except those whose top and camera-facing sides are covered (see the header). */
  private refreshHidden(): void {
    if (!this.occlude) return;
    const g = this.opts.grid;
    const perLayer = g.cols * g.rows;
    for (let i = 0; i <= this.hi; i++) {
      const item = this.landed[i];
      if (!item) continue;
      const layer = Math.floor(i / perLayer);
      const col = i % g.cols;
      const row = Math.floor(i / g.cols) % g.rows;
      const covered =
        !!this.at(col, row, layer + 1) &&
        (this.towardCol === 0 || !!this.at(col + this.towardCol, row, layer)) &&
        (this.towardRow === 0 || !!this.at(col, row + this.towardRow, layer));
      item.object.visible = !covered;
    }
  }

  private mergeIntoTop(item: Item): void {
    const top = this.hi >= 0 ? this.landed[this.hi] : null;
    if (top) {
      top.value += item.value;
      this.ctx.tweens.punchScale(top.object, 0.1, 0.15);
    } else {
      this.pendingValue += item.value;
    }
    this.ctx.items.release(item);
  }
}
