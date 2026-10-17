/**
 * [Wave 13] Contract card: a compact card under the quest chip / card (left column) for the gate notice board's current
 * delivery contract (ctx.state.contract): item "20 loaves", a progress bar "7 / 20", the countdown "2:41" and the bonus
 * "+$1,500". Pulses red in the last 20 s. Hidden when there is no contract, during the intro and while the shop owns the
 * screen. Phones (<= 420 px) show a one-line chip (css). Positioned from the quest panel's measured box (so it follows
 * the quests collapsing / expanding); the DOM is refreshed ~4 times per second on simulation time and text is only
 * rewritten when it changed; the pulse is driven from update() (no CSS animation). The toasts / sounds for
 * offered / done / failed come from the JuiceDirector.
 */
import type { GameContext } from '../core/types';
import { contractClock, contractItem } from '../core/Contracts';
import { steadyHighlights, uiScale } from '../fx/comfort';
import { h, shield } from './dom';
import { formatMoney } from './format';
import { ICON_INK } from './iconKit';

const REFRESH = 0.25;
const WARN = 20;

const ICON_SCROLL = `<svg viewBox="0 0 48 48" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">
  <g stroke="${ICON_INK}" stroke-width="2.5"><rect x="9" y="5" width="30" height="38" rx="4" fill="#f6ecd2"/>
  <path d="M15 15h18M15 22h18M15 29h11" fill="none" stroke="#a8693a" stroke-width="2.6"/>
  <circle cx="33" cy="35" r="5" fill="#e8553e"/></g></svg>`;

export class ContractCard {
  private readonly root: HTMLDivElement;
  private readonly item: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly count: HTMLSpanElement;
  private readonly clock: HTMLSpanElement;
  private readonly bonus: HTMLSpanElement;
  private acc = REFRESH;
  private pulse = 0;
  private shown = false;
  private lastLabel = '';
  private lastCount = '';
  private lastClock = '';
  private lastBonus = '';
  private lastTop = '';
  private lastLeft = '';
  private warn = false;

  constructor(
    private readonly ctx: GameContext,
    private readonly layer: HTMLElement,
  ) {
    this.root = h('div', 'wl-contract');
    this.root.setAttribute('role', 'status');
    this.item = h('div', 'wl-contract-item');
    this.clock = h('span', 'wl-contract-clock');
    this.bonus = h('span', 'wl-contract-bonus');
    const bar = h('div', 'wl-contract-bar');
    this.fill = h('div', 'wl-contract-fill');
    this.count = h('span', 'wl-contract-count');
    bar.append(this.fill, this.count);
    const top = h('div', 'wl-contract-top');
    top.append(h('i', 'wl-contract-icon', ICON_SCROLL), this.item, this.clock);
    const line = h('div', 'wl-contract-line');
    line.append(bar, this.bonus);
    this.root.append(top, line);
    this.root.style.display = 'none';
    shield(this.root);
    layer.appendChild(this.root);
    const poke = (): void => {
      this.acc = REFRESH;
    };
    ctx.events.on('contract:offered', poke);
    ctx.events.on('contract:done', poke);
    ctx.events.on('contract:failed', poke);
    ctx.events.on('sale', poke);
  }

  get visible(): boolean {
    return this.shown;
  }

  update(dt: number): void {
    const c = this.ctx.state.contract;
    const want = c.kind !== '' && this.ctx.state.phase !== 'intro';
    if (want !== this.shown) {
      this.shown = want;
      this.root.style.display = want ? '' : 'none';
      this.layer.classList.toggle('has-contract', want);
      this.acc = REFRESH;
    }
    if (!want) return;
    this.acc += dt;
    if (this.acc >= REFRESH) {
      this.acc = 0;
      this.refresh();
    }
    if (this.warn) {
      this.pulse += dt;
      // comfort: a steady warning colour instead of a flashing one on calmer settings
      const p = steadyHighlights() ? 0.6 : 0.5 + 0.5 * Math.sin(this.pulse * 7);
      this.root.style.setProperty('--c-pulse', p.toFixed(2));
    }
  }

  /** Re-read the contract now. */
  refresh(): void {
    const c = this.ctx.state.contract;
    if (c.kind === '') return;
    const label = contractItem(c.kind, c.target);
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      this.item.textContent = label;
    }
    const count = `${c.progress} / ${c.target}`;
    if (count !== this.lastCount) {
      this.lastCount = count;
      this.count.textContent = count;
      this.fill.style.transform = `scaleX(${Math.min(1, c.progress / Math.max(1, c.target)).toFixed(3)})`;
    }
    const clock = contractClock(c.left);
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.clock.textContent = clock;
    }
    const bonus = `+${formatMoney(c.bonus)}`;
    if (bonus !== this.lastBonus) {
      this.lastBonus = bonus;
      this.bonus.textContent = bonus;
    }
    const warn = c.left <= WARN;
    if (warn !== this.warn) {
      this.warn = warn;
      this.root.classList.toggle('is-warn', warn);
      if (!warn) this.root.style.removeProperty('--c-pulse');
    }
    // sit under the quest chip / card (it may be collapsed, expanded or hidden by the shop)
    const q = this.layer.querySelector('.wl-quests');
    const r = q instanceof HTMLElement && q.style.display !== 'none' ? q.getBoundingClientRect() : null;
    const lr = this.layer.getBoundingClientRect();
    // 0.9.7: this card is zoomed by the Interface size, so screen px become its own px (÷ uiScale)
    const k = uiScale();
    const top = r && r.height > 0 ? `${Math.round((r.bottom - lr.top) / k + 6)}px` : '';
    const left = r && r.height > 0 ? `${Math.round((r.left - lr.left) / k)}px` : '';
    if (top !== this.lastTop) {
      this.lastTop = top;
      this.root.style.top = top;
    }
    if (left !== this.lastLeft) {
      this.lastLeft = left;
      this.root.style.left = left;
    }
  }
}
