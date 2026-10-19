/**
 * [0.9.8 — in-game updater] The pure rules of the in-game update check, kept free of Electron so tests can load them
 * (tests/updater.test.ts). desktop/updater.cjs does the network and the install with them.
 *
 * The trust chain is the same as "Update Winterland" (desktop/updater): HTTPS to GitHub only, SHA256SUMS.txt from the
 * latest release, one strict line per zip, and the zip's SHA-256 must match it before anything is installed.
 */

const REPO = 'djshiye/winterland';
const RELEASES = `https://github.com/${REPO}/releases/`;
const SUMS_URL = `${RELEASES}latest/download/SHA256SUMS.txt`;
/** The release page (opened in the player's browser when this copy can't install by itself). */
const PAGE_URL = `${RELEASES}latest`;

/**
 * The only hosts any request (or redirect) may reach: GitHub, and the storage hosts GitHub sends release downloads
 * to. Release files are fetched as https://github.com/djshiye/winterland/releases/download/..., which redirects to a
 * signed URL on one of the storage hosts.
 */
const ASSET_HOSTS = ['objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com'];

/** Size limits: the checksum list and the notes are small text; a zip is ~110 MB today. */
const LIMITS = { sums: 64 * 1024, notes: 128 * 1024, zip: 600 * 1024 * 1024 };

/** The zips a release ships (scripts/package-desktop.mjs, .github/workflows/release.yml). */
// 0.9.11: no darwin-x64 (Macs on Apple chips only)
const TARGETS = ['linux-x64', 'linux-arm64', 'win32-x64', 'darwin-arm64'];

/**
 * 0.9.10: Linux releases also ship an AppImage per architecture (scripts/package-appimage.mjs), named the AppImage way
 * (`Winterland-X.Y.Z-x86_64.AppImage`), listed in the same SHA256SUMS.txt. Older copies only read the zip lines.
 */
const APPIMAGE_ARCH = { 'linux-x64': 'x86_64', 'linux-arm64': 'aarch64' };

/** Why an update stopped. The script reports these back as `--update-failed=<code>`; the game words them. */
const FAIL_CODES = ['offline', 'norelease', 'nodownload', 'current', 'running', 'checksum', 'files', 'unzip', 'cancelled', 'other'];

/** True for a URL a request may go to: https, no user name or port, and GitHub's own release paths. */
function allowedUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  if (u.hostname === 'github.com') return u.pathname.startsWith(`/${REPO}/releases/`);
  return ASSET_HOSTS.includes(u.hostname);
}

/** x.y.z → [x, y, z], or null (releases use 3-part versions only). */
function parseVersion(v) {
  const m = typeof v === 'string' ? /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `a` is a strictly newer x.y.z than `b`. */
function isNewer(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** The release zip target for this computer, or null when releases have none (e.g. 32-bit Windows). */
function targetOf(platform, arch) {
  const t = `${platform}-${arch}`;
  return TARGETS.includes(t) ? t : null;
}

/**
 * Read SHA256SUMS.txt for one target. Exactly one line in the strict `<64 hex>  Winterland-X.Y.Z-<target>.zip` form
 * must name it (anything else, including two such lines, is refused), and every zip line must carry the same version.
 * The release notes (`<64 hex>  RELEASE-NOTES.md`, from 0.9.8) are optional.
 * With `appImage` (0.9.10, a Linux copy running as an AppImage) the file to fetch is that target's
 * `Winterland-X.Y.Z-<arch>.AppImage` line instead, under the same rules, and it must carry the zips' version.
 * Returns { version, zipName, sha, notesSha } or null (zipName is the file to download, zip or AppImage).
 */
function parseSums(text, target, { appImage = false } = {}) {
  if (typeof text !== 'string' || !TARGETS.includes(target)) return null;
  if (appImage && !APPIMAGE_ARCH[target]) return null;
  const zips = [];
  const images = [];
  const notes = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    let m = /^([0-9a-f]{64}) {2}(Winterland-(\d{1,6}\.\d{1,6}\.\d{1,6})-([a-z0-9]+-[a-z0-9]+)\.zip)$/.exec(line);
    if (m) {
      zips.push({ sha: m[1], zipName: m[2], version: m[3], target: m[4] });
      continue;
    }
    m = /^([0-9a-f]{64}) {2}(Winterland-(\d{1,6}\.\d{1,6}\.\d{1,6})-(x86_64|aarch64)\.AppImage)$/.exec(line);
    if (m) {
      images.push({ sha: m[1], zipName: m[2], version: m[3], arch: m[4] });
      continue;
    }
    m = /^([0-9a-f]{64}) {2}RELEASE-NOTES\.md$/.exec(line);
    if (m) notes.push(m[1]);
  }
  if (new Set(zips.map((z) => z.version)).size !== 1) return null;
  const mine = appImage ? images.filter((i) => i.arch === APPIMAGE_ARCH[target]) : zips.filter((z) => z.target === target);
  if (mine.length !== 1 || mine[0].version !== zips[0].version) return null;
  const { version, zipName, sha } = mine[0];
  return { version, zipName, sha, notesSha: notes.length === 1 ? notes[0] : null };
}

/**
 * True when `head` (the first 16 bytes of a file) starts like an AppImage of type 2: an ELF program with the AppImage
 * mark "AI" 0x02 at byte 8. The in-game updater only ever replaces a file that passes this, so a wrong $APPIMAGE can't
 * point it at some other file of the player's.
 */
function isAppImageHead(head) {
  if (!head || head.length < 11) return false;
  return head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46 && head[8] === 0x41 && head[9] === 0x49 && head[10] === 0x02;
}

/** Where one file of a release lives (the exact tag, never "latest", so the zip matches the checksum list). */
function assetUrl(version, name) {
  if (!parseVersion(version) || !/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('bad release asset');
  return `${RELEASES}download/v${version}/${name}`;
}

/** The reason in a `--update-failed=<code>` launch argument (the script starts the old game with it), or null. */
function failCodeFromArgv(argv) {
  for (const a of Array.isArray(argv) ? argv : []) {
    const m = typeof a === 'string' ? /^--update-failed=([a-z]{1,16})$/.exec(a) : null;
    if (m) return FAIL_CODES.includes(m[1]) ? m[1] : 'other';
  }
  return null;
}

/**
 * The command that installs a downloaded update: a copy of the shipped updater script, run without a shell, never
 * elevated. `script` is that copy, `zip` the checked download, `install` the game folder (Linux, Windows) and `app`
 * the Winterland.app (macOS). Windows PowerShell is started by its full path (never looked up on PATH), hidden.
 * `appImage` (Linux, 0.9.10): the AppImage file to replace, instead of a game folder.
 */
function installCommand({ platform, script, zip, install, app, appImage, systemRoot }) {
  if (platform === 'win32') {
    const root = typeof systemRoot === 'string' && /^[A-Za-z]:\\/.test(systemRoot) ? systemRoot : 'C:\\Windows';
    return {
      cmd: `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-FromGame', '-Install', install, '-Zip', zip],
    };
  }
  if (platform === 'darwin') return { cmd: '/bin/bash', args: [script, '--from-game', '--app', app, '--zip', zip] };
  if (appImage) return { cmd: '/bin/bash', args: [script, '--from-game', '--appimage', appImage, '--zip', zip] };
  return { cmd: '/bin/bash', args: [script, '--from-game', '--install', install, '--zip', zip] };
}

module.exports = {
  APPIMAGE_ARCH,
  ASSET_HOSTS,
  FAIL_CODES,
  LIMITS,
  PAGE_URL,
  RELEASES,
  REPO,
  SUMS_URL,
  TARGETS,
  allowedUrl,
  assetUrl,
  failCodeFromArgv,
  installCommand,
  isAppImageHead,
  isNewer,
  parseSums,
  parseVersion,
  targetOf,
};
