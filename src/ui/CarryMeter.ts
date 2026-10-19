/**
 * [0.9.3] Carry meter: a small pill in the bottom-left corner, "3 / 8" with a little fill bar, showing how many things
 * the player's arms hold out of how many they can hold (ctx.player.arms: landed + reserved items, live capacity from
 * the carry upgrade and the dog). Full arms turn the pill honey-gold with a "Full" tag.
 * - Never catches taps (pointer-events: none), so it can't get in the way of the floating joystick.
 * - The pill pops gently when the count goes up, driven from update(dt) like the money pill; with Reduce motion on it
 *   holds still. The DOM is only touched when the numbers change.
 * - Sits above the FPS readout when that is on; on phones it steps aside while a bottom sheet is open (hud.css).
 * - 0.9.11 (Dino: "it only shows the count of carrying logs"): the icon is what the arms actually hold. One kind shows
 *   that item's picture; several kinds show a small chip per kind (picture + count, the newest first, up to
 *   MAX_CHIPS) before the total; empty arms keep the carry-upgrade picture.
 */
import { reducedMotion } from '../fx/comfort';
import type { GameContext } from '../core/types';
import { h } from './dom';
import { upgradeIcon } from './icons';
import { materialIcon, materialLabel } from './materialIcons';
import type { ItemKind } from '../core/types';

/** Kinds shown as chips at most; the rest fold into the last chip's "+". */
export const MAX_CHIPS = 3;

export interface CarryView {
  /** "3 / 8" */
  text: string;
  /** 0..1 fill of the bar. */
  fill: number;
  full: boolean;
  /** Screen-reader / tooltip line. */
  label: string;
  /** 0.9.11: what is held, newest kind first (empty arms: none). */
  kinds: { kind: ItemKind; count: number }[];
}

/** What the meter shows for `size` items out of `capacity`, `kinds` held per kind (pure, for tests). */
export function carryView(size: number, capacity: number, kinds: readonly (readonly [ItemKind, number])[] = []): CarryView {
  const cap = Math.max(0, Math.floor(capacity));
  const n = Math.max(0, Math.floor(size));
  const full = cap > 0 && n >= cap;
  const held = kinds.filter(([, c]) => c > 0).map(([kind, count]) => ({ kind, count }));
  const what = held.map((k) => `${k.count} ${materialLabel(k.kind)}`).join(', ');
  const base = what ? `Carrying ${what} (${n} of ${cap})` : `Carrying ${n} of ${cap}`;
  return {
    text: `${n} / ${cap}`,
    fill: cap > 0 ? Math.min(1, n / cap) : 0,
    full,
    label: full ? `${base}: arms full` : base,
    kinds: held,
  };
}

export class CarryMeter {
  private readonly root: HTMLDivElement;
  private readonly value: HTMLSpanElement;
  private readonly bar: HTMLSpanElement;
  private readonly icon: HTMLElement;
  private readonly chips: HTMLSpanElement;
  private lastSize = -1;
  private lastCap = -1;
  /** "kind:count|..." of the last paint (a change of kinds repaints even when the total holds). */
  private lastKinds = '';
  /** Kind shown by the main icon ('' = the carry-upgrade picture). */
  private iconKind: string | null = null;
  private bump = 0;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.root = h('div', 'wl-carry');
    this.root.setAttribute('role', 'img');
    this.icon = h('i', 'wl-carry-icon');
    this.chips = h('span', 'wl-carry-chips');
    this.root.append(this.icon, this.chips);
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
    const kinds = arms.kindCounts();
    const key = kinds.map(([k, c]) => `${k}:${c}`).join('|');
    if (size !== this.lastSize || cap !== this.lastCap || key !== this.lastKinds) {
      if (this.lastSize >= 0 && size > this.lastSize && !reducedMotion()) this.bump = 1;
      this.lastSize = size;
      this.lastCap = cap;
      this.lastKinds = key;
      const v = carryView(size, cap, kinds);
      this.paintKinds(v);
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

  /** The main icon (one kind, or empty arms) or a chip per kind (several). */
  private paintKinds(v: CarryView): void {
    const single = v.kinds.length <= 1;
    const want: string | null = single ? (v.kinds[0]?.kind ?? '') : null;
    this.root.classList.toggle('is-mixed', !single);
    if (want !== this.iconKind) {
      this.iconKind = want;
      if (want !== null) this.icon.innerHTML = want === '' ? upgradeIcon('carry') : materialIcon(want as ItemKind);
    }
    if (single) {
      this.chips.replaceChildren();
      return;
    }
    const shown = v.kinds.slice(0, MAX_CHIPS);
    const rest = v.kinds.slice(MAX_CHIPS).reduce((a, k) => a + k.count, 0);
    this.chips.replaceChildren(
      ...shown.map((k, i) => {
        const chip = h('span', 'wl-carry-chip');
        const pic = h('i', 'wl-carry-chip-icon');
        pic.innerHTML = materialIcon(k.kind);
        const extra = i === shown.length - 1 && rest > 0 ? `+${rest}` : '';
        chip.append(pic, h('span', 'wl-carry-chip-n', `${k.count}${extra ? ` ${extra}` : ''}`));
        return chip;
      }),
    );
  }
}
