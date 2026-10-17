/**
 * [0.9.8 — in-game updater] The update card and the "What's new" changelog, one calm centred card in a few views:
 * - 'available': a newer Winterland is out (desktop/updater.cjs checked GitHub). Its notes (the release's CHANGELOG
 *   entry, checked against the release's SHA256SUMS.txt) scroll in a box; "Keep playing" or "Update now". Keep playing
 *   remembers that version, so its card never shows again by itself (core/updatePrefs.ts). A copy that can't update
 *   itself (a Mac app run straight from Downloads, a read-only folder) offers "Open download page" instead.
 * - 'downloading' (progress bar, Cancel) → 'installing' (the game saves, the updater script takes over, the game
 *   closes and the new version opens) or 'error' (why, and that nothing changed).
 * - 'current': "You have the newest Winterland" (only after Settings › Check now).
 * - 'changelog': the first launch after an update lists every release since the version the player had
 *   (core/changelog.ts, from the bundled CHANGELOG.md); Settings › What's new opens it any time.
 * Never blocking: the card waits until no other card is open, Esc / gamepad B is always "Keep playing" / "Cancel" /
 * close (HUD.escape, ui/escapeOrder.ts), and for the first moment after it opens its buttons ignore presses, so an A
 * or Space held for work never starts an update by accident. Keyboard and gamepad move the focus ring as in every
 * card (input/menuNav.ts); the notes box takes Up / Down to scroll. Reduce motion: no bounce, no bar animation.
 * Text is set with textContent only: nothing from the network or the changelog is ever parsed as HTML.
 */
import changelogText from '../../CHANGELOG.md?raw';
import { changelogStart, entriesBetween, inlineRuns, parseChangelog, type ChangelogEntry } from '../core/changelog';
import type { GameContext } from '../core/types';
import { readSeenVersion, readUpdatePrefs, writeSeenVersion, writeUpdatePrefs } from '../core/updatePrefs';
import { GAME_VERSION, isNewerVersion } from '../core/version';
import { desktop, type UpdateBridge, type UpdateFailCode, type UpdateInfo } from '../platform/desktop';
import { backOut, h, onTap, shield, Slide } from './dom';
import './update.css';

export type UpdateView = 'available' | 'downloading' | 'installing' | 'error' | 'current' | 'changelog';

/** Seconds after the game starts before the first automatic check (the start stays quick and quiet). */
const CHECK_DELAY = 4;
/** Seconds the buttons ignore presses after the card opens. */
const ARM_DELAY = 0.6;

/** What each stop reason means to a player. */
export const FAIL_TEXT: Record<UpdateFailCode, string> = {
  offline: "Couldn't reach GitHub. Check your internet connection and try again later.",
  norelease: "Couldn't find Winterland's releases on GitHub. Try again later.",
  nodownload: "The new version has no download for this computer yet. It's on its way.",
  current: 'You already have the newest version.',
  running: "The game didn't close in time for the update. Try again from Settings › Game.",
  checksum: "The download didn't match its checksum, so it was thrown away.",
  files: "Couldn't replace the game files. Is the Winterland folder somewhere you can write to?",
  unzip: "Your computer needs 'unzip' to update (for example: sudo apt install unzip).",
  cancelled: 'The download was cancelled.',
  other: 'Something unexpected got in the way.',
};

const ICON_GIFT =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="9" y="26" width="46" height="30" rx="6" fill="#ff8a8a" stroke="#fff" stroke-width="3"/>' +
  '<rect x="6" y="18" width="52" height="12" rx="5" fill="#ff6b6b" stroke="#fff" stroke-width="3"/><path d="M28 18h8v38h-8z" fill="#ffd84a"/>' +
  '<path d="M32 18c-6-10-17-9-15-2 1 4 9 3 15 2zM32 18c6-10 17-9 15-2-1 4-9 3-15 2z" fill="#ffd84a" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>';
const ICON_SCROLL =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 10h32a6 6 0 0 1 6 6v34a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6V14" fill="#fff6dc" stroke="#fff" stroke-width="3"/>' +
  '<path d="M12 14a4 4 0 1 1 8 0v4h-8z" fill="#ffd84a"/><path d="M22 24h22M22 32h22M22 40h14" stroke="#c99a52" stroke-width="3.5" stroke-linecap="round"/>' +
  '<path d="M44 44l2 4 4 .6-3 3 .8 4.4-3.8-2-3.8 2 .8-4.4-3-3 4-.6z" fill="#ffd84a"/></svg>';
const ICON_SNOW =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="#7fc8ff" stroke="#fff" stroke-width="3"/>' +
  '<path d="M32 14v36M16.4 23l31.2 18M16.4 41l31.2-18" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>';

const MB = 1024 * 1024;
const mb = (n: number): string => `${Math.max(0, n / MB).toFixed(n >= 100 * MB ? 0 : 1)} MB`;

/** Append inline runs (bold / italic / code) to an element, as text nodes and tags: never HTML. */
function appendInline(el: HTMLElement, text: string): void {
  for (const r of inlineRuns(text)) {
    const node = r.bold ? h('b') : r.em ? h('i') : r.code ? h('code') : null;
    if (node) {
      node.textContent = r.text;
      el.appendChild(node);
    } else el.appendChild(document.createTextNode(r.text));
  }
}

/** One changelog entry (or a release's notes) as a block of DOM. */
function renderEntry(e: ChangelogEntry, withHeading: boolean): HTMLElement {
  const box = h('section', 'wl-cl-entry');
  if (withHeading) {
    const head = h('div', 'wl-cl-version');
    head.textContent = `Winterland ${e.version}`;
    if (e.date) {
      const d = h('small');
      d.textContent = e.date;
      head.appendChild(d);
    }
    box.appendChild(head);
  }
  let list: HTMLUListElement | null = null;
  for (const b of e.blocks) {
    if (b.kind === 'li') {
      if (!list) list = box.appendChild(h('ul', 'wl-cl-list'));
      const li = h('li');
      appendInline(li, b.text);
      list.appendChild(li);
      continue;
    }
    list = null;
    const el = b.kind === 'h' ? h('div', 'wl-cl-head') : h('p', 'wl-cl-p');
    appendInline(el, b.text);
    box.appendChild(el);
  }
  return box;
}

export class UpdateCard {
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly slide = new Slide();
  private readonly entries: ChangelogEntry[];
  private view: UpdateView | null = null;
  /** Views waiting for the screen to be free of other cards. */
  private readonly queue: (() => void)[] = [];
  private bridge: UpdateBridge | null = null;
  private info: UpdateInfo | null = null;
  private latest: { version: string; notes: string | null } | null = null;
  private armed = 0;
  private checkIn = -1;
  private checking = false;
  private bar: HTMLElement | null = null;
  private barText: HTMLElement | null = null;
  private stopProgress: (() => void) | null = null;
  /** The button Esc / B presses in the current view. */
  private escapeAction: (() => void) | null = null;
  /** The button that takes the focus ring when the view shows. */
  private focusEl: HTMLButtonElement | null = null;

  /** True while another card owns the screen (the HUD's notices, the welcome-back card, Settings, the finale ...). */
  busy: () => boolean = () => false;
  /** Writes the save now (before the updater closes the game). */
  saveNow: () => void = () => {};

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
  ) {
    this.entries = parseChangelog(changelogText);
    this.backdrop = h('div', 'wl-modal wl-modal-dim wl-update-modal');
    this.backdrop.style.display = 'none';
    shield(this.backdrop);
    this.card = h('div', 'wl-card wl-update');
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-labelledby', 'wl-update-title');
    this.card.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.escape();
      }
    });
    this.backdrop.appendChild(this.card);
    layer.appendChild(this.backdrop);
  }

  get isOpen(): boolean {
    return this.view !== null;
  }

  /** The view on show (tests). */
  get shownView(): UpdateView | null {
    return this.view;
  }

  /** Esc / gamepad B: the card's way out ("Keep playing", "Cancel", close). Nothing while the game hands over. */
  escape(): void {
    if (this.view && this.view !== 'installing' && performance.now() / 1000 >= this.armed) this.escapeAction?.();
  }

  /**
   * At the start of a session (Game, after the save notices): the changelog when the game was updated, a stopped
   * in-game update, then (desktop, "Check for updates" on) a quiet check a few seconds in.
   */
  start(opts: { savedBy: string | null; hadSave: boolean; fresh: boolean }): void {
    if (!opts.fresh) {
      const plan = changelogStart(readSeenVersion(), opts.savedBy, opts.hadSave, GAME_VERSION);
      if (plan.show) {
        const list = entriesBetween(this.entries, plan.from, GAME_VERSION);
        if (list.length) this.enqueue(() => this.showChangelog(list, plan.from));
      }
      writeSeenVersion(GAME_VERSION);
    }
    this.bridge = desktop()?.updates ?? null;
    if (!this.bridge) return;
    void this.bridge
      .info()
      .then((info) => {
        this.info = info;
        if (!info) return;
        if (info.failed && info.failed !== 'cancelled') this.enqueue(() => this.showError(info.failed!, true));
        if (info.supported && readUpdatePrefs().auto && !opts.fresh) this.checkIn = CHECK_DELAY;
      })
      .catch(() => {
        /* an older shell or a broken bridge: no updates, the game carries on */
      });
  }

  /** True when this copy can check for updates at all (the Settings rows show only then). */
  get canCheck(): boolean {
    return !!this.bridge && !!this.info?.supported;
  }

  /** Settings › Check now: check and always say how it went. */
  checkNow(): void {
    void this.check(true);
  }

  /** Settings › What's new: this version and the ones before it. */
  showWhatsNew(): void {
    const list = this.entries.filter((e) => !isNewerVersion(e.version, GAME_VERSION));
    if (list.length) this.enqueue(() => this.showChangelog(list, 'all'));
  }

  private async check(manual: boolean): Promise<void> {
    if (!this.bridge || this.checking) return;
    this.checking = true;
    try {
      const r = await this.bridge.check();
      if (r.status === 'available') {
        this.latest = { version: r.version, notes: typeof r.notes === 'string' ? r.notes : null };
        if (manual || readUpdatePrefs().skipped !== r.version) this.enqueue(() => this.showAvailable());
      } else if (manual) {
        if (r.status === 'none') this.enqueue(() => this.showCurrent());
        else this.enqueue(() => this.showError(r.code, false));
      }
    } catch {
      if (manual) this.enqueue(() => this.showError('other', false));
    } finally {
      this.checking = false;
    }
  }

  // --- views -------------------------------------------------------------------------------------------------------

  private enqueue(show: () => void): void {
    this.queue.push(show);
  }

  private frame(icon: string, title: string): void {
    this.card.replaceChildren();
    this.bar = null;
    this.barText = null;
    this.card.appendChild(h('div', 'wl-notice-icon wl-update-icon', icon));
    const t = h('div', 'wl-card-title wl-outline');
    t.id = 'wl-update-title';
    t.textContent = title;
    this.card.appendChild(t);
  }

  private line(text: string, cls = ''): HTMLParagraphElement {
    const p = h('p', `wl-notice-line ${cls}`.trim());
    p.textContent = text;
    this.card.appendChild(p);
    return p;
  }

  /** A scrolling box (Up / Down scroll it while it has the focus ring: input/menuNav.ts). */
  private scrollBox(label: string): HTMLDivElement {
    const box = h('div', 'wl-scrollbox wl-update-notes');
    box.tabIndex = 0;
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', label);
    this.card.appendChild(box);
    return box;
  }

  private buttons(list: { label: string; style: 'green' | 'grey' | 'gold'; tap: () => void }[], focus: number): void {
    const row = h('div', 'wl-btn-row wl-notice-buttons');
    const els = list.map((b) => {
      const el = h('button', `wl-btn wl-btn-${b.style}`);
      el.type = 'button';
      el.textContent = b.label;
      onTap(el, () => {
        if (performance.now() / 1000 < this.armed) return; // a press held from playing never lands here
        this.ctx.audio.unlock();
        this.ctx.audio.play('click');
        b.tap();
      });
      row.appendChild(el);
      return el;
    });
    this.card.appendChild(row);
    this.focusEl = els[focus] ?? null;
  }

  private present(view: UpdateView, sound = true): void {
    const wasOpen = this.view !== null;
    this.view = view;
    this.card.dataset.view = view;
    this.card.scrollTop = 0;
    if (!wasOpen) {
      this.backdrop.style.display = 'flex';
      this.slide.k = 0;
      this.slide.open = true;
      this.armed = performance.now() / 1000 + ARM_DELAY;
      if (sound) this.ctx.audio.play('chime');
    }
    this.focusEl?.focus({ preventScroll: true });
  }

  private close(): void {
    this.stopProgress?.();
    this.stopProgress = null;
    this.view = null;
    this.escapeAction = null;
    this.focusEl = null;
    this.card.dataset.view = '';
    this.slide.open = false;
  }

  private showAvailable(): void {
    const l = this.latest;
    if (!l) return;
    const canInstall = !!this.info?.canInstall;
    this.frame(ICON_GIFT, 'A new Winterland is ready!');
    this.line(`Version ${l.version} is out. You have ${GAME_VERSION}.`, 'wl-update-sub');
    const notes = l.notes ? parseChangelog(`## ${l.version}\n${l.notes}`)[0] : undefined;
    if (notes && notes.blocks.length) {
      const head = h('div', 'wl-update-whatsnew');
      head.textContent = "What's new";
      this.card.appendChild(head);
      this.scrollBox(`What's new in ${l.version}`).appendChild(renderEntry(notes, false));
    }
    this.line(
      canInstall
        ? 'Updating takes a moment: the game closes, updates and opens again. Your save stays exactly where it is.'
        : "This copy can't update itself where it is, so the download page opens in your browser. Your save stays where it is.",
      'wl-update-small',
    );
    const keep = (): void => {
      writeUpdatePrefs({ skipped: l.version });
      this.close();
    };
    this.escapeAction = keep;
    this.buttons(
      [
        { label: 'Keep playing', style: 'grey', tap: keep },
        canInstall
          ? { label: 'Update now', style: 'green', tap: () => void this.download() }
          : {
              label: 'Download page',
              style: 'green',
              tap: () => {
                this.bridge?.openPage();
                writeUpdatePrefs({ skipped: l.version });
                this.close();
              },
            },
      ],
      1,
    );
    this.present('available');
  }

  private async download(): Promise<void> {
    const b = this.bridge;
    const l = this.latest;
    if (!b || !l) return;
    this.frame(ICON_GIFT, `Getting Winterland ${l.version}`);
    const track = h('div', 'wl-update-bar');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    this.bar = track.appendChild(h('span', 'wl-update-fill'));
    this.card.appendChild(track);
    this.barText = this.line('Starting the download...', 'wl-update-small');
    this.line('It is checked against the release checksum before anything changes.', 'wl-update-small');
    const cancel = (): void => {
      b.cancel();
      this.close();
    };
    this.escapeAction = cancel;
    this.buttons([{ label: 'Cancel', style: 'grey', tap: cancel }], 0);
    this.present('downloading', false);
    this.stopProgress = b.onProgress(({ got, total }) => this.progress(got, total));
    const r = await b.download().catch(() => ({ ok: false, code: 'other' as UpdateFailCode }));
    this.stopProgress?.();
    this.stopProgress = null;
    if (this.view !== 'downloading') return; // cancelled meanwhile
    if (!r.ok) {
      if (r.code === 'cancelled') this.close();
      else this.showError(r.code ?? 'other', false);
      return;
    }
    this.progress(1, 1);
    this.showInstalling(l.version);
  }

  private progress(got: number, total: number): void {
    if (!this.bar || !this.barText) return;
    const frac = total > 0 ? Math.min(1, got / total) : 0;
    this.bar.style.width = `${(frac * 100).toFixed(1)}%`;
    this.bar.parentElement?.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
    this.barText.textContent = total > 0 ? `${mb(got)} of ${mb(total)}` : `${mb(got)} downloaded`;
  }

  private showInstalling(version: string): void {
    this.frame(ICON_SNOW, 'All set!');
    this.line(`Saving your game. Winterland closes, updates to ${version} and opens again in a moment.`);
    this.escapeAction = null;
    this.present('installing', false);
    try {
      this.saveNow();
    } catch {
      /* the autosave a few seconds ago still holds; the updater never touches the save either way */
    }
    void this.bridge
      ?.install()
      .then((r) => {
        if (!r.ok) this.showError(r.code ?? 'files', false);
      })
      .catch(() => this.showError('files', false));
  }

  private showError(code: UpdateFailCode, afterRestart: boolean): void {
    this.frame(ICON_SNOW, afterRestart ? "The update didn't finish" : "Couldn't update right now");
    this.line(FAIL_TEXT[code] ?? FAIL_TEXT.other);
    this.line('Your game and your save are exactly as they were. You can also run Update Winterland from your game folder.', 'wl-update-small');
    const close = (): void => this.close();
    this.escapeAction = close;
    this.buttons([{ label: 'Keep playing', style: 'green', tap: close }], 0);
    this.present('error');
  }

  private showCurrent(): void {
    this.frame(ICON_SNOW, "You're up to date");
    this.line(`Winterland ${GAME_VERSION} is the newest version.`);
    const close = (): void => this.close();
    this.escapeAction = close;
    this.buttons([{ label: 'OK', style: 'green', tap: close }], 0);
    this.present('current');
  }

  private showChangelog(list: ChangelogEntry[], from: string | null | 'all'): void {
    const title = from === 'all' ? "What's new" : list.length === 1 ? `What's new in ${list[0]!.version}` : `What's new since ${from}`;
    this.frame(ICON_SCROLL, title);
    if (from !== 'all') this.line(`You're now playing Winterland ${GAME_VERSION}. Your save came along safe and sound.`, 'wl-update-sub');
    const box = this.scrollBox('Changelog');
    for (const e of list) box.appendChild(renderEntry(e, true));
    const close = (): void => this.close();
    this.escapeAction = close;
    this.buttons([{ label: from === 'all' ? 'Close' : "Let's play!", style: 'green', tap: close }], 0);
    this.present('changelog');
  }

  update(dt: number): void {
    if (this.checkIn >= 0) {
      this.checkIn -= dt;
      if (this.checkIn < 0) void this.check(false);
    }
    if (!this.view && this.queue.length && this.slide.k <= 0 && !this.busy()) this.queue.shift()!();
    const s = this.slide;
    if (s.k <= 0 && !s.open) return;
    if (s.step(dt, 0.3) || (s.k > 0 && s.k < 1)) {
      if (s.k <= 0) {
        this.backdrop.style.display = 'none';
        return;
      }
      const e = s.open ? backOut(Math.min(1, s.k)) : s.k;
      this.backdrop.style.opacity = Math.min(1, s.k * 2).toFixed(2);
      this.card.style.transform = `scale(${(0.6 + 0.4 * e).toFixed(3)})`;
    }
  }
}
