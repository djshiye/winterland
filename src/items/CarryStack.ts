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
 * - While full, show a small "MAX" badge (sprite / canvas texture) floating above the top item.
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
}

/** One stack position: a landed item, or a placeholder (item === null) for one still in flight. */
class Entry implements Slot {
  item: Item | null = null;
  /** Current centre height (anchor-local), eased toward targetY. */
  y = 0;
  targetY = 0;
  constructor(
    readonly holder: ItemHolder,
    readonly kind: ItemKind,
    readonly h: number,
    readonly yaw: number,
  ) {}
}

const SETTLE_LAMBDA = 30;
const YAW_JITTER = (6 * Math.PI) / 180;

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

  constructor(
    readonly ctx: GameContext,
    readonly opts: CarryStackOptions,
  ) {
    this.id = opts.id;
    this.capacity = opts.capacity;
  }

  // --- ItemHolder -----------------------------------------------------------
  canAccept(kind: ItemKind): boolean {
    return this.entries.length < this.capacity && this.opts.accepts.includes(kind);
  }

  reserve(item: Item): Slot {
    this.snapIfIdle();
    const e = new Entry(this, item.kind, this.ctx.items.stackHeight(item.kind), randRange(-YAW_JITTER, YAW_JITTER));
    this.entries.push(e);
    this.layout();
    e.y = e.targetY;
    this.updateBadge();
    return e;
  }

  getSlotWorldPosition(slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    const e = slot as Entry;
    this.opts.anchor.updateWorldMatrix(true, false);
    return this.localPos(e.targetY, out).applyMatrix4(this.opts.anchor.matrixWorld);
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
      e = new Entry(this, item.kind, this.ctx.items.stackHeight(item.kind), randRange(-YAW_JITTER, YAW_JITTER));
      this.entries.push(e);
      this.layout();
    }
    e.item = item;
    e.y = e.targetY;
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
    return this.localPos(this.topY(), out).applyMatrix4(this.opts.anchor.matrixWorld);
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

  /** Restore path: place `item` on top at once (no flight, no punch). False (item untouched) if full or not accepted. */
  addImmediate(item: Item): boolean {
    if (!this.canAccept(item.kind)) return false;
    const e = new Entry(this, item.kind, this.ctx.items.stackHeight(item.kind), randRange(-YAW_JITTER, YAW_JITTER));
    this.entries.push(e);
    this.layout();
    e.item = item;
    e.y = e.targetY;
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
  /** Recompute each entry's resting height from the stack order. */
  private layout(): void {
    let y = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      e.targetY = y + e.h / 2;
      y += e.h;
    }
  }

  private topY(): number {
    let y = 0;
    for (let i = 0; i < this.entries.length; i++) y += this.entries[i]!.h;
    return y;
  }

  /** If nobody drives update() (no carrier loop yet) snap instead of gliding, so layouts stay correct. */
  private snapIfIdle(): void {
    if (this.ctx.time.frame - this.lastUpdateFrame <= 3) return;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.y !== e.targetY) {
        e.y = e.targetY;
        if (e.item) this.apply(e);
      }
    }
  }

  /** Anchor-local position of a stack point at height y (bent by the current lean). */
  private localPos(y: number, out: THREE.Vector3): THREE.Vector3 {
    const p = SwaySpring.profile(y);
    return out.set(this.sway.x * p, y, this.sway.z * p);
  }

  /** Anchor-local orientation: yaw jitter, then tilt along the bend. */
  private localQuat(y: number, yaw: number, out: THREE.Quaternion): THREE.Quaternion {
    const s = SwaySpring.slope(y);
    tmpQa.setFromEuler(tmpEuler.set(this.sway.z * s, 0, -this.sway.x * s));
    return out.copy(tmpQa).multiply(tmpQa.setFromAxisAngle(UP, yaw));
  }

  private apply(e: Entry): void {
    const o = e.item!.object;
    this.localPos(e.y, o.position);
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
    const top = this.topY() + 0.55 + Math.sin(this.time * 6) * 0.05;
    const p = SwaySpring.profile(top);
    b.position.set(this.sway.x * p, top, this.sway.z * p);
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
