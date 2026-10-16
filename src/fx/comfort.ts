/**
 * [1.0 — Comfort] Calm-play options for players who find busy screens tiring (ADHD, motion sensitivity, colour
 * vision). Module-level state like fx/Haptics, so the Settings panel and the effect code share it without a context
 * slot. Kept in localStorage 'winterland:comfort' next to the other settings (never in the save file):
 * - motion (Reduce motion): no camera shake, no bouncy overshoot when cards open, no heartbeat / wobble on banners,
 *   no sideways shake on a refused tap, and half the falling snow. Until the player picks, it follows the system's
 *   "reduce motion" setting.
 * - effects 'full' | 'calm' | 'minimal': how many particles (100 / 50 / 20 %), how hard the screen shakes
 *   (100 / 40 / 0 %), how many fireworks; below 'full' sparkles stop twinkling and warnings stop flashing.
 * - colorBlind: a red / green safe UI palette (blue for go / good, deep orange for danger) via the `wl-cb` class
 *   on <html>; ui/comfort.css holds the colours.
 * <html> also gets `wl-reduce-motion` and `wl-calm` so CSS can follow. Every storage / DOM access is guarded.
 */

export type EffectsLevel = 'full' | 'calm' | 'minimal';
export const EFFECTS_LEVELS: readonly EffectsLevel[] = ['full', 'calm', 'minimal'];

export interface ComfortSettings {
  /** Reduce motion. */
  motion: boolean;
  effects: EffectsLevel;
  colorBlind: boolean;
}

export const COMFORT_KEY = 'winterland:comfort';

const PARTICLES: Record<EffectsLevel, number> = { full: 1, calm: 0.5, minimal: 0.2 };
const SHAKE: Record<EffectsLevel, number> = { full: 1, calm: 0.4, minimal: 0 };

/** The system "reduce motion" preference (false where it can't be read). */
function systemReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function defaultComfort(): ComfortSettings {
  return { motion: systemReducedMotion(), effects: 'full', colorBlind: false };
}

/**
 * Read stored text into settings. Anything unexpected (not JSON, wrong types, unknown levels) falls back to the
 * default for that field, so a damaged or hand-edited value can never break the game.
 */
export function parseComfort(text: string | null): ComfortSettings {
  const d = defaultComfort();
  if (!text) return d;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return d;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const r = raw as Record<string, unknown>;
  return {
    motion: typeof r.motion === 'boolean' ? r.motion : d.motion,
    effects: EFFECTS_LEVELS.includes(r.effects as EffectsLevel) ? (r.effects as EffectsLevel) : d.effects,
    colorBlind: typeof r.colorBlind === 'boolean' ? r.colorBlind : d.colorBlind,
  };
}

function load(): ComfortSettings {
  try {
    return parseComfort(localStorage.getItem(COMFORT_KEY));
  } catch {
    return defaultComfort();
  }
}

let state: ComfortSettings = load();
const listeners = new Set<(s: Readonly<ComfortSettings>) => void>();

function applyClasses(): void {
  try {
    if (typeof document === 'undefined') return;
    const root = document.documentElement.classList;
    root.toggle('wl-cb', state.colorBlind);
    root.toggle('wl-reduce-motion', state.motion);
    root.toggle('wl-calm', state.effects !== 'full');
  } catch {
    /* no DOM */
  }
}
applyClasses();

/** The current settings (read-only view). */
export function comfort(): Readonly<ComfortSettings> {
  return state;
}

/** Change some settings, remember them and tell listeners. */
export function setComfort(patch: Partial<ComfortSettings>): void {
  state = parseComfort(JSON.stringify({ ...state, ...patch }));
  try {
    localStorage.setItem(COMFORT_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: still applies for this session */
  }
  applyClasses();
  for (const fn of listeners) fn(state);
}

/** Called after every change; returns an unsubscribe. */
export function onComfortChange(fn: (s: Readonly<ComfortSettings>) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** For tests: re-read storage as if the game had just started. */
export function reloadComfort(): void {
  state = load();
  applyClasses();
}

export function reducedMotion(): boolean {
  return state.motion;
}

/** True when pulsing / flashing highlights should hold still (reduced motion or calmer effects). */
export function steadyHighlights(): boolean {
  return state.motion || state.effects !== 'full';
}

/** Multiplier for particle amounts (1 at full). */
export function particleScale(): number {
  return PARTICLES[state.effects];
}

/** Multiplier for camera shake strength (0 with reduced motion). */
export function shakeScale(): number {
  return state.motion ? 0 : SHAKE[state.effects];
}

/** Multiplier for the falling snow (fewer flakes drifting past with reduced motion). */
export function snowScale(): number {
  return state.motion ? 0.5 : 1;
}

/**
 * `n` scaled by the particle amount, rounded at random so small counts still average out right, and never below 1
 * when n >= 1 (a reward must always show something).
 */
export function scaledCount(n: number, rand: () => number = Math.random): number {
  if (!(n > 0)) return 0;
  const k = particleScale();
  if (k >= 1) return n;
  const x = n * k;
  const whole = Math.floor(x);
  return Math.max(1, whole + (rand() < x - whole ? 1 : 0));
}
