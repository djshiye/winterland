#!/usr/bin/env node
/**
 * Desktop builds: bundles the game (vite build → dist/), wraps it in Electron (desktop/main.cjs) and zips one
 * portable folder per target into release/. Unzip and run — no installer, no admin rights.
 *
 *   node scripts/package-desktop.mjs                 # linux-x64, linux-arm64, win32-x64
 *   node scripts/package-desktop.mjs darwin-arm64              # macOS (Apple chips; Intel Macs are not supported from 0.9.11)
 *   node scripts/package-desktop.mjs win32-x64       # just one (any of the above, or e.g. linux-armv7l)
 *
 * Works from any host OS: Electron binaries for the other platforms are downloaded (and cached) on first use, and
 * the Windows .exe metadata is written without Wine. macOS apps are ad-hoc signed and zipped with `ditto`, which needs
 * a Mac (the release workflow uses a macOS runner); packaging darwin elsewhere still works but skips the signing.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { FuseState, flipFuses, getCurrentFuseWire } from '@electron/fuses';
import { electronBinary, fuseConfig } from './fuses.mjs';
import { inAppUpdaterFiles, updaterFiles } from './updater-files.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['linux-x64', 'linux-arm64', 'win32-x64'];
const out = join(root, 'release');
// 0.9.11 (Dino): Macs are supported on Apple chips only, and the updater knows no Intel Mac download
if (targets.includes('darwin-x64')) {
  console.error('darwin-x64 is not built any more: Macs are supported on Apple chips only (darwin-arm64).');
  process.exit(1);
}

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

console.log('› building the game (dist/)');
run('npm', ['run', 'build']);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Only these go into the app: the shell, the built game and package.json (everything is already bundled). The updater
// sits next to the app instead (below), not inside it.
const keep = (p) =>
  p === '' ||
  p === '/package.json' ||
  (p.startsWith('/desktop') && p !== '/desktop/updater' && !p.startsWith('/desktop/updater/')) ||
  p.startsWith('/dist');

for (const target of targets) {
  const [platform, arch] = target.split('-');
  console.log(`› packaging ${platform} ${arch}`);
  const [dir] = await packager({
    dir: root,
    out,
    name: 'Winterland',
    executableName: platform === 'win32' ? 'Winterland' : 'winterland',
    appVersion: pkg.version,
    electronVersion,
    platform,
    arch,
    overwrite: true,
    asar: true,
    prune: false,
    ignore: (p) => !keep(p.replace(/\\/g, '/')),
    win32metadata: { CompanyName: 'Winterland', ProductName: 'Winterland', FileDescription: 'Winterland' },
  });
  // Lock the Electron binary down (scripts/fuses.mjs) before it is signed and zipped, then read the fuses back.
  const executableName = platform === 'win32' ? 'Winterland' : 'winterland';
  const bin = electronBinary(dir, platform, executableName);
  await flipFuses(bin, fuseConfig(platform));
  const wire = await getCurrentFuseWire(bin);
  for (const [fuse, want] of Object.entries(fuseConfig(platform))) {
    if (!/^\d+$/.test(fuse)) continue;
    if ((wire[fuse] === FuseState.ENABLE) !== want) throw new Error(`fuse ${fuse} on ${target} did not flip to ${want}`);
  }
  // "Update Winterland" (desktop/updater): click it to get the newest release from GitHub. 0.9.8: a second copy goes
  // into the app's resources, where the in-game updater (desktop/updater.cjs) finds it wherever the app was moved.
  const resources = platform === 'darwin' ? join(dir, 'Winterland.app', 'Contents', 'Resources') : join(dir, 'resources');
  for (const f of [...updaterFiles(platform, arch, pkg.version), ...inAppUpdaterFiles(platform, arch, pkg.version)]) {
    const file = f.inApp ? join(resources, f.path) : join(dir, f.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, f.content);
    chmodSync(file, f.mode);
  }
  const zip = join(out, `Winterland-${pkg.version}-${platform}-${arch}.zip`);
  if (platform === 'darwin' && process.platform === 'darwin') {
    // No paid Apple certificate: an ad-hoc signature keeps Apple silicon happy ("unidentified developer" instead of
    // "damaged"). ditto keeps the bundle's symlinks and metadata intact. The zip holds the whole folder, so the
    // updater comes along next to Winterland.app.
    const appPath = join(dir, 'Winterland.app');
    run('codesign', ['--force', '--deep', '--sign', '-', appPath]);
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', dir, zip]);
  } else if (process.platform === 'win32') {
    run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${dir}' -DestinationPath '${zip}' -Force`]);
  } else {
    // zip keeps the executable bit for Linux; Windows reads the same archive fine.
    run('zip', ['-qry', zip, dir.split('/').pop()], { cwd: out });
  }
  console.log(`  ${existsSync(zip) ? zip : dir}`);
}
console.log('done');
