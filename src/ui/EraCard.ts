/**
 * [T4 — wave 9] Settlement card: a short cosy banner when the village reaches a new level ('village:levelUp'). 0.9.0: the
 * village levels are no longer called eras (the ten Ages are, see AgeCard), so it reads "SETTLEMENT · WINTER CITY" /
 * "Winter City" / a tagline / the perks of that level (VILLAGE.levels[i].perks).
 *
 * It is an ADDITION to the level-up toast (MAIN decides whether it supersedes it: `eraCard.visible` is true while
 * it is up, so the toast can be skipped or shortened). Pops in / fades on simulation time; hidden while a panel
 * (`.wl-hud.shop-open`: shop or build panel) owns the screen; sits bottom-centre so it clears the quest panel, the
 * shop / build side card and the objective banner at 800x450 and 390x844 (see era.css).
 *
 * Wiring (ui/HUD.ts): constructor `this.era = new EraCard(ctx, layer);`  update(): `this.era.update(dt);`
 */
import { VILLAGE } from '../config';
import type { GameContext } from '../core/types';
import { settlementTitle } from './agesLogic';
import { backOut, h } from './dom';
import { ICON_STAR } from './icons';
import './era.css';

const TAGLINES: readonly string[] = [
  '',
  'A few cosy homes around the mill',
  'Lanterns light the street',
  'The Market Town is open!',
  'Lights up all over the city!',
  'Everyone loves your mill',
];

const SHOW = 4.4;
const IN = 0.45;
const OUT = 0.55;

export class EraCard {
  private readonly root: HTMLDivElement;
  private readonly eraEl: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly tagEl: HTMLDivElement;
  private readonly perksEl: HTMLDivElement;
  private t = -1;
  private lastOpacity = '';
  private lastTransform = '';

  constructor(ctx: GameContext, layer: HTMLElement) {
    this.root = h('div', 'wl-era');
    this.root.style.display = 'none';
    this.eraEl = h('div', 'wl-era-num');
    this.nameEl = h('div', 'wl-era-name');
    this.tagEl = h('div', 'wl-era-tag');
    this.perksEl = h('div', 'wl-era-perks');
    const stars = h('div', 'wl-era-stars', `<i>${ICON_STAR}</i><i>${ICON_STAR}</i><i>${ICON_STAR}</i>`);
    this.root.append(stars, this.eraEl, this.nameEl, this.tagEl, this.perksEl);
    layer.appendChild(this.root);
    ctx.events.on('village:levelUp', (e) => this.show(e.level));
  }

  /** True while the card is on screen (so a toast with the same perks can be skipped). */
  get visible(): boolean {
    return this.t >= 0;
  }

  /** Show the card for village level `level` (>= 1). */
  show(level: number): void {
    const lv = Math.max(0, Math.min(VILLAGE.levels.length - 1, Math.floor(level)));
    if (lv < 1) return;
    const def = VILLAGE.levels[lv]!;
    this.eraEl.textContent = settlementTitle(def.name);
    this.nameEl.textContent = def.name;
    this.tagEl.textContent = TAGLINES[lv] ?? '';
    this.perksEl.replaceChildren(...def.perks.map((p) => h('span', 'wl-era-perk', p)));
    this.perksEl.style.display = def.perks.length ? '' : 'none';
    this.root.setAttribute('aria-label', `Settlement: ${def.name}`);
    this.t = 0;
    this.lastOpacity = '';
    this.lastTransform = '';
    this.root.style.display = '';
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    if (this.t >= SHOW + OUT) {
      this.t = -1;
      this.root.style.display = 'none';
      return;
    }
    const k = Math.min(1, this.t / IN);
    const fade = this.t > SHOW ? 1 - (this.t - SHOW) / OUT : 1;
    const op = (Math.min(1, k * 2.5) * fade).toFixed(2);
    const sc = (0.7 + 0.3 * backOut(k)) * (this.t > SHOW ? 0.96 + 0.04 * fade : 1);
    const lift = (1 - k) * 18;
    const tf = `translate(-50%, ${lift.toFixed(1)}px) scale(${sc.toFixed(3)})`;
    if (op !== this.lastOpacity) {
      this.lastOpacity = op;
      this.root.style.opacity = op;
    }
    if (tf !== this.lastTransform) {
      this.lastTransform = tf;
      this.root.style.transform = tf;
    }
  }
}
