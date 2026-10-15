/**
 * [MAIN] The Steward (docs/EXPANSION.md §A2): the Settlement 20 perk. While state.eras.steward is on, every
 * CLIMB.steward.every seconds it buys the ONE cheapest level of the next era's checklist (the rows Raise all may buy:
 * shop and Industry rows below their need) if the wallet stays above Raise all's reserve (eras/gate.ts raiseReserve).
 *
 * - It is a perk, not an upgrade, so it adds no gate row; the toggle lives in the GateCard footer (ui/GateCard.ts).
 * - Purchases are batch buys (Upgrades.raiseAll): no per-level juice, so a quiet wallet is not a ding every 2 s. A row
 *   it finishes still ticks through 'gate:progress' (GateTracker), like Raise all.
 * - Machine-pad rows are left to the player, as with Raise all (a pad may hold part of a payment).
 * - Nothing is saved but the toggle; below Settlement 20 (or past the last era) it does nothing.
 */
import { CLIMB } from '../config';
import type { GameContext } from '../core/types';
import { eraGate, raiseReserve, raiseRows, stewardActive } from './gate';

export class Steward {
  private acc = 0;

  constructor(private readonly ctx: GameContext) {
    ctx.addUpdatable(this);
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.acc < CLIMB.steward.every) return;
    this.acc = 0;
    this.tick();
  }

  /** One Steward step (tests call it directly). Returns the levels bought (0 or 1). */
  tick(): number {
    const { state, upgrades, economy } = this.ctx;
    if (!stewardActive(state)) return 0;
    const rows = raiseRows(eraGate(state, state.eras.age + 1));
    if (rows.length === 0) return 0;
    return upgrades.raiseAll(rows, raiseReserve(economy.money), 1);
  }
}
