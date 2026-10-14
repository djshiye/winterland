/**
 * [B4] Tiny performance readout (Settings -> Show FPS): "60 fps · 430 calls · 61k tris" in the bottom-left corner.
 * FPS is averaged over ~0.5 s of real frame time, the DOM is rewritten ~4× per second and only when the text changed.
 * Draw calls / triangles come from Renderer.stats (the last rendered frame, shadow pass included). The state
 * persists in localStorage 'winterland:perf' (default off).
 */
import type { GameContext } from '../core/types';
import { h } from './dom';

const KEY = 'winterland:perf';

export class PerfOverlay {
  private readonly el: HTMLDivElement;
  private on = false;
  private frames = 0;
  private time = 0;
  private prevFrames = 0;
  private prevTime = 0;
  private last = 0;
  private text = '';

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    try {
      this.on = localStorage.getItem(KEY) === '1';
    } catch {
      /* storage unavailable */
    }
    this.el = h('div', 'wl-perf', '-- fps');
    this.el.style.display = this.on ? '' : 'none';
    layer.appendChild(this.el);
  }

  get enabled(): boolean {
    return this.on;
  }

  set enabled(v: boolean) {
    this.on = v;
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    this.el.style.display = v ? '' : 'none';
    this.frames = this.time = this.prevFrames = this.prevTime = this.last = 0;
  }

  /** Called once per frame; measures real time (not the clamped simulation dt) so slow frames show up. */
  update(): void {
    if (!this.on) return;
    const now = performance.now() / 1000;
    if (this.last === 0) this.last = now;
    this.frames++;
    this.time += now - this.last;
    this.last = now;
    if (this.time < 0.25) return;
    // a 0.25 s bucket every update, FPS averaged over this bucket and the previous one (~0.5 s)
    const fps = (this.frames + this.prevFrames) / (this.time + this.prevTime);
    this.prevFrames = this.frames;
    this.prevTime = this.time;
    this.frames = 0;
    this.time = 0;
    const s = this.ctx.renderer.stats;
    const text = `${Math.round(fps)} fps · ${s.calls} calls · ${(s.triangles / 1000).toFixed(s.triangles < 10000 ? 1 : 0)}k tris`;
    if (text !== this.text) {
      this.text = text;
      this.el.textContent = text;
    }
  }
}
