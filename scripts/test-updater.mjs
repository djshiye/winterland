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
 *   node scripts/test-updater.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { updaterFiles } from './updater-files.mjs';

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
      { path: exe, content: OS === 'win32' ? 'MZ' : '#!/bin/sh\nexit 0\n', mode: 0o755 },
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

/** One scenario in a fresh temp folder. `sums` edits SHA256SUMS.txt; `before` can tamper with the install. */
function scenario(title, { latest = NEW, sums = (s) => s, before = () => {} } = {}) {
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

    let r;
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
& $Updater -Yes -NoLaunch -NoPause
exit $LASTEXITCODE
`);
      r = run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness,
        join(install, 'updater', 'update.ps1'), server, log], { env: { ...process.env, APPDATA: join(home, 'AppData', 'Roaming') } });
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
      const script = join(install, OS === 'darwin' ? 'Update Winterland.command' : 'Update Winterland.sh');
      const args = [script, '--yes', '--no-launch'];
      if (OS === 'darwin') args.push('--app', join(install, 'Winterland.app'));
      r = run('/bin/bash', args, {
        env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, WL_UPDATER_IN_TERMINAL: '1', WL_UPDATER_ALLOW_ROOT: '1', TMPDIR: root },
      });
    }
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const asar = OS === 'darwin' ? 'Winterland.app/Contents/Resources/app.asar' : 'resources/app.asar';
    const gameNow = existsSync(join(install, asar)) ? readFileSync(join(install, asar), 'utf8') : '(missing)';
    const leftovers = readdirSync(install).filter((n) => n.startsWith('.winterland-update'));
    const urls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
    return {
      r,
      output,
      gameNow,
      leftovers,
      urls,
      notesKept: existsSync(join(install, 'my-notes.txt')),
      saveKept: readFileSync(join(saveDir, 'Local Storage', 'leveldb', '000003.log'), 'utf8') === 'my precious save',
      newFile: existsSync(join(install, 'locales', 'en.pak')),
      updaterNow: readFileSync(join(install, updaterFiles(OS, ARCH, OLD).at(-1).path), 'utf8'),
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

console.log(failures ? `\n${failures} check(s) failed` : '\nall updater checks passed');
process.exit(failures ? 1 : 0);
