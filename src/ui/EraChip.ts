/**
 * [0.9.0 Ages — UI] Two small HUD pieces about the growing city.
 * - EraChip: a compact chip "ERA III · IRON AGE" with the city rank and population under it. It appears once the climb
 *   opens (the Great Lodge: the new land shows, eras/gate.ts) or era 2 was reached and opens the map when tapped. Follows state.eras.age, 'era:unlocked'
 *   and 'city:changed' { population, rank }.
 * - IncomeFeed: aggregates 'income' events (rent, business, interest, trade, Jack) into one "+$12.5K city" line every
 *   few seconds next to the money pill (never one line per event). Pure aggregation lives in agesLogic.IncomeTicker.
 * Both animate on simulation time from update(dt).
 */
import type { GameContext } from '../core/types';
import { CITY_RANKS, ERAS } from '../eras/data';
import { climbOpen } from '../eras/gate';
import { cityStanding, eraChipVisible, eraRoman, formatPopulation, IncomeTicker, rankName } from './agesLogic';
import { cubicOut, h, onTap, shield } from './dom';
import { hexCss } from './icons';
import './ages.css';

export class EraChip {
  private readonly root: HTMLButtonElement;
  private readonly eraEl: HTMLSpanElement;
  private readonly cityEl: HTMLSpanElement;
  private readonly dot: HTMLElement;
  private shown = false;
  private population: number;
  private rank: number;
  private lastEra = '';
  private lastCity = '';
  private lastAge = 0;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    // a restored save emits no 'city:changed' (City recomputes silently): seed from the merged state
    ({ population: this.population, rank: this.rank } = cityStanding(ctx.state));
    this.root = h('button', 'wl-erachip');
    this.root.type = 'button';
    this.root.setAttribute('aria-label', 'Open the map');
    shield(this.root);
    this.dot = h('i', 'wl-erachip-dot');
    const text = h('span', 'wl-erachip-text');
    this.eraEl = h('span', 'wl-erachip-era');
    this.cityEl = h('span', 'wl-erachip-city');
    text.append(this.eraEl, this.cityEl);
    this.root.append(this.dot, text);
    this.root.style.display = 'none';
    layer.appendChild(this.root);
    onTap(this.root, () => {
      ctx.audio.unlock();
      ctx.audio.play('click');
      ctx.events.emit('map:open', {});
    });
    ctx.events.on('city:changed', (e) => {
      this.population = e.population;
      this.rank = e.rank;
    });
  }

  /** True while the chip is on show. */
  get visible(): boolean {
    return this.shown;
  }

  update(_dt: number): void {
    const { state } = this.ctx;
    const age = state.eras.age;
    const show = eraChipVisible(age, climbOpen(state));
    if (show !== this.shown) {
      this.shown = show;
      this.root.style.display = show ? '' : 'none';
    }
    if (!show) return;
    const n = Math.max(1, age);
    const era = n >= 2 ? `ERA ${eraRoman(n)} · ${ERAS[n]!.name.toUpperCase()}` : 'ERA I · SURVIVAL';
    if (era !== this.lastEra) {
      this.lastEra = era;
      this.eraEl.textContent = era;
    }
    if (age !== this.lastAge) {
      this.lastAge = age;
      this.dot.style.background = n >= 2 ? hexCss(ERAS[n]!.colors.accent) : '#ffd84a';
    }
    const city = `${rankName(Math.min(this.rank, CITY_RANKS.length - 1))} · ${formatPopulation(this.population)} people`;
    if (city !== this.lastCity) {
      this.lastCity = city;
      this.cityEl.textContent = city;
    }
  }
}

/** Seconds a batch stays on screen. */
const FEED_SHOW = 2.6;

export class IncomeFeed {
  private readonly el: HTMLDivElement;
  private readonly ticker = new IncomeTicker(3);
  private age = -1;

  constructor(ctx: GameContext, host: HTMLElement) {
    this.el = h('div', 'wl-income');
    this.el.style.display = 'none';
    host.appendChild(this.el);
    ctx.events.on('income', (e) => this.ticker.add(e.source, e.amount));
  }

  update(dt: number): void {
    const batch = this.ticker.update(dt);
    if (batch) {
      this.el.textContent = batch.text;
      this.age = 0;
      this.el.style.display = '';
    }
    if (this.age < 0) return;
    this.age += dt;
    if (this.age >= FEED_SHOW) {
      this.age = -1;
      this.el.style.display = 'none';
      return;
    }
    const k = this.age / FEED_SHOW;
    const pop = Math.min(1, this.age / 0.18);
    const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    this.el.style.opacity = (Math.min(1, pop * 2) * fade).toFixed(2);
    this.el.style.transform = `translateY(${(-6 * cubicOut(k) + (1 - pop) * 6).toFixed(1)}px)`;
  }
}
