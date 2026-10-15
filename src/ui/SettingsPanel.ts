/**
 * [B4] Settings: a gear button (next to the mute button) opening a small centred card with a Sound switch (same
 * state as the mute button), a Music switch, a Graphics High / Low switch (Low = no shadows, pixel ratio 1), a
 * Show FPS switch (PerfOverlay) and "Reset progress" behind an in-page confirmation (no window.confirm). Confirming
 * emits 'game:reset'; the main session wipes the save and reloads. Wave 8: Day / night switch (ctx.dayNight) and, where
 * navigator.vibrate exists, a Vibration switch (fx/Haptics). Picking a graphics quality by hand writes
 * localStorage 'winterland:autoQuality' = 'manual' so the automatic drop to Low never overrides the player.
 * On short screens (<= 520 px tall) the switches sit in two columns so the card fits 800x450.
 */
import { hapticsAvailable, hapticsEnabled, buzz, setHapticsEnabled } from '../fx/Haptics';
import type { GameContext } from '../core/types';
import { backOut, h, onTap, shield, Slide } from './dom';
import { ICON_CLOSE, ICON_GEAR } from './icons';
import type { PerfOverlay } from './PerfOverlay';
import { SeasonConfirm } from './SeasonConfirm';

export class SettingsPanel {
  readonly button: HTMLButtonElement;
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly main: HTMLDivElement;
  private readonly confirm: HTMLDivElement;
  private readonly season: SeasonConfirm;
  private readonly seasonBtn: HTMLButtonElement;
  private readonly soundSwitch: HTMLButtonElement;
  private readonly musicSwitch: HTMLButtonElement;
  private readonly gfxSwitch: HTMLButtonElement;
  private readonly fpsSwitch: HTMLButtonElement;
  private readonly daySwitch: HTMLButtonElement;
  private readonly vibSwitch: HTMLButtonElement | null = null;
  private readonly slide = new Slide();
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

    // --- main view
    this.main = h('div', 'wl-settings-main');
    const sw = (label: string, hint: string | null, tap: () => void): HTMLButtonElement => {
      const row = h('div', 'wl-row');
      const lab = h('span', 'wl-row-label', `<span class="wl-row-name">${label}</span>`);
      if (hint) lab.appendChild(h('small', 'wl-row-hint', hint));
      row.appendChild(lab);
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
      this.main.appendChild(row);
      return b;
    };
    this.soundSwitch = sw('Sound', null, () => {
      const muted = ctx.audio.toggleMute();
      if (!muted) ctx.audio.play('click');
      this.onSoundChanged?.();
    });
    this.musicSwitch = sw('Music', null, () => {
      if (ctx.audio.toggleMusic()) ctx.audio.play('click');
    });
    // on = High; the hint tells what Low does
    this.gfxSwitch = sw('Graphics', 'Low turns off shadows for slower computers', () => {
      ctx.audio.play('click');
      try {
        localStorage.setItem('winterland:autoQuality', 'manual');
      } catch {
        /* storage unavailable */
      }
      ctx.renderer.setQuality(ctx.renderer.quality === 'high' ? 'low' : 'high');
    });
    this.fpsSwitch = sw('Show FPS', null, () => {
      ctx.audio.play('click');
      perf.enabled = !perf.enabled;
    });
    this.daySwitch = sw('Day / night', null, () => {
      ctx.audio.play('click');
      ctx.dayNight.setEnabled(!ctx.dayNight.enabled);
    });
    if (hapticsAvailable()) {
      this.vibSwitch = sw('Vibration', null, () => {
        ctx.audio.play('click');
        setHapticsEnabled(!hapticsEnabled());
        if (hapticsEnabled()) buzz(15);
      });
    }
    // prestige: only after the finale (open() shows / hides it, the flag can flip mid-session)
    this.seasonBtn = h('button', 'wl-btn wl-btn-gold', 'Start a new season');
    this.seasonBtn.type = 'button';
    this.seasonBtn.style.display = 'none';
    onTap(this.seasonBtn, () => {
      ctx.audio.play('click');
      this.showSeason(true);
    });
    this.main.appendChild(this.seasonBtn);
    const reset = h('button', 'wl-btn wl-btn-danger', 'Reset progress');
    reset.type = 'button';
    onTap(reset, () => {
      ctx.audio.play('click');
      this.showConfirm(true);
    });
    this.main.appendChild(reset);

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

    this.season = new SeasonConfirm(ctx, () => this.showSeason(false));
    this.season.el.style.display = 'none';

    this.card.append(x, title, this.main, this.confirm, this.season.el);
    this.backdrop.appendChild(this.card);
    layer.appendChild(this.backdrop);
    this.sync();
  }

  /** Re-read every switch (the HUD calls this when the mute button is pressed). */
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
    if (this.vibSwitch) set(this.vibSwitch, hapticsEnabled());
    const name = this.gfxSwitch.parentElement?.querySelector('.wl-row-name');
    if (name) name.textContent = renderer.quality === 'high' ? 'Graphics: High' : 'Graphics: Low';
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
    this.showConfirm(false);
    this.slide.open = true;
    this.backdrop.style.display = 'flex';
  }

  close(): void {
    this.slide.open = false;
    // closed before the first update() ran: nothing to animate, hide now (update() early-returns at k === 0)
    if (this.slide.k === 0) this.backdrop.style.display = 'none';
  }

  /** For tests: show the confirmation view. */
  showConfirm(on: boolean): void {
    this.main.style.display = on ? 'none' : '';
    this.confirm.style.display = on ? '' : 'none';
    this.season.el.style.display = 'none';
  }

  /** The New Season confirmation view (replaces the switches; Cancel returns to them). */
  showSeason(on: boolean): void {
    if (on) this.season.refresh();
    this.main.style.display = on ? 'none' : '';
    this.confirm.style.display = 'none';
    this.season.el.style.display = on ? '' : 'none';
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
