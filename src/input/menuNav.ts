/**
 * [0.9.7 — Comfort] Keyboard (and gamepad) navigation of the HUD's menus, without touching each panel.
 *
 * The HUD's cards and sheets are plain DOM inside `.wl-hud`; their buttons already work with Enter / Space (every tap
 * handler is a 'click'). This module adds what a keyboard or a gamepad still needs:
 * - Which menu is open: the topmost shown `.wl-modal` (Settings, the map, notices, the finale ...), else the shown
 *   era card or bottom sheet (shop, build, choose, manage, market, gate). "Shown" = laid out and not faded out.
 * - Modals take focus as they open (their first button); closing a menu hands the keyboard back to walking.
 *   Bottom sheets open under the player's feet while they walk, so they never steal the arrow keys: Tab (or the
 *   gamepad's D-pad) steps into them.
 * - With focus inside a menu: the arrow keys move it to the nearest control in that direction (a slider keeps
 *   Left / Right for itself), Tab / Shift+Tab cycle inside the menu (focus never escapes to the page behind it).
 *   Those keys are taken in the capture phase, so they never also walk the player.
 * - 0.9.8: a focused scroll box (`.wl-scrollbox`, the changelog) takes Up / Down to scroll until it reaches its end;
 *   with the focus on a control that has nothing further that way, Up / Down scroll the menu's scroll box too.
 * - Accessibility: an open modal gets role="dialog" + aria-modal and the label of its title; the objective banner
 *   and toasts are polite live regions, so screen readers announce the next goal.
 * The pure picking rule (`nextInDirection`) is tested in tests/menuNav.test.ts.
 */

export type NavDir = 'up' | 'down' | 'left' | 'right';

export interface NavBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const ARROWS: Record<string, NavDir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/** Containers that are menus, topmost first by kind: modal cards, then the era card, then the bottom sheets. */
const MODAL = '.wl-modal';
const SHEETS = '.wl-agecard, .wl-shop, .wl-build';

const FOCUSABLE = 'button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Pure: the box to move to from `from` going `dir`, or -1. Only boxes that lie in that direction count. The nearest
 * row (or column) wins first, so Down always lands on the very next row of controls, then the one closest across it;
 * Left / Right stay on the same row when anything is there.
 */
export function nextInDirection(from: NavBox, boxes: readonly NavBox[], dir: NavDir): number {
  const vertical = dir === 'up' || dir === 'down';
  const fwd = dir === 'down' || dir === 'right';
  const cx = (from.left + from.right) / 2;
  const cy = (from.top + from.bottom) / 2;
  const scored: { i: number; main: number; side: number }[] = [];
  boxes.forEach((b, i) => {
    const bx = (b.left + b.right) / 2;
    const by = (b.top + b.bottom) / 2;
    // the centre must move the right way; `main` is the gap along the way (0 when the boxes overlap)
    const moved = vertical ? (fwd ? by - cy : cy - by) : fwd ? bx - cx : cx - bx;
    if (moved <= 1) return;
    const gap = vertical ? (fwd ? b.top - from.bottom : from.top - b.bottom) : fwd ? b.left - from.right : from.left - b.right;
    const side = vertical ? Math.abs(bx - cx) : Math.abs(by - cy);
    // sideways moves stay on the same row when they can (a wide button below is not "to the right")
    const sameLine = vertical ? true : b.top < from.bottom && b.bottom > from.top;
    if (!sameLine && side > moved) return;
    scored.push({ i, main: Math.max(0, gap), side: sameLine ? side : side + 1e4 });
  });
  if (scored.length === 0) return -1;
  if (!vertical && scored.some((s) => s.side < 1e4)) {
    for (let k = scored.length - 1; k >= 0; k--) if (scored[k]!.side >= 1e4) scored.splice(k, 1);
  }
  const near = Math.min(...scored.map((s) => s.main));
  let best = -1;
  let bestSide = Infinity;
  for (const s of scored) {
    if (s.main > near + ROW_SLACK) continue;
    if (s.side < bestSide) {
      bestSide = s.side;
      best = s.i;
    }
  }
  return best;
}

/**
 * Pure (0.9.8): how far Up / Down scrolls a focused scroll box (`.wl-scrollbox`): most of a view at a time, 0 once it
 * is at that end (then the focus moves on to the next control, as usual).
 */
export function scrollStep(top: number, height: number, view: number, dir: 'up' | 'down'): number {
  const max = Math.max(0, height - view);
  const step = Math.max(40, Math.round(view * 0.6));
  if (dir === 'down') return top < max - 1 ? Math.min(step, max - top) : 0;
  return top > 1 ? -Math.min(step, top) : 0;
}

/** Px: boxes this much further than the nearest one still count as the same row. */
const ROW_SLACK = 10;

/** Pure: the index Tab moves to in a list of `n` controls (wraps both ways; -1 = nothing focused yet). */
export function tabIndexAfter(current: number, n: number, back: boolean): number {
  if (n <= 0) return -1;
  if (current < 0) return back ? n - 1 : 0;
  return (current + (back ? -1 : 1) + n) % n;
}

function shown(el: Element): boolean {
  const e = el as HTMLElement;
  if (!e.isConnected || e.getClientRects().length === 0) return false;
  const cs = getComputedStyle(e);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
}

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable) return true;
  return tag === 'INPUT' && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'checkbox';
}

export class MenuNav {
  private lastModal: Element | null = null;
  private acc = 0;

  constructor(private readonly root: ParentNode = document) {
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  /** The open menu the keyboard / gamepad works in now (modal first), or null. */
  current(): HTMLElement | null {
    return this.modal() ?? this.sheet();
  }

  /** True while a modal card (not just a bottom sheet) is open. */
  get modalOpen(): boolean {
    return this.modal() !== null;
  }

  /** True when the focused element sits inside the open menu. */
  get focusInMenu(): boolean {
    const m = this.current();
    const a = document.activeElement;
    return !!m && !!a && a !== document.body && m.contains(a);
  }

  /** Move focus inside the open menu (into it first when it is elsewhere). Returns false with no menu open. */
  move(dir: NavDir): boolean {
    const m = this.current();
    if (!m) return false;
    const items = this.controls(m);
    if (items.length === 0) return false;
    const a = document.activeElement as HTMLElement | null;
    // 0.9.8: a focused scroll box (the changelog, ui/UpdateCard.ts) takes Up / Down until it reaches its end
    if (a && (dir === 'up' || dir === 'down') && m.contains(a) && a.classList.contains('wl-scrollbox')) {
      const step = scrollStep(a.scrollTop, a.scrollHeight, a.clientHeight, dir);
      if (step !== 0) {
        a.scrollTop += step;
        return true;
      }
    }
    const at = a ? items.indexOf(a) : -1;
    if (at < 0) {
      this.focus(items[0]!);
      return true;
    }
    const boxes = items.map((el) => el.getBoundingClientRect());
    const i = nextInDirection(boxes[at]!, boxes.filter((_, k) => k !== at), dir);
    if (i < 0) {
      // at the edge: a scroll box in the menu (the changelog) takes Up / Down, so the arrows read on from the button
      if (dir === 'up' || dir === 'down') {
        const box = m.querySelector<HTMLElement>('.wl-scrollbox');
        const step = box ? scrollStep(box.scrollTop, box.scrollHeight, box.clientHeight, dir) : 0;
        if (box && step !== 0) box.scrollTop += step;
      }
      return true; // still handled, so the player doesn't walk
    }
    this.focus(items.filter((_, k) => k !== at)[i]!);
    return true;
  }

  /** Tab / Shift+Tab inside the open menu. */
  cycle(back: boolean): boolean {
    const m = this.current();
    if (!m) return false;
    const items = this.controls(m);
    const a = document.activeElement as HTMLElement | null;
    const i = tabIndexAfter(a ? items.indexOf(a) : -1, items.length, back);
    if (i < 0) return false;
    this.focus(items[i]!);
    return true;
  }

  /** Press the focused control (gamepad A). Returns false when focus is not in a menu. */
  activate(): boolean {
    if (!this.focusInMenu) return false;
    const a = document.activeElement as HTMLElement;
    if (a instanceof HTMLInputElement && a.type === 'range') return true;
    a.click();
    return true;
  }

  /** Nudge a focused slider one step (gamepad Left / Right). Returns false when focus is not on a slider. */
  nudgeSlider(dir: -1 | 1): boolean {
    const a = document.activeElement;
    if (!(a instanceof HTMLInputElement) || a.type !== 'range' || !this.focusInMenu) return false;
    if (dir > 0) a.stepUp(1);
    else a.stepDown(1);
    a.dispatchEvent(new Event('input', { bubbles: true }));
    a.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /** Per frame (cheap: a DOM pass 10 times a second): focus modals as they open, let go of menus that closed. */
  update(dt: number): void {
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    const modal = this.modal();
    if (modal !== this.lastModal) {
      this.lastModal = modal;
      if (modal) {
        labelDialog(modal);
        const a = document.activeElement;
        if (!a || !modal.contains(a)) {
          // the first real choice (not the corner X, which Enter would then close by accident)
          const items = this.controls(modal);
          // (the selected tab when the card has tabs)
          const first = items.find((el) => el.getAttribute('aria-selected') === 'true') ?? items.find((el) => !el.classList.contains('wl-card-x')) ?? items[0];
          if (first) this.focus(first);
        }
      }
    }
    // focus left on a control that has gone (its menu closed): give the keyboard back to the game
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && this.root instanceof Node && (this.root as Node).contains(a) && !shown(a)) a.blur();
  }

  // --- internals --------------------------------------------------------------
  private modal(): HTMLElement | null {
    const all = Array.from(this.root.querySelectorAll<HTMLElement>(MODAL)).filter(shown);
    if (all.length === 0) return null;
    // the highest z-index wins, then the later one in the page
    let best = all[0]!;
    let bestZ = zOf(best);
    for (const el of all.slice(1)) {
      const z = zOf(el);
      if (z >= bestZ) {
        best = el;
        bestZ = z;
      }
    }
    return best;
  }

  private sheet(): HTMLElement | null {
    const all = Array.from(this.root.querySelectorAll<HTMLElement>(SHEETS)).filter(shown);
    return all[all.length - 1] ?? null;
  }

  private controls(m: HTMLElement): HTMLElement[] {
    return Array.from(m.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => shown(el) && !el.closest('[aria-hidden="true"]'));
  }

  private focus(el: HTMLElement): void {
    try {
      el.focus({ preventScroll: false, focusVisible: true } as FocusOptions);
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    } catch {
      el.focus();
    }
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target instanceof Element ? e.target : null;
    if (isTypingTarget(target)) return;
    if (e.key === 'Tab') {
      // Tab steps into an open menu (a sheet too) and never out of it
      if (this.cycle(e.shiftKey)) e.preventDefault();
      return;
    }
    const dir = ARROWS[e.code] ?? ARROWS[e.key];
    if (!dir) return;
    const inMenu = this.focusInMenu;
    // a modal takes the arrows even before anything in it has focus; a sheet only once Tab stepped into it
    if (!inMenu && !this.modalOpen) return;
    // a slider keeps Left / Right for its own value
    if (inMenu && target instanceof HTMLInputElement && target.type === 'range' && (dir === 'left' || dir === 'right')) {
      e.stopPropagation();
      return;
    }
    if (this.move(dir)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
}

function zOf(el: HTMLElement): number {
  const z = Number(getComputedStyle(el).zIndex);
  return Number.isFinite(z) ? z : 0;
}

/** role="dialog" + aria-modal + a label from the card's title, once per modal. */
function labelDialog(modal: HTMLElement): void {
  if (modal.getAttribute('role') === 'dialog') return;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const title = modal.querySelector('.wl-card-title, [class*="-title"]');
  const text = title?.textContent?.trim();
  if (text) modal.setAttribute('aria-label', text);
}

/** The objective banner and toasts announce themselves to screen readers (polite: never interrupting). */
export function markLiveRegions(root: ParentNode = document): void {
  for (const sel of ['.wl-objective', '.wl-toast']) {
    const el = root.querySelector(sel);
    if (el && !el.hasAttribute('aria-live')) {
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('role', 'status');
    }
  }
}
