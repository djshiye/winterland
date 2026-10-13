/**
 * [B2 — items] The player's cash, drawn as a stack of bundles on the back. STUB: replace bodies,
 * keep the public API.
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
 *   surplus ones pop out. Same sway behaviour as CarryStack (share code if you like).
 * - RE-ENTRANCY: economy.add()/spend() emit 'money:changed' SYNCHRONOUSLY, which triggers sync().
 *   In receive()/take(), append/detach the visual bundle FIRST and only then touch the economy (or
 *   guard sync() with a flag) — otherwise sync() adds/removes a bundle and you end up off by one.
 */
import type * as THREE from 'three';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';

export interface CashStackOptions {
  id: string;
  anchor: THREE.Object3D;
  maxVisual: number;
}

export class CashStack implements ItemHolder {
  readonly id: string;

  constructor(
    readonly ctx: GameContext,
    readonly opts: CashStackOptions,
  ) {
    this.id = opts.id;
  }

  canAccept(kind: ItemKind): boolean {
    return kind === 'cash';
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
  receive(item: Item, _slot: Slot): void {
    this.ctx.economy.add(item.value);
    this.ctx.items.release(item);
  }
  cancel(_slot: Slot): void {}
  count(_kind?: ItemKind): number {
    return 0;
  }
  take(_kind?: ItemKind): Item | null {
    return null;
  }

  update(_dt: number, _worldVelocity: THREE.Vector3): void {}
  sync(): void {}
}
