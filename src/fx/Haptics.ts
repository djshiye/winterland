/**
 * [B4] Haptics: very short navigator.vibrate pulses on pad payments completing, upgrades and cash pickups; a light tap
 * per bundle into a pad (at most ~8 per second) and a slightly longer pulse when a pad completes ('pad:complete').
 * Feature-detected (phones only: desktop browsers and iOS Safari have no vibrate), every call wrapped in try/catch,
 * behind the Settings "Vibration" switch (localStorage 'winterland:haptics', default on). Module-level state
 * so the Settings panel and the JuiceDirector share it without a context slot.
 * 0.9.7: the same pulses rumble a connected gamepad (input/Gamepad.ts rumble), behind the same switch; the switch
 * shows wherever either can happen.
 */
import type * as THREE from 'three';
import type { GameContext } from '../core/types';
import { gamepadApiAvailable, rumble } from '../input/Gamepad';

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

/** True where a phone can vibrate or a gamepad could rumble (the Settings "Vibration" switch shows then). */
export function feedbackAvailable(): boolean {
  return hapticsAvailable() || gamepadApiAvailable();
}

/**
 * One pulse of `ms` milliseconds (phone vibration and gamepad rumble, longer pulses rumble harder); silently does
 * nothing when unsupported / switched off / refused.
 */
export function buzz(ms: number): void {
  if (!enabled) return;
  rumble(Math.max(ms, 30), Math.min(1, 0.25 + ms / 50));
  if (!hapticsAvailable()) return;
  try {
    navigator.vibrate(ms);
  } catch {
    /* some browsers throw before the first user gesture */
  }
}

/** Wires game events to pulses (constructed by the JuiceDirector). */
export class Haptics {
  private lastCash = -10;
  private lastPad = -10;

  constructor(ctx: GameContext) {
    if (!feedbackAvailable()) return;
    const ev = ctx.events;
    ev.on('pad:unlocked', () => buzz(30));
    ev.on('upgrade:bought', () => buzz(22));
    // pads: a feather-light tap per bundle while paying, a longer one when the pad completes (emitted last, so it wins)
    const padTap = (e: { position: THREE.Vector3 }): void => {
      // only under the player's feet (the foreman pays construction pads from afar)
      if (ctx.player.position.distanceToSquared(e.position) > 16) return;
      const now = ctx.time.elapsed;
      if (now - this.lastPad < 0.12) return;
      this.lastPad = now;
      buzz(6);
    };
    ev.on('pad:paid', padTap);
    ev.on('construction:paid', padTap);
    ev.on('pad:complete', () => buzz(40));
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
