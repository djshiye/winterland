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
 */
export type WindowMode = 'windowed' | 'fullscreen';

export interface DesktopBridge {
  readonly version: string;
  getWindowMode(): Promise<WindowMode>;
  setWindowMode(mode: WindowMode): void;
  onWindowMode(cb: (mode: WindowMode) => void): () => void;
  quit?(): void;
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
