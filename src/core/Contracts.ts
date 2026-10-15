/**
 * [Wave 13] Delivery contracts (CONTRACTS in config): once the village is a Town, the gate's notice board offers one
 * contract at a time ("sell 20 loaves within 3 minutes for a $1,500 bonus"). Progress counts 'sale' events of the
 * contract's item kind; the bonus is paid on completion; a missed deadline fails it. Saved in state.contract (the
 * timer `left` counts play seconds, so a reload resumes it). Emits 'contract:offered' / 'contract:done' /
 * 'contract:failed'. Offers only kinds the player can make (CONTRACTS.offers[].requires: a pad or a business).
 * TODO(contracts builder): implement scheduling, offer picking, sale counting, completion and failure.
 */
import { CONTRACTS, type BusinessId, type PadIdConst } from '../config';
import type { Economy } from './Economy';
import type { EventBus } from './EventBus';
import type { ContractState, GameEvents, GameState, ItemKind } from './types';

export class Contracts {
  constructor(
    private readonly state: GameState,
    private readonly economy: Economy,
    private readonly events: EventBus<GameEvents>,
  ) {
    void this.economy;
    void this.events;
  }

  get current(): ContractState {
    return this.state.contract;
  }

  get active(): boolean {
    return this.state.contract.kind !== '';
  }

  /** Offer a contract now (debug / tests): a specific kind, or the next eligible one. */
  offer(kind?: ItemKind): void {
    void kind;
    void CONTRACTS;
    // TODO(contracts builder)
  }

  /** Whether the player can make this kind (its pad / business exists). */
  canMake(requires: PadIdConst | BusinessId | null): boolean {
    void requires;
    return true;
  }

  update(_dt: number): void {
    // TODO(contracts builder)
  }
}
