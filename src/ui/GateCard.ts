/**
 * [0.9.0 climb — UI] The era checklist (docs/EXPANSION.md §C): what still stands between the player and the next era's
 * expansion pad. Opens on 'gate:open' (tapping the era chip), closes on its X and Esc; the BuildPanel's sheet look.
 *
 * ADHD-friendly by construction: never the whole list.
 * - Header: "ERA II · FRONTIER" and "12/23 upgrades at Lv 10 · Settlement 5/5", a progress bar, then what comes after:
 *   "then the expansion: $1.5M + 20 Crates". Once the gate is met a gold "Frontier is for sale!" with Go replaces it.
 * - "✓ 12 done", then only the TOP 5 open rows (eras/gate.ts openRows: prereqs first, then cheapest to finish) and
 *   "+8 more". Every row has Go (fast travel to where it is bought): a shop row to the cabin's shop mat, an Industry
 *   row to its era's shop mat, a pad row ("pad LV 8 → LV 11") to the level pad, a prereq row to what unlocks it.
 * - The settlement row while it is short: "Build a home in Brickside (+40) → Settlement 6" with Go to the district.
 * - Once a level has passed a hard cap, the Mastery line under the bar: "Mastery 340 · +41 % on every sale".
 *
 * Read-only by design: upgrades are hands-on (stand on a pad, step on a shop mat). The card never buys anything.
 *
 * The five row slots are built once; refresh() rewrites only what changed, at most 4× a second while open (the
 * checklist prices every open step).
 */
import { LAYOUT, PADS, UPGRADES, type PadIdConst } from '../config';
import type { GameContext } from '../core/types';
import { ERAS } from '../eras/data';
import { masteryTotal } from '../core/demand';
import { introEra, masteryMult } from '../core/ladder';
import { climbOpen, eraGate, openRows, padPaid, prereqTarget, settlementGoal, type EraGate, type GateRow, type NextGoal } from '../eras/gate';
import { regionLayout, travelPoints } from '../eras/layout';
import { eraRoman, expansionCostText, gateRowLine, masteryLine } from './agesLogic';
import { h, onTap } from './dom';
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
  go: HTMLButtonElement;
  row: GateRow | null;
  /** Last written html / class per element (skip redundant DOM writes). */
  key: string;
}

/**
 * Where a row is bought: 'pad:<id>' (a machine's level pad), what unlocks a prereq, 'shop' (the cabin's shop mat) or
 * 'shop:<n>' (era n's shop mat in its region, for an Industry upgrade of that era).
 */
export function rowTarget(row: GateRow, s: GameContext['state']): string {
  if (row.state === 'prereq') return prereqTarget(row.id, s);
  if (row.where === 'pad') return `pad:${row.id}`;
  const def = UPGRADES[row.id];
  return def.group === 'industry' ? `shop:${introEra(def)}` : 'shop';
}

/** Where a Go button takes the player (null: nowhere to go). */
export function goTarget(ctx: Pick<GameContext, 'state'>, target: string): { x: number; z: number; label: string } | null {
  if (target === 'shop') {
    // onto the cabin doormat: the shop panel opens as the player lands
    const m = LAYOUT.shop.mat;
    return { x: (m.minX + m.maxX) / 2, z: (m.minZ + m.maxZ) / 2, label: 'Shop' };
  }
  if (target.startsWith('shop:')) {
    const n = Number(target.slice(5));
    if (!ERAS[n] || ctx.state.eras.age < n) return null;
    const at = regionLayout(n).shopMat;
    return { x: at.x, z: at.z, label: `${ERAS[n]!.region} shop` };
  }
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

    const mark = (): void => {
      this.dirty = true;
    };
    const ev = ctx.events;
    ev.on('gate:open', () => this.open());
    // what moves a row or the settlement line (eras/GateTracker.ts's list); money no longer matters: nothing is bought here
    for (const e of ['upgrade:bought', 'settlement:changed', 'machine:built', 'pad:unlocked', 'quarters:built', 'village:changed'] as const) ev.on(e, mark);
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
    const go = this.button('wl-gate-go', 'Go');
    btns.append(go);
    root.append(icon, mid, btns);
    const slot: RowSlot = { root, icon, name, sub, go, row: null, key: '' };
    if (settlement) {
      onTap(go, () => this.settleGoal && this.go(this.settleGoal.action.target));
      return slot;
    }
    onTap(go, () => slot.row && this.go(rowTarget(slot.row, this.ctx.state)));
    this.slots.push(slot);
    return slot;
  }

  // ---------------------------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------------------------

  private refuse(): void {
    this.ctx.audio.play('full', { volume: 0.5 });
    this.sheet.shake();
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
    this.sheet.root.style.setProperty('--era-accent', hexCss(era.colors.accent));
    this.text(this.titleEl, `ERA ${eraRoman(n)} · ${era.name.toUpperCase()}`);
    const st = Math.min(g.settlement.level, g.settlementNeed);
    this.text(this.subEl, `${g.ok}/${g.total} upgrades at Lv ${g.need} · Settlement ${st}/${g.settlementNeed}`);
    const k = (g.ok + (g.settlement.level >= g.settlementNeed ? 1 : 0)) / (g.total + 1);
    const w = `${(k * 100).toFixed(1)}%`;
    if (this.barFill.style.width !== w) this.barFill.style.width = w;
    this.text(this.nextEl, g.ready ? 'Every upgrade is ready!' : `Then the ${expansionCostText(n).replace(/^Expansion/, 'expansion')}`);

    // a pad with something already paid in stays on sale (grandfathered), whatever the checklist says
    const offered = g.ready || padPaid(s, n) > 0;
    this.show(this.ready, offered);
    if (offered) this.text(this.readyText, `<b>${era.region} is for sale!</b><span>${expansionCostText(n)}</span>`);

    const open = openRows(g);
    this.show(this.doneEl, g.ok > 0);
    this.text(this.doneEl, `✓ ${g.ok} done`);
    for (let i = 0; i < this.slots.length; i++) this.renderRow(this.slots[i]!, open[i] ?? null);
    const more = open.length - this.slots.length;
    this.show(this.moreEl, more > 0);
    this.text(this.moreEl, `+${more} more`);
    this.renderSettlement(g);

    const points = masteryTotal(s);
    this.show(this.masteryEl, points > 0);
    if (points > 0) this.text(this.masteryEl, masteryLine(points, masteryMult(points)));
  }

  private renderRow(slot: RowSlot, row: GateRow | null): void {
    slot.row = row;
    this.show(slot.root, row !== null);
    if (!row) return;
    const def = UPGRADES[row.id];
    if (slot.key !== row.id) {
      slot.key = row.id;
      slot.icon.innerHTML = upgradeIcon(row.id);
      slot.name.textContent = def.label;
    }
    this.text(slot.sub, row.state === 'prereq' ? `<span class="wl-lock">${ICON_LOCK}</span>${gateRowLine(row)}` : gateRowLine(row));
    slot.root.classList.toggle('is-locked', row.state === 'prereq');
    this.show(slot.go, goTarget(this.ctx, rowTarget(row, this.ctx.state)) !== null);
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
