/**
 * [Wave 13] Delivery contracts (CONTRACTS in config): once the village is a Town, the gate's notice board offers one
 * contract at a time ("sell 20 loaves within 3 minutes for a $1,500 bonus"). Progress counts 'sale' events of the
 * contract's item kind (every sale event is to a real buyer); the bonus is paid on completion; a missed deadline
 * fails it. Saved in state.contract (the timer `left` counts play seconds, so a reload resumes it without a re-offer).
 * Emits 'contract:offered' / 'contract:done' / 'contract:failed'. Offers only kinds the player can make
 * (CONTRACTS.offers[].requires: a pad that is unlocked or a business that is built), never the same kind twice in a row
 * (when another is makeable). The gap between contracts is CONTRACTS.every, restarted after each done / failed.
 *
 * 0.9.6 (F9): from era 2 on, contracts follow the era the player is in (state.eras.age): eraOffers() lists that era's
 * materials its built machines make, and the bonus is CONTRACTS.era.incomeSeconds of the recent sales rate (a rolling
 * 5-minute window kept here from the same 'sale' events), never below minShare × the goods' export value. Survival's
 * fixed offers stop once era 2 is open, so "15 sausages · +$2,500" no longer pops up at $218B.
 */
import { CONTRACTS, type BusinessId, type PadIdConst } from '../config';
import { MACHINES, MATERIALS, type MaterialKind } from '../eras/data';
import { IncomeWindow, sig2Money } from './incomeWindow';
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

/** "20 loaves" / "1 chair" / "24 bricks" (era materials by their label, lower-case). */
export function contractItem(kind: ItemKind | '', count: number): string {
  const n = kind === '' ? undefined : NAMES[kind];
  if (n) return `${count} ${n[count === 1 ? 0 : 1]}`;
  const m = kind === '' ? undefined : MATERIALS[kind as MaterialKind];
  return `${count} ${m ? m.label.toLowerCase() : kind}`;
}

/** One era contract on offer: a material of era `age` and its base export price per unit. */
export interface EraOffer {
  kind: ItemKind;
  value: number;
}

/**
 * Era `age`'s contract goods (age ≥ 2): the outputs of the machines built in its region that belong to that era
 * (a material of an older era made there does not count), each once. Empty when nothing is built yet.
 */
export function eraOffers(state: Pick<GameState, 'eras'>, age: number): EraOffer[] {
  const out: EraOffer[] = [];
  const slots = state.eras.regions[age]?.slots ?? [];
  for (const sl of slots) {
    if (sl.machine === '' || sl.tier < 0) continue;
    const kind = MACHINES[sl.machine]?.output;
    const m = kind ? MATERIALS[kind as MaterialKind] : undefined;
    if (!m || m.era !== age || out.some((o) => o.kind === kind)) continue;
    out.push({ kind: kind!, value: m.value });
  }
  return out;
}

/** Bonus for an era contract: `incomeSeconds` of the sales rate, at least minShare × the goods' value, 2 significant digits. */
export function eraBonus(rate: number, count: number, value: number): number {
  const e = CONTRACTS.era;
  return sig2Money(Math.max(rate * e.incomeSeconds, count * value * e.minShare, 1));
}

/** "3:00" */
export function contractClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Contracts {
  private timer: number;
  private lastKind: ItemKind | '' = '';
  private readonly income = new IncomeWindow();

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
      if (e.buyer === 'jack') return;
      this.income.add(e.amount);
      this.onSale(e.kind, e.count);
    });
  }

  get current(): ContractState {
    return this.state.contract;
  }

  get active(): boolean {
    return this.state.contract.kind !== '';
  }

  /** Recent sales in dollars per second (the rolling window; what has been played of it this session). */
  get salesRate(): number {
    return this.income.rate;
  }

  /**
   * Offer a contract now (debug / tests): a specific kind from CONTRACTS.offers (makeable or not), or the next eligible
   * one. Replaces any current contract. Does nothing when no offer matches.
   */
  offer(kind?: ItemKind): void {
    // 0.9.6: from era 2 on, contracts come from the era the player is in
    if (this.state.eras.age >= 2 && (kind === undefined || !CONTRACTS.offers.some((o) => o.kind === kind))) {
      this.offerEra(kind);
      return;
    }
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

  /** An era contract (age ≥ 2): a good its built machines make, CONTRACTS.era.count of it, the bonus from eraBonus. */
  private offerEra(kind?: ItemKind): void {
    const age = this.state.eras.age;
    const ok = eraOffers(this.state, age);
    let def: EraOffer | undefined;
    if (kind !== undefined) {
      const m = MATERIALS[kind as MaterialKind];
      def = ok.find((o) => o.kind === kind) ?? (m ? { kind, value: m.value } : undefined);
    } else {
      const fresh = ok.filter((o) => o.kind !== this.lastKind);
      const pool = fresh.length > 0 ? fresh : ok;
      def = pool[Math.floor(Math.random() * pool.length)];
    }
    if (!def) return;
    const [lo, hi] = CONTRACTS.era.count;
    const count = Math.round((lo + Math.random() * (hi - lo)) / 5) * 5;
    const bonus = eraBonus(this.salesRate, count, def.value);
    const c = this.state.contract;
    c.kind = def.kind;
    c.target = count;
    c.progress = 0;
    c.left = CONTRACTS.seconds;
    c.bonus = bonus;
    this.lastKind = def.kind;
    this.events.emit('contract:offered', { kind: def.kind, count, seconds: CONTRACTS.seconds, bonus });
  }

  /** Whether the player can make this kind (its pad is unlocked / a business with it is built). */
  canMake(requires: PadIdConst | BusinessId | null): boolean {
    if (requires === null) return true;
    if (requires in this.state.unlocked) return this.state.unlocked[requires as PadIdConst];
    return this.state.town.lots.some((l) => l.building === requires && l.tier >= 0);
  }

  update(dt: number): void {
    this.income.tick(dt);
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
