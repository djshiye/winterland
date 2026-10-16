/**
 * [0.9.7 — Comfort] The loading splash (markup and styles in index.html, so it shows before the code arrives).
 * hideSplash() fades it out (instantly with Reduce motion) and removes it; safe to call more than once and when there
 * is no splash (tests, the gallery page).
 */
import { reducedMotion } from '../fx/comfort';

const FADE_MS = 450;

export function hideSplash(): void {
  const el = typeof document !== 'undefined' ? document.getElementById('wl-splash') : null;
  if (!el || el.classList.contains('is-done')) return;
  if (reducedMotion()) {
    el.remove();
    return;
  }
  el.classList.add('is-done');
  setTimeout(() => el.remove(), FADE_MS + 50);
}

/**
 * Resolves after the browser has painted at least once (two animation frames), so the splash is on screen before the
 * long synchronous world build starts; a hidden tab (no frames) goes ahead after a short timeout.
 */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    setTimeout(go, 150);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(go));
  });
}
