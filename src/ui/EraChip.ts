/**
 * [0.9.0 Ages — UI] Two small HUD pieces about the growing city.
 * - EraChip: a compact chip "ERA III · IRON AGE" with the city rank and population under it. It appears once the climb
 *   opens (the Great Lodge: the new land shows, eras/gate.ts) or era 2 was reached and opens the map when tapped. Follows state.eras.age, 'era:unlocked'
 *   and 'city:changed' { population, rank }.
 *   0.9.0 climb (docs/EXPANSION.md §C): while the next era's gate is open the chip is the ONE next goal instead: a
 *   progress ring for the checklist, "ERA I · SURVIVAL  12/23 · S5/5" and "Next: Sharp Axe → Lv 10 ($42K)"
 *   (eras/gate.ts nextGoal, re-read 4× a second), "Frontier is for sale!" once ready. Tapping it opens the GateCard
 *   ('gate:open'); it pulses on each 'gate:progress' that finished a row.
 *   Once a level has passed its hard cap, a small Mastery tag "✦ 340 · +41%" sits after the era name (desktop; the
 *   GateCard shows the full line on every screen). Re-read on 'upgrade:bought' only.
 * - IncomeFeed: aggregates 'income' events (rent, business, interest, trade, Jack) into one "+$12.5K city" line every
 *   few seconds next to the money pill (never one line per event). Pure aggregation lives in agesLogic.IncomeTicker.
 * Both animate on simulation time from update(dt).
 */
import type { GameContext } from '../core/types';
import { CITY_RANKS, ERAS } from '../eras/data';
import { climbOpen, gateCount, gateNote, nextGoal } from '../eras/gate';
import { masteryTotal } from '../core/demand';
import { masteryMult } from '../core/ladder';
import { cityStanding, eraChipVisible, eraRoman, formatPopulation, IncomeTicker, masteryTag, rankName } from './agesLogic';
import { cubicOut, h, onTap, shield } from './dom';
import { hexCss } from './icons';

/** Seconds between next-goal reads (nextGoal prices the whole checklist). */
const GOAL_EVERY = 0.25;
/** Circumference of the progress ring (r = 9 in a 24-unit box). */
const RING = 2 * Math.PI * 9;
const ICON_RING = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="wl-ring-bg" cx="12" cy="12" r="9"/><circle class="wl-ring-fg" cx="12" cy="12" r="9" stroke-dasharray="${RING.toFixed(2)}" stroke-dashoffset="${RING.toFixed(2)}"/></svg>`;
import './ages.css';

export class EraChip {
  private readonly root: HTMLButtonElement;
  private readonly eraEl: HTMLSpanElement;
  private readonly cityEl: HTMLSpanElement;
  private readonly dot: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly ringFg: SVGCircleElement;
  private readonly countEl: HTMLSpanElement;
  private readonly masteryEl: HTMLSpanElement;
  private masteryDirty = true;
  private lastMastery = '';
  private shown = false;
  /** The next era's gate is on show (climb open, an era left to reach). */
  private gating = false;
  private goalAcc = GOAL_EVERY;
  private lastCount = '';
  private lastRing = -1;
  private pulse = 0;
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
    this.ring = h('i', 'wl-erachip-ring', ICON_RING);
    this.ringFg = this.ring.querySelector('.wl-ring-fg') as SVGCircleElement;
    this.ring.style.display = 'none';
    const text = h('span', 'wl-erachip-text');
    const top = h('span', 'wl-erachip-top');
    this.eraEl = h('span', 'wl-erachip-era');
    this.countEl = h('span', 'wl-erachip-count');
    this.masteryEl = h('span', 'wl-erachip-mastery');
    top.append(this.eraEl, this.countEl, this.masteryEl);
    this.cityEl = h('span', 'wl-erachip-city');
    text.append(top, this.cityEl);
    this.root.append(this.dot, this.ring, text);
    this.root.style.display = 'none';
    layer.appendChild(this.root);
    onTap(this.root, () => {
      ctx.audio.unlock();
      ctx.audio.play('click');
      if (this.gating) ctx.events.emit('gate:open', {});
      else ctx.events.emit('map:open', {});
    });
    ctx.events.on('gate:progress', (e) => {
      this.goalAcc = GOAL_EVERY; // re-read the goal at once
      if (e.gained > 0 || e.readyNow) this.pulse = 1;
    });
    ctx.events.on('upgrade:bought', () => {
      this.masteryDirty = true;
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

  update(dt: number): void {
    const { state } = this.ctx;
    const age = state.eras.age;
    const show = eraChipVisible(age, climbOpen(state));
    if (show !== this.shown) {
      this.shown = show;
      this.root.style.display = show ? '' : 'none';
    }
    if (!show) return;
    const gating = climbOpen(state) && !!ERAS[age + 1];
    if (gating !== this.gating) {
      this.gating = gating;
      this.root.classList.toggle('is-gate', gating);
      this.root.setAttribute('aria-label', gating ? 'Open the era checklist' : 'Open the map');
      this.dot.style.display = gating ? 'none' : '';
      this.ring.style.display = gating ? '' : 'none';
      if (!gating) this.setText(this.countEl, 'lastCount', '');
      this.lastCity = '';
      this.goalAcc = GOAL_EVERY;
    }
    if (this.pulse > 0) {
      this.pulse = Math.max(0, this.pulse - dt / 0.4);
      this.root.style.transform = this.pulse > 0 ? `scale(${(1 + 0.08 * Math.sin(Math.PI * (1 - this.pulse))).toFixed(3)})` : '';
    }
    const n = Math.max(1, age);
    const era = n >= 2 ? `ERA ${eraRoman(n)} · ${ERAS[n]!.name.toUpperCase()}` : 'ERA I · SURVIVAL';
    if (era !== this.lastEra) {
      this.lastEra = era;
      this.eraEl.textContent = era;
    }
    if (this.masteryDirty) {
      this.masteryDirty = false;
      const points = masteryTotal(state);
      const tag = points > 0 ? masteryTag(points, masteryMult(points)) : '';
      if (tag !== this.lastMastery) {
        this.lastMastery = tag;
        this.masteryEl.textContent = tag;
      }
    }
    if (age !== this.lastAge) {
      this.lastAge = age;
      this.dot.style.background = n >= 2 ? hexCss(ERAS[n]!.colors.accent) : '#ffd84a';
    }
    if (gating) {
      this.goalAcc += dt;
      if (this.goalAcc >= GOAL_EVERY) {
        this.goalAcc = 0;
        this.updateGoal(age + 1);
      }
      return;
    }
    const city = `${rankName(Math.min(this.rank, CITY_RANKS.length - 1))} · ${formatPopulation(this.population)} people`;
    if (city !== this.lastCity) {
      this.lastCity = city;
      this.cityEl.textContent = city;
      this.root.classList.remove('is-ready');
    }
  }

  /** The gate count, the ring and the single next goal (or "<Region> is for sale!"). */
  private updateGoal(n: number): void {
    const { state, economy } = this.ctx;
    const c = gateCount(state, n);
    this.setText(this.countEl, 'lastCount', gateNote({ ok: c.ok, total: c.total, settlement: { level: c.settlement }, settlementNeed: c.settlementNeed }));
    const k = c.total > 0 ? (c.ok + (c.settlement >= c.settlementNeed ? 1 : 0)) / (c.total + 1) : 0;
    const ring = Math.round(k * 200);
    if (ring !== this.lastRing) {
      this.lastRing = ring;
      this.ringFg.setAttribute('stroke-dashoffset', (RING * (1 - k)).toFixed(2));
    }
    const goal = nextGoal(state, economy.money);
    const text = goal ? (c.ready ? goal.text : `Next: ${goal.text}`) : '';
    if (text !== this.lastCity) {
      this.lastCity = text;
      this.cityEl.textContent = text;
      this.root.classList.toggle('is-ready', c.ready);
    }
  }

  private setText(el: HTMLElement, key: 'lastCount', text: string): void {
    if (this[key] === text) return;
    this[key] = text;
    el.textContent = text;
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
