/**
 * [T2 — town] Build panel (wave 9). Opens on 'build:open' { lot } (the player stands on an empty / unpaid lot's pad in
 * the Market Town), closes on 'build:close' (walked off), on 'build:chosen' and with its X button (which keeps it
 * hidden until the next 'build:open'). One cosy card per building (Town.choices(lot)): icon, name, blurb, cost
 * (logs + $), "+N jobs" / "+N residents", what it needs and makes; a card whose era isn't reached is greyed with
 * the reason ("Needs Winter City"). Tapping an available card calls town.choose(lot, id) and closes the panel.
 * Bottom sheet on phones (≤ 44 % of the viewport height, the rest stays bare canvas for the joystick), side card on
 * wide screens — same look as the shop panel (ShopPanel.ts).
 */
import { BUSINESSES, TOWN, type BusinessDef, type BusinessId } from '../config';
import type { GameContext, ItemKind } from '../core/types';
import { lowerLabel, MATERIALS, MATERIAL_KINDS, type MaterialKind } from '../eras/data';
import type { Town } from '../town/Town';
import { backOut, cubicOut, h, keyLabel, onTap, shield, Slide } from './dom';
import { formatMoney } from './format';
import { buildingIcon, ICON_CLOSE, ICON_COIN, ICON_LOCK, ICON_LOG, ICON_WORKER } from './icons';
import './build.css';
import { markPanel } from './dialog';

const ITEM_NAME: Record<ItemKind, string> = {
  log: 'logs',
  plank: 'planks',
  crate: 'crates',
  cash: 'cash',
  furniture: 'chairs',
  wheat: 'wheat',
  bread: 'bread',
  meat: 'meat',
  sausage: 'sausages',
  toy: 'toys',
  ...(Object.fromEntries(MATERIAL_KINDS.map((k) => [k, lowerLabel(MATERIALS[k].label)])) as Record<MaterialKind, string>),
};

/** "Needs wheat + logs" / "Makes bread" / "Grows wheat" / "Houses 10" — what the building does, in a few words. */
export function describeBusiness(def: BusinessDef): { needs: string; makes: string; people: string } {
  const needs = def.inputs.length ? `Needs ${def.inputs.map((i) => (i.per > 1 ? `${i.per} ` : '') + ITEM_NAME[i.kind]).join(' + ')}` : '';
  const makes = def.output ? `${def.kind === 'shop' ? 'Sells' : 'Makes'} ${ITEM_NAME[def.output]}` : '';
  const people = def.kind === 'home' ? `+${def.people} residents` : `+${def.people} jobs`;
  return { needs, makes, people };
}

interface Card {
  id: BusinessId;
  root: HTMLDivElement;
}

export class BuildPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly slide = new Slide();
  private cards: Card[] = [];
  private town: Town | null = null;
  private lot = -1;
  private wanted = false;
  private dismissed = false;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.root = h('div', 'wl-build');
    shield(this.root);
    this.root.style.display = 'none';

    const head = h('div', 'wl-build-head');
    const titles = h('div', 'wl-build-titles');
    const title = h('div', 'wl-build-title wl-title', 'Build');
    titles.appendChild(title);
    markPanel(this.root, title, 'wl-build-title');
    this.sub = h('div', 'wl-build-sub', 'Choose what to build here');
    titles.appendChild(this.sub);
    head.appendChild(titles);
    const close = h('button', 'wl-build-close', ICON_CLOSE);
    close.type = 'button';
    close.setAttribute('aria-label', 'Close build menu');
    close.title = keyLabel('Close', 'Esc');
    onTap(close, () => {
      ctx.audio.play('click');
      this.close();
    });
    head.appendChild(close);
    this.root.appendChild(head);

    this.list = h('div', 'wl-build-list');
    this.root.appendChild(this.list);
    layer.appendChild(this.root);

    const ev = ctx.events;
    ev.on('build:open', (e) => {
      this.lot = e.lot;
      this.wanted = true;
      this.dismissed = false;
      this.rebuild();
      this.syncOpen();
    });
    ev.on('build:close', () => {
      this.wanted = false;
      this.dismissed = false;
      this.syncOpen();
    });
    ev.on('build:chosen', () => {
      this.dismissed = true;
      this.syncOpen();
    });
    ev.on('village:changed', () => {
      if (this.wanted) this.rebuild();
    });
  }

  /** Town.constructor hands itself over (the HUD is built before the level). */
  attach(town: Town): void {
    this.town = town;
  }

  /** True while the panel is (or is animating to be) on screen. */
  get visible(): boolean {
    return this.slide.open;
  }

  /** The lot the panel is showing (−1 = none yet). */
  get currentLot(): number {
    return this.lot;
  }

  /** Ids of the cards on show (tests / debug). */
  get cardIds(): BusinessId[] {
    return this.cards.map((c) => c.id);
  }

  /** Debug / tests: show lot `lot`'s choices or hide without a pad. */
  force(open: boolean, lot = this.lot): void {
    this.lot = lot;
    this.wanted = open;
    this.dismissed = false;
    if (open) this.rebuild();
    this.syncOpen();
  }

  /** Dismiss the panel like its X button (it stays shut until the player leaves and re-enters the spot). */
  close(): void {
    this.dismissed = true;
    this.syncOpen();
  }

  private syncOpen(): void {
    this.slide.open = this.wanted && !this.dismissed && this.cards.length > 0;
  }

  private rebuild(): void {
    this.list.textContent = '';
    this.cards = [];
    const town = this.town;
    if (!town || this.lot < 0) return;
    const current = this.ctx.state.town.lots[this.lot]?.building ?? '';
    const paid = (this.ctx.state.town.lots[this.lot]?.logs ?? 0) + (this.ctx.state.town.lots[this.lot]?.cash ?? 0) > 0;
    this.sub.textContent = current && !paid ? 'Change your mind? Pick another' : 'Choose what to build here';
    for (const c of town.choices(this.lot)) {
      if (TOWN.hidden.includes(c.def.id)) continue;
      this.list.appendChild(this.makeCard(c.def, c.available, c.reason, c.def.id === current));
    }
    this.list.scrollTop = 0;
  }

  private makeCard(def: BusinessDef, available: boolean, reason: string | undefined, current: boolean): HTMLDivElement {
    // live numbers: the config object is the truth (balance tweaks show up without a rebuild of the panel class)
    const live = BUSINESSES[def.id];
    const d = describeBusiness(live);
    const root = h('div', 'wl-build-card');
    root.classList.toggle('is-locked', !available);
    root.classList.toggle('is-current', current);
    root.appendChild(h('div', 'wl-build-icon', buildingIcon(def.id)));
    const mid = h('div', 'wl-build-mid');
    mid.appendChild(h('div', 'wl-build-name', live.label));
    mid.appendChild(h('div', 'wl-build-blurb', live.blurb));
    const chips = h('div', 'wl-build-chips');
    chips.appendChild(h('span', 'wl-build-chip', `<i>${ICON_LOG}</i>${live.logs}`));
    chips.appendChild(h('span', 'wl-build-chip', `<i>${ICON_COIN}</i>${formatMoney(live.cash)}`));
    chips.appendChild(h('span', 'wl-build-chip is-people', `<i>${ICON_WORKER}</i>${d.people}`));
    mid.appendChild(chips);
    const flow = [d.needs, d.makes].filter(Boolean).join(' · ');
    if (flow) mid.appendChild(h('div', 'wl-build-flow', flow));
    root.appendChild(mid);
    // a real button, so the keyboard and the gamepad reach every card (a locked one too: it reads out why)
    const go = h('button', 'wl-build-go');
    go.type = 'button';
    if (!available) {
      go.className = 'wl-build-go is-lock';
      go.innerHTML = `<span class="wl-lock">${ICON_LOCK}</span><span class="wl-req">${reason ?? 'Locked'}</span>`;
      go.setAttribute('aria-disabled', 'true');
      go.setAttribute('aria-label', `${live.label}: locked, ${reason ?? 'not yet'}`);
    } else {
      go.textContent = current ? 'Chosen' : 'Build';
      go.setAttribute('aria-label', current ? `${live.label}: chosen` : `Build ${live.label}`);
    }
    root.appendChild(go);
    if (available) onTap(root, () => this.pick(def.id));
    else onTap(go, () => this.ctx.audio.play('full', { volume: 0.5 })); // pressed with Enter / A: a soft "not yet"
    this.cards.push({ id: def.id, root });
    return root;
  }

  private pick(id: BusinessId): void {
    const { ctx } = this;
    ctx.audio.unlock();
    if (!this.town || !this.town.choose(this.lot, id)) {
      ctx.audio.play('full', { volume: 0.5 });
      return;
    }
    // 'build:chosen' closed the panel (a re-pick of the same building doesn't emit it)
    this.dismissed = true;
    this.syncOpen();
  }

  update(dt: number): void {
    const s = this.slide;
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
