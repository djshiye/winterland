/**
 * [B4] Settings: a gear button (next to the mute button) opening a small centred card with three tabs (the last one
 * is remembered in localStorage 'winterland:settingsTab'):
 * - Sound: Sound switch (same state as the mute button), Master / Effects volume sliders, Music switch + slider.
 * - Display: window mode (desktop app) or a Fullscreen switch (browser), Graphics High / Low (Low = no shadows, pixel
 *   ratio 1), Resolution slider, Frame rate Auto / 60 / 30, Show FPS (PerfOverlay), Day / night (ctx.dayNight).
 * - Comfort (fx/comfort, localStorage 'winterland:comfort'): Reduce motion, Effects Full / Calm / Minimal, Interface
 *   size 80-150 % (applied when the slider is let go), Colour-blind friendly, and two quick buttons: "Make it calm" (all three at their gentlest) and "Defaults".
 * - Game: Hold to interact (pickups and payments need E / Space / a press held), Vibration (phone buzz and gamepad rumble, where either exists), a controls hint, Back up / Restore save (ui/saveTransfer),
 *   "Start a new season" (after the finale) and "Reset progress"; both, and Restore, sit behind in-page confirmations
 *   (no window.confirm) that replace the tabs. Confirming a reset emits 'game:reset'; the main session wipes the save
 *   and reloads. Picking a graphics quality by hand writes localStorage 'winterland:autoQuality' = 'manual' so the
 *   automatic drop to Low never overrides the player.
 * Sliders run on 'input' (live) and are not shielded: the row stops pointerdown / touchstart instead.
 * On short screens (<= 520 px tall) the switches sit in two columns so the card fits 800x450.
 */
import { comfort, defaultComfort, onComfortChange, setComfort, uiScale, uiScaleFitted, UI_SCALE, type EffectsLevel } from '../fx/comfort';
import { feedbackAvailable, hapticsEnabled, buzz, setHapticsEnabled } from '../fx/Haptics';
import { readFpsCap, FPS_CAPS, type FpsCap } from '../core/fps';
import type { VolumeChannel } from '../fx/volume';
import type { GameContext } from '../core/types';
import { desktop, toggleFullscreen, type WindowMode } from '../platform/desktop';
import { backOut, h, onTap, shield, Slide } from './dom';
import { ICON_CLOSE, ICON_GEAR } from './icons';
import type { PerfOverlay } from './PerfOverlay';
import { SeasonConfirm } from './SeasonConfirm';
import { EarlierSaves } from './EarlierSaves';
import { GAME_VERSION } from '../core/version';
import './notice.css';
import { exportSave, importSave, validateSaveText } from './saveTransfer';
import './comfort.css';

export type SettingsTab = 'sound' | 'display' | 'comfort' | 'game';
export const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: 'sound', label: 'Sound' },
  { id: 'display', label: 'Display' },
  { id: 'comfort', label: 'Comfort' },
  { id: 'game', label: 'Game' },
];
const TAB_KEY = 'winterland:settingsTab';

/** The tab the player had open last (default Sound; storage errors and unknown values fall back to it). */
export function readSettingsTab(): SettingsTab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return SETTINGS_TABS.some((t) => t.id === v) ? (v as SettingsTab) : 'sound';
  } catch {
    return 'sound';
  }
}

export function writeSettingsTab(tab: SettingsTab): void {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* storage unavailable */
  }
}

/** Keys the player's controls (and the camera zoom) listen to on window: a focused slider must keep them to itself. */
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']);

const CONTROLS: readonly (readonly [string, string])[] = [
  ['WASD / arrows', 'move'],
  ['Drag', 'joystick'],
  ['E / Space', 'pick up & pay (hold)'],
  ['Wheel / + \u2212', 'zoom'],
  ['Esc', 'menu'],
  ['T / B', 'map / market'],
  ['Tab / arrows', 'move through menus'],
  ['M', 'mute'],
  ['F', 'fullscreen (desktop: F11 / Alt+Enter)'],
  ['Gamepad', 'stick walks, A picks up & pays, B back, Start menu, Y map, X market'],
];

export class SettingsPanel {
  readonly button: HTMLButtonElement;
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  /** Tabs + the scrolling pane (replaced as a whole by the confirm / season / restore views). */
  private readonly body: HTMLDivElement;
  private readonly main: HTMLDivElement;
  private readonly pages = new Map<SettingsTab, HTMLDivElement>();
  private readonly tabEls = new Map<SettingsTab, HTMLButtonElement>();
  private readonly confirm: HTMLDivElement;
  private readonly restoreView: HTMLDivElement;
  private readonly earlier: EarlierSaves;
  private readonly saveMsg: HTMLDivElement;
  private readonly fileInput: HTMLInputElement;
  private readonly season: SeasonConfirm;
  private readonly seasonBtn: HTMLButtonElement;
  private readonly soundSwitch: HTMLButtonElement;
  private readonly musicSwitch: HTMLButtonElement;
  private readonly gfxSwitch: HTMLButtonElement;
  private readonly fpsSwitch: HTMLButtonElement;
  private readonly daySwitch: HTMLButtonElement;
  private readonly holdSwitch: HTMLButtonElement;
  private readonly motionSwitch: HTMLButtonElement;
  private readonly cbSwitch: HTMLButtonElement;
  private readonly vibSwitch: HTMLButtonElement | null = null;
  private readonly fsSwitch: HTMLButtonElement | null = null;
  /** Sliders and segmented controls re-read their value in sync(). */
  private readonly refreshers: (() => void)[] = [];
  private readonly slide = new Slide();
  private tab: SettingsTab = readSettingsTab();
  private windowMode: WindowMode = 'windowed';
  private pendingFile: File | null = null;
  private resetting = false;

  /** Called when the sound state changes from inside the panel (the HUD syncs the mute button). */
  onSoundChanged: (() => void) | null = null;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
    private readonly perf: PerfOverlay,
  ) {
    this.button = h('button', 'wl-gear', ICON_GEAR);
    this.button.type = 'button';
    this.button.setAttribute('aria-label', 'Settings');
    shield(this.button);
    onTap(this.button, () => {
      ctx.audio.unlock();
      ctx.audio.play('click');
      this.toggle();
    });
    layer.appendChild(this.button);

    this.backdrop = h('div', 'wl-modal');
    this.backdrop.style.display = 'none';
    shield(this.backdrop);
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    this.card = h('div', 'wl-card wl-settings');
    const title = h('div', 'wl-card-title wl-outline', 'Settings');
    const x = h('button', 'wl-card-x', ICON_CLOSE);
    x.type = 'button';
    x.setAttribute('aria-label', 'Close settings');
    onTap(x, () => this.close());

    // --- main view: tabs over a scrolling pane
    this.body = h('div', 'wl-settings-body');
    const tabs = h('div', 'wl-settings-tabs');
    tabs.setAttribute('role', 'tablist');
    this.main = h('div', 'wl-settings-main');
    for (const t of SETTINGS_TABS) {
      const b = h('button', 'wl-settings-tab', t.label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      onTap(b, () => {
        ctx.audio.unlock();
        ctx.audio.play('click');
        this.setTab(t.id);
      });
      tabs.appendChild(b);
      this.tabEls.set(t.id, b);
      const page = h('div', 'wl-settings-page');
      this.pages.set(t.id, page);
      this.main.appendChild(page);
    }
    this.body.append(tabs, this.main);
    const page = (t: SettingsTab): HTMLDivElement => this.pages.get(t)!;

    const rowFor = (to: HTMLElement, label: string, hint: string | null, cls = ''): HTMLDivElement => {
      const row = h('div', `wl-row ${cls}`.trim());
      const lab = h('span', 'wl-row-label', `<span class="wl-row-name">${label}</span>`);
      if (hint) lab.appendChild(h('small', 'wl-row-hint', hint));
      row.appendChild(lab);
      to.appendChild(row);
      return row;
    };
    const sw = (to: HTMLElement, label: string, hint: string | null, tap: () => void): HTMLButtonElement => {
      const row = rowFor(to, label, hint);
      const b = h('button', 'wl-switch', '<i></i>');
      b.type = 'button';
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-label', label);
      onTap(b, () => {
        ctx.audio.unlock();
        tap();
        this.sync();
      });
      row.appendChild(b);
      return b;
    };
    /** A 0..100 % range input; get / set work in 0..1. Driven by 'input' (live), not by taps. */
    const slider = (
      to: HTMLElement,
      label: string,
      get: () => number,
      set: (v: number) => void,
      opts: { min?: number; max?: number; step?: number; release?: boolean; onRelease?: boolean } = {},
    ): void => {
      const row = rowFor(to, label, null, 'wl-row-slider');
      const input = h('input', 'wl-slider');
      input.type = 'range';
      input.min = String(opts.min ?? 0);
      input.max = String(opts.max ?? 100);
      input.step = String(opts.step ?? 1);
      input.setAttribute('aria-label', label);
      const val = h('span', 'wl-slider-val');
      const paint = (): void => {
        const n = Number(input.value);
        const lo = Number(input.min);
        const hi = Number(input.max);
        val.textContent = `${n}%`;
        input.style.setProperty('--p', `${(((n - lo) / (hi - lo)) * 100).toFixed(1)}%`);
      };
      input.addEventListener('input', () => {
        ctx.audio.unlock();
        // onRelease: only the label follows the drag (the interface size would resize the slider under the pointer)
        if (!opts.onRelease) set(Number(input.value) / 100);
        paint();
      });
      if (opts.onRelease) input.addEventListener('change', () => set(Number(input.value) / 100));
      if (opts.release) {
        input.addEventListener('change', () => ctx.audio.play('pop'));
      }
      // after a mouse / touch drag give the keyboard back to the player (arrows would nudge the slider otherwise)
      input.addEventListener('pointerup', () => input.blur());
      input.addEventListener('keydown', (e) => {
        if (e.code === 'Escape') {
          e.stopPropagation();
          this.close();
        } else if (GAME_KEYS.has(e.code)) e.stopPropagation();
      });
      // the joystick under the HUD must never start from a slider drag
      const stop = (ev: Event): void => ev.stopPropagation();
      row.addEventListener('pointerdown', stop);
      row.addEventListener('touchstart', stop, { passive: true });
      row.append(input, val);
      this.refreshers.push(() => {
        input.value = String(Math.round(get() * 100));
        paint();
      });
    };
    /** A pill of 2-3 buttons, one on at a time. */
    const seg = <T extends string | number>(
      to: HTMLElement,
      label: string,
      options: readonly { value: T; text: string }[],
      get: () => T,
      set: (v: T) => void,
    ): void => {
      const row = rowFor(to, label, null, 'wl-row-seg');
      const pill = h('div', 'wl-segs');
      pill.setAttribute('role', 'radiogroup');
      pill.setAttribute('aria-label', label);
      const btns = options.map((o) => {
        const b = h('button', 'wl-seg', o.text);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        onTap(b, () => {
          ctx.audio.unlock();
          ctx.audio.play('click');
          set(o.value);
          this.sync();
        });
        pill.appendChild(b);
        return b;
      });
      row.appendChild(pill);
      this.refreshers.push(() => {
        const cur = get();
        options.forEach((o, i) => {
          btns[i]!.classList.toggle('is-on', o.value === cur);
          btns[i]!.setAttribute('aria-checked', String(o.value === cur));
        });
      });
    };
    const volume = (ch: VolumeChannel) => ({ get: () => ctx.audio.getVolume(ch), set: (v: number) => ctx.audio.setVolume(ch, v) });

    // Sound
    const ps = page('sound');
    this.soundSwitch = sw(ps, 'Sound', null, () => {
      const muted = ctx.audio.toggleMute();
      if (!muted) ctx.audio.play('click');
      this.onSoundChanged?.();
    });
    slider(ps, 'Master volume', volume('master').get, volume('master').set, { release: true });
    slider(ps, 'Effects volume', volume('sfx').get, volume('sfx').set, { release: true });
    this.musicSwitch = sw(ps, 'Music', null, () => {
      if (ctx.audio.toggleMusic()) ctx.audio.play('click');
    });
    slider(ps, 'Music volume', volume('music').get, volume('music').set);

    // Display
    const pd = page('display');
    const bridge = desktop();
    if (bridge) {
      seg<WindowMode>(
        pd,
        'Window',
        [
          { value: 'windowed', text: 'Windowed' },
          { value: 'fullscreen', text: 'Fullscreen' },
        ],
        () => this.windowMode,
        (m) => {
          this.windowMode = m;
          bridge.setWindowMode(m);
        },
      );
      bridge
        .getWindowMode()
        .then((m) => {
          this.windowMode = m;
          this.sync();
        })
        .catch(() => undefined);
      bridge.onWindowMode((m) => {
        this.windowMode = m;
        this.sync();
      });
    } else if (document.fullscreenEnabled) {
      this.fsSwitch = sw(pd, 'Fullscreen', null, () => {
        ctx.audio.play('click');
        toggleFullscreen();
      });
      document.addEventListener('fullscreenchange', () => this.sync());
    }
    // on = High; the hint tells what Low does
    this.gfxSwitch = sw(pd, 'Graphics', 'Low turns off shadows for slower computers', () => {
      ctx.audio.play('click');
      try {
        localStorage.setItem('winterland:autoQuality', 'manual');
      } catch {
        /* storage unavailable */
      }
      ctx.renderer.setQuality(ctx.renderer.quality === 'high' ? 'low' : 'high');
    });
    slider(pd, 'Resolution', () => ctx.renderer.scale, (v) => ctx.renderer.setScale(v), { min: 50, step: 5 });
    seg<FpsCap>(
      pd,
      'Frame rate',
      FPS_CAPS.slice().sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : b - a)).map((c) => ({ value: c, text: c === 0 ? 'Auto' : String(c) })),
      () => readFpsCap(),
      (cap) => ctx.events.emit('settings:fps', { cap }),
    );
    this.fpsSwitch = sw(pd, 'Show FPS', null, () => {
      ctx.audio.play('click');
      perf.enabled = !perf.enabled;
    });
    this.daySwitch = sw(pd, 'Day / night', null, () => {
      ctx.audio.play('click');
      ctx.dayNight.setEnabled(!ctx.dayNight.enabled);
    });

    // Comfort: gentler visuals for players who find busy screens tiring
    const pc = page('comfort');
    pc.appendChild(h('div', 'wl-comfort-intro', 'Make the game gentler on the eyes and easier to focus on.'));
    this.motionSwitch = sw(pc, 'Reduce motion', 'No screen shake, bounces or wobbles', () => {
      ctx.audio.play('click');
      setComfort({ motion: !comfort().motion });
    });
    seg<EffectsLevel>(
      pc,
      'Effects',
      [
        { value: 'full', text: 'Full' },
        { value: 'calm', text: 'Calm' },
        { value: 'minimal', text: 'Minimal' },
      ],
      () => comfort().effects,
      (effects) => setComfort({ effects }),
    );
    pc.appendChild(h('div', 'wl-controls-note wl-comfort-note', 'Calm: fewer sparkles, softer shake, no flashing. Minimal: only the essentials.'));
    // 0.9.7: interface size (fx/comfort uiScale, ui/comfort.css zooms the HUD panels)
    slider(pc, 'Interface size', () => comfort().uiScale, (v) => setComfort({ uiScale: v }), {
      min: UI_SCALE.min * 100,
      max: UI_SCALE.max * 100,
      step: UI_SCALE.step * 100,
      release: true,
      onRelease: true,
    });
    // a size bigger than the window has room for is drawn smaller (fx/comfort fitUiScale): say so under the slider
    const fitted = h('div', 'wl-controls-note wl-comfort-note');
    const paintFitted = (): void => {
      fitted.textContent = uiScaleFitted() ? `Fitted to this window: ${Math.round(uiScale() * 100)}%` : '';
      fitted.style.display = uiScaleFitted() ? '' : 'none';
    };
    pc.appendChild(fitted);
    paintFitted();
    this.refreshers.push(paintFitted);
    onComfortChange(paintFitted);
    window.addEventListener('resize', paintFitted);
    this.cbSwitch = sw(pc, 'Colour-blind friendly', 'Blue and orange instead of green and red', () => {
      ctx.audio.play('click');
      setComfort({ colorBlind: !comfort().colorBlind });
    });
    const presets = h('div', 'wl-btn-row wl-comfort-presets');
    const calmest = h('button', 'wl-btn wl-btn-green', 'Make it calm');
    calmest.type = 'button';
    onTap(calmest, () => {
      ctx.audio.play('click');
      setComfort({ motion: true, effects: 'minimal' });
      this.sync();
    });
    const defaults = h('button', 'wl-btn wl-btn-grey', 'Defaults');
    defaults.type = 'button';
    onTap(defaults, () => {
      ctx.audio.play('click');
      setComfort(defaultComfort());
      this.sync();
    });
    presets.append(calmest, defaults);
    pc.appendChild(presets);

    // Game
    const pg = page('game');
    this.holdSwitch = sw(pg, 'Hold to interact', 'Hold E, Space or press to pick up and pay', () => {
      ctx.audio.play('click');
      const on = !ctx.input.holdToInteract;
      ctx.input.setHoldToInteract(on);
      ctx.events.emit('settings:hold', { on });
    });
    if (feedbackAvailable()) {
      this.vibSwitch = sw(pg, 'Vibration', 'Phone buzz and controller rumble', () => {
        ctx.audio.play('click');
        setHapticsEnabled(!hapticsEnabled());
        if (hapticsEnabled()) buzz(15);
      });
    }
    const controls = h('div', 'wl-controls');
    controls.appendChild(h('div', 'wl-controls-title', 'Controls'));
    const list = h('div', 'wl-controls-list');
    for (const [keys, what] of CONTROLS) list.appendChild(h('div', 'wl-controls-item', `<b>${keys}</b> ${what}`));
    controls.appendChild(list);
    controls.appendChild(h('div', 'wl-controls-note', 'Drop-offs and cash collection are automatic.'));
    pg.appendChild(controls);

    const saveRow = h('div', 'wl-btn-row wl-save-row');
    const backup = h('button', 'wl-btn wl-btn-green', 'Back up save');
    backup.type = 'button';
    onTap(backup, () => {
      ctx.audio.play('click');
      void exportSave().then((r) => {
        if (r === 'saved') {
          ctx.audio.play('chime');
          this.setSaveMsg('Save downloaded.', false);
        } else if (r === 'none') this.setSaveMsg('No save to back up yet.', true);
        else if (r === 'declined') this.setSaveMsg('Backup cancelled.', true);
        else this.setSaveMsg("Couldn't download the save.", true);
      });
    });
    const restore = h('button', 'wl-btn wl-btn-grey', 'Restore save');
    restore.type = 'button';
    this.fileInput = h('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,application/json';
    this.fileInput.style.display = 'none';
    onTap(restore, () => {
      ctx.audio.play('click');
      this.fileInput.value = '';
      this.fileInput.click();
    });
    // the synthetic click on the hidden input bubbles up to the card; keep it from closing anything
    this.fileInput.addEventListener('click', (e) => e.stopPropagation());
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) void this.chooseFile(file);
    });
    saveRow.append(backup, restore);
    pg.appendChild(saveRow);
    // 0.9.6: the rolling backups and the copy from before the last reset / restore / new season
    const earlierBtn = h('button', 'wl-btn wl-btn-grey wl-earlier-open', 'Earlier saves');
    earlierBtn.type = 'button';
    onTap(earlierBtn, () => {
      ctx.audio.play('click');
      this.earlier.refresh();
      this.view('earlier');
    });
    pg.appendChild(earlierBtn);
    this.saveMsg = h('div', 'wl-save-msg');
    this.saveMsg.style.display = 'none';
    pg.appendChild(this.saveMsg);

    // prestige: only after the finale (open() shows / hides it, the flag can flip mid-session)
    this.seasonBtn = h('button', 'wl-btn wl-btn-gold', 'Start a new season');
    this.seasonBtn.type = 'button';
    this.seasonBtn.style.display = 'none';
    onTap(this.seasonBtn, () => {
      ctx.audio.play('click');
      this.showSeason(true);
    });
    pg.appendChild(this.seasonBtn);
    const reset = h('button', 'wl-btn wl-btn-danger', 'Reset progress');
    reset.type = 'button';
    onTap(reset, () => {
      ctx.audio.play('click');
      this.showConfirm(true);
    });
    pg.appendChild(reset);
    // 0.9.6: a way out of fullscreen without Alt+F4 (desktop app only; a browser tab closes itself)
    if (desktop()?.quit) {
      const quit = h('button', 'wl-btn wl-btn-green wl-quit', 'Save & quit');
      quit.type = 'button';
      onTap(quit, () => {
        ctx.audio.play('click');
        ctx.events.emit('game:quit', {});
      });
      pg.insertBefore(quit, pg.firstChild);
    }
    const version = h('div', 'wl-version');
    version.textContent = `Winterland ${desktop()?.version || GAME_VERSION}`;
    pg.appendChild(version);

    // --- confirm view
    this.confirm = h('div', 'wl-settings-confirm');
    this.confirm.style.display = 'none';
    this.confirm.appendChild(h('div', 'wl-confirm-text', 'Erase your mill and start over?'));
    const buttons = h('div', 'wl-btn-row');
    const cancel = h('button', 'wl-btn wl-btn-grey', 'Cancel');
    cancel.type = 'button';
    onTap(cancel, () => {
      ctx.audio.play('click');
      this.showConfirm(false);
    });
    const go = h('button', 'wl-btn wl-btn-danger', 'Reset');
    go.type = 'button';
    onTap(go, () => {
      if (this.resetting) return;
      this.resetting = true;
      ctx.events.emit('game:reset', {});
    });
    buttons.append(cancel, go);
    this.confirm.appendChild(buttons);

    // --- restore-save confirm view
    this.restoreView = h('div', 'wl-settings-confirm');
    this.restoreView.style.display = 'none';
    this.restoreView.appendChild(h('div', 'wl-confirm-text', 'Replace your current mill with this save?'));
    const rbuttons = h('div', 'wl-btn-row');
    const rcancel = h('button', 'wl-btn wl-btn-grey', 'Cancel');
    rcancel.type = 'button';
    onTap(rcancel, () => {
      ctx.audio.play('click');
      this.pendingFile = null;
      this.showRestore(false);
    });
    const rgo = h('button', 'wl-btn wl-btn-green', 'Restore');
    rgo.type = 'button';
    onTap(rgo, () => {
      const file = this.pendingFile;
      if (!file) return;
      this.pendingFile = null;
      ctx.audio.play('chime');
      void importSave(file, (text) => ctx.events.emit('save:restore', { text })).then((err) => {
        if (err) {
          this.showRestore(false);
          this.setSaveMsg(err, true);
        }
      });
    });
    rbuttons.append(rcancel, rgo);
    this.restoreView.appendChild(rbuttons);

    this.season = new SeasonConfirm(ctx, () => this.showSeason(false));
    this.season.el.style.display = 'none';
    this.earlier = new EarlierSaves(ctx, () => this.view('main'));
    this.earlier.el.style.display = 'none';

    this.card.append(x, title, this.body, this.confirm, this.restoreView, this.season.el, this.earlier.el, this.fileInput);
    this.backdrop.appendChild(this.card);
    layer.appendChild(this.backdrop);
    this.showTab();
    this.sync();
  }

  /** Re-read every switch, slider and segmented control (the HUD calls this when the mute button is pressed). */
  sync(): void {
    const { audio, renderer } = this.ctx;
    const set = (el: HTMLButtonElement, on: boolean): void => {
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-checked', String(on));
    };
    set(this.soundSwitch, !audio.muted);
    set(this.musicSwitch, audio.musicOn);
    set(this.gfxSwitch, renderer.quality === 'high');
    set(this.fpsSwitch, this.perf.enabled);
    set(this.daySwitch, this.ctx.dayNight.enabled);
    set(this.holdSwitch, this.ctx.input.holdToInteract);
    set(this.motionSwitch, comfort().motion);
    set(this.cbSwitch, comfort().colorBlind);
    if (this.vibSwitch) set(this.vibSwitch, hapticsEnabled());
    if (this.fsSwitch) set(this.fsSwitch, !!document.fullscreenElement);
    const name = this.gfxSwitch.parentElement?.querySelector('.wl-row-name');
    if (name) name.textContent = renderer.quality === 'high' ? 'Graphics: High' : 'Graphics: Low';
    for (const r of this.refreshers) r();
  }

  /** The tab showing now. */
  get activeTab(): SettingsTab {
    return this.tab;
  }

  /** Switch tab (remembered in localStorage). */
  setTab(tab: SettingsTab): void {
    this.tab = tab;
    writeSettingsTab(tab);
    this.showTab();
  }

  private showTab(): void {
    for (const [id, el] of this.tabEls) {
      el.classList.toggle('is-on', id === this.tab);
      el.setAttribute('aria-selected', String(id === this.tab));
    }
    for (const [id, el] of this.pages) el.style.display = id === this.tab ? '' : 'none';
    this.main.scrollTop = 0;
  }

  private setSaveMsg(text: string, error: boolean): void {
    this.saveMsg.textContent = text;
    this.saveMsg.classList.toggle('is-error', error);
    this.saveMsg.style.display = text ? '' : 'none';
  }

  /** A file was picked: check it looks like a save, then ask before replacing the current one. */
  private async chooseFile(file: File): Promise<void> {
    let text = '';
    try {
      text = await file.text();
    } catch {
      /* validated below as not a save */
    }
    const bad = validateSaveText(text);
    if (bad) {
      this.ctx.audio.play('click');
      this.setSaveMsg(bad, true);
      return;
    }
    this.setSaveMsg('', false);
    this.pendingFile = file;
    this.showRestore(true);
  }

  get isOpen(): boolean {
    return this.slide.open;
  }

  toggle(): void {
    if (this.slide.open) this.close();
    else this.open();
  }

  open(): void {
    this.sync();
    this.seasonBtn.style.display = this.ctx.state.flags.finale ? '' : 'none';
    this.setSaveMsg('', false);
    this.pendingFile = null;
    this.showConfirm(false);
    this.slide.open = true;
    this.backdrop.style.display = 'flex';
  }

  close(): void {
    this.slide.open = false;
    // closed before the first update() ran: nothing to animate, hide now (update() early-returns at k === 0)
    if (this.slide.k === 0) this.backdrop.style.display = 'none';
  }

  /** Show one view: the tabbed body, or one of the confirmations that replace it. */
  private view(v: 'main' | 'reset' | 'season' | 'restore' | 'earlier'): void {
    this.earlier.el.style.display = v === 'earlier' ? '' : 'none';
    this.body.style.display = v === 'main' ? '' : 'none';
    this.confirm.style.display = v === 'reset' ? '' : 'none';
    this.season.el.style.display = v === 'season' ? '' : 'none';
    this.restoreView.style.display = v === 'restore' ? '' : 'none';
  }

  /** For tests: show the confirmation view. */
  showConfirm(on: boolean): void {
    this.view(on ? 'reset' : 'main');
  }

  /** The New Season confirmation view (replaces the tabs; Cancel returns to them). */
  showSeason(on: boolean): void {
    if (on) this.season.refresh();
    this.view(on ? 'season' : 'main');
  }

  /** The "Replace your current mill with this save?" view. */
  showRestore(on: boolean): void {
    this.view(on ? 'restore' : 'main');
  }

  update(dt: number): void {
    const s = this.slide;
    if (!s.step(dt, 0.2) && !(s.k > 0 && s.k < 1)) return;
    if (s.k <= 0) {
      this.backdrop.style.display = 'none';
      return;
    }
    const e = s.open ? backOut(Math.min(1, s.k)) : s.k;
    this.backdrop.style.opacity = Math.min(1, s.k * 1.5).toFixed(2);
    this.card.style.transform = `scale(${(0.7 + 0.3 * e).toFixed(3)})`;
  }
}
