import type { EventBus } from './EventBus';
import type { GameEvents, GameState } from './types';

/** Player money. The physical cash stack on the player's back is a visualisation of this number. */
export class Economy {
  private _money: number;
  /** 0.9.14: spends by anyone but the era builders so far (their reserve resets on each, npc/EraWorker.ts walletRef). */
  private _otherSpends = 0;

  constructor(
    private readonly events: EventBus<GameEvents>,
    private readonly state: GameState,
    startMoney = 0,
  ) {
    this._money = startMoney;
  }

  get money(): number {
    return this._money;
  }

  /** Spends by anyone but the era builders so far (counts up; compare with an earlier read). */
  get otherSpends(): number {
    return this._otherSpends;
  }

  canAfford(amount: number): boolean {
    return this._money >= amount;
  }

  /** Add money (positive amounts only). `earned` (default: all of it) counts toward stats.moneyEarned; returned principal does not. */
  add(amount: number, earned = amount): void {
    if (amount <= 0) return;
    this._money += amount;
    this.state.stats.moneyEarned += Math.max(0, Math.min(amount, earned));
    this.events.emit('money:changed', { money: this._money, delta: amount });
  }

  /** Spend money if affordable. Returns false (and changes nothing) otherwise. `builders`: the era builders pay. */
  spend(amount: number, builders = false): boolean {
    if (amount <= 0) return true;
    if (this._money < amount) return false;
    this._money -= amount;
    if (!builders) this._otherSpends++;
    this.events.emit('money:changed', { money: this._money, delta: -amount });
    return true;
  }
}
