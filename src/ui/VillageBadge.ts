/**
 * [B4] Village badge under the money pill: house icon, level name, villager count and a slim progress bar toward the
 * next village level. Hidden until the village is revealed (checked every frame, so a restored save shows it too).
 * 0.9.0 climb: past era 1 at Winterland it shows the settlement level instead ("12 · Forge Town", Arabic numerals:
 * easier to read than XII), the city population and the bar toward the next settlement level (docs/EXPANSION.md §B).
 */
import { HAPPINESS, VILLAGE } from '../config';
import { cityPopulation, settlementLevel, settlementName, settlementPop, townHappiness } from '../core/demand';
import type { GameContext } from '../core/types';
import { eraLabel, romanNumeral } from '../world/env/eras';
import { formatPopulation } from './agesLogic';
import { backOut, h } from './dom';
import { ICON_HOUSE, ICON_PERSON } from './icons';
import './era.css';
import { reducedMotion } from '../fx/comfort';

export class VillageBadge {
  private readonly root: HTMLDivElement;
  private readonly nameEl: HTMLSpanElement;
  private readonly popEl: HTMLSpanElement;
  private readonly happyEl: HTMLSpanElement;
  private readonly fill: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private shown = false;
  private appear = 0;
  private bump = 0;
  private barShown = 0;
  private barSnap = true;
  private lastName = '';
  private lastPop = -1;
  private lastHappy = -2;
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
    // Wave 12: town happiness chip (hidden until the Market Town is revealed)
    this.happyEl = h('span', 'wl-village-happy');
    this.happyEl.style.display = 'none';
    this.happyEl.setAttribute('role', 'img');
    top.append(this.nameEl, this.popEl, this.happyEl);
    const bar = h('div', 'wl-village-bar');
    // a real progress bar for screen readers (the visible fill alone said nothing)
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Growth to the next level');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    this.bar = bar;
    this.fill = h('div', 'wl-village-fill');
    bar.appendChild(this.fill);
    mid.append(top, bar);
    this.root.appendChild(mid);
    layer.appendChild(this.root);

    ctx.events.on('village:levelUp', () => {
      this.bump = 1;
    });
    ctx.events.on('settlement:levelUp', () => {
      this.bump = 1;
    });
    ctx.events.on('village:revealed', () => this.reveal());
    ctx.events.on('amenity:built', () => this.refreshHappy());
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

  /** The heart chip: "♥ 45%" (townHappiness x 100) once the town is revealed; refreshed on 'amenity:built'. */
  private refreshHappy(): void {
    const s = this.ctx.state;
    const pct = s.town.revealed ? Math.round(townHappiness(s) * 100) : -1;
    if (pct === this.lastHappy) return;
    this.lastHappy = pct;
    if (pct < 0) {
      this.happyEl.style.display = 'none';
      return;
    }
    this.happyEl.style.display = '';
    // 0.9.6: "Town" names it, so it never reads as the district card's "City happiness"
    this.happyEl.innerHTML = `<span class="wl-village-happy-l">Town</span><i class="wl-village-heart">\u2665</i><span class="wl-village-happy-n">${pct}%</span>`;
    // 0.9.12 (R1): it lifts only mill and Market Town sales (core/demand.ts salePrice), never the era exports
    const why = `Town happiness ${pct}%: mill and Market Town sales pay up to +${Math.round(HAPPINESS.priceBonus * 100)}% (now +${Math.round(HAPPINESS.priceBonus * pct)}%)`;
    this.happyEl.title = why;
    this.happyEl.setAttribute('aria-label', why);
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

    const s = this.ctx.state;
    if (v.level >= VILLAGE.levels.length - 1 && s.eras.age >= 2) return this.updateSettlement(dt);
    const lvDef = VILLAGE.levels[Math.min(v.level, VILLAGE.levels.length - 1)]!;
    if (lvDef.name !== this.lastName) {
      this.lastName = lvDef.name;
      // wave 9: the level numeral ("III · Town"; 0.9.0: no "Era" word, the Ages own it); the starting Camp has none
      this.nameEl.innerHTML = '';
      const lv = Math.min(v.level, VILLAGE.levels.length - 1);
      if (lv > 0) this.nameEl.append(h('span', 'wl-village-era', `${romanNumeral(lv)} \u00b7`), lvDef.name);
      else this.nameEl.textContent = lvDef.name;
      this.nameEl.title = eraLabel(lv);
    }
    if (v.population !== this.lastPop) {
      this.lastPop = v.population;
      this.popEl.innerHTML = `<i class="wl-village-person">${ICON_PERSON}</i>${formatPopulation(v.population)}`;
    }

    this.refreshHappy();

    // progress toward the next level (full at the last two levels: Winter City waits for the Great Lodge)
    const next = VILLAGE.levels[v.level + 1];
    let target = 1;
    let maxed = true;
    if (next && Number.isFinite(next.minPopulation)) {
      maxed = false;
      const span = Math.max(1, next.minPopulation - lvDef.minPopulation);
      target = Math.max(0, Math.min(1, (v.population - lvDef.minPopulation) / span));
    }
    return this.animate(dt, target, maxed);
  }

  /** Settlement 5..50 (past era 1): level + name, city population, bar from this level's population to the next. */
  private updateSettlement(dt: number): boolean {
    const s = this.ctx.state;
    const level = settlementLevel(s);
    const name = `${level} \u00b7 ${settlementName(level)}`;
    if (name !== this.lastName) {
      this.lastName = name;
      this.nameEl.innerHTML = '';
      this.nameEl.append(h('span', 'wl-village-era', `${level} \u00b7`), settlementName(level));
      this.nameEl.title = `Settlement ${level} \u00b7 ${settlementName(level)}`;
    }
    const pop = cityPopulation(s);
    if (pop !== this.lastPop) {
      this.lastPop = pop;
      // 0.9.12 (V5): "468K", not "468085" (the long number pushed the badge past its row)
      this.popEl.innerHTML = `<i class="wl-village-person">${ICON_PERSON}</i>${formatPopulation(pop)}`;
    }
    this.refreshHappy();
    // the next level must be in a band the age allows (level 5(k − 1) + j needs age ≥ k)
    const next = level + 1 <= 5 * s.eras.age ? settlementPop(level + 1) : null;
    if (next === null) return this.animate(dt, 1, true);
    const lo = settlementPop(level) ?? 0;
    return this.animate(dt, Math.max(0, Math.min(1, (pop - lo) / Math.max(1, next - lo))), false);
  }

  /** Bar, appear pop-in and level-up bump. */
  private animate(dt: number, target: number, maxed: boolean): boolean {
    const now = String(Math.round(target * 100));
    if (this.bar.getAttribute('aria-valuenow') !== now) this.bar.setAttribute('aria-valuenow', now);
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
      sc *= 1 + (reducedMotion() ? 0.03 : 0.18) * Math.sin(Math.PI * (1 - this.bump));
    }
    const tf = sc === 1 ? '' : `scale(${sc.toFixed(3)})`;
    if (tf !== this.lastTransform) {
      this.lastTransform = tf;
      this.root.style.transform = tf;
    }
    return true;
  }
}
