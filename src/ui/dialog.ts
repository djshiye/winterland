/**
 * [0.9.10 — D5] Small helpers that make a HUD card a real dialog for keyboard and screen-reader players (the NoticeCard
 * pattern, shared): role="dialog" + aria-modal + a label from the card's title, Tab kept inside the card, and focus
 * handed back when it closes.
 * - Tab: input/menuNav.ts already cycles Tab through the open menu (capture phase, preventDefault). trapTab is the
 *   card's own fallback, so it only acts on a Tab nobody handled yet.
 * - Focus back: only to a control the player reached with the keyboard (it had :focus-visible) that is still on
 *   screen. After a mouse click the opener (the gear) keeps no focus, because a focused button would also take the
 *   Space key, which picks up and pays.
 * The pure rules (returnFocusTo, tabStep) are tested in tests/menus0910.test.ts.
 */

const FOCUSABLE = 'button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Make `el` a labelled modal dialog (its title element gets `id`). */
export function markDialog(el: HTMLElement, title: HTMLElement, id: string): void {
  title.id = id;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', id);
}

/**
 * 0.9.12: name a bottom sheet / side card (build, choose, manage, gate, market) for screen readers. Not modal: these
 * open under the player's feet while they keep walking, so they never trap the focus.
 */
export function markPanel(el: HTMLElement, title: HTMLElement, id: string): void {
  title.id = id;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', id);
}

/** 0.9.12: the card's body text describes it (a screen reader then reads more than the title). */
export function describeBy(el: HTMLElement, parts: readonly HTMLElement[], prefix: string): void {
  const ids = parts.map((p, i) => {
    if (!p.id) p.id = `${prefix}-${i}`;
    return p.id;
  });
  el.setAttribute('aria-describedby', ids.join(' '));
}

/** What had the focus before a dialog opened, as the pure rule sees it. */
export interface FocusFrom {
  /** Still in the page and laid out. */
  shown: boolean;
  /** It was reached with the keyboard or a pad (it showed the focus ring). */
  keyboard: boolean;
  /** It sits inside the dialog that is closing (focus never goes back into a closed card). */
  inside: boolean;
}

/** Pure: give the focus back to the element it came from (true), or hand the keyboard back to the game (false). */
export function returnFocusTo(from: FocusFrom | null): boolean {
  return !!from && from.shown && from.keyboard && !from.inside;
}

/** Pure: the index Tab moves to among `n` controls from `at` (-1 = none focused yet); wraps both ways. */
export function tabStep(at: number, n: number, back: boolean): number {
  if (n <= 0) return -1;
  if (at < 0) return back ? n - 1 : 0;
  return (at + (back ? -1 : 1) + n) % n;
}

function shown(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** The controls Tab can reach inside `root`, in page order. */
export function controlsIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => shown(el) && !el.closest('[aria-hidden="true"]'));
}

/** Keep Tab / Shift+Tab inside `root` (only when no one handled the key yet). */
export function trapTab(root: HTMLElement): void {
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const items = controlsIn(root);
    const i = tabStep(items.indexOf(document.activeElement as HTMLElement), items.length, e.shiftKey);
    if (i < 0) return;
    e.preventDefault();
    items[i]!.focus();
  });
}

/** Remembers where the focus was when a dialog opened and gives it back when it closes. */
export class FocusReturn {
  private from: HTMLElement | null = null;
  private keyboard = false;

  /** Note the focused element (call as the dialog opens, before it takes the focus). */
  take(el: Element | null = typeof document === 'undefined' ? null : document.activeElement): void {
    this.from = el instanceof HTMLElement && el !== document.body ? el : null;
    this.keyboard = !!this.from && focusVisible(this.from);
  }

  /** The dialog `root` closed: focus goes back where it was, or (a mouse opener, or nothing) back to the game. */
  give(root: HTMLElement): void {
    const from = this.from;
    this.from = null;
    const a = document.activeElement;
    const ok = returnFocusTo(from ? { shown: shown(from), keyboard: this.keyboard, inside: root.contains(from) } : null);
    if (ok && from) {
      from.focus({ preventScroll: true });
      return;
    }
    if (a instanceof HTMLElement && root.contains(a)) a.blur();
  }
}
