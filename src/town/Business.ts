/**
 * [T2 — town] One built town building (BUSINESSES[id]) on lot `lot`: a producer, a shop or a home.
 *
 * CONTRACT (T2 owns the implementation; Town is its only constructor caller):
 * - producer: every def.cycle seconds (while its out pile has room) makes one def.output item onto `output`
 *   (launchNew, a little hop out of the barn door); a transfer zone gives them to the player's arms.
 *   stats.goodsMade++, emit 'goods:made'.
 * - shop: `input` (a hopper Pile, mixed kinds) takes def.inputs kinds from the player's arms (transfer zone, only
 *   kinds it still needs room for); a cycle starts when it holds `per` of every input kind and `output` (the
 *   counter, a Pile) has room: takes them, works (chimney puffs / oven glow / bench animation), puts one def.output
 *   on the counter. `till` (CashPile) receives the townsfolk's payments; asShop() exposes the ShopSpot.
 * - home: no stations; just the model (lit windows at night, chimney smoke).
 * - build(instant): visible + running; instant (restore) = final state, no animation / event / sound.
 * - inProcess: input items taken for the current cycle whose product isn't on the counter yet (for the save,
 *   by kind).
 */
import type { BusinessDef } from '../config';
import type { GameContext, ItemKind } from '../core/types';
import type { Pile } from '../items/Pile';
import type { CashPile } from '../stations/CashPile';
import type { ShopSpot } from './types';

export class Business {
  readonly input: Pile | null = null;
  readonly output: Pile | null = null;
  readonly till: CashPile | null = null;

  constructor(
    readonly ctx: GameContext,
    readonly lot: number,
    readonly def: BusinessDef,
  ) {}

  get inProcess(): Partial<Record<ItemKind, number>> {
    return {};
  }

  asShop(): ShopSpot | null {
    return null;
  }

  build(_instant: boolean): void {}

  update(_dt: number): void {}
}
