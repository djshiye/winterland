/**
 * [B4] Settings: a gear button (next to the mute button) opening a small centred card with a Sound switch (same
 * state as the mute button) and "Reset progress" behind an in-page confirmation (no window.confirm). Confirming
 * emits 'game:reset'; the main session wipes the save and reloads.
 */
import type { GameContext } from '../core/types';
import { backOut, h, onTap, shield, Slide } from './dom';
import { ICON_CLOSE, ICON_GEAR } from './icons';

export class SettingsPanel {
  readonly button: HTMLButtonElement;
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly main: HTMLDivElement;
  private readonly confirm: HTMLDivElement;
  private readonly soundSwitch: HTMLButtonElement;
  private readonly slide = new Slide();
  private resetting = false;

  /** Called when the sound state changes from inside the panel (the HUD syncs the mute button). */
  onSoundChanged: (() => void) | null = null;

  constructor(
    private readonly ctx: GameContext,
    layer: HTMLElement,
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
    const soundRow = h('div', 'wl-row');
    soundRow.appendChild(h('span', 'wl-row-label', 'Sound'));
    this.soundSwitch = h('button', 'wl-switch', '<i></i>');
    this.soundSwitch.type = 'button';
    this.soundSwitch.setAttribute('role', 'switch');
    onTap(this.soundSwitch, () => {
      ctx.audio.unlock();
      const muted = ctx.audio.toggleMute();
      if (!muted) ctx.audio.play('click');
      this.sync();
      this.onSoundChanged?.();
    });
    soundRow.appendChild(this.soundSwitch);
    const reset = h('button', 'wl-btn wl-btn-danger', 'Reset progress');
    reset.type = 'button';
    onTap(reset, () => {
      ctx.audio.play('click');
      this.showConfirm(true);
    });
    this.main.append(soundRow, reset);

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

    this.card.append(x, title, this.main, this.confirm);
    this.backdrop.appendChild(this.card);
    layer.appendChild(this.backdrop);
    this.sync();
  }

  /** Re-read the mute state (the HUD calls this when the mute button is pressed). */
  sync(): void {
    const on = !this.ctx.audio.muted;
    this.soundSwitch.classList.toggle('is-on', on);
    this.soundSwitch.setAttribute('aria-checked', String(on));
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
    this.showConfirm(false);
    this.slide.open = true;
    this.backdrop.style.display = 'flex';
  }

  close(): void {
    this.slide.open = false;
  }

  /** For tests: show the confirmation view. */
  showConfirm(on: boolean): void {
    this.main.style.display = on ? 'none' : '';
    this.confirm.style.display = on ? '' : 'none';
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
