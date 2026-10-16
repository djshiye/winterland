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
import { CLIMB } from '../config';
import { climbMult, demandOf, investMaxPositions, seasonMult } from './demand';
import { INVEST, isMaterial, MARKET, MATERIALS, SURVIVAL_VALUE, type InvestProductDef, type InvestProductId } from '../eras/data';
import type { GameContext, InvestmentState, ItemKind, MaterialKind, Updatable } from './types';

/** Most physical units one order may deliver to an import dock. */
export const ORDER_MAX_UNITS = 24;
/** A news shock happens on about one tick in this many: one material jumps by ±NEWS_JUMP. */
const NEWS_ODDS = 40;
const NEWS_JUMP = 0.25;
/** Seconds in an hour: index and venture rates are per hour (0.9.6). */
const HOUR = 3600;
/** The wobble's pull back toward its target per price tick (about a 7-minute half-life). */
const WOBBLE_REVERSION = 0.01;
/** How far a venture's wobble target leans per point of its era's average index above (or below) 1 (at most ±3%). */
const VENTURE_INDEX_PULL = 0.05;
/** The same lean for the index fund from the whole market's average index (at most ±1.5%). */
const FUND_INDEX_PULL = 0.025;
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
  /** $ per second of steady sales (Game wires the SalesMeter); unset (tests), only the net-worth share caps a product. */
  private salesRate: (() => number) | null = null;
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

  /** Where the investment caps read the recent sales rate from (core/Save.ts SalesMeter). */
  setSalesRate(rate: () => number): void {
    this.salesRate = rate;
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

  /** What an export depot pays for `count` units of `kind` now (× the material's sales upgrade × season bonus × Renown × Mastery). */
  exportPrice(kind: ItemKind, count: number): number {
    if (!isMaterial(kind)) return Math.round(this.unitValue(kind) * count);
    const s = this.ctx.state;
    return Math.round(this.unitValue(kind) * count * this.salesMult(kind) * seasonMult(s) * climbMult(s));
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

  /**
   * 0.9.5: what a region market buyer pays for `count` units of `kind` (eras/RegionMarket.ts; the money goes into the
   * market's cash pile, not straight to the bank). 0.9.6: the same as the depot, since the material's one sales upgrade
   * (Trade and Fine merged, `${kind}Quality`) now counts at every counter.
   */
  marketPrice(kind: ItemKind, count: number): number {
    return Math.max(1, this.exportPrice(kind, count));
  }

  /** 0.9.5: a region market sale was paid: the export stat and supply pressure, like the depot. */
  noteMarketSale(kind: ItemKind, count: number): void {
    this.ctx.state.stats.materialsSold += count;
    if (isMaterial(kind)) this.addPressure(kind, count);
  }

  /**
   * Jack's offer for one `kind` right now (UPGRADES.jack share × unitValue, at least $1 for anything but cash). No Trade,
   * Renown or Mastery, and the share stops at 0.9 (core/ladder.ts): an order costs at least 1.1 × unitValue, so ordering
   * goods in and handing them to Jack can never print money.
   */
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

  /**
   * The material's sales upgrade multiplier (1 for Survival goods). 0.9.6 (decision 9): the era Trade upgrade and the
   * material's Fine upgrade are one upgrade per material, `${kind}Quality`, paid wherever it is sold (depot, dock, stall),
   * so an era that sells an older era's goods still gets that material's own bonus.
   */
  salesMult(kind: ItemKind): number {
    if (!isMaterial(kind)) return 1;
    return Math.max(1, this.ctx.upgrades.value(`${kind}Quality`));
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

  /**
   * Per-unit trading price including the spread ('buy' pays more, 'sell' gets less). Supply pressure only lowers what
   * sellers get, never what buyers pay, so crashing a price yourself and buying back cheap cannot print money.
   */
  quote(kind: MaterialKind, side: 'buy' | 'sell'): number {
    const p = side === 'buy' ? MATERIALS[kind].value * this.index(kind) : this.unitValue(kind);
    return p * (1 + (side === 'buy' ? 1 : -1) * this.spread());
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
    this.ctx.economy.add(proceeds, Math.max(0, profit)); // the returned cost basis is not money earned
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
   * surcharge. It also carries the material's sales upgrade, the season bonus, Renown and Mastery (every multiplier
   * exportPrice and marketPrice have), so carrying an order straight to an export depot or a region market counter can
   * never print money (it always loses the spread and the surcharge), however far the climb goes. (0.9.5 left the
   * Quality bonus out: an order sold at a counter paid back up to ×2.06.)
   */
  orderCost(kind: MaterialKind, units: number): number {
    const n = Math.max(1, Math.min(ORDER_MAX_UNITS, Math.floor(units)));
    const s = this.ctx.state;
    return Math.max(1, Math.round(this.quote(kind, 'buy') * n * (1 + MARKET.delivery) * this.salesMult(kind) * seasonMult(s) * climbMult(s)));
  }

  /** Buy `units` physical units delivered to era `era`'s import dock (spends money, emits 'market:order'). */
  order(kind: MaterialKind, units: number, era: number): boolean {
    units = Math.min(ORDER_MAX_UNITS, Math.floor(units));
    const { state } = this.ctx;
    if (units < 1 || !this.isTradable(kind)) return false;
    if (!Number.isInteger(era) || era < 2 || era > state.eras.age || !state.eras.regions[era]?.unlocked) return false;
    const cost = this.orderCost(kind, units);
    if (!this.ctx.economy.spend(cost)) return false;
    this.ctx.events.emit('market:order', { kind, count: units, era, amount: cost });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Investments
  // ---------------------------------------------------------------------------

  /** Products offered now (era-gated). */
  products(): InvestProductId[] {
    return (Object.keys(INVEST) as InvestProductId[]).filter((p) => INVEST[p].era <= this.ctx.state.eras.age);
  }

  /**
   * Dollars a bond pays at maturity per dollar of principal (the Broker raises the rate). Broker levels past its
   * table only tighten the spread: bonds stop at the authored top, exactly as in 0.9 (docs/EXPANSION.md §A1).
   */
  bondPayout(): number {
    return 1 + INVEST.bond.rate * Math.sqrt(Math.min(this.ctx.upgrades.value('broker'), CLIMB.bondBrokerMax));
  }

  /** Principal in one product right now. */
  totalIn(product: InvestProductId): number {
    let t = 0;
    for (const p of this.ctx.state.market.investments) if (p.product === product) t += p.principal;
    return t;
  }

  /**
   * Most principal a product may hold: its share of net worth, and (0.9.6) no more than `capMinutes` of recent sales,
   * so with the factories idle nothing new goes in and bonds can't be rolled into a money machine.
   */
  capOf(product: InvestProductId): number {
    const def = INVEST[product];
    const byWorth = def.cap * this.netWorth();
    if (!this.salesRate) return byWorth;
    const rate = this.salesRate();
    return Math.min(byWorth, def.capMinutes * 60 * (Number.isFinite(rate) && rate > 0 ? rate : 0));
  }

  /** True when the sales-rate cap (not the net-worth share) is the one holding a product back. */
  cappedBySales(product: InvestProductId): boolean {
    return this.capOf(product) < INVEST[product].cap * this.netWorth();
  }

  /** Most that can still go into a product (its cap minus the principal already there). */
  room(product: InvestProductId): number {
    return Math.max(0, Math.floor(this.capOf(product) - this.totalIn(product)));
  }

  /** Principal in bonds right now. */
  bondTotal(): number {
    return this.totalIn('bond');
  }

  /** Most that can still go into bonds (BOND_CAP_SHARE of net worth minus what is already there). */
  bondRoom(): number {
    return this.room('bond');
  }

  /** Open a position (venture: `era` = the era it backs, 0 = the newest). False when refused (min, cap, money). */
  invest(product: InvestProductId, amount: number, era = 0): boolean {
    const def = INVEST[product];
    const { state, economy } = this.ctx;
    amount = Math.floor(amount);
    if (!def || def.era > state.eras.age || amount < def.min || amount > economy.money) return false;
    if (state.market.investments.length >= investMaxPositions(state)) return false;
    let backed = 0;
    if (product === 'venture') {
      backed = era === 0 ? state.eras.age : era;
      if (!Number.isInteger(backed) || backed < def.era || backed > state.eras.age) return false;
    }
    if (amount > this.room(product)) return false;
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
    this.ctx.economy.add(pay, Math.max(0, gain)); // the returned principal is not money earned
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
      // index / venture: the value follows the trend as time passes (the wobble moves on price ticks, tickInvestments)
      if (p.product === 'index' || p.product === 'venture') {
        const t0 = this.trend(p, p.age);
        const w = t0 > 0 ? p.value / t0 : 1;
        if (inBand(w, INVEST[p.product])) p.value = this.trend(p, p.age + dt) * w;
      }
      p.age += dt;
      if (p.product === 'bond' && p.value <= p.principal && this.matured(p)) {
        p.value = p.principal * this.bondPayout();
        changed = true;
      }
    }
    if (changed) this.ctx.events.emit('invest:changed', {});
  }

  /** An index / venture position's trend value at `age` seconds: principal × (1 + rate)^hours, at most × top. */
  private trend(p: InvestmentState, age: number): number {
    const def = INVEST[p.product];
    return p.principal * Math.min(def.top ?? 1, (1 + def.rate) ** (age / HOUR));
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

  /**
   * One tick of the index fund and the ventures (0.9.6). A position is worth principal × trend × wobble: the trend grows
   * at the product's rate per HOUR up to its `top` (×2 fund, ×3 ventures), and the wobble is a mean-reverting walk around
   * 1 (leaning a little with the market), held inside [1 − dip, 1 + rise]. So a position never beats top × (1 + rise),
   * however long it is left.
   * Every new position starts at wobble 1, so timing a buy gains nothing. index positions share one noise draw per tick
   * (they track one market), each venture draws its own. A position from an older save whose value already sits outside
   * the band (0.9.5 compounded per minute) keeps its value and stops growing.
   */
  private tickInvestments(): void {
    const m = this.ctx.state.market;
    const idx = INVEST.index;
    if (this.ctx.state.eras.age < idx.era) return;
    const kinds = this.tradable();
    let avg = 1;
    if (kinds.length > 0) {
      avg = 0;
      for (const k of kinds) avg += this.index(k);
      avg /= kinds.length;
    }
    const fundTarget = 1 + clamp((avg - 1) * FUND_INDEX_PULL, -0.015, 0.015);
    const g = this.gauss();
    // the fund's own wobble walks whether or not anyone holds it (the shared market mood; saved as market.fund)
    m.fund = wobble(m.fund, fundTarget, idx, g);
    for (const p of m.investments) {
      if (p.product !== 'index' && p.product !== 'venture') continue;
      const def = INVEST[p.product];
      const trend = this.trend(p, p.age);
      const w = trend > 0 ? p.value / trend : 1;
      if (!inBand(w, def)) continue;
      const target = p.product === 'index' ? fundTarget : 1 + clamp((this.eraIndex(p.era) - 1) * VENTURE_INDEX_PULL, -0.03, 0.03);
      p.value = trend * wobble(w, target, def, p.product === 'index' ? g : this.gauss());
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

/** A wobble inside [1 − dip, 1 + rise] (outside: a position from an older save, which keeps its value as it is). */
function inBand(w: number, def: InvestProductDef): boolean {
  return w <= 1 + (def.rise ?? 0) + 1e-9 && w >= 1 - (def.dip ?? 0) - 1e-9;
}

/** One step of a mean-reverting wobble toward `target`, kept inside [1 − dip, 1 + rise]. */
function wobble(w: number, target: number, def: InvestProductDef, g: number): number {
  return clamp(w + (target - w) * WOBBLE_REVERSION + def.volatility * g, 1 - (def.dip ?? 0), 1 + (def.rise ?? 0));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
