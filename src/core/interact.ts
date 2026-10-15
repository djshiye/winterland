/**
 * Wave 10b: "Hold to interact". When on, the player's pickups (logs, crates, chairs, town goods) and payments (pads,
 * plots, lots) only happen while E, Space or a stationary pointer press is held; drop-offs and cash collection stay
 * automatic. Persisted in localStorage 'winterland:holdInteract'. The default follows the pointer: on with a mouse,
 * off on touch (and off for automated runs, so the bot, balance and shot scripts are untouched).
 */
const KEY = 'winterland:holdInteract';

export function defaultHoldToInteract(): boolean {
  try {
    if (navigator.webdriver) return false;
    return window.matchMedia('(pointer: fine)').matches;
  } catch {
    return false;
  }
}

export function readHoldToInteract(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    /* storage unavailable */
  }
  return defaultHoldToInteract();
}

export function writeHoldToInteract(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}
