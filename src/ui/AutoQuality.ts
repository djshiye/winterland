/**
 * [B4] Automatic graphics quality (wave 8). If the real frame rate stays under 40 fps for 8 s while on High, the game
 * drops to Low once and says so ("Switched to Low graphics for smoother play (Settings)").
 *
 * Rules
 * - One-way: it never switches back up, and it never overrides the player: a quality the player picked in Settings
 *   (marker 'manual' in localStorage 'winterland:autoQuality', written by SettingsPanel) or a stored
 *   'winterland:quality' without our marker (set by hand in an earlier version) disables it for good. The decision itself
 *   is stored as 'low' in 'winterland:autoQuality'.
 * - Measures real time between HUD updates (like PerfOverlay, 0.5 s buckets), skips the first 5 s after load, skips
 *   while the tab is hidden and restarts its streak when the tab comes back.
 * - Test safety: it does nothing for `?noauto`, nor under automation (navigator.webdriver: Playwright / Puppeteer /
 *   headless test runs), and it only counts frames that arrive like a real animation loop (>= ~6 ms apart and < 1 s
 *   apart), so `__WINTERLAND__.simulate()` bursts and pauses never feed it.
 */
import type { GameContext } from '../core/types';

const KEY = 'winterland:autoQuality';
const QUALITY_KEY = 'winterland:quality';
const FPS_LIMIT = 40;
const NEED_SECONDS = 8;
const WARMUP_MS = 5000;
const BUCKET = 0.5;

export class AutoQuality {
  private enabled: boolean;
  private readonly t0 = performance.now();
  private last = 0;
  private frames = 0;
  private time = 0;
  private slow = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly notify: () => void,
  ) {
    let ok = true;
    try {
      const q = new URLSearchParams(location.search);
      if (q.has('noauto')) ok = false;
      if ((navigator as Navigator & { webdriver?: boolean }).webdriver) ok = false;
      const mark = localStorage.getItem(KEY);
      if (mark !== null) ok = false; // already decided automatically, or chosen by hand
      else if (localStorage.getItem(QUALITY_KEY) !== null) ok = false; // a hand-set quality from before the marker existed
    } catch {
      /* storage unavailable: still fine to run, nothing to read */
    }
    if (ctx.renderer.quality !== 'high') ok = false;
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
  }

  /** Once per HUD update (frame). */
  update(): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (document.hidden) {
      this.restart();
      return;
    }
    const prev = this.last;
    this.last = now;
    if (prev === 0 || now - this.t0 < WARMUP_MS) return;
    const d = (now - prev) / 1000;
    if (d >= 1) return; // a pause / a stall: not a frame rate sample
    if (d < 0.006) {
      // faster than any display: the simulation is being fast-forwarded
      this.frames = 0;
      this.time = 0;
      this.slow = 0;
      return;
    }
    this.frames++;
    this.time += d;
    if (this.time < BUCKET) return;
    const fps = this.frames / this.time;
    this.frames = 0;
    this.time = 0;
    if (fps >= FPS_LIMIT) {
      this.slow = 0;
      return;
    }
    this.slow += BUCKET;
    if (this.slow >= NEED_SECONDS) this.fire();
  }

  private fire(): void {
    const r = this.ctx.renderer;
    this.enabled = false; // one shot, whatever happens
    if (r.quality !== 'high') return;
    try {
      if (localStorage.getItem(KEY) === 'manual') return; // the player took over meanwhile
      localStorage.setItem(KEY, 'low');
    } catch {
      /* storage unavailable */
    }
    r.setQuality('low');
    this.slow = 0;
    this.notify();
  }
}
