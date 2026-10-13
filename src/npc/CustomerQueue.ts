/**
 * [B5 — commerce] Walk-in customers queueing at the walk-in counter.
 * Functional BASELINE (an invisible buyer pays for one plank every 0.5 s): replace the body, keep the
 * public API.
 *
 * Spec: "Queued blue NPCs show a speech bubble requesting wood. They take [wood] from the counter, leave
 * Green Cash Bundles in a neat 3D grid pile right next to the counter, and walk away while the queue
 * advances."
 *
 * Art spec (models come from AssetFactory):
 * - Customer: capsule body r 0.3, h 0.75 in CUSTOMER_BLUE with a hood sphere — build the animated
 *   character with createCharacterRig('customer', variant) (render/characters.ts; owned by B1).
 * - Speech bubble: camera-facing billboard (CanvasTexture, AssetFactory createSpeechBubble in
 *   assets/shop.ts — yours) showing a wood PLANK icon while first in line (with a "1/3" count is nice),
 *   or a green ✓ when fulfilled.
 *
 * Behaviour (LAYOUT.customers, ECONOMY.customerWant / plankPrice, TIMING.npcTakeInterval):
 * - Keep up to maxQueue customers. Spawn at `spawn` (staggered ~1–1.5 s) and walk (walkSpeed,
 *   rig walk anim, facing travel direction) to the first free queue slot (slot i = front + i·spacing
 *   along +Z). Customers shuffle forward as slots free up.
 * - The customer at slot 0, once arrived, faces the counter (−Z) and shows the bubble (pop in). They
 *   then pull PLANK BUNDLES (counter.displayKind) from counter.pile into their own CarryStack
 *   (anchor = rig.armsAnchor, capacity = want, rig.setCarrying(true)) one every npcTakeInterval via
 *   transferOne; the bubble updates the count.
 * - When satisfied: cash.pay(want · plankPrice, chest position); emit 'sale' { buyer:'customer',
 *   kind:'plank', count, amount, position }; stats.logsSold += want (each plank is one log sold);
 *   stats.customersServed++; rig.cheer(); bubble swaps to the ✓; then walk the exitPath carrying the
 *   planks and despawn at its end (release items to the pool, remove the model). The queue advances.
 * - Variety: createCharacterRig variants, ±6% scale.
 * - Must keep working with nothing on the counter (customers just wait) and survive long sessions
 *   (no leaks: release everything on despawn).
 */
import * as THREE from 'three';
import { ECONOMY } from '../config';
import type { GameContext } from '../core/types';
import type { Counter } from '../stations/Counter';
import type { CashPile } from '../stations/CashPile';

export interface CustomerQueueOptions {
  counter: Counter;
  cash: CashPile;
}

/** BASELINE: seconds between invisible purchases. */
const BASELINE_INTERVAL = 0.5;

export class CustomerQueue {
  private baselineTimer = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly ctx: GameContext,
    readonly opts: CustomerQueueOptions,
  ) {}

  /** Customers currently queued (including the one being served). */
  get waiting(): number {
    return 0;
  }

  /** True while the front customer stands at the counter wanting planks. */
  get frontWaiting(): boolean {
    return false;
  }

  update(dt: number): void {
    // BASELINE (replace): an invisible customer buys one plank at a time.
    this.baselineTimer -= dt;
    if (this.baselineTimer > 0) return;
    this.baselineTimer = BASELINE_INTERVAL;
    const counter = this.opts.counter;
    const item = counter.pile.take(counter.displayKind);
    if (!item) return;
    item.object.getWorldPosition(this.tmp);
    this.ctx.items.release(item);
    const amount = ECONOMY.plankPrice;
    this.opts.cash.pay(amount, this.tmp);
    this.ctx.state.stats.logsSold++;
    this.ctx.state.stats.customersServed++;
    this.ctx.events.emit('sale', { buyer: 'customer', kind: counter.displayKind, count: 1, amount, position: this.tmp });
  }
}
