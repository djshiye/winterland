/**
 * [eras] Export depot: an ItemHolder that swallows every era material delivered to it and sells it at once
 * (core/Market.ts sellExport: price × the era's Trade upgrade × season, supply pressure, 'sale' event → the usual
 * cash sound + "+$" popup). Items fly to the freight door, then are released to the pool. Holds nothing.
 */
import * as THREE from 'three';
import type { GameContext, Item, ItemHolder, ItemKind, Slot } from '../core/types';
import { isMaterial } from './data';
import type { XZ } from './layout';
import { DEPOT_FRAME, toWorld } from './rules';

export class ExportDepot implements ItemHolder {
  readonly id: string;
  /** World point the sold items fly to (the freight door, above the floor). */
  readonly door = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();

  constructor(
    private readonly ctx: GameContext,
    readonly era: number,
    at: XZ,
    yaw: number,
  ) {
    this.id = `depot:era${era}`;
    const d = toWorld(at, yaw, DEPOT_FRAME.door.u, DEPOT_FRAME.door.v);
    this.door.set(d.x, DEPOT_FRAME.door.y, d.z);
  }

  canAccept(kind: ItemKind): boolean {
    return isMaterial(kind);
  }

  reserve(_item: Item): Slot {
    return { holder: this };
  }

  getSlotWorldPosition(_slot: Slot, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.door);
  }

  getSlotWorldQuaternion(_slot: Slot, out: THREE.Quaternion): THREE.Quaternion {
    return out.identity();
  }

  /** Sold: the market credits the money, the item goes back to the pool. */
  receive(item: Item, _slot: Slot): void {
    this.pos.copy(this.door);
    this.ctx.market.sellExport(item.kind, 1, this.pos);
    this.ctx.items.release(item);
  }

  cancel(_slot: Slot): void {}

  count(_kind?: ItemKind): number {
    return 0;
  }

  take(_kind?: ItemKind): Item | null {
    return null;
  }
}
