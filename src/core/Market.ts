/**
 * [STUB — market builder replaces the bodies, keeps every public signature] 0.9.0 market: material prices (random
 * walk + mean reversion + supply pressure), export sales, Jack's swap cart payouts, trading of virtual holdings,
 * physical orders to a region's import dock, investments (bond / index fund / era ventures), net worth.
 *
 * Determinism rule: Survival goods (every non-material ItemKind) never fluctuate: unitValue = SURVIVAL_VALUE ×
 * the village demand price multiplier. Material indices only move for eras already reached (state.eras.age).
 */
import type * as THREE from 'three';
import { demandOf, seasonMult } from './demand';
import { ERAS, INVEST, isMaterial, MATERIALS, SURVIVAL_VALUE, type InvestProductId } from '../eras/data';
import type { GameContext, InvestmentState, ItemKind, MaterialKind, Updatable } from './types';

export class Market implements Updatable {
  constructor(private readonly ctx: GameContext) {}

  /** Value of one unit right now before sales upgrades: materials base × index × (1 − pressure); Survival goods fixed. */
  unitValue(kind: ItemKind): number {
    if (!isMaterial(kind)) return SURVIVAL_VALUE[kind] * demandOf(this.ctx.state).priceMult;
    return MATERIALS[kind].value * this.index(kind) * (1 - (this.ctx.state.market.pressure[kind] ?? 0));
  }

  /** What an export depot pays for `count` units of `kind` now (× the era's Trade upgrade × season bonus). */
  exportPrice(kind: ItemKind, count: number): number {
    if (!isMaterial(kind)) return Math.round(this.unitValue(kind) * count);
    const key = ERAS[MATERIALS[kind].era]!.key;
    return Math.round(this.unitValue(kind) * count * this.ctx.upgrades.value(`${key}Trade`) * seasonMult(this.ctx.state));
  }

  /** An export depot received `count` units: credit the money, apply supply pressure, stats, 'sale' {buyer 'export'}. */
  sellExport(kind: ItemKind, count: number, position: THREE.Vector3): number {
    const amount = this.exportPrice(kind, count);
    this.ctx.economy.add(amount);
    this.ctx.state.stats.materialsSold += count;
    this.ctx.events.emit('sale', { buyer: 'export', kind, count, amount, position });
    return amount;
  }

  /** Jack's offer for one `kind` right now (UPGRADES.jack share × unitValue, at least $1 for anything but cash). */
  jackOffer(kind: ItemKind): number {
    if (kind === 'cash') return 0;
    return Math.max(1, Math.round(this.unitValue(kind) * this.ctx.upgrades.value('jack')));
  }

  /** Jack bought one item: credit jackOffer, stats.jackEarned, 'sale' {buyer 'jack'}. Returns the dollars paid. */
  sellToJack(kind: ItemKind, position: THREE.Vector3): number {
    const amount = this.jackOffer(kind);
    if (amount <= 0) return 0;
    this.ctx.economy.add(amount);
    this.ctx.state.stats.jackEarned += amount;
    this.ctx.events.emit('sale', { buyer: 'jack', kind, count: 1, amount, position });
    return amount;
  }

  /** Price index of a material (1 = base). */
  index(kind: MaterialKind): number {
    return this.ctx.state.market.index[kind] ?? 1;
  }

  /** Recent unit values (oldest first) for a sparkline; at least two points. */
  history(kind: MaterialKind): readonly number[] {
    const v = this.unitValue(kind);
    return [v, v];
  }

  /** Materials tradable now: those of eras ≤ state.eras.age. */
  tradable(): MaterialKind[] {
    return (Object.keys(MATERIALS) as MaterialKind[]).filter((k) => MATERIALS[k].era <= this.ctx.state.eras.age);
  }

  /** Per-unit trading price including the spread ('buy' pays more, 'sell' gets less). */
  quote(kind: MaterialKind, side: 'buy' | 'sell'): number {
    return this.unitValue(kind) * (side === 'buy' ? 1.05 : 0.95);
  }

  /** Buy `units` virtual units (spends money). False if not tradable / unaffordable. */
  buy(_kind: MaterialKind, _units: number): boolean {
    return false;
  }

  /** Sell `units` held units (adds money, stats.tradeProfit). False if not enough held. */
  sell(_kind: MaterialKind, _units: number): boolean {
    return false;
  }

  /** Units held. */
  holding(kind: MaterialKind): number {
    return this.ctx.state.market.holdings[kind] ?? 0;
  }

  /** Buy `units` physical units delivered to era `era`'s import dock (spends money, emits 'market:order'). */
  order(_kind: MaterialKind, _units: number, _era: number): boolean {
    return false;
  }

  /** Products offered now (era-gated). */
  products(): InvestProductId[] {
    return (Object.keys(INVEST) as InvestProductId[]).filter((p) => INVEST[p].era <= this.ctx.state.eras.age);
  }

  /** Open a position (venture: `era` = the era it backs). False when refused (min, cap, money). */
  invest(_product: InvestProductId, _amount: number, _era = 0): boolean {
    return false;
  }

  /** Close a position: credits its payout (bond before maturity: principal only). Returns the dollars paid, 0 if none. */
  withdraw(_id: number): number {
    return 0;
  }

  positions(): readonly InvestmentState[] {
    return this.ctx.state.market.investments;
  }

  /** Money + holdings at sell quotes + positions' values. */
  netWorth(): number {
    return this.ctx.economy.money;
  }

  update(_dt: number): void {}
}
