/**
 * [B4] Finale stats card: "Winterland is complete!" with play time, money earned and the other stats, a
 * "Keep playing" button and "Start a new season" (prestige: explains the permanent bonus, then asks for a confirm
 * before emitting 'season:new'). HUD calls schedule() on 'finale:start'; the card appears ~3 s later (simulation time) so the
 * fireworks get the stage first.
 */
import { townHappiness } from '../core/demand';
import type { GameContext } from '../core/types';
import { backOut, h, onTap, shield, Slide } from './dom';
import { formatCount, formatDuration, formatMoney } from './format';
import { ICON_STAR } from './icons';
import { SeasonConfirm } from './SeasonConfirm';

const DELAY = 3;

/** Which finale the card celebrates: the Great Lodge (default) or the Grand Market (wave 13). */
export type FinaleVariant = 'lodge' | 'market';
const TITLES: Record<FinaleVariant, string> = { lodge: 'Winterland is complete!', market: 'The Grand Market opens!' };

export class FinaleCard {
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly actions: HTMLDivElement;
  private readonly season: SeasonConfirm;
  private readonly title: HTMLDivElement;
  private readonly slide = new Slide();
  private timer = -1;
  private variant: FinaleVariant = 'lodge';

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.backdrop = h('div', 'wl-modal wl-modal-dim');
    this.backdrop.style.display = 'none';
    shield(this.backdrop);
    this.card = h('div', 'wl-card wl-finale');
    this.card.appendChild(h('div', 'wl-finale-stars', ICON_STAR + ICON_STAR + ICON_STAR));
    this.title = h('div', 'wl-card-title wl-title-gold wl-outline', TITLES.lodge);
    this.card.appendChild(this.title);
    this.grid = h('div', 'wl-stats');
    this.card.appendChild(this.grid);
    this.actions = h('div', 'wl-finale-actions');
    const btn = h('button', 'wl-btn wl-btn-big wl-btn-green', 'Keep playing');
    btn.type = 'button';
    onTap(btn, () => {
      ctx.audio.unlock();
      ctx.audio.play('click');
      this.slide.open = false;
    });
    const again = h('button', 'wl-btn wl-btn-gold wl-finale-new', 'Start a new season');
    again.type = 'button';
    again.title = 'Prices go up for good, everything else starts over';
    onTap(again, () => {
      ctx.audio.unlock();
      ctx.audio.play('click');
      this.showSeason(true);
    });
    this.actions.append(btn, again);
    this.card.appendChild(this.actions);
    this.season = new SeasonConfirm(ctx, () => this.showSeason(false));
    this.season.el.style.display = 'none';
    this.card.appendChild(this.season.el);
    this.backdrop.appendChild(this.card);
    layer.appendChild(this.backdrop);
  }

  /** The prestige confirm step replaces the stats; Cancel brings them back. */
  showSeason(on: boolean): void {
    if (on) this.season.refresh();
    this.grid.style.display = on ? 'none' : '';
    this.actions.style.display = on ? 'none' : '';
    this.season.el.style.display = on ? '' : 'none';
    this.title.textContent = on ? 'A new season?' : TITLES[this.variant];
  }

  /** Show the card after the celebration delay (seconds, simulation time). */
  schedule(delay = DELAY, variant: FinaleVariant = 'lodge'): void {
    this.timer = delay;
    this.variant = variant;
  }

  get isOpen(): boolean {
    return this.slide.open;
  }

  private fill(): void {
    const s = this.ctx.state;
    const st = s.stats;
    // Money earned is a full-width hero cell (.is-hot); the other 12 cells are tidy in the 2-, 3- and 4-column layouts
    // (phone, desktop, short landscape): keep that count a multiple of 12.
    const rows: Array<[string, string, boolean?]> =
      this.variant === 'market'
        ? [
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
            ['Town buildings', formatCount(st.townBuilt)],
            ['Upgrades', formatCount(st.upgradesBought)],
          ]
        : [
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
        ];

    this.grid.innerHTML = rows
      .map(([l, v, hot]) => `<div class="wl-stat${hot ? ' is-hot' : ''}"><b>${v}</b><span>${l}</span></div>`)
      .join('');
  }

  /** Show immediately (tests). */
  showNow(variant?: FinaleVariant): void {
    if (variant) this.variant = variant;
    this.timer = -1;
    this.showSeason(false);
    this.fill();
    this.backdrop.style.display = 'flex';
    this.slide.k = 0;
    this.slide.open = true;
    this.ctx.audio.play('chime');
  }

  update(dt: number): void {
    if (this.timer >= 0) {
      this.timer -= dt;
      if (this.timer < 0) this.showNow();
    }
    const s = this.slide;
    if (s.k <= 0 && !s.open) return;
    if (s.step(dt, 0.4) || (s.k > 0 && s.k < 1)) {
      if (s.k <= 0) {
        this.backdrop.style.display = 'none';
        return;
      }
      const e = s.open ? backOut(Math.min(1, s.k)) : s.k;
      this.backdrop.style.opacity = Math.min(1, s.k * 2).toFixed(2);
      this.card.style.transform = `scale(${(0.6 + 0.4 * e).toFixed(3)})`;
    }
  }
}
