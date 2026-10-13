/**
 * [B5 — commerce] Phase 5: red/blue pickup trucks queueing on the north highway for bulk log orders.
 * Functional BASELINE (an invisible buyer pays for one log every 0.4 s): replace the body, keep the
 * public API.
 *
 * Spec: "expands the yard northward toward the highway with pickup trucks waiting for bulk orders."
 *
 * Behaviour (LAYOUT.expansion.trucks, ECONOMY.truckWant / truckLogPrice):
 * - Model (AssetFactory createPickupTruck in assets/vehicles.ts — yours): chunky low-poly pickup
 *   (~3.6 long) in PALETTE.truckRed or truckBlue — cab with windows, driver visible
 *   (createCharacterRig('driver'), seated), open bed at the rear holding a log Pile (parent = truck),
 *   4 wheels that spin, headlights. Faces −X (travel direction).
 * - The highway has a raised bridge over the river: sample y = ctx.environment.highwayY(x) every frame.
 * - Keep up to maxQueue trucks: spawn at (spawnX, laneZ) out of the tunnel side, drive −X to free
 *   slots (slot i at x = frontX + i·spacing), the front truck's bed lines up with the truck counter.
 * - Bubble with log icon + "0/10"; loads RAW LOGS from counter.pile into its bed every ~npcTakeInterval.
 * - When loaded: cash.pay(want · truckLogPrice, bed position); emit 'sale' { buyer:'truck', kind:'log' };
 *   stats.logsSold += want; stats.trucksServed++; bubble → ✓; honk-ish bounce; drive off −X to exitX,
 *   despawn.
 */
import * as THREE from 'three';
import { ECONOMY } from '../config';
import type { GameContext } from '../core/types';
import type { Counter } from '../stations/Counter';
import type { CashPile } from '../stations/CashPile';

export interface TruckQueueOptions {
  counter: Counter;
  cash: CashPile;
}

/** BASELINE: seconds between invisible purchases. */
const BASELINE_INTERVAL = 0.4;

export class TruckQueue {
  private baselineTimer = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly ctx: GameContext,
    readonly opts: TruckQueueOptions,
  ) {}

  get waiting(): number {
    return 0;
  }

  update(dt: number): void {
    // BASELINE (replace): an invisible truck buys one log at a time.
    this.baselineTimer -= dt;
    if (this.baselineTimer > 0) return;
    this.baselineTimer = BASELINE_INTERVAL;
    const item = this.opts.counter.pile.take('log');
    if (!item) return;
    item.object.getWorldPosition(this.tmp);
    this.ctx.items.release(item);
    const amount = ECONOMY.truckLogPrice;
    this.opts.cash.pay(amount, this.tmp);
    this.ctx.state.stats.logsSold++;
    this.ctx.state.stats.trucksServed++;
    this.ctx.events.emit('sale', { buyer: 'truck', kind: 'log', count: 1, amount, position: this.tmp });
  }
}
