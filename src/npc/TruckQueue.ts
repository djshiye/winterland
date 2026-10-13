/**
 * [B5 — commerce] Phase 5: red/blue pickup trucks queueing on the north highway for bulk log orders.
 * STUB: replace bodies, keep the public API.
 *
 * Spec: "expands the yard northward toward the highway with pickup trucks waiting for bulk orders."
 *
 * Behaviour (LAYOUT.expansion.trucks, ECONOMY.truckWant / truckLogPrice):
 * - Model: chunky low-poly pickup (~3.6 long) in PALETTE.truckRed or truckBlue — cab with windows,
 *   driver visible, open bed at the rear holding a log Pile (parent = truck), 4 wheels that spin,
 *   headlights. Faces −X (travel direction).
 * - Keep up to maxQueue trucks: spawn at (spawnX, laneZ) out of the tunnel side, drive −X to free
 *   slots (slot i at x = frontX + i·spacing), the front truck's bed lines up with the truck counter.
 * - Bubble with log icon + "0/10"; loads logs from counter.pile into its bed every ~npcTakeInterval.
 * - When loaded: cash.pay(want · truckLogPrice, bed position); emit 'sale' { buyer:'truck', kind:'log' };
 *   stats.logsSold += want; stats.trucksServed++; honk-ish bounce; drive off −X to exitX, despawn.
 */
import type { GameContext } from '../core/types';
import type { Counter } from '../stations/Counter';
import type { CashPile } from '../stations/CashPile';

export interface TruckQueueOptions {
  counter: Counter;
  cash: CashPile;
}

export class TruckQueue {
  constructor(
    readonly ctx: GameContext,
    readonly opts: TruckQueueOptions,
  ) {}

  get waiting(): number {
    return 0;
  }

  update(_dt: number): void {}
}
