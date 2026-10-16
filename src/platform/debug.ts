/**
 * [PURE] Whether the test and tooling hooks (window.__WINTERLAND__: addMoney, unlockEra, clearSave, ...) are installed.
 * They are cheats, so a release never carries them: on in the dev server and in tests, and in a browser build only with
 * `?debug` in the URL (scripts/shot.mjs and the bots add it). Never in the desktop app, whatever the URL says.
 */
import { isDesktop } from './desktop';

export function debugAllowed(): boolean {
  if (import.meta.env.DEV) return true;
  if (isDesktop()) return false;
  try {
    return new URLSearchParams(location.search).has('debug');
  } catch {
    return false;
  }
}
