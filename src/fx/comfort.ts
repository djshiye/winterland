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
 * - uiScale (0.9.7, Interface size): 0.8..1.5, how big the HUD, cards and menus draw. Written to <html> as the CSS
 *   variable `--wl-ui`; ui/comfort.css zooms every HUD panel by it (world-anchored effects keep their own size).
 *   A size above 100 % is fitted to the window (`fitUiScale`), so a small window never crowds the top bar; the big
 *   centre toast stops at TOAST_UI_MAX (`--wl-ui-toast`).
 * - glow (0.9.8, Glow): 0..1, how strongly lamps, windows and furnaces bloom and brighten at night (render/PostFX.ts
 *   bloom, world/env/glow.ts night boost and halos). 0 keeps every light at its plain daytime look.
 * <html> also gets `wl-reduce-motion` and `wl-calm` so CSS can follow. Every storage / DOM access is guarded.
 */

export type EffectsLevel = 'full' | 'calm' | 'minimal';
export const EFFECTS_LEVELS: readonly EffectsLevel[] = ['full', 'calm', 'minimal'];

export interface ComfortSettings {
  /** Reduce motion. */
  motion: boolean;
  effects: EffectsLevel;
  colorBlind: boolean;
  /** Interface size, 0.8..1.5 (1 = as designed). */
  uiScale: number;
  /** Glow, 0..1 (1 = as designed). */
  glow: number;
}

/** Interface size limits and step (the Settings slider shows them as 80-150 %). */
export const UI_SCALE = { min: 0.8, max: 1.5, step: 0.05 } as const;

/** Clamp to the slider's range on its 5 % steps; anything not a finite number is 1. */
export function clampUiScale(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  const stepped = Math.round(v / UI_SCALE.step) * UI_SCALE.step;
  return Math.round(Math.min(UI_SCALE.max, Math.max(UI_SCALE.min, stepped)) * 100) / 100;
}

/** Clamp a Glow value to 0..1 on 5 % steps; anything not a finite number is 1. */
export function clampGlow(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  return Math.round(Math.min(1, Math.max(0, v)) * 20) / 20;
}

/** The window (CSS px) the HUD needs per 100 % of size: a bigger size only applies where the window has room. */
export const UI_FIT = { w: 850, h: 560 } as const;
/** The centre toast ("Quest complete!") grows no bigger than this, so it never covers the middle of the screen. */
export const TOAST_UI_MAX = 1.25;

/**
 * Pure: the size actually drawn for a chosen size in a w × h window. Sizes up to 100 % always apply; above that, no
 * more than the window has room for (never below 100 % because of the window).
 */
export function fitUiScale(chosen: number, w: number, h: number): number {
  if (!(w > 0 && h > 0) || chosen <= 1) return chosen;
  const room = Math.min(w / UI_FIT.w, h / UI_FIT.h);
  return Math.floor(Math.min(chosen, Math.max(1, room)) * 100) / 100;
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
  return { motion: systemReducedMotion(), effects: 'full', colorBlind: false, uiScale: 1, glow: 1 };
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
    uiScale: r.uiScale === undefined ? d.uiScale : clampUiScale(r.uiScale),
    glow: r.glow === undefined ? d.glow : clampGlow(r.glow),
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
/** The size drawn now: state.uiScale fitted to the window. */
let drawn = state.uiScale;
const listeners = new Set<(s: Readonly<ComfortSettings>) => void>();

/** The window size in CSS px (0 × 0 without a window: then nothing is fitted). */
function windowSize(): { w: number; h: number } {
  try {
    return typeof window === 'undefined' ? { w: 0, h: 0 } : { w: window.innerWidth, h: window.innerHeight };
  } catch {
    return { w: 0, h: 0 };
  }
}

function applyClasses(): void {
  const win = windowSize();
  drawn = fitUiScale(state.uiScale, win.w, win.h);
  try {
    if (typeof document === 'undefined') return;
    const root = document.documentElement.classList;
    root.toggle('wl-cb', state.colorBlind);
    root.toggle('wl-reduce-motion', state.motion);
    root.toggle('wl-calm', state.effects !== 'full');
    document.documentElement.style.setProperty('--wl-ui', String(drawn));
    document.documentElement.style.setProperty('--wl-ui-toast', String(Math.min(drawn, TOAST_UI_MAX)));
  } catch {
    /* no DOM */
  }
}
applyClasses();
try {
  // a resized window re-fits the interface size
  if (typeof window !== 'undefined') window.addEventListener('resize', applyClasses);
} catch {
  /* no window */
}

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

/** Interface size drawn now (1 = as designed). Screen-pixel positions written onto a zoomed HUD panel are divided by it. */
export function uiScale(): number {
  return drawn;
}

/** True when the window is too small for the chosen size, so a smaller one is drawn (Settings says so). */
export function uiScaleFitted(): boolean {
  return drawn < state.uiScale;
}

/** Glow strength 0..1 (lamps, windows and furnaces at night; the bloom). */
export function glowScale(): number {
  return state.glow;
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
