/**
 * [B4] Welcome-back card: "While you were away (1 h 20 min) your mill earned $X" with a big button. The money is
 * ALREADY credited (and saved) by Game when the card is shown, so the card is informational: the button just closes
 * it and calls onCollect() exactly once (Game emits 'offline:collected' there; the cash burst is the JuiceDirector's
 * reaction to that event).
 */
import type { GameContext } from '../core/types';
import { backOut, h, onTap, shield, Slide } from './dom';
import { formatDuration, formatMoney } from './format';
import { ICON_COIN } from './icons';

export class OfflineCard {
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly amountEl: HTMLDivElement;
  private readonly slide = new Slide();
  private onCollect: (() => void) | null = null;
  private shownAmount = 0;
  private wantAmount = 0;
  private age = 0;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.backdrop = h('div', 'wl-modal wl-modal-dim');
    this.backdrop.style.display = 'none';
    shield(this.backdrop);

    this.card = h('div', 'wl-card wl-offline');
    this.card.appendChild(h('div', 'wl-offline-coin', ICON_COIN));
    this.card.appendChild(h('div', 'wl-card-title wl-outline', 'Welcome back!'));
    this.sub = h('div', 'wl-offline-sub');
    this.card.appendChild(this.sub);
    this.card.appendChild(h('div', 'wl-offline-label', 'your mill earned'));
    this.amountEl = h('div', 'wl-offline-amount');
    this.card.appendChild(this.amountEl);
    const btn = h('button', 'wl-btn wl-btn-big wl-btn-green', 'Great!');
    btn.type = 'button';
    onTap(btn, () => this.collect());
    this.card.appendChild(btn);
    this.backdrop.appendChild(this.card);
    layer.appendChild(this.backdrop);
  }

  show(amount: number, seconds: number, onCollect: () => void): void {
    // a second card while one is waiting: close the old one first (its callback fires exactly once)
    if (this.onCollect) this.collect();
    this.onCollect = onCollect;
    this.wantAmount = Math.max(0, Math.round(amount));
    this.shownAmount = 0;
    this.age = 0;
    this.sub.textContent = `While you were away (${formatDuration(seconds)})`;
    this.amountEl.textContent = formatMoney(0);
    this.backdrop.style.display = 'flex';
    this.slide.k = 0;
    this.slide.open = true;
    this.ctx.audio.play('chime');
  }

  private collect(): void {
    const fn = this.onCollect;
    if (!fn) return;
    this.onCollect = null; // exactly once
    this.ctx.audio.unlock();
    this.slide.open = false;
    fn();
  }

  update(dt: number): void {
    const s = this.slide;
    if (s.k <= 0 && !s.open) return;
    // the earned amount counts up while the card pops in
    if (s.open && this.shownAmount < this.wantAmount) {
      this.age += dt;
      const t = Math.min(1, this.age / 0.9);
      this.shownAmount = Math.round(this.wantAmount * (1 - Math.pow(1 - t, 3)));
      this.amountEl.textContent = formatMoney(this.shownAmount);
    }
    if (s.step(dt, 0.3) || (s.k > 0 && s.k < 1)) {
      if (s.k <= 0) {
        this.backdrop.style.display = 'none';
        return;
      }
      const e = s.open ? backOut(Math.min(1, s.k)) : s.k;
      this.backdrop.style.opacity = Math.min(1, s.k * 2).toFixed(2);
      this.card.style.transform = `scale(${(0.6 + 0.4 * e).toFixed(3)})`;
    }
  }
}
