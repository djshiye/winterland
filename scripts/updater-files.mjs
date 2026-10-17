/**
 * The "Update Winterland" files that go into every desktop release zip, filled in with that zip's version and
 * platform. Sources live in desktop/updater/ (update.sh for Linux and macOS, update.ps1 for Windows).
 *
 *   Linux:   Update Winterland.sh        (next to the winterland program)
 *   macOS:   Update Winterland.command   (next to Winterland.app; double-click opens it in Terminal)
 *   Windows: Update Winterland.cmd       (next to Winterland.exe) + updater\update.ps1
 *
 * 0.9.8: `inAppUpdaterFiles` is the same script for the in-game updater (desktop/updater.cjs), placed inside the app's
 * resources folder (resources/updater/update.sh or update.ps1; macOS: Winterland.app/Contents/Resources/updater).
 *
 * The .cmd is a single line on purpose: cmd.exe reads batch files a line at a time, so a one-line file can't be
 * tripped up when the update replaces it while it runs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'desktop', 'updater');

/** @returns {{ path: string, content: string, mode: number }[]} paths relative to the packaged app folder */
export function updaterFiles(platform, arch, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`updater: version must look like 1.2.3, got ${version}`);
  if (!/^[a-z0-9]+$/.test(platform) || !/^[a-z0-9]+$/.test(arch)) throw new Error('updater: bad target');
  const fill = (text) => text.replaceAll('__WL_VERSION__', version).replaceAll('__WL_TARGET__', `${platform}-${arch}`);
  if (platform === 'win32') {
    const ps1 = fill(readFileSync(join(src, 'update.ps1'), 'utf8')).replace(/\r?\n/g, '\r\n');
    const cmd = '@powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0updater\\update.ps1" & exit /b\r\n';
    return [
      { path: 'Update Winterland.cmd', content: cmd, mode: 0o644 },
      { path: 'updater/update.ps1', content: ps1, mode: 0o644 },
    ];
  }
  const sh = fill(readFileSync(join(src, 'update.sh'), 'utf8'));
  const name = platform === 'darwin' ? 'Update Winterland.command' : 'Update Winterland.sh';
  return [{ path: name, content: sh, mode: 0o755 }];
}

/** The in-game updater's copy (paths relative to the app's resources folder; `inApp` marks them). */
export function inAppUpdaterFiles(platform, arch, version) {
  return updaterFiles(platform, arch, version)
    .filter((f) => f.path.endsWith('.ps1') || f.path.endsWith('.sh') || f.path.endsWith('.command'))
    .map((f) => ({ ...f, path: `updater/${platform === 'win32' ? 'update.ps1' : 'update.sh'}`, inApp: true }));
}
