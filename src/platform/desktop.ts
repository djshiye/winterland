/**
 * The desktop (Electron) bridge. `desktop/preload.cjs` exposes `window.winterlandDesktop` through contextBridge; in a
 * browser it is absent and every helper here degrades to the web behaviour (the Fullscreen API, no window modes).
 *
 * Contract (keep in sync with desktop/preload.cjs and desktop/main.cjs):
 * - `version`: the app version from package.json.
 * - `getWindowMode()`: the current mode. 'fullscreen' is Electron's fullscreen, which is borderless on Linux and
 *   Windows (no display-mode switch, alt-tab friendly).
 * - `setWindowMode(mode)`: applies and persists the mode (desktop/window.json in the user-data folder, together with
 *   the window bounds and maximised flag).
 * - `onWindowMode(cb)`: fires whenever the mode changes, including from F11 / Alt+Enter handled in the main process.
 *   Returns an unsubscribe.
 * - `quit()` (0.9.6): close the app (Settings → Save & quit; the game writes its save first). Absent in older shells.
 * - `saveMirror` (0.9.10, desktop/save-mirror.cjs): the copy of the save in the user-data folder (save.json and the
 *   copy before it, save.json.bak). `read()` returns both texts (null when missing); `write(text)` hands over a save,
 *   which the main process writes to disk now and then; `setAside()` moves both files aside (never deleted) before a
 *   different game is copied there. Absent in older shells.
 * - `updates` (0.9.8, desktop/updater.cjs): the in-game updater. The page never reaches the network itself; the main
 *   process checks GitHub, downloads and verifies the zip, and hands over to the "Update Winterland" script.
 */
export type WindowMode = 'windowed' | 'fullscreen';

/** Why an update stopped (desktop/update-core.cjs FAIL_CODES). */
export type UpdateFailCode = 'offline' | 'norelease' | 'nodownload' | 'current' | 'running' | 'checksum' | 'files' | 'unzip' | 'cancelled' | 'other';

export interface UpdateInfo {
  /** A packaged release on a computer the releases ship for (false in a development run). */
  supported: boolean;
  /** This copy can update itself (its updater script is there and its folder is writable). */
  canInstall: boolean;
  current: string;
  /** An in-game update that stopped and started this version again, with why (said once). */
  failed: UpdateFailCode | null;
}

export type UpdateCheck =
  | { status: 'available'; version: string; notes: string | null }
  | { status: 'none'; version: string }
  | { status: 'error'; code: UpdateFailCode };

export interface UpdateBridge {
  info(): Promise<UpdateInfo | null>;
  check(): Promise<UpdateCheck>;
  download(): Promise<{ ok: boolean; code?: UpdateFailCode }>;
  cancel(): void;
  /** Starts the updater script and closes the game (write the save first). */
  install(): Promise<{ ok: boolean; code?: UpdateFailCode }>;
  /** The latest release page, in the player's browser. */
  openPage(): void;
  onProgress(cb: (p: { got: number; total: number }) => void): () => void;
}

export interface SaveMirrorBridge {
  read(): { save: string | null; bak: string | null } | null;
  write(text: string): void;
  /** Move save.json and save.json.bak aside (save.json.replaced-<time>); true when done or nothing was there. */
  setAside(): boolean;
}

export interface DesktopBridge {
  readonly version: string;
  getWindowMode(): Promise<WindowMode>;
  setWindowMode(mode: WindowMode): void;
  onWindowMode(cb: (mode: WindowMode) => void): () => void;
  quit?(): void;
  saveMirror?: SaveMirrorBridge;
  updates?: UpdateBridge;
}

/** The bridge when running inside the desktop app, else null. */
export function desktop(): DesktopBridge | null {
  const w = window as unknown as { winterlandDesktop?: DesktopBridge };
  return w.winterlandDesktop ?? null;
}

/** True inside the desktop app (the bridge, or the private app:// origin as a fallback). */
export function isDesktop(): boolean {
  return desktop() !== null || location.protocol === 'app:';
}

/**
 * Toggle fullscreen in the best available way: the desktop bridge when present, else the browser Fullscreen API.
 * Never throws (the API rejects outside a user gesture).
 */
export function toggleFullscreen(): void {
  const d = desktop();
  if (d) {
    void d.getWindowMode().then((m) => d.setWindowMode(m === 'fullscreen' ? 'windowed' : 'fullscreen'));
    return;
  }
  try {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  } catch {
    /* unsupported */
  }
}
