/**
 * [0.9.0 Ages — UI] Celebration cards for the city's big moments.
 * - 'era:unlocked' { era }: "A NEW ERA · ERA IV · STEAM AGE", the era's tagline, its perks, the region's name and two
 *   rule (0.9.6, eras/gate.ts gateRuleText: what to raise to Lv 10 before the next expansion) and two
 *   buttons: "Go there" (fast travel to the region's front door via 'travel:request') and Close. Stays until dismissed.
 * - 'city:rankUp' { rank, name }: a smaller banner "Your city is now a Big City!" that fades on its own (it waits its
 *   turn while the era card is up).
 * Sits bottom-centre like EraCard (era.css look), hides while a sheet (.shop-open) owns the screen; popped in / faded
 * on simulation time from update(dt).
 */
import type { GameContext } from '../core/types';
import { ERAS } from '../eras/data';
import { gateNeed, gateRuleText } from '../eras/gate';
import { regionLayout } from '../eras/layout';
import { eraTitle } from './agesLogic';
import { backOut, h, onTap, shield } from './dom';
import { hexCss, ICON_STAR } from './icons';
import './era.css';
import './ages.css';

const IN = 0.45;
const OUT = 0.3;
const BANNER_SHOW = 3.6;

export class AgeCard {
  private readonly root: HTMLDivElement;
  private readonly kickerEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly tagEl: HTMLDivElement;
  private readonly perksEl: HTMLDivElement;
  private readonly placeEl: HTMLDivElement;
  private readonly ruleEl: HTMLDivElement;
  private readonly goBtn: HTMLButtonElement;
  private readonly banner: HTMLDivElement;
  /** Seconds since the era card opened (−1 = none) and since it started closing (−1 = not closing). */
  private t = -1;
  private closing = -1;
  private era = 0;
  private bannerT = -1;
  private pendingRank: string | null = null;
  private last = '';
  private lastBanner = '';

  constructor(private readonly ctx: GameContext, layer: HTMLElement) {
    this.root = h('div', 'wl-era wl-agecard');
    shield(this.root);
    this.root.style.display = 'none';
    this.kickerEl = h('div', 'wl-era-num', 'A NEW ERA');
    this.titleEl = h('div', 'wl-era-name');
    this.tagEl = h('div', 'wl-era-tag');
    this.perksEl = h('div', 'wl-era-perks');
    this.placeEl = h('div', 'wl-agecard-place');
    this.ruleEl = h('div', 'wl-agecard-rule');
    const stars = h('div', 'wl-era-stars', `<i>${ICON_STAR}</i><i>${ICON_STAR}</i><i>${ICON_STAR}</i>`);
    const btns = h('div', 'wl-agecard-btns');
    this.goBtn = h('button', 'wl-agecard-btn is-go', 'Go there');
    this.goBtn.type = 'button';
    const closeBtn = h('button', 'wl-agecard-btn is-plain', 'Close');
    closeBtn.type = 'button';
    btns.append(this.goBtn, closeBtn);
    this.root.append(stars, this.kickerEl, this.titleEl, this.tagEl, this.perksEl, this.placeEl, this.ruleEl, btns);
    layer.appendChild(this.root);
    onTap(this.goBtn, () => this.goThere());
    onTap(closeBtn, () => {
      ctx.audio.play('click');
      this.close();
    });

    this.banner = h('div', 'wl-era wl-rankbanner');
    this.banner.style.display = 'none';
    layer.appendChild(this.banner);

    ctx.events.on('era:unlocked', (e) => this.show(e.era));
    ctx.events.on('city:rankUp', (e) => this.showRank(e.name));
  }

  /** True while the era card is on screen. */
  get visible(): boolean {
    return this.t >= 0 && this.closing < 0;
  }

  /** The era the card is for (0 = none). */
  get currentEra(): number {
    return this.visible ? this.era : 0;
  }

  /** Show the celebration card for era n (2..10). */
  show(n: number): void {
    const e = ERAS[n];
    if (!e) return;
    this.era = n;
    this.titleEl.textContent = eraTitle(n);
    this.tagEl.textContent = e.tagline;
    this.perksEl.replaceChildren(
      ...e.perks.map((p) => {
        const el = h('span', 'wl-era-perk');
        el.textContent = p;
        return el;
      }),
    );
    this.placeEl.textContent = `${e.region} is open`;
    this.ruleEl.textContent = ERAS[n + 1] ? gateRuleText(n + 1) : `Raise ${e.region}'s machines, crew and upgrades to Lv ${gateNeed(n)}.`;
    this.root.style.setProperty('--era-accent', hexCss(e.colors.accent));
    this.root.setAttribute('aria-label', `A new era: ${e.name}`);
    this.t = 0;
    this.closing = -1;
    this.last = '';
    this.root.style.display = '';
  }

  /** Show the small "Your city is now a Big City!" banner (waits while the era card is up). */
  showRank(name: string): void {
    if (this.t >= 0) {
      this.pendingRank = name;
      return;
    }
    this.banner.textContent = `Your city is now a ${name}!`;
    this.bannerT = 0;
    this.lastBanner = '';
    this.banner.style.display = '';
  }

  /** Dismiss the era card (Close / Esc). */
  close(): void {
    if (this.t >= 0 && this.closing < 0) this.closing = 0;
  }

  private goThere(): void {
    const n = this.era;
    if (!ERAS[n]) return;
    const at = regionLayout(n).inside;
    this.ctx.audio.unlock();
    this.ctx.audio.play('click');
    this.ctx.events.emit('travel:request', { x: at.x, z: at.z, label: ERAS[n]!.region });
    this.close();
  }

  update(dt: number): void {
    if (this.t >= 0) {
      this.t += dt;
      let fade = 1;
      if (this.closing >= 0) {
        this.closing += dt;
        fade = 1 - this.closing / OUT;
        if (fade <= 0) {
          this.t = -1;
          this.closing = -1;
          this.root.style.display = 'none';
          if (this.pendingRank) {
            const name = this.pendingRank;
            this.pendingRank = null;
            this.showRank(name);
          }
          return;
        }
      }
      const k = Math.min(1, this.t / IN);
      const op = (Math.min(1, k * 2.5) * fade).toFixed(2);
      const sc = (0.7 + 0.3 * backOut(k)) * (0.96 + 0.04 * fade);
      const tf = `translate(-50%, ${((1 - k) * 18).toFixed(1)}px) scale(${sc.toFixed(3)})`;
      const key = `${op}|${tf}`;
      if (key !== this.last) {
        this.last = key;
        this.root.style.opacity = op;
        this.root.style.transform = tf;
        this.root.style.pointerEvents = fade > 0.5 ? 'auto' : 'none';
      }
    }
    if (this.bannerT >= 0) {
      this.bannerT += dt;
      if (this.bannerT >= BANNER_SHOW + OUT) {
        this.bannerT = -1;
        this.banner.style.display = 'none';
        return;
      }
      const k = Math.min(1, this.bannerT / IN);
      const fade = this.bannerT > BANNER_SHOW ? 1 - (this.bannerT - BANNER_SHOW) / OUT : 1;
      const op = (Math.min(1, k * 2.5) * fade).toFixed(2);
      const tf = `translate(-50%, ${((1 - k) * 18).toFixed(1)}px) scale(${(0.7 + 0.3 * backOut(k)).toFixed(3)})`;
      const key = `${op}|${tf}`;
      if (key !== this.lastBanner) {
        this.lastBanner = key;
        this.banner.style.opacity = op;
        this.banner.style.transform = tf;
      }
    }
  }
}
