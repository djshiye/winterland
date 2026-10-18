#!/usr/bin/env node
/**
 * End-to-end test of "Update Winterland" (desktop/updater) on the machine it runs on: Linux tests update.sh as the
 * Linux updater, macOS as the Mac one (Winterland.app), Windows tests update.ps1 under Windows PowerShell 5.1.
 *
 * It builds a fake installed game and a fake GitHub release (zip + SHA256SUMS.txt), then runs the real updater with
 * the download step pointed at those files: a stand-in `curl` on PATH (Linux, macOS) or a stand-in
 * Invoke-WebRequest (Windows). The updater itself is unmodified. Nothing outside a temp folder is touched; HOME and
 * APPDATA point into it, and a fake save there must come out byte for byte the same.
 *
 * 0.9.8: also the in-game route (desktop/updater.cjs): the app's own copy of the script, run from a temp folder with
 * the zip the game already downloaded (--from-game --zip --install / --app; Windows -FromGame -Zip -Install).
 *
 * 0.9.10 (F9): swaps cut off half way. A stand-in `mv` (Linux, macOS) or Move-Item (Windows) hard-kills the updater
 * right after a chosen move, like a power cut, or refuses chosen moves; then either the updater runs again or the game
 * starts (desktop/swap-recover.cjs, Linux and macOS), and the folder must come out whole: all old or all new.
 *
 *   node scripts/test-updater.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { inAppUpdaterFiles, updaterFiles } from './updater-files.mjs';

const OS = process.platform; // linux | darwin | win32
const ARCH = 'x64';
const TARGET = `${OS}-${ARCH}`;
const OLD = '0.9.2';
const NEW = '0.9.3';
const BASE = 'https://github.com/djshiye/winterland/releases/';

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures++;
};
const put = (file, content, mode = 0o644) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  chmodSync(file, mode);
};
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const { recoverSwap } = createRequire(import.meta.url)('../desktop/swap-recover.cjs');
/** The real mv, for the stand-in to call. */
const REAL_MV = OS === 'win32' ? '' : run('/bin/sh', ['-c', 'command -v mv']).stdout.trim();

/** The files of one Winterland version, laid out like the packaged folder (paths relative to it). */
function gameFiles(version) {
  const files = updaterFiles(OS, ARCH, version).map((f) => ({ ...f }));
  if (OS === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`;
    files.push(
      { path: 'Winterland.app/Contents/MacOS/Winterland', content: '#!/bin/sh\nexit 0\n', mode: 0o755 },
      { path: 'Winterland.app/Contents/Info.plist', content: plist, mode: 0o644 },
      { path: 'Winterland.app/Contents/Resources/app.asar', content: `game ${version}`, mode: 0o644 },
    );
  } else {
    const exe = OS === 'win32' ? 'Winterland.exe' : 'winterland';
    files.push(
      // (Linux: the fake game notes how it was started, to check an in-game update that stops reopens it)
      { path: exe, content: OS === 'win32' ? 'MZ' : '#!/bin/sh\necho "started $*" > "$(dirname "$0")/started.txt"\n', mode: 0o755 },
      { path: 'resources/app.asar', content: `game ${version}`, mode: 0o644 },
      { path: 'LICENSE', content: `license ${version}`, mode: 0o644 },
    );
  }
  return files;
}

function zipFolder(parent, name, zip) {
  let r;
  if (OS === 'darwin') r = run('ditto', ['-c', '-k', '--keepParent', join(parent, name), zip]);
  else if (OS === 'win32')
    r = run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${join(parent, name)}' -DestinationPath '${zip}' -Force`]);
  else r = run('zip', ['-qry', zip, name], { cwd: parent });
  if (r.status !== 0) throw new Error(`zip failed: ${r.stderr}`);
}

/**
 * (Linux) The old game still closing for `seconds` while the updater starts: a copy of bash renamed 'winterland' runs
 * from the game folder (so it looks like the game to the updater), then puts the fake game back and exits. A game
 * started while it is still there would be bash, not the fake game, and would note nothing.
 */
function closingGame(install, seconds) {
  const game = join(install, 'winterland');
  const fake = join(install, '.fake-game');
  copyFileSync(game, fake);
  rmSync(game);
  copyFileSync('/bin/bash', game);
  chmodSync(game, 0o755);
  const child = spawn(game, ['-c', `sleep ${seconds}; mv -f '${fake}' '${game}'; exit 0`], { detached: true, stdio: 'ignore' });
  child.unref();
}

/**
 * One scenario in a fresh temp folder. `sums` edits SHA256SUMS.txt; `before` can tamper with the install.
 * `cut` (0.9.10): `{ kill }` hard-kills the updater just after the move whose destination ends with that text (a power
 * cut), `{ fail }` makes every move whose "from to" matches that regex fail (Linux). `then`: after that run, 'updater'
 * runs the updater again (the old version's copy, from outside the folder) and 'game' runs the game's start-up
 * recovery; the state after the first run is in `mid`.
 */
function scenario(title, { latest = NEW, sums = (s) => s, before = () => {}, inGame = null, cut = null, then = null } = {}) {
  console.log(`\n${title}`);
  const root = mkdtempSync(join(tmpdir(), 'wl-updater-test-'));
  try {
    const home = join(root, 'home');
    const install = join(root, `Winterland-${TARGET}`);
    const server = join(root, 'server');
    const log = join(root, 'downloads.log');
    mkdirSync(server, { recursive: true });

    for (const f of gameFiles(OLD)) put(join(install, f.path), f.content, f.mode);
    put(join(install, 'my-notes.txt'), 'mine'); // not part of the game: must stay
    const saveDir = OS === 'win32' ? join(home, 'AppData', 'Roaming', 'Winterland') : OS === 'darwin'
      ? join(home, 'Library', 'Application Support', 'Winterland') : join(home, '.config', 'Winterland');
    put(join(saveDir, 'Local Storage', 'leveldb', '000003.log'), 'my precious save');

    // The release on the fake GitHub.
    const zipName = `Winterland-${latest}-${TARGET}.zip`;
    const build = join(root, 'build');
    for (const f of gameFiles(latest)) put(join(build, `Winterland-${TARGET}`, f.path), f.content, f.mode);
    put(join(build, `Winterland-${TARGET}`, 'locales', 'en.pak'), 'new file');
    mkdirSync(join(server, `v${latest}`), { recursive: true });
    const zip = join(server, `v${latest}`, zipName);
    zipFolder(build, `Winterland-${TARGET}`, zip);
    const lines = [
      `${'a'.repeat(64)}  Winterland-${latest}-other-x64.zip`,
      `${sha(zip)}  ${zipName}`,
    ];
    writeFileSync(join(server, 'SHA256SUMS.txt'), sums(lines.join('\n') + '\n'));
    before({ install });

    // In-game: the app's copy of the script in a folder of its own, next to the zip the game downloaded.
    let runner = null;
    let given = null;
    if (inGame) {
      runner = join(root, 'ingame');
      const copy = inAppUpdaterFiles(OS, ARCH, OLD)[0];
      put(join(runner, OS === 'win32' ? 'update.ps1' : 'update.sh'), copy.content, 0o700);
      given = join(runner, inGame.zipName ?? zipName);
      writeFileSync(given, inGame.tamper ? Buffer.concat([readFileSync(zip), Buffer.from('x')]) : readFileSync(zip));
    }

    // The old version's own updater, kept outside the folder (a cut-off swap may have moved the one inside it).
    const rerun = join(root, 'rerun');
    if (then === 'updater') {
      for (const f of updaterFiles(OS, ARCH, OLD)) put(join(rerun, f.path), f.content, f.mode);
    }
    const execute = (again) => {
    let r;
    const cutEnv = !again && cut ? (cut.kill ? { WL_MV_KILL: cut.kill.replaceAll('/', OS === 'win32' ? '\\' : '/') } : { WL_MV_FAIL: cut.fail }) : {};
    if (OS === 'win32') {
      const harness = join(root, 'harness.ps1');
      writeFileSync(harness, `param($Updater, $Server, $Log)
function global:Invoke-WebRequest {
  param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing, [int]$MaximumRedirection, [int]$TimeoutSec)
  Add-Content -LiteralPath $Log -Value $Uri
  $base = '${BASE}'
  if ($Uri -eq ($base + 'latest/download/SHA256SUMS.txt')) { $f = Join-Path $Server 'SHA256SUMS.txt' }
  elseif ($Uri.StartsWith($base + 'download/')) { $f = Join-Path $Server ($Uri.Substring(($base + 'download/').Length) -replace '/', '\\') }
  else { throw "unexpected URL $Uri" }
  if (-not (Test-Path -LiteralPath $f)) { throw "404 $Uri" }
  Copy-Item -LiteralPath $f -Destination $OutFile
}
if ($env:WL_MV_KILL) {
  function global:Move-Item {
    param([string]$LiteralPath, [string]$Destination)
    Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
    if ($Destination.EndsWith($env:WL_MV_KILL)) { Stop-Process -Id $PID -Force }
  }
}
if ($env:WL_TEST_INGAME) { & $Updater -FromGame -NoLaunch -Install $env:WL_TEST_INSTALL -Zip $env:WL_TEST_ZIP }
elseif ($env:WL_TEST_INSTALL) { & $Updater -Yes -NoLaunch -NoPause -Install $env:WL_TEST_INSTALL }
else { & $Updater -Yes -NoLaunch -NoPause }
exit $LASTEXITCODE
`);
      const ps1 = again ? join(rerun, 'updater', 'update.ps1') : inGame ? join(runner, 'update.ps1') : join(install, 'updater', 'update.ps1');
      const env = { ...process.env, APPDATA: join(home, 'AppData', 'Roaming'), ...cutEnv };
      if (again) env.WL_TEST_INSTALL = install;
      else if (inGame) Object.assign(env, { WL_TEST_INGAME: '1', WL_TEST_INSTALL: install, WL_TEST_ZIP: given });
      r = run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness, ps1, server, log], { env });
    } else {
      // Stand-in curl: insists on HTTPS-only flags, serves the fake release, logs every URL.
      const bin = join(root, 'bin');
      put(join(bin, 'curl'), `#!/bin/bash
out='' url='' https=0
while [ $# -gt 0 ]; do
  case "$1" in -o) shift; out="$1" ;; --proto) shift; [ "$1" = '=https' ] && https=$((https+1)) ;;
    --proto-redir) shift; [ "$1" = '=https' ] && https=$((https+1)) ;; -*) ;; *) url="$1" ;; esac
  shift
done
echo "$url" >> '${log}'
[ "$https" = 2 ] || { echo "not https-only" >&2; exit 2; }
case "$url" in
  '${BASE}latest/download/SHA256SUMS.txt') f='${server}/SHA256SUMS.txt' ;;
  '${BASE}download/'*) f='${server}/'"\${url#${BASE}download/}" ;;
  *) echo "unexpected URL $url" >&2; exit 2 ;;
esac
[ -f "$f" ] || exit 22
cp "$f" "$out"
`, 0o755);
      // Stand-in mv (0.9.10): the real one, then a hard kill of the updater after the chosen move, or a refused move.
      if (cut) {
        put(join(bin, 'mv'), `#!/bin/bash
if [ -n "\${WL_MV_FAIL:-}" ] && [[ "$*" =~ $WL_MV_FAIL ]]; then exit 1; fi
'${REAL_MV}' "$@" || exit $?
if [ -n "\${WL_MV_KILL:-}" ]; then case "\${@: -1}" in *"$WL_MV_KILL") kill -9 "$PPID" ;; esac; fi
exit 0
`, 0o755);
      }
      const inGameRun = inGame && !again;
      const script = again ? join(rerun, updaterFiles(OS, ARCH, OLD)[0].path) : inGameRun ? join(runner, 'update.sh') : join(install, OS === 'darwin' ? 'Update Winterland.command' : 'Update Winterland.sh');
      const args = inGameRun ? [script, '--from-game', '--zip', given] : [script, '--yes'];
      // (the in-game run on Linux starts the fake game, which notes it; elsewhere nothing is started)
      if (!(inGameRun && OS === 'linux')) args.push('--no-launch');
      if (OS === 'darwin') args.push('--app', join(install, 'Winterland.app'));
      else if (inGameRun || again) args.push('--install', install);
      r = run('/bin/bash', args, {
        env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, ...(inGameRun ? {} : { WL_UPDATER_IN_TERMINAL: '1' }), WL_UPDATER_ALLOW_ROOT: '1', TMPDIR: root, ...cutEnv },
      });
      // the fake game is started in the background: give it a moment to note how
      if (inGameRun && OS === 'linux') for (let i = 0; i < 40 && !existsSync(join(install, 'started.txt')); i++) spawnSync('sleep', ['0.05']);
    }
    return r;
    };
    const began = Date.now();
    let r = execute(false);
    const listLeftovers = () => readdirSync(install).filter((n) => n.startsWith('.winterland-update'));
    const asarPath = join(install, OS === 'darwin' ? 'Winterland.app/Contents/Resources/app.asar' : 'resources/app.asar');
    const mid = {
      status: r.status,
      output: `${r.stdout ?? ''}${r.stderr ?? ''}`,
      leftovers: listLeftovers(),
      gameNow: existsSync(asarPath) ? readFileSync(asarPath, 'utf8') : '(missing)',
      oldKept: existsSync(join(install, '.winterland-update-new', 'old', 'resources', 'app.asar')) || existsSync(join(install, '.winterland-update-new', 'old.app')),
    };
    let recovered = null;
    if (then === 'updater') r = execute(true);
    else if (then === 'game') recovered = recoverSwap(install, OS, OS === 'darwin' ? join(install, 'Winterland.app') : '');
    const output = `${mid.output}${then ? `${r.stdout ?? ''}${r.stderr ?? ''}` : ''}`;
    const asar = OS === 'darwin' ? 'Winterland.app/Contents/Resources/app.asar' : 'resources/app.asar';
    const gameNow = existsSync(join(install, asar)) ? readFileSync(join(install, asar), 'utf8') : '(missing)';
    const leftovers = readdirSync(install).filter((n) => n.startsWith('.winterland-update'));
    const urls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
    return {
      r,
      mid,
      recovered,
      seconds: (Date.now() - began) / 1000,
      output,
      gameNow,
      leftovers,
      urls,
      notesKept: existsSync(join(install, 'my-notes.txt')),
      saveKept: readFileSync(join(saveDir, 'Local Storage', 'leveldb', '000003.log'), 'utf8') === 'my precious save',
      newFile: existsSync(join(install, 'locales', 'en.pak')),
      updaterNow: readFileSync(join(install, updaterFiles(OS, ARCH, OLD).at(-1).path), 'utf8'),
      started: existsSync(join(install, 'started.txt')) ? readFileSync(join(install, 'started.txt'), 'utf8').trim() : null,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const show = (s) => {
  if (failures) console.log(s.output.replace(/^/gm, '      | '));
};

let s = scenario(`Update ${OLD} → ${NEW} (${TARGET})`);
check(s.r.status === 0, 'exits 0');
check(s.gameNow === `game ${NEW}`, 'game files are the new version');
check(OS === 'darwin' || s.newFile, 'files new in this version arrive');
check(s.updaterNow.includes(`'${NEW}'`), 'the updater itself is updated');
check(s.notesKept, 'files that are not part of the game stay');
check(s.saveKept, 'save untouched');
check(s.leftovers.length === 0, 'no temporary folders left behind');
check(s.urls.length === 2 && s.urls.every((u) => u.startsWith(BASE)), 'downloads only from the GitHub release');
check(s.urls[1] === `${BASE}download/v${NEW}/Winterland-${NEW}-${TARGET}.zip`, 'zip comes from the exact release tag');
show(s);

s = scenario('Already up to date', { latest: OLD });
check(s.r.status === 0, 'exits 0');
check(/newest/.test(s.output), 'says it is up to date');
check(s.gameNow === `game ${OLD}` && s.urls.length === 1, 'downloads and changes nothing');
show(s);

s = scenario('Checksum mismatch', { sums: (t) => t.replace(/^[0-9a-f]{64}(  Winterland-\d+\.\d+\.\d+-(linux|darwin|win32))/m, `${'0'.repeat(64)}$1`) });
check(s.r.status !== 0, 'stops with an error');
check(/checksum/.test(s.output), 'says the checksum did not match');
check(s.gameNow === `game ${OLD}` && s.saveKept && s.leftovers.length === 0, 'game and save unchanged');
show(s);

s = scenario('No download for this computer', { sums: (t) => t.replaceAll(TARGET, 'beos-x64') });
check(s.r.status !== 0, 'stops with an error');
check(s.gameNow === `game ${OLD}` && s.urls.length === 1, 'downloads and changes nothing');
show(s);

s = scenario('Garbage checksum file', { sums: () => '<html>oops</html>\n' });
check(s.r.status !== 0 && s.gameNow === `game ${OLD}`, 'stops and changes nothing');
show(s);

if (OS !== 'darwin') {
  s = scenario('Recovers from an update cut off mid-swap', {
    latest: OLD,
    before: ({ install }) => {
      const old = join(install, '.winterland-update-new', 'old');
      mkdirSync(old, { recursive: true });
      // power cut after resources/ was moved aside but before the new one went in
      const from = join(install, 'resources');
      const to = join(old, 'resources');
      mkdirSync(to, { recursive: true });
      writeFileSync(join(to, 'app.asar'), readFileSync(join(from, 'app.asar')));
      rmSync(from, { recursive: true });
    },
  });
  check(s.r.status === 0 && s.gameNow === `game ${OLD}`, 'puts the old files back');
  check(s.leftovers.length === 0, 'cleans up');
  show(s);
}

// 0.9.10 (F9): a swap cut off half way (a power cut or a killed script) never leaves a half-old, half-new game.
{
  const half = OS === 'darwin' ? '/old.app' : '/old/resources';
  s = scenario('Swap killed half way, then the updater runs again', { cut: { kill: half }, then: 'updater' });
  check(s.mid.status !== 0 && s.mid.oldKept, 'the cut leaves the old files set aside');
  check(s.r.status === 0 && s.gameNow === `game ${NEW}`, 'the next run puts things right and updates');
  check(OS === 'darwin' || s.newFile, 'files new in this version arrive');
  check(s.saveKept && s.notesKept && s.leftovers.length === 0, 'save and other files untouched, nothing left behind');
  show(s);

  if (OS !== 'win32') {
    s = scenario('Swap killed half way, then the game starts', { cut: { kill: half }, then: 'game' });
    check(s.recovered === 'rolled-back', 'the game puts the old version back at start');
    check(s.gameNow === `game ${OLD}` && (OS === 'darwin' || !s.newFile), 'all of the old version, none of the new');
    check(s.saveKept && s.notesKept, 'save and other files untouched');
    check(s.leftovers.every((n) => n === '.winterland-update-lock'), 'only the dead updater lock is left (the next run clears it)');
    show(s);
  }

  s = scenario('In-game update killed half way, then the updater runs again', { inGame: {}, cut: { kill: half }, then: 'updater' });
  check(s.r.status === 0 && s.gameNow === `game ${NEW}` && s.saveKept && s.leftovers.length === 0, 'ends up fully updated, save untouched');
  show(s);
}
if (OS === 'linux') {
  // A file that won't move in, and the old one that won't move back either: the old copy must never be deleted.
  s = scenario('Swap and put-back both fail', { cut: { fail: '(unpacked/[^ ]*/resources|old/resources) ' }, then: 'updater' });
  check(s.mid.status !== 0 && /still in/.test(s.mid.output), 'stops and says where the old files are');
  check(s.mid.oldKept && s.mid.leftovers.includes('.winterland-update-new'), 'keeps the old files set aside');
  check(s.r.status === 0 && s.gameNow === `game ${NEW}` && s.leftovers.length === 0, 'the next run puts them back and updates');
  show(s);
}

// 0.9.8 in-game updates: the app's own copy, with the zip the game downloaded and checked
s = scenario(`In-game update ${OLD} → ${NEW} (${TARGET})`, { inGame: {} });
check(s.r.status === 0, 'exits 0');
check(s.gameNow === `game ${NEW}`, 'game files are the new version');
check(s.saveKept && s.notesKept, 'save and other files untouched');
check(s.leftovers.length === 0, 'no temporary folders left behind');
check(s.urls.length === 1 && s.urls[0] === `${BASE}latest/download/SHA256SUMS.txt`, "re-checks against GitHub's checksum list, downloads nothing else");
check(OS !== 'linux' || s.started === 'started', 'starts the new version');
show(s);

s = scenario('In-game update with a tampered download', { inGame: { tamper: true } });
check(s.r.status !== 0, 'stops with an error');
check(s.gameNow === `game ${OLD}` && s.saveKept && s.leftovers.length === 0, 'game and save unchanged');
check(OS !== 'linux' || s.started === 'started --update-failed=checksum', 'reopens the old game with the reason');
show(s);

s = scenario('In-game update with a zip for another version', { inGame: { zipName: `Winterland-9.9.9-${TARGET}.zip` } });
check(s.r.status !== 0 && s.gameNow === `game ${OLD}`, 'refuses it and changes nothing');
show(s);

// The game takes a while to close after "Update now" (0.9.9): the script waits for it, and when an update stops it
// starts the old game again only once the closing one is gone (a copy started sooner would quit at once, leaving none).
if (OS === 'linux') {
  s = scenario('In-game update while the game is slow to close', { inGame: {}, before: ({ install }) => closingGame(install, 3) });
  check(s.r.status === 0 && s.seconds >= 2.5, 'waits for the game to close');
  check(s.gameNow === `game ${NEW}` && s.saveKept && s.leftovers.length === 0, 'then updates, save untouched');
  check(s.started === 'started', 'starts the new version');
  show(s);

  s = scenario('In-game update that stops while the game is still closing', { latest: OLD, inGame: {}, before: ({ install }) => closingGame(install, 3) });
  check(s.r.status !== 0 && s.gameNow === `game ${OLD}`, 'stops and changes nothing');
  check(s.started === 'started --update-failed=current', 'reopens the old game with the reason once the closing one is gone');
  show(s);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall updater checks passed');
process.exit(failures ? 1 : 0);
