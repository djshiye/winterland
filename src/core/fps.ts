/** Wave 10: the frame-rate cap (Settings → Display). 0 = Auto (0.9.11: 60 at most, was the display rate). Persisted. */
export type FpsCap = 0 | 30 | 60;
export const FPS_CAPS: readonly FpsCap[] = [0, 30, 60];
const FPS_KEY = 'winterland:fps';

export function readFpsCap(): FpsCap {
  try {
    const v = Number(localStorage.getItem(FPS_KEY));
    return v === 30 || v === 60 ? v : 0;
  } catch {
    return 0;
  }
}

export function writeFpsCap(cap: FpsCap): void {
  try {
    localStorage.setItem(FPS_KEY, String(cap));
  } catch {
    /* storage unavailable */
  }
}

/** 0.9.11: Auto draws at most this many frames a second (a 120 Hz screen no longer doubles the work). */
export const AUTO_FPS = 60;
/** 0.9.11: while the window is visible but not focused (another app in front), at most this many. */
export const UNFOCUSED_FPS = 30;

/** Frames a second to draw for the Frame rate setting and window focus. */
export function targetFps(cap: FpsCap, focused: boolean): number {
  const fps = cap === 0 ? AUTO_FPS : cap;
  return focused ? fps : Math.min(fps, UNFOCUSED_FPS);
}

/**
 * Frame limiter on top of the display's frames: null = skip this display frame, otherwise the new `last` (draw it).
 * `last` moves on in whole intervals, so a 75 or 144 Hz screen still averages the target instead of rounding down to
 * every other frame; 2 ms of slack keeps a 60 Hz screen under a 60 cap at 60. After a stall it restarts from `now`.
 */
export function frameDue(now: number, last: number, fps: number): number | null {
  const interval = 1000 / fps;
  if (now - last < interval - 2) return null;
  return now - last > interval * 2 ? now : last + interval;
}
