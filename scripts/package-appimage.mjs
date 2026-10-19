#!/usr/bin/env node
/**
 * 0.9.10 (Linux): turns the packaged Linux folders (release/Winterland-linux-<arch>/, from scripts/package-desktop.mjs)
 * into AppImages: one file to download, double-click (after ticking "allow executing"), or hand to Gear Lever.
 *
 *   node scripts/package-appimage.mjs <runtime-folder> [linux-x64 linux-arm64]
 *     → release/Winterland-<version>-x86_64.AppImage (+ .zsync), Winterland-<version>-aarch64.AppImage (+ .zsync)
 *
 * <runtime-folder> holds the AppImage starter programs runtime-x86_64 / runtime-aarch64 from
 * github.com/AppImage/type2-runtime release 20251108 (static: no libfuse2 needed, so Ubuntu 22.04+ runs it as is).
 * Each must match the SHA-256 pinned below, or nothing is built. Needs mksquashfs (squashfs-tools) and zsyncmake (zsync).
 *
 * An AppImage is that starter followed by a squashfs image of the game folder plus:
 *   AppRun                 starts the game, after desktop/linux/sandbox-setup.sh checks Ubuntu lets its sandbox run
 *   winterland.desktop     name, icon and category for menus (Gear Lever reads it)
 *   winterland.png         the icon (scripts/appimage/winterland.png); .DirIcon points at it
 * The starter's .upd_info section names where updates come from (gh-releases-zsync, the AppImage standard), so Gear
 * Lever and other AppImage tools can update it from GitHub; the game's own updater (desktop/updater.cjs) replaces the
 * file in place too, byte for byte the release's file, so both agree on what is installed.
 * "Update Winterland.sh" stays out (the mount is read-only; the in-game updater has its own copy in resources/).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const out = join(root, 'release');
const [runtimeDir, ...rest] = process.argv.slice(2);
const targets = rest.length ? rest : ['linux-x64', 'linux-arm64'];

/** AppImage/type2-runtime release 20251108: the starter for each architecture and its SHA-256. */
const RUNTIMES = {
  'linux-x64': { arch: 'x86_64', file: 'runtime-x86_64', sha: '2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d' },
  'linux-arm64': { arch: 'aarch64', file: 'runtime-aarch64', sha: '00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444' },
};

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) fail(`${cmd} failed`);
};

if (!runtimeDir) fail('usage: node scripts/package-appimage.mjs <runtime-folder> [linux-x64 linux-arm64]');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) fail(`version must look like 1.2.3, got ${pkg.version}`);

/** The update information Gear Lever and AppImageUpdate read: the newest release's .zsync for this architecture. */
const updateInfo = (arch) => `gh-releases-zsync|djshiye|winterland|latest|Winterland-*-${arch}.AppImage.zsync`;

/**
 * Writes `text` into the starter's (ELF64, little-endian) .upd_info section, which is there empty for exactly this.
 * Also checks the file ends where its section headers end, which is where the starter looks for the squashfs image.
 */
function embedUpdateInfo(elf, text) {
  if (elf.readUInt32BE(0) !== 0x7f454c46 || elf[4] !== 2 || elf[5] !== 1) fail('runtime is not a little-endian ELF64 program');
  const shoff = Number(elf.readBigUInt64LE(0x28));
  const shentsize = elf.readUInt16LE(0x3a);
  const shnum = elf.readUInt16LE(0x3c);
  const shstrndx = elf.readUInt16LE(0x3e);
  if (shoff + shentsize * shnum !== elf.length) fail('runtime has data after its section headers');
  const section = (i) => {
    const at = shoff + i * shentsize;
    return { name: elf.readUInt32LE(at), offset: Number(elf.readBigUInt64LE(at + 0x18)), size: Number(elf.readBigUInt64LE(at + 0x20)) };
  };
  const names = section(shstrndx);
  for (let i = 0; i < shnum; i++) {
    const s = section(i);
    const start = names.offset + s.name;
    const name = elf.toString('latin1', start, elf.indexOf(0, start));
    if (name !== '.upd_info') continue;
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length >= s.size) fail('update information is too long');
    elf.fill(0, s.offset, s.offset + s.size);
    bytes.copy(elf, s.offset);
    return;
  }
  fail('runtime has no .upd_info section');
}

const desktopEntry = `[Desktop Entry]
Type=Application
Name=Winterland
Comment=A cozy little winter town, built one pad at a time
Exec=winterland
Icon=winterland
Terminal=false
Categories=Game;Simulation;
StartupWMClass=Winterland
X-AppImage-Version=${pkg.version}
`;

const appRun = `#!/bin/sh
# Winterland's AppImage starter (scripts/package-appimage.mjs). On Ubuntu 23.10+ the sandbox check may ask, once, to
# let Winterland use Chromium's sandbox; it never turns the sandbox off.
HERE="$(dirname "$(readlink -f "$0")")"
"$HERE/sandbox-setup.sh" --appimage --ask || exit 1
exec "$HERE/winterland" "$@"
`;

for (const target of targets) {
  const rt = RUNTIMES[target] ?? fail(`no AppImage for ${target}`);
  const folder = join(out, `Winterland-${target}`);
  if (!existsSync(join(folder, 'winterland'))) fail(`${folder} is missing: run scripts/package-desktop.mjs ${target} first`);
  const runtime = readFileSync(join(runtimeDir, rt.file));
  const got = createHash('sha256').update(runtime).digest('hex');
  if (got !== rt.sha) fail(`${rt.file}: SHA-256 ${got} is not the pinned ${rt.sha}`);
  embedUpdateInfo(runtime, updateInfo(rt.arch));

  console.log(`› AppImage ${rt.arch}`);
  const appDir = join(out, `appdir-${rt.arch}`);
  rmSync(appDir, { recursive: true, force: true });
  cpSync(folder, appDir, { recursive: true, verbatimSymlinks: true });
  rmSync(join(appDir, 'Update Winterland.sh'), { force: true });
  rmSync(join(appDir, 'Set up for Ubuntu.sh'), { force: true });
  writeFileSync(join(appDir, 'AppRun'), appRun, { mode: 0o755 });
  copyFileSync(join(root, 'desktop', 'linux', 'sandbox-setup.sh'), join(appDir, 'sandbox-setup.sh'));
  chmodSync(join(appDir, 'sandbox-setup.sh'), 0o755);
  writeFileSync(join(appDir, 'winterland.desktop'), desktopEntry, { mode: 0o644 });
  copyFileSync(join(root, 'scripts', 'appimage', 'winterland.png'), join(appDir, 'winterland.png'));
  symlinkSync('winterland.png', join(appDir, '.DirIcon'));

  const name = `Winterland-${pkg.version}-${rt.arch}.AppImage`;
  const image = join(out, `${name}.squashfs`);
  rmSync(image, { force: true });
  // root-owned, fixed times: the same input always gives the same image
  run('mksquashfs', [appDir, image, '-root-owned', '-noappend', '-comp', 'zstd', '-Xcompression-level', '19', '-all-time', '0', '-mkfs-time', '0', '-quiet']);
  const file = join(out, name);
  writeFileSync(file, Buffer.concat([runtime, readFileSync(image)]), { mode: 0o755 });
  chmodSync(file, 0o755);
  rmSync(image);
  rmSync(appDir, { recursive: true, force: true });
  rmSync(`${file}.zsync`, { force: true });
  run('zsyncmake', ['-u', name, '-o', `${name}.zsync`, name], { cwd: out });
  console.log(`  ${file}`);
}
console.log('done');
