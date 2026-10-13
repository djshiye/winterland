/**
 * [B5 — commerce] Pile of green cash bundles beside a counter that the player walks over to collect.
 * STUB (functional baseline): replace/extend, keep the public API.
 *
 * - pile: cash Pile (overflowMerge) on the ground at (x, z), neat grid from config.
 * - zone: pile → player.back transfer zone (kinds ['cash'], TIMING.pickupInterval, no marker needed;
 *   a subtle ground ring is nice).
 * - pay(amount, from): split `amount` into ECONOMY.cashBundleValue bundles and launch them one after
 *   another (~0.04 s apart, simulation time via ctx.tweens.delay) from `from` into the pile with
 *   launchNew (arc ~0.35 s, height ~1.5) so the pile visibly grows. The caller emits 'sale'.
 */
import * as THREE from 'three';
import { ECONOMY, type PileGrid, type Rect } from '../config';
import type { GameContext } from '../core/types';
import { Pile } from '../items/Pile';
import { launchNew } from '../items/transfer';
import type { Zone } from '../items/Zones';

export interface CashPileOptions {
  /** Holder id, e.g. 'pile:walkInCash'. */
  id: string;
  x: number;
  z: number;
  grid: PileGrid;
  zone: Rect;
}

export class CashPile {
  readonly pile: Pile;
  readonly zone: Zone;

  constructor(
    readonly ctx: GameContext,
    readonly opts: CashPileOptions,
  ) {
    this.pile = new Pile(ctx, {
      id: opts.id,
      accepts: ['cash'],
      position: new THREE.Vector3(opts.x, 0, opts.z),
      grid: opts.grid,
      overflowMerge: true,
    });
    this.zone = ctx.zones.addTransfer({
      id: `${opts.id}:collect`,
      area: opts.zone,
      from: this.pile,
      to: ctx.player.back,
      kinds: ['cash'],
    });
  }

  /** Dollars lying in the pile (landed bundles). */
  get value(): number {
    return this.pile.totalValue();
  }

  pay(amount: number, from: THREE.Vector3): void {
    const n = Math.max(1, Math.round(amount / ECONOMY.cashBundleValue));
    const start = from.clone();
    for (let i = 0; i < n; i++) {
      this.ctx.tweens.delay(i * 0.04, () => {
        launchNew(this.ctx, 'cash', start, this.pile, { duration: 0.35, arcHeight: 1.5 });
      });
    }
  }

  appear(): void {
    this.ctx.tweens.popIn(this.pile.root);
  }
}
