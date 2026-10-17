/**
 * [0.9.0 Ages — UI] Info / demolish card for something already built (a town business, an era machine, a city
 * building). Opens on 'manage:open' (a ManageRequest: title, subtitle, icon, stats rows, demolish price + callback),
 * closes on 'manage:close' (only when the key matches the card on show), its X button and Esc. A red
 * "Demolish — $X" button asks "Demolish? This can't be undone" (Confirm / Cancel) before it calls onDemolish(); a
 * refusal (false) plays the 'full' sound and shakes the card, success closes it. Same look as BuildPanel.
 */
import type { GameContext, ManageRequest } from '../core/types';
import { h, onTap } from './dom';
import { formatMoney } from './format';
import { ICON_CLOSE, ICON_HAMMER } from './icons';
import { Sheet } from './sheet';
import './build.css';
import './ages.css';

export class ManagePanel {
  private readonly sheet: Sheet;
  private readonly iconEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subEl: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private req: ManageRequest | null = null;
  private confirming = false;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.sheet = new Sheet('wl-manage', layer);
    const root = this.sheet.root;
    const head = h('div', 'wl-build-head');
    this.iconEl = h('div', 'wl-manage-icon');
    head.appendChild(this.iconEl);
    const titles = h('div', 'wl-build-titles');
    this.titleEl = h('div', 'wl-build-title wl-title');
    this.subEl = h('div', 'wl-build-sub');
    titles.append(this.titleEl, this.subEl);
    head.appendChild(titles);
    const close = h('button', 'wl-build-close', ICON_CLOSE);
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    onTap(close, () => {
      ctx.audio.play('click');
      this.close();
    });
    head.appendChild(close);
    root.appendChild(head);
    this.body = h('div', 'wl-build-list wl-manage-body');
    root.appendChild(this.body);

    ctx.events.on('manage:open', (r) => this.show(r));
    ctx.events.on('manage:close', (e) => {
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
  show(req: ManageRequest): void {
    this.req = req;
    this.confirming = false;
    this.iconEl.innerHTML = req.icon ?? '';
    this.iconEl.style.display = req.icon ? '' : 'none';
    this.titleEl.textContent = req.title;
    this.subEl.textContent = req.subtitle ?? '';
    this.subEl.style.display = req.subtitle ? '' : 'none';
    this.renderBody();
    this.body.scrollTop = 0;
    this.sheet.setOpen(true);
  }

  /** Hide the card (X, Esc, 'manage:close'). */
  close(): void {
    this.sheet.setOpen(false);
    this.confirming = false;
  }

  private renderBody(): void {
    const req = this.req;
    this.body.textContent = '';
    if (!req) return;
    const stats = req.stats ?? [];
    if (stats.length) {
      const card = h('div', 'wl-manage-stats');
      for (const s of stats) {
        const row = h('div', 'wl-manage-row');
        row.append(h('span', 'wl-manage-label', s.label), h('span', 'wl-manage-value', s.value));
        card.appendChild(row);
      }
      this.body.appendChild(card);
    }
    if (req.demolishCost === null) return;
    const box = h('div', 'wl-manage-demo');
    if (!this.confirming) {
      const btn = h('button', 'wl-manage-btn is-danger', `<i>${ICON_HAMMER}</i><span>Demolish — ${formatMoney(req.demolishCost)}</span>`);
      btn.type = 'button';
      onTap(btn, () => {
        this.ctx.audio.unlock();
        this.ctx.audio.play('click');
        this.confirming = true;
        this.renderBody();
      });
      box.appendChild(btn);
    } else {
      box.appendChild(h('div', 'wl-manage-ask', "Demolish? This can't be undone"));
      const row = h('div', 'wl-manage-confirm');
      const yes = h('button', 'wl-manage-btn is-danger', 'Confirm');
      const no = h('button', 'wl-manage-btn is-plain', 'Cancel');
      yes.type = no.type = 'button';
      onTap(yes, () => this.demolish());
      onTap(no, () => {
        this.ctx.audio.play('click');
        this.confirming = false;
        this.renderBody();
      });
      row.append(yes, no);
      box.appendChild(row);
    }
    this.body.appendChild(box);
  }

  private demolish(): void {
    const req = this.req;
    if (!req) return;
    this.ctx.audio.unlock();
    if (req.onDemolish()) {
      this.close();
      return;
    }
    this.ctx.audio.play('full', { volume: 0.5 });
    this.sheet.shake();
    this.confirming = false;
    this.renderBody();
  }

  update(dt: number): void {
    this.sheet.update(dt);
  }
}
