/**
 * Pure helpers for desktop/main.cjs, kept free of Electron so tests can load them.
 */
const path = require('node:path');

/** The only origin the game window may show (and where the save lives: never change it). */
const APP_ORIGIN = 'app://game';

/**
 * Content-Security-Policy for everything app:// serves: the game's own scripts only (no inline or eval'd code, no
 * plugins), styles may be inline (the HUD sets them), images, fonts and sounds from the app or data:/blob: URLs, and no
 * connections anywhere but the app itself. The game is fully offline; the updater is a separate script.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** True for a URL inside the game (app://game/...). */
function isAppUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'app:' && u.host === 'game';
  } catch {
    return false;
  }
}

/**
 * The file under `dist` that an app:// request asks for, or null for anything outside it (`..`, encoded separators,
 * malformed % escapes, another host).
 */
function distFile(dist, url) {
  let pathname;
  try {
    const u = new URL(url);
    if (u.protocol !== 'app:' || u.host !== 'game') return null;
    pathname = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const root = path.resolve(dist);
  const file = path.resolve(path.join(root, pathname));
  return file.startsWith(root + path.sep) ? file : null;
}

/**
 * The fullscreen-related BrowserWindow options for a saved window mode.
 * macOS gotcha: an explicit `fullscreen: false` makes Electron mark the window as not fullscreenable, which disables
 * the green button, the menu item and every later setFullScreen(true). So `fullscreen` is only ever passed as true,
 * and `fullscreenable` is always set.
 */
function fullscreenOptions(mode) {
  return mode === 'fullscreen' ? { fullscreen: true, fullscreenable: true } : { fullscreenable: true };
}

/**
 * True for the keys the shell handles as "toggle fullscreen": F11 and Alt+Enter everywhere, plus macOS's own
 * Ctrl+Cmd+F (macOS keeps F11 for Show Desktop, so it rarely reaches the app there).
 */
function isFullscreenKey(input, platform) {
  if (input.key === 'F11' || (input.alt && input.key === 'Enter')) return true;
  return platform === 'darwin' && !!input.control && !!input.meta && String(input.key).toLowerCase() === 'f';
}

module.exports = { APP_ORIGIN, CSP, distFile, fullscreenOptions, isAppUrl, isFullscreenKey };
