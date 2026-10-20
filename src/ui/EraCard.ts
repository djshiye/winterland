/**
 * [T4 — wave 9] Settlement card: a short cosy banner when the village reaches a new level ('village:levelUp'). 0.9.0: the
 * village levels are no longer called eras (the ten Ages are, see AgeCard), so it reads "SETTLEMENT IV" /
 * "Winter City" / a tagline / the perks of that level (VILLAGE.levels[i].perks).
 *
 * It is an ADDITION to the level-up toast (MAIN decides whether it supersedes it: `eraCard.visible` is true while
 * it is up, so the toast can be skipped or shortened). Pops in / fades on simulation time; hidden while a panel
 * (`.wl-hud.shop-open`: shop or build panel) owns the screen; sits bottom-centre so it clears the quest panel, the
 * shop / build side card and the objective banner at 800x450 and 390x844 (see era.css).
 *
 * 0.9.0 climb: settlement levels 6..50 (docs/EXPANSION.md §B) show the same card on 'settlement:levelUp': "SETTLEMENT 12"
 * (or "CHARTER · SETTLEMENT 15" when a band is complete), the level's name, its era district and the perks it brought.
 * Each level has its own name, so the card never repeats one (a 0.9.0 review note).
 *
 * Wiring (ui/HUD.ts): constructor `this.era = new EraCard(ctx, layer);`  update(): `this.era.update(dt);`
 */
import { SETTLEMENT, UPGRADES, VILLAGE } from '../config';
import { bandsWith, founderScarf, renownAt, settlementBand, settlementName } from '../core/demand';
import type { GameContext } from '../core/types';
import { ERAS } from '../eras/data';
import { formatMoney } from './format';
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
    // a passing card with no buttons: read out as a whole when it shows (polite, never interrupting)
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-atomic', 'true');
    const stars = h('div', 'wl-era-stars', `<i>${ICON_STAR}</i><i>${ICON_STAR}</i><i>${ICON_STAR}</i>`);
    this.root.append(stars, this.eraEl, this.nameEl, this.tagEl, this.perksEl);
    layer.appendChild(this.root);
    ctx.events.on('village:levelUp', (e) => this.show(e.level));
    ctx.events.on('settlement:levelUp', (e) => this.showSettlement(e.level, e.from, e.gift, e.charter));
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
    this.eraEl.textContent = settlementTitle(lv);
    this.nameEl.textContent = def.name;
    this.tagEl.textContent = TAGLINES[lv] ?? '';
    const perks = villagePerks(lv);
    this.perksEl.replaceChildren(...perks.map((p) => h('span', 'wl-era-perk', p)));
    this.perksEl.style.display = perks.length ? '' : 'none';
    this.root.setAttribute('aria-label', `Settlement: ${def.name}`);
    this.t = 0;
    this.lastOpacity = '';
    this.lastTransform = '';
    this.root.style.display = '';
  }

  /** Show the card for settlement level `level` (6..50), reached from `from`; `gift` dollars wait on the gift pile. */
  showSettlement(level: number, from: number, gift: number, charter: boolean): void {
    const lv = Math.max(SETTLEMENT.band + 1, Math.min(SETTLEMENT.max, Math.floor(level)));
    const district = ERAS[settlementBand(lv)]?.district ?? '';
    this.eraEl.textContent = charter ? `CHARTER \u00b7 SETTLEMENT ${lv}` : `SETTLEMENT ${lv}`;
    this.nameEl.textContent = settlementName(lv);
    this.tagEl.textContent = charter ? `${district} is complete!` : `${district} is growing`;
    this.perksEl.replaceChildren(...settlementPerks(lv, from, gift).map((p) => h('span', 'wl-era-perk', p)));
    this.perksEl.style.display = '';
    this.root.setAttribute('aria-label', `Settlement ${lv}: ${settlementName(lv)}`);
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

/**
 * 0.9.12 (R5): a village level's perk chips: VILLAGE.levels' own perks (frozen era-1 data) plus every hire that level
 * opens, read from the upgrades' requirements, so "Sled Dog for hire", "Town Porter for hire" and "Foreman for hire"
 * show up where they unlock (all three are era 2 gate rows).
 */
export function villagePerks(lv: number): string[] {
  const out = [...(VILLAGE.levels[lv]?.perks ?? [])];
  for (const def of Object.values(UPGRADES)) {
    if (def.requires?.villageLevel !== lv || (def.group !== 'crew' && def.id !== 'dog')) continue;
    if (!out.some((p) => p.includes(def.label))) out.push(`${def.label} for hire`);
  }
  return out;
}

/** The perk chips of a settlement level-up (from `from` to `level`): Renown, the gift and what the band positions crossed bring (and the Founder's Scarf at 20). */
export function settlementPerks(level: number, from: number, gift: number): string[] {
  const out = [`Renown \u00d7${renownAt(level).toFixed(2)}`, `${formatMoney(gift)} gift: walk over it on the avenue`];
  const crossed = (j: number): boolean => bandsWith(level, j) > bandsWith(Math.max(from, SETTLEMENT.band), j);
  if (crossed(1)) out.push('New quests');
  if (crossed(3)) out.push(`City happiness +${Math.round(SETTLEMENT.decorHappiness * 100)}%`);
  if (crossed(4)) out.push('+1 investment slot');
  if (founderScarf(level) && !founderScarf(from)) out.push(`Founder's Scarf \u00b7 Renown +${Math.round((SETTLEMENT.founder.renown - 1) * 100)}%`);
  return out;
}
