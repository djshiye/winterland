/**
 * [B4] Onboarding "drag to move" hand (wave 8). Right after 'intro:done' in a game that has not shown it before
 * (state.flags['seen:moveHand']), an animated hand presses, swipes and lifts near the bottom centre, leaving a fading
 * swipe trail; desktop (hover + fine pointer) also gets a "WASD / arrow keys" caption, touch gets "Drag to move".
 * It goes away once the player has walked about 2 m or after 8 s, whichever comes first, and the flag is set the moment
 * it appears so it never returns (also not after a reload). Everything is driven from update(dt) on simulation time.
 * 0.9.10 (READINESS C6): it steps aside while a card (the era postcard, the settlement card, a notice, the update card)
 * is on screen, and its 8 s wait pauses meanwhile, so the hint and a card never overlap.
 */
import type { GameContext } from '../core/types';
import { h } from './dom';
import { ICON_INK } from './iconKit';

const FLAG = 'seen:moveHand' as const;
const MOVE_DONE = 2;
const MAX_TIME = 8;
const CYCLE = 1.9;
const TRAIL = 9;
/** Swipe path in px relative to the start point (up and to the right: the iso "forward"). */
const DX = 74;
const DY = -62;
/** The cards the hint steps aside for (any shown dialog, plus the settlement card, which is not one). */
const CARDS = '[role="dialog"], .wl-era';

const HAND = `<svg viewBox="0 0 56 64" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">
  <g stroke="${ICON_INK}" stroke-width="3" fill="#fff">
    <rect x="19" y="3" width="13" height="32" rx="6.5"/>
    <path d="M12 30c0-3 2-5 5-5h20c8 0 13 6 13 14v10c0 8-6 14-14 14H26c-6 0-10-3-13-8l-6-10c-1.600-2.700 1.500-5.600 4.300-3.800L12 40z"/>
  </g>
  <path d="M30 34v10M38 34v10" stroke="#c9d6ee" stroke-width="2.4" fill="none"/>
</svg>`;

export class MoveHand {
  private readonly root: HTMLDivElement;
  private readonly hand: HTMLDivElement;
  private readonly dots: HTMLElement[] = [];
  private readonly caption: HTMLDivElement;
  private active = false;
  private age = 0;
  private walked = 0;
  private leaving = 0;
  private readonly last = { x: 0, z: 0 };
  private readonly desktop: boolean;
  private covered = false;

  constructor(
    private readonly ctx: GameContext,
    private readonly layer: HTMLElement,
  ) {
    let desktop = false;
    try {
      desktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch {
      /* no matchMedia */
    }
    this.desktop = desktop;
    this.root = h('div', 'wl-hand');
    this.root.style.display = 'none';
    const track = h('div', 'wl-hand-track');
    for (let i = 0; i < TRAIL; i++) {
      const d = h('i', 'wl-hand-dot');
      this.dots.push(d);
      track.appendChild(d);
    }
    this.hand = h('div', 'wl-hand-hand', HAND);
    track.appendChild(this.hand);
    this.caption = h('div', 'wl-hand-caption wl-outline');
    this.caption.innerHTML = desktop
      ? `<span class="wl-keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span> or arrow keys to move`
      : 'Drag to move';
    this.root.append(track, this.caption);
    layer.appendChild(this.root);
    ctx.events.on('intro:done', () => this.begin());
  }

  get visible(): boolean {
    return this.active;
  }

  /** Show the hand now (also called by 'intro:done'); a no-op when it has been shown before. */
  begin(): void {
    const flags = this.ctx.state.flags;
    if (flags[FLAG] || this.active) return;
    flags[FLAG] = true;
    this.active = true;
    this.age = 0;
    this.walked = 0;
    this.leaving = 0;
    this.last.x = this.ctx.player.position.x;
    this.last.z = this.ctx.player.position.z;
    this.root.style.display = '';
    this.root.style.opacity = '0';
    // desktop: the keys line is the real instruction, the hand shows the mouse-drag alternative
    this.root.classList.toggle('is-desktop', this.desktop);
  }

  /** True while a card is on screen in the HUD layer (checked only while the hint runs). */
  private cardUp(): boolean {
    for (const el of this.layer.querySelectorAll<HTMLElement>(CARDS)) if (el !== this.root && el.getClientRects().length > 0) return true;
    return false;
  }

  update(dt: number): void {
    if (!this.active) return;
    const p = this.ctx.player.position;
    this.walked += Math.hypot(p.x - this.last.x, p.z - this.last.z);
    this.last.x = p.x;
    this.last.z = p.z;
    const covered = this.cardUp();
    if (covered !== this.covered) {
      this.covered = covered;
      this.root.style.visibility = covered ? 'hidden' : '';
    }
    if (covered) return; // the wait pauses under a card
    this.age += dt;
    if (this.leaving === 0 && (this.walked >= MOVE_DONE || this.age >= MAX_TIME)) this.leaving = 1e-6;
    let fade = Math.min(1, this.age / 0.35);
    if (this.leaving > 0) {
      this.leaving += dt;
      fade = Math.max(0, 1 - this.leaving / 0.3);
      if (fade <= 0) {
        this.active = false;
        this.root.style.display = 'none';
        return;
      }
    }
    this.root.style.opacity = fade.toFixed(2);

    // one cycle: press (0..0.18), drag (0.18..0.68), lift + rest (0.68..1)
    const c = (this.age % CYCLE) / CYCLE;
    const drag = c < 0.18 ? 0 : c > 0.68 ? 1 : (c - 0.18) / 0.5;
    const e = drag * drag * (3 - 2 * drag);
    const x = DX * e;
    const y = DY * e;
    const down = c < 0.74;
    const press = c < 0.18 ? c / 0.18 : down ? 1 : Math.max(0, 1 - (c - 0.74) / 0.12);
    const handFade = c > 0.9 ? 1 - (c - 0.9) / 0.1 : c < 0.06 ? c / 0.06 : 1;
    this.hand.style.opacity = handFade.toFixed(2);
    this.hand.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-30%, -12%) scale(${(1 - 0.12 * press).toFixed(3)})`;
    // trail: dots along the path up to the finger, brightest at the finger
    for (let i = 0; i < TRAIL; i++) {
      const f = (i + 1) / TRAIL;
      const te = Math.min(e, 1) * f;
      const on = down && c >= 0.18 ? 1 : c < 0.9 && c >= 0.18 ? Math.max(0, 1 - (c - 0.68) / 0.22) : 0;
      const d = this.dots[i]!;
      d.style.opacity = (on * f * 0.85).toFixed(2);
      d.style.transform = `translate3d(${(DX * te).toFixed(1)}px, ${(DY * te).toFixed(1)}px, 0) translate(-50%, -50%) scale(${(0.4 + 0.7 * f).toFixed(2)})`;
    }
  }
}
