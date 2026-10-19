/**
 * [0.9.0 Ages — UI] Celebration cards for the city's big moments.
 * - 'era:unlocked' { era }: 0.9.8 (brief 14) the era POSTCARD: a code-drawn picture of the new era's region built
 *   around its resource (ui/eraPostcards.ts) with a roman-numeral stamp and an "A NEW ERA" postmark, then "Greetings
 *   from <region>!", the era's name and tagline, its perks, the Lv 10 rule (0.9.6, eras/gate.ts gateRuleText) and two
 *   buttons: "Go there" (fast travel to the region's front door via 'travel:request') and Close.
 *   It is short and skippable: it slips away on its own after POSTCARD_STAY seconds (a stitched line under the picture
 *   shows the time left), and the timer waits while the pointer, the keyboard or the gamepad is on the card. Close,
 *   Esc and gamepad B dismiss it at once. Reduce motion: it fades in and out without the pop and the tilt.
 * - 'city:rankUp' { rank, name }: a smaller banner "Your city is now a Big City!" that fades on its own (it waits its
 *   turn while the era card is up).
 * Sits bottom-centre, hides while a sheet (.shop-open) owns the screen; popped in / faded on simulation time from
 * update(dt).
 * 0.9.10 (READINESS C6): while the postcard is up the HUD layer carries `wl-card-up`, so the hold-to-interact chip
 * and the move hint step aside (guide.css; ui/MoveHand.ts also pauses); the perks read as plain notes, not buttons.
 */
import { finaleQuiet } from '../core/quiet';
import type { GameContext } from '../core/types';
import { reducedMotion } from '../fx/comfort';
import { ERAS } from '../eras/data';
import { gateNeed, gateRuleText } from '../eras/gate';
import { regionLayout } from '../eras/layout';
import { eraRoman } from './agesLogic';
import { backOut, h, onTap, shield } from './dom';
import { eraPostcard } from './eraPostcards';
import { setEraAccent } from './theme';
import './era.css';
import './ages.css';
import './guide.css';
import { describeBy } from './dialog';

const IN = 0.45;
const OUT = 0.3;
const BANNER_SHOW = 3.6;
/** Seconds the postcard stays before it slips away on its own (paused while the player is on it). */
export const POSTCARD_STAY = 9;

export class AgeCard {
  private readonly root: HTMLDivElement;
  private readonly picEl: HTMLDivElement;
  private readonly stampEl: HTMLDivElement;
  private readonly timerEl: HTMLDivElement;
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
  /** Seconds the postcard has been read (the auto-dismiss clock; it stops while the player is on the card). */
  private stay = 0;
  private hovered = false;
  private era = 0;
  private bannerT = -1;
  private pendingRank: string | null = null;
  private last = '';
  private lastBanner = '';

  constructor(private readonly ctx: GameContext, private readonly layer: HTMLElement) {
    this.root = h('div', 'wl-era wl-agecard wl-postcard');
    this.root.setAttribute('role', 'dialog');
    shield(this.root);
    this.root.style.display = 'none';
    // the picture side: the region's diorama, a stamp with the era's numeral, an "A NEW ERA" postmark
    this.picEl = h('div', 'wl-pc-pic');
    this.stampEl = h('div', 'wl-pc-stamp');
    const mark = h('div', 'wl-pc-mark', '<span>A NEW ERA</span>');
    const pic = h('div', 'wl-pc-picwrap');
    pic.append(this.picEl, this.stampEl, mark);
    this.timerEl = h('div', 'wl-pc-timer');
    // the writing side
    this.kickerEl = h('div', 'wl-kicker wl-pc-kicker');
    this.titleEl = h('div', 'wl-pc-title');
    this.tagEl = h('div', 'wl-pc-tag');
    this.perksEl = h('div', 'wl-era-perks wl-pc-perks');
    this.placeEl = h('div', 'wl-pc-greet');
    this.ruleEl = h('div', 'wl-agecard-rule');
    describeBy(this.root, [this.placeEl, this.tagEl, this.perksEl, this.ruleEl], 'wl-agecard-d');
    const btns = h('div', 'wl-agecard-btns');
    this.goBtn = h('button', 'wl-agecard-btn is-go', 'Go there');
    this.goBtn.type = 'button';
    const closeBtn = h('button', 'wl-agecard-btn is-plain is-b-pine', 'Close');
    closeBtn.type = 'button';
    btns.append(this.goBtn, closeBtn);
    const body = h('div', 'wl-pc-body');
    body.append(this.kickerEl, this.placeEl, this.titleEl, this.tagEl, this.perksEl, this.ruleEl, btns);
    this.root.append(pic, this.timerEl, body);
    layer.appendChild(this.root);
    onTap(this.goBtn, () => this.goThere());
    onTap(closeBtn, () => {
      ctx.audio.play('click');
      this.close();
    });
    // the auto-dismiss clock waits while the player is reading with the mouse on it (focus is checked each frame)
    this.root.addEventListener('pointerenter', () => (this.hovered = true));
    this.root.addEventListener('pointerleave', () => (this.hovered = false));

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
    this.picEl.innerHTML = eraPostcard(n);
    this.stampEl.innerHTML = `<b>${eraRoman(n)}</b><small>ERA</small>`;
    this.kickerEl.textContent = `A new era · Era ${eraRoman(n)}`;
    this.titleEl.textContent = e.name;
    this.tagEl.textContent = e.tagline;
    this.perksEl.replaceChildren(
      ...e.perks.map((p) => {
        const el = h('span', 'wl-era-perk');
        el.textContent = p;
        return el;
      }),
    );
    this.placeEl.textContent = `Greetings from ${e.region}!`;
    this.ruleEl.textContent = ERAS[n + 1] ? gateRuleText(n + 1) : `Raise ${e.region}'s machines, crew and upgrades to Lv ${gateNeed(n)}.`;
    setEraAccent(this.root, n);
    this.stay = 0;
    this.hovered = false;
    this.timerEl.style.transform = 'scaleX(1)';
    this.root.setAttribute('aria-label', `A new era: ${e.name}`);
    this.t = 0;
    this.closing = -1;
    this.last = '';
    this.root.style.display = '';
    this.layer.classList.add('wl-card-up');
  }

  /** Show the small "Your city is now a Big City!" banner (waits while the era card is up). */
  showRank(name: string): void {
    if (this.t >= 0 || finaleQuiet()) {
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
    // 0.9.7: a rank banner held back by the ending's hush (core/quiet.ts) shows once the Winterland Complete card closes
    if (this.pendingRank && this.t < 0 && !finaleQuiet()) {
      const name = this.pendingRank;
      this.pendingRank = null;
      this.showRank(name);
    }
    if (this.t >= 0) {
      this.t += dt;
      // the postcard slips away on its own once read; the clock waits while the player is on it
      if (this.closing < 0) {
        const busy = this.hovered || this.root.contains(document.activeElement);
        if (!busy) this.stay += dt;
        const left = Math.max(0, 1 - this.stay / POSTCARD_STAY);
        this.timerEl.style.transform = `scaleX(${left.toFixed(3)})`;
        if (this.stay >= POSTCARD_STAY) this.close();
      }
      let fade = 1;
      if (this.closing >= 0) {
        this.closing += dt;
        fade = 1 - this.closing / OUT;
        if (fade <= 0) {
          this.t = -1;
          this.closing = -1;
          this.root.style.display = 'none';
          this.layer.classList.remove('wl-card-up');
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
      // a postcard dropping onto the table: a little pop and a settling tilt (none of it with Reduce motion)
      const calm = reducedMotion();
      const sc = calm ? 1 : (0.7 + 0.3 * backOut(k)) * (0.96 + 0.04 * fade);
      const tilt = calm ? 0 : (1 - k) * -4;
      const tf = `translate(-50%, ${calm ? 0 : ((1 - k) * 18).toFixed(1)}px) scale(${sc.toFixed(3)}) rotate(${tilt.toFixed(2)}deg)`;
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
