/**
 * [MAIN] 0.9.6 Settings → Game → Earlier saves: the copies core/saveVault.ts keeps (rolling autosaves, the save from
 * just before a Reset / Restore / New Season, a crash-rescued one), newest first, each with "Bring back". The first tap
 * asks "Sure?" on the same button; the second emits 'save:restoreBackup' and Game keeps the current save as the
 * "before" copy, swaps in the chosen one and reloads. Only keys saveVault lists are ever offered.
 */
import type { GameContext } from '../core/types';
import { listBackups, type BackupInfo } from '../core/saveVault';
import { h, onTap } from './dom';
import { formatDuration, formatMoney } from './format';

const WHY: Record<string, string> = {
  reset: 'Before you reset',
  restore: 'Before a restore',
  earlier: 'Before a restore',
  season: 'Before the new season',
  newer: 'From a newer version',
};

export function backupLabel(b: BackupInfo): string {
  if (b.kind === 'before') return WHY[b.why] ?? 'Before a change';
  if (b.kind === 'rescue') return 'Set aside after a crash';
  return 'Autosave';
}

export function backupWhen(b: BackupInfo, now = Date.now()): string {
  if (!b.savedAt) return 'unknown time';
  const s = (now - b.savedAt) / 1000;
  return s < 60 ? 'just now' : `${formatDuration(s)} ago`;
}

export class EarlierSaves {
  readonly el: HTMLDivElement;
  private readonly list: HTMLDivElement;

  constructor(
    private readonly ctx: GameContext,
    onBack: () => void,
  ) {
    this.el = h('div', 'wl-settings-confirm wl-earlier');
    this.el.appendChild(h('div', 'wl-confirm-text', 'Earlier saves'));
    this.list = h('div', 'wl-earlier-list');
    this.el.appendChild(this.list);
    const back = h('button', 'wl-btn wl-btn-grey', 'Back');
    back.type = 'button';
    onTap(back, () => {
      ctx.audio.play('click');
      onBack();
    });
    const row = h('div', 'wl-btn-row');
    row.appendChild(back);
    this.el.appendChild(row);
  }

  refresh(): void {
    this.list.replaceChildren();
    const items = listBackups();
    if (items.length === 0) {
      const p = h('div', 'wl-earlier-empty');
      p.textContent = 'No earlier saves yet. Winterland keeps a copy every 10 minutes of play.';
      this.list.appendChild(p);
      return;
    }
    for (const b of items) {
      const row = h('div', 'wl-earlier-row');
      const text = h('div', 'wl-earlier-text');
      const name = h('b');
      name.textContent = backupLabel(b);
      const sub = h('span');
      sub.textContent = `${backupWhen(b)} · ${formatMoney(b.money)}`;
      text.append(name, sub);
      const btn = h('button', 'wl-btn wl-btn-green wl-earlier-btn');
      btn.type = 'button';
      btn.textContent = 'Bring back';
      let armed = false;
      onTap(btn, () => {
        this.ctx.audio.play('click');
        if (!armed) {
          armed = true;
          btn.textContent = 'Sure?';
          btn.classList.replace('wl-btn-green', 'wl-btn-gold');
          return;
        }
        this.ctx.events.emit('save:restoreBackup', { key: b.key });
      });
      row.append(text, btn);
      this.list.appendChild(row);
    }
  }
}
