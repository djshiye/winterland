/**
 * Wave 10b: the "Hold to pick up" / "Hold to pay" chip. A small pill above the player (the followed player always sits
 * at the screen centre, so a fixed spot over their head is enough: bottom 50% + 70 px) that shows while 'interact:prompt' says the player stands in a gated
 * zone with something to take or pay. Fine pointers get a keycap `E` (`A` with a gamepad, 0.9.7), touch gets a press icon. It fades / scales in 150 ms
 * from update(dt) (simulation time) and never shows while a modal (settings / shop / build) is open. pointer-events: none.
 */
import type { GameContext } from '../core/types';
import { usingGamepad } from '../input/Gamepad';
import { h } from './dom';

const FADE = 0.15;

const ICON_PRESS = `<svg class="wl-chip-press" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8" opacity="0.5"/>
  <circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="currentColor" stroke-width="1.8"/>
</svg>`;

export class InteractChip {
  readonly el: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  /** 0.9.13 (review U5): zones currently prompting; the chip stays up while any is (was one on/off flag). */
  private zones = 0;
  private kind: 'take' | 'pay' = 'take';
  private k = 0;

  constructor(
    ctx: GameContext,
    layer: HTMLElement,
    private readonly modalOpen: () => boolean,
    coarse = InteractChip.isCoarse(),
  ) {
    this.el = h('div', 'wl-chip');
    this.el.style.display = 'none';
    // 0.9.12: read out politely (it was hidden, so screen-reader players never heard there was something to pick up)
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = coarse ? ICON_PRESS : '<span class="wl-chip-key">E</span>';
    this.text = h('span', 'wl-chip-text');
    this.el.appendChild(this.text);
    this.paintText();
    layer.appendChild(this.el);
    ctx.events.on('interact:prompt', (e) => this.set(e.on, e.kind));
  }

  private static isCoarse(): boolean {
    try {
      return window.matchMedia('(pointer: coarse)').matches;
    } catch {
      return false;
    }
  }

  /** True while the chip is on screen (or fading). */
  get visible(): boolean {
    return this.k > 0;
  }

  set(on: boolean, kind: 'take' | 'pay'): void {
    this.zones = Math.max(0, this.zones + (on ? 1 : -1));
    if (on) {
      this.kind = kind;
      this.paintText();
    }
  }

  private paintText(): void {
    // 0.9.7: the keycap says A while the player plays with a gamepad
    const key = this.el.querySelector('.wl-chip-key');
    if (key) key.textContent = usingGamepad() ? 'A' : 'E';
    this.text.textContent = this.kind === 'pay' ? 'Hold to pay' : 'Hold to pick up';
  }

  update(dt: number): void {
    const want = this.zones > 0 && !this.modalOpen();
    const k = Math.max(0, Math.min(1, this.k + (want ? dt : -dt) / FADE));
    if (k === this.k) return;
    this.k = k;
    if (k <= 0) {
      this.el.style.display = 'none';
      return;
    }
    const e = 1 - Math.pow(1 - k, 3);
    this.el.style.display = 'flex';
    this.el.style.opacity = k.toFixed(3);
    this.el.style.transform = `translate(-50%, 0) scale(${(0.8 + 0.2 * e).toFixed(3)})`;
  }
}
