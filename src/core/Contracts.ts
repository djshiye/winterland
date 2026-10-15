/**
 * [Wave 13] Delivery contracts (CONTRACTS in config): once the village is a Town, the gate's notice board offers one
 * contract at a time ("sell 20 loaves within 3 minutes for a $1,500 bonus"). Progress counts 'sale' events of the
 * contract's item kind (every sale event is to a real buyer); the bonus is paid on completion; a missed deadline
 * fails it. Saved in state.contract (the timer `left` counts play seconds, so a reload resumes it without a re-offer).
 * Emits 'contract:offered' / 'contract:done' / 'contract:failed'. Offers only kinds the player can make
 * (CONTRACTS.offers[].requires: a pad that is unlocked or a business that is built), never the same kind twice in a row
 * (when another is makeable). The gap between contracts is CONTRACTS.every, restarted after each done / failed.
 */
import { CONTRACTS, type BusinessId, type PadIdConst } from '../config';
import type { Economy } from './Economy';
import type { EventBus } from './EventBus';
import type { ContractState, GameEvents, GameState, ItemKind } from './types';

const NAMES: Partial<Record<ItemKind, [string, string]>> = {
  plank: ['plank', 'planks'],
  crate: ['crate', 'crates'],
  bread: ['loaf', 'loaves'],
  furniture: ['chair', 'chairs'],
  sausage: ['sausage', 'sausages'],
  toy: ['toy', 'toys'],
};

/** "20 loaves" / "1 chair". */
export function contractItem(kind: ItemKind | '', count: number): string {
  const n = kind === '' ? undefined : NAMES[kind];
  return `${count} ${n ? n[count === 1 ? 0 : 1] : kind}`;
}

/** "3:00" */
export function contractClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Contracts {
  private timer: number;
  private lastKind: ItemKind | '' = '';

  constructor(
    private readonly state: GameState,
    private readonly economy: Economy,
    private readonly events: EventBus<GameEvents>,
  ) {
    this.timer = this.nextGap();
    // A restored active contract resumes as-is (update() just keeps counting down); remember it for the no-repeat rule.
    this.lastKind = state.contract.kind;
    // Jack's swap cart is a discard, not a delivery (0.9.0)
    events.on('sale', (e) => {
      if (e.buyer !== 'jack') this.onSale(e.kind, e.count);
    });
  }

  get current(): ContractState {
    return this.state.contract;
  }

  get active(): boolean {
    return this.state.contract.kind !== '';
  }

  /**
   * Offer a contract now (debug / tests): a specific kind from CONTRACTS.offers (makeable or not), or the next eligible
   * one. Replaces any current contract. Does nothing when no offer matches.
   */
  offer(kind?: ItemKind): void {
    let def: (typeof CONTRACTS.offers)[number] | undefined;
    if (kind !== undefined) def = CONTRACTS.offers.find((o) => o.kind === kind);
    else {
      const ok = CONTRACTS.offers.filter((o) => this.canMake(o.requires));
      const fresh = ok.filter((o) => o.kind !== this.lastKind);
      const pool = fresh.length > 0 ? fresh : ok;
      def = pool[Math.floor(Math.random() * pool.length)];
    }
    if (!def) return;
    const c = this.state.contract;
    c.kind = def.kind;
    c.target = def.count;
    c.progress = 0;
    c.left = CONTRACTS.seconds;
    c.bonus = def.bonus;
    this.lastKind = def.kind;
    this.events.emit('contract:offered', { kind: def.kind, count: def.count, seconds: CONTRACTS.seconds, bonus: def.bonus });
  }

  /** Whether the player can make this kind (its pad is unlocked / a business with it is built). */
  canMake(requires: PadIdConst | BusinessId | null): boolean {
    if (requires === null) return true;
    if (requires in this.state.unlocked) return this.state.unlocked[requires as PadIdConst];
    return this.state.town.lots.some((l) => l.building === requires && l.tier >= 0);
  }

  update(dt: number): void {
    const c = this.state.contract;
    if (c.kind !== '') {
      c.left -= dt;
      if (c.left <= 0) {
        const kind = c.kind;
        this.clear();
        this.events.emit('contract:failed', { kind });
      }
      return;
    }
    if (this.state.village.level < CONTRACTS.minVillageLevel) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.nextGap(); // never re-enter while no kind is offerable
      this.offer();
    }
  }

  private onSale(kind: ItemKind, count: number): void {
    const c = this.state.contract;
    if (c.kind === '' || kind !== c.kind) return;
    c.progress = Math.min(c.target, c.progress + count);
    if (c.progress < c.target) return;
    const bonus = c.bonus;
    this.clear();
    this.economy.add(bonus);
    this.events.emit('contract:done', { kind, bonus });
  }

  private clear(): void {
    Object.assign(this.state.contract, { kind: '', target: 0, progress: 0, left: 0, bonus: 0 });
    this.timer = this.nextGap();
  }

  private nextGap(): number {
    const [a, b] = CONTRACTS.every;
    return a + Math.random() * (b - a);
  }
}
