/**
 * [B2 — items] The player's cash, drawn as a stack of bundles on the back.
 *
 * Money (ctx.economy) is the source of truth; the stack visualises it:
 *   visual bundles = min(maxVisual, floor(money / ECONOMY.cashBundleValue)).
 * - canAccept('cash') is always true (money is uncapped); other kinds false.
 * - receive(cashItem): economy.add(item.value); keep the item as the new top bundle if under the
 *   visual cap, otherwise release it to the pool.
 * - count('cash') = floor(money / bundleValue) (logical bundles, not just visible ones).
 * - take('cash'): if money ≥ bundleValue → economy.spend(bundleValue) and return the top visual
 *   bundle (detached, value = bundleValue); when no visual exists, create one at the top position.
 *   Afterwards the visuals re-sync (if money still exceeds the cap the stack stays full).
 * - sync() also runs on every 'money:changed' event (e.g. debug addMoney) — new bundles pop in,
 *   surplus ones pop out.
 * - RE-ENTRANCY: economy.add()/spend() emit 'money:changed' SYNCHRONOUSLY, which triggers sync().
 *   In receive()/take() the visual bundle is appended/detached FIRST and only then is the economy
 *   touched, so sync() always sees a consistent state.
 *
 * Layout: two bundles per layer (front/back), layers stack upward from the anchor. Sway is the same
 * damped spring as CarryStack. Pop-in/out animation runs on an internal updatable (simulation dt), so
 * it works whether or not the owner calls update().
 */
import * as THREE from 'three';
import { ECONOMY, ITEM_SIZE } from '../config';
import { UP, clamp01 } from '../core/math';
import type { GameContext, Item, ItemHolder, ItemKind, Slot, Updatable } from '../core/types';
import { SwaySpring } from './Sway';

export interface CashStackOptions {
  id: string;
  anchor: THREE.Object3D;
  maxVisual: number;
}

class CashSlot implements Slot {
  constructor(
    readonly holder: ItemHolder,
    readonly index: number,
  ) {}
}

interface Anim {
  item: Item;
  age: number;
  out: boolean;
}

const BUNDLE_H = ITEM_SIZE.cash.stackHeight;
const COL_Z = [0, -0.23];
const POP_IN = 0.22;
const POP_OUT = 0.14;

const tmpEuler = new THREE.Euler();
const tmpQa = new THREE.Quaternion();
const tmpQb = new THREE.Quaternion();

/** Deterministic hand-stacked yaw for bundle index i (±4°). */
const yawFor = (i: number): number => Math.sin(i * 12.9898) * 0.07;

export class CashStack implements ItemHolder {
  readonly id: string;

  private readonly visuals: Item[] = [];
  private readonly anims: Anim[] = [];
  private readonly sway = new SwaySpring();
  private reservedCount = 0;

  constructor(
    readonly ctx: GameContext,
    readonly opts: CashStackOptions,
  ) {
    this.id = opts.id;
    const ticker: Updatable = { update: (dt) => this.tickAnims(dt) };
    ctx.addUpdatable(ticker);
    ctx.events.on('money:changed', () => this.sync());
    this.sync(false);
  }

  canAccept(kind: ItemKind): boolean {
    return kind === 'cash';
  }

  reserve(_item: Item): Slot {
    const s = new CashSlot(this, this.visuals.length + this.reservedCount);
    this.reservedCount++;
    return s;
  }

  getSlotWorldPosition(slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    const i = Math.min((slot as CashSlot).index, this.opts.maxVisual - 1);
    this.opts.anchor.updateWorldMatrix(true, false);
    return this.localPos(i, out).applyMatrix4(this.opts.anchor.matrixWorld);
  }

  getSlotWorldQuaternion(slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    const i = Math.min((slot as CashSlot).index, this.opts.maxVisual - 1);
    this.opts.anchor.updateWorldMatrix(true, false);
    this.opts.anchor.getWorldQuaternion(out);
    return out.multiply(this.localQuat(i, tmpQb));
  }

  receive(item: Item, _slot: Slot): void {
    this.reservedCount = Math.max(0, this.reservedCount - 1);
    const value = item.value > 0 ? item.value : ECONOMY.cashBundleValue;
    // Visual first, economy second (see RE-ENTRANCY above).
    if (this.visuals.length < this.opts.maxVisual) {
      item.value = ECONOMY.cashBundleValue;
      this.attach(item, this.visuals.length);
      this.visuals.push(item);
    } else {
      this.ctx.items.release(item);
    }
    this.ctx.economy.add(value);
  }

  cancel(_slot: Slot): void {
    this.reservedCount = Math.max(0, this.reservedCount - 1);
  }

  /** Logical bundles (floor(money / bundleValue)); 0 for any other kind. */
  count(kind?: ItemKind): number {
    if (kind !== undefined && kind !== 'cash') return 0;
    return Math.floor(this.ctx.economy.money / ECONOMY.cashBundleValue);
  }

  take(kind?: ItemKind): Item | null {
    if (kind !== undefined && kind !== 'cash') return null;
    const value = ECONOMY.cashBundleValue;
    if (!this.ctx.economy.canAfford(value)) return null;
    return this.detach(value);
  }

  /**
   * Chunked payments (big pad costs): spend min(amount, money) at once and return ONE bundle carrying exactly that
   * value (null if amount < 1 or money < 1). So a $4,000 pad paid from $4,000 ends at exactly 0 remaining and $0,
   * and a poorer player just pays what he has. Visually identical to take(): the top bundle flies, the stack re-syncs.
   */
  takeValue(amount: number): Item | null {
    const value = Math.floor(Math.min(amount, this.ctx.economy.money));
    if (!(value >= 1)) return null;
    return this.detach(value);
  }

  // --- extras ---------------------------------------------------------------
  /** Number of bundles currently drawn. */
  get visualCount(): number {
    return this.visuals.length;
  }

  /** World position just above the top bundle. */
  topWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    this.opts.anchor.updateWorldMatrix(true, false);
    return this.localPos(Math.max(0, this.visuals.length), out).applyMatrix4(this.opts.anchor.matrixWorld);
  }

  /** Sway spring. Call every frame with the carrier's world velocity. */
  update(dt: number, worldVelocity: THREE.Vector3): void {
    this.sway.update(dt, worldVelocity, this.opts.anchor);
    for (let i = 0; i < this.visuals.length; i++) this.place(this.visuals[i]!, i);
  }

  /** Make the visual bundles match the money (pop new ones in / surplus ones out). */
  sync(animate = true): void {
    const desired = Math.min(this.opts.maxVisual, Math.floor(this.ctx.economy.money / ECONOMY.cashBundleValue));
    while (this.visuals.length < desired) {
      const item = this.ctx.items.create('cash');
      const i = this.visuals.length;
      this.attach(item, i);
      this.visuals.push(item);
      if (animate) {
        item.object.scale.setScalar(0.01);
        this.anims.push({ item, age: 0, out: false });
      }
    }
    while (this.visuals.length > desired) {
      const item = this.visuals.pop()!;
      if (animate) this.anims.push({ item, age: 0, out: true });
      else this.ctx.items.release(item);
    }
  }

  // --- internals ------------------------------------------------------------
  /**
   * Pop the top visual (or conjure one at the top slot when none is drawn), tag it with `value` and spend that value.
   * Order matters: the bundle is detached BEFORE spend() because spend() synchronously re-enters sync().
   */
  private detach(value: number): Item | null {
    let item = this.visuals.pop() ?? null;
    if (item) {
      this.cancelAnim(item);
      this.ctx.tweens.killTweensOf(item.object);
      item.object.scale.set(1, 1, 1);
      this.ctx.scene.attach(item.object);
    } else {
      item = this.ctx.items.create('cash');
      this.opts.anchor.updateWorldMatrix(true, false);
      this.localPos(this.opts.maxVisual - 1, item.object.position).applyMatrix4(this.opts.anchor.matrixWorld);
    }
    item.value = value;
    if (!this.ctx.economy.spend(value)) {
      this.ctx.items.release(item);
      return null;
    }
    return item;
  }

  private attach(item: Item, i: number): void {
    this.opts.anchor.add(item.object);
    item.object.scale.set(1, 1, 1);
    this.place(item, i);
  }

  private place(item: Item, i: number): void {
    this.localPos(i, item.object.position);
    this.localQuat(i, item.object.quaternion);
  }

  /** Anchor-local centre of bundle slot i, bent by the current lean. */
  private localPos(i: number, out: THREE.Vector3): THREE.Vector3 {
    const layer = i >> 1;
    const y = layer * BUNDLE_H + BUNDLE_H / 2;
    const p = SwaySpring.profile(y);
    return out.set(this.sway.x * p, y, COL_Z[i & 1]! + this.sway.z * p);
  }

  private localQuat(i: number, out: THREE.Quaternion): THREE.Quaternion {
    const y = (i >> 1) * BUNDLE_H + BUNDLE_H / 2;
    const s = SwaySpring.slope(y);
    tmpQa.setFromEuler(tmpEuler.set(this.sway.z * s, 0, -this.sway.x * s));
    out.copy(tmpQa);
    return out.multiply(tmpQa.setFromAxisAngle(UP, yawFor(i)));
  }

  private cancelAnim(item: Item): void {
    const k = this.anims.findIndex((a) => a.item === item);
    if (k >= 0) this.anims.splice(k, 1);
  }

  private tickAnims(dt: number): void {
    for (let k = this.anims.length - 1; k >= 0; k--) {
      const a = this.anims[k]!;
      a.age += dt;
      if (a.out) {
        const t = clamp01(a.age / POP_OUT);
        a.item.object.scale.setScalar(Math.max(0.01, 1 - t));
        if (t >= 1) {
          this.anims.splice(k, 1);
          this.ctx.items.release(a.item);
        }
      } else {
        const t = clamp01(a.age / POP_IN);
        const c1 = 1.70158;
        const c3 = c1 + 1;
        const e = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); // backOut
        a.item.object.scale.setScalar(Math.max(0.01, e));
        if (t >= 1) {
          a.item.object.scale.setScalar(1);
          this.anims.splice(k, 1);
        }
      }
    }
  }
}
