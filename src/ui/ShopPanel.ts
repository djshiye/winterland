/**
 * [B4] Upgrade shop panel. Opens on 'shop:open', closes on 'shop:close' (player on / off the cabin doormat); the X
 * button hides it until the next 'shop:open'. Three tabs (Lumberjack | Crew | Sales). Bottom sheet on phones (≤ 44 % of the
 * viewport height, the rest stays bare canvas for the floating joystick), side card on wide screens.
 *
 * The cards are built once; refresh() only rewrites what changed and runs at most once per frame (from update())
 * while the panel is visible, because 'money:changed' fires for every cash bundle.
 */
import { QUARTERS, type UpgradeGroup, type UpgradeIdConst } from '../config';
import { crewSlots, type CrewRole } from '../core/crew';
import type { GameContext } from '../core/types';
import { backOut, cubicOut, h, onTap, shield, Slide } from './dom';
import { formatMoney } from './format';
import { ICON_CLOSE, ICON_LOCK, upgradeIcon } from './icons';

interface Card {
  id: UpgradeIdConst;
  group: UpgradeGroup;
  root: HTMLDivElement;
  pips: HTMLSpanElement[];
  /** "Lv 4/9" label, only on long upgrade ladders (the pips shrink there). */
  lv: HTMLSpanElement | null;
  delta: HTMLDivElement;
  /** "N helpers" tag on crew cards (the bunkhouse allows several of one role). */
  slots: HTMLSpanElement | null;
  btn: HTMLButtonElement;
  /** Last written values, to skip redundant DOM writes. */
  shown: { pips: number; delta: string; btn: string; cls: string; slots: string };
  bump: number;
}

type Tab = 'lumberjack' | 'crew' | 'sales';

const TABS: Array<{ group: Tab; label: string }> = [
  { group: 'lumberjack', label: 'Lumberjack' },
  { group: 'crew', label: 'Crew' },
  { group: 'sales', label: 'Sales' },
];

/** Ladders longer than this get small pips plus a "Lv n/max" label so the row still fits a phone card. */
const COMPACT_PIPS = 6;

export class ShopPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly tabEls = new Map<string, HTMLButtonElement>();
  private readonly cards: Card[] = [];
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
    const tabs = h('div', 'wl-shop-tabs');
    for (const t of TABS) {
      const b = h('button', 'wl-shop-tab', `<span>${t.label}</span><i class="wl-dot"></i>`);
      b.type = 'button';
      onTap(b, () => {
        ctx.audio.unlock();
        ctx.audio.play('click');
        this.setTab(t.group);
      });
      tabs.appendChild(b);
      this.tabEls.set(t.group, b);
    }
    head.appendChild(tabs);
    const close = h('button', 'wl-shop-close', ICON_CLOSE);
    close.type = 'button';
    close.setAttribute('aria-label', 'Close shop');
    onTap(close, () => {
      ctx.audio.play('click');
      this.dismissed = true;
      this.syncOpen();
    });
    head.appendChild(close);
    this.root.appendChild(head);

    this.list = h('div', 'wl-shop-list');
    this.root.appendChild(this.list);
    layer.appendChild(this.root);

    for (const { group } of TABS) {
      for (const id of ctx.upgrades.group(group)) this.cards.push(this.makeCard(id, group));
    }
    this.setTab('lumberjack');

    const ev = ctx.events;
    ev.on('shop:open', () => {
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

  private syncOpen(): void {
    this.slide.open = this.wanted && !this.dismissed;
  }

  private setTab(group: Tab): void {
    this.tab = group;
    for (const [g, el] of this.tabEls) el.classList.toggle('is-on', g === group);
    for (const c of this.cards) c.root.style.display = c.group === group ? '' : 'none';
    this.list.scrollTop = 0;
    this.dirty = true;
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
    const max = this.ctx.upgrades.maxLevel(id);
    const compact = max > COMPACT_PIPS;
    pipRow.classList.toggle('is-compact', compact);
    for (let i = 0; i < max; i++) {
      const p = h('span', 'wl-pip');
      pipRow.appendChild(p);
      pips.push(p);
    }
    const lv = compact ? h('span', 'wl-lv') : null;
    if (lv) pipRow.appendChild(lv);
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
    const card: Card = { id, group, root, pips, lv, delta, slots, btn, shown: { pips: -1, delta: '', btn: '', cls: '', slots: '' }, bump: 0 };
    onTap(btn, () => this.buy(card));
    return card;
  }

  private buy(card: Card): void {
    const { ctx } = this;
    ctx.audio.unlock();
    if (!ctx.upgrades.buy(card.id)) {
      ctx.audio.play('full', { volume: 0.5 });
      return;
    }
    // 'upgrade:bought' already marked the panel dirty and started the bump
    this.dirty = true;
  }

  private refresh(): void {
    const up = this.ctx.upgrades;
    let tabHint: Record<string, boolean> = { lumberjack: false, crew: false, sales: false };
    for (const c of this.cards) {
      const id = c.id;
      const lvl = up.level(id);
      const isMax = up.isMax(id);
      const req = isMax ? null : up.requirement(id);
      const can = up.canBuy(id);
      const cost = up.nextCost(id);
      if (can) tabHint = { ...tabHint, [c.group]: true };

      if (c.shown.pips !== lvl) {
        c.shown.pips = lvl;
        for (let i = 0; i < c.pips.length; i++) c.pips[i]!.classList.toggle('on', i < lvl);
        if (c.lv) c.lv.textContent = `Lv ${lvl}/${c.pips.length}`;
      }
      const delta = isMax ? `${up.describe(id)} (max)` : `${up.describe(id)} → ${up.describe(id, lvl + 1)}`;
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
        btnHtml = lvl === 0 && c.group === 'crew' ? `<small>Hire</small>${price}` : price;
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
    for (const [g, el] of this.tabEls) el.classList.toggle('has-hint', !!tabHint[g] && g !== this.tab);
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
