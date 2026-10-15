/**
 * [0.9.0 Ages — UI] Shared open / close / shake behaviour of the bottom-sheet cards (ManagePanel, ChoosePanel): the
 * BuildPanel's look (build.css `.wl-build`, a bottom sheet on phones and a side card on wide screens) with a
 * simulation-time slide and a short "no" shake. The owner appends `root` to the HUD layer and calls update(dt).
 */
import { backOut, cubicOut, h, shield, Slide } from './dom';

const SHAKE_TIME = 0.32;

export class Sheet {
  readonly root: HTMLDivElement;
  private readonly slide = new Slide();
  private shakeT = -1;
  private shakeShown = '';

  constructor(className: string, layer: HTMLElement) {
    this.root = h('div', `wl-build ${className}`);
    shield(this.root);
    this.root.style.display = 'none';
    layer.appendChild(this.root);
  }

  /** True while the card is (or is animating to be) on screen. */
  get visible(): boolean {
    return this.slide.open;
  }

  /** Slide in / out. */
  setOpen(open: boolean): void {
    this.slide.open = open;
  }

  /** A short sideways shake (a refused tap). */
  shake(): void {
    this.shakeT = 0;
  }

  update(dt: number): void {
    const s = this.slide;
    if (s.step(dt, 0.26) || s.k > 0) {
      if (s.k <= 0) {
        this.root.style.display = 'none';
      } else {
        if (this.root.style.display === 'none') this.root.style.display = 'flex';
        const e = s.open ? backOut(Math.min(1, s.k)) : cubicOut(s.k);
        this.root.style.setProperty('--k', e.toFixed(3));
        this.root.style.opacity = Math.min(1, s.k * 3).toFixed(2);
      }
    }
    if (this.shakeT >= 0) {
      this.shakeT += dt;
      const t = this.shakeT / SHAKE_TIME;
      const px = t >= 1 ? '' : `${(Math.sin(t * 38) * 7 * (1 - t)).toFixed(1)}px`;
      if (t >= 1) this.shakeT = -1;
      if (px !== this.shakeShown) {
        this.shakeShown = px;
        if (px) this.root.style.setProperty('--sx', px);
        else this.root.style.removeProperty('--sx');
      }
    }
  }
}
