/** Wave 10: the optional frame-rate cap (Settings → Display). 0 = uncapped (the display rate). Persisted. */
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
