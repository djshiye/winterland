/**
 * [B2 — items] Creates and recycles item visuals. The models themselves live in assets/items.ts
 * (AssetFactory); this pool only recycles them.
 *
 * Pooling: release() hides + detaches; create() reuses a hidden item of that kind when available.
 * create() resets the transform (scale 1, identity rotation), makes it visible, adds it to ctx.scene and
 * sets value = ECONOMY.cashBundleValue for cash (or the given value), 0 for goods.
 */
import { ECONOMY, ITEM_SIZE } from '../config';
import { createItemModel } from '../assets/items';
import type { GameContext, Item, ItemKind } from '../core/types';

export class ItemPool {
  private nextId = 1;
  private readonly free: Record<ItemKind, Item[]> = { log: [], plank: [], crate: [], cash: [], furniture: [], wheat: [], bread: [], meat: [], sausage: [], toy: [] };
  private readonly live = new Set<Item>();

  constructor(readonly ctx: GameContext) {}

  /** Check out an item of `kind` (reused from the pool when possible), added to the scene root. */
  create(kind: ItemKind, value?: number): Item {
    let item = this.free[kind].pop();
    if (!item) {
      item = { id: this.nextId++, kind, object: createItemModel(kind), value: 0 };
    }
    item.value = value ?? (kind === 'cash' ? ECONOMY.cashBundleValue : 0);
    const o = item.object;
    o.position.set(0, 0, 0);
    o.quaternion.identity();
    o.scale.set(1, 1, 1);
    o.visible = true;
    o.castShadow = false; // only carried stacks cast (items/CarryStack.ts)
    delete o.userData.baseScale;
    this.ctx.scene.add(o);
    this.live.add(item);
    return item;
  }

  /** Return an item to the pool (hidden + detached). Safe to call on items that are mid-air. */
  release(item: Item): void {
    if (!this.live.delete(item)) return; // not checked out (double release)
    this.ctx.tweens.killTweensOf(item.object);
    item.object.removeFromParent();
    item.object.visible = false;
    item.value = 0;
    this.free[item.kind].push(item);
  }

  /** Vertical spacing of this kind when stacked (ITEM_SIZE[kind].stackHeight). */
  stackHeight(kind: ItemKind): number {
    return ITEM_SIZE[kind].stackHeight;
  }

  /** Items currently checked out (for debugging leaks). */
  get liveCount(): number {
    return this.live.size;
  }
}
