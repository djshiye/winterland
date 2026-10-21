/**
 * [B4] Welcome-back card: "While you were away (1 h 20 min) you earned $X" with a big button. The money is
 * ALREADY credited (and saved) by Game when the card is shown, so the card is informational: the button just closes
 * it and calls onCollect() exactly once (Game emits 'offline:collected' there; the cash burst is the JuiceDirector's
 * reaction to that event).
 */
import type { GameContext } from '../core/types';
import { backOut, h, onTap, shield, Slide } from './dom';
import { formatDuration, formatMoney } from './format';
import { ICON_COIN } from './icons';

/** "3 h 10 min", or whole days past a day ("2 days"), so a long break never reads "52 h 13 min". */
function awayText(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  return days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : formatDuration(seconds);
}

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
    this.card.appendChild(h('div', 'wl-card-title wl-title', 'Welcome back!'));
    this.sub = h('div', 'wl-offline-sub');
    this.card.appendChild(this.sub);
    this.card.appendChild(h('div', 'wl-offline-label', 'you earned'));
    this.amountEl = h('div', 'wl-offline-amount');
    this.card.appendChild(this.amountEl);
    const btn = h('button', 'wl-btn wl-btn-big wl-btn-green', 'Great!');
    btn.type = 'button';
    onTap(btn, () => this.collect());
    this.card.appendChild(btn);
    this.backdrop.appendChild(this.card);
    layer.appendChild(this.backdrop);
  }

  /** `seconds` is the time that counted (capped at OFFLINE.maxSeconds), `away` the real absence (0.9.12, S2). */
  show(amount: number, seconds: number, onCollect: () => void, away = seconds): void {
    // a second card while one is waiting: close the old one first (its callback fires exactly once)
    if (this.onCollect) this.collect();
    this.onCollect = onCollect;
    this.wantAmount = Math.max(0, Math.round(amount));
    this.shownAmount = 0;
    this.age = 0;
    // 0.9.12 (S2): away 3 h used to read "(2 h)"; say the real time and that only the first part counts
    this.sub.textContent =
      away - seconds >= 60 ? `You were away ${awayText(away)}.\nThe first ${formatDuration(seconds)} count.` : `While you were away (${formatDuration(seconds)})`;
    this.amountEl.textContent = formatMoney(0);
    this.backdrop.style.display = 'flex';
    this.slide.k = 0;
    this.slide.open = true;
    this.ctx.audio.play('chime');
  }

  /** True while the card waits for its button. */
  get isOpen(): boolean {
    return this.onCollect !== null;
  }

  /** 0.9.13 (B4): Esc / gamepad B press the card's only button, like every other card. */
  escape(): void {
    this.collect();
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
