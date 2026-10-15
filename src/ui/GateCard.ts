/**
 * [0.9.0 climb — UI] The era checklist (docs/EXPANSION.md §C): what still stands between the player and the next era's
 * expansion pad. Opens on 'gate:open' (tapping the era chip), closes on its X and Esc; the BuildPanel's sheet look.
 *
 * ADHD-friendly by construction: never the whole list.
 * - Header: "ERA II · FRONTIER" and "12/23 upgrades at Lv 10 · Settlement 5/5", a progress bar, then what comes after:
 *   "then the expansion: $1.5M + 20 Crates". Once the gate is met a gold "Frontier is for sale!" with Go replaces it.
 * - "✓ 12 done", then only the TOP 5 open rows (eras/gate.ts openRows: prereqs first, then cheapest to finish) and
 *   "+8 more". A shop or Industry row has Buy (one level) and "→ Lv 10" (raiseTo, every level it can afford up to the
 *   gate's); a pad row ("pad LV 8 → LV 11") and a prereq row have Go (fast travel to the pad / what unlocks it).
 * - The settlement row while it is short: "Build a home in Brickside (+40) → Settlement 6" with Go to the district.
 * - Raise all (footer): the cheapest next level of any buyable row, again and again, keeping max($500, 20 %) in the
 *   wallet (Upgrades.raiseAll). One press, one sound; the rows it finishes tick through 'gate:progress' (JuiceDirector).
 * - The Steward toggle (footer, from Settlement 20 on; state.eras.steward, eras/Steward.ts) and, once a level has
 *   passed a hard cap, the Mastery line under the bar: "Mastery 340 · +41 % on every sale".
 *
 * The five row slots are built once; refresh() rewrites only what changed, at most 4× a second while open (money
 * changes every frame while cash flows; the checklist prices every open step).
 */
import { CLIMB, LAYOUT, PADS, UPGRADES, type PadIdConst } from '../config';
import type { GameContext, UpgradeId } from '../core/types';
import { ERAS } from '../eras/data';
import { masteryTotal } from '../core/demand';
import { masteryMult } from '../core/ladder';
import { climbOpen, eraGate, openRows, prereqTarget, raiseReserve, raiseRows, rowBuyable, settlementGoal, stewardUnlocked, type EraGate, type GateRow, type NextGoal } from '../eras/gate';
import { travelPoints } from '../eras/layout';
import { eraRoman, expansionCostText, gateRowLine, masteryLine } from './agesLogic';
import { h, onTap } from './dom';
import { formatMoney } from './format';
import { hexCss, ICON_CLOSE, ICON_HOUSE, ICON_LOCK, upgradeIcon } from './icons';
import { Sheet } from './sheet';
import './build.css';
import './ages.css';

/** Open rows on show at once. */
export const GATE_TOP = 5;
const REFRESH_EVERY = 0.25;

interface RowSlot {
  root: HTMLDivElement;
  icon: HTMLDivElement;
  name: HTMLDivElement;
  sub: HTMLDivElement;
  buy: HTMLButtonElement;
  to: HTMLButtonElement;
  go: HTMLButtonElement;
  row: GateRow | null;
  /** Last written html / class per element (skip redundant DOM writes). */
  key: string;
}

/** Where a Go button takes the player (null: nowhere to go). */
export function goTarget(ctx: Pick<GameContext, 'state'>, target: string): { x: number; z: number; label: string } | null {
  if (target.startsWith('pad:')) {
    const pad = PADS[target.slice(4) as PadIdConst];
    // stand just beside the tile, so arriving never pays by accident
    return pad ? { x: pad.x, z: pad.z + pad.size + 0.6, label: pad.label.charAt(0) + pad.label.slice(1).toLowerCase() } : null;
  }
  if (target === 'quarters') {
    const q = LAYOUT.ridge.quarters.pad;
    return { x: q.x, z: q.z + 1.6, label: 'Crew bunkhouse' };
  }
  const p = travelPoints(ctx.state).find((t) => t.id === target && t.open);
  return p ? { x: p.x, z: p.z, label: p.label } : null;
}

export class GateCard {
  private readonly sheet: Sheet;
  private readonly titleEl: HTMLDivElement;
  private readonly subEl: HTMLDivElement;
  private readonly barFill: HTMLDivElement;
  private readonly nextEl: HTMLDivElement;
  private readonly ready: HTMLDivElement;
  private readonly readyText: HTMLDivElement;
  private readonly readyGo: HTMLButtonElement;
  private readonly doneEl: HTMLDivElement;
  private readonly slots: RowSlot[] = [];
  private readonly moreEl: HTMLDivElement;
  private readonly settle: RowSlot;
  private readonly raiseBtn: HTMLButtonElement;
  private readonly raiseNote: HTMLSpanElement;
  private readonly stewardBtn: HTMLButtonElement;
  private readonly stewardNote: HTMLSpanElement;
  private readonly masteryEl: HTMLDivElement;
  private dirty = true;
  private acc = REFRESH_EVERY;
  private gate: EraGate | null = null;
  private settleGoal: NextGoal | null = null;
  private readonly texts = new Map<HTMLElement, string>();

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.sheet = new Sheet('wl-gate', layer);
    const root = this.sheet.root;
    const head = h('div', 'wl-build-head');
    const titles = h('div', 'wl-build-titles');
    this.titleEl = h('div', 'wl-build-title wl-outline');
    this.subEl = h('div', 'wl-build-sub');
    titles.append(this.titleEl, this.subEl);
    head.appendChild(titles);
    const close = h('button', 'wl-build-close', ICON_CLOSE);
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    onTap(close, () => {
      ctx.audio.play('click');
      this.close();
    });
    head.appendChild(close);
    root.appendChild(head);

    const list = h('div', 'wl-build-list wl-gate-list');
    const sum = h('div', 'wl-gate-sum');
    const bar = h('div', 'wl-gate-bar');
    this.barFill = h('div', 'wl-gate-fill');
    bar.appendChild(this.barFill);
    this.nextEl = h('div', 'wl-gate-next');
    this.masteryEl = h('div', 'wl-gate-mastery');
    sum.append(bar, this.nextEl, this.masteryEl);
    list.appendChild(sum);

    this.ready = h('div', 'wl-gate-ready');
    this.readyText = h('div', 'wl-gate-ready-text');
    this.readyGo = this.button('wl-gate-go', 'Go');
    onTap(this.readyGo, () => this.go(`region:${this.gate?.n ?? 0}`));
    this.ready.append(this.readyText, this.readyGo);
    list.appendChild(this.ready);

    this.doneEl = h('div', 'wl-gate-done');
    list.appendChild(this.doneEl);
    for (let i = 0; i < GATE_TOP; i++) list.appendChild(this.makeSlot().root);
    this.moreEl = h('div', 'wl-gate-more');
    list.appendChild(this.moreEl);
    this.settle = this.makeSlot(true);
    list.appendChild(this.settle.root);
    root.appendChild(list);

    const foot = h('div', 'wl-gate-foot');
    this.raiseBtn = this.button('wl-gate-raise', '<b>Raise all</b>');
    this.raiseNote = h('span', 'wl-gate-raise-note');
    this.raiseBtn.appendChild(this.raiseNote);
    onTap(this.raiseBtn, () => this.raiseAll());
    this.stewardBtn = this.button('wl-gate-steward', '<b>Steward</b>');
    this.stewardNote = h('span', 'wl-gate-raise-note');
    this.stewardBtn.appendChild(this.stewardNote);
    this.stewardBtn.title = `Buys the cheapest checklist level every ${CLIMB.steward.every} s, keeping the same reserve as Raise all`;
    onTap(this.stewardBtn, () => this.toggleSteward());
    foot.append(this.raiseBtn, this.stewardBtn);
    root.appendChild(foot);

    const mark = (): void => {
      this.dirty = true;
    };
    const ev = ctx.events;
    ev.on('gate:open', () => this.open());
    ev.on('money:changed', mark);
    ev.on('upgrade:bought', mark);
    ev.on('gate:progress', () => {
      this.dirty = true;
      this.acc = REFRESH_EVERY; // a finished row leaves the list at once
    });
    ev.on('era:unlocked', () => {
      this.dirty = true;
      this.acc = REFRESH_EVERY;
    });
  }

  /** True while the card is (or is animating to be) on screen. */
  get visible(): boolean {
    return this.sheet.visible;
  }

  /** Show the next era's checklist (nothing to show before the Great Lodge or after the last era). */
  open(): void {
    const s = this.ctx.state;
    if (!climbOpen(s) || !ERAS[s.eras.age + 1]) return;
    this.dirty = true;
    this.acc = REFRESH_EVERY;
    this.refresh();
    this.sheet.setOpen(true);
  }

  close(): void {
    this.sheet.setOpen(false);
  }

  /** For tests: the rows on show, in order (null slots left out). */
  get shownRows(): readonly GateRow[] {
    return this.slots.map((r) => r.row).filter((r): r is GateRow => r !== null);
  }

  private button(cls: string, html: string): HTMLButtonElement {
    const b = h('button', cls, html);
    b.type = 'button';
    return b;
  }

  private makeSlot(settlement = false): RowSlot {
    const root = h('div', `wl-gate-row${settlement ? ' is-settle' : ''}`);
    const icon = h('div', 'wl-gate-icon', settlement ? ICON_HOUSE : '');
    const mid = h('div', 'wl-build-mid');
    const name = h('div', 'wl-gate-name');
    const sub = h('div', 'wl-gate-sub');
    mid.append(name, sub);
    const btns = h('div', 'wl-gate-btns');
    const buy = this.button('wl-shop-buy wl-gate-buy', '');
    const to = this.button('wl-gate-to', '');
    const go = this.button('wl-gate-go', 'Go');
    btns.append(buy, to, go);
    root.append(icon, mid, btns);
    const slot: RowSlot = { root, icon, name, sub, buy, to, go, row: null, key: '' };
    if (settlement) {
      buy.style.display = to.style.display = 'none';
      onTap(go, () => this.settleGoal && this.go(this.settleGoal.action.target));
      return slot;
    }
    onTap(buy, () => slot.row && this.buyOne(slot.row.id));
    onTap(to, () => slot.row && this.buyTo(slot.row));
    onTap(go, () => slot.row && this.goRow(slot.row));
    this.slots.push(slot);
    return slot;
  }

  // ---------------------------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------------------------

  private buyOne(id: UpgradeId): void {
    const { ctx } = this;
    ctx.audio.unlock();
    if (!ctx.upgrades.buy(id)) this.refuse();
    this.dirty = true;
    this.acc = REFRESH_EVERY;
  }

  private buyTo(row: GateRow): void {
    const { ctx } = this;
    ctx.audio.unlock();
    const asked = row.need - ctx.upgrades.shownLevel(row.id);
    const n = ctx.upgrades.raiseTo(row.id, row.need);
    if (n === 0) this.refuse();
    else if (asked > 1) ctx.audio.play('upgrade'); // a batch press is silent per level; a one-level press played its own
    this.dirty = true;
    this.acc = REFRESH_EVERY;
  }

  private raiseAll(): void {
    const { ctx } = this;
    ctx.audio.unlock();
    const g = this.gate;
    if (!g) return;
    const n = ctx.upgrades.raiseAll(raiseRows(g), raiseReserve(ctx.economy.money));
    if (n === 0) this.refuse();
    else ctx.audio.play('upgrade');
    this.dirty = true;
    this.acc = REFRESH_EVERY;
  }

  private toggleSteward(): void {
    const { ctx } = this;
    ctx.audio.unlock();
    if (!stewardUnlocked(ctx.state)) return;
    ctx.state.eras.steward = !ctx.state.eras.steward;
    ctx.audio.play('click');
    this.dirty = true;
    this.acc = REFRESH_EVERY;
  }

  private refuse(): void {
    this.ctx.audio.play('full', { volume: 0.5 });
    this.sheet.shake();
  }

  /** A pad row goes to its level pad; a prereq row to what unlocks it (the pad, the village, the bunkhouse). */
  private goRow(row: GateRow): void {
    this.go(row.state === 'prereq' ? prereqTarget(row.id, this.ctx.state) : `pad:${row.id}`);
  }

  private go(target: string): void {
    const { ctx } = this;
    ctx.audio.unlock();
    const at = goTarget(ctx, target);
    if (!at) {
      this.refuse();
      return;
    }
    ctx.audio.play('click');
    this.close();
    ctx.events.emit('travel:request', at);
  }

  // ---------------------------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------------------------

  private text(el: HTMLElement, html: string): void {
    if (this.texts.get(el) === html) return;
    this.texts.set(el, html);
    el.innerHTML = html;
  }

  private show(el: HTMLElement, on: boolean): void {
    const d = on ? '' : 'none';
    if (el.style.display !== d) el.style.display = d;
  }

  private refresh(): void {
    const { ctx } = this;
    const s = ctx.state;
    const n = s.eras.age + 1;
    const era = ERAS[n];
    if (!era || !climbOpen(s)) {
      this.close();
      return;
    }
    const g = eraGate(s, n);
    this.gate = g;
    const money = ctx.economy.money;
    this.sheet.root.style.setProperty('--era-accent', hexCss(era.colors.accent));
    this.text(this.titleEl, `ERA ${eraRoman(n)} · ${era.name.toUpperCase()}`);
    const st = Math.min(g.settlement.level, g.settlementNeed);
    this.text(this.subEl, `${g.ok}/${g.total} upgrades at Lv ${g.need} · Settlement ${st}/${g.settlementNeed}`);
    const k = (g.ok + (g.settlement.level >= g.settlementNeed ? 1 : 0)) / (g.total + 1);
    const w = `${(k * 100).toFixed(1)}%`;
    if (this.barFill.style.width !== w) this.barFill.style.width = w;
    this.text(this.nextEl, g.ready ? 'Every upgrade is ready!' : `Then the ${expansionCostText(n).replace(/^Expansion/, 'expansion')}`);

    this.show(this.ready, g.ready);
    if (g.ready) this.text(this.readyText, `<b>${era.region} is for sale!</b><span>${expansionCostText(n)}</span>`);

    const open = openRows(g);
    this.show(this.doneEl, g.ok > 0);
    this.text(this.doneEl, `✓ ${g.ok} done`);
    for (let i = 0; i < this.slots.length; i++) this.renderRow(this.slots[i]!, open[i] ?? null, money);
    const more = open.length - this.slots.length;
    this.show(this.moreEl, more > 0);
    this.text(this.moreEl, `+${more} more`);
    this.renderSettlement(g);

    const buyable = g.rows.filter(rowBuyable);
    const reserve = raiseReserve(money);
    const anyCheap = buyable.some((r) => {
      const c = ctx.upgrades.nextCost(r.id);
      return c !== null && money - c >= reserve;
    });
    const steward = stewardUnlocked(s);
    this.show(this.raiseBtn.parentElement!, buyable.length > 0 || steward);
    this.show(this.raiseBtn, buyable.length > 0);
    this.raiseBtn.classList.toggle('is-poor', !anyCheap);
    this.text(this.raiseNote, `cheapest first · keeps ${formatMoney(reserve)}`);
    this.show(this.stewardBtn, steward);
    if (steward) {
      const on = s.eras.steward;
      this.stewardBtn.classList.toggle('is-on', on);
      this.stewardBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      this.text(this.stewardNote, on ? `On · every ${CLIMB.steward.every} s` : 'Off · tap to start');
    }
    const points = masteryTotal(s);
    this.show(this.masteryEl, points > 0);
    if (points > 0) this.text(this.masteryEl, masteryLine(points, masteryMult(points)));
  }

  private renderRow(slot: RowSlot, row: GateRow | null, money: number): void {
    slot.row = row;
    this.show(slot.root, row !== null);
    if (!row) return;
    const { upgrades } = this.ctx;
    const def = UPGRADES[row.id];
    if (slot.key !== row.id) {
      slot.key = row.id;
      slot.icon.innerHTML = upgradeIcon(row.id);
      slot.name.textContent = def.label;
    }
    const buyable = rowBuyable(row);
    this.text(slot.sub, row.state === 'prereq' ? `<span class="wl-lock">${ICON_LOCK}</span>${gateRowLine(row)}` : gateRowLine(row));
    slot.root.classList.toggle('is-locked', row.state === 'prereq');
    this.show(slot.buy, buyable);
    this.show(slot.to, buyable && (row.shown ?? 0) + 1 < row.need);
    this.show(slot.go, !buyable);
    if (buyable) {
      const cost = upgrades.nextCost(row.id) ?? 0;
      const hire = row.shown === null;
      this.text(slot.buy, `<small>${hire ? 'Hire' : 'Buy'}</small>${formatMoney(cost)}`);
      const cls = `wl-shop-buy wl-gate-buy ${money >= cost ? 'is-buy' : 'is-poor'}`;
      if (slot.buy.className !== cls) slot.buy.className = cls;
      this.text(slot.to, `→ Lv ${row.need}`);
      slot.to.classList.toggle('is-poor', money < cost);
    } else {
      const reachable = goTarget(this.ctx, row.state === 'prereq' ? prereqTarget(row.id, this.ctx.state) : `pad:${row.id}`) !== null;
      this.show(slot.go, reachable);
    }
  }

  private renderSettlement(g: EraGate): void {
    const slot = this.settle;
    const short = g.settlement.level < g.settlementNeed;
    this.show(slot.root, short);
    if (!short) {
      this.settleGoal = null;
      return;
    }
    const goal = settlementGoal(this.ctx.state, g);
    this.settleGoal = goal;
    this.text(slot.name, `Settlement ${g.settlement.level}/${g.settlementNeed}`);
    this.text(slot.sub, goal.text);
    this.show(slot.go, goTarget(this.ctx, goal.action.target) !== null);
  }

  update(dt: number): void {
    if (this.sheet.visible) {
      this.acc += dt;
      if (this.dirty && this.acc >= REFRESH_EVERY) {
        this.acc = 0;
        this.dirty = false;
        this.refresh();
      }
    }
    this.sheet.update(dt);
  }
}
