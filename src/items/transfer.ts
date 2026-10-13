/**
 * [B2 — items] The ONLY place items change holders. STUB: replace bodies, keep the public API.
 */
import type * as THREE from 'three';
import type { GameContext, Item, ItemHolder, ItemKind } from '../core/types';
import type { FlightOptions } from './FlightSystem';

/**
 * Move one item from `from` to `to` with a flight. Tries `kinds` in order (default: every kind);
 * picks the first kind that `from` has and `to` accepts. Emits 'item:launched'.
 * Returns the moved item, or null if nothing could move.
 */
export function transferOne(
  _ctx: GameContext,
  _from: ItemHolder,
  _to: ItemHolder,
  _kinds?: readonly ItemKind[],
  _opts?: FlightOptions,
): Item | null {
  return null;
}

/**
 * Create a brand-new item at world position `fromWorld` and fly it into `to` (chopped logs,
 * crates leaving the processor, cash paid by NPCs). Returns null (and creates nothing) if `to`
 * cannot accept it. Emits 'item:launched' with from = null.
 */
export function launchNew(
  _ctx: GameContext,
  _kind: ItemKind,
  _fromWorld: THREE.Vector3,
  _to: ItemHolder,
  _opts?: FlightOptions & { value?: number },
): Item | null {
  return null;
}
