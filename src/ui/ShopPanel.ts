/**
 * [B4] Upgrade shop panel. Opens on 'shop:open', closes on 'shop:close' (player on / off the cabin doormat, or an era
 * region's shop mat); the X button hides it until the next 'shop:open'. A Buy press only counts while the panel is open,
 * so levels are bought standing on a mat, one per press (upgrades are hands-on). Three tabs (Lumberjack | Crew | Sales). Bottom sheet on phones (≤ 44 % of the
 * viewport height, the rest stays bare canvas for the floating joystick), side card on wide screens.
 *
 * The cards are built once; refresh() only rewrites what changed and runs at most once per frame (from update())
 * while the panel is visible, because 'money:changed' fires for every cash bundle.
 *
 * 0.9.0 climb (docs/EXPANSION.md R5, §C), only once the Great Lodge opens it (below it every card is 0.8.0's):
 * - band pips: 10 pips for the band the next era's gate asks (Lv need − 10 .. need) plus a band star with the bands
 *   done, instead of the authored pips; a badge "Lv 23 · need 30", a gold "Lv 30 ✓" at the gate's level, "Not hired"
 *   for a crew, "Lv 10 · era standard" (with its tooltip) for an era upgrade that arrived at its offset;
 * - a gold dot on a tab while any of its upgrades is below the gate's level (the green "can buy" dot wins).
 */
import { PRIORITIES, QUARTERS, type TownPriority, type UpgradeGroup, type UpgradeIdConst, type WoodPriority } from '../config';
import { crewSlots, type CrewRole } from '../core/crew';
import { authoredMax, base, introEra } from '../core/ladder';
import type { GameContext } from '../core/types';
import { ERAS, ERA_NAMES } from '../eras/data';
import { climbOpen, gateNeed } from '../eras/gate';
import { BAND_PIPS, bandView, eraRoman, industryEraNote, industryEraShown, SHOP_TABS, shopDelta, shopTabs, type ShopTab } from './agesLogic';
import { backOut, cubicOut, h, onTap, shield, Slide } from './dom';
import { formatMoney } from './format';
import { hexCss, ICON_CLOSE, ICON_LOCK, upgradeIcon } from './icons';
import './ages.css';

interface Card {
  id: UpgradeIdConst;
  group: UpgradeGroup;
  /** 0.9.0: industry upgrades belong to an era (2..10); undefined elsewhere. */
  era: number | undefined;
  root: HTMLDivElement;
  pips: HTMLSpanElement[];
  /** "Lv 4/9" label, only on long upgrade ladders (the pips shrink there). */
  lv: HTMLSpanElement | null;
  delta: HTMLDivElement;
  /** "N helpers" tag on crew cards (the bunkhouse allows several of one role). */
  slots: HTMLSpanElement | null;
  btn: HTMLButtonElement;
  /** 0.9.0 climb: the band pips (10 + the star) and the level / need badge. */
  band: HTMLSpanElement;
  bandPips: HTMLSpanElement[];
  star: HTMLSpanElement;
  need: HTMLSpanElement;
  /** Last written values, to skip redundant DOM writes. */
  shown: { pips: number; delta: string; btn: string; cls: string; slots: string; band: string; need: string };
  bump: number;
}

type Tab = ShopTab;

/** `short`: the label used while five tabs share the row (the Industry tab is on show). */
const TABS: Array<{ group: Tab; label: string; short?: string }> = [
  { group: 'lumberjack', label: 'Lumberjack', short: 'Lumber' },
  { group: 'crew', label: 'Crew' },
  { group: 'sales', label: 'Sales' },
  { group: 'industry', label: 'Industry' },
  { group: 'finance', label: 'Finance' },
];

/** The header row above an era's industry upgrades. */
interface EraHeader {
  era: number;
  root: HTMLDivElement;
  note: HTMLSpanElement;
}

const WOOD_LABEL: Record<WoodPriority, { text: string; hint: string }> = {
  balanced: { text: 'Balanced', hint: 'Wood goes wherever it is needed first' },
  trucks: { text: 'Trucks', hint: 'Log haulers feed the truck counter first' },
  trains: { text: 'Trains', hint: 'Pine haulers always feed the train platform' },
  workshop: { text: 'Workshop', hint: 'Pine haulers keep the workshop hopper stocked first' },
};
const TOWN_LABEL: Record<TownPriority, { text: string; hint: string }> = {
  balanced: { text: 'Balanced', hint: 'The porter feeds the hungriest shop first' },
  bakery: { text: 'Bakery', hint: 'The porter stocks the bakery first' },
  butcher: { text: 'Butcher', hint: 'The porter stocks the butcher first' },
  toys: { text: 'Toys', hint: 'The porter stocks the toy factory first' },
};

/** One priorities row: a label and a pill of options. */
interface PrioRow {
  root: HTMLDivElement;
  btns: Array<{ value: string; el: HTMLButtonElement }>;
}

/** Ladders longer than this get small pips plus a "Lv n/max" label so the row still fits a phone card. */
const COMPACT_PIPS = 6;

export class ShopPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly tabEls = new Map<string, HTMLButtonElement>();
  private readonly cards: Card[] = [];
  private readonly eraHeaders: EraHeader[] = [];
  private readonly tabsEl: HTMLDivElement;
  /** Last applied tab / era / tab-strip layout (skips redundant DOM writes). */
  private layoutKey = '';
  private readonly prio: HTMLDivElement;
  /** Climb open (band pips on), as last laid out. */
  private climb = false;
  private readonly woodRow: PrioRow;
  private readonly townRow: PrioRow;
  private readonly slide = new Slide();
  private tab: Tab = 'lumberjack';
  private wanted = false;
  private dismissed = false;
  private dirty = true;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.root = h('div', 'wl-shop');
    shield(this.root);
    this.root.style.display = 'none';

    const head = h('div', 'wl-shop-head');
    head.appendChild(h('div', 'wl-shop-title wl-outline', 'Shop'));
    head.classList.add('is-stacked');
    const tabs = h('div', 'wl-shop-tabs');
    this.tabsEl = tabs;
    for (const t of TABS) {
      const label = t.short ? `<span class="wl-tab-long">${t.label}</span><span class="wl-tab-short">${t.short}</span>` : `<span>${t.label}</span>`;
      const b = h('button', 'wl-shop-tab', `${label}<i class="wl-dot"></i>`);
      b.type = 'button';
      onTap(b, () => {
        ctx.audio.unlock();
        ctx.audio.play('click');
        this.setTab(t.group);
      });
      tabs.appendChild(b);
      this.tabEls.set(t.group, b);
    }
    const close = h('button', 'wl-shop-close', ICON_CLOSE);
    close.type = 'button';
    close.setAttribute('aria-label', 'Close shop');
    onTap(close, () => {
      ctx.audio.play('click');
      this.close();
    });
    head.appendChild(close);
    head.appendChild(tabs);
    this.root.appendChild(head);

    this.list = h('div', 'wl-shop-list');
    this.root.appendChild(this.list);
    layer.appendChild(this.root);

    // crew priorities: the first thing on the Crew tab (the cards are appended after it)
    this.prio = h('div', 'wl-prio');
    this.woodRow = this.makePrioRow('Wood', PRIORITIES.wood, WOOD_LABEL, 'wood');
    this.townRow = this.makePrioRow('Town', PRIORITIES.town, TOWN_LABEL, 'town');
    this.prio.appendChild(this.woodRow.root);
    this.prio.appendChild(this.townRow.root);
    this.prio.appendChild(h('div', 'wl-prio-hint', "Who gets the wood when it's short, and which shop the porter stocks first."));
    this.list.appendChild(this.prio);
    this.prio.style.display = 'none';

    for (const { group } of TABS) {
      let lastEra = 0;
      for (const id of ctx.upgrades.group(group)) {
        const era = ctx.upgrades.def(id).era;
        if (group === 'industry' && era !== undefined && era !== lastEra) {
          lastEra = era;
          this.list.appendChild(this.makeEraHeader(era));
        }
        this.cards.push(this.makeCard(id, group));
      }
    }
    this.setTab('lumberjack');

    const ev = ctx.events;
    ev.on('shop:open', (e) => {
      if (e.tab && (SHOP_TABS as readonly string[]).includes(e.tab)) this.setTab(e.tab as Tab);
      this.wanted = true;
      this.dismissed = false;
      this.dirty = true;
      this.syncOpen();
    });
    ev.on('shop:close', () => {
      this.wanted = false;
      this.dismissed = false;
      this.syncOpen();
    });
    const mark = (): void => {
      this.dirty = true;
    };
    ev.on('money:changed', mark);
    ev.on('upgrade:bought', (e) => {
      this.dirty = true;
      const c = this.cards.find((k) => k.id === e.id);
      if (c) c.bump = 1;
    });
    ev.on('village:changed', mark);
    ev.on('town:revealed', mark);
    // 0.9.0: the Industry tab and its era groups follow the age
    ev.on('era:unlocked', mark);
    ev.on('expansion:offered', mark);
    // crewSlots() reads state.quarters.tier
    ev.on('quarters:built', mark);
    // requirement() also reads state.unlocked (e.g. the Crate Runner needs the Processor)
    ev.on('pad:unlocked', mark);
  }

  /** True while the panel is (or is animating to be) on screen. */
  get visible(): boolean {
    return this.slide.open;
  }

  /** Debug / tests: show or hide without the doormat. */
  force(open: boolean): void {
    this.wanted = open;
    this.dismissed = false;
    this.dirty = true;
    this.syncOpen();
  }

  /** Dismiss the panel like its X button (it stays shut until the player leaves and re-enters the spot). */
  close(): void {
    this.dismissed = true;
    this.syncOpen();
  }

  private syncOpen(): void {
    this.slide.open = this.wanted && !this.dismissed;
  }

  private setTab(group: Tab): void {
    this.tab = group;
    for (const [g, el] of this.tabEls) el.classList.toggle('is-on', g === group);
    if (group !== 'crew') this.prio.style.display = 'none';
    this.layoutKey = '';
    this.applyLayout();
    this.list.scrollTop = 0;
    this.dirty = true;
  }

  /**
   * Which tabs, era headers and cards are on show (0.9.0): Industry appears once the climb opens (the Great Lodge), lists the eras
   * up to the one after the current age (the next one locked), Finance is always there.
   */
  private applyLayout(): void {
    const { state } = this.ctx;
    const age = state.eras.age;
    const tabs = shopTabs(age, climbOpen(state));
    const key = `${this.tab}|${age}|${tabs.join(',')}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    for (const [g, el] of this.tabEls) el.style.display = tabs.includes(g as Tab) || g === this.tab ? '' : 'none';
    this.tabsEl.classList.toggle('is-many', tabs.length > 4 || this.tab === 'industry');
    for (const c of this.cards) {
      const eraOk = c.era === undefined || industryEraShown(c.era, age);
      c.root.style.display = c.group === this.tab && eraOk ? '' : 'none';
    }
    for (const hd of this.eraHeaders) {
      hd.root.style.display = this.tab === 'industry' && industryEraShown(hd.era, age) ? '' : 'none';
      const note = industryEraNote(hd.era, age) ?? '';
      hd.note.textContent = note;
      hd.root.classList.toggle('is-locked', note !== '');
    }
  }

  private makeEraHeader(n: number): HTMLDivElement {
    const e = ERAS[n]!;
    const root = h('div', 'wl-shop-era');
    root.style.setProperty('--era-accent', hexCss(e.colors.accent));
    root.appendChild(h('span', 'wl-shop-era-name', `ERA ${eraRoman(n)} \u00b7 ${e.name.toUpperCase()}`));
    const note = h('span', 'wl-shop-era-note');
    root.appendChild(note);
    this.eraHeaders.push({ era: n, root, note });
    return root;
  }

  private makeCard(id: UpgradeIdConst, group: UpgradeGroup): Card {
    const def = this.ctx.upgrades.def(id);
    const root = h('div', 'wl-shop-card');
    root.appendChild(h('div', 'wl-shop-icon', upgradeIcon(id)));
    const mid = h('div', 'wl-shop-mid');
    mid.appendChild(h('div', 'wl-shop-name', def.label));
    mid.appendChild(h('div', 'wl-shop-blurb', def.blurb));
    const pipRow = h('div', 'wl-pips');
    const pips: HTMLSpanElement[] = [];
    // the authored pips (0.8.0's row); levels past them, once the climb opens, show on the "Lv n/max" label
    const max = authoredMax(def);
    const compact = max > COMPACT_PIPS;
    pipRow.classList.toggle('is-compact', compact);
    for (let i = 0; i < max; i++) {
      const p = h('span', 'wl-pip');
      pipRow.appendChild(p);
      pips.push(p);
    }
    const lv = compact ? h('span', 'wl-lv') : null;
    if (lv) pipRow.appendChild(lv);
    // the climb's band view (hidden until the Great Lodge): 10 pips, the band star, the level / need badge
    const band = h('span', 'wl-band');
    const bandPips: HTMLSpanElement[] = [];
    for (let i = 0; i < BAND_PIPS; i++) {
      const p = h('span', 'wl-pip');
      band.appendChild(p);
      bandPips.push(p);
    }
    const star = h('span', 'wl-bstar');
    band.appendChild(star);
    band.style.display = 'none';
    pipRow.appendChild(band);
    const need = h('span', 'wl-need');
    need.style.display = 'none';
    pipRow.appendChild(need);
    const e = introEra(def);
    if (e >= 2 && base(def) > 0) need.title = `${ERA_NAMES[e] ?? 'Era'} gear arrives at Lv ${base(def)}, the level everything needs to open the ${ERA_NAMES[e] ?? 'next era'}.`;
    const slots = group === 'crew' && id in QUARTERS.crew ? h('span', 'wl-slots') : null;
    if (slots) pipRow.appendChild(slots);
    mid.appendChild(pipRow);
    const delta = h('div', 'wl-shop-delta');
    mid.appendChild(delta);
    root.appendChild(mid);
    const btn = h('button', 'wl-shop-buy');
    btn.type = 'button';
    root.appendChild(btn);
    this.list.appendChild(root);
    const card: Card = {
      id,
      group,
      era: def.era,
      root,
      pips,
      lv,
      delta,
      slots,
      btn,
      band,
      bandPips,
      star,
      need,
      shown: { pips: -1, delta: '', btn: '', cls: '', slots: '', band: '', need: '' },
      bump: 0,
    };
    onTap(btn, () => this.buy(card));
    return card;
  }

  private makePrioRow<T extends string>(
    label: string,
    values: readonly T[],
    labels: Record<T, { text: string; hint: string }>,
    key: 'wood' | 'town',
  ): PrioRow {
    const root = h('div', 'wl-prio-row');
    root.appendChild(h('div', 'wl-prio-label', `${label} <b>\u2192</b>`));
    const seg = h('div', 'wl-prio-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', `${label} priority`);
    const btns: PrioRow['btns'] = [];
    for (const v of values) {
      const b = h('button', 'wl-prio-opt', labels[v].text);
      b.type = 'button';
      b.title = labels[v].hint;
      b.setAttribute('role', 'radio');
      onTap(b, () => {
        this.ctx.audio.unlock();
        this.ctx.audio.play('click');
        (this.ctx.state.priorities as Record<string, string>)[key] = v;
        this.dirty = true;
      });
      seg.appendChild(b);
      btns.push({ value: v, el: b });
    }
    root.appendChild(seg);
    return { root, btns };
  }

  private refreshPriorities(): void {
    const { state, upgrades } = this.ctx;
    const show = this.tab === 'crew' && this.cards.some((c) => c.group === 'crew' && upgrades.level(c.id) > 0);
    this.prio.style.display = show ? '' : 'none';
    if (!show) return;
    this.townRow.root.style.display = state.town.revealed ? '' : 'none';
    for (const [row, cur] of [[this.woodRow, state.priorities.wood], [this.townRow, state.priorities.town]] as const) {
      for (const b of row.btns) {
        const on = b.value === cur;
        b.el.classList.toggle('is-on', on);
        b.el.setAttribute('aria-checked', String(on));
        // Trains only matter once the tree feller feeds the platform (keep it visible while selected)
        if (b.value === 'trains') b.el.style.display = state.unlocked.treeFeller || on ? '' : 'none';
      }
    }
  }

  /** One level, and only while the panel is open: the player stands on a shop mat (a closing panel buys nothing). */
  private buy(card: Card): void {
    const { ctx } = this;
    ctx.audio.unlock();
    if (!this.slide.open) return;
    if (!ctx.upgrades.buy(card.id)) {
      ctx.audio.play('full', { volume: 0.5 });
      return;
    }
    // 'upgrade:bought' already marked the panel dirty and started the bump
    this.dirty = true;
  }

  /**
   * The climb's band view of one card: pips for the band ending at the gate's level, the bands done on the star, and
   * the badge ("Lv 23 · need 30", "Lv 30 ✓", "Not hired", "Lv 10 · era standard"). `need` is null with no gate ahead.
   */
  private refreshBand(c: Card, need: number | null): boolean {
    const up = this.ctx.upgrades;
    const def = up.def(c.id);
    const stored = up.level(c.id);
    const v = bandView(up.shownLevel(c.id), stored, base(def), !(def.display === 'crew' && stored <= 0), need);
    const band = `${v.fill}|${v.bands}`;
    if (band !== c.shown.band) {
      c.shown.band = band;
      for (let i = 0; i < BAND_PIPS; i++) c.bandPips[i]!.classList.toggle('on', i < v.fill);
      c.star.textContent = v.bands > 0 ? `\u2605${v.bands}` : '';
    }
    const key = `${v.text}|${v.tone}`;
    if (key !== c.shown.need) {
      c.shown.need = key;
      c.need.textContent = v.text;
      c.need.className = v.tone ? `wl-need is-${v.tone}` : 'wl-need';
    }
    return v.tone === 'low';
  }

  private refresh(): void {
    const up = this.ctx.upgrades;
    this.applyLayout();
    const { state } = this.ctx;
    const age = state.eras.age;
    const climb = climbOpen(state);
    if (climb !== this.climb) {
      // the Great Lodge: the authored pips (and "Lv 4/9") give way to the band view
      this.climb = climb;
      this.root.classList.toggle('is-climb', climb);
      for (const c of this.cards) {
        for (const p of c.pips) p.style.display = climb ? 'none' : '';
        if (c.lv) c.lv.style.display = climb ? 'none' : '';
        c.band.style.display = climb ? '' : 'none';
        c.need.style.display = climb ? '' : 'none';
      }
    }
    const next = age + 1;
    const gateOn = climb && !!ERAS[next];
    const tabNeed: Record<string, boolean> = { lumberjack: false, crew: false, sales: false, industry: false, finance: false };
    const tabHint: Record<string, boolean> = { lumberjack: false, crew: false, sales: false, industry: false, finance: false };
    for (const c of this.cards) {
      const id = c.id;
      const lvl = up.level(id);
      const isMax = up.isMax(id);
      const req = isMax ? null : up.requirement(id);
      const can = up.canBuy(id);
      const cost = up.nextCost(id);
      if (can && (c.era === undefined || industryEraShown(c.era, age))) tabHint[c.group] = true;

      if (c.shown.pips !== lvl) {
        c.shown.pips = lvl;
        for (let i = 0; i < c.pips.length; i++) c.pips[i]!.classList.toggle('on', i < lvl);
      }
      if (c.lv && !climb) {
        const lv = `Lv ${lvl}/${up.maxLevel(id)}`;
        if (c.lv.textContent !== lv) c.lv.textContent = lv;
      }
      if (climb) {
        const inGate = gateOn && introEra(up.def(id)) <= age;
        const below = this.refreshBand(c, inGate ? gateNeed(next) : null);
        if (below && (c.era === undefined || industryEraShown(c.era, age))) tabNeed[c.group] = true;
      }
      const delta = shopDelta(up.describe(id), isMax ? null : up.describe(id, lvl + 1), climb);
      if (delta !== c.shown.delta) {
        c.shown.delta = delta;
        c.delta.textContent = delta;
      }

      if (c.slots) {
        // hired: the live count; not hired yet: what the bunkhouse will allow (only worth saying above one)
        const role = id as CrewRole;
        const row = QUARTERS.crew[role];
        const tier = this.ctx.state.quarters.tier;
        const n = lvl > 0 ? crewSlots(this.ctx.state, role) : row[Math.max(0, Math.min(row.length - 1, tier + 1))]!;
        const txt = n > 1 ? `${lvl > 0 ? '' : 'up to '}${n} helpers` : '';
        if (txt !== c.shown.slots) {
          c.shown.slots = txt;
          c.slots.textContent = txt;
        }
      }

      let btnHtml: string;
      let cls: string;
      if (isMax) {
        btnHtml = 'MAX';
        cls = 'is-max';
      } else if (req) {
        btnHtml = `<span class="wl-lock">${ICON_LOCK}</span><span class="wl-req">${req}</span>`;
        cls = 'is-lock';
      } else {
        const price = formatMoney(cost ?? 0);
        const hire = c.group === 'crew' || (c.group === 'industry' && id.endsWith('Crew'));
        btnHtml = lvl === 0 && hire ? `<small>Hire</small>${price}` : price;
        cls = can ? 'is-buy' : 'is-poor';
      }
      if (btnHtml !== c.shown.btn) {
        c.shown.btn = btnHtml;
        c.btn.innerHTML = btnHtml;
      }
      if (cls !== c.shown.cls) {
        c.shown.cls = cls;
        c.btn.className = `wl-shop-buy ${cls}`;
        c.btn.disabled = cls !== 'is-buy';
        c.root.classList.toggle('is-locked', cls === 'is-lock');
        c.root.classList.toggle('is-maxed', cls === 'is-max');
      }
    }
    this.refreshPriorities();
    for (const [g, el] of this.tabEls) {
      el.classList.toggle('has-hint', !!tabHint[g] && g !== this.tab);
      el.classList.toggle('has-need', !!tabNeed[g] && g !== this.tab);
    }
  }

  update(dt: number): void {
    const s = this.slide;
    if (this.dirty && (s.open || s.k > 0)) {
      this.dirty = false;
      this.refresh();
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
    // purchase pop on the bought card
    for (const c of this.cards) {
      if (c.bump > 0) {
        c.bump = Math.max(0, c.bump - dt / 0.35);
        const sc = 1 + 0.06 * Math.sin(Math.PI * (1 - c.bump));
        c.root.style.transform = c.bump > 0 ? `scale(${sc.toFixed(3)})` : '';
      }
    }
  }

  /** For tests. */
  get currentTab(): string {
    return this.tab;
  }
}
