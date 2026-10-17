/**
 * 0.9.7 the ending's hush (validator #41 note 1): from the 100 % moment until the Winterland Complete card closes,
 * the world holds its breath. Rush hours and world events end and do not start (core/Rush.ts, core/WorldEvents.ts),
 * HUD toasts and the city rank banner wait (ui/HUD.ts, ui/AgeCard.ts) and show after the card. Transient (a reload
 * starts unhushed) and capped at QUIET_MAX seconds of simulation time, so nothing can stay silenced for good.
 */
export const QUIET_MAX = 180;

let left = 0;

/** Start the hush (core/CompletionTracker on the 100 % moment). */
export function hushFinale(): void {
  left = QUIET_MAX;
}

/** End the hush (ui/FinaleCard when the Winterland Complete card closes). */
export function releaseFinale(): void {
  left = 0;
}

/** True while the ending's hush holds. */
export function finaleQuiet(): boolean {
  return left > 0;
}

/** Count the hush down (simulation seconds; the tracker calls it every frame). */
export function tickQuiet(dt: number): void {
  if (left > 0) left = Math.max(0, left - dt);
}
