/**
 * Electron shell for the desktop builds (Linux, Windows, macOS). It serves the Vite build (dist/) through a private
 * `app://` scheme rather than file://, so ES modules load normally and localStorage (the save) lives under one
 * stable origin that survives updates. Saves are kept in Electron's per-user data folder:
 *   Linux:   ~/.config/Winterland
 *   Windows: %APPDATA%\Winterland
 *   macOS:   ~/Library/Application Support/Winterland
 *
 * Window state (mode, size, position, maximised) is remembered in `window.json` in that same folder:
 *   { "mode": "windowed" | "fullscreen", "bounds": { x, y, width, height }, "maximized": boolean }
 * Fullscreen is Electron's borderless fullscreen (alt-tab friendly). While fullscreen, `bounds` keeps the last
 * windowed size so leaving fullscreen restores it. Saved bounds that are no longer on any display are ignored.
 *
 * Keys: F11 or Alt+Enter (plus Ctrl+Cmd+F on macOS) toggles fullscreen, Ctrl+R reloads; F12 / Ctrl+Shift+I open the dev
 * tools in a development run only (`npm run desktop`), never in a packaged release (Cmd works for Ctrl on macOS). On
 * macOS the app keeps the standard app menu so Cmd+Q, Cmd+H and Cmd+M behave as expected.
 *
 * Renderer bridge: desktop/preload.cjs exposes `window.winterlandDesktop` (see src/platform/desktop.ts); the IPC
 * channels it uses are handled at the bottom of this file.
 *
 * 0.9.6 hardening (the window only ever shows the game, from inside the app):
 * - one copy at a time (a second launch focuses the open window: two copies would overwrite each other's save);
 * - a Content-Security-Policy on everything app:// serves (scripts only from the app itself, no plugins, no forms);
 * - the window can't be navigated or redirected away from app://game/, and opens no other windows (https links go to
 *   the real browser); every permission request (camera, microphone, notifications...) is denied;
 * - a crashed page reloads once, then explains itself instead of showing a blank window;
 * - packaging (scripts/package-desktop.mjs) turns off Electron's Node-as-a-program switches with fuses.
 */
const fs = require('node:fs');
const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, screen, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { CSP, distFile, fullscreenOptions, isAppUrl, isFullscreenKey } = require('./window-options.cjs');

const DIST = path.join(__dirname, '..', 'dist');
const DEFAULT_SIZE = { width: 1280, height: 800 };
const MIN_SIZE = { width: 480, height: 360 };

// The name and the app://game origin decide where the save lives (localStorage under userData): never change either,
// or every player's save is orphaned (tests/desktopSecurity.test.ts pins both).
app.setName('Winterland');

// 0.9.6: a single copy. The second launch quits at once and the first one comes to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const stateFile = () => path.join(app.getPath('userData'), 'window.json');

const isMode = (m) => m === 'windowed' || m === 'fullscreen';
const isRect = (b) =>
  !!b && [b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n)) && b.width >= 1 && b.height >= 1;

/** True when the rectangle overlaps some connected display enough to grab and drag it. */
function onSomeDisplay(b) {
  return screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    const ox = Math.min(b.x + b.width, w.x + w.width) - Math.max(b.x, w.x);
    const oy = Math.min(b.y + b.height, w.y + w.height) - Math.max(b.y, w.y);
    return ox >= 100 && oy >= 50;
  });
}

/** Saved window state, or the defaults (windowed, 1280x800 centred, not maximised) when missing or unusable. */
function loadState() {
  const state = { mode: 'windowed', bounds: null, maximized: false };
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (isMode(raw.mode)) state.mode = raw.mode;
    if (typeof raw.maximized === 'boolean') state.maximized = raw.maximized;
    if (isRect(raw.bounds)) {
      const b = {
        x: Math.round(raw.bounds.x),
        y: Math.round(raw.bounds.y),
        width: Math.max(MIN_SIZE.width, Math.round(raw.bounds.width)),
        height: Math.max(MIN_SIZE.height, Math.round(raw.bounds.height)),
      };
      // getDisplayMatching always answers with the nearest display, so check the overlap ourselves.
      if (onSomeDisplay(b)) state.bounds = b;
    }
  } catch {
    /* first run or unreadable file: defaults */
  }
  if (!state.bounds) state.maximized = false;
  return state;
}

function createWindow() {
  const saved = loadState();
  const fullscreen = saved.mode === 'fullscreen';
  // The last non-maximised, non-fullscreen bounds; kept while fullscreen so leaving it restores them.
  let normal = saved.bounds;
  let maximized = saved.maximized;
  let pendingMaximize = fullscreen && saved.maximized; // restore "maximised" the first time fullscreen is left

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    ...(saved.bounds ?? {}),
    center: !saved.bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    ...fullscreenOptions(saved.mode),
    title: 'Winterland',
    backgroundColor: '#cfe6f7',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      safeDialogs: true,
      devTools: !app.isPackaged,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  if (saved.maximized && !fullscreen) win.maximize();

  function snapshot() {
    const fs_ = win.isFullScreen();
    if (!fs_ && !win.isMinimized()) {
      maximized = win.isMaximized();
      const b = maximized ? win.getNormalBounds() : win.getBounds();
      if (isRect(b) && b.width >= MIN_SIZE.width && b.height >= MIN_SIZE.height) normal = b;
    }
    return { mode: fs_ ? 'fullscreen' : 'windowed', bounds: normal ?? win.getNormalBounds(), maximized };
  }

  function writeState() {
    try {
      const file = stateFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(snapshot(), null, 2));
      fs.renameSync(tmp, file);
    } catch {
      /* read-only profile or similar: the window state just isn't remembered */
    }
  }

  let timer = null;
  const saveSoon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!win.isDestroyed()) writeState();
    }, 300);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    win.on(ev, saveSoon);
  }
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    timer = null;
    writeState();
  });

  const announce = (mode) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('desktop:windowMode', mode);
  };
  win.on('enter-full-screen', () => announce('fullscreen'));
  win.on('leave-full-screen', () => {
    if (pendingMaximize) {
      pendingMaximize = false;
      win.maximize();
    }
    announce('windowed');
  });

  win.loadURL('app://game/index.html');

  // Links to the web open in the real browser, never inside the game window; nothing else opens at all.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The window only ever shows the game: no navigation or redirect away from app://game/ (reloads stay allowed).
  const stayHome = (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  };
  win.webContents.on('will-navigate', stayHome);
  win.webContents.on('will-redirect', stayHome);
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  // A crashed page reloads once (the save is in localStorage, so nothing is lost); a second crash explains itself.
  let crashes = 0;
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    crashes++;
    if (crashes === 1) {
      win.webContents.reload();
      return;
    }
    dialog.showMessageBox(win, {
      type: 'error',
      title: 'Winterland',
      message: 'Winterland stopped unexpectedly.',
      detail: 'Your game is saved every few seconds. Close this window and open Winterland again to carry on.',
      buttons: ['Reload', 'Close'],
      defaultId: 0,
    }).then(({ response }) => {
      if (win.isDestroyed()) return;
      if (response === 0) win.webContents.reload();
      else win.close();
    });
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (isFullscreenKey(input, process.platform)) {
      if (!input.isAutoRepeat) win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F12' || (ctrl && input.shift && input.key.toLowerCase() === 'i')) {
      if (!app.isPackaged) win.webContents.toggleDevTools(); // development runs only
      event.preventDefault();
    } else if (ctrl && input.key.toLowerCase() === 'r') {
      win.webContents.reload();
      event.preventDefault();
    }
  });
}

// IPC for the preload bridge. Registered once; the window is looked up from the sender so a re-created window works.
const windowOf = (event) => BrowserWindow.fromWebContents(event.sender);
ipcMain.on('desktop:version', (event) => {
  event.returnValue = app.getVersion();
});
ipcMain.handle('desktop:getWindowMode', (event) => (windowOf(event)?.isFullScreen() ? 'fullscreen' : 'windowed'));
ipcMain.on('desktop:setWindowMode', (event, mode) => {
  if (!isMode(mode)) return;
  windowOf(event)?.setFullScreen(mode === 'fullscreen');
});
// 0.9.6 Settings → Save & quit: the game has already written its save when it sends this. Only the game page may ask.
ipcMain.on('desktop:quit', (event) => {
  if (!isAppUrl(event.senderFrame?.url ?? '')) return;
  app.quit();
});

app.whenReady().then(() => {
  // No menu bar in the game window; macOS keeps just the app menu (Hide, Quit), View > Enter Full Screen and the
  // Window menu (Minimize).
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([
          { role: 'appMenu' },
          { label: 'View', submenu: [{ role: 'togglefullscreen' }] },
          { role: 'windowMenu' },
        ])
      : null,
  );
  // Nothing the game does needs a permission (fullscreen goes through the bridge): deny every request and check.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  protocol.handle('app', async (request) => {
    const file = distFile(DIST, request.url);
    if (!file) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
