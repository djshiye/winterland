/**
 * [B5 — commerce] Blue cargo tricycles queueing on the SE road next to the SE counter.
 * STUB: replace bodies, keep the public API.
 *
 * Spec: "delivery NPCs on blue 3-wheeled cargo bikes queue up next to a secondary counter ... Player
 * transfers crates to the South-East counter, where NPCs on blue cargo tricycles load them up, drive
 * off, and leave larger stacks of Green Cash Bundles."
 *
 * Behaviour (LAYOUT.tricycles, ECONOMY.tricycleWant / cratePrice):
 * - Model: blue (PALETTE.trike) cargo trike ~2.4 long facing +Z (travel direction): one front wheel,
 *   two rear wheels (rubber tyres + hubs) that spin with distance travelled, frame, handlebars, seat,
 *   seated rider (CharacterRig, setSeated(true), varied shirt colour), open cargo box at the rear
 *   holding a crate Pile (parent = trike, cargoGrid). Slight bounce while riding.
 * - Keep up to maxQueue trikes. Spawn at (laneX, spawnZ), drive +Z (accelerate/brake smoothly) to the
 *   first free slot (slot i at z = frontZ − i·spacing). The front trike parks beside the SE counter.
 * - Front trike shows a speech bubble (crate icon + "0/4") and loads crates from counter.pile into its
 *   cargo pile one every ~npcTakeInterval·1.3 via transferOne.
 * - When loaded: cash.pay(want · cratePrice, trike position); emit 'sale' { buyer:'tricycle',
 *   kind:'crate', ... }; stats.cratesSold += want; stats.tricyclesServed++; rider cheers; drive off +Z
 *   to exitZ and despawn (release crates + model). Queue advances.
 */
import type { GameContext } from '../core/types';
import type { Counter } from '../stations/Counter';
import type { CashPile } from '../stations/CashPile';

export interface TricycleQueueOptions {
  counter: Counter;
  cash: CashPile;
}

export class TricycleQueue {
  constructor(
    readonly ctx: GameContext,
    readonly opts: TricycleQueueOptions,
  ) {}

  /** Trikes currently queued (including the one loading). */
  get waiting(): number {
    return 0;
  }

  update(_dt: number): void {}
}
