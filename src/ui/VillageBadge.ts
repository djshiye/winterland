/**
 * [B4] Village badge under the money pill: house icon, level name, villager count and a slim progress bar toward the
 * next village level. Hidden until the village is revealed (checked every frame, so a restored save shows it too).
 */
import { VILLAGE } from '../config';
import type { GameContext } from '../core/types';
import { eraLabel, romanNumeral } from '../world/env/eras';
import { backOut, h } from './dom';
import { ICON_HOUSE, ICON_PERSON } from './icons';
import './era.css';

export class VillageBadge {
  private readonly root: HTMLDivElement;
  private readonly nameEl: HTMLSpanElement;
  private readonly popEl: HTMLSpanElement;
  private readonly fill: HTMLDivElement;
  private shown = false;
  private appear = 0;
  private bump = 0;
  private barShown = 0;
  private barSnap = true;
  private lastName = '';
  private lastPop = -1;
  private lastBar = '';
  private lastTransform = '';
  private lastOpacity = '';

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.root = h('div', 'wl-village');
    this.root.style.display = 'none';
    this.root.appendChild(h('div', 'wl-village-icon', ICON_HOUSE));
    const mid = h('div', 'wl-village-mid');
    const top = h('div', 'wl-village-top');
    this.nameEl = h('span', 'wl-village-name');
    this.popEl = h('span', 'wl-village-pop');
    top.append(this.nameEl, this.popEl);
    const bar = h('div', 'wl-village-bar');
    this.fill = h('div', 'wl-village-fill');
    bar.appendChild(this.fill);
    mid.append(top, bar);
    this.root.appendChild(mid);
    layer.appendChild(this.root);

    ctx.events.on('village:levelUp', () => {
      this.bump = 1;
    });
    ctx.events.on('village:revealed', () => this.reveal());
  }

  /** The layer toggles a class so the phone layout can move the objective banner down. */
  get visible(): boolean {
    return this.shown;
  }

  private reveal(): void {
    if (this.shown) return;
    this.shown = true;
    this.appear = 0;
    this.barSnap = true;
    this.root.style.display = 'flex';
  }

  update(dt: number): boolean {
    const v = this.ctx.state.village;
    if (!this.shown && v.revealed) {
      this.shown = true;
      this.appear = 1; // restored game: already there
      this.barSnap = true;
      this.root.style.display = 'flex';
    }
    if (!this.shown) return false;

    const lvDef = VILLAGE.levels[Math.min(v.level, VILLAGE.levels.length - 1)]!;
    if (lvDef.name !== this.lastName) {
      this.lastName = lvDef.name;
      // wave 9: the era numeral ("Era III · Town"); the starting Camp has no number
      this.nameEl.innerHTML = '';
      const lv = Math.min(v.level, VILLAGE.levels.length - 1);
      if (lv > 0) this.nameEl.append(h('span', 'wl-village-era', `Era ${romanNumeral(lv)} \u00b7`), lvDef.name);
      else this.nameEl.textContent = lvDef.name;
      this.nameEl.title = eraLabel(lv);
    }
    if (v.population !== this.lastPop) {
      this.lastPop = v.population;
      this.popEl.innerHTML = `<i class="wl-village-person">${ICON_PERSON}</i>${v.population}`;
    }

    // progress toward the next level (full at the last two levels: Winter City waits for the Great Lodge)
    const next = VILLAGE.levels[v.level + 1];
    let target = 1;
    let maxed = true;
    if (next && Number.isFinite(next.minPopulation)) {
      maxed = false;
      const span = Math.max(1, next.minPopulation - lvDef.minPopulation);
      target = Math.max(0, Math.min(1, (v.population - lvDef.minPopulation) / span));
    }
    if (this.barSnap) {
      this.barShown = target;
      this.barSnap = false;
    } else {
      this.barShown += (target - this.barShown) * (1 - Math.exp(-6 * dt));
      if (Math.abs(target - this.barShown) < 0.002) this.barShown = target;
    }
    const bar = `scaleX(${this.barShown.toFixed(3)})`;
    if (bar !== this.lastBar) {
      this.lastBar = bar;
      this.fill.style.transform = bar;
    }
    this.root.classList.toggle('is-max', maxed);

    let sc = 1;
    if (this.appear < 1) {
      this.appear = Math.min(1, this.appear + dt / 0.45);
      sc = 0.2 + 0.8 * backOut(this.appear);
      const op = Math.min(1, this.appear * 3).toFixed(2);
      if (op !== this.lastOpacity) {
        this.lastOpacity = op;
        this.root.style.opacity = op;
      }
    }
    if (this.bump > 0) {
      this.bump = Math.max(0, this.bump - dt / 0.6);
      sc *= 1 + 0.18 * Math.sin(Math.PI * (1 - this.bump));
    }
    const tf = sc === 1 ? '' : `scale(${sc.toFixed(3)})`;
    if (tf !== this.lastTransform) {
      this.lastTransform = tf;
      this.root.style.transform = tf;
    }
    return true;
  }
}
