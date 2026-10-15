/**
 * [T3 — townsfolk] Wave 9 cosy crowd: wanderers on the village street and the market square, and buyers at the
 * town's shops. Rendered by npc/Crowd.ts (instanced: a fixed handful of draw calls for every person).
 *
 * CONTRACT (keep every public signature; T3 owns the implementation; Level constructs + updates it):
 * - Buyers: per open shop (town.shops(), read live), spawn one every TOWN.buyerGap[level] s (± jitter, ×
 *   ctx.rush.spawnMult while a rush runs) up to TOWN.queuePerShop queued; walk in from a LAYOUT.town.entrances
 *   point, queue at shop.queueSpot(i), at the front take want ∈ def.want items from shop.counter (transfer.ts, one
 *   per TIMING.npcTakeInterval; goods land in the buyer's basket and are released), pay
 *   salePrice(state, def.output, def.price, n) into shop.till.pay(amount, from), stats.goodsSold += n, emit 'sale'
 *   { buyer: 'townsfolk', kind }, cheer, walk out. A shop that closes (none in 9a) sends its queue away.
 * - Wanderers: TOWN.wanderers[level] (halved on Low quality / ctx.renderer quality) people stroll between spots
 *   (town/spots.ts benches / stalls / snowman / tree ring, the village street) once the village / town are revealed;
 *   they sit, chat, look at the tree; never walk through solids (stay in the walk rects + go around the tree).
 * - loadedByLot(lot): goods already handed to buyers of that lot who haven't paid yet (the save puts them back).
 */
import type { GameContext } from '../core/types';
import type { Town } from '../town/Town';

export class Townsfolk {
  constructor(
    readonly ctx: GameContext,
    readonly town: Town,
  ) {}

  /** Live people (buyers + wanderers). */
  get count(): number {
    return 0;
  }

  loadedByLot(_lot: number): number {
    return 0;
  }

  update(_dt: number): void {}
}
