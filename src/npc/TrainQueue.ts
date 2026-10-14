/**
 * [B5 — commerce] Freight trains on Timber Ridge: a locomotive + flatcars run along the rail (LAYOUT.ridge.rail),
 * stop at the platform, load pine logs from the platform counter (want from DEMAND trainGap / trainWant, read at
 * spawn), pay salePrice(state, 'pine', ECONOMY.pinePrice, want) into the platform cash pile, emit 'sale'
 * {buyer: 'train', kind: 'log'} and leave. stats.logsSold counts the logs.
 *
 * CONTRACT (keep every public signature; B5 owns the implementation):
 * - constructor(ctx, {counter, cash}); update(dt). Built when the ridge opens (Level), instantly on restore.
 *
 * STUB (main session): no train; the platform sells a load on a timer.
 */
import { ECONOMY } from '../config';
import { demandOf, salePrice } from '../core/demand';
import type { GameContext } from '../core/types';
import type { CashPile } from '../stations/CashPile';
import type { Counter } from '../stations/Counter';

export interface TrainQueueOptions {
  counter: Counter;
  cash: CashPile;
}

export class TrainQueue {
  private timer = 5;

  constructor(
    readonly ctx: GameContext,
    readonly opts: TrainQueueOptions,
  ) {}

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    const d = demandOf(this.ctx.state);
    this.timer = d.trainGap[0] + Math.random() * (d.trainGap[1] - d.trainGap[0]);
    const pile = this.opts.counter.pile;
    const want = Math.min(pile.count('log'), d.trainWant[1]);
    if (want < d.trainWant[0]) return;
    for (let i = 0; i < want; i++) {
      const item = pile.take('log');
      if (item) this.ctx.items.release(item);
    }
    const amount = salePrice(this.ctx.state, 'pine', ECONOMY.pinePrice, want);
    this.ctx.state.stats.logsSold += want;
    const at = this.opts.counter.pile.root.position.clone();
    this.opts.cash.pay(amount, at);
    this.ctx.events.emit('sale', { buyer: 'train', kind: 'log', count: want, amount, position: at });
  }
}
