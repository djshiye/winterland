/**
 * [0.9.0 climb — UI] The era checklist (docs/EXPANSION.md §C): what still stands between the player and the next era's
 * expansion pad. Opens on 'gate:open' (tapping the era chip), closes on its X and Esc; the BuildPanel's sheet look.
 *
 * ADHD-friendly by construction: the top of the list first, the rest one tap away.
 * - Header: "ERA III · IRON AGE" and "Granite Hollow at Lv 10: 12/29 · Settlement 7/10", a progress bar, the rule in
 *   one sentence (0.9.6, eras/gate.ts gateRuleText: "Raise Granite Hollow's machines, crew and upgrades to Lv 10 and
 *   grow to Settlement 10, then buy Iron Ridge.") and the expansion's price. Once the gate is met a gold "Iron Ridge is
 *   for sale!" with Go replaces it.
 * - One small bar per group (0.9.6: Machines 3/6 · Crew 2/7 · Industry · Sales · You · Finance), so nothing hides.
 * - "✓ 12 done", then the TOP 5 open rows (eras/gate.ts openRows: prereqs to build first, then cheapest to finish, settlement-locked rows last) and
 *   "+8 more · Show all" (tap: every open row; tap again: back to 5). Every row has Go (fast travel to where it is
 *   bought): a shop row to the cabin's shop mat, an Industry row to its era's shop mat, a pad row ("pad LV 8 → LV 10")
 *   to the level pad, a prereq row to what unlocks it. A row that only waits for the settlement says "Locked"
 *   (its line: "Reach Settlement 12") in place of Go: the settlement line below is the way there.
 * - The settlement line, one clear line while it is short: "Settlement 7/10 · Build a home in Brickside (+40) →
 *   Settlement 8" with Go to the district (settlement rises freely since 0.9.6, so homes always count).
 * - 0.9.7 (decision 4): a Completion section with the five parts of the 100 % award (core/completion.ts) as small bars,
 *   "★ 63% of Winterland". Era 10's card is the final gate ("Winterland Complete", eras/gate.ts FINAL_GATE): once it is
 *   met, the card keeps the completion bars and the next missing piece with its Go.
 *
 * Read-only by design: upgrades are hands-on (stand on a pad, step on a shop mat). The card never buys anything.
 *
 * The five row slots are built once; refresh() rewrites only what changed, at most 4× a second while open (the
 * checklist prices every open step).
 */
import { LAYOUT, PADS, UPGRADES, type PadIdConst } from '../config';
import type { GameContext, UpgradeId } from '../core/types';
import { ERAS } from '../eras/data';
import { completion, completionTag, nextMissing, type CompletionItem } from '../core/completion';
import { climbOpen, eraGate, eraMatOf, FINAL_GATE, FINAL_NAME, gateGroups, gateRuleText, hasGate, openRows, padPaid, padTarget, prereqTarget, settlementGoal, waitsForSettlement, type EraGate, type GateRow, type NextGoal } from '../eras/gate';
import { machinePadTarget } from '../eras/rules';
import { regionLayout, travelPoints } from '../eras/layout';
import { eraRoman, expansionCostText, gateMoneyLine, gateRowLine } from './agesLogic';
import { h, keyLabel, onTap } from './dom';
import { hexCss, ICON_CLOSE, ICON_HOUSE, ICON_LOCK, upgradeIcon } from './icons';
import { Sheet } from './sheet';
import './build.css';
import './ages.css';
import './ending.css';
import { markPanel } from './dialog';

/** Open rows on show at once. */
export const GATE_TOP = 5;
const REFRESH_EVERY = 0.25;

interface RowSlot {
  root: HTMLDivElement;
  icon: HTMLDivElement;
  name: HTMLDivElement;
  sub: HTMLDivElement;
  go: HTMLButtonElement;
  /** "Locked" in place of Go for a row that only waits for the settlement (its line says which level). */
  lock: HTMLSpanElement;
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
  if (row.where === 'pad') return padTarget(row.id);
  const e = eraMatOf(UPGRADES[row.id]);
  return e !== null ? `shop:${e}` : 'shop';
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
  if (target.startsWith('machine:')) {
    // 0.9.5: beside an era machine's level pad (the first built machine of that type)
    const at = machinePadTarget(ctx.state, target.slice(8) as UpgradeId);
    return at ? { x: at.x, z: at.z, label: `${UPGRADES[target.slice(8) as UpgradeId].label} pad` } : null;
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
  private readonly ruleEl: HTMLDivElement;
  private readonly groupsEl: HTMLDivElement;
  /** Every open row on show (tapped "Show all"), not only the top GATE_TOP. */
  private expanded = false;
  private readonly ready: HTMLDivElement;
  private readonly readyText: HTMLDivElement;
  private readonly readyGo: HTMLButtonElement;
  private readonly doneEl: HTMLDivElement;
  private readonly slots: RowSlot[] = [];
  private readonly moreEl: HTMLButtonElement;
  private readonly listEl: HTMLDivElement;
  private readonly settle: RowSlot;
  /** 0.9.7: the five parts of the 100 % award. */
  private readonly completionEl: HTMLDivElement;
  /** The next missing piece once the final gate is met (null otherwise). */
  private missing: CompletionItem | null = null;
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
    this.titleEl = h('div', 'wl-build-title wl-title');
    this.subEl = h('div', 'wl-build-sub');
    titles.append(this.titleEl, this.subEl);
    markPanel(root, this.titleEl, 'wl-gate-title');
    head.appendChild(titles);
    const close = h('button', 'wl-build-close', ICON_CLOSE);
    close.type = 'button';
    close.setAttribute('aria-label', 'Close era checklist');
    close.title = keyLabel('Close', 'Esc');
    onTap(close, () => {
      ctx.audio.play('click');
      this.close();
    });
    head.appendChild(close);
    root.appendChild(head);

    const list = h('div', 'wl-build-list wl-gate-list');
    this.listEl = list;
    const sum = h('div', 'wl-gate-sum');
    const bar = h('div', 'wl-gate-bar');
    this.barFill = h('div', 'wl-gate-fill');
    bar.appendChild(this.barFill);
    this.ruleEl = h('div', 'wl-gate-rule');
    this.nextEl = h('div', 'wl-gate-next');
    this.groupsEl = h('div', 'wl-gate-groups');
    this.completionEl = h('div', 'wl-gate-completion');
    sum.append(bar, this.ruleEl, this.nextEl, this.groupsEl, this.completionEl);
    list.appendChild(sum);

    this.ready = h('div', 'wl-gate-ready');
    this.readyText = h('div', 'wl-gate-ready-text');
    this.readyGo = this.button('wl-gate-go', 'Go');
    onTap(this.readyGo, () => {
      // the final gate has no pad: Go takes the player to the next missing piece, or opens the stats page at 100 %
      if (this.gate?.n !== FINAL_GATE) this.go(`region:${this.gate?.n ?? 0}`);
      else if (this.missing?.target) this.go(this.missing.target);
      else if (!this.missing) {
        ctx.audio.play('click');
        this.close();
        ctx.events.emit('stats:open', {});
      }
    });
    this.ready.append(this.readyText, this.readyGo);
    list.appendChild(this.ready);

    this.doneEl = h('div', 'wl-gate-done');
    list.appendChild(this.doneEl);
    for (let i = 0; i < GATE_TOP; i++) list.appendChild(this.makeSlot().root);
    this.moreEl = this.button('wl-gate-more', '');
    onTap(this.moreEl, () => {
      ctx.audio.play('click');
      this.expanded = !this.expanded;
      this.dirty = true;
      this.acc = REFRESH_EVERY;
      this.refresh();
    });
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
    ev.on('quest:done', mark);
    ev.on('built', mark);
    ev.on('era:unlocked', () => {
      this.dirty = true;
      this.acc = REFRESH_EVERY;
    });
  }

  /** True while the card is (or is animating to be) on screen. */
  get visible(): boolean {
    return this.sheet.visible;
  }

  /** Show the next era's checklist, or era 10's final one (nothing to show before the Great Lodge). */
  open(): void {
    const s = this.ctx.state;
    if (!climbOpen(s) || !hasGate(s.eras.age + 1)) return;
    this.dirty = true;
    this.acc = REFRESH_EVERY;
    this.expanded = false;
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
    const lock = h('span', 'wl-gate-lockpill');
    lock.style.display = 'none';
    btns.append(go, lock);
    root.append(icon, mid, btns);
    const slot: RowSlot = { root, icon, name, sub, go, lock, row: null, key: '' };
    if (settlement) {
      onTap(go, () => this.settleGoal && this.go(this.settleGoal.action.target));
      return slot;
    }
    onTap(go, () => slot.row && this.go(rowTarget(slot.row, this.ctx.state)));
    this.slots.push(slot);
    return slot;
  }

  /** At least `n` row slots (the expanded list), new ones placed before "+N more". */
  private ensureSlots(n: number): void {
    while (this.slots.length < n) this.listEl.insertBefore(this.makeSlot().root, this.moreEl);
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
    const final = n === FINAL_GATE;
    if (!hasGate(n) || !climbOpen(s)) {
      this.close();
      return;
    }
    const g = eraGate(s, n);
    this.gate = g;
    const accent = era ?? ERAS[n - 1]!;
    this.sheet.root.style.setProperty('--era-accent', hexCss(accent.colors.accent));
    this.text(this.titleEl, era ? `ERA ${eraRoman(n)} · ${era.name.toUpperCase()}` : `\u2605 ${FINAL_NAME.toUpperCase()}`);
    const owner = ERAS[n - 1]?.region ?? 'Survival';
    const settled = g.settlement.level >= g.settlementNeed;
    const st = settled ? `Settlement ${g.settlement.level} ✓` : `Settlement ${g.settlement.level}/${g.settlementNeed}`;
    this.text(this.subEl, `${owner} at Lv ${g.need}: ${g.ok}/${g.total} · ${st}`);
    this.text(this.ruleEl, gateRuleText(n));
    const k = (g.ok + (g.settlement.level >= g.settlementNeed ? 1 : 0)) / (g.total + 1);
    const w = `${(k * 100).toFixed(1)}%`;
    if (this.barFill.style.width !== w) this.barFill.style.width = w;
    const c = completion(s);
    this.missing = final && g.ready ? nextMissing(s) : null;
    if (final) this.text(this.nextEl, g.ready ? 'Every upgrade is at Lv 10!' : `Then ${FINAL_NAME}: the last pieces for 100%`);
    else {
      const left = g.rows.filter((r) => r.state !== 'ok');
      this.text(this.nextEl, g.ready ? 'Every upgrade is ready!' : gateMoneyLine(n, left.length, left.reduce((t, r) => t + r.costToNeed, 0)));
    }

    // a pad with something already paid in stays on sale (grandfathered), whatever the checklist says
    const offered = g.ready || (!final && padPaid(s, n) > 0);
    this.show(this.ready, offered);
    if (offered && era) this.text(this.readyText, `<b>${era.region} is for sale!</b><span>${expansionCostText(n)}</span>`);
    else if (offered) {
      const done = c.complete || !!s.flags.complete;
      this.text(this.readyText, done ? `<b>${FINAL_NAME}!</b><span>Every era, every build, every quest. See your stats.</span>` : `<b>${accent.region} is done!</b><span>Next: ${this.missing?.label ?? 'the last pieces'}</span>`);
      this.text(this.readyGo, done ? 'Stats' : 'Go');
      this.show(this.readyGo, done || (!!this.missing?.target && goTarget(ctx, this.missing.target) !== null));
    }
    if (!final) {
      this.text(this.readyGo, 'Go');
      this.show(this.readyGo, true);
    }
    this.renderCompletion(c);

    this.text(
      this.groupsEl,
      gateGroups(g)
        .map((c) => `<span class="wl-gate-grp${c.ok >= c.total ? ' is-done' : ''}"><b>${c.label}</b> ${c.ok}/${c.total}<i aria-hidden="true" style="width:${((c.ok / c.total) * 100).toFixed(0)}%"></i></span>`)
        .join(''),
    );

    const open = openRows(g);
    this.show(this.doneEl, g.ok > 0);
    this.text(this.doneEl, `✓ ${g.ok} done`);
    const shown = this.expanded ? open.length : GATE_TOP;
    this.ensureSlots(shown);
    for (let i = 0; i < this.slots.length; i++) this.renderRow(this.slots[i]!, i < shown ? open[i] ?? null : null);
    const more = open.length - GATE_TOP;
    this.show(this.moreEl, more > 0);
    this.text(this.moreEl, this.expanded ? 'Show fewer' : `+${more} more · Show all`);
    this.renderSettlement(g);

  }

  /** "★ 63% of Winterland" and one small bar per part of the award (Upgrades, Builds, Quests, Settlement, Eras). */
  private renderCompletion(c: ReturnType<typeof completion>): void {
    const pct = this.ctx.state.flags.complete ? 100 : c.pct;
    const bars = c.parts
      .map((p) => `<span class="wl-gate-grp${p.done >= p.total ? ' is-done' : ''}"><b>${p.label}</b> ${Math.floor(p.frac * 100)}%<i aria-hidden="true" style="width:${(p.frac * 100).toFixed(0)}%"></i></span>`)
      .join('');
    this.text(this.completionEl, `<div class="wl-gate-completion-head">${completionTag(pct)} of Winterland</div><div class="wl-gate-groups">${bars}</div>`);
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
    // waiting for the settlement: no Go (the settlement line below is the way there), a plain "Locked" pill instead
    const waits = waitsForSettlement(row);
    this.show(slot.lock, waits);
    if (waits) this.text(slot.lock, 'Locked');
    this.show(slot.go, !waits && goTarget(this.ctx, rowTarget(row, this.ctx.state)) !== null);
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
    this.text(slot.sub, goal.text.replace(/ → Settlement \d+$/, ''));
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
