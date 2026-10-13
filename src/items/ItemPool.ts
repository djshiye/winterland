/**
 * [B2 — items] Creates and recycles item visuals. STUB: replace bodies, keep the public API.
 *
 * Visuals (centred on origin, sizes from ITEM_SIZE, built with materials.ts toon() + geo cache, all
 * meshes cast + receive shadows, ≤ ~4 meshes per item):
 * - log:   bark cylinder lying along local X (radius .19, length 1, ~10 radial segments), light
 *          end-grain caps (PALETTE.woodEnd) with a darker ring (PALETTE.woodRing) on both ends.
 * - crate: wooden crate cube 0.56 (PALETTE.crate) with darker slats / edge frame (PALETTE.crateDark).
 * - cash:  green bill bundle 0.5×0.12×0.27 (PALETTE.cash, darker edges) with a pale paper band
 *          (PALETTE.cashBand) wrapped around the middle.
 * Pooling: release() hides + detaches; create() reuses a hidden item of that kind when available.
 * create() resets transform (scale 1, identity rotation), makes it visible, adds it to ctx.scene, and
 * sets value = ECONOMY.cashBundleValue for cash (or the given value), 0 for goods.
 */
import * as THREE from 'three';
import { ITEM_SIZE } from '../config';
import type { GameContext, Item, ItemKind } from '../core/types';

export class ItemPool {
  private nextId = 1;

  constructor(readonly ctx: GameContext) {}

  create(kind: ItemKind, value?: number): Item {
    const object = new THREE.Group();
    this.ctx.scene.add(object);
    return { id: this.nextId++, kind, object, value: value ?? 0 };
  }

  release(item: Item): void {
    item.object.removeFromParent();
  }

  /** Vertical spacing of this kind when stacked (ITEM_SIZE[kind].stackHeight). */
  stackHeight(kind: ItemKind): number {
    return ITEM_SIZE[kind].stackHeight;
  }

  /** Items currently checked out (for debugging leaks). */
  get liveCount(): number {
    return 0;
  }
}
