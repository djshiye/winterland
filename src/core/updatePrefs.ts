/**
 * [0.9.8 — in-game updater] The updater's two small settings, kept in localStorage next to the other settings (never
 * in the save file). Every storage access is guarded: no storage simply means the defaults.
 * - 'winterland:updates' = { auto, skipped }: `auto` is the Settings switch "Check for updates" (default on; off means
 *   the game never contacts GitHub by itself); `skipped` is the version the player answered "Keep playing" to, so
 *   that version's card never shows again by itself (a newer version asks once more).
 * - 'winterland:seenVersion': the version this game last opened as (core/changelog.ts decides the changelog from it).
 */
import { parseVersion } from './version';

export const UPDATES_KEY = 'winterland:updates';
export const SEEN_KEY = 'winterland:seenVersion';

export interface UpdatePrefs {
  auto: boolean;
  skipped: string | null;
}

/** Stored text → prefs; anything unexpected falls back to the default for that field. */
export function parseUpdatePrefs(text: string | null): UpdatePrefs {
  const d: UpdatePrefs = { auto: true, skipped: null };
  if (!text) return d;
  try {
    const r = JSON.parse(text) as Record<string, unknown> | null;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return d;
    return {
      auto: typeof r.auto === 'boolean' ? r.auto : d.auto,
      skipped: parseVersion(r.skipped) ? (r.skipped as string) : null,
    };
  } catch {
    return d;
  }
}

export function readUpdatePrefs(): UpdatePrefs {
  try {
    return parseUpdatePrefs(localStorage.getItem(UPDATES_KEY));
  } catch {
    return parseUpdatePrefs(null);
  }
}

export function writeUpdatePrefs(p: Partial<UpdatePrefs>): UpdatePrefs {
  const next = { ...readUpdatePrefs(), ...p };
  try {
    localStorage.setItem(UPDATES_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  return next;
}

export function readSeenVersion(): string | null {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    return parseVersion(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeSeenVersion(v: string): void {
  if (!parseVersion(v)) return;
  try {
    localStorage.setItem(SEEN_KEY, v);
  } catch {
    /* storage unavailable */
  }
}
