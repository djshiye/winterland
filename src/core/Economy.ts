import type { EventBus } from './EventBus';
import type { GameEvents, GameState } from './types';

/** Player money. The physical cash stack on the player's back is a visualisation of this number. */
export class Economy {
  private _money: number;

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

  /** Spend money if affordable. Returns false (and changes nothing) otherwise. */
  spend(amount: number): boolean {
    if (amount <= 0) return true;
    if (this._money < amount) return false;
    this._money -= amount;
    this.events.emit('money:changed', { money: this._money, delta: -amount });
    return true;
  }
}
