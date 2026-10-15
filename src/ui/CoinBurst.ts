/**
 * [B4] Coin burst: a handful of gold DOM coins that pop out of a screen point and arc into the money pill (quest
 * rewards). Pooled elements, positions driven from update(dt) on simulation time; `onArrive` fires per coin that lands
 * (the HUD bumps the pill, plays a tick).
 */
import { h } from './dom';
import { ICON_COIN } from './icons';

interface Coin {
  el: HTMLDivElement;
  active: boolean;
  age: number;
  delay: number;
  dur: number;
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
}

const POOL = 16;

export class CoinBurst {
  private readonly coins: Coin[] = [];
  private live = 0;

  /** Called once for every coin that reaches the target. */
  onArrive: (() => void) | null = null;

  constructor(layer: HTMLElement) {
    for (let i = 0; i < POOL; i++) {
      const el = h('div', 'wl-coin', ICON_COIN);
      el.style.display = 'none';
      layer.appendChild(el);
      this.coins.push({ el, active: false, age: 0, delay: 0, dur: 1, x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0 });
    }
  }

  /** `count` coins from (x0, y0) to (x1, y1), both in HUD pixels. */
  spawn(count: number, x0: number, y0: number, x1: number, y1: number): void {
    let made = 0;
    for (const c of this.coins) {
      if (made >= count) break;
      if (c.active) continue;
      const a = (made / count) * Math.PI * 2 + Math.random() * 0.8;
      const r = 50 + Math.random() * 60;
      c.active = true;
      c.age = 0;
      c.delay = made * 0.045;
      c.dur = 0.62 + Math.random() * 0.2;
      c.x0 = x0;
      c.y0 = y0;
      // control point: out to the side, then swing into the pill
      c.cx = x0 + Math.cos(a) * r;
      c.cy = y0 + Math.sin(a) * r * 0.7 - 30;
      c.x1 = x1;
      c.y1 = y1;
      c.el.style.display = 'block';
      c.el.style.opacity = '0';
      made++;
      this.live++;
    }
  }

  update(dt: number): void {
    if (this.live === 0) return;
    for (const c of this.coins) {
      if (!c.active) continue;
      c.age += dt;
      const t = (c.age - c.delay) / c.dur;
      if (t < 0) continue;
      if (t >= 1) {
        c.active = false;
        c.el.style.display = 'none';
        this.live--;
        this.onArrive?.();
        continue;
      }
      const e = t * t * (3 - 2 * t);
      const u = 1 - e;
      const x = u * u * c.x0 + 2 * u * e * c.cx + e * e * c.x1;
      const y = u * u * c.y0 + 2 * u * e * c.cy + e * e * c.y1;
      const s = 0.6 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.4)) + 0.2 * (1 - t);
      c.el.style.opacity = t < 0.1 ? (t / 0.1).toFixed(2) : '1';
      c.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${s.toFixed(3)})`;
    }
  }
}
