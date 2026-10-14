/**
 * [B4] Season chip: "Season 2 · +50% prices", a small pill under the money pill (below the village badge once the
 * village is revealed). Only exists after a New Season (state.prestige.season > 0). The HUD reads `visible` to
 * toggle the layer class that moves the phone objective banner and the village badge out of its way.
 */
import type { GameContext } from '../core/types';
import { h } from './dom';
import { ICON_STAR } from './icons';
import { seasonBonusPct } from './SeasonConfirm';

export class SeasonBadge {
  private readonly root: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private shown = false;
  private last = -1;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.root = h('div', 'wl-season');
    this.root.style.display = 'none';
    this.root.appendChild(h('i', 'wl-season-star', ICON_STAR));
    this.label = h('span', 'wl-season-label');
    this.root.appendChild(this.label);
    layer.appendChild(this.root);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Cheap enough to call every frame: the DOM is only touched when the season changes. */
  update(): boolean {
    const season = this.ctx.state.prestige.season;
    if (season === this.last) return this.shown;
    this.last = season;
    this.shown = season > 0;
    this.root.style.display = this.shown ? 'flex' : 'none';
    if (this.shown) {
      this.label.innerHTML = `Season ${season}<span class="wl-season-dot"> · </span><b>+${seasonBonusPct(season)}%</b> prices`;
    }
    return this.shown;
  }
}
