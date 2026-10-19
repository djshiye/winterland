/**
 * [0.9.11] The Guidebook: every good, machine, crew role, upgrade, building and rule, one chapter per era reached
 * (ui/guideBook.ts builds the pages from the game's own data). Opened by the HUD's book button, the G key and
 * Settings › Game; closed by its X, G again or Esc (the HUD calls close()). The shop's sheet chrome (hud.css .wl-shop*):
 * a bottom sheet on phones, a side card on wide screens; its own bits live in guidebook.css.
 *
 * - Spoilers: only chapters 1..state.eras.age show; the next era is one locked "???" chip, never a name or a picture.
 *   A new era adds its chapter at once ('era:unlocked'), and the book opens on the newest unread chapter.
 * - "New": a chapter the player has not opened yet carries a gold leaf (flag seen:bookN, kept across seasons like the
 *   other seen:* hints); the HUD button shows a dot while any chapter is unread.
 * - Read-only. It never buys, upgrades or moves anything: upgrades stay hands-on on their pads.
 * - Keyboard / screen reader: a labelled dialog (ui/dialog.ts), Tab kept inside, focus handed back on close; the page
 *   list is a focusable scroll box (input/menuNav.ts scrolls it with Up / Down). Search filters reached pages only.
 */
import { ERAS, MAX_ERA } from '../eras/data';
import type { GameContext } from '../core/types';
import { backOut, cubicOut, h, onTap, shield, Slide } from './dom';
import { FocusReturn, markDialog, trapTab } from './dialog';
import {
  BOOK_SECTIONS,
  bookEntries,
  chapterEntries,
  chapterFlag,
  chapterTitle,
  goodLabel,
  newChapters,
  searchBook,
  type BookEntry,
  type BookGlyph,
  type BookIcon,
  type BookSection,
} from './guideBook';
import { buildingIcon, ICON_CLOSE, ICON_COIN, ICON_GEAR, ICON_HAMMER, ICON_HOUSE, ICON_LOCK, ICON_LOG, ICON_MAP, ICON_MARKET, ICON_PIN, ICON_STAR, ICON_WORKER, upgradeIcon } from './icons';
import { materialIcon } from './materialIcons';
import { inkOn } from './theme';
import './guidebook.css';

const GLYPHS: Record<BookGlyph, string> = {
  house: ICON_HOUSE,
  star: ICON_STAR,
  coin: ICON_COIN,
  hammer: ICON_HAMMER,
  map: ICON_MAP,
  market: ICON_MARKET,
  log: ICON_LOG,
  worker: ICON_WORKER,
  gear: ICON_GEAR,
  pin: ICON_PIN,
};

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function iconOf(icon: BookIcon): string {
  if ('item' in icon) return materialIcon(icon.item);
  if ('upgrade' in icon) return upgradeIcon(icon.upgrade);
  if ('business' in icon) return buildingIcon(icon.business);
  return GLYPHS[icon.glyph];
}

/** The era's accent as CSS custom properties (Survival keeps the theme's pine). */
function eraStyle(n: number): string {
  const d = ERAS[n];
  return d ? `--c:${hex(d.colors.accent)};--c-ink:${hex(inkOn(d.colors.accent))}` : '';
}

export class GuidebookPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly chapters: HTMLDivElement;
  private readonly chapterHead: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly tabEls = new Map<BookSection, HTMLButtonElement>();
  private readonly slide = new Slide();
  private readonly focusBack = new FocusReturn();
  private section: BookSection = 'goods';
  private chapter = 1;
  private query = '';
  private dirty = true;
  /** Opened from the keyboard: the focus moves in once the sheet is laid out (a hidden element takes no focus). */
  private focusPending = false;
  /** What the list shows, so a refresh only rebuilds it when something changed. */
  private shownKey = '';

  /** Called when the unread state changes (the HUD's button dot). */
  onNewChanged: ((hasNew: boolean) => void) | null = null;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.root = h('div', 'wl-shop wl-book');
    shield(this.root);
    this.root.style.display = 'none';

    const head = h('div', 'wl-shop-head is-stacked');
    const title = h('div', 'wl-shop-title wl-title', 'Guidebook');
    head.appendChild(title);
    markDialog(this.root, title, 'wl-book-title');
    trapTab(this.root);
    this.root.addEventListener('focusin', (e) => {
      const from = e.relatedTarget;
      if (!(from instanceof Node) || !this.root.contains(from)) this.focusBack.take(from instanceof Element ? from : null);
    });
    const close = h('button', 'wl-shop-close', ICON_CLOSE);
    close.type = 'button';
    close.setAttribute('aria-label', 'Close guidebook');
    onTap(close, () => {
      ctx.audio.play('click');
      this.close();
    });
    head.appendChild(close);
    const tabs = h('div', 'wl-shop-tabs wl-book-tabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'Sections');
    for (const s of BOOK_SECTIONS) {
      const b = h('button', 'wl-shop-tab', `<span>${s.label}</span>`);
      b.type = 'button';
      onTap(b, () => {
        ctx.audio.unlock();
        ctx.audio.play('click');
        this.setSection(s.id);
      });
      tabs.appendChild(b);
      this.tabEls.set(s.id, b);
    }
    head.appendChild(tabs);
    this.root.appendChild(head);

    this.chapters = h('div', 'wl-book-chapters');
    this.chapters.setAttribute('role', 'group');
    this.chapters.setAttribute('aria-label', 'Chapters');
    this.root.appendChild(this.chapters);

    const find = h('label', 'wl-book-find');
    this.search = h('input', 'wl-book-search');
    this.search.type = 'search';
    this.search.placeholder = 'Search the book';
    this.search.setAttribute('aria-label', 'Search the guidebook');
    this.search.autocomplete = 'off';
    this.search.spellcheck = false;
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim();
      this.mark();
    });
    // the game's shortcuts sleep while typing, so Esc is handled here: clear the search, then close
    this.search.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (this.search.value) {
        this.search.value = '';
        this.query = '';
        this.mark();
      } else {
        this.search.blur();
        this.close();
      }
    });
    find.appendChild(this.search);
    this.root.appendChild(find);

    this.chapterHead = h('div', 'wl-book-chap');
    this.root.appendChild(this.chapterHead);

    this.list = h('div', 'wl-shop-list wl-book-list wl-scrollbox');
    this.list.tabIndex = 0;
    this.list.setAttribute('aria-label', 'Pages');
    this.root.appendChild(this.list);
    layer.appendChild(this.root);

    ctx.events.on('era:unlocked', () => {
      this.mark();
      this.onNewChanged?.(this.hasNew);
    });
    this.setSection('goods');
  }

  /** True while the book is (or is animating to be) on screen. */
  get visible(): boolean {
    return this.slide.open;
  }

  /** Era reached this season (the spoiler line). */
  private get age(): number {
    return Math.max(1, Math.min(MAX_ERA, this.ctx.state.eras.age | 0));
  }

  /** Any reached chapter the player has not opened yet. */
  get hasNew(): boolean {
    return newChapters(this.age, this.ctx.state.flags).length > 0;
  }

  /** Open on the newest unread chapter (else the current era). `focus`: opened from the keyboard. */
  open(focus = false): void {
    if (this.slide.open) return;
    const unread = newChapters(this.age, this.ctx.state.flags);
    this.chapter = unread.length ? unread[unread.length - 1]! : this.age;
    this.slide.open = true;
    this.mark();
    this.refresh();
    this.focusPending = focus;
  }

  close(): void {
    if (!this.slide.open) return;
    this.slide.open = false;
    this.focusPending = false;
    this.focusBack.give(this.root);
  }

  toggle(focus = false): void {
    if (this.slide.open) this.close();
    else this.open(focus);
  }

  /** For tests / the debug hooks. */
  get state(): { section: BookSection; chapter: number; query: string; titles: string[] } {
    return { section: this.section, chapter: this.chapter, query: this.query, titles: this.shown().map((e) => e.name) };
  }

  setSection(s: BookSection): void {
    this.section = s;
    for (const [id, el] of this.tabEls) {
      el.classList.toggle('is-on', id === s);
      el.setAttribute('aria-pressed', String(id === s));
    }
    this.list.scrollTop = 0;
    this.mark();
  }

  setChapter(n: number): void {
    if (n < 1 || n > this.age) return;
    this.chapter = n;
    this.list.scrollTop = 0;
    this.mark();
  }

  private mark(): void {
    this.dirty = true;
  }

  /** The pages on show: the search across every reached chapter, else the chosen chapter's section. */
  private shown(): BookEntry[] {
    if (this.query) return searchBook(this.age, this.query);
    // the rules read the same in every era: How to lists every reached one
    if (this.section === 'tips') return bookEntries(this.age).filter((e) => e.section === 'tips');
    return chapterEntries(this.age, this.chapter, this.section);
  }

  private refresh(): void {
    this.dirty = false;
    const age = this.age;
    if (this.chapter > age) this.chapter = age;
    // reading a chapter clears its leaf
    if (this.slide.open && this.chapter >= 2 && !this.query && this.section !== 'tips') {
      const f = chapterFlag(this.chapter);
      if (!this.ctx.state.flags[f]) {
        this.ctx.state.flags[f] = true;
        this.onNewChanged?.(this.hasNew);
      }
    }
    const unread = new Set(newChapters(age, this.ctx.state.flags));
    const key = `${age}|${this.chapter}|${this.section}|${this.query}|${[...unread].join(',')}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.renderChapters(age, unread);
    const byChapter = !this.query && this.section !== 'tips';
    this.chapters.style.display = this.query || this.section === 'tips' ? 'none' : '';
    this.chapterHead.style.display = byChapter ? '' : 'none';
    if (byChapter) {
      const t = chapterTitle(this.chapter);
      this.chapterHead.setAttribute('style', eraStyle(this.chapter));
      this.chapterHead.innerHTML = `<div class="wl-book-chap-name">${esc(t.name)}</div><div class="wl-book-chap-line">${esc(t.line)}</div><div class="wl-book-chap-place">${ICON_PIN}<span>${esc(t.place)}</span></div>`;
    }
    const pages = this.shown();
    const tag = !!this.query;
    this.list.innerHTML = pages.length ? pages.map((e) => this.card(e, tag)).join('') : `<div class="wl-book-empty">${this.query ? 'Nothing in the book matches that yet.' : 'Nothing here yet.'}</div>`;
  }

  private renderChapters(age: number, unread: Set<number>): void {
    const focusedEra = (document.activeElement as HTMLElement | null)?.dataset?.era;
    this.chapters.innerHTML = '';
    for (let n = 1; n <= age; n++) {
      const t = chapterTitle(n);
      const isNew = unread.has(n);
      const b = h('button', `wl-book-chip${n === this.chapter ? ' is-on' : ''}${isNew ? ' is-new' : ''}`, `<span>${esc(t.name)}</span>${isNew ? '<i class="wl-book-leaf" aria-hidden="true"></i>' : ''}`);
      b.type = 'button';
      b.dataset.era = String(n);
      b.setAttribute('style', eraStyle(n));
      b.setAttribute('aria-pressed', String(n === this.chapter));
      b.setAttribute('aria-label', `${t.name}${isNew ? ', new' : ''}`);
      onTap(b, () => {
        this.ctx.audio.play('click');
        this.setChapter(n);
      });
      this.chapters.appendChild(b);
    }
    if (age < MAX_ERA) {
      const lock = h('div', 'wl-book-chip is-locked', `${ICON_LOCK}<span>???</span>`);
      lock.setAttribute('role', 'note');
      lock.setAttribute('aria-label', 'Locked chapter: reach the next era to read it');
      lock.title = 'Reach the next era to read this chapter';
      this.chapters.appendChild(lock);
    }
    // keep the keyboard where it was after a rebuild
    const again = focusedEra ? this.chapters.querySelector<HTMLElement>(`[data-era="${focusedEra}"]`) : null;
    again?.focus({ preventScroll: true });
  }

  private card(e: BookEntry, eraTag: boolean): string {
    const tag = eraTag ? `<span class="wl-book-era" style="${eraStyle(e.era)}">${esc(chapterTitle(e.era).name)}</span>` : '';
    let recipe = '';
    if (e.needs?.length || e.makes) {
      const chip = (kind: Parameters<typeof materialIcon>[0], n: number): string => `<span class="wl-book-good">${materialIcon(kind)}<span>${n > 1 ? `${n} ` : ''}${esc(goodLabel(kind))}</span></span>`;
      const needs = (e.needs ?? []).map((i) => chip(i.kind, i.per)).join('<span class="wl-book-plus" aria-hidden="true">+</span>');
      const makes = e.makes ? chip(e.makes.kind, e.makes.count) : '';
      recipe = `<div class="wl-book-recipe">${needs ? `<span class="wl-book-sr">Needs </span>${needs}<span class="wl-book-arrow" aria-hidden="true">→</span><span class="wl-book-sr"> makes </span>` : '<span class="wl-book-sr">Makes </span>'}${makes}</div>`;
    }
    const where = e.where ? `<div class="wl-book-where">${ICON_PIN}<span>${esc(e.where)}</span></div>` : '';
    return `<div class="wl-shop-card wl-book-card" role="article" aria-label="${esc(e.name)}"><div class="wl-shop-icon" aria-hidden="true">${iconOf(e.icon)}</div><div class="wl-shop-mid"><div class="wl-shop-name">${esc(e.name)}${tag}</div><div class="wl-book-text">${esc(e.text)}</div>${recipe}${where}</div></div>`;
  }

  update(dt: number): void {
    const s = this.slide;
    if (s.open && this.dirty) this.refresh();
    if (s.step(dt, 0.26) || s.k > 0) {
      if (s.k <= 0) {
        this.root.style.display = 'none';
      } else {
        if (this.root.style.display === 'none') this.root.style.display = 'flex';
        if (this.focusPending) {
          this.focusPending = false;
          this.tabEls.get(this.section)?.focus({ preventScroll: true });
        }
        const e = s.open ? backOut(Math.min(1, s.k)) : cubicOut(s.k);
        this.root.style.setProperty('--k', e.toFixed(3));
        this.root.style.opacity = Math.min(1, s.k * 3).toFixed(2);
      }
    }
  }
}
