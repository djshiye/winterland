/**
 * [B6 — machines] Cash tubes: pneumatic tubes from every cash pile to the cabin. Each pile loses one bundle every
 * ctx.upgrades.value('cashTubes') seconds (read live), which shoots into the tube and is banked (ctx.economy.add).
 *
 * CONTRACT (keep every public signature; B6 owns the implementation):
 * - piles(): the cash piles that exist right now (Level passes a getter; new piles appear as stations unlock).
 * - build(instant): visible + running; instant (restore) = final state, no animation / 'built' event / sound.
 * - Bundles in flight are banked on arrival; nothing is lost on save (the save counts pile values only).
 *
 * STUB (main session): no model; bundles are banked straight from the piles.
 */
import type { GameContext } from '../core/types';
import type { CashPile } from './CashPile';

export interface CashTubesOptions {
  piles: () => readonly CashPile[];
}

export class CashTubes {
  private timer = 0;
  private running = false;

  constructor(
    readonly ctx: GameContext,
    readonly opts: CashTubesOptions,
  ) {}

  build(_instant = false): void {
    this.running = true;
  }

  update(dt: number): void {
    if (!this.running) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.ctx.upgrades.value('cashTubes');
    for (const p of this.opts.piles()) {
      const item = p.pile.take('cash');
      if (!item) continue;
      this.ctx.economy.add(item.value);
      this.ctx.items.release(item);
    }
  }
}
