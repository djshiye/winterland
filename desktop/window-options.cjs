/**
 * Pure helpers for desktop/main.cjs, kept free of Electron so tests can load them.
 */

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

module.exports = { fullscreenOptions, isFullscreenKey };
