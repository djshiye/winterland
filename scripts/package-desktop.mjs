#!/usr/bin/env node
/**
 * Desktop builds: bundles the game (vite build → dist/), wraps it in Electron (desktop/main.cjs) and zips one
 * portable folder per target into release/. Unzip and run — no installer, no admin rights.
 *
 *   node scripts/package-desktop.mjs                 # linux-x64, linux-arm64, win32-x64
 *   node scripts/package-desktop.mjs darwin-arm64 darwin-x64   # macOS (Apple silicon, Intel)
 *   node scripts/package-desktop.mjs win32-x64       # just one (any of the above, or e.g. linux-armv7l)
 *
 * Works from any host OS: Electron binaries for the other platforms are downloaded (and cached) on first use, and
 * the Windows .exe metadata is written without Wine. macOS apps are ad-hoc signed and zipped with `ditto`, which needs
 * a Mac (the release workflow uses a macOS runner); packaging darwin elsewhere still works but skips the signing.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['linux-x64', 'linux-arm64', 'win32-x64'];
const out = join(root, 'release');

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

console.log('› building the game (dist/)');
run('npm', ['run', 'build']);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Only these go into the app: the shell, the built game and package.json (everything is already bundled).
const keep = (p) => p === '' || p === '/package.json' || p.startsWith('/desktop') || p.startsWith('/dist');

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
  const zip = join(out, `Winterland-${pkg.version}-${platform}-${arch}.zip`);
  if (platform === 'darwin' && process.platform === 'darwin') {
    // No paid Apple certificate: an ad-hoc signature keeps Apple silicon happy ("unidentified developer" instead of
    // "damaged"). ditto keeps the bundle's symlinks and metadata intact.
    const appPath = join(dir, 'Winterland.app');
    run('codesign', ['--force', '--deep', '--sign', '-', appPath]);
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zip]);
  } else if (process.platform === 'win32') {
    run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${dir}' -DestinationPath '${zip}' -Force`]);
  } else {
    // zip keeps the executable bit for Linux; Windows reads the same archive fine.
    run('zip', ['-qry', zip, dir.split('/').pop()], { cwd: out });
  }
  console.log(`  ${existsSync(zip) ? zip : dir}`);
}
console.log('done');
