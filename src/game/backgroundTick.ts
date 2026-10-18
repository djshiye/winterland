/**
 * [PURE] 0.9.10 (D9, desktop): how a hidden or minimised game catches up. The desktop app sends no frames to a hidden
 * window, so Game.backgroundTick runs on a slow timer instead and steps the simulation without drawing.
 *
 * The rules, kept here so tests can hold them:
 * - only while the page is hidden (a visible page runs on frames, so the two never step the same time twice: both
 *   take their time from the same `last` stamp and move it forward);
 * - never more simulated time than real time passed, and at most `maxCatchUp` seconds per tick (a computer that
 *   slept for hours doesn't fast-forward);
 * - in steps no longer than `maxDt`, like a frame.
 */

/** True when a background tick should step the simulation now. */
export function backgroundShouldStep(hidden: boolean, running: boolean): boolean {
  return running && hidden;
}

/** The simulation steps (seconds each) to catch up from `last` to `now` (both in ms). Empty when no time passed. */
export function backgroundSteps(last: number, now: number, maxCatchUp: number, maxDt: number): number[] {
  const seconds = Math.min((now - last) / 1000, maxCatchUp);
  const out: number[] = [];
  if (!(seconds > 0) || !(maxDt > 0)) return out;
  let left = seconds;
  while (left > 1e-6) {
    const dt = Math.min(maxDt, left);
    out.push(dt);
    left -= dt;
  }
  return out;
}
