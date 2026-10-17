/**
 * [MAIN] 0.9.6 notice card: one calm, centred card for the few things the player must hear about their save (it could
 * not be opened and a copy is kept, an older save was moved to the Lv 10 rule and refunded, a save from a newer build).
 * Notices queue: the next one opens when the current one closes. Text is set with textContent only (nothing from a
 * save is ever parsed as HTML). The card is a real dialog for keyboard and screen-reader players: role="dialog",
 * focus moves to its first button, Esc presses the last one.
 */
import type { GameContext } from '../core/types';
import { backOut, h, onTap, shield, Slide } from './dom';
import { formatMoney } from './format';
import { ICON_INK } from './iconKit';
import { ICON_COIN, ICON_STAR } from './icons';
import './notice.css';

export interface NoticeButton {
  label: string;
  style?: 'green' | 'grey' | 'gold';
  /** Return false to keep the card open (e.g. a download that should not dismiss it). */
  onTap?: () => boolean | void;
}

export interface Notice {
  icon?: 'coin' | 'star' | 'shield';
  title: string;
  lines: string[];
  /** A big counted-up money amount under the lines (the refund). */
  amount?: number;
  /** Lines under the amount. */
  after?: string[];
  /** Buttons left to right; the last one is the default (Esc / Enter). Default: one "OK". */
  buttons?: NoticeButton[];
}

const ICON_SHIELD = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4l16 6v12c0 10-7 18-16 22C15 40 8 32 8 22V10z" fill="#7fc8ff" stroke="${ICON_INK}" stroke-width="3"/><path d="M16 24l6 6 11-12" fill="none" stroke="${ICON_INK}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export class NoticeCard {
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly slide = new Slide();
  private readonly queue: Notice[] = [];
  private current: Notice | null = null;
  private amountEl: HTMLDivElement | null = null;
  private shown = 0;
  private age = 0;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.backdrop = h('div', 'wl-modal wl-modal-dim');
    this.backdrop.style.display = 'none';
    shield(this.backdrop);
    this.card = h('div', 'wl-card wl-notice');
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.press(this.buttonsOf(this.current).length - 1);
      }
    });
    this.backdrop.appendChild(this.card);
    layer.appendChild(this.backdrop);
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  show(n: Notice): void {
    if (this.current) {
      this.queue.push(n);
      return;
    }
    this.open(n);
  }

  private buttonsOf(n: Notice | null): NoticeButton[] {
    return n?.buttons?.length ? n.buttons : [{ label: 'OK', style: 'green' }];
  }

  private open(n: Notice): void {
    this.current = n;
    this.card.replaceChildren();
    const icon = n.icon === 'coin' ? ICON_COIN : n.icon === 'star' ? ICON_STAR : n.icon === 'shield' ? ICON_SHIELD : '';
    if (icon) this.card.appendChild(h('div', 'wl-notice-icon', icon));
    const title = h('div', 'wl-card-title wl-title');
    title.textContent = n.title;
    title.id = 'wl-notice-title';
    this.card.setAttribute('aria-labelledby', title.id);
    this.card.appendChild(title);
    for (const line of n.lines) {
      const p = h('p', 'wl-notice-line');
      p.textContent = line;
      this.card.appendChild(p);
    }
    this.amountEl = null;
    if (n.amount !== undefined) {
      this.amountEl = h('div', 'wl-offline-amount wl-notice-amount');
      this.amountEl.textContent = formatMoney(0);
      this.card.appendChild(this.amountEl);
    }
    for (const line of n.after ?? []) {
      const p = h('p', 'wl-notice-line');
      p.textContent = line;
      this.card.appendChild(p);
    }
    this.shown = 0;
    this.age = 0;
    const row = h('div', 'wl-btn-row wl-notice-buttons');
    const buttons = this.buttonsOf(n);
    buttons.forEach((b, i) => {
      const el = h('button', `wl-btn wl-btn-${b.style ?? (i === buttons.length - 1 ? 'green' : 'grey')}`);
      el.type = 'button';
      el.textContent = b.label;
      onTap(el, () => this.press(i));
      row.appendChild(el);
    });
    this.card.appendChild(row);
    this.backdrop.style.display = 'flex';
    this.slide.k = 0;
    this.slide.open = true;
    this.ctx.audio.play('chime');
    (row.lastElementChild as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  private press(i: number): void {
    const n = this.current;
    if (!n) return;
    this.ctx.audio.unlock();
    const b = this.buttonsOf(n)[i];
    if (b?.onTap?.() === false) return;
    this.current = null;
    this.slide.open = false;
  }

  update(dt: number): void {
    const s = this.slide;
    if (this.current && this.amountEl && this.current.amount !== undefined && this.shown < this.current.amount) {
      this.age += dt;
      const t = Math.min(1, this.age / 0.9);
      this.shown = Math.round(this.current.amount * (1 - Math.pow(1 - t, 3)));
      this.amountEl.textContent = formatMoney(this.shown);
    }
    if (s.k <= 0 && !s.open) return;
    if (s.step(dt, 0.3) || (s.k > 0 && s.k < 1)) {
      if (s.k <= 0) {
        this.backdrop.style.display = 'none';
        const next = this.queue.shift();
        if (next) this.open(next);
        return;
      }
      const e = s.open ? backOut(Math.min(1, s.k)) : s.k;
      this.backdrop.style.opacity = Math.min(1, s.k * 2).toFixed(2);
      this.card.style.transform = `scale(${(0.6 + 0.4 * e).toFixed(3)})`;
    }
  }
}
