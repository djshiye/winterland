/**
 * [Wave 13] World event banner: the kind's label + hint + a countdown read from ctx.worldEvents.remaining. Shown on
 * 'event:start', hidden on 'event:end'. Same pop / fade / heartbeat as the RushBanner (simulation time; the clock text
 * is only rewritten when the whole second changes). It takes the rush banner's spot, and steps one slot further away
 * from the screen edge (class `is-stacked`, see hud.css) while the rush banner is showing, so both can be read at once.
 */
import { EVENTS, type EventKind } from '../config';
import type { GameContext } from '../core/types';
import { backOut, h } from './dom';

export class EventBanner {
  private readonly root: HTMLDivElement;
  private readonly icon: HTMLElement;
  private readonly title: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly clock: HTMLSpanElement;
  private k = 0;
  private want = false;
  private pulse = 0;
  private lastSecs = -1;
  private kind: EventKind | null = null;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
    /** True while the rush banner is on screen (so this one stacks beside it). */
    private readonly rushVisible: () => boolean,
  ) {
    this.root = h('div', 'wl-event');
    const text = h('div', 'wl-event-text');
    this.title = h('div', 'wl-event-title wl-outline');
    this.sub = h('div', 'wl-event-sub');
    text.append(this.title, this.sub);
    this.icon = h('i', 'wl-event-icon');
    this.clock = h('span', 'wl-event-clock', '0:00');
    this.root.append(this.icon, text, this.clock);
    this.root.style.display = 'none';
    layer.appendChild(this.root);
    ctx.events.on('event:start', (e) => {
      this.show(e.kind);
      this.pulse = 0;
      this.lastSecs = -1;
    });
    ctx.events.on('event:end', () => {
      this.want = false;
    });
    if (ctx.worldEvents.active) this.show(ctx.worldEvents.active);
  }

  get visible(): boolean {
    return this.k > 0;
  }

  private show(kind: EventKind): void {
    this.want = true;
    if (kind === this.kind) return;
    this.kind = kind;
    this.root.dataset.kind = kind;
    this.icon.innerHTML = ICONS[kind];
    this.title.textContent = EVENTS.kinds[kind].label;
    this.sub.textContent = EVENTS.kinds[kind].hint;
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
    this.root.classList.toggle('is-stacked', this.rushVisible());
    const secs = Math.max(0, Math.ceil(this.ctx.worldEvents.remaining));
    if (this.want && secs !== this.lastSecs) {
      this.lastSecs = secs;
      this.clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    }
    this.pulse += dt;
    const e = this.want ? backOut(this.k) : this.k;
    const beat = this.want ? 1 + 0.02 * Math.sin(this.pulse * (secs <= 5 ? 9 : 3)) : 1;
    this.root.style.opacity = Math.min(1, this.k * 2).toFixed(2);
    this.root.style.setProperty('--event-s', ((0.75 + 0.25 * e) * beat).toFixed(3));
  }
}

const ICONS: Record<EventKind, string> = {
  snowstorm: `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round">
  <path d="M24 6v36M8.4 15l31.2 18M8.4 33l31.2-18"/>
  <path d="M19 9l5 4 5-4M19 39l5-4 5 4M6 21l7-1-1-7M42 27l-7 1 1 7M6 27l7 1-1 7M42 21l-7-1 1-7" stroke-width="2.5"/>
</svg>`,
  festival: `<svg viewBox="0 0 48 48" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 42L18 16l14 14z" fill="#ffd84a" stroke="#7a3b0c" stroke-width="3"/>
  <path d="M13 30l10 4M10.5 37l9 3" stroke="#e8483a" stroke-width="3" fill="none"/>
  <path d="M28 8l1 5M38 14l-4 3M40 26l-5-1" stroke="#fff" stroke-width="3" fill="none"/>
  <circle cx="34" cy="8" r="2.5" fill="#ff7ab8"/><circle cx="41" cy="19" r="2.5" fill="#7ad7ff"/><circle cx="25" cy="18" r="2" fill="#fff"/>
</svg>`,
  aurora: `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke-linecap="round">
  <path d="M6 38C10 14 18 10 22 26s10 6 12-14" stroke="#7dffb0" stroke-width="5" opacity="0.95"/>
  <path d="M14 40C18 22 26 18 28 30s8 2 10-12" stroke="#b58bff" stroke-width="4" opacity="0.9"/>
  <path d="M40 8l1.2 3 3 1.2-3 1.2L40 16l-1.2-3-3-1.2 3-1.2z" fill="#fff" stroke="none"/>
</svg>`,
};
