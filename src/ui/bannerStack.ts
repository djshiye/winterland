/**
 * 0.9.2: the centred banners (objective, rush hour, world event) never sit on top of each other or on the HUD around
 * them. Each used to have its own hard-coded `top` in hud.css / ages.css, which broke as soon as the objective moved
 * (the era chip pushes it under the button row) or the left column (village badge, quests, contract) grew wide.
 *
 * Wide screens (> PHONE_MAX): a column from the objective's own CSS spot downward, objective first, then rush, then
 *   event, GAP apart. Each banner is centred on the screen when that is clear of the HUD on its rows, else centred in
 *   the free room between the left and right HUD elements (narrowed to fit, text wraps).
 * Phones: rush and event stay bottom-centre (hud.css); the event sits right above the rush pill. 0.9.12 (P2, P4): the
 *   objective sits GAP under the lowest piece of the top HUD (money pill, buttons, village badge, season chip, quests
 *   chip with the era chip beside it, contract chip), measured, so a contract or season chip never covers it, and it
 *   never moves when the quest list opens: the list drops below the banner instead (it used to park the banner at the
 *   bottom of the screen).
 * Toasts follow through two CSS variables on the layer: --wl-banner-bottom (wide: the big centre toast starts below the
 *   column) and --wl-pill-stack (phones: the small bottom toast sits above the pills).
 *
 * 0.9.7: everything is laid out in the banners' own px (screen px ÷ the Interface size, fx/comfort uiScale).
 * Pure layout in `freeSpan` / `centreIn` (tests/bannerStack.test.ts); BannerStack does the DOM reads and writes,
 * a few times a second (HUD.update), touching only `left`, `max-width` and the computed `top` / `bottom`.
 */

import { uiScale } from '../fx/comfort';

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
/** Narrowest room (px) a wide-screen banner is drawn in; narrower, it waits out of sight (a side sheet is open). */
export const MIN_ROOM = 220;
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

/**
 * [PURE] Phones: the objective's top, GAP below the lowest of the top-HUD boxes' bottoms (`floor` when none show).
 */
export function phoneObjectiveTop(bottoms: readonly number[], floor: number): number {
  let y = floor;
  for (const b of bottoms) if (Number.isFinite(b)) y = Math.max(y, b + GAP);
  return y;
}

/**
 * [PURE] Phones, quest list open: how far to push the list down so it starts GAP below the objective banner (0 when the
 * banner already ends above where the list starts, or there is no banner).
 */
export function questListShift(listTop: number, objectiveBottom: number | null): number {
  if (objectiveBottom === null) return 0;
  return Math.max(0, Math.round(objectiveBottom + GAP - listTop));
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

/** Phones: the top-HUD pieces the objective goes under (folded quest list / open quest list). */
const PHONE_TOP = '.wl-money, .wl-mute, .wl-hudbtn, .wl-village, .wl-season, .wl-quests-head, .wl-erachip, .wl-contract';
const PHONE_TOP_OPEN = '.wl-money, .wl-mute, .wl-hudbtn, .wl-village, .wl-season, .wl-quests-head, .wl-erachip';

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
    const screenW = this.layer.clientWidth;
    if (screenW <= 0) return;
    const phone = screenW <= PHONE_MAX;
    // 0.9.7: the banners are zoomed by the Interface size (ui/comfort.css), so lay out in their own (unzoomed) px
    const k = uiScale();
    const width = screenW / k;
    if (phone !== this.phone) {
      // a resize across the breakpoint: back to the stylesheet's spots before laying out the other way
      for (const el of [this.objective, this.rush, this.event]) {
        el.classList.remove('is-squeezed');
        el.style.left = '';
        el.style.top = '';
        el.style.bottom = '';
        el.style.maxWidth = '';
      }
      this.layer.querySelector<HTMLElement>('.wl-quests-body')?.style.removeProperty('margin-top');
      this.phone = phone;
      this.layer.style.removeProperty('--wl-banner-bottom');
      this.layer.style.removeProperty('--wl-pill-stack');
    }
    if (phone) this.layoutPhone();
    else this.layoutWide(width, screenW);
  }

  private layoutWide(width: number, screenW: number): void {
    const k = screenW / width;
    const obstacles: Box[] = [];
    for (const child of Array.from(this.layer.children) as HTMLElement[]) {
      if (IGNORE.test(child.className) || !shown(child)) continue;
      const r = child.getBoundingClientRect();
      // full-screen sheets and modals are not something to dodge
      if (r.width < 2 || r.height < 2 || r.width > screenW * 0.6) continue;
      obstacles.push({ left: r.left / k, top: r.top / k, right: r.right / k, bottom: r.bottom / k });
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
      // 0.9.12: a side sheet (market, shop) leaves a sliver: step aside until it closes rather than a word per line
      const squeezed = room < MIN_ROOM;
      if (el.classList.contains('is-squeezed') !== squeezed) el.classList.toggle('is-squeezed', squeezed);
      if (squeezed) continue;
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
    const k = uiScale();
    const height = this.layer.clientHeight / k;
    this.placePhoneObjective(k);
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
  }

  /**
   * Phones: the objective GAP under the top HUD (layer px ÷ the Interface size `k`), and an open quest list pushed below
   * it. The quest list and the contract chip under it only count while the list is folded (open, they go under the banner).
   */
  private placePhoneObjective(k: number): void {
    const layer = this.layer;
    const top = layer.getBoundingClientRect().top;
    const open = layer.classList.contains('quests-open');
    const body = layer.querySelector<HTMLElement>('.wl-quests-body');
    const sel = open ? PHONE_TOP_OPEN : PHONE_TOP;
    const bottoms: number[] = [];
    for (const el of Array.from(layer.querySelectorAll<HTMLElement>(sel))) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 2 || r.top - top > layer.clientHeight / 2) continue; // bottom-row buttons are not the top HUD
      bottoms.push((r.bottom - top) / k);
    }
    const obj = this.objective;
    if (obj.style.bottom) obj.style.bottom = '';
    this.set(obj, 'top', phoneObjectiveTop(bottoms, 12));
    if (!body) return;
    let shift = 0;
    if (open && this.objectiveOn()) {
      body.style.marginTop = '';
      const listTop = (body.getBoundingClientRect().top - top) / k;
      shift = questListShift(listTop, obj.offsetTop + obj.offsetHeight);
    }
    const m = shift > 0 ? `${shift}px` : '';
    if (body.style.marginTop !== m) body.style.marginTop = m;
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
