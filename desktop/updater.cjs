/**
 * [0.9.8 — in-game updater] The desktop side of "a new version is out": the game page asks, this main-process module
 * talks to GitHub, and the shipped "Update Winterland" script does the file swap after the game has closed.
 *
 * Why here and not in the page: the page stays fully offline (its Content-Security-Policy allows no connections at
 * all, desktop/window-options.cjs), and only this module, in the main process, ever reaches the network.
 *
 * What it does, and nothing else:
 *   1. check: reads SHA256SUMS.txt from the latest GitHub release (HTTPS, Chromium's network stack so the system proxy
 *      and certificate store apply, every redirect checked against update-core's host list, size-capped, an
 *      in-memory session with no cookies or disk cache). If that release is newer, it also fetches its
 *      RELEASE-NOTES.md and shows it only when the notes' SHA-256 matches the list.
 *      Nothing is contacted until the page asks (the "Check for updates" switch in Settings, on by default).
 *   2. download: when the player picks "Update now", streams the zip for this computer from that exact release tag
 *      into a private temp folder and checks its SHA-256 against the list. On a mismatch the file is deleted.
 *   3. install: copies the shipped updater script (resources/updater) next to the zip, starts it detached without a
 *      shell and never elevated, and quits. The script re-checks the zip against a freshly fetched SHA256SUMS.txt,
 *      waits for the game to close, swaps the game files (keeping the old ones until the new ones are in place) and
 *      starts the new version, or, if anything is off, starts this version again with --update-failed=<reason>.
 * The save (localStorage in the user-data folder) is never read, moved or written here: it is not in the game folder.
 *
 * 0.9.11, AppImages (Linux): a copy started from Winterland-X.Y.Z-<arch>.AppImage runs from a read-only mount, so it
 * fetches the release's AppImage instead of the zip, and the script replaces that one file in place (same name and
 * folder, so a menu entry from Gear Lever or the like keeps working; Gear Lever then sees it as up to date).
 *
 * IPC (desktop/preload.cjs → window.winterlandDesktop.updates; only the game page may ask):
 *   update:info → { supported, canInstall, current, failed }     update:check → { status, version?, notes?, code? }
 *   update:download → { ok, code? } (+ 'update:progress' events)  update:cancel, update:install, update:openPage
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, ipcMain, net, session, shell } = require('electron');
const core = require('./update-core.cjs');
const { isAppUrl } = require('./window-options.cjs');

const TEMP_PREFIX = 'winterland-ingame-';
/** Seconds without a byte before a request gives up. */
const IDLE_SECONDS = 30;

class UpdateError extends Error {
  constructor(code) {
    super(code);
    this.code = core.FAIL_CODES.includes(code) ? code : 'other';
  }
}
const codeOf = (err) => (err instanceof UpdateError ? err.code : 'other');

let netSession = null;
/** An in-memory session of its own: no cookies, no disk cache, nothing shared with the game page. */
function updaterSession() {
  if (!netSession) netSession = session.fromPartition('winterland-updater', { cache: false });
  return netSession;
}

/**
 * GET one URL, handing each chunk to `onChunk(chunk, got, total)`. Every hop (the URL and each redirect) must pass
 * update-core's `allowedUrl`; at most 5 redirects; more than `limit` bytes, a status other than 200, or 30 s of
 * silence stop it. `signal` (AbortSignal) cancels.
 */
function request(url, { limit, onChunk, signal }) {
  return new Promise((resolve, reject) => {
    if (!core.allowedUrl(url)) {
      reject(new UpdateError('other'));
      return;
    }
    let done = false;
    let hops = 0;
    let timer = null;
    const req = net.request({
      url,
      method: 'GET',
      session: updaterSession(),
      redirect: 'manual',
      credentials: 'omit',
      useSessionCookies: false,
      cache: 'no-store',
    });
    const onAbort = () => stop('cancelled');
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve(value);
    };
    function stop(code) {
      try {
        req.abort();
      } catch {
        /* already finished */
      }
      finish(new UpdateError(code));
    }
    const idle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => stop('offline'), IDLE_SECONDS * 1000);
    };
    if (signal?.aborted) {
      finish(new UpdateError('cancelled'));
      return;
    }
    signal?.addEventListener('abort', onAbort);
    req.on('redirect', (_status, _method, redirectUrl) => {
      hops++;
      if (hops > 5 || !core.allowedUrl(redirectUrl)) {
        stop('other');
        return;
      }
      idle();
      req.followRedirect();
    });
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        stop(res.statusCode === 404 ? 'nodownload' : 'offline');
        return;
      }
      const header = res.headers['content-length'];
      const total = Number(Array.isArray(header) ? header[0] : header) || 0;
      if (total > limit) {
        stop('other');
        return;
      }
      let got = 0;
      res.on('data', (chunk) => {
        if (done) return;
        got += chunk.length;
        if (got > limit) {
          stop('other');
          return;
        }
        idle();
        try {
          onChunk(chunk, got, total);
        } catch {
          stop('files');
        }
      });
      res.on('end', () => finish(null, got));
      res.on('aborted', () => stop('offline'));
      res.on('error', () => stop('offline'));
    });
    req.on('error', () => stop('offline'));
    idle();
    req.end();
  });
}

async function fetchBuffer(url, limit) {
  const parts = [];
  await request(url, { limit, onChunk: (chunk) => parts.push(Buffer.from(chunk)) });
  return Buffer.concat(parts);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

let image;
/**
 * The AppImage file this copy runs from (Linux), or null. The AppImage starter sets $APPIMAGE (the file) and $APPDIR
 * (where it is mounted). This copy must really run from that mount, and the file must be a plain file that starts like
 * an AppImage, so a stray $APPIMAGE can never point the updater at another file.
 */
function appImageFile() {
  if (image !== undefined) return image;
  image = null;
  const file = process.env.APPIMAGE;
  const dir = process.env.APPDIR;
  if (process.platform !== 'linux' || !file || !dir || !path.isAbsolute(file) || !path.isAbsolute(dir)) return image;
  try {
    if (path.dirname(fs.realpathSync(process.execPath)) !== fs.realpathSync(dir)) return image;
    const real = fs.realpathSync(file);
    if (!fs.statSync(real).isFile()) return image;
    const head = Buffer.alloc(16);
    const fd = fs.openSync(real, 'r');
    try {
      fs.readSync(fd, head, 0, head.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (core.isAppImageHead(head)) image = real;
  } catch {
    /* not an AppImage we can update */
  }
  return image;
}

/**
 * Where this copy lives: the folder the updater swaps files in (Linux, Windows), the .app (macOS) or the AppImage file
 * (Linux, `appImage`), or null.
 */
function installTarget() {
  const exe = process.execPath;
  const file = appImageFile();
  if (file) return { app: '', folder: path.dirname(file), appImage: file };
  if (process.platform === 'darwin') {
    const appPath = path.resolve(exe, '..', '..', '..');
    return appPath.endsWith('.app') ? { app: appPath, folder: path.dirname(appPath) } : null;
  }
  return { app: '', folder: path.dirname(exe) };
}

const scriptName = () => (process.platform === 'win32' ? 'update.ps1' : 'update.sh');
const scriptSource = () => path.join(process.resourcesPath, 'updater', scriptName());

/** True when this copy can update itself: a packaged release with its updater script, in a folder it may write. */
function canInstall() {
  if (!supported()) return false;
  const target = installTarget();
  if (!target || !fs.existsSync(scriptSource())) return false;
  try {
    // (a Mac app run straight from Downloads is moved by macOS to a read-only spot: then the page offers the
    // download page instead)
    fs.accessSync(target.folder, fs.constants.W_OK);
    if (target.app) fs.accessSync(target.app, fs.constants.W_OK);
    if (target.appImage) fs.accessSync(target.appImage, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Only packaged releases for a computer the releases ship a zip for ever check (never a development run). */
function supported() {
  return app.isPackaged && core.targetOf(process.platform, process.arch) !== null;
}

/** Old download folders from earlier in-game updates (the script leaves the zip behind): removed at start. */
function cleanTemp() {
  let names = [];
  try {
    names = fs.readdirSync(os.tmpdir());
  } catch {
    return;
  }
  for (const n of names) {
    if (!/^winterland-ingame-[A-Za-z0-9]{6}$/.test(n)) continue;
    fs.rm(path.join(os.tmpdir(), n), { recursive: true, force: true }, () => {});
  }
}

/**
 * The environment for the script: the player's own, minus anything that would change how Electron or Node start, and
 * this AppImage's own variables (they describe a mount that is gone once the game closes; a new AppImage sets its own).
 */
function cleanEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^(ELECTRON_|NODE_OPTIONS$|NODE_PATH$|APPIMAGE$|APPDIR$|ARGV0$|OWD$)/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function registerUpdater() {
  const target = core.targetOf(process.platform, process.arch);
  let failed = core.failCodeFromArgv(process.argv);
  /** The release the last check found. */
  let latest = null;
  /** The checked download, ready to install. */
  let staged = null;
  let busy = false;
  let controller = null;
  cleanTemp(); // (lists the folders now, so a download started later is never among them)

  const fromGame = (event) => isAppUrl(event.senderFrame?.url ?? '');

  ipcMain.handle('update:info', (event) => {
    if (!fromGame(event)) return null;
    const out = { supported: supported(), canInstall: canInstall(), current: app.getVersion(), failed };
    failed = null; // said once
    return out;
  });

  ipcMain.handle('update:check', async (event) => {
    if (!fromGame(event) || !supported()) return { status: 'error', code: 'other' };
    if (busy) return { status: 'error', code: 'running' };
    busy = true;
    try {
      // (a 404 here means GitHub shows no public release at all, e.g. while the repository is private)
      const text = (
        await fetchBuffer(core.SUMS_URL, core.LIMITS.sums).catch((err) => {
          throw codeOf(err) === 'nodownload' ? new UpdateError('norelease') : err;
        })
      ).toString('utf8');
      const sums = core.parseSums(text, target, { appImage: appImageFile() !== null });
      if (!sums) return { status: 'error', code: 'nodownload' };
      if (!core.isNewer(sums.version, app.getVersion())) return { status: 'none', version: sums.version };
      latest = sums;
      let notes = null;
      if (sums.notesSha) {
        try {
          const buf = await fetchBuffer(core.assetUrl(sums.version, 'RELEASE-NOTES.md'), core.LIMITS.notes);
          if (sha256(buf) === sums.notesSha) notes = buf.toString('utf8');
        } catch {
          /* no notes: the card simply doesn't show them */
        }
      }
      return { status: 'available', version: sums.version, notes };
    } catch (err) {
      return { status: 'error', code: codeOf(err) };
    } finally {
      busy = false;
    }
  });

  ipcMain.handle('update:download', async (event) => {
    if (!fromGame(event) || !latest || !canInstall()) return { ok: false, code: 'other' };
    if (busy) return { ok: false, code: 'running' };
    busy = true;
    controller = new AbortController();
    const release = latest;
    let dir = null;
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX)); // private to this user (0700)
      const file = path.join(dir, release.zipName);
      const out = fs.openSync(file, 'wx', 0o600);
      const hash = crypto.createHash('sha256');
      let lastSent = 0;
      try {
        await request(core.assetUrl(release.version, release.zipName), {
          limit: core.LIMITS.zip,
          signal: controller.signal,
          onChunk: (chunk, got, total) => {
            fs.writeSync(out, chunk);
            hash.update(chunk);
            const now = Date.now();
            if (now - lastSent > 120 && !event.sender.isDestroyed()) {
              lastSent = now;
              event.sender.send('update:progress', { got, total });
            }
          },
        });
      } finally {
        fs.closeSync(out);
      }
      if (hash.digest('hex') !== release.sha) throw new UpdateError('checksum');
      staged = { dir, file, version: release.version };
      return { ok: true };
    } catch (err) {
      if (dir) fs.rm(dir, { recursive: true, force: true }, () => {});
      return { ok: false, code: codeOf(err) };
    } finally {
      busy = false;
      controller = null;
    }
  });

  ipcMain.on('update:cancel', (event) => {
    if (fromGame(event)) controller?.abort();
  });

  // The page has written its save before it sends this.
  ipcMain.handle('update:install', async (event) => {
    if (!fromGame(event) || !staged || !canInstall()) return { ok: false, code: 'other' };
    const where = installTarget();
    try {
      const script = path.join(staged.dir, scriptName());
      fs.copyFileSync(scriptSource(), script);
      fs.chmodSync(script, 0o700);
      const { cmd, args } = core.installCommand({
        platform: process.platform,
        script,
        zip: staged.file,
        install: where.folder,
        app: where.app,
        appImage: where.appImage,
        systemRoot: process.env.SystemRoot,
      });
      await new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd: staged.dir, env: cleanEnv(process.env), detached: true, stdio: 'ignore', windowsHide: true, shell: false });
        child.once('error', reject);
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
      });
    } catch {
      return { ok: false, code: 'files' };
    }
    setTimeout(() => app.quit(), 200);
    return { ok: true };
  });

  ipcMain.on('update:openPage', (event) => {
    if (fromGame(event)) void shell.openExternal(core.PAGE_URL);
  });
}

module.exports = { registerUpdater };
