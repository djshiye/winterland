/**
 * [B4] The finale cards and the stats page, one card in four variants:
 * - 'lodge' (HUD on 'finale:start'): the Great Lodge stands. 0.9.7 (decision 3): no longer the ending: "Survival
 *   complete, Granite Hollow awaits" with era 1's stats and "On to Granite Hollow".
 * - 'market' (HUD on 'finale2:start'): "The Grand Market opens!" with the town's stats.
 * - 'complete' (0.9.7, on 'complete:start', core/completionTracker.ts): the game's ending, "Winterland Complete!": the
 *   trophy, the stats page (time played, money earned, time per era, trophies, every finished season) and the only
 *   "Start a new season" button in the game (decision 5; the confirm lists exactly what resets).
 * - 'stats' (0.9.7, on 'stats:open': the era chip at 100 %, Settings → Stats & trophies): the same page any time,
 *   with this season's completion bars; New Season shows only once the season is complete.
 * The 'lodge', 'market' and 'complete' cards appear a few seconds after their event (simulation time) so the fireworks
 * get the stage first.
 */
import { settlementLevel, townHappiness } from '../core/demand';
import { completion, eraTimes, lifetime } from '../core/completion';
import { QUEST_DEFS } from '../core/quests';
import { releaseFinale } from '../core/quiet';
import type { GameContext } from '../core/types';
import { ERAS, ERA_NAMES, MAX_ERA } from '../eras/data';
import { FINAL_NAME } from '../eras/gate';
import { eraRoman } from './agesLogic';
import { backOut, h, onTap, shield, Slide } from './dom';
import { formatCount, formatDuration, formatMoney } from './format';
import { hexCss, ICON_STAR } from './icons';
import { ICON_INK } from './iconKit';
import { CREAM, GOLD, mixHex, palette } from '../render/palette';
import { SeasonConfirm } from './SeasonConfirm';
import './ending.css';

const DELAY = 3;
/** The ending waits for the long fireworks show (fx/JuiceDirector.ts 'complete:start'). */
const COMPLETE_DELAY = 6.5;

/** Which card is on show. */
export type FinaleVariant = 'lodge' | 'market' | 'complete' | 'stats';
const TITLES: Record<FinaleVariant, string> = {
  lodge: `Survival complete, ${ERAS[2]!.region} awaits`,
  market: 'The Grand Market opens!',
  complete: `${FINAL_NAME}!`,
  stats: 'Your Winterland',
};
const SUBS: Record<FinaleVariant, string> = {
  lodge: 'The Great Lodge stands. New land opens past the Market Town: follow the road east.',
  market: '',
  complete: 'Every era, every build, every quest. A gold trophy now stands by the Great Lodge.',
  stats: '',
};
const BUTTONS: Record<FinaleVariant, string> = { lodge: `On to ${ERAS[2]!.region}`, market: 'Keep playing', complete: 'Keep playing', stats: 'Close' };

/** A gold cup (the trophy on the Great Lodge plaza, assets/trophy.ts): 0.9.8 drawn in the icon kit's style (warm ink
 *  outline, palette gold, a red prize rosette on a wooden drum, a soft star). */
const T_GOLD = hexCss(GOLD);
const T_DEEP = hexCss(mixHex(GOLD, palette(1).trim, 0.25));
const T_LIGHT = hexCss(mixHex(GOLD, CREAM, 0.6));
export const ICON_TROPHY =
  `<svg viewBox="0 0 64 64" aria-hidden="true" stroke="${ICON_INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">` +
  `<rect x="16" y="50" width="32" height="11" rx="3" fill="${hexCss(palette(1).body)}"/>` +
  `<path d="M16 54h32" fill="none" stroke-width="1.6"/>` +
  `<path d="M24 50l2-7h12l2 7z" fill="${T_DEEP}"/><rect x="29" y="35" width="6" height="9" fill="${T_GOLD}"/>` +
  `<path fill="none" stroke-width="4.5" d="M17 14c-9 0-9 14 4 16M47 14c9 0 9 14-4 16"/>` +
  `<path fill="none" stroke="${T_GOLD}" stroke-width="2" d="M17 14c-9 0-9 14 4 16M47 14c9 0 9 14-4 16"/>` +
  `<path fill="${T_GOLD}" d="M15 9h34v8c0 13-8 21-17 21S15 30 15 17z"/>` +
  `<path fill="${T_LIGHT}" stroke="none" d="M21 13h5v7c0 6 2 9 4 11-6-1-9-6-9-11z" opacity=".8"/>` +
  `<path fill="${hexCss(CREAM)}" stroke-width="1.6" d="M32 15.5l2.2 4.4 4.8.7-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8-3.5-3.4 4.8-.7z"/>` +
  `<circle cx="32" cy="55.5" r="4" fill="${hexCss(palette(1).accent)}" stroke-width="1.8"/></svg>`;

export class FinaleCard {
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly icon: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly progress: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly eras: HTMLDivElement;
  private readonly trophies: HTMLDivElement;
  private readonly life: HTMLDivElement;
  private readonly actions: HTMLDivElement;
  private readonly primary: HTMLButtonElement;
  private readonly again: HTMLButtonElement;
  private readonly season: SeasonConfirm;
  private readonly slide = new Slide();
  private timer = -1;
  /** The Winterland Complete card is (or was) up: closing it ends the ending's hush (core/quiet.ts). */
  private hushing = false;
  private variant: FinaleVariant = 'lodge';
  private pending: FinaleVariant = 'lodge';

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.backdrop = h('div', 'wl-modal wl-modal-dim');
    this.backdrop.style.display = 'none';
    shield(this.backdrop);
    this.card = h('div', 'wl-card wl-finale');
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.icon = h('div', 'wl-finale-stars', ICON_STAR + ICON_STAR + ICON_STAR);
    this.title = h('div', 'wl-card-title wl-title-gold wl-title', TITLES.lodge);
    this.sub = h('div', 'wl-finale-sub');
    this.progress = h('div', 'wl-finale-progress');
    this.grid = h('div', 'wl-stats');
    this.eras = h('div', 'wl-finale-eras');
    this.trophies = h('div', 'wl-finale-trophies');
    this.life = h('div', 'wl-finale-life');
    this.actions = h('div', 'wl-finale-actions');
    this.primary = h('button', 'wl-btn wl-btn-big wl-btn-green', BUTTONS.lodge);
    this.primary.type = 'button';
    onTap(this.primary, () => {
      ctx.audio.unlock();
      ctx.audio.play('click');
      this.slide.open = false;
    });
    this.again = h('button', 'wl-btn wl-btn-gold is-b-pine wl-finale-new', 'Start a new season');
    this.again.type = 'button';
    this.again.title = 'Prices go up for good, everything else starts over';
    this.again.setAttribute('aria-description', this.again.title);
    onTap(this.again, () => {
      ctx.audio.unlock();
      ctx.audio.play('click');
      this.showSeason(true);
    });
    this.actions.append(this.primary, this.again);
    this.season = new SeasonConfirm(ctx, () => this.showSeason(false));
    this.season.el.style.display = 'none';
    this.card.append(this.icon, this.title, this.sub, this.progress, this.grid, this.eras, this.trophies, this.life, this.actions, this.season.el);
    this.backdrop.appendChild(this.card);
    layer.appendChild(this.backdrop);
    ctx.events.on('complete:start', () => this.schedule(COMPLETE_DELAY, 'complete'));
    ctx.events.on('stats:open', () => this.showNow('stats'));
  }

  /** New Season is offered only on the 100 % card: the ending, or the stats page of a completed season. */
  private get seasonOffered(): boolean {
    return (this.variant === 'complete' || this.variant === 'stats') && !!this.ctx.state.flags.complete;
  }

  /** The prestige confirm step replaces the stats; Cancel brings them back. */
  showSeason(on: boolean): void {
    if (on && !this.seasonOffered) on = false;
    if (on) this.season.refresh();
    const v = this.variant;
    const page = v === 'complete' || v === 'stats';
    const vis = (el: HTMLElement, show: boolean): void => {
      el.style.display = show && !on ? '' : 'none';
    };
    vis(this.sub, !!SUBS[v]);
    vis(this.progress, v === 'stats' && !this.ctx.state.flags.complete);
    vis(this.grid, true);
    for (const el of [this.eras, this.trophies, this.life]) vis(el, page);
    vis(this.actions, true);
    this.again.style.display = this.seasonOffered ? '' : 'none';
    const backFromConfirm = !on && this.season.el.contains(document.activeElement);
    const intoConfirm = on && this.card.contains(document.activeElement) && !this.season.el.contains(document.activeElement);
    this.season.el.style.display = on ? '' : 'none';
    this.title.textContent = on ? 'A new season?' : TITLES[v];
    // back from the confirm (Cancel, Esc or B): keyboard / gamepad focus lands on Close, not on New Season again
    if (backFromConfirm) this.primary.focus();
    // ... and into it on "Not yet", so a second press of A / Enter never starts the season by accident
    if (intoConfirm) this.season.el.querySelector<HTMLButtonElement>('.wl-btn-grey')?.focus();
  }

  /** Show the card after the celebration delay (seconds, simulation time). */
  schedule(delay = DELAY, variant: FinaleVariant = 'lodge'): void {
    this.timer = delay;
    this.pending = variant;
  }

  get isOpen(): boolean {
    return this.slide.open;
  }

  /** True while the New Season confirm replaces the stats (Esc / gamepad B then act as its Cancel). */
  get seasonShown(): boolean {
    return this.season.el.style.display !== 'none';
  }

  /** Close the card, as its Close button does (Esc / gamepad B, via HUD.escape). */
  close(): void {
    if (!this.slide.open) return;
    this.ctx.audio.play('click');
    this.slide.open = false;
  }

  /** The variant on show (tests). */
  get shownVariant(): FinaleVariant {
    return this.variant;
  }

  private cells(rows: Array<[string, string, boolean?]>): string {
    return rows.map(([l, v, hot]) => `<div class="wl-stat${hot ? ' is-hot' : ''}"><b>${v}</b><span>${l}</span></div>`).join('');
  }

  private fill(): void {
    const s = this.ctx.state;
    const st = s.stats;
    const v = this.variant;
    this.icon.innerHTML = v === 'complete' || v === 'stats' ? ICON_TROPHY : ICON_STAR + ICON_STAR + ICON_STAR;
    this.icon.classList.toggle('is-trophy', v === 'complete' || v === 'stats');
    this.sub.textContent = SUBS[v];
    // Money earned is a full-width hero cell (.is-hot); the other cells are tidy in the 2-, 3- and 4-column layouts
    // (phone, desktop, short landscape): keep that count a multiple of 12 (6 on the stats page, with its era list).
    if (v === 'market') {
      this.grid.innerHTML = this.cells([
        ['Money earned', formatMoney(st.moneyEarned), true],
        ['Time played', formatDuration(s.playTime)],
        ['Logs chopped', formatCount(st.logsChopped)],
        ['Planks sold', formatCount(st.planksSold)],
        ['Crates sold', formatCount(st.cratesSold)],
        ['Chairs sold', formatCount(st.furnitureSold)],
        ['Goods sold', formatCount(st.goodsSold)],
        ['Customers', formatCount(st.customersServed)],
        ['Villagers', formatCount(s.village.population)],
        ['Happiness', `${Math.round(townHappiness(s) * 100)}%`],
        ['Shelters built', formatCount(st.sheltersBuilt)],
        ['Market Town buildings', formatCount(st.townBuilt)],
        ['Upgrades', formatCount(st.upgradesBought)],
      ]);
      return;
    }
    if (v === 'lodge') {
      this.grid.innerHTML = this.cells([
        ['Money earned', formatMoney(st.moneyEarned), true],
        ['Time played', formatDuration(s.playTime)],
        ['Logs chopped', formatCount(st.logsChopped)],
        ['Planks sold', formatCount(st.planksSold)],
        ['Crates sold', formatCount(st.cratesSold)],
        ['Logs sold', formatCount(st.logsSold)],
        ['Chairs sold', formatCount(st.furnitureSold)],
        ['Customers', formatCount(st.customersServed)],
        ['Tricycles', formatCount(st.tricyclesServed)],
        ['Trucks', formatCount(st.trucksServed)],
        ['Villagers', formatCount(s.village.population)],
        ['Shelters built', formatCount(st.sheltersBuilt)],
        ['Upgrades', formatCount(st.upgradesBought)],
      ]);
      return;
    }
    // the stats page (the ending and Settings): this season, then the eras, the trophies and every season so far
    const c = completion(s);
    const pct = s.flags.complete ? 100 : c.pct;
    this.progress.innerHTML =
      `<div class="wl-finale-pct">★ ${pct}% complete</div>` +
      c.parts.map((p) => `<div class="wl-finale-bar${p.done >= p.total ? ' is-done' : ''}"><span>${p.label}</span><i aria-hidden="true"><b style="width:${(p.frac * 100).toFixed(1)}%"></b></i><em>${Math.floor(p.frac * 100)}%</em></div>`).join('');
    const quests = QUEST_DEFS.filter((d) => s.quests[d.id]).length;
    this.grid.innerHTML = this.cells([
      ['Money earned', formatMoney(st.moneyEarned), true],
      ['Time played', formatDuration(s.playTime)],
      ['Upgrades', formatCount(st.upgradesBought)],
      ['Customers', formatCount(st.customersServed)],
      ['Era machines', formatCount(st.machinesBuilt)],
      ['City buildings', formatCount(st.cityBuilt)],
      ['Quests', `${quests}/${QUEST_DEFS.length}`],
    ]);
    const times = eraTimes(s);
    const rows: string[] = [];
    for (let n = 1; n <= MAX_ERA; n++) {
      const reached = n <= s.eras.age;
      const now = reached && n === s.eras.age && !s.flags.complete;
      const t = times[n]!;
      const value = !reached ? '' : t >= 0 ? formatDuration(t) : '—';
      const name = ERA_NAMES[n] ?? '';
      const place = n >= 2 ? ERAS[n]?.region ?? '' : 'Mill';
      rows.push(
        `<div class="wl-era-row${reached ? '' : ' is-locked'}${now ? ' is-now' : ''}"><b>${eraRoman(n)}</b><span>${name}<small>${place}</small></span>` +
          `<em>${now ? `${value} · now` : value}</em></div>`,
      );
    }
    this.eras.innerHTML = `<div class="wl-finale-head">Time per era</div>${rows.join('')}` + (times.slice(1, s.eras.age + 1).some((t) => t < 0) ? '<small class="wl-finale-note">— eras reached before version 0.9.7 kept no time.</small>' : '');
    const tr = s.trophies;
    const badge = (label: string, n: number, gold = false): string =>
      `<div class="wl-trophy${n > 0 ? ' is-won' : ''}${gold ? ' is-gold' : ''}">${gold ? ICON_TROPHY : ICON_STAR}<span>${label}</span><b>${n > 1 ? `×${n}` : n > 0 ? '✓' : '—'}</b></div>`;
    this.trophies.innerHTML = `<div class="wl-finale-head">Trophies</div><div class="wl-trophy-row">${badge('Great Lodge', tr.lodge)}${badge('Grand Market', tr.market)}${badge(FINAL_NAME, tr.complete, true)}</div>`;
    const life = lifetime(s);
    const seasons = s.prestige.season + 1;
    this.life.innerHTML =
      seasons > 1 || life.seasons > 0
        ? `<div class="wl-finale-head">All seasons</div><div class="wl-life-line"><span><b>${formatDuration(life.playTime)}</b> played</span><span><b>${formatMoney(life.moneyEarned)}</b> earned</span><span><b>${life.seasons}</b> season${life.seasons === 1 ? '' : 's'} complete</span></div>` +
          `<small class="wl-finale-note">Season ${seasons} · Settlement ${settlementLevel(s)}</small>`
        : `<small class="wl-finale-note">Season 1 · Settlement ${settlementLevel(s)}</small>`;
  }

  /** Show immediately (tests, 'stats:open'). */
  showNow(variant?: FinaleVariant): void {
    if (variant) this.variant = variant;
    if (this.variant === 'complete') this.hushing = true;
    this.timer = -1;
    this.primary.textContent = BUTTONS[this.variant];
    this.fill();
    this.showSeason(false);
    this.card.classList.toggle('is-stats', this.variant === 'complete' || this.variant === 'stats');
    this.card.classList.toggle('is-complete', this.variant === 'complete');
    this.card.scrollTop = 0;
    this.backdrop.style.display = 'flex';
    this.slide.k = 0;
    this.slide.open = true;
    this.ctx.audio.play(this.variant === 'stats' ? 'click' : 'chime');
  }

  update(dt: number): void {
    if (this.timer >= 0) {
      this.timer -= dt;
      if (this.timer < 0) this.showNow(this.pending);
    }
    const s = this.slide;
    if (s.k <= 0 && !s.open) return;
    if (s.step(dt, 0.4) || (s.k > 0 && s.k < 1)) {
      if (s.k <= 0) {
        this.backdrop.style.display = 'none';
        if (this.hushing) {
          this.hushing = false;
          releaseFinale();
        }
        return;
      }
      const e = s.open ? backOut(Math.min(1, s.k)) : s.k;
      this.backdrop.style.opacity = Math.min(1, s.k * 2).toFixed(2);
      this.card.style.transform = `scale(${(0.6 + 0.4 * e).toFixed(3)})`;
    }
  }
}
