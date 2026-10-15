/**
 * [B4] Quest panel (wave 8): a compact card on the left (under the money pill / village badge / season chip) with the
 * three active quests from ctx.quests.active(): title, progress bar "12 / 40" and a reward chip "$350".
 * - Collapsible to a small "Quests 4/18" chip; the state persists in localStorage 'winterland:quests' ('1' = collapsed).
 *   With nothing stored it starts collapsed on phones (<= 640 px wide) and open elsewhere.
 * - When every quest is done the chip reads "All quests complete ★" (nothing to expand).
 * - The DOM is refreshed ~4 times per second on simulation time (and right after a toggle / a completed quest);
 *   text is only rewritten when it changed. Hidden during the intro cinematic.
 * The completion toast, coin burst and chime are driven by the JuiceDirector ('quest:done').
 */
import type { GameContext } from '../core/types';
import { h, onTap, shield } from './dom';
import { formatCount, formatMoney } from './format';
import { ICON_STAR } from './icons';

const KEY = 'winterland:quests';
const REFRESH = 0.25;
const ROWS = 3;

interface Row {
  el: HTMLDivElement;
  title: HTMLDivElement;
  fill: HTMLDivElement;
  count: HTMLSpanElement;
  reward: HTMLSpanElement;
  id: string;
  shown: string;
}

export class QuestPanel {
  private readonly root: HTMLDivElement;
  private readonly head: HTMLButtonElement;
  private readonly headLabel: HTMLSpanElement;
  private readonly body: HTMLDivElement;
  private readonly rows: Row[] = [];
  private collapsed: boolean;
  private acc = REFRESH;
  private lastHead = '';
  private lastDisplay = '';
  private allDone = false;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      /* storage unavailable */
    }
    this.collapsed = stored === null ? window.innerWidth <= 640 : stored === '1';

    this.root = h('div', 'wl-quests');
    this.head = h('button', 'wl-quests-head');
    this.head.type = 'button';
    this.head.setAttribute('aria-label', 'Quests');
    this.headLabel = h('span', 'wl-quests-label');
    this.head.append(h('i', 'wl-quests-star', ICON_STAR), this.headLabel, h('b', 'wl-quests-caret', ''));
    shield(this.head);
    onTap(this.head, () => {
      ctx.audio.unlock();
      ctx.audio.play('click');
      this.setCollapsed(!this.collapsed);
    });
    this.body = h('div', 'wl-quests-body');
    for (let i = 0; i < ROWS; i++) {
      const el = h('div', 'wl-quest');
      const title = h('div', 'wl-quest-title');
      const bar = h('div', 'wl-quest-bar');
      const fill = h('div', 'wl-quest-fill');
      const count = h('span', 'wl-quest-count');
      bar.append(fill, count);
      const reward = h('span', 'wl-quest-reward');
      const line = h('div', 'wl-quest-line');
      line.append(bar, reward);
      el.append(title, line);
      this.body.appendChild(el);
      this.rows.push({ el, title, fill, count, reward, id: '', shown: '' });
    }
    shield(this.body);
    this.root.append(this.head, this.body);
    layer.appendChild(this.root);
    this.applyCollapsed();
    ctx.events.on('quest:done', () => {
      this.acc = REFRESH; // show the next quest right away
    });
  }

  get isCollapsed(): boolean {
    return this.collapsed;
  }

  /** Every quest is done (the chip says so; nothing to expand). */
  get isAllDone(): boolean {
    return this.allDone;
  }

  /** Expand / collapse (persisted). */
  setCollapsed(c: boolean): void {
    this.collapsed = c;
    try {
      localStorage.setItem(KEY, c ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    this.applyCollapsed();
    this.acc = REFRESH;
  }

  private applyCollapsed(): void {
    this.root.classList.toggle('is-collapsed', this.collapsed || this.allDone);
    this.head.setAttribute('aria-expanded', String(!this.collapsed));
  }

  update(dt: number): void {
    const hide = this.ctx.state.phase === 'intro';
    const disp = hide ? 'none' : '';
    if (disp !== this.lastDisplay) {
      this.lastDisplay = disp;
      this.root.style.display = disp;
    }
    if (hide) return;
    this.acc += dt;
    if (this.acc < REFRESH) return;
    this.acc = 0;
    this.refresh();
  }

  /** Re-read the quests now (also called by tests). */
  refresh(): void {
    const q = this.ctx.quests;
    const active = q.active();
    const done = active.length === 0;
    if (done !== this.allDone) {
      this.allDone = done;
      this.root.classList.toggle('is-done', done);
      this.applyCollapsed();
    }
    const head = done ? 'All quests complete ★' : `Quests ${q.doneCount}/${q.total}`;
    if (head !== this.lastHead) {
      this.lastHead = head;
      this.headLabel.textContent = head;
    }
    if (this.collapsed || done) return;
    for (let i = 0; i < ROWS; i++) {
      const row = this.rows[i]!;
      const a = active[i];
      if (!a) {
        if (row.el.style.display !== 'none') row.el.style.display = 'none';
        continue;
      }
      if (row.el.style.display === 'none') row.el.style.display = '';
      const { def, progress } = a;
      if (row.id !== def.id) {
        row.id = def.id;
        row.title.textContent = def.title;
        row.reward.textContent = formatMoney(def.reward);
      }
      const p = Math.floor(progress);
      const text = `${formatCount(p)} / ${formatCount(def.target)}`;
      if (text !== row.shown) {
        row.shown = text;
        row.count.textContent = text;
        row.fill.style.transform = `scaleX(${Math.min(1, progress / def.target).toFixed(3)})`;
      }
    }
  }
}
