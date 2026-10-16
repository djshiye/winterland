/**
 * 0.9.0 Market panel: Prices (sparklines, sell pressure), Trade (buy / sell virtual holdings, order deliveries to a
 * region's import dock), Invest (bonds, index fund, era ventures), net worth. Opened by 'market:open' (HUD button),
 * closed by 'market:close' / the X button / Esc (the HUD calls close()). Bottom sheet on phones, side card on wide
 * screens (the shop's chrome, see hud.css .wl-shop*; the market's own bits live in market.css).
 *
 * Rows are built once (one per material, one card per product); refresh() rewrites only what changed, and runs when
 * something marked the panel dirty (at most ~5 times a second) or every second while open, because prices tick.
 */
import { ERAS, ERA_NAMES, INVEST, MACHINES, MATERIALS, SURVIVAL_VALUE, type InvestProductId } from '../eras/data';
import { ORDER_MAX_UNITS } from '../core/Market';
import { investMaxPositions } from '../core/demand';
import type { GameContext, InvestmentState, ItemKind, MaterialKind } from '../core/types';
import { backOut, cubicOut, h, onTap, shield, Slide } from './dom';
import { formatDuration, formatMoney } from './format';
import { ICON_CLOSE } from './icons';
import { materialIcon, materialLabel } from './materialIcons';
import './market.css';

type Tab = 'prices' | 'trade' | 'invest';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'prices', label: 'Prices' },
  { id: 'trade', label: 'Trade' },
  { id: 'invest', label: 'Invest' },
];

/** Smallest gap between two refreshes while the panel is dirty, and the idle refresh period (seconds). */
const REFRESH_GAP = 0.2;
const REFRESH_IDLE = 1;
/** A material counts as "flooded" in the Prices tab from this supply pressure on. */
const FLOOD_HINT = 0.03;

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const sign = (v: number): string => (v > 0 ? '+' : v < 0 ? '−' : '');
const pct = (v: number): string => `${sign(Math.round(v * 1000))}${Math.abs(v * 100).toFixed(1)}%`;
const signed = (v: number): string => `${sign(Math.round(v))}${formatMoney(Math.abs(v))}`;
const cls = (v: number): string => (v > 0.0005 ? 'is-up' : v < -0.0005 ? 'is-down' : 'is-flat');

/** Rounds an amount down to three significant digits (so 10 % of $12,345 reads "$12,300"). */
function nice(v: number): number {
  if (v < 1000) return Math.floor(v);
  const mag = 10 ** (Math.floor(Math.log10(v)) - 2);
  return Math.floor(v / mag) * mag;
}

/** Last html written to an element, so a refresh only touches the DOM when the text changed. */
const written = new WeakMap<Element, string>();
function put(el: Element, html: string): void {
  if (written.get(el) === html) return;
  written.set(el, html);
  el.innerHTML = html;
}
function setCls(el: Element, name: string): void {
  if (el.className !== name) el.className = name;
}


interface PriceRow {
  kind: MaterialKind;
  root: HTMLDivElement;
  price: HTMLDivElement;
  change: HTMLDivElement;
  hint: HTMLDivElement;
  line: SVGPolylineElement;
  spark: SVGSVGElement;
  shownSpark: string;
}

interface TradeCard {
  kind: MaterialKind;
  root: HTMLDivElement;
  quote: HTMLDivElement;
  held: HTMLDivElement;
  buys: Array<{ units: number; el: HTMLButtonElement }>;
  sells: Array<{ units: number; el: HTMLButtonElement }>;
  dest: HTMLSelectElement;
  orders: Array<{ units: number; el: HTMLButtonElement }>;
  /** Region era the player picked (0 = follow the default). */
  picked: number;
  shownAge: number;
}

type AmountPick = 'min' | 10 | 25 | 50;

interface ProductCard {
  id: InvestProductId;
  root: HTMLDivElement;
  chips: Array<{ pick: AmountPick; el: HTMLButtonElement }>;
  era: HTMLSelectElement | null;
  btn: HTMLButtonElement;
  hint: HTMLDivElement;
  pick: AmountPick;
  picked: number;
  shownAge: number;
}

interface PositionRow {
  id: number;
  root: HTMLDivElement;
  name: HTMLDivElement;
  value: HTMLDivElement;
  gain: HTMLDivElement;
  status: HTMLDivElement;
  btn: HTMLButtonElement;
}

export class MarketPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly worth: HTMLDivElement;
  private readonly tabEls = new Map<Tab, HTMLButtonElement>();
  private readonly sections = new Map<Tab, HTMLDivElement>();
  private readonly priceRows: PriceRow[] = [];
  private readonly tradeCards: TradeCard[] = [];
  private readonly products: ProductCard[] = [];
  private readonly positionRows = new Map<number, PositionRow>();
  private readonly positionList: HTMLDivElement;
  private readonly positionTitle: HTMLDivElement;
  private readonly positionEmpty: HTMLDivElement;
  private readonly survival: HTMLDivElement;
  private readonly survivalRows: Array<{ kind: ItemKind; el: HTMLSpanElement }> = [];
  private readonly slide = new Slide();
  private tab: Tab = 'prices';
  private wanted = false;
  private dismissed = false;
  private dirty = true;
  /** Seconds since the last refresh (Infinity: refresh at the next update). */
  private since = Infinity;

  constructor(
    protected readonly ctx: GameContext,
    protected readonly layer: HTMLElement,
  ) {
    this.root = h('div', 'wl-shop wl-market');
    shield(this.root);
    this.root.style.display = 'none';

    const head = h('div', 'wl-shop-head');
    head.appendChild(h('div', 'wl-shop-title wl-outline', 'Market'));
    const tabs = h('div', 'wl-shop-tabs');
    for (const t of TABS) {
      const b = h('button', 'wl-shop-tab', `<span>${t.label}</span>`);
      b.type = 'button';
      onTap(b, () => {
        ctx.audio.unlock();
        ctx.audio.play('click');
        this.setTab(t.id);
      });
      tabs.appendChild(b);
      this.tabEls.set(t.id, b);
    }
    head.appendChild(tabs);
    const close = h('button', 'wl-shop-close', ICON_CLOSE);
    close.type = 'button';
    close.setAttribute('aria-label', 'Close market');
    onTap(close, () => {
      ctx.audio.play('click');
      this.close();
    });
    head.appendChild(close);
    this.root.appendChild(head);

    this.worth = h('div', 'wl-mk-worth');
    this.root.appendChild(this.worth);

    this.list = h('div', 'wl-shop-list wl-mk-list');
    this.root.appendChild(this.list);
    layer.appendChild(this.root);

    const kinds = Object.keys(MATERIALS) as MaterialKind[];
    // --- Prices
    const prices = h('div', 'wl-mk-section');
    for (const kind of kinds) this.priceRows.push(this.makePriceRow(kind, prices));
    this.survival = h('div', 'wl-mk-survival');
    this.buildSurvival(prices);
    this.sections.set('prices', prices);
    // --- Trade
    const trade = h('div', 'wl-mk-section');
    trade.appendChild(h('div', 'wl-mk-note', `Buy and sell holdings at the spread. Deliveries (up to ${ORDER_MAX_UNITS} units) arrive on a region's import dock.`));
    for (const kind of kinds) this.tradeCards.push(this.makeTradeCard(kind, trade));
    this.sections.set('trade', trade);
    // --- Invest
    const invest = h('div', 'wl-mk-section');
    for (const id of ['bond', 'index', 'venture'] as InvestProductId[]) this.products.push(this.makeProduct(id, invest));
    this.positionTitle = h('div', 'wl-mk-subtitle');
    invest.appendChild(this.positionTitle);
    this.positionList = h('div', 'wl-mk-positions');
    invest.appendChild(this.positionList);
    this.positionEmpty = h('div', 'wl-mk-note', 'No positions yet. Deposit something above.');
    invest.appendChild(this.positionEmpty);
    this.sections.set('invest', invest);
    for (const s of this.sections.values()) this.list.appendChild(s);
    this.setTab('prices');

    const ev = ctx.events;
    ev.on('market:open', () => {
      this.wanted = true;
      this.dismissed = false;
      this.mark();
      this.since = Infinity;
      this.syncOpen();
    });
    ev.on('market:close', () => {
      this.wanted = false;
      this.dismissed = false;
      this.syncOpen();
    });
    for (const e of ['money:changed', 'market:trade', 'market:order', 'invest:changed', 'era:unlocked'] as const) ev.on(e, () => this.mark());
  }

  /** True while the panel is (or is animating to be) on screen. */
  get visible(): boolean {
    return this.slide.open;
  }

  /** Dismiss the panel like its X button (it stays shut until the next 'market:open'). */
  close(): void {
    this.dismissed = true;
    this.syncOpen();
  }

  /** Debug / tests: show or hide without the HUD button. */
  force(open: boolean): void {
    this.wanted = open;
    this.dismissed = false;
    this.since = Infinity;
    this.mark();
    this.syncOpen();
  }

  /** For tests. */
  get currentTab(): string {
    return this.tab;
  }

  /** Switch tab (the HUD / tests may call it). */
  setTab(tab: Tab): void {
    this.tab = tab;
    for (const [id, el] of this.tabEls) el.classList.toggle('is-on', id === tab);
    for (const [id, el] of this.sections) el.style.display = id === tab ? '' : 'none';
    this.list.scrollTop = 0;
    this.since = Infinity;
    this.mark();
  }

  private mark(): void {
    this.dirty = true;
  }

  private syncOpen(): void {
    this.slide.open = this.wanted && !this.dismissed;
  }

  private tap(fn: () => boolean, sound: 'click' | 'sell' | 'upgrade' = 'click'): void {
    const { audio } = this.ctx;
    audio.unlock();
    if (fn()) audio.play(sound);
    else audio.play('full', { volume: 0.5 });
    this.mark();
  }

  // ---------------------------------------------------------------------------
  // Builders
  // ---------------------------------------------------------------------------

  private eraTag(era: number): string {
    const d = ERAS[era];
    const c = d ? hex(d.colors.accent) : '#8a98b4';
    return `<span class="wl-mk-era" style="--c:${c}">${ERA_NAMES[era] ?? ''}</span>`;
  }

  private makePriceRow(kind: MaterialKind, parent: HTMLElement): PriceRow {
    const m = MATERIALS[kind];
    const root = h('div', 'wl-shop-card wl-mk-row');
    root.appendChild(h('div', 'wl-mk-ico', materialIcon(kind)));
    const mid = h('div', 'wl-shop-mid');
    mid.appendChild(h('div', 'wl-shop-name', `${materialLabel(kind)} ${this.eraTag(m.era)}`));
    const hint = h('div', 'wl-mk-flood');
    mid.appendChild(hint);
    root.appendChild(mid);
    const spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    spark.setAttribute('viewBox', '0 0 60 24');
    spark.setAttribute('class', 'wl-mk-spark');
    spark.setAttribute('preserveAspectRatio', 'none');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke-width', '2.4');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-linecap', 'round');
    spark.appendChild(line);
    root.appendChild(spark);
    const right = h('div', 'wl-mk-quote');
    const price = h('div', 'wl-mk-price');
    const change = h('div', 'wl-mk-change');
    right.append(price, change);
    root.appendChild(right);
    parent.appendChild(root);
    return { kind, root, price, change, hint, line, spark, shownSpark: '' };
  }

  private buildSurvival(parent: HTMLElement): void {
    const head = h('button', 'wl-mk-survival-head', 'Survival goods <small>fixed prices</small><b>▸</b>');
    head.type = 'button';
    const body = h('div', 'wl-mk-survival-body');
    body.style.display = 'none';
    for (const kind of Object.keys(SURVIVAL_VALUE) as Exclude<ItemKind, MaterialKind>[]) {
      if (kind === 'cash') continue;
      const el = h('span', 'wl-mk-chip');
      body.appendChild(el);
      this.survivalRows.push({ kind, el });
    }
    onTap(head, () => {
      const open = body.style.display === 'none';
      body.style.display = open ? '' : 'none';
      head.classList.toggle('is-open', open);
      this.ctx.audio.play('click');
    });
    this.survival.append(head, body);
    parent.appendChild(this.survival);
  }

  private makeButton(klass: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', klass);
    b.type = 'button';
    onTap(b, onClick);
    return b;
  }

  private makeTradeCard(kind: MaterialKind, parent: HTMLElement): TradeCard {
    const m = this.ctx.market;
    const def = MATERIALS[kind];
    const root = h('div', 'wl-shop-card wl-mk-card');
    const top = h('div', 'wl-mk-cardtop');
    top.appendChild(h('div', 'wl-mk-ico', materialIcon(kind)));
    const mid = h('div', 'wl-shop-mid');
    mid.appendChild(h('div', 'wl-shop-name', `${materialLabel(kind)} ${this.eraTag(def.era)}`));
    const quote = h('div', 'wl-mk-sub');
    mid.appendChild(quote);
    top.appendChild(mid);
    root.appendChild(top);
    const held = h('div', 'wl-mk-held');
    root.appendChild(held);

    const trades = h('div', 'wl-mk-trades');
    const buyGroup = h('div', 'wl-mk-group');
    const sellGroup = h('div', 'wl-mk-group');
    const buys: TradeCard['buys'] = [];
    const sells: TradeCard['sells'] = [];
    for (const units of [1, 10, 100]) {
      const el = this.makeButton('wl-mk-btn is-buy', () => this.tap(() => m.buy(kind, units)));
      buyGroup.appendChild(el);
      buys.push({ units, el });
    }
    for (const units of [1, 10, 0]) {
      // 0 = all held
      const el = this.makeButton('wl-mk-btn is-sell', () => this.tap(() => m.sell(kind, units || m.holding(kind)), 'sell'));
      sellGroup.appendChild(el);
      sells.push({ units, el });
    }
    trades.append(buyGroup, sellGroup);
    root.appendChild(trades);

    const deliver = h('div', 'wl-mk-deliver');
    deliver.appendChild(h('span', 'wl-mk-dlabel', 'Deliver to'));
    const dest = h('select', 'wl-mk-select');
    dest.setAttribute('aria-label', `Deliver ${materialLabel(kind)} to`);
    deliver.appendChild(dest);
    const orders: TradeCard['orders'] = [];
    const card: TradeCard = { kind, root, quote, held, buys, sells, dest, orders, picked: 0, shownAge: 0 };
    dest.addEventListener('change', () => {
      card.picked = Number(dest.value) || 0;
      dest.blur();
      this.mark();
    });
    dest.addEventListener('click', (e) => e.stopPropagation());
    this.escCloses(dest);
    for (const units of [10, ORDER_MAX_UNITS]) {
      const el = this.makeButton('wl-mk-btn is-order', () => this.tap(() => m.order(kind, units, this.destOf(card))));
      deliver.appendChild(el);
      orders.push({ units, el });
    }
    root.appendChild(deliver);
    parent.appendChild(root);
    return card;
  }

  /**
   * A focused <select> eats the game's keys (Input / HUD skip SELECT targets): picks blur it to give the keyboard back
   * (letters / arrows would silently change the region otherwise), and Esc still closes the market (as SettingsPanel).
   */
  private escCloses(sel: HTMLSelectElement): void {
    sel.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      e.stopPropagation();
      sel.blur();
      this.close();
    });
  }

  private makeProduct(id: InvestProductId, parent: HTMLElement): ProductCard {
    const def = INVEST[id];
    const root = h('div', 'wl-shop-card wl-mk-card wl-mk-product');
    const top = h('div', 'wl-mk-cardtop');
    top.appendChild(h('div', 'wl-mk-ico is-invest', `<i class="wl-mk-glyph is-${id}"></i>`));
    const mid = h('div', 'wl-shop-mid');
    mid.appendChild(h('div', 'wl-shop-name', def.label));
    mid.appendChild(h('div', 'wl-shop-blurb', def.blurb));
    top.appendChild(mid);
    root.appendChild(top);
    const card: ProductCard = { id, root, chips: [], era: null, btn: h('button'), hint: h('div', 'wl-mk-hint'), pick: 'min', picked: 0, shownAge: 0 };
    if (id === 'venture') {
      const row = h('div', 'wl-mk-deliver');
      row.appendChild(h('span', 'wl-mk-dlabel', 'Back era'));
      const sel = h('select', 'wl-mk-select');
      sel.setAttribute('aria-label', 'Era to back');
      sel.addEventListener('change', () => {
        card.picked = Number(sel.value) || 0;
        sel.blur();
        this.mark();
      });
      sel.addEventListener('click', (e) => e.stopPropagation());
      this.escCloses(sel);
      row.appendChild(sel);
      card.era = sel;
      root.appendChild(row);
    }
    const chips = h('div', 'wl-mk-chips');
    for (const pick of ['min', 10, 25, 50] as AmountPick[]) {
      const el = this.makeButton('wl-mk-chip-btn', () => {
        card.pick = pick;
        this.ctx.audio.play('click');
        this.mark();
      });
      el.textContent = pick === 'min' ? 'Min' : `${pick}%`;
      chips.appendChild(el);
      card.chips.push({ pick, el });
    }
    card.btn = this.makeButton('wl-mk-btn is-invest-go', () => this.tap(() => this.ctx.market.invest(id, this.amountFor(card), id === 'venture' ? this.ventureEra(card) : 0), 'upgrade'));
    chips.appendChild(card.btn);
    root.append(chips, card.hint);
    parent.appendChild(root);
    return card;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Region to deliver to: the picked one while it is still open, else the first open region whose machines eat it, else its own era. */
  private destOf(card: TradeCard): number {
    const age = this.ctx.state.eras.age;
    if (card.picked >= 2 && card.picked <= age) return card.picked;
    let best = 0;
    for (const def of Object.values(MACHINES)) {
      if (def.era > age) continue;
      if (!def.inputs.some((i) => i.kind === card.kind)) continue;
      if (!best || def.era < best) best = def.era;
    }
    return best || MATERIALS[card.kind].era;
  }

  private ventureEra(card: ProductCard): number {
    const age = this.ctx.state.eras.age;
    return card.picked >= INVEST.venture.era && card.picked <= age ? card.picked : age;
  }

  /** Dollars the chosen chip would invest now (never below the product's minimum, never above the product's room left). */
  private amountFor(card: ProductCard): number {
    const def = INVEST[card.id];
    const money = this.ctx.economy.money;
    let amount = card.pick === 'min' ? def.min : Math.max(def.min, nice((money * card.pick) / 100));
    amount = Math.min(amount, this.ctx.market.room(card.id));
    return Math.min(amount, Math.floor(money));
  }

  private fillRegions(sel: HTMLSelectElement, from: number, age: number): void {
    const keep = sel.value;
    sel.textContent = '';
    for (let n = from; n <= age; n++) {
      const o = document.createElement('option');
      o.value = String(n);
      o.textContent = ERAS[n]?.region ?? ERA_NAMES[n] ?? '';
      sel.appendChild(o);
    }
    if (keep) sel.value = keep;
  }

  // ---------------------------------------------------------------------------
  // Refresh
  // ---------------------------------------------------------------------------

  private refresh(): void {
    const { market, economy, state } = this.ctx;
    put(this.worth, `<span>Net worth <b>${formatMoney(market.netWorth())}</b></span><span>Cash <b>${formatMoney(economy.money)}</b></span>`);
    const tradable = new Set(market.tradable());
    if (this.tab === 'prices') this.refreshPrices(tradable);
    else if (this.tab === 'trade') this.refreshTrade(tradable, state.eras.age);
    else this.refreshInvest(state.eras.age);
  }

  private refreshPrices(tradable: ReadonlySet<MaterialKind>): void {
    const { market } = this.ctx;
    for (const r of this.priceRows) {
      const on = tradable.has(r.kind);
      r.root.style.display = on ? '' : 'none';
      if (!on) continue;
      put(r.price, `${formatMoney(market.exportPrice(r.kind, 1))}<small>/unit</small>`);
      const ch = market.change(r.kind);
      put(r.change, pct(ch));
      setCls(r.change, `wl-mk-change ${cls(ch)}`);
      const flood = market.pressure(r.kind);
      put(r.hint, flood >= FLOOD_HINT ? `Flooded −${Math.round(flood * 100)}%` : '');
      const hist = market.history(r.kind);
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of hist) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const span = Math.max(1e-6, hi - lo);
      const stepX = 60 / Math.max(1, hist.length - 1);
      let pts = '';
      for (let i = 0; i < hist.length; i++) pts += `${(i * stepX).toFixed(1)},${(22 - ((hist[i]! - lo) / span) * 20).toFixed(1)} `;
      if (pts !== r.shownSpark) {
        r.shownSpark = pts;
        r.line.setAttribute('points', pts);
        r.line.setAttribute('stroke', hist[hist.length - 1]! >= hist[0]! ? '#2fa655' : '#d6453a');
      }
    }
    for (const s of this.survivalRows) put(s.el, `${materialLabel(s.kind)} <b>${formatMoney(market.unitValue(s.kind))}</b>`);
  }

  private refreshTrade(tradable: ReadonlySet<MaterialKind>, age: number): void {
    const { market, economy } = this.ctx;
    const money = economy.money;
    for (const c of this.tradeCards) {
      const on = tradable.has(c.kind);
      c.root.style.display = on ? '' : 'none';
      if (!on) continue;
      const held = market.holding(c.kind);
      put(c.quote, `Buy <b>${formatMoney(market.quote(c.kind, 'buy'))}</b> · Sell <b>${formatMoney(market.quote(c.kind, 'sell'))}</b>`);
      if (held > 0) {
        const pl = market.unrealised(c.kind);
        put(c.held, `Held <b>${held.toLocaleString('en-US')}</b> · avg ${formatMoney(market.basis(c.kind))} · P/L <b class="${cls(pl)}">${signed(pl)}</b>`);
      } else {
        put(c.held, 'Nothing held');
      }
      for (const b of c.buys) {
        const cost = market.buyCost(c.kind, b.units);
        put(b.el, `Buy ×${b.units}<small>${formatMoney(cost)}</small>`);
        b.el.disabled = money < cost;
      }
      for (const b of c.sells) {
        const n = b.units || held;
        put(b.el, `${b.units ? `Sell ×${b.units}` : 'Sell all'}<small>${n > 0 ? formatMoney(market.sellProceeds(c.kind, n)) : '—'}</small>`);
        b.el.disabled = n < 1 || n > held;
      }
      if (c.shownAge !== age) {
        c.shownAge = age;
        this.fillRegions(c.dest, 2, age);
      }
      const dest = this.destOf(c);
      if (c.dest.value !== String(dest)) c.dest.value = String(dest);
      c.dest.disabled = age < 2;
      for (const b of c.orders) {
        const cost = market.orderCost(c.kind, b.units);
        put(b.el, `×${b.units}<small>${formatMoney(cost)}</small>`);
        b.el.disabled = money < cost || age < 2;
      }
    }
  }

  private refreshInvest(age: number): void {
    const { market, economy } = this.ctx;
    const offered = new Set(market.products());
    const max = investMaxPositions(this.ctx.state);
    const full = market.positions().length >= max;
    for (const c of this.products) {
      const def = INVEST[c.id];
      const on = offered.has(c.id);
      c.root.style.display = on ? '' : 'none';
      if (!on) continue;
      for (const k of c.chips) setCls(k.el, `wl-mk-chip-btn${k.pick === c.pick ? ' is-on' : ''}`);
      if (c.era && c.shownAge !== age) {
        c.shownAge = age;
        this.fillRegions(c.era, INVEST.venture.era, age);
      }
      if (c.era) {
        const e = String(this.ventureEra(c));
        if (c.era.value !== e) c.era.value = e;
      }
      const amount = this.amountFor(c);
      let why = '';
      if (full) why = `All ${max} positions are open`;
      else if (amount < def.min) why = economy.money >= def.min ? `Capped at ${formatMoney(market.room(c.id) + market.totalIn(c.id))} (${Math.round(def.cap * 100)}% of your net worth)` : `Needs at least ${formatMoney(def.min)}`;
      put(c.btn, `Invest<small>${formatMoney(amount)}</small>`);
      c.btn.disabled = why !== '';
      put(c.hint, why || this.productNote(c.id));
      setCls(c.hint, why ? 'wl-mk-hint is-warn' : 'wl-mk-hint');
    }
    this.refreshPositions();
  }

  private productNote(id: InvestProductId): string {
    if (id === 'bond') return `Pays ${pct(this.ctx.market.bondPayout() - 1)} after ${formatDuration(INVEST.bond.lock ?? 0)}`;
    if (id === 'index') return `Grows about ${pct(INVEST.index.rate)} an hour`;
    return `Grows about ${pct(INVEST.venture.rate)} an hour, can dip`;
  }

  private refreshPositions(): void {
    const { market } = this.ctx;
    const list = market.positions();
    put(this.positionTitle, `Your positions <small>${list.length}/${investMaxPositions(this.ctx.state)}</small>`);
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let row = this.positionRows.get(p.id);
      if (!row) {
        row = this.makePositionRow(p);
        this.positionRows.set(p.id, row);
        this.positionList.appendChild(row.root);
      }
      const gain = p.principal > 0 ? p.value / p.principal - 1 : 0;
      put(row.value, formatMoney(p.value));
      put(row.gain, pct(gain));
      setCls(row.gain, `wl-mk-change ${cls(gain)}`);
      let status = '';
      if (p.product === 'bond') status = market.matured(p) ? 'Matured' : `Matures in ${formatDuration(market.maturesIn(p))}`;
      else status = `Held ${formatDuration(p.age)}`;
      put(row.status, status);
      put(row.btn, p.product === 'bond' && !market.matured(p) ? 'Cash out<small>deposit only</small>' : 'Withdraw');
    }
    for (const [id, row] of this.positionRows) {
      if (seen.has(id)) continue;
      row.root.remove();
      this.positionRows.delete(id);
    }
    this.positionEmpty.style.display = list.length === 0 ? '' : 'none';
  }

  private makePositionRow(p: InvestmentState): PositionRow {
    const def = INVEST[p.product];
    const root = h('div', 'wl-shop-card wl-mk-pos');
    const mid = h('div', 'wl-shop-mid');
    const era = p.product === 'venture' ? ` ${this.eraTag(p.era)}` : '';
    const name = h('div', 'wl-shop-name', `${def.label}${era}`);
    const status = h('div', 'wl-mk-sub');
    mid.append(name, status);
    const nums = h('div', 'wl-mk-quote');
    const value = h('div', 'wl-mk-price');
    const gain = h('div', 'wl-mk-change');
    nums.append(value, gain);
    const btn = this.makeButton('wl-mk-btn is-sell', () => this.tap(() => this.ctx.market.withdraw(p.id) > 0, 'sell'));
    root.append(mid, nums, btn);
    return { id: p.id, root, name, value, gain, status, btn };
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    const s = this.slide;
    if (s.open || s.k > 0) {
      this.since += dt;
      if ((this.dirty && this.since >= REFRESH_GAP) || this.since >= REFRESH_IDLE) {
        this.dirty = false;
        this.since = 0;
        this.refresh();
      }
    }
    if (s.step(dt, 0.26) || s.k > 0) {
      if (s.k <= 0) {
        this.root.style.display = 'none';
      } else {
        if (this.root.style.display === 'none') this.root.style.display = 'flex';
        const e = s.open ? backOut(Math.min(1, s.k)) : cubicOut(s.k);
        this.root.style.setProperty('--k', e.toFixed(3));
        this.root.style.opacity = Math.min(1, s.k * 3).toFixed(2);
      }
    }
  }
}
