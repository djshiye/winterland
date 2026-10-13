/**
 * [B5 — commerce] Walk-in customers (blue capsule people) queueing at the walk-in counter.
 * STUB: replace bodies, keep the public API.
 *
 * Spec: "Queued blue NPCs show a speech bubble requesting wood. They take logs from the counter, leave
 * Green Cash Bundles in a neat 3D grid pile right next to the counter, and walk away while the queue
 * advances."
 *
 * Behaviour (LAYOUT.customers, ECONOMY.customerWant / logPrice, TIMING.npcTakeInterval):
 * - Keep up to maxQueue customers. Spawn at `spawn` (staggered ~1–1.5 s) and walk (walkSpeed,
 *   CharacterRig walk anim, facing travel direction) to the first free queue slot
 *   (slot i = front + i·spacing along +Z). Customers shuffle forward as slots free up.
 * - The customer at slot 0, once arrived, faces the counter (−Z) and shows a speech bubble: a camera-
 *   facing sprite (canvas texture: white rounded bubble with tail, a drawn log icon and "0/3"), popping
 *   in. They then pull logs from counter.pile into their own CarryStack (anchor = rig.armsAnchor,
 *   capacity = want, rig.setCarrying(true)) one every npcTakeInterval via transferOne; the bubble
 *   updates the count.
 * - When satisfied: cash.pay(want · logPrice, chest position); emit 'sale' { buyer:'customer',
 *   kind:'log', count, amount, position }; stats.logsSold += want; stats.customersServed++;
 *   rig.cheer(); bubble swaps to a happy face/heart; then walk the exitPath carrying the logs and
 *   despawn at its end (release items to the pool, remove the model). The queue advances.
 * - Variety: shades of blue bodies (PALETTE.customer / customerDark), random cap/beanie/none, ±6% scale.
 * - Must keep working with zero logs on the counter (customers just wait) and survive long sessions
 *   (no leaks: release everything on despawn).
 */
import type { GameContext } from '../core/types';
import type { Counter } from '../stations/Counter';
import type { CashPile } from '../stations/CashPile';

export interface CustomerQueueOptions {
  counter: Counter;
  cash: CashPile;
}

export class CustomerQueue {
  constructor(
    readonly ctx: GameContext,
    readonly opts: CustomerQueueOptions,
  ) {}

  /** Customers currently queued (including the one being served). */
  get waiting(): number {
    return 0;
  }

  /** True while the front customer stands at the counter wanting logs. */
  get frontWaiting(): boolean {
    return false;
  }

  update(_dt: number): void {}
}
