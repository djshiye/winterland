/**
 * [B4] Automatic graphics quality. 0.9.8: it steps both ways between the three tiers (Low / Medium / High,
 * render/Renderer.ts TIERS, DIRECTION V13):
 * - Down one tier when the real frame rate stays under DOWN_FRACTION of the target for DOWN_SECONDS.
 * - Up one tier when it stays at UP_FRACTION of the target or better for UP_SECONDS, never above High. A tier it had to
 *   leave because it was too slow is never tried again in this session, so it settles instead of bouncing.
 * - The target is the Frame rate setting (core/fps.ts: 30 or 60, Auto = 60), so a 30 fps cap never reads as "slow".
 * Each change says so with a small toast (`notify(quality, up)`).
 *
 * Rules
 * - It never overrides the player: a quality the player picked in Settings (marker 'manual' in localStorage
 *   'winterland:autoQuality', written by SettingsPanel) or a stored 'winterland:quality' without our marker (set by hand
 *   in an earlier version) disables it for good. Its own choice is stored as the tier name in 'winterland:autoQuality'
 *   (0.9.7 stored 'low' after its one-way drop; that now simply means "auto, currently Low").
 * - Measures real time between HUD updates (like PerfOverlay, 0.5 s buckets), skips the first 5 s after load and the
 *   first seconds after each change, skips while the tab is hidden or the window is not focused (0.9.11: drawn at 30
 *   then) and restarts its streak when it comes back.
 * - Test safety: it does nothing for `?noauto`, nor under automation (navigator.webdriver: Playwright / Puppeteer /
 *   headless test runs), and it only counts frames that arrive like a real animation loop (>= ~6 ms apart and < 1 s
 *   apart), so `__WINTERLAND__.simulate()` bursts and pauses never feed it.
 */
import type { GameContext } from '../core/types';
import { readFpsCap } from '../core/fps';
import { QUALITIES, type Quality } from '../render/Renderer';

const KEY = 'winterland:autoQuality';
const QUALITY_KEY = 'winterland:quality';
/** Step down under this share of the target frame rate (40 of 60)… */
const DOWN_FRACTION = 2 / 3;
const DOWN_SECONDS = 8;
/** …and up at this share or better, held for longer. */
const UP_FRACTION = 0.95;
const UP_SECONDS = 20;
const WARMUP_MS = 5000;
/** Seconds after a change before the new tier is judged (shaders compile, the frame rate settles). */
const SETTLE_MS = 4000;
const BUCKET = 0.5;

export class AutoQuality {
  private enabled: boolean;
  private quietUntil = performance.now() + WARMUP_MS;
  private last = 0;
  private frames = 0;
  private time = 0;
  private slow = 0;
  private fast = 0;
  /** Tiers left for being too slow (never tried again this session). */
  private readonly tooSlow = new Set<Quality>();

  constructor(
    private readonly ctx: GameContext,
    private readonly notify: (q: Quality, up: boolean) => void,
  ) {
    let ok = true;
    try {
      const q = new URLSearchParams(location.search);
      if (q.has('noauto')) ok = false;
      if ((navigator as Navigator & { webdriver?: boolean }).webdriver) ok = false;
      const mark = localStorage.getItem(KEY);
      if (mark === 'manual') ok = false; // chosen by hand
      else if (mark === null && localStorage.getItem(QUALITY_KEY) !== null) ok = false; // a hand-set quality from before the marker existed
    } catch {
      /* storage unavailable: still fine to run, nothing to read */
    }
    this.enabled = ok;
    try {
      document.addEventListener('visibilitychange', () => this.restart());
    } catch {
      /* no document */
    }
  }

  /** Forget the running measurement (tab hidden / shown). */
  private restart(): void {
    this.last = 0;
    this.frames = 0;
    this.time = 0;
    this.slow = 0;
    this.fast = 0;
  }

  /** The frame rate the player expects (the Frame rate setting; Auto = 60). */
  private target(): number {
    let cap = 0;
    try {
      cap = readFpsCap();
    } catch {
      /* storage unavailable */
    }
    return cap > 0 ? cap : 60;
  }

  /** Once per HUD update (frame). */
  update(): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (document.hidden || !document.hasFocus()) {
      // hidden, or another window in front (the game draws at 30 then, core/fps.ts): not a fair sample
      this.restart();
      return;
    }
    const prev = this.last;
    this.last = now;
    if (prev === 0 || now < this.quietUntil) return;
    const d = (now - prev) / 1000;
    if (d >= 1) return; // a pause / a stall: not a frame rate sample
    if (d < 0.006) {
      // faster than any display: the simulation is being fast-forwarded
      this.restart();
      this.last = now;
      return;
    }
    this.frames++;
    this.time += d;
    if (this.time < BUCKET) return;
    const fps = this.frames / this.time;
    this.frames = 0;
    this.time = 0;
    const target = this.target();
    if (fps < target * DOWN_FRACTION) {
      this.fast = 0;
      this.slow += BUCKET;
      if (this.slow >= DOWN_SECONDS) this.step(-1);
    } else if (fps >= target * UP_FRACTION) {
      this.slow = 0;
      this.fast += BUCKET;
      if (this.fast >= UP_SECONDS) this.step(1);
    } else {
      this.slow = 0;
      this.fast = 0;
    }
  }

  private step(dir: 1 | -1): void {
    this.slow = 0;
    this.fast = 0;
    const r = this.ctx.renderer;
    try {
      if (localStorage.getItem(KEY) === 'manual') {
        this.enabled = false; // the player took over meanwhile
        return;
      }
    } catch {
      /* storage unavailable */
    }
    const i = QUALITIES.indexOf(r.quality);
    const next = QUALITIES[i + dir];
    if (!next) return;
    if (dir > 0 && this.tooSlow.has(next)) return;
    if (dir < 0) this.tooSlow.add(r.quality);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable */
    }
    r.setQuality(next);
    this.quietUntil = performance.now() + SETTLE_MS;
    this.last = 0;
    this.notify(next, dir > 0);
  }
}
