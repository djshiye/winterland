/**
 * Settings → Game: back up the save to a .json file and restore it from one. Pure browser plumbing (Blob + a temporary
 * <a download>, a file's text), no game state: the raw localStorage text is moved as is, and the page reloads so the
 * game boots from the restored save exactly like a normal start (loadSave() sanitises every field).
 */
import { SAVE } from '../config';

export const NOT_A_SAVE = "That file isn't a Winterland save.";

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Same gate as loadSave(): version, a state object, finite money and savedAt. Returns an error message or null. */
export function validateSaveText(text: string): string | null {
  try {
    const data = JSON.parse(text) as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') return NOT_A_SAVE;
    if (data.v !== SAVE.version) return NOT_A_SAVE;
    if (typeof data.state !== 'object' || !data.state) return NOT_A_SAVE;
    if (!isNum(data.money) || !isNum(data.savedAt)) return NOT_A_SAVE;
    return null;
  } catch {
    return NOT_A_SAVE;
  }
}

/** `winterland-save-YYYYMMDD-HHMM.json` in local time. */
export function saveFileName(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `winterland-save-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(SAVE.key);
  } catch {
    return null;
  }
}

export type ExportResult = 'saved' | 'none' | 'declined' | 'failed';

/** The claude.ai artifact viewer blocks plain downloads; its runtime offers `downloads.save` instead. */
interface ArtifactRuntime {
  use(name: 'downloads'): Promise<{ save(r: { filename: string; data: string }): Promise<unknown> } | null>;
}

/**
 * Download the current save: 'none' when there is no save yet, 'declined' when the viewer refused the artifact
 * viewer's prompt, 'failed' when the download could not start.
 */
export async function exportSave(): Promise<ExportResult> {
  const raw = readRaw();
  if (!raw) return 'none';
  const rt = (window as unknown as { claude?: ArtifactRuntime }).claude;
  if (rt && typeof rt.use === 'function') {
    try {
      const dl = await rt.use('downloads');
      if (dl) {
        await dl.save({ filename: saveFileName(), data: raw });
        return 'saved';
      }
    } catch (e) {
      return (e as { code?: string })?.code === 'declined' ? 'declined' : 'failed';
    }
  }
  try {
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = saveFileName();
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // give the browser a moment to start the download before the URL goes away
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

/**
 * Replace the save with the file's contents and reload. Returns an error message, or null on success (the page is
 * reloading). In the game, pass `apply` to hand the validated text to Game through the 'save:restore' event: Game stops
 * its own autosave first (its pagehide save would otherwise overwrite the restored one on the way out), then writes and
 * reloads. Without `apply` the text is written and the page reloaded here (tests, tools).
 */
export async function importSave(file: File, apply?: (text: string) => void): Promise<string | null> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return "Couldn't read that file.";
  }
  const bad = validateSaveText(text);
  if (bad) return bad;
  if (apply) {
    apply(text);
    return null;
  }
  try {
    localStorage.setItem(SAVE.key, text);
  } catch {
    return "Couldn't store the save (browser storage is full or blocked).";
  }
  location.reload();
  return null;
}
