/**
 * Wave 10: the frame-rate cap (Settings → Display). Persisted.
 * 0 = Auto. 0.9.11 capped Auto at 60 (a fanless Mac ran hot drawing 120); 0.9.15: Auto draws every frame the screen
 * shows again (120, 144, 165 Hz…), and 60 at most while a laptop runs on battery (navigator.getBattery, watchPower).
 * 120 is a fixed cap for a fast screen on battery too, or to keep a 144+ Hz screen cooler.
 */
export type FpsCap = 0 | 30 | 60 | 120;
export const FPS_CAPS: readonly FpsCap[] = [0, 30, 60, 120];
const FPS_KEY = 'winterland:fps';

export function readFpsCap(): FpsCap {
  try {
    const v = Number(localStorage.getItem(FPS_KEY));
    return v === 30 || v === 60 || v === 120 ? v : 0;
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

/** 0.9.15: Auto on battery power draws at most this many frames a second (plugged in: the screen's own rate). */
export const BATTERY_FPS = 60;
/** 0.9.11: while the window is visible but not focused (another app in front), at most this many. */
export const UNFOCUSED_FPS = 30;

/**
 * Frames a second to draw for the Frame rate setting, window focus and power source (Infinity: every display frame).
 * `onBattery` only limits Auto: a fixed cap is what the player asked for.
 */
export function targetFps(cap: FpsCap, focused: boolean, onBattery = false): number {
  const fps = cap === 0 ? (onBattery ? BATTERY_FPS : Infinity) : cap;
  return focused ? fps : Math.min(fps, UNFOCUSED_FPS);
}

/**
 * Frame limiter on top of the display's frames: null = skip this display frame, otherwise the new `last` (draw it).
 * `last` moves on in whole intervals, so a 75 or 144 Hz screen still averages the target instead of rounding down to
 * every other frame; 2 ms of slack keeps a 60 Hz screen under a 60 cap at 60. After a stall it restarts from `now`.
 * An uncapped target (Infinity) draws every display frame.
 */
export function frameDue(now: number, last: number, fps: number): number | null {
  if (!Number.isFinite(fps)) return now;
  const interval = 1000 / fps;
  if (now - last < interval - 2) return null;
  return now - last > interval * 2 ? now : last + interval;
}

interface BatteryLike {
  charging: boolean;
  addEventListener(type: 'chargingchange', fn: () => void): void;
}

/**
 * 0.9.15: tell `set` whether the computer runs on battery now and whenever that changes. Desktops, and browsers without
 * the Battery API, count as plugged in (a desktop reports charging = true).
 */
export function watchPower(set: (onBattery: boolean) => void): void {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (typeof nav.getBattery !== 'function') return;
    nav
      .getBattery()
      .then((b) => {
        set(!b.charging);
        b.addEventListener('chargingchange', () => set(!b.charging));
      })
      .catch(() => {
        /* not allowed here: plugged in */
      });
  } catch {
    /* no navigator */
  }
}
