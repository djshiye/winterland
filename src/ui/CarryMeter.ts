/**
 * [0.9.3] Carry meter: a small pill in the bottom-left corner, "3 / 8" with a little fill bar, showing how many things
 * the player's arms hold out of how many they can hold (ctx.player.arms: landed + reserved items, live capacity from
 * the carry upgrade and the dog). Full arms turn the pill honey-gold with a "Full" tag.
 * - Never catches taps (pointer-events: none), so it can't get in the way of the floating joystick.
 * - The pill pops gently when the count goes up, driven from update(dt) like the money pill; with Reduce motion on it
 *   holds still. The DOM is only touched when the numbers change.
 * - Sits above the FPS readout when that is on; on phones it steps aside while a bottom sheet is open (hud.css).
 */
import { reducedMotion } from '../fx/comfort';
import type { GameContext } from '../core/types';
import { h } from './dom';
import { upgradeIcon } from './icons';

export interface CarryView {
  /** "3 / 8" */
  text: string;
  /** 0..1 fill of the bar. */
  fill: number;
  full: boolean;
  /** Screen-reader / tooltip line. */
  label: string;
}

/** What the meter shows for `size` items out of `capacity` (pure, for tests). */
export function carryView(size: number, capacity: number): CarryView {
  const cap = Math.max(0, Math.floor(capacity));
  const n = Math.max(0, Math.floor(size));
  const full = cap > 0 && n >= cap;
  return {
    text: `${n} / ${cap}`,
    fill: cap > 0 ? Math.min(1, n / cap) : 0,
    full,
    label: full ? `Carrying ${n} of ${cap}: arms full` : `Carrying ${n} of ${cap}`,
  };
}

export class CarryMeter {
  private readonly root: HTMLDivElement;
  private readonly value: HTMLSpanElement;
  private readonly bar: HTMLSpanElement;
  private lastSize = -1;
  private lastCap = -1;
  private bump = 0;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.root = h('div', 'wl-carry');
    this.root.setAttribute('role', 'img');
    this.root.appendChild(h('i', 'wl-carry-icon', upgradeIcon('carry')));
    const body = h('span', 'wl-carry-body');
    this.value = h('span', 'wl-carry-value');
    const track = h('span', 'wl-carry-track');
    this.bar = h('span', 'wl-carry-bar');
    track.appendChild(this.bar);
    body.append(this.value, track);
    this.root.append(body, h('span', 'wl-carry-full', 'Full'));
    layer.appendChild(this.root);
  }

  update(dt: number): void {
    const arms = this.ctx.player.arms;
    const size = arms.size;
    const cap = arms.capacity;
    if (size !== this.lastSize || cap !== this.lastCap) {
      if (this.lastSize >= 0 && size > this.lastSize && !reducedMotion()) this.bump = 1;
      this.lastSize = size;
      this.lastCap = cap;
      const v = carryView(size, cap);
      this.value.textContent = v.text;
      this.bar.style.transform = `scaleX(${v.fill.toFixed(3)})`;
      this.root.classList.toggle('is-full', v.full);
      this.root.title = v.label;
      this.root.setAttribute('aria-label', v.label);
    }
    if (this.bump > 0) {
      this.bump = reducedMotion() ? 0 : Math.max(0, this.bump - dt / 0.28);
      const s = 1 + 0.12 * Math.sin(Math.PI * (1 - this.bump));
      this.root.style.transform = this.bump > 0 ? `scale(${s.toFixed(3)})` : '';
    }
  }
}
