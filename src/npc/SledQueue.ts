/**
 * [B5 — commerce] Dog sleds on Timber Ridge (wave 8): a sled pulled by a husky team runs along
 * LAYOUT.ridge.sledLane (along X at lane z, arriving from +X), stops beside the sled counter, loads furniture from it
 * (want from DEMAND sledGap / sledWant, read at spawn, bubble "n/want"), pays
 * salePrice(state,'furniture',ECONOMY.furniturePrice,want) into the sled cash pile, emits 'sale'
 * {buyer:'sled', kind:'furniture'}, stats.furnitureSold += want, barks happily and leaves.
 *
 * CONTRACT (keep every public signature; B5 owns the implementation):
 * - constructor(ctx, {counter, cash}); update(dt); `loadedPieces` (furniture on a loading sled, for the save).
 *
 * STUB (main session): no sled; the counter sells on a timer.
 */
import { ECONOMY } from '../config';
import { demandOf, salePrice } from '../core/demand';
import type { GameContext } from '../core/types';
import type { CashPile } from '../stations/CashPile';
import type { Counter } from '../stations/Counter';

export interface SledQueueOptions {
  counter: Counter;
  cash: CashPile;
}

export class SledQueue {
  private timer = 6;

  constructor(
    readonly ctx: GameContext,
    readonly opts: SledQueueOptions,
  ) {}

  get loadedPieces(): number {
    return 0;
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    const d = demandOf(this.ctx.state);
    this.timer = d.sledGap[0] + Math.random() * (d.sledGap[1] - d.sledGap[0]);
    const pile = this.opts.counter.pile;
    const want = Math.min(pile.count('furniture'), d.sledWant[1]);
    if (want < d.sledWant[0]) return;
    for (let i = 0; i < want; i++) {
      const item = pile.take('furniture');
      if (item) this.ctx.items.release(item);
    }
    const amount = salePrice(this.ctx.state, 'furniture', ECONOMY.furniturePrice, want);
    this.ctx.state.stats.furnitureSold += want;
    const at = pile.root.position.clone();
    this.opts.cash.pay(amount, at);
    this.ctx.events.emit('sale', { buyer: 'sled', kind: 'furniture', count: want, amount, position: at });
  }
}
