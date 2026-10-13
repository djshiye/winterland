/**
 * [B2 — items] The ONLY place items change holders.
 */
import type * as THREE from 'three';
import type { GameContext, Item, ItemHolder, ItemKind } from '../core/types';
import type { CashStack } from './CashStack';
import type { FlightOptions } from './FlightSystem';

const ALL_KINDS: readonly ItemKind[] = ['log', 'plank', 'crate', 'cash'];

/**
 * Move one item from `from` to `to` with a flight. Tries `kinds` in order (default: every kind);
 * picks the first kind that `from` has and `to` accepts. Emits 'item:launched'.
 * Returns the moved item, or null if nothing could move.
 */
export function transferOne(
  ctx: GameContext,
  from: ItemHolder,
  to: ItemHolder,
  kinds?: readonly ItemKind[],
  opts?: FlightOptions,
): Item | null {
  const list = kinds ?? ALL_KINDS;
  for (let i = 0; i < list.length; i++) {
    const kind = list[i]!;
    if (from.count(kind) <= 0 || !to.canAccept(kind)) continue;
    const item = from.take(kind);
    if (!item) continue;
    // Holders re-parent on take(); make sure the item is flying free in world space.
    if (item.object.parent !== ctx.scene) ctx.scene.attach(item.object);
    const slot = to.reserve(item);
    ctx.flights.launch(item, to, slot, opts);
    ctx.events.emit('item:launched', { item, from, to });
    return item;
  }
  return null;
}

/**
 * Create a brand-new item at world position `fromWorld` and fly it into `to` (chopped logs,
 * crates leaving the processor, cash paid by NPCs). Returns null (and creates nothing) if `to`
 * cannot accept it. Emits 'item:launched' with from = null.
 */
export function launchNew(
  ctx: GameContext,
  kind: ItemKind,
  fromWorld: THREE.Vector3,
  to: ItemHolder,
  opts?: FlightOptions & { value?: number },
): Item | null {
  if (!to.canAccept(kind)) return null;
  const item = ctx.items.create(kind, opts?.value);
  item.object.position.copy(fromWorld);
  const slot = to.reserve(item);
  ctx.flights.launch(item, to, slot, opts);
  ctx.events.emit('item:launched', { item, from: null, to });
  return item;
}

/**
 * Chunked payment: take ONE bundle worth up to `amount` dollars from the player's cash (CashStack.takeValue) and
 * fly it into `to`. Returns null if `to` refuses cash or there is no money. Emits 'item:launched'.
 */
export function transferCash(
  ctx: GameContext,
  from: CashStack,
  to: ItemHolder,
  amount: number,
  opts?: FlightOptions,
): Item | null {
  if (!(amount >= 1) || !to.canAccept('cash')) return null;
  const item = from.takeValue(amount);
  if (!item) return null;
  if (item.object.parent !== ctx.scene) ctx.scene.attach(item.object);
  const slot = to.reserve(item);
  ctx.flights.launch(item, to, slot, opts);
  ctx.events.emit('item:launched', { item, from, to });
  return item;
}
