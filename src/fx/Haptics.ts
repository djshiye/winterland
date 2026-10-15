/**
 * [B4] Haptics: very short navigator.vibrate pulses on pad payments completing, upgrades and cash pickups.
 * Feature-detected (phones only: desktop browsers and iOS Safari have no vibrate), every call wrapped in try/catch,
 * behind the Settings "Vibration" switch (localStorage 'winterland:haptics', default on). Module-level state
 * so the Settings panel and the JuiceDirector share it without a context slot.
 */
import type { GameContext } from '../core/types';

const KEY = 'winterland:haptics';

/** True where the Vibration API exists (the Settings switch is only shown then). */
export function hapticsAvailable(): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  } catch {
    return false;
  }
}

let enabled = true;
try {
  enabled = localStorage.getItem(KEY) !== '0';
} catch {
  /* storage unavailable */
}

export function hapticsEnabled(): boolean {
  return enabled;
}

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

/** One pulse of `ms` milliseconds; silently does nothing when unsupported / switched off / refused. */
export function buzz(ms: number): void {
  if (!enabled || !hapticsAvailable()) return;
  try {
    navigator.vibrate(ms);
  } catch {
    /* some browsers throw before the first user gesture */
  }
}

/** Wires game events to pulses (constructed by the JuiceDirector). */
export class Haptics {
  private lastCash = -10;

  constructor(ctx: GameContext) {
    if (!hapticsAvailable()) return;
    const ev = ctx.events;
    ev.on('pad:unlocked', () => buzz(30));
    ev.on('upgrade:bought', () => buzz(22));
    // cash bundles landing on the player's back: a tiny tick, at most ~7 per second
    ev.on('item:landed', (e) => {
      if (e.holder !== ctx.player.back) return;
      const now = ctx.time.elapsed;
      if (now - this.lastCash < 0.14) return;
      this.lastCash = now;
      buzz(8);
    });
  }
}
