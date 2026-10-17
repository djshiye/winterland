/**
 * [PURE] [0.9.8 — in-game updater] CHANGELOG.md read into entries, and which of them a player should see.
 *
 * CHANGELOG.md (repo root, bundled with the game) holds one `## x.y.z (YYYY-MM-DD)` heading per release, newest first,
 * then paragraphs, `###` sections and `-` items, with **bold**, *italic* and `code` inline. Any other `##` heading
 * (such as "Unreleased") and everything before the first release heading is ignored. The text is never parsed as HTML:
 * ui/UpdateCard.ts builds the DOM from these blocks with textContent only.
 *
 * Which entries: the first launch after an update shows every release newer than the version the player had and up to
 * this one. "The version they had" is the version this game last opened as (localStorage 'winterland:seenVersion',
 * core/updatePrefs.ts), or, for a save from before 0.9.8, the version that wrote the save. A brand-new player (no
 * save) sees nothing: there is nothing to compare with.
 */
import { isNewerVersion, parseVersion } from './version';

export interface ChangelogBlock {
  kind: 'h' | 'p' | 'li';
  text: string;
}

export interface ChangelogEntry {
  version: string;
  /** YYYY-MM-DD, or '' when the heading has none. */
  date: string;
  blocks: ChangelogBlock[];
}

/** One run of inline text. */
export interface InlineRun {
  text: string;
  bold?: boolean;
  em?: boolean;
  code?: boolean;
}

const RELEASE = /^## (\d{1,6}\.\d{1,6}\.\d{1,6})(?:\s+\((\d{4}-\d{2}-\d{2})\))?\s*$/;

/** Read the changelog text. Never throws; anything it doesn't understand is skipped. */
export function parseChangelog(text: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  let cur: ChangelogEntry | null = null;
  let para: string[] = [];
  const flush = (): void => {
    if (cur && para.length) cur.blocks.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      flush();
      const m = RELEASE.exec(line);
      cur = m ? { version: m[1]!, date: m[2] ?? '', blocks: [] } : null;
      if (cur) out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.trim() === '') {
      flush();
    } else if (line.startsWith('### ')) {
      flush();
      cur.blocks.push({ kind: 'h', text: line.slice(4).trim() });
    } else if (/^\s*[-*] /.test(line)) {
      flush();
      cur.blocks.push({ kind: 'li', text: line.replace(/^\s*[-*] /, '').trim() });
    } else if (/^\s{2,}\S/.test(line) && cur.blocks.at(-1)?.kind === 'li' && para.length === 0) {
      cur.blocks.at(-1)!.text += ` ${line.trim()}`; // an item's wrapped second line
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return out;
}

/** Releases newer than `after` (null: just `upTo` itself) and no newer than `upTo`, newest first. */
export function entriesBetween(entries: readonly ChangelogEntry[], after: string | null, upTo: string): ChangelogEntry[] {
  return entries
    .filter((e) => !isNewerVersion(e.version, upTo) && (after === null ? e.version === upTo : isNewerVersion(e.version, after)))
    .sort((a, b) => (isNewerVersion(a.version, b.version) ? -1 : isNewerVersion(b.version, a.version) ? 1 : 0));
}

/**
 * What the first screen after starting should say: the changelog since `from` (null = only this version's entry), or
 * nothing. `seen` is the version this game last opened as, `savedBy` the version that wrote the save, `hadSave`
 * whether a save existed at all.
 */
export function changelogStart(seen: string | null, savedBy: string | null, hadSave: boolean, current: string): { show: false } | { show: true; from: string | null } {
  if (!parseVersion(current)) return { show: false };
  if (parseVersion(seen)) return isNewerVersion(current, seen) ? { show: true, from: seen } : { show: false };
  if (!hadSave) return { show: false };
  if (parseVersion(savedBy)) return isNewerVersion(current, savedBy) ? { show: true, from: savedBy } : { show: false };
  // a save from before saves were stamped with their version (0.9.5 and earlier): show what this version brings
  return { show: true, from: null };
}

/** Split **bold**, *italic* and `code` runs (unmatched markers stay as plain text). */
export function inlineRuns(text: string): InlineRun[] {
  const out: InlineRun[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) out.push({ text: m[2], em: true });
    else out.push({ text: m[3]!, code: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
