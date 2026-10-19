/**
 * [0.9.0 Ages — UI] "What do you want to build here?" card for empty machine slots and city lots. Opens on
 * 'choose:open' (a ChooseRequest), closes on 'choose:close' (only when the key matches), its X button and Esc. One
 * card per option (icon, name, blurb, price line; a locked option is greyed with its reason). Tapping an available
 * option calls onChoose(id): true closes the card, false plays the 'full' sound and shakes it (the card stays).
 * Looks exactly like BuildPanel (its CSS classes).
 */
import type { ChooseOption, ChooseRequest, GameContext } from '../core/types';
import { h, keyLabel, onTap } from './dom';
import { ICON_CLOSE, ICON_COIN, ICON_HOUSE, ICON_LOCK } from './icons';
import { Sheet } from './sheet';
import './build.css';
import './ages.css';
import { markPanel } from './dialog';

export class ChoosePanel {
  private readonly sheet: Sheet;
  private readonly titleEl: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private req: ChooseRequest | null = null;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.sheet = new Sheet('wl-choose', layer);
    const root = this.sheet.root;
    const head = h('div', 'wl-build-head');
    const titles = h('div', 'wl-build-titles');
    this.titleEl = h('div', 'wl-build-title wl-title');
    titles.append(this.titleEl, h('div', 'wl-build-sub', 'Choose what to build here'));
    markPanel(root, this.titleEl, 'wl-choose-title');
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
    root.appendChild(head);
    this.list = h('div', 'wl-build-list');
    root.appendChild(this.list);

    ctx.events.on('choose:open', (r) => this.show(r));
    ctx.events.on('choose:close', (e) => {
      if (this.req && this.req.key === e.key) this.close();
    });
  }

  /** True while the card is (or is animating to be) on screen. */
  get visible(): boolean {
    return this.sheet.visible;
  }

  /** The key of the card on show (null when none). */
  get currentKey(): string | null {
    return this.sheet.visible && this.req ? this.req.key : null;
  }

  /** Show a request (replaces any card on show). */
  show(req: ChooseRequest): void {
    this.req = req;
    this.titleEl.textContent = req.title;
    this.list.textContent = '';
    for (const o of req.options) this.list.appendChild(this.makeCard(o));
    this.list.scrollTop = 0;
    this.sheet.setOpen(req.options.length > 0);
  }

  /** Hide the card (X, Esc, 'choose:close'). */
  close(): void {
    this.sheet.setOpen(false);
  }

  private makeCard(o: ChooseOption): HTMLDivElement {
    const locked = o.locked !== undefined;
    const root = h('div', 'wl-build-card');
    root.classList.toggle('is-locked', locked);
    root.appendChild(h('div', 'wl-build-icon', o.icon || ICON_HOUSE));
    const mid = h('div', 'wl-build-mid');
    const name = h('div', 'wl-build-name');
    name.textContent = o.label;
    mid.appendChild(name);
    const blurb = h('div', 'wl-build-blurb');
    blurb.textContent = o.blurb;
    mid.appendChild(blurb);
    const chips = h('div', 'wl-build-chips');
    const cost = h('span', 'wl-build-chip', `<i>${ICON_COIN}</i>`);
    cost.appendChild(document.createTextNode(o.costText));
    chips.appendChild(cost);
    mid.appendChild(chips);
    root.appendChild(mid);
    // a real button, so the keyboard and the gamepad reach every card (a locked one too: it reads out why)
    const go = h('button', 'wl-build-go');
    go.type = 'button';
    if (locked) {
      go.className = 'wl-build-go is-lock';
      go.innerHTML = `<span class="wl-lock">${ICON_LOCK}</span><span class="wl-req"></span>`;
      go.querySelector('.wl-req')!.textContent = o.locked ?? 'Locked';
      go.setAttribute('aria-disabled', 'true');
      go.setAttribute('aria-label', `${o.label}: locked, ${o.locked ?? 'not yet'}`);
    } else {
      go.textContent = 'Build';
      go.setAttribute('aria-label', `Build ${o.label}`);
    }
    root.appendChild(go);
    if (!locked) onTap(root, () => this.pick(o.id));
    else onTap(go, () => this.ctx.audio.play('full', { volume: 0.5 })); // pressed with Enter / A: a soft "not yet"
    return root;
  }

  private pick(id: string): void {
    const req = this.req;
    if (!req) return;
    this.ctx.audio.unlock();
    if (req.onChoose(id)) {
      this.close();
      return;
    }
    this.ctx.audio.play('full', { volume: 0.5 });
    this.sheet.shake();
  }

  update(dt: number): void {
    this.sheet.update(dt);
  }
}
