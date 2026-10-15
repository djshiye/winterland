/**
 * [wave 9 — crew in the Market Town] Pure job selection for the porters (no THREE, no game objects): which load to
 * carry from where to which shop hopper. npc/crewHelpers.ts Porter builds the views from the live town each pick and
 * runs the chosen job; tests/townJobs.test.ts drives this with small fakes.
 *
 * Rules:
 *   - wheat / meat: from a producer's out pallet holding >= 2 goods, to a shop whose hopper still has room for that
 *     kind; the hungriest shop (lowest stock of that kind) first.
 *   - log (firewood): from the drop zone, to a shop running low on logs (fewer than TOPUP_BELOW, counting what peers
 *     already carry there; urgent below FIREWOOD_BELOW). The drop zone is a long walk from the square, so a trip
 *     starts a little before the hopper is empty and carries a worthwhile load (TOPUP_MIN_TAKE) unless it is urgent.
 *   - crate: the same, from the processor's output table to a shop (toy factory) running low on crates.
 *   - never take more than the hopper has room for (room already counts items in flight, minus what peers carry
 *     there), never more than the porter's capacity or what the source holds.
 *   - one kind per trip; peers' claims reserve a producer pallet and an amount for a (shop, kind) hopper, so two
 *     porters do not chase the same job and never overfill a hopper between them.
 */
import { PRIORITIES, type BusinessId, type TownPriority, type XZ } from '../config';
import type { ItemKind } from '../core/types';

/** Kinds topped up only when the hopper runs low (firewood and crates), not filled to the brim. */
export const TOPUP_KINDS: readonly ItemKind[] = ['log', 'crate'];
/** Below this many in the hopper (plus peers' loads on the way) the shop is urgent: any load is worth a trip. */
export const FIREWOOD_BELOW = 2;
/** Below this a top-up trip may start, as long as it carries at least TOPUP_MIN_TAKE. */
export const TOPUP_BELOW = 5;
export const TOPUP_MIN_TAKE = 4;

export interface ShopView {
  key: string;
  /** Which shop this is (for the town priority); absent in fakes that do not care. */
  id?: BusinessId;
  /** Where a porter stands to feed it. */
  pos: XZ;
  /** Items of each input kind still wanted (hopper cap minus landed minus in flight). Absent = not an input. */
  room: Partial<Record<ItemKind, number>>;
  /** Items of each input kind in the hopper (landed + in flight). */
  stock: Partial<Record<ItemKind, number>>;
}

export interface SourceView {
  key: string;
  kind: ItemKind;
  /** Items available now. */
  count: number;
  /** Fewest items worth a trip. */
  minTake: number;
  /** Where a porter stands to load it. */
  pos: XZ;
  /** Several porters may load here at once (the drop zone, the bench); pallets are claimed by one. */
  shared: boolean;
}

export interface Claims {
  /** Source keys a peer is working. */
  sources: ReadonlySet<string>;
  /** destKey(shop, kind) -> items a peer carries (or is about to load) for that hopper. */
  dests: ReadonlyMap<string, number>;
  /** The shop the player's town priority favours: its score gets + PRIORITIES.weight. Undefined = balanced. */
  favour?: BusinessId;
}

/** The shop a town priority stands for (balanced = none). */
export function favouredShop(p: TownPriority): BusinessId | undefined {
  return p === 'bakery' ? 'bakery' : p === 'butcher' ? 'butcher' : p === 'toys' ? 'toyFactory' : undefined;
}

const bonus = (shop: ShopView, claims: Claims): number => (claims.favour !== undefined && shop.id === claims.favour ? PRIORITIES.weight : 0);

export interface PorterJob {
  source: string;
  shop: string;
  kind: ItemKind;
  take: number;
  score: number;
}

export const destKey = (shop: string, kind: ItemKind): string => `${shop}:${kind}`;

const dist = (a: XZ, b: XZ): number => Math.hypot(a.x - b.x, a.z - b.z);
const urgency = (stock: number): number => 40 / (1 + stock);

/** The best job for a porter standing at `from` with room for `capacity` items, or null. */
export function pickJob(
  sources: readonly SourceView[],
  shops: readonly ShopView[],
  capacity: number,
  claims: Claims,
  from: XZ,
): PorterJob | null {
  let best: PorterJob | null = null;
  for (const src of sources) {
    if (!src.shared && claims.sources.has(src.key)) continue;
    if (src.count < src.minTake || src.count <= 0) continue;
    for (const shop of shops) {
      const reserved = claims.dests.get(destKey(shop.key, src.kind)) ?? 0;
      const room = (shop.room[src.kind] ?? 0) - reserved;
      if (room <= 0) continue;
      const stock = (shop.stock[src.kind] ?? 0) + reserved;
      const take = Math.min(capacity, src.count, room);
      if (TOPUP_KINDS.includes(src.kind)) {
        if (stock >= TOPUP_BELOW) continue;
        if (stock >= FIREWOOD_BELOW && take < Math.min(TOPUP_MIN_TAKE, room)) continue; // not urgent: wait for a real load
      }
      // a trip is worth it for a full pair, or for a single item into an empty hopper
      if (take < 2 && !(take >= 1 && stock === 0)) continue;
      const score = urgency(stock) + take + bonus(shop, claims) - 0.1 * (dist(from, src.pos) + dist(src.pos, shop.pos));
      if (!best || score > best.score) best = { source: src.key, shop: shop.key, kind: src.kind, take, score };
    }
  }
  return best;
}

/**
 * Where to put `n` items of `kind` already in the arms: the hungriest shop with room for at least one, not claimed by
 * a peer, not `exclude`. Null when none.
 */
export function pickShop(
  shops: readonly ShopView[],
  kind: ItemKind,
  claims: Claims,
  from: XZ,
  exclude?: string,
): ShopView | null {
  let best: ShopView | null = null;
  let bestScore = -Infinity;
  for (const shop of shops) {
    if (shop.key === exclude) continue;
    const reserved = claims.dests.get(destKey(shop.key, kind)) ?? 0;
    if ((shop.room[kind] ?? 0) - reserved <= 0) continue;
    const score = urgency((shop.stock[kind] ?? 0) + reserved) + bonus(shop, claims) - 0.1 * dist(from, shop.pos);
    if (score > bestScore) {
      bestScore = score;
      best = shop;
    }
  }
  return best;
}
