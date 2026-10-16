/**
 * 0.9.2: the centred banners (objective, rush hour, world event) never sit on top of each other or on the HUD around
 * them. Each used to have its own hard-coded `top` in hud.css / ages.css, which broke as soon as the objective moved
 * (the era chip pushes it under the button row) or the left column (village badge, quests, contract) grew wide.
 *
 * Wide screens (> PHONE_MAX): a column from the objective's own CSS spot downward, objective first, then rush, then
 *   event, GAP apart. Each banner is centred on the screen when that is clear of the HUD on its rows, else centred in
 *   the free room between the left and right HUD elements (narrowed to fit, text wraps).
 * Phones: rush and event stay bottom-centre (hud.css); the event sits right above the rush pill, and the objective,
 *   when the open quest list parks it at the bottom, sits above both.
 * Toasts follow through two CSS variables on the layer: --wl-banner-bottom (wide: the big centre toast starts below the
 *   column) and --wl-pill-stack (phones: the small bottom toast sits above the pills).
 *
 * Pure layout in `freeSpan` / `centreIn` (tests/bannerStack.test.ts); BannerStack does the DOM reads and writes,
 * a few times a second (HUD.update), touching only `left`, `max-width` and the computed `top` / `bottom`.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Widest phone layout in hud.css (the rush / event pills move to the bottom at or below this). */
export const PHONE_MAX = 640;
/** Space between two stacked banners and between a banner and the HUD beside it (px). */
export const GAP = 8;
/** Seconds between two layout passes (the banners move with tweens; this only has to follow their sizes). */
const INTERVAL = 0.1;

/**
 * Horizontal room for a banner spanning rows [top, bottom] on a screen `width` wide: from the right edge of the
 * HUD boxes left of the centre that share those rows, to the left edge of the ones right of it (GAP clear of both,
 * `margin` from the screen edges). Boxes that do not share the rows are ignored.
 */
export function freeSpan(width: number, obstacles: readonly Box[], top: number, bottom: number, margin: number): { min: number; max: number } {
  let min = margin;
  let max = width - margin;
  const mid = width / 2;
  for (const o of obstacles) {
    if (o.bottom <= top || o.top >= bottom) continue;
    if ((o.left + o.right) / 2 < mid) min = Math.max(min, o.right + GAP);
    else max = Math.min(max, o.left - GAP);
  }
  if (max < min) max = min;
  return { min, max };
}

/** Centre x for a banner `w` wide: the screen centre when it fits in the span there, else the span's own centre. */
export function centreIn(width: number, span: { min: number; max: number }, w: number): number {
  const mid = width / 2;
  if (mid - w / 2 >= span.min && mid + w / 2 <= span.max) return mid;
  const half = Math.min(w, span.max - span.min) / 2;
  return Math.max(span.min + half, Math.min(span.max - half, (span.min + span.max) / 2));
}

/** HUD children that are never obstacles: the managed banners themselves, effects, modals and transient cards. */
const IGNORE = /\b(wl-objective|wl-rush|wl-event|wl-float|wl-coin|wl-edge|wl-toast|wl-hand|wl-perf|wl-modal|wl-era|wl-chip)\b/;

const shown = (el: HTMLElement): boolean => el.offsetParent !== null && el.style.visibility !== 'hidden';

export class BannerStack {
  private acc = INTERVAL;
  private phone: boolean | null = null;

  constructor(
    private readonly layer: HTMLElement,
    private readonly objective: HTMLElement,
    /** The objective banner has text (it can be fading in or out). */
    private readonly objectiveOn: () => boolean,
    private readonly rush: HTMLElement,
    private readonly event: HTMLElement,
  ) {}

  update(dt: number): void {
    this.acc += dt;
    if (this.acc < INTERVAL) return;
    this.acc = 0;
    const width = this.layer.clientWidth;
    if (width <= 0) return;
    const phone = width <= PHONE_MAX;
    if (phone !== this.phone) {
      // a resize across the breakpoint: back to the stylesheet's spots before laying out the other way
      for (const el of [this.objective, this.rush, this.event]) {
        el.style.left = '';
        el.style.top = '';
        el.style.bottom = '';
        el.style.maxWidth = '';
      }
      this.phone = phone;
      this.layer.style.removeProperty('--wl-banner-bottom');
      this.layer.style.removeProperty('--wl-pill-stack');
    }
    if (phone) this.layoutPhone();
    else this.layoutWide(width);
  }

  private layoutWide(width: number): void {
    const obstacles: Box[] = [];
    for (const child of Array.from(this.layer.children) as HTMLElement[]) {
      if (IGNORE.test(child.className) || !shown(child)) continue;
      const r = child.getBoundingClientRect();
      // full-screen sheets and modals are not something to dodge
      if (r.width < 2 || r.height < 2 || r.width > width * 0.6) continue;
      obstacles.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    const margin = 12;
    // the column starts where the stylesheet puts the objective (top only: its transform is the fade-in tween)
    let y = this.objective.offsetTop;
    const list: [HTMLElement, boolean][] = [
      [this.objective, this.objectiveOn()],
      [this.rush, shown(this.rush)],
      [this.event, shown(this.event)],
    ];
    for (const [el, on] of list) {
      if (!on) continue;
      if (el !== this.objective) this.set(el, 'top', y);
      el.style.maxWidth = '';
      let h = el.offsetHeight;
      const span = freeSpan(width, obstacles, y, y + h, margin);
      const room = span.max - span.min;
      if (el.offsetWidth > room) {
        el.style.maxWidth = `${Math.round(room)}px`;
        h = el.offsetHeight;
      }
      this.set(el, 'left', centreIn(width, span, el.offsetWidth));
      y += h + GAP;
    }
    // the big centre toast ("Quest complete!") starts below the column (hud.css .wl-toast)
    this.setVar('--wl-banner-bottom', y);
  }

  private layoutPhone(): void {
    const height = this.layer.clientHeight;
    // the rush pill keeps its stylesheet spot; the event goes right above it while both show
    let stackTop = Infinity;
    if (shown(this.rush)) stackTop = this.rush.offsetTop;
    if (shown(this.event)) {
      if (stackTop < Infinity) this.set(this.event, 'bottom', height - stackTop + GAP);
      else this.event.style.bottom = '';
      stackTop = Math.min(stackTop, this.event.offsetTop);
    }
    // the small bottom toast goes above the pills (hud.css .wl-toast.is-small)
    this.setVar('--wl-pill-stack', stackTop === Infinity ? 0 : height - stackTop + GAP);
    // the objective parked at the bottom (quest list open): above the pills
    const obj = this.objective;
    if (!this.isParked() || stackTop === Infinity) {
      if (obj.style.bottom) obj.style.bottom = '';
      return;
    }
    obj.style.bottom = '';
    const cssBottom = height - obj.offsetTop - obj.offsetHeight;
    const need = height - stackTop + GAP;
    if (cssBottom < need) this.set(obj, 'bottom', need);
  }

  /** The stylesheet puts the objective at the bottom (phones with the quest list open). */
  private isParked(): boolean {
    return this.layer.classList.contains('quests-open');
  }

  private setVar(name: string, px: number): void {
    const v = `${Math.round(px)}px`;
    if (this.layer.style.getPropertyValue(name) !== v) this.layer.style.setProperty(name, v);
  }

  private set(el: HTMLElement, prop: 'left' | 'top' | 'bottom', px: number): void {
    const v = `${Math.round(px)}px`;
    if (el.style[prop] !== v) el.style[prop] = v;
  }
}
