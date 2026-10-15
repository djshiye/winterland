/**
 * 0.9.0 market: material prices (random walk + mean reversion + supply pressure), export sales, Jack's swap cart
 * payouts, trading of virtual holdings, physical orders to a region's import dock, investments (bond / index fund /
 * era ventures), net worth.
 *
 * Determinism rule: Survival goods (every non-material ItemKind) never fluctuate: unitValue = SURVIVAL_VALUE × the
 * village demand price multiplier. Material indices only move for eras already reached (state.eras.age).
 *
 * Everything random happens on price ticks (MARKET.tick seconds); the per-frame work is the pressure decay and the
 * (at most twelve) positions' ages. The random source is injectable so tests are deterministic.
 */
import type * as THREE from 'three';
import { demandOf, seasonMult } from './demand';
import { BOND_CAP_SHARE, ERAS, INVEST, INVEST_MAX_POSITIONS, isMaterial, MARKET, MATERIALS, SURVIVAL_VALUE, type InvestProductId } from '../eras/data';
import type { GameContext, InvestmentState, ItemKind, MaterialKind, Updatable } from './types';

/** Most physical units one order may deliver to an import dock. */
export const ORDER_MAX_UNITS = 24;
/** A news shock happens on about one tick in this many: one material jumps by ±NEWS_JUMP. */
const NEWS_ODDS = 40;
const NEWS_JUMP = 0.25;
/** Venture drift per tick per point of the era's average index above (or below) 1. */
const VENTURE_INDEX_PULL = 0.004;
/** Index fund drift per tick per point of the whole market's average index above (or below) 1. */
const FUND_INDEX_PULL = 0.01;
/** Most price ticks one update() may run (a long frame never freezes the game). */
const MAX_TICKS_PER_UPDATE = 20;
/** Selling held units presses the price this share of what a physical export would. */
const TRADE_PRESSURE_SHARE = 0.5;

export interface MarketOptions {
  /** Random source in [0, 1) (default Math.random). */
  rng?: () => number;
}

export class Market implements Updatable {
  private rng: () => number;
  /** Seconds since the last price tick. */
  private acc = 0;
  /** Recent unit values per material, oldest first (not saved). */
  private readonly ring = new Map<MaterialKind, number[]>();

  constructor(
    private readonly ctx: GameContext,
    opts: MarketOptions = {},
  ) {
    this.rng = opts.rng ?? Math.random;
  }

  /** Swap the random source (tests). */
  setRng(rng: () => number): void {
    this.rng = rng;
  }

  // ---------------------------------------------------------------------------
  // Prices and sales
  // ---------------------------------------------------------------------------

  /** Value of one unit right now before sales upgrades: materials base × index × (1 − pressure); Survival goods fixed. */
  unitValue(kind: ItemKind): number {
    if (!isMaterial(kind)) return SURVIVAL_VALUE[kind] * demandOf(this.ctx.state).priceMult;
    return MATERIALS[kind].value * this.index(kind) * (1 - (this.ctx.state.market.pressure[kind] ?? 0));
  }

  /** What an export depot pays for `count` units of `kind` now (× the era's Trade upgrade × season bonus). */
  exportPrice(kind: ItemKind, count: number): number {
    if (!isMaterial(kind)) return Math.round(this.unitValue(kind) * count);
    return Math.round(this.unitValue(kind) * count * this.tradeMult(kind) * seasonMult(this.ctx.state));
  }

  /** An export depot received `count` units: credit the money, apply supply pressure, stats, 'sale' {buyer 'export'}. */
  sellExport(kind: ItemKind, count: number, position: THREE.Vector3): number {
    const amount = this.exportPrice(kind, count);
    this.ctx.economy.add(amount);
    this.ctx.state.stats.materialsSold += count;
    if (isMaterial(kind)) this.addPressure(kind, count);
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

  /** Supply pressure of a material (0 = none, up to MARKET.pressureMax). */
  pressure(kind: MaterialKind): number {
    return this.ctx.state.market.pressure[kind] ?? 0;
  }

  /** The era's Trade upgrade multiplier for `kind` (1 for Survival goods). */
  tradeMult(kind: ItemKind): number {
    if (!isMaterial(kind)) return 1;
    return this.ctx.upgrades.value(`${ERAS[MATERIALS[kind].era]!.key}Trade`);
  }

  /** Recent unit values (oldest first) for a sparkline; at least two points. */
  history(kind: MaterialKind): readonly number[] {
    return this.ringOf(kind);
  }

  /** Percent change of a material's unit value over roughly the last `ticks` price ticks (default ≈ one minute). */
  change(kind: MaterialKind, ticks = Math.round(60 / MARKET.tick)): number {
    const r = this.ringOf(kind);
    const past = r[Math.max(0, r.length - 1 - ticks)]!;
    return past > 0 ? this.unitValue(kind) / past - 1 : 0;
  }

  /** Materials tradable now: those of eras ≤ state.eras.age. */
  tradable(): MaterialKind[] {
    return (Object.keys(MATERIALS) as MaterialKind[]).filter((k) => MATERIALS[k].era <= this.ctx.state.eras.age);
  }

  /** Add supply pressure for `units` sold (raw goods count half), capped at MARKET.pressureMax. */
  private addPressure(kind: MaterialKind, units: number, share = 1): void {
    const per = MARKET.pressurePerUnit * (MATERIALS[kind].grade === 'raw' ? 0.5 : 1) * share;
    const p = this.ctx.state.market.pressure;
    p[kind] = Math.min(MARKET.pressureMax, (p[kind] ?? 0) + per * units);
  }

  // ---------------------------------------------------------------------------
  // Trading of virtual holdings
  // ---------------------------------------------------------------------------

  /** The spread (share above / below the price): MARKET.spread ÷ the Broker upgrade. */
  spread(): number {
    return MARKET.spread / Math.max(1, this.ctx.upgrades.value('broker'));
  }

  /** Per-unit trading price including the spread ('buy' pays more, 'sell' gets less). */
  quote(kind: MaterialKind, side: 'buy' | 'sell'): number {
    return this.unitValue(kind) * (1 + (side === 'buy' ? 1 : -1) * this.spread());
  }

  /** Dollars `units` virtual units cost right now. */
  buyCost(kind: MaterialKind, units: number): number {
    return Math.max(1, Math.round(this.quote(kind, 'buy') * units));
  }

  /** Dollars selling `units` held units pays right now. */
  sellProceeds(kind: MaterialKind, units: number): number {
    return Math.round(this.quote(kind, 'sell') * units);
  }

  /** Buy `units` virtual units (spends money). False if not tradable / unaffordable. */
  buy(kind: MaterialKind, units: number): boolean {
    units = Math.floor(units);
    if (units < 1 || !this.isTradable(kind)) return false;
    const cost = this.buyCost(kind, units);
    if (!this.ctx.economy.spend(cost)) return false;
    const m = this.ctx.state.market;
    const held = m.holdings[kind] ?? 0;
    m.basis[kind] = ((m.basis[kind] ?? 0) * held + cost) / (held + units);
    m.holdings[kind] = held + units;
    this.ctx.events.emit('market:trade', { kind, units, side: 'buy', amount: cost, profit: 0 });
    return true;
  }

  /** Sell `units` held units (adds money, stats.tradeProfit). False if not enough held. */
  sell(kind: MaterialKind, units: number): boolean {
    units = Math.floor(units);
    const m = this.ctx.state.market;
    const held = m.holdings[kind] ?? 0;
    if (units < 1 || units > held) return false;
    const proceeds = this.sellProceeds(kind, units);
    const profit = proceeds - (m.basis[kind] ?? 0) * units;
    if (held - units <= 0) {
      delete m.holdings[kind];
      delete m.basis[kind];
    } else {
      m.holdings[kind] = held - units;
    }
    this.addPressure(kind, units, TRADE_PRESSURE_SHARE);
    this.ctx.economy.add(proceeds);
    if (profit > 0) this.ctx.state.stats.tradeProfit += profit;
    this.ctx.events.emit('market:trade', { kind, units, side: 'sell', amount: proceeds, profit });
    if (profit > 0) this.ctx.events.emit('income', { source: 'trade', amount: profit, position: null });
    return true;
  }

  /** Units held. */
  holding(kind: MaterialKind): number {
    return this.ctx.state.market.holdings[kind] ?? 0;
  }

  /** Average buy price per held unit (0 when none held). */
  basis(kind: MaterialKind): number {
    return this.ctx.state.market.basis[kind] ?? 0;
  }

  /** Unrealised profit / loss of the units held (at the sell quote). */
  unrealised(kind: MaterialKind): number {
    const n = this.holding(kind);
    return n > 0 ? this.sellProceeds(kind, n) - this.basis(kind) * n : 0;
  }

  private isTradable(kind: MaterialKind): boolean {
    return MATERIALS[kind] !== undefined && MATERIALS[kind].era <= this.ctx.state.eras.age;
  }

  // ---------------------------------------------------------------------------
  // Physical orders
  // ---------------------------------------------------------------------------

  /**
   * Dollars an order of `units` (clamped to ORDER_MAX_UNITS) delivered to a dock costs: the buy quote plus the delivery
   * surcharge. It also carries the era's Trade upgrade and the season bonus, so carrying an order straight to an
   * export depot can never print money (it always loses the spread and the surcharge).
   */
  orderCost(kind: MaterialKind, units: number): number {
    const n = Math.max(1, Math.min(ORDER_MAX_UNITS, Math.floor(units)));
    return Math.max(1, Math.round(this.quote(kind, 'buy') * n * (1 + MARKET.delivery) * this.tradeMult(kind) * seasonMult(this.ctx.state)));
  }

  /** Buy `units` physical units delivered to era `era`'s import dock (spends money, emits 'market:order'). */
  order(kind: MaterialKind, units: number, era: number): boolean {
    units = Math.min(ORDER_MAX_UNITS, Math.floor(units));
    const { state } = this.ctx;
    if (units < 1 || !this.isTradable(kind)) return false;
    if (!Number.isInteger(era) || era < 2 || era > state.eras.age || !state.eras.regions[era]?.unlocked) return false;
    if (!this.ctx.economy.spend(this.orderCost(kind, units))) return false;
    this.ctx.events.emit('market:order', { kind, count: units, era });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Investments
  // ---------------------------------------------------------------------------

  /** Products offered now (era-gated). */
  products(): InvestProductId[] {
    return (Object.keys(INVEST) as InvestProductId[]).filter((p) => INVEST[p].era <= this.ctx.state.eras.age);
  }

  /** Dollars a bond pays at maturity per dollar of principal (the Broker raises the rate). */
  bondPayout(): number {
    return 1 + INVEST.bond.rate * Math.sqrt(this.ctx.upgrades.value('broker'));
  }

  /** Principal in bonds right now. */
  bondTotal(): number {
    let t = 0;
    for (const p of this.ctx.state.market.investments) if (p.product === 'bond') t += p.principal;
    return t;
  }

  /** Most that can still go into bonds (BOND_CAP_SHARE of net worth minus what is already there). */
  bondRoom(): number {
    return Math.max(0, Math.floor(BOND_CAP_SHARE * this.netWorth() - this.bondTotal()));
  }

  /** Open a position (venture: `era` = the era it backs, 0 = the newest). False when refused (min, cap, money). */
  invest(product: InvestProductId, amount: number, era = 0): boolean {
    const def = INVEST[product];
    const { state, economy } = this.ctx;
    amount = Math.floor(amount);
    if (!def || def.era > state.eras.age || amount < def.min || amount > economy.money) return false;
    if (state.market.investments.length >= INVEST_MAX_POSITIONS) return false;
    let backed = 0;
    if (product === 'venture') {
      backed = era === 0 ? state.eras.age : era;
      if (!Number.isInteger(backed) || backed < 2 || backed > state.eras.age) return false;
    }
    if (product === 'bond' && amount > this.bondRoom()) return false;
    if (!economy.spend(amount)) return false;
    const m = state.market;
    m.investments.push({ id: m.nextId++, product, era: backed, principal: amount, value: amount, age: 0 });
    this.ctx.events.emit('invest:changed', {});
    return true;
  }

  /** Close a position: credits its payout (bond before maturity: principal only). Returns the dollars paid, 0 if none. */
  withdraw(id: number): number {
    const m = this.ctx.state.market;
    const i = m.investments.findIndex((p) => p.id === id);
    if (i < 0) return 0;
    const pos = m.investments[i]!;
    m.investments.splice(i, 1);
    const pay = Math.round(pos.product === 'bond' && !this.matured(pos) ? pos.principal : pos.value);
    const gain = pay - pos.principal;
    this.ctx.economy.add(pay);
    if (gain > 0) this.ctx.state.stats.investEarned += gain;
    this.ctx.events.emit('invest:changed', {});
    if (gain > 0) this.ctx.events.emit('income', { source: 'interest', amount: gain, position: null });
    return pay;
  }

  /** True for a bond that has served its lock. */
  matured(pos: InvestmentState): boolean {
    return pos.product === 'bond' && pos.age >= (INVEST.bond.lock ?? 0);
  }

  /** Seconds until a bond matures (0 for the other products or a matured bond). */
  maturesIn(pos: InvestmentState): number {
    return pos.product === 'bond' ? Math.max(0, (INVEST.bond.lock ?? 0) - pos.age) : 0;
  }

  positions(): readonly InvestmentState[] {
    return this.ctx.state.market.investments;
  }

  /** Money + holdings at sell quotes + positions' values. */
  netWorth(): number {
    const m = this.ctx.state.market;
    let total = this.ctx.economy.money;
    for (const k in m.holdings) {
      const kind = k as MaterialKind;
      total += (m.holdings[kind] ?? 0) * this.quote(kind, 'sell');
    }
    for (const p of m.investments) total += p.value;
    return total;
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    if (dt <= 0) return;
    const m = this.ctx.state.market;
    // supply pressure decays smoothly
    const drop = MARKET.pressureDecay * dt;
    for (const k in m.pressure) {
      const kind = k as MaterialKind;
      const v = (m.pressure[kind] ?? 0) - drop;
      if (v <= 1e-5) delete m.pressure[kind];
      else m.pressure[kind] = v;
    }
    this.ageBonds(dt);
    this.acc += dt;
    let n = 0;
    while (this.acc >= MARKET.tick && n < MAX_TICKS_PER_UPDATE) {
      this.acc -= MARKET.tick;
      n++;
      this.tickPrices();
      this.tickInvestments();
    }
    if (this.acc >= MARKET.tick) this.acc = 0;
  }

  /** Positions get older; a bond that reaches its lock pays out its rate (and tells the panel). */
  private ageBonds(dt: number): void {
    let changed = false;
    for (const p of this.ctx.state.market.investments) {
      p.age += dt;
      if (p.product === 'bond' && p.value <= p.principal && this.matured(p)) {
        p.value = p.principal * this.bondPayout();
        changed = true;
      }
    }
    if (changed) this.ctx.events.emit('invest:changed', {});
  }

  /** Roughly normal noise (sum of three uniforms), mean 0, standard deviation 1, |x| ≤ 3. */
  private gauss(): number {
    return (this.rng() + this.rng() + this.rng() - 1.5) * 2;
  }

  /** One price tick: every reached material's index steps; sparklines get a new point. */
  private tickPrices(): void {
    const { index } = this.ctx.state.market;
    const kinds = this.tradable();
    for (const kind of kinds) {
      const i = index[kind] ?? 1;
      const next = i + i * MARKET.volatility * this.gauss() + (1 - i) * MARKET.reversion;
      index[kind] = clamp(next, MARKET.min, MARKET.max);
    }
    if (kinds.length > 0 && this.rng() < 1 / NEWS_ODDS) {
      const kind = kinds[Math.min(kinds.length - 1, Math.floor(this.rng() * kinds.length))]!;
      const jump = this.rng() < 0.5 ? 1 + NEWS_JUMP : 1 - NEWS_JUMP;
      index[kind] = clamp((index[kind] ?? 1) * jump, MARKET.min, MARKET.max);
    }
    for (const kind of kinds) {
      const r = this.ringOf(kind);
      r.push(this.unitValue(kind));
      if (r.length > MARKET.history) r.shift();
    }
  }

  /** Mean index of an era's materials (1 when it has none or the era is not reached). */
  private eraIndex(era: number): number {
    let sum = 0;
    let n = 0;
    for (const k of Object.keys(MATERIALS) as MaterialKind[]) {
      if (MATERIALS[k].era !== era) continue;
      sum += this.index(k);
      n++;
    }
    return n > 0 ? sum / n : 1;
  }

  /** One tick of the index fund and the ventures. */
  private tickInvestments(): void {
    const m = this.ctx.state.market;
    const perTick = MARKET.tick / 60;
    const idx = INVEST.index;
    const ven = INVEST.venture;
    if (this.ctx.state.eras.age < idx.era) return;
    // the fund walks whether or not anyone holds it, so a new position buys in at a live level
    const kinds = this.tradable();
    let avg = 1;
    if (kinds.length > 0) {
      avg = 0;
      for (const k of kinds) avg += this.index(k);
      avg /= kinds.length;
    }
    const before = m.fund;
    const step = idx.rate * perTick + idx.volatility * this.gauss() + (avg - 1) * FUND_INDEX_PULL;
    m.fund = Math.max(0.2, m.fund * (1 + step));
    const ratio = before > 0 ? m.fund / before : 1;
    for (const p of m.investments) {
      if (p.product === 'index') {
        p.value *= ratio;
      } else if (p.product === 'venture') {
        const s = ven.rate * perTick + ven.volatility * this.gauss() + (this.eraIndex(p.era) - 1) * VENTURE_INDEX_PULL;
        p.value = Math.max(0, p.value * (1 + s));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // History (sparklines)
  // ---------------------------------------------------------------------------

  private ringOf(kind: MaterialKind): number[] {
    let r = this.ring.get(kind);
    if (!r) {
      r = this.seed(kind);
      this.ring.set(kind, r);
    }
    return r;
  }

  /** A short plausible history ending at the current value (a random walk run backwards), so lines are not flat. */
  private seed(kind: MaterialKind): number[] {
    const now = this.unitValue(kind);
    const base = MATERIALS[kind].value;
    const out: number[] = new Array<number>(MARKET.history);
    let v = now;
    for (let i = MARKET.history - 1; i >= 0; i--) {
      out[i] = v;
      v = clamp(v * (1 + MARKET.volatility * this.gauss() * 0.7) + (base - v) * MARKET.reversion, base * MARKET.min, base * MARKET.max);
    }
    return out;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
