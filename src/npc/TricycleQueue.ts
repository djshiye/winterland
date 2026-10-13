/**
 * [B5 — commerce] Blue cargo tricycles queueing on the SE road next to the SE counter.
 * Functional BASELINE (an invisible buyer pays for one crate every 0.6 s): replace the body, keep the
 * public API.
 *
 * Spec: "delivery NPCs on blue 3-wheeled cargo bikes queue up next to a secondary counter ... Player
 * transfers crates to the South-East counter, where NPCs on blue cargo tricycles load them up, drive
 * off, and leave larger stacks of Green Cash Bundles."
 *
 * Art spec (AssetFactory createTricycle in assets/vehicles.ts — yours):
 * - Blue (MACHINE_BLUE) front fork, ONE front wheel r 0.25 in dark grey, rear flatbed axle with TWO
 *   wheels; open-top blue cargo tray 0.9 × 0.3 × 0.9 with a `cargoPivot` holding up to 6 crates
 *   (LAYOUT.tricycles.cargoGrid). Wheels spin with distance travelled; slight bounce while riding.
 * - Rider: createCharacterRig('courier') (yellow COURIER_YELLOW helmet; owned by B1), setSeated(true).
 * - Faces +Z (travel direction), ~2.4 long.
 *
 * Behaviour (LAYOUT.tricycles, ECONOMY.tricycleWant / cratePrice):
 * - Keep up to maxQueue trikes. Spawn at (laneX, spawnZ), drive +Z (accelerate/brake smoothly) to the
 *   first free slot (slot i at z = frontZ − i·spacing). The front trike parks beside the SE counter.
 * - Front trike shows a speech bubble (crate icon + "0/4") and loads crates from counter.pile into its
 *   cargo Pile (parent = cargoPivot) one every ~npcTakeInterval·1.3 via transferOne.
 * - When loaded: cash.pay(want · cratePrice, trike position); emit 'sale' { buyer:'tricycle',
 *   kind:'crate', ... }; stats.cratesSold += want; stats.tricyclesServed++; bubble → ✓; rider cheers;
 *   drive off +Z to exitZ and despawn (release crates + model). Queue advances.
 */
import * as THREE from 'three';
import { ECONOMY } from '../config';
import type { GameContext } from '../core/types';
import type { Counter } from '../stations/Counter';
import type { CashPile } from '../stations/CashPile';

export interface TricycleQueueOptions {
  counter: Counter;
  cash: CashPile;
}

/** BASELINE: seconds between invisible purchases. */
const BASELINE_INTERVAL = 0.6;

export class TricycleQueue {
  private baselineTimer = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly ctx: GameContext,
    readonly opts: TricycleQueueOptions,
  ) {}

  /** Trikes currently queued (including the one loading). */
  get waiting(): number {
    return 0;
  }

  update(dt: number): void {
    // BASELINE (replace): an invisible trike buys one crate at a time.
    this.baselineTimer -= dt;
    if (this.baselineTimer > 0) return;
    this.baselineTimer = BASELINE_INTERVAL;
    const item = this.opts.counter.pile.take('crate');
    if (!item) return;
    item.object.getWorldPosition(this.tmp);
    this.ctx.items.release(item);
    const amount = ECONOMY.cratePrice;
    this.opts.cash.pay(amount, this.tmp);
    this.ctx.state.stats.cratesSold++;
    this.ctx.state.stats.tricyclesServed++;
    this.ctx.events.emit('sale', { buyer: 'tricycle', kind: 'crate', count: 1, amount, position: this.tmp });
  }
}
