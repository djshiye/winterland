/** [B4] Small DOM helpers shared by the HUD panels. */
import { reducedMotion } from '../fx/comfort';

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  html?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/**
 * The HUD is a plain overlay and the input layer only listens on the canvas, but stop the gesture events anyway so a
 * tap on a panel can never leak into anything underneath (joystick, camera gestures).
 */
export function shield(e: HTMLElement): void {
  const stop = (ev: Event): void => ev.stopPropagation();
  e.addEventListener('pointerdown', stop);
  e.addEventListener('pointerup', stop);
  e.addEventListener('mousedown', stop);
  e.addEventListener('touchstart', stop, { passive: true });
  e.addEventListener('touchend', stop, { passive: true });
}

/** True on a touch-only device (no mouse or trackpad anywhere): key hints like "(T)" mean nothing there. */
export function touchOnly(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
}

/** A button label with its key ("Map (T)"), or just the name on a touch-only device. */
export function keyLabel(name: string, key: string, rest = ''): string {
  return `${name}${touchOnly() ? '' : ` (${key})`}${rest}`;
}

/** Click that also stops propagation. */
export function onTap(e: HTMLElement, fn: () => void): void {
  e.addEventListener('click', (ev) => {
    ev.stopPropagation();
    fn();
  });
}

/** An open/close animation value driven by simulation time: `k` runs 0..1 in `dur` seconds. */
export class Slide {
  k = 0;
  open = false;
  /** Advances k; returns true while it moved. */
  step(dt: number, dur = 0.24): boolean {
    const t = this.open ? 1 : 0;
    if (this.k === t) return false;
    const d = dt / dur;
    this.k = this.k < t ? Math.min(t, this.k + d) : Math.max(t, this.k - d);
    return true;
  }
}

export const cubicOut = (t: number): number => 1 - Math.pow(1 - t, 3);
/** Ease with a little overshoot (a bouncy pop); a plain ease-out with Reduce motion (fx/comfort). */
export const backOut = (t: number): number => {
  if (reducedMotion()) return cubicOut(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
