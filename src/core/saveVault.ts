/**
 * [MAIN] 0.9.6 save safety: copies of the save kept next to it in localStorage, so no single bad moment can lose a game.
 *
 * - Rolling backups `<key>.backup.0..n-1` (0 = newest, SAVE.backups slots): the save a session started from, then the
 *   save on disk every SAVE.backupInterval seconds of play, each copied in just before the autosave overwrites it.
 * - `<key>.before`: the save as it was right before a Reset, a Restore or a New Season (with why in `<key>.before.why`).
 * - `<key>.unreadable.<ms>`: the exact text of a save that could not be opened (corrupt, or a format this build does not
 *   know), kept for the player to download instead of being overwritten by a fresh game (newest SAVE.unreadableKept).
 * - `<key>.bak`: the pre-0.9.6 crash rescue copy (src/main.ts), still listed so nothing it holds is stranded.
 *
 * Every copy is the raw save text, byte for byte, so restoring one is exactly the Settings → Restore path. Storage can
 * be missing, full or blocked: every function is wrapped and reports failure instead of throwing.
 */
import { SAVE } from '../config';

export type BackupKind = 'autosave' | 'before' | 'rescue';

export interface BackupInfo {
  key: string;
  kind: BackupKind;
  /** Date.now() when that save was written (0 when the text has none). */
  savedAt: number;
  money: number;
  /** For 'before': what was about to happen ('reset' | 'restore' | 'season' | 'newer' | 'earlier'). */
  why: string;
}

export const backupKey = (i: number): string => `${SAVE.key}.backup.${i}`;
export const BEFORE_KEY = `${SAVE.key}.before`;
const BEFORE_WHY_KEY = `${SAVE.key}.before.why`;
export const RESCUE_KEY = `${SAVE.key}.bak`;
export const UNREADABLE_PREFIX = `${SAVE.key}.unreadable.`;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function get(s: Storage | null, key: string): string | null {
  try {
    return s?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Write and read back (a full quota can throw, or on some browsers silently keep the old value). */
function put(s: Storage | null, key: string, value: string): boolean {
  if (!s) return false;
  try {
    s.setItem(key, value);
    return s.getItem(key) === value;
  } catch {
    return false;
  }
}

function drop(s: Storage | null, key: string): void {
  try {
    s?.removeItem(key);
  } catch {
    /* nothing to drop */
  }
}

/** The save text currently on disk (null when there is none or storage is unavailable). */
export function readRawSave(s: Storage | null = storage()): string | null {
  return get(s, SAVE.key);
}

/**
 * Copy `raw` into the newest backup slot, shifting the older ones down (the oldest falls off). A copy identical to the
 * newest one is skipped, so a session that changed nothing does not push real history out. False when storage refused.
 */
export function pushBackup(raw: string, s: Storage | null = storage()): boolean {
  if (!s || !raw) return false;
  if (get(s, backupKey(0)) === raw) return true;
  for (let i = SAVE.backups - 1; i > 0; i--) {
    const older = get(s, backupKey(i - 1));
    if (older !== null && !put(s, backupKey(i), older)) break; // full: keep what fits, the newest copy matters most
  }
  if (put(s, backupKey(0), raw)) return true;
  // still no room: give up the oldest slots one by one until the newest copy fits
  for (let i = SAVE.backups - 1; i > 0; i--) {
    drop(s, backupKey(i));
    if (put(s, backupKey(0), raw)) return true;
  }
  return false;
}

/** Keep the save as it is right before a destructive action (`why`: reset, restore, season, newer, earlier). */
export function snapshotBefore(raw: string | null, why: string, s: Storage | null = storage()): boolean {
  if (!raw) return true; // nothing to protect
  if (!put(s, BEFORE_KEY, raw)) return false;
  put(s, BEFORE_WHY_KEY, why);
  return true;
}

/** The unreadable-save copies, newest first. */
export function unreadableKeys(s: Storage | null = storage()): string[] {
  const out: string[] = [];
  try {
    if (!s) return out;
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(UNREADABLE_PREFIX)) out.push(k);
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => Number(b.slice(UNREADABLE_PREFIX.length)) - Number(a.slice(UNREADABLE_PREFIX.length)));
}

/**
 * Keep the exact text of a save that could not be opened. Returns the key it is stored under, or null when storage
 * refused (the caller then must not overwrite the save at all). Only the newest SAVE.unreadableKept copies stay.
 */
export function keepUnreadable(raw: string, now = Date.now(), s: Storage | null = storage()): string | null {
  const existing = unreadableKeys(s);
  for (const k of existing) if (get(s, k) === raw) return k; // already kept (a reload of the same broken save)
  const key = `${UNREADABLE_PREFIX}${now}`;
  if (!put(s, key, raw)) return null;
  for (const k of unreadableKeys(s).slice(SAVE.unreadableKept)) drop(s, k);
  return key;
}

/** True for the keys this file manages that hold a restorable save (Settings only ever restores one of these). */
export function isBackupKey(key: string): boolean {
  if (key === BEFORE_KEY || key === RESCUE_KEY) return true;
  for (let i = 0; i < SAVE.backups; i++) if (key === backupKey(i)) return true;
  return false;
}

/** The text of a backup (null for any key that is not a backup, or an empty slot). */
export function readBackup(key: string, s: Storage | null = storage()): string | null {
  return isBackupKey(key) ? get(s, key) : null;
}

function info(key: string, kind: BackupKind, raw: string | null, why = ''): BackupInfo | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { v?: unknown; savedAt?: unknown; money?: unknown; state?: unknown };
    if (!d || d.v !== SAVE.version || typeof d.state !== 'object' || !d.state) return null;
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return { key, kind, savedAt: n(d.savedAt), money: Math.max(0, Math.floor(n(d.money))), why };
  } catch {
    return null;
  }
}

/** Every restorable backup, newest first (unreadable copies are not listed: they can only be downloaded). */
export function listBackups(s: Storage | null = storage()): BackupInfo[] {
  const out: BackupInfo[] = [];
  for (let i = 0; i < SAVE.backups; i++) {
    const b = info(backupKey(i), 'autosave', get(s, backupKey(i)));
    if (b) out.push(b);
  }
  const before = info(BEFORE_KEY, 'before', get(s, BEFORE_KEY), get(s, BEFORE_WHY_KEY) ?? '');
  if (before) out.push(before);
  const rescue = info(RESCUE_KEY, 'rescue', get(s, RESCUE_KEY));
  if (rescue) out.push(rescue);
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
