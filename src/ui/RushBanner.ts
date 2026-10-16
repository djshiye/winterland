/**
 * [B4] Rush hour banner (wave 8): "RUSH HOUR! Customers are flooding in" with a countdown read from
 * ctx.rush.remaining. Shown on 'rush:start', hidden on 'rush:end'. Pops in / fades on simulation time; the text is
 * only rewritten when the whole second changes. Placement (hud.css): under the objective banner on wider screens, a
 * bottom-centre pill on phones; fits 800x450 and 390x844.
 */
import type { GameContext } from '../core/types';
import { steadyHighlights } from '../fx/comfort';
import { backOut, h } from './dom';

export class RushBanner {
  private readonly root: HTMLDivElement;
  private readonly clock: HTMLSpanElement;
  private k = 0;
  private want = false;
  private pulse = 0;
  private lastSecs = -1;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.root = h('div', 'wl-rush');
    const text = h('div', 'wl-rush-text');
    text.append(h('div', 'wl-rush-title wl-outline', 'RUSH HOUR!'), h('div', 'wl-rush-sub', 'Customers are flooding in'));
    this.clock = h('span', 'wl-rush-clock', '0:00');
    this.root.append(h('i', 'wl-rush-bell', BELL), text, this.clock);
    this.root.style.display = 'none';
    layer.appendChild(this.root);
    ctx.events.on('rush:start', () => {
      this.want = true;
      this.pulse = 0;
      this.lastSecs = -1;
    });
    ctx.events.on('rush:end', () => {
      this.want = false;
    });
    if (ctx.rush.active) this.want = true;
  }

  get visible(): boolean {
    return this.k > 0;
  }

  update(dt: number): void {
    const target = this.want ? 1 : 0;
    if (this.k === target && !this.want) return;
    this.k = this.want ? Math.min(1, this.k + dt / 0.35) : Math.max(0, this.k - dt / 0.3);
    if (this.k <= 0) {
      this.root.style.display = 'none';
      return;
    }
    this.root.style.display = '';
    const secs = Math.max(0, Math.ceil(this.ctx.rush.remaining));
    if (secs !== this.lastSecs) {
      this.lastSecs = secs;
      this.clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    }
    this.pulse += dt;
    const e = this.want ? backOut(this.k) : this.k;
    // a gentle heartbeat while it lasts, faster for the last 5 s
    const beat = this.want && !steadyHighlights() ? 1 + 0.025 * Math.sin(this.pulse * (secs <= 5 ? 9 : 4.5)) : 1;
    this.root.style.opacity = Math.min(1, this.k * 2).toFixed(2);
    this.root.style.setProperty('--rush-s', ((0.75 + 0.25 * e) * beat).toFixed(3));
    this.root.classList.toggle('is-low', this.want && secs <= 5);
  }
}

const BELL = `<svg viewBox="0 0 48 48" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 33c3-3 4-7 4-13a10 10 0 0 1 20 0c0 6 1 10 4 13z" fill="#ffd84a" stroke="#7a3b0c" stroke-width="3"/>
  <circle cx="24" cy="38" r="4" fill="#e8a21c" stroke="#7a3b0c" stroke-width="2.5"/>
  <path d="M24 6v4" stroke="#7a3b0c" stroke-width="3"/>
</svg>`;
