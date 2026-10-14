/**
 * [B4] New Season (prestige) confirmation block, shared by the finale card and the settings panel: what the next
 * season gives (permanent price bonus, starting money), what it costs (everything except the season count resets),
 * and Cancel / Start buttons. Pressing Start emits 'season:new' exactly once (the Game writes the next season's save
 * and reloads the page, which is asynchronous, so a double tap must not emit twice). Never one-tap: this block is
 * always shown behind an explicit "Start a new season" button.
 */
import { PRESTIGE } from '../config';
import type { GameContext } from '../core/types';
import { h, onTap } from './dom';
import { formatMoney } from './format';

/** "+25%" style price bonus after `season` seasons (0 = the first run). */
export function seasonBonusPct(season: number): number {
  return Math.round(PRESTIGE.bonusPerSeason * Math.max(0, season) * 100);
}

export class SeasonConfirm {
  readonly el: HTMLDivElement;
  private readonly text: HTMLDivElement;
  private readonly go: HTMLButtonElement;
  private starting = false;

  constructor(
    private readonly ctx: GameContext,
    onCancel: () => void,
  ) {
    this.el = h('div', 'wl-season-confirm');
    this.el.appendChild(h('div', 'wl-season-head wl-outline'));
    this.text = h('div', 'wl-confirm-text wl-season-text');
    this.el.appendChild(this.text);
    const row = h('div', 'wl-btn-row');
    const cancel = h('button', 'wl-btn wl-btn-grey', 'Not yet');
    cancel.type = 'button';
    onTap(cancel, () => {
      ctx.audio.play('click');
      onCancel();
    });
    this.go = h('button', 'wl-btn wl-btn-gold', 'Start');
    this.go.type = 'button';
    onTap(this.go, () => {
      if (this.starting) return;
      this.starting = true;
      this.go.disabled = true;
      ctx.audio.unlock();
      ctx.audio.play('fanfare', { volume: 0.7 });
      ctx.events.emit('season:new', {});
    });
    row.append(cancel, this.go);
    this.el.appendChild(row);
    this.refresh();
  }

  /** Re-read the season number (the numbers describe the NEXT season). */
  refresh(): void {
    const next = this.ctx.state.prestige.season + 1;
    (this.el.firstChild as HTMLElement).textContent = `Season ${next}`;
    this.text.innerHTML =
      `All sale prices <b>+${seasonBonusPct(next)}%</b> for good (each season adds +${seasonBonusPct(1)}%) and you start ` +
      `with <b>${formatMoney(PRESTIGE.startMoneyPerSeason * next)}</b>.` +
      `<small>Everything else starts over: your mill, village, crew and upgrades. Only the season count stays.</small>`;
    this.go.textContent = 'Start';
  }
}
