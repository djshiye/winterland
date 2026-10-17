/**
 * Pad juice, the pure part (no WebAudio, no three.js scene): shared by the pads (stations/UpgradePad.ts,
 * stations/ConstructionPad.ts, stations/ShopMat.ts), the flights into them and the JuiceDirector, and unit-testable.
 *
 * - Comfort: reducedMotion() is the player's "reduce motion" wish, read from the in-game Settings switch
 *   (fx/comfort.ts, which follows the OS preference until the player picks). motionScale() is the multiplier every bounce / squash / burst size goes through (REDUCED_MOTION_SCALE when
 *   reduced), burstCount() the particle count (bursts are skipped below the reduced scale).
 * - Sound: TickLadder walks a major-pentatonic ladder while the player keeps paying the same pad (one step every
 *   TICK_STEP_EVERY ticks, capped at the top note so it never gets shrill; it starts over after TICK_RESET of
 *   silence). pitchJitter() adds the ±3 % humanising wobble so repeated buys never sound identical. admitVoice() is the
 *   per-sound overlapping-voice cap AudioFX applies to the pad sounds.
 * - Look: bounceScale() is the squash-and-stretch hump the pads play on completion; fillApproach() eases the drawn
 *   fill ring toward the paid ratio (frame-rate independent); breath() is the idle glow of an affordable pad and
 *   padBreath() its slow swell (0.9.8: a pad you can't pay yet holds still and dims instead of jiggling).
 * - 0.9.8 levels: levelNotePitch() is the bell note a level purchase rings (one pentatonic step higher per level, so a
 *   climb from Lv 1 to Lv 9 plays a little tune); Lv 10 rings the capstone chord instead (isCapstone()).
 */

import { reducedMotion as comfortReducedMotion } from './comfort';

/** Major pentatonic, in semitones above the base tick (two octaves would get shrill: stop at +14). */
export const PENTATONIC: readonly number[] = [0, 2, 4, 7, 9, 12, 14];
/** Ticks per ladder step (a pad takes ~24 bundles: about one ladder climb per purchase). */
export const TICK_STEP_EVERY = 3;
/** Seconds without a tick before the ladder starts over at the bottom. */
export const TICK_RESET = 0.6;
/** Fraction of each bounce / squash / particle burst kept when reduced motion is on. */
export const REDUCED_MOTION_SCALE = 0.25;
/** Random pitch spread (±3 %). */
export const PITCH_JITTER = 0.03;
/**
 * Flight shape of a cash bundle into a pad (items/FlightSystem.ts FlightOptions): a slightly higher, softer arc and a
 * gentle squash. Same duration as every flight, so payment timing is untouched.
 */
export const PAD_CASH_FLIGHT = { arcHeight: 1.05, squash: 0.28 } as const;

/** Playback-rate multiplier for a pentatonic step (clamped to the ladder). */
export function pentatonicPitch(step: number): number {
  const i = Math.max(0, Math.min(PENTATONIC.length - 1, Math.floor(step)));
  return Math.pow(2, PENTATONIC[i]! / 12);
}

/** 1 ± PITCH_JITTER from a uniform random number in [0, 1). */
export function pitchJitter(rand: number = Math.random()): number {
  const r = Math.max(0, Math.min(1, rand));
  return 1 + (r * 2 - 1) * PITCH_JITTER;
}

/**
 * Rising tick ladder for one pad: next(now) returns the pitch multiplier of the tick played at `now` (seconds).
 * Steady paying climbs one pentatonic step every TICK_STEP_EVERY ticks and holds at the top; a pause of TICK_RESET
 * or more starts over.
 */
export class TickLadder {
  private count = 0;
  private last = -Infinity;

  next(now: number, rand?: number): number {
    if (now - this.last >= TICK_RESET) this.count = 0;
    this.last = now;
    const step = Math.floor(this.count / TICK_STEP_EVERY);
    this.count++;
    return pentatonicPitch(step) * (rand === undefined ? 1 : pitchJitter(rand));
  }

  /** Current ladder step (0 = bottom). */
  get step(): number {
    return Math.min(PENTATONIC.length - 1, Math.floor(Math.max(0, this.count - 1) / TICK_STEP_EVERY));
  }

  reset(): void {
    this.count = 0;
    this.last = -Infinity;
  }
}

/**
 * Per-sound voice cap: `ends` holds the end times of that sound's live voices (pruned in place). Returns true and
 * records a voice ending at now + len when fewer than `max` are still sounding, false (play nothing) otherwise.
 */
export function admitVoice(ends: number[], now: number, max: number, len: number): boolean {
  for (let i = ends.length - 1; i >= 0; i--) if (ends[i]! <= now) ends.splice(i, 1);
  if (ends.length >= max) return false;
  ends.push(now + len);
  return true;
}

/** Bell note per level bought (semitones over the first): Lv 1 … Lv 9 climb the major pentatonic over ~1.6 octaves. */
export const LEVEL_NOTES: readonly number[] = [0, 2, 4, 7, 9, 12, 14, 16, 19];
/** The level that rings the capstone chord. */
export const CAPSTONE_LEVEL = 10;

/** Playback-rate multiplier of the bell note for reaching `level` (clamped to Lv 1 … Lv 9). */
export function levelNotePitch(level: number): number {
  const i = Math.max(0, Math.min(LEVEL_NOTES.length - 1, Math.floor(level) - 1));
  return Math.pow(2, LEVEL_NOTES[i]! / 12);
}

/** True when reaching `level` (or the upgrade's top, `max`) should ring the capstone chord. */
export function isCapstone(level: number, max = false): boolean {
  return max || level >= CAPSTONE_LEVEL;
}

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

let override: boolean | null = null;

/**
 * True when the player asked for less motion: the in-game Settings switch (fx/comfort.ts), which follows the OS /
 * browser preference until the player picks.
 */
export function reducedMotion(): boolean {
  if (override !== null) return override;
  return comfortReducedMotion();
}

/** Force the preference (tests, debug); null goes back to the Settings switch. */
export function setReducedMotion(on: boolean | null): void {
  override = on;
}

/** Multiplier for bounces, squashes and burst sizes. */
export function motionScale(reduced: boolean = reducedMotion()): number {
  return reduced ? REDUCED_MOTION_SCALE : 1;
}

/** Particle count for a burst of `n` (reduced motion: skipped, 0). */
export function burstCount(n: number, reduced: boolean = reducedMotion()): number {
  return reduced ? 0 : Math.max(0, Math.round(n));
}

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------

/**
 * Squash-and-stretch hump at tween progress k (0..1): the whole pad swells to `peak` and back while it wobbles
 * (lands squashed, springs up stretched, settles). `motion` scales everything (motionScale()). Writes and returns
 * `out` ({ xz, y }); exactly 1 / 1 at k = 1.
 */
export function bounceScale(k: number, peak: number, motion = 1, out = { xz: 1, y: 1 }): { xz: number; y: number } {
  const u = Math.max(0, Math.min(1, k));
  if (u >= 1) {
    out.xz = 1;
    out.y = 1;
    return out;
  }
  const hump = 1 + (peak - 1) * motion * Math.sin(u * Math.PI) * (1 - 0.2 * u);
  const w = Math.cos(u * Math.PI * 2.5) * Math.pow(1 - u, 1.6) * 0.16 * motion;
  out.y = hump * (1 - w);
  out.xz = hump * (1 + 0.6 * w);
  return out;
}

/** Ease `shown` toward `target` (rate per second, frame-rate independent); snaps when within 1e-4. */
export function fillApproach(shown: number, target: number, dt: number, rate = 9): number {
  const next = shown + (target - shown) * (1 - Math.exp(-rate * Math.max(0, dt)));
  return Math.abs(target - next) < 1e-4 ? target : next;
}

/** Swell of an affordable pad's breathing (scale above 1). */
export const BREATH_SWELL = 0.022;

/**
 * Scale of a pad's slow breathing at time t (~0.25 Hz): it swells by up to BREATH_SWELL while the player can afford
 * it and rests at exactly 1 otherwise (never a jiggle). Reduced motion holds it at 1. `phase` desyncs neighbours.
 */
export function padBreath(t: number, afford: boolean, phase = 0, reduced: boolean = reducedMotion()): number {
  if (!afford || reduced) return 1;
  return 1 + BREATH_SWELL * (0.5 + 0.5 * Math.sin(t * 1.6 + phase));
}

/** Idle breathing glow 0..1 at time t (slow, ~0.3 Hz); reduced motion holds it steady at the middle. */
export function breath(t: number, reduced: boolean = reducedMotion()): number {
  if (reduced) return 0.55;
  return 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(t * 1.9));
}
