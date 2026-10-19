/**
 * 0.9.8 in-game updater: the GitHub trust rules (desktop/update-core.cjs), the changelog and which entries a player
 * sees (core/changelog.ts), the updater settings (core/updatePrefs.ts), scrolling the notes box with arrows / D-pad,
 * Esc order, and the wiring that keeps the game page offline and the release shipping its notes.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changelogStart, entriesBetween, inlineRuns, parseChangelog } from '../src/core/changelog';
import { parseUpdatePrefs } from '../src/core/updatePrefs';
import { scrollStep } from '../src/input/menuNav';
import { escapeTarget } from '../src/ui/escapeOrder';
import { FAIL_TEXT } from '../src/ui/UpdateCard';

const require = createRequire(import.meta.url);
const core = require('../desktop/update-core.cjs') as {
  FAIL_CODES: string[];
  SUMS_URL: string;
  PAGE_URL: string;
  allowedUrl(url: string): boolean;
  assetUrl(version: string, name: string): string;
  failCodeFromArgv(argv: unknown): string | null;
  installCommand(o: Record<string, string | undefined>): { cmd: string; args: string[] };
  isNewer(a: unknown, b: unknown): boolean;
  parseSums(text: unknown, target: string, o?: { appImage?: boolean }): { version: string; zipName: string; sha: string; notesSha: string | null } | null;
  isAppImageHead(head: Uint8Array | null): boolean;
  targetOf(platform: string, arch: string): string | null;
};
const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

describe('only GitHub, only HTTPS', () => {
  it('allows the repo release paths and GitHub release storage', () => {
    expect(core.allowedUrl(core.SUMS_URL)).toBe(true);
    expect(core.allowedUrl('https://github.com/djshiye/winterland/releases/download/v0.9.8/Winterland-0.9.8-linux-x64.zip')).toBe(true);
    expect(core.allowedUrl('https://objects.githubusercontent.com/github-production-release-asset/1?X-Amz=1')).toBe(true);
    expect(core.allowedUrl('https://release-assets.githubusercontent.com/github-production-release-asset/1')).toBe(true);
  });

  it('refuses everything else', () => {
    for (const url of [
      'http://github.com/djshiye/winterland/releases/latest/download/SHA256SUMS.txt',
      'https://github.com/someone/else/releases/latest/download/SHA256SUMS.txt',
      'https://github.com/djshiye/winterland/archive/main.zip',
      'https://github.com.evil.com/djshiye/winterland/releases/x',
      'https://evil.com/objects.githubusercontent.com/x',
      'https://user:pw@github.com/djshiye/winterland/releases/x',
      'https://github.com:8443/djshiye/winterland/releases/x',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a url',
    ])
      expect(core.allowedUrl(url), url).toBe(false);
  });

  it('builds release URLs from the exact tag and refuses odd names', () => {
    expect(core.assetUrl('0.9.8', 'RELEASE-NOTES.md')).toBe('https://github.com/djshiye/winterland/releases/download/v0.9.8/RELEASE-NOTES.md');
    expect(() => core.assetUrl('0.9.8.1', 'x.zip')).toThrow();
    expect(() => core.assetUrl('0.9.8', '../x')).toThrow();
    expect(core.PAGE_URL.startsWith('https://github.com/djshiye/winterland/releases/')).toBe(true);
  });
});

describe('SHA256SUMS.txt', () => {
  const sums = [`${A}  Winterland-0.9.8-linux-x64.zip`, `${B}  Winterland-0.9.8-win32-x64.zip`, `${C}  RELEASE-NOTES.md`].join('\n');

  it('picks the one zip for this computer and the notes', () => {
    expect(core.parseSums(sums, 'linux-x64')).toEqual({ version: '0.9.8', zipName: 'Winterland-0.9.8-linux-x64.zip', sha: A, notesSha: C });
    expect(core.parseSums(sums.replace(/\n/g, '\r\n'), 'win32-x64')?.sha).toBe(B);
    expect(core.parseSums(sums.split('\n').slice(0, 2).join('\n'), 'linux-x64')?.notesSha).toBeNull();
  });

  it('refuses a missing, doubled, mixed-version or malformed list', () => {
    expect(core.parseSums(sums, 'darwin-arm64')).toBeNull();
    expect(core.parseSums(`${sums}\n${C}  Winterland-0.9.8-linux-x64.zip`, 'linux-x64')).toBeNull();
    expect(core.parseSums(`${sums}\n${C}  Winterland-0.9.9-darwin-x64.zip`, 'linux-x64')).toBeNull();
    expect(core.parseSums(`${A.toUpperCase()}  Winterland-0.9.8-linux-x64.zip`, 'linux-x64')).toBeNull();
    expect(core.parseSums(`${A} Winterland-0.9.8-linux-x64.zip`, 'linux-x64')).toBeNull();
    expect(core.parseSums(`${A}  Winterland-0.9.8.1-linux-x64.zip`, 'linux-x64')).toBeNull();
    expect(core.parseSums('<html>oops</html>', 'linux-x64')).toBeNull();
    expect(core.parseSums(null, 'linux-x64')).toBeNull();
    expect(core.parseSums(sums, 'beos-x64')).toBeNull();
  });

  it('0.9.11: an AppImage copy picks its AppImage line; zip copies (and older games) ignore those lines', () => {
    const withImages = `${sums}\n${C}  Winterland-0.9.8-x86_64.AppImage\n${B}  Winterland-0.9.8-aarch64.AppImage`;
    expect(core.parseSums(withImages, 'linux-x64')?.zipName).toBe('Winterland-0.9.8-linux-x64.zip');
    expect(core.parseSums(withImages, 'linux-x64', { appImage: true })).toEqual({ version: '0.9.8', zipName: 'Winterland-0.9.8-x86_64.AppImage', sha: C, notesSha: C });
    expect(core.parseSums(withImages, 'linux-arm64', { appImage: true })?.sha).toBe(B);
    // no AppImage in the release, two for one computer, another version than the zips, or not Linux: refused
    expect(core.parseSums(sums, 'linux-x64', { appImage: true })).toBeNull();
    expect(core.parseSums(`${withImages}\n${A}  Winterland-0.9.8-x86_64.AppImage`, 'linux-x64', { appImage: true })).toBeNull();
    expect(core.parseSums(`${sums}\n${C}  Winterland-0.9.9-x86_64.AppImage`, 'linux-x64', { appImage: true })).toBeNull();
    expect(core.parseSums(`${sums}\n${C}  Winterland-0.9.8-x86_64.appimage`, 'linux-x64', { appImage: true })).toBeNull();
    expect(core.parseSums(withImages, 'win32-x64', { appImage: true })).toBeNull();
  });

  it('only a file that starts like an AppImage (ELF, "AI" 2) is ever replaced', () => {
    const head = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 0x02, 0, 0, 0, 0, 0]);
    expect(core.isAppImageHead(head)).toBe(true);
    expect(core.isAppImageHead(Uint8Array.from([...head.slice(0, 10), 0x01]))).toBe(false); // type 1
    expect(core.isAppImageHead(Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0]))).toBe(false); // plain program
    expect(core.isAppImageHead(new TextEncoder().encode('#!/bin/sh\necho hi\n'))).toBe(false);
    expect(core.isAppImageHead(null)).toBe(false);
  });

  it('compares 3-part versions only', () => {
    expect(core.isNewer('0.9.10', '0.9.9')).toBe(true);
    expect(core.isNewer('0.9.8', '0.9.8')).toBe(false);
    expect(core.isNewer('1.0.0', '0.9.99')).toBe(true);
    expect(core.isNewer('0.9.8.1', '0.9.8')).toBe(false);
  });

  it('knows the computers the releases ship for', () => {
    expect(core.targetOf('linux', 'arm64')).toBe('linux-arm64');
    expect(core.targetOf('darwin', 'x64')).toBeNull(); // 0.9.11: Macs on Apple chips only
    expect(core.targetOf('win32', 'ia32')).toBeNull();
  });
});

describe('handing over to the updater script', () => {
  it('runs bash or Windows PowerShell by full path, with the zip and the game folder, no shell', () => {
    const linux = core.installCommand({ platform: 'linux', script: '/tmp/w/update.sh', zip: '/tmp/w/Winterland-0.9.8-linux-x64.zip', install: '/home/me/Winterland' });
    expect(linux).toEqual({ cmd: '/bin/bash', args: ['/tmp/w/update.sh', '--from-game', '--install', '/home/me/Winterland', '--zip', '/tmp/w/Winterland-0.9.8-linux-x64.zip'] });
    const mac = core.installCommand({ platform: 'darwin', script: '/t/update.sh', zip: '/t/z.zip', app: '/Applications/Winterland.app' });
    expect(mac.args).toEqual(['/t/update.sh', '--from-game', '--app', '/Applications/Winterland.app', '--zip', '/t/z.zip']);
    const image = core.installCommand({ platform: 'linux', script: '/t/update.sh', zip: '/t/W.AppImage', install: '/home/me/AppImages', appImage: '/home/me/AppImages/winterland.appimage' });
    expect(image.args).toEqual(['/t/update.sh', '--from-game', '--appimage', '/home/me/AppImages/winterland.appimage', '--zip', '/t/W.AppImage']);
    const win = core.installCommand({ platform: 'win32', script: 'C:\\t\\update.ps1', zip: 'C:\\t\\z.zip', install: 'C:\\Games\\Winterland', systemRoot: 'D:\\Windows' });
    expect(win.cmd).toBe('D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(win.args).toContain('-FromGame');
    expect(win.args.slice(-4)).toEqual(['-Install', 'C:\\Games\\Winterland', '-Zip', 'C:\\t\\z.zip']);
    // a SystemRoot that isn't a plain drive path is never used to pick the program
    expect(core.installCommand({ platform: 'win32', script: 's', zip: 'z', install: 'i', systemRoot: '\\\\evil\\share' }).cmd).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });

  it('reads why an update stopped from the relaunch argument', () => {
    expect(core.failCodeFromArgv(['winterland', '--update-failed=checksum'])).toBe('checksum');
    expect(core.failCodeFromArgv(['winterland', '--update-failed=weird'])).toBe('other');
    expect(core.failCodeFromArgv(['winterland', '--update-failed=<b>'])).toBeNull();
    expect(core.failCodeFromArgv(['winterland'])).toBeNull();
    expect(core.failCodeFromArgv(undefined)).toBeNull();
  });

  it('words every reason for the player', () => {
    for (const code of core.FAIL_CODES) expect(FAIL_TEXT[code as keyof typeof FAIL_TEXT], code).toBeTruthy();
  });

  it('the scripts know the in-game mode and the reasons it reports', () => {
    const sh = read('desktop/updater/update.sh');
    const ps = read('desktop/updater/update.ps1');
    for (const flag of ['--from-game', '--zip', '--install']) expect(sh).toContain(flag);
    for (const flag of ['FromGame', '$Zip', '$Install']) expect(ps).toContain(flag);
    for (const text of [sh, ps]) {
      const steps = [...text.matchAll(/STEP=([a-z]+)|\$script:Step = '([a-z]+)'/g)].map((m) => m[1] ?? m[2]);
      expect(steps.length).toBeGreaterThan(5);
      for (const s of steps) expect(core.FAIL_CODES, s).toContain(s);
    }
    // the update script on Windows stays plain ASCII (Windows PowerShell 5.1 reads it as the system code page)
    expect(/^[\x00-\x7f]*$/.test(ps)).toBe(true);
  });
});

describe('the changelog', () => {
  const text = `# Changelog

Intro text that is not a release.

## Unreleased

- not shown

## 0.9.8 (2026-10-18)

The look release.

### New

- **Bold** item with *italics* and \`code\`
  that wraps onto a second line
- Second item

## 0.9.7 (2026-10-17)

- Old item

## 0.9.6

Para one
continues here.
`;

  it('reads releases, sections, items and wrapped lines, and skips the rest', () => {
    const e = parseChangelog(text);
    expect(e.map((x) => x.version)).toEqual(['0.9.8', '0.9.7', '0.9.6']);
    expect(e[0]!.date).toBe('2026-10-18');
    expect(e[0]!.blocks).toEqual([
      { kind: 'p', text: 'The look release.' },
      { kind: 'h', text: 'New' },
      { kind: 'li', text: '**Bold** item with *italics* and `code` that wraps onto a second line' },
      { kind: 'li', text: 'Second item' },
    ]);
    expect(e[2]!.date).toBe('');
    expect(e[2]!.blocks).toEqual([{ kind: 'p', text: 'Para one continues here.' }]);
    expect(parseChangelog('')).toEqual([]);
  });

  it('lists the releases since the one the player had, newest first', () => {
    const e = parseChangelog(text);
    expect(entriesBetween(e, '0.9.6', '0.9.8').map((x) => x.version)).toEqual(['0.9.8', '0.9.7']);
    expect(entriesBetween(e, '0.9.7', '0.9.7')).toEqual([]);
    expect(entriesBetween(e, null, '0.9.7').map((x) => x.version)).toEqual(['0.9.7']);
    expect(entriesBetween(e, '0.9.5', '0.9.7').map((x) => x.version)).toEqual(['0.9.7', '0.9.6']);
  });

  it('shows after an update, never to a new player, never twice', () => {
    expect(changelogStart('0.9.7', null, true, '0.9.8')).toEqual({ show: true, from: '0.9.7' });
    expect(changelogStart('0.9.8', '0.9.7', true, '0.9.8')).toEqual({ show: false });
    expect(changelogStart('0.9.9', null, true, '0.9.8')).toEqual({ show: false }); // went back a version
    expect(changelogStart(null, null, false, '0.9.8')).toEqual({ show: false });
    // a save from before the seen-version key: the version that wrote it, else just this version
    expect(changelogStart(null, '0.9.6', true, '0.9.8')).toEqual({ show: true, from: '0.9.6' });
    expect(changelogStart(null, '0.9.8', true, '0.9.8')).toEqual({ show: false });
    expect(changelogStart(null, null, true, '0.9.8')).toEqual({ show: true, from: null });
    expect(changelogStart('junk', 'junk', true, '0.9.8')).toEqual({ show: true, from: null });
  });

  it('splits bold, italic and code, leaving stray markers as text', () => {
    expect(inlineRuns('a **b** *c* `d` e*')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', em: true },
      { text: ' ' },
      { text: 'd', code: true },
      { text: ' e*' },
    ]);
    expect(inlineRuns('<img src=x onerror=alert(1)>')).toEqual([{ text: '<img src=x onerror=alert(1)>' }]);
  });

  it('CHANGELOG.md has an entry for this version, newest first, and covers 0.9.1 onwards', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    const e = parseChangelog(read('CHANGELOG.md'));
    expect(e[0]?.version).toBe(pkg.version);
    for (let i = 1; i < e.length; i++) expect(core.isNewer(e[i - 1]!.version, e[i]!.version)).toBe(true);
    for (const v of ['0.9.1', '0.9.2', '0.9.3', '0.9.4', '0.9.5', '0.9.6', '0.9.7']) expect(e.some((x) => x.version === v && x.blocks.length > 0), v).toBe(true);
  });
});

describe('updater settings', () => {
  it('checks by default, remembers a skipped version, ignores junk', () => {
    expect(parseUpdatePrefs(null)).toEqual({ auto: true, skipped: null });
    expect(parseUpdatePrefs('{"auto":false,"skipped":"0.9.9"}')).toEqual({ auto: false, skipped: '0.9.9' });
    expect(parseUpdatePrefs('{"auto":"no","skipped":"<x>"}')).toEqual({ auto: true, skipped: null });
    expect(parseUpdatePrefs('not json')).toEqual({ auto: true, skipped: null });
    expect(parseUpdatePrefs('[1]')).toEqual({ auto: true, skipped: null });
  });
});

describe('keyboard and gamepad', () => {
  it('Up / Down scroll a focused notes box, then let the focus move on at its ends', () => {
    expect(scrollStep(0, 1000, 300, 'down')).toBe(180);
    expect(scrollStep(650, 1000, 300, 'down')).toBe(50);
    expect(scrollStep(700, 1000, 300, 'down')).toBe(0);
    expect(scrollStep(0, 1000, 300, 'up')).toBe(0);
    expect(scrollStep(100, 1000, 300, 'up')).toBe(-100);
    expect(scrollStep(0, 200, 300, 'down')).toBe(0); // fits: nothing to scroll
  });

  it('Esc / B closes the update card before anything else', () => {
    expect(escapeTarget({ update: true, finale: true, settings: true })).toBe('update');
  });
});

describe('wiring', () => {
  const main = read('desktop/main.cjs');
  const updater = read('desktop/updater.cjs');
  const preload = read('desktop/preload.cjs');

  it('the game page stays offline: only the main process talks to GitHub', () => {
    const w = require('../desktop/window-options.cjs') as { CSP: string };
    expect(w.CSP).toContain("connect-src 'self' data: blob:");
    expect(main).toContain('registerUpdater()');
    expect(preload).toContain("ipcRenderer.invoke('update:check')");
  });

  it('checks every hop, sends no cookies, verifies before installing and never runs a shell', () => {
    expect(updater).toContain("redirect: 'manual'");
    expect(updater).toMatch(/hops > 5 \|\| !core\.allowedUrl\(redirectUrl\)/);
    expect(updater).toContain("credentials: 'omit'");
    expect(updater).toContain("if (hash.digest('hex') !== release.sha) throw new UpdateError('checksum')");
    expect(updater).toContain('shell: false');
    expect(updater).toContain('app.isPackaged');
    expect(updater.match(/fromGame\(event\)/g)?.length).toBeGreaterThanOrEqual(6);
    expect(updater).not.toMatch(/getPath\(|localStorage\.|\bsudo\b|runas/i);
  });

  it('every release ships its notes, listed in SHA256SUMS.txt, and the app carries its own updater copy', () => {
    const yml = read('.github/workflows/release.yml');
    expect(yml).toContain('RELEASE-NOTES.md');
    expect(yml).toMatch(/sha256sum -- \*\.zip \*\.AppImage \$\{extra\[@\]\+RELEASE-NOTES\.md\} > SHA256SUMS\.txt/);
    const pack = read('scripts/package-desktop.mjs');
    expect(pack).toContain('inAppUpdaterFiles');
    expect(pack).toContain("p !== '/desktop/updater'");
  });
});
