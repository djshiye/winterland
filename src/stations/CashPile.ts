/**
 * [B5 — commerce] Pile of green cash bundles beside a counter that the player walks over to collect.
 *
 * - pile: cash Pile (overflowMerge) on the ground at (x, z), neat grid from config.
 * - zone: pile → player.back transfer zone (kinds ['cash'], TIMING.pickupInterval, no marker needed;
 *   a subtle ground ring is nice).
 * - pay(amount, from): split `amount` into at most 12 bundles (multiples of 5) and launch them one after
 *   another (~0.04 s apart, simulation time via ctx.tweens.delay) from `from` into the pile with
 *   launchNew (arc ~0.35 s, height ~1.5) so the pile visibly grows. The caller emits 'sale'.
 */
import * as THREE from 'three';
import { COLORS, ECONOMY, PALETTE, type PileGrid, type Rect } from '../config';
import type { GameContext } from '../core/types';
import { Pile } from '../items/Pile';
import { launchNew } from '../items/transfer';
import type { Zone } from '../items/Zones';
import { basic, geo, mesh } from '../render/materials';

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
    // Subtle ground marker under the grid: a soft white plate with a green rim.
    const gw = opts.grid.cols * opts.grid.spacing.x + 0.3;
    const gd = opts.grid.rows * opts.grid.spacing.z + 0.3;
    const rim = mesh(geo.ground(gw + 0.1, gd + 0.1), basic(COLORS.CASH_GREEN, { transparent: true, opacity: 0.4, depthWrite: false }), {
      cast: false,
    });
    const plate = mesh(geo.ground(gw, gd), basic(PALETTE.zoneMarker, { transparent: true, opacity: 0.16, depthWrite: false }), {
      cast: false,
    });
    rim.position.y = 0.03;
    plate.position.y = 0.036;
    rim.renderOrder = 1;
    plate.renderOrder = 2;
    this.pile.root.add(rim, plate);
    this.zone = ctx.zones.addTransfer({
      id: `${opts.id}:collect`,
      area: opts.zone,
      from: this.pile,
      to: ctx.player.back,
      kinds: ['cash'],
    });
  }

  /** Dollars paid in but not yet landed: bundles waiting in pay()'s stagger delays plus bundles in the air. */
  private inFlight = 0;

  /**
   * Dollars belonging to the pile: landed bundles + bundles still on their way (pay() is accounted the moment it is
   * called, so a save never sees the money vanish while it flies).
   */
  get value(): number {
    return this.pile.totalValue() + this.inFlight;
  }

  /** Dollars not yet landed (included in `value`). */
  get inFlightValue(): number {
    return this.inFlight;
  }

  /**
   * Pay `amount` dollars into the pile as at most MAX_PAY_BUNDLES bundles (values are multiples of
   * ECONOMY.cashBundleValue, the remainder spread over the first ones): fewer items, same total.
   */
  pay(amount: number, from: THREE.Vector3): void {
    const values = splitBundles(amount, MAX_PAY_BUNDLES);
    const start = from.clone();
    for (let i = 0; i < values.length; i++) this.inFlight += values[i]!;
    for (let i = 0; i < values.length; i++) {
      const value = values[i]!;
      // Each bundle subtracts exactly its own value, once: when it has landed (onLand runs after the pile merged /
      // placed it, so `value` never dips) or at once if it could not be launched.
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        this.inFlight = Math.max(0, this.inFlight - value);
      };
      this.ctx.tweens.delay(i * 0.04, () => {
        const item = launchNew(this.ctx, 'cash', start, this.pile, { duration: 0.35, arcHeight: 1.5, value, onLand: settle });
        if (!item) settle();
      });
    }
  }

  /**
   * Restoring a save: put `value` dollars in the pile at once (no flights, no events) as at most `capacity`
   * bundles whose values are multiples of 5 (the total is preserved).
   */
  restoreValue(value: number): void {
    this.pile.clear();
    for (const v of splitBundles(value, this.pile.capacity)) {
      const item = this.ctx.items.create('cash', v);
      if (!this.pile.addImmediate(item)) {
        this.ctx.items.release(item);
        break;
      }
    }
  }

  /** instant (restoring a save): final state at once — no animation, no 'built' event, no sound. */
  appear(instant = false): void {
    this.pile.root.visible = true;
    if (instant) return;
    this.ctx.tweens.popIn(this.pile.root);
  }
}

const MAX_PAY_BUNDLES = 12;

/** Split `amount` dollars into at most `maxCount` bundle values (multiples of the bundle value, summing to it). */
function splitBundles(amount: number, maxCount: number): number[] {
  const b = ECONOMY.cashBundleValue;
  const units = Math.max(0, Math.floor(amount / b));
  if (units === 0) return [];
  const n = Math.max(1, Math.min(maxCount, units));
  const per = Math.floor(units / n);
  const extra = units - per * n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((per + (i < extra ? 1 : 0)) * b);
  return out;
}
