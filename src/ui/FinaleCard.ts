/**
 * [B4] Finale stats card: "Winterland is complete!" with play time, money earned and the other stats, a
 * "Keep playing" button and "Start a new season" (prestige: explains the permanent bonus, then asks for a confirm
 * before emitting 'season:new'). HUD calls schedule() on 'finale:start'; the card appears ~3 s later (simulation time) so the
 * fireworks get the stage first.
 */
import type { GameContext } from '../core/types';
import { backOut, h, onTap, shield, Slide } from './dom';
import { formatCount, formatDuration, formatMoney } from './format';
import { ICON_STAR } from './icons';
import { SeasonConfirm } from './SeasonConfirm';

const DELAY = 3;

export class FinaleCard {
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly actions: HTMLDivElement;
  private readonly season: SeasonConfirm;
  private readonly title: HTMLDivElement;
  private readonly slide = new Slide();
  private timer = -1;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.backdrop = h('div', 'wl-modal wl-modal-dim');
    this.backdrop.style.display = 'none';
    shield(this.backdrop);
    this.card = h('div', 'wl-card wl-finale');
    this.card.appendChild(h('div', 'wl-finale-stars', ICON_STAR + ICON_STAR + ICON_STAR));
    this.title = h('div', 'wl-card-title wl-title-gold wl-outline', 'Winterland is complete!');
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
    this.title.textContent = on ? 'A new season?' : 'Winterland is complete!';
  }

  /** Show the card after the celebration delay (seconds, simulation time). */
  schedule(delay = DELAY): void {
    this.timer = delay;
  }

  get isOpen(): boolean {
    return this.slide.open;
  }

  private fill(): void {
    const s = this.ctx.state;
    const st = s.stats;
    const rows: Array<[string, string, boolean?]> = [
      ['Time played', formatDuration(s.playTime)],
      ['Money earned', formatMoney(st.moneyEarned), true],
      ['Logs chopped', formatCount(st.logsChopped)],
      ['Planks sold', formatCount(st.planksSold)],
      ['Crates sold', formatCount(st.cratesSold)],
      ['Logs sold', formatCount(st.logsSold)],
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
  showNow(): void {
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
