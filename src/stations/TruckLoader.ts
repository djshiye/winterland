/**
 * [B6 — machines] Truck loader: a belt in the expanded north yard that carries logs from the drop zone to the truck
 * counter (LAYOUT.expansion.truckCounter), so the trucks no longer need the player or the log hauler. No levels
 * (like the other belts). The belt path is B6's to define (validate it against colliders, zones and NPC routes).
 *
 * CONTRACT (keep every public signature; B6 owns the implementation):
 * - build(instant): visible + running; instant (restore) = final state, no animation / 'built' event / sound.
 * - load: logs riding the belt right now (the save puts them back on the drop zone).
 * - Takes only from `from` (drop-zone pile) when `to` (truck counter input) can accept; moves items only via
 *   items/transfer.ts.
 *
 * STUB (main session): no model; logs hop straight across on a timer.
 */
import type { GameContext, ItemHolder } from '../core/types';
import { transferOne } from '../items/transfer';

export interface TruckLoaderOptions {
  from: ItemHolder;
  to: ItemHolder;
}

export class TruckLoader {
  private timer = 0;
  private running = false;

  constructor(
    readonly ctx: GameContext,
    readonly opts: TruckLoaderOptions,
  ) {}

  get load(): number {
    return 0;
  }

  build(_instant = false): void {
    this.running = true;
  }

  update(dt: number): void {
    if (!this.running) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    if (this.opts.to.canAccept('log')) transferOne(this.ctx, this.opts.from, this.opts.to, ['log'], { duration: 1.2, arcHeight: 3 });
  }
}
