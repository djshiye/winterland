/**
 * [0.9.7 — Comfort] What Esc (and gamepad B / Start with a menu open) closes, topmost first. HUD.escape() asks
 * `escapeTarget` and closes that one menu; with nothing open it folds the quest card, then opens Settings.
 * The finale / stats card sits above everything (it dims the whole screen), so it goes first; while its New Season
 * confirm shows, Esc is that confirm's Cancel (back to the stats), never the card's Close. Tested in
 * tests/controls097.test.ts.
 */

export const ESCAPE_ORDER = ['seasonConfirm', 'finale', 'settings', 'map', 'market', 'gate', 'choose', 'manage', 'shop', 'build', 'ageCard'] as const;

export type EscapeTarget = (typeof ESCAPE_ORDER)[number];

/** Pure: the menu Esc closes, or null when none of them is open. */
export function escapeTarget(open: Readonly<Partial<Record<EscapeTarget, boolean>>>): EscapeTarget | null {
  return ESCAPE_ORDER.find((k) => open[k]) ?? null;
}
