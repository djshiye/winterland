/**
 * [B2 — items] Vertical carried stack with spring sway (player's arms; NPC customers' hands).
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
 *   overshoot wobble when the carrier stops.
 * - While full, show a small "MAX" badge (sprite / canvas texture) floating above the tallest column.
 * - Tall stacks: with `columnHeight` (metres) and/or `columnSize` (items) set, a column that would grow past the
 *   limit continues in a new column beside it: two columns side by side across the carrier's arms (COLUMN_PITCH
 *   apart), further columns in a second row in front (ROW_PITCH deeper), so 25 crates become a compact 2×2 block. Columns fill in order; take() always removes the most recently added item. Each
 *   column sways like a normal stack; column positions glide when the column count changes. Defaults: unlimited
 *   (one column), so NPC stacks are unchanged.
 * - capacity counts landed + reserved items.
 *
 * Placement is correct even if update() is never called (items are positioned in receive());
 * update() only adds the sway and the settle animation.
 */
import * as THREE from 'three';
import { UP, damp, randRange } from '../core/math';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';
import { GAME_FONT, makeCanvasTexture } from '../render/materials';
import { SwaySpring } from './Sway';

export interface CarryStackOptions {
  id: string;
  accepts: readonly ItemKind[];
  capacity: number;
  anchor: THREE.Object3D;
  /** Start a new column once a column would exceed this height in metres (default: unlimited). */
  columnHeight?: number;
  /** Start a new column once a column holds this many items (default: unlimited). */
  columnSize?: number;
}

/** One stack position: a landed item, or a placeholder (item === null) for one still in flight. */
class Entry implements Slot {
  item: Item | null = null;
  /** Current centre height (anchor-local), eased toward targetY. */
  y = 0;
  targetY = 0;
  /** Column index (0 = first) and the column's anchor-local X / Z offset (current / target). */
  col = 0;
  x = 0;
  tx = 0;
  z = 0;
  tz = 0;
  constructor(
    readonly holder: ItemHolder,
    readonly kind: ItemKind,
    readonly h: number,
    readonly yaw: number,
  ) {}
}

const SETTLE_LAMBDA = 30;
const YAW_JITTER = (6 * Math.PI) / 180;
/** Distance between neighbouring columns (anchor-local X): fits a 0.6 m log or a 0.45 m crate with a small gap. */
const COLUMN_PITCH = 0.66;
/** Distance between rows of columns (anchor-local Z, away from the carrier's chest): fits a 0.45 m crate. */
const ROW_PITCH = 0.52;

const tmpEuler = new THREE.Euler();
const tmpQa = new THREE.Quaternion();
const tmpQb = new THREE.Quaternion();

export class CarryStack implements ItemHolder {
  readonly id: string;
  capacity: number;

  private readonly entries: Entry[] = [];
  private readonly sway = new SwaySpring();
  private lastUpdateFrame = -100;
  private badge: THREE.Sprite | null = null;
  private time = 0;
  private columnHeight: number;
  private columnSize: number;
  /** Per-column stacked height (anchor-local), rebuilt by layout(). */
  private colTop: number[] = [0];
  private columns = 1;

  constructor(
    readonly ctx: GameContext,
    readonly opts: CarryStackOptions,
  ) {
    this.id = opts.id;
    this.capacity = opts.capacity;
    this.columnHeight = opts.columnHeight ?? Infinity;
    this.columnSize = opts.columnSize ?? Infinity;
  }

  // --- ItemHolder -----------------------------------------------------------
  canAccept(kind: ItemKind): boolean {
    return this.entries.length < this.capacity && this.opts.accepts.includes(kind);
  }

  reserve(item: Item): Slot {
    this.snapIfIdle();
    const e = this.push(item.kind);
    this.updateBadge();
    return e;
  }

  getSlotWorldPosition(slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    const e = slot as Entry;
    this.opts.anchor.updateWorldMatrix(true, false);
    return this.localPos(e.tx, e.tz, e.targetY, out).applyMatrix4(this.opts.anchor.matrixWorld);
  }

  getSlotWorldQuaternion(slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    const e = slot as Entry;
    this.opts.anchor.updateWorldMatrix(true, false);
    this.opts.anchor.getWorldQuaternion(out);
    return out.multiply(this.localQuat(e.targetY, e.yaw, tmpQb));
  }

  receive(item: Item, slot: Slot): void {
    let e = slot as Entry;
    if (!this.entries.includes(e)) {
      // Reservation was cancelled / cleared while the item flew: re-add it if there is room.
      if (this.entries.length >= this.capacity) {
        this.ctx.items.release(item);
        return;
      }
      e = this.push(item.kind);
    }
    e.item = item;
    e.y = e.targetY;
    e.x = e.tx;
    e.z = e.tz;
    this.opts.anchor.add(item.object);
    item.object.scale.set(1, 1, 1);
    this.apply(e);
    this.ctx.tweens.punchScale(item.object, 0.12, 0.18);
    this.updateBadge();
  }

  cancel(slot: Slot): void {
    const i = this.entries.indexOf(slot as Entry);
    if (i < 0) return;
    this.entries.splice(i, 1);
    this.layout();
    this.updateBadge();
  }

  count(kind?: ItemKind): number {
    let n = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.item && (kind === undefined || e.kind === kind)) n++;
    }
    return n;
  }

  take(kind?: ItemKind): Item | null {
    this.snapIfIdle();
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (!e.item || (kind !== undefined && e.kind !== kind)) continue;
      const item = e.item;
      e.item = null;
      this.ctx.tweens.killTweensOf(item.object);
      this.ctx.scene.attach(item.object);
      this.entries.splice(i, 1);
      this.layout(); // entries above keep their current y and glide down in update()
      this.updateBadge();
      return item;
    }
    return null;
  }

  // --- extras ---------------------------------------------------------------
  /** Landed + reserved items. */
  get size(): number {
    return this.entries.length;
  }

  isFull(): boolean {
    return this.entries.length >= this.capacity;
  }

  /** World position just above the top of the stack (base when empty). */
  topWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    this.opts.anchor.updateWorldMatrix(true, false);
    const c = this.tallestColumn();
    return this.localPos(this.columnX(c), this.columnZ(c), this.colTop[c]!, out).applyMatrix4(this.opts.anchor.matrixWorld);
  }

  /** Sway spring + smooth re-stacking. Call every frame with the carrier's world velocity. */
  update(dt: number, worldVelocity: THREE.Vector3): void {
    this.lastUpdateFrame = this.ctx.time.frame;
    this.time += dt;
    this.sway.update(dt, worldVelocity, this.opts.anchor);
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.y !== e.targetY) {
        e.y = damp(e.y, e.targetY, SETTLE_LAMBDA, dt);
        if (Math.abs(e.y - e.targetY) < 0.0005) e.y = e.targetY;
      }
      if (e.x !== e.tx) {
        e.x = damp(e.x, e.tx, SETTLE_LAMBDA, dt);
        if (Math.abs(e.x - e.tx) < 0.0005) e.x = e.tx;
    e.z = e.tz;
      }
      if (e.item) this.apply(e);
    }
    this.animateBadge();
  }

  /**
   * Change the capacity at runtime (carry upgrades, crew levels). Never drops items: a stack above the new
   * capacity just refuses more until it shrinks. Refreshes the MAX badge.
   */
  setCapacity(n: number): void {
    this.capacity = Math.max(0, Math.floor(n));
    this.updateBadge();
  }

  /** Change the column limits at runtime (see CarryStackOptions); omit / Infinity = unlimited. Re-lays out the stack. */
  setColumnLimit(height?: number, size?: number): void {
    this.columnHeight = height ?? Infinity;
    this.columnSize = size ?? Infinity;
    this.layout();
    this.updateBadge();
  }

  /** Number of columns currently in use (1 for a normal stack). */
  get columnCount(): number {
    return this.columns;
  }

  /** Restore path: place `item` on top at once (no flight, no punch). False (item untouched) if full or not accepted. */
  addImmediate(item: Item): boolean {
    if (!this.canAccept(item.kind)) return false;
    this.snapIfIdle();
    const e = this.push(item.kind);
    e.item = item;
    e.y = e.targetY;
    e.x = e.tx;
    e.z = e.tz;
    this.opts.anchor.add(item.object);
    item.object.scale.set(1, 1, 1);
    this.apply(e);
    this.updateBadge();
    return true;
  }

  /** Release every item back to the pool. */
  clear(): void {
    for (const e of this.entries) {
      if (e.item) this.ctx.items.release(e.item);
      e.item = null;
    }
    this.entries.length = 0;
    this.updateBadge();
  }

  // --- internals ------------------------------------------------------------
  /** Append a new entry for `kind` and re-lay out the columns; the new entry starts at rest. */
  private push(kind: ItemKind): Entry {
    const e = new Entry(this, kind, this.ctx.items.stackHeight(kind), randRange(-YAW_JITTER, YAW_JITTER));
    this.entries.push(e);
    this.layout();
    e.y = e.targetY;
    e.x = e.tx;
    e.z = e.tz;
    return e;
  }

  /** Recompute every entry's column, resting height and target X from the stack order. */
  private layout(): void {
    const entries = this.entries;
    let col = 0;
    let y = 0;
    let inCol = 0;
    this.colTop[0] = 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      if (inCol > 0 && (y + e.h > this.columnHeight + 1e-6 || inCol >= this.columnSize)) {
        col++;
        y = 0;
        inCol = 0;
      }
      e.col = col;
      e.targetY = y + e.h / 2;
      y += e.h;
      inCol++;
      this.colTop[col] = y;
    }
    this.columns = col + 1;
    this.colTop.length = this.columns;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      e.tx = this.columnX(e.col);
      e.tz = this.columnZ(e.col);
    }
  }

  /** Anchor-local X of column `c`: a single column sits on the anchor, otherwise two per row (left / right). */
  private columnX(c: number): number {
    return this.columns === 1 ? 0 : (c % 2 === 0 ? -0.5 : 0.5) * COLUMN_PITCH;
  }

  /** Anchor-local Z of column `c`: rows of two, the first row closest to the carrier. */
  private columnZ(c: number): number {
    return (c >> 1) * ROW_PITCH;
  }

  private tallestColumn(): number {
    let best = 0;
    for (let c = 1; c < this.columns; c++) if (this.colTop[c]! > this.colTop[best]!) best = c;
    return best;
  }

  /** If nobody drives update() (no carrier loop yet) snap instead of gliding, so layouts stay correct. */
  private snapIfIdle(): void {
    if (this.ctx.time.frame - this.lastUpdateFrame <= 3) return;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.y !== e.targetY || e.x !== e.tx || e.z !== e.tz) {
        e.y = e.targetY;
        e.x = e.tx;
        e.z = e.tz;
        if (e.item) this.apply(e);
      }
    }
  }

  /** Anchor-local position of a stack point at column offset `cx`, height y (bent by the current lean). */
  private localPos(cx: number, cz: number, y: number, out: THREE.Vector3): THREE.Vector3 {
    const p = SwaySpring.profile(y);
    return out.set(cx + this.sway.x * p, y, cz + this.sway.z * p);
  }

  /** Anchor-local orientation: yaw jitter, then tilt along the bend. */
  private localQuat(y: number, yaw: number, out: THREE.Quaternion): THREE.Quaternion {
    const s = SwaySpring.slope(y);
    tmpQa.setFromEuler(tmpEuler.set(this.sway.z * s, 0, -this.sway.x * s));
    return out.copy(tmpQa).multiply(tmpQa.setFromAxisAngle(UP, yaw));
  }

  private apply(e: Entry): void {
    const o = e.item!.object;
    this.localPos(e.x, e.z, e.y, o.position);
    this.localQuat(e.y, e.yaw, o.quaternion);
  }

  // --- MAX badge --------------------------------------------------------------
  private updateBadge(): void {
    const full = this.capacity > 0 && this.entries.length >= this.capacity;
    if (full && !this.badge) this.badge = this.createBadge();
    if (this.badge) this.badge.visible = full;
    if (full) this.animateBadge();
  }

  private animateBadge(): void {
    const b = this.badge;
    if (!b || !b.visible) return;
    const c = this.tallestColumn();
    const top = this.colTop[c]! + 0.55 + Math.sin(this.time * 6) * 0.05;
    const p = SwaySpring.profile(top);
    b.position.set(this.columnX(c) + this.sway.x * p, top, this.columnZ(c) + this.sway.z * p);
  }

  private createBadge(): THREE.Sprite {
    const { canvas, ctx: g, texture } = makeCanvasTexture(256, 128);
    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);
    g.beginPath();
    g.roundRect(8, 8, w - 16, h - 16, 40);
    g.fillStyle = '#ff5a2b';
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.font = `800 70px ${GAME_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 8;
    g.strokeStyle = '#8a2208';
    g.strokeText('MAX', w / 2, h / 2 + 4);
    g.fillStyle = '#ffffff';
    g.fillText('MAX', w / 2, h / 2 + 4);
    texture.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.1, 0.55, 1);
    sprite.renderOrder = 1000;
    sprite.name = `${this.id}.maxBadge`;
    this.opts.anchor.add(sprite);
    return sprite;
  }
}
