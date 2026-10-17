/**
 * [0.9.8 — brief 14] The interface theme: cream cards by day, a plum-ink variant at night, an era-accent ribbon.
 * - installTheme() writes the palette module's UI_TONES (render/palette.ts, the only colour source) to <html> as
 *   `--wl-<name>-c`; ui/tokens.css derives every card, button, chip and night shade from those few base colours.
 * - NightTone eases `--wl-n` (0 = day cards, 1 = night cards) on the HUD layer on simulation time, so a headless
 *   fast-forward is deterministic. It switches with hysteresis (dusk → night at darkness 0.62, back to day at 0.38) and
 *   crosses over in about a second, so the cards never sit half-way (where ink and card would meet) for long.
 * - setEraAccent() puts an era's accent (and a readable ink on it) on any element as `--wl-era` / `--wl-era-ink`.
 */
import { ERAS } from '../eras/data';
import { CREAM, INK, UI_TONES, guideColors, lightness, palette } from '../render/palette';

/** `#rrggbb` from a hex number. */
const css = (n: number): string => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

let installed = false;

/** Writes the UI base colours to <html> once (safe to call again; a no-op without a document). */
export function installTheme(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(UI_TONES)) root.style.setProperty(`--wl-${name}-c`, css(value));
  setEraAccent(root, 1);
}

/** The accent colour of era n (era 1 uses the guide's era-1 row). */
export function eraAccent(n: number): number {
  return n >= 2 && ERAS[n] ? ERAS[n]!.colors.accent : guideColors(1).accent;
}

/** Ink or cream, whichever reads better on `bg`. */
export function inkOn(bg: number): number {
  return lightness(bg) > 0.55 ? INK : CREAM;
}

/** Sets `--wl-era` (the era's accent) and `--wl-era-ink` (text on it) on `el`. */
export function setEraAccent(el: HTMLElement, era: number): void {
  const accent = eraAccent(era);
  el.style.setProperty('--wl-era', css(accent));
  el.style.setProperty('--wl-era-ink', css(inkOn(accent)));
  el.style.setProperty('--wl-era-glow', css(palette(era).glow));
}

/** Darkness at which the night cards come in, and at which the day cards come back. */
export const NIGHT_ON = 0.62;
export const NIGHT_OFF = 0.38;
/** Seconds for the crossover. */
export const NIGHT_FADE = 1.1;

/** [PURE] One step of the night tone: the new `n` (0..1) and whether night is wanted. */
export function nightStep(n: number, night: boolean, darkness: number, dt: number): { n: number; night: boolean } {
  const want = night ? darkness > NIGHT_OFF : darkness >= NIGHT_ON;
  const target = want ? 1 : 0;
  const step = dt / NIGHT_FADE;
  const next = target > n ? Math.min(target, n + step) : Math.max(target, n - step);
  return { n: next, night: want };
}

/** Eases the HUD layer between the day and night card looks. */
export class NightTone {
  private n = 0;
  private night = false;
  private shown = -1;

  constructor(private readonly layer: HTMLElement) {}

  /** `snap` jumps straight to the target (first frame, after a load). */
  update(dt: number, darkness: number, snap = false): void {
    const s = nightStep(this.n, this.night, darkness, snap ? NIGHT_FADE : dt);
    this.n = s.n;
    this.night = s.night;
    const q = Math.round(this.n * 40) / 40;
    if (q === this.shown) return;
    this.shown = q;
    this.layer.style.setProperty('--wl-n', String(q));
    this.layer.classList.toggle('is-night', q >= 0.5);
  }
}
