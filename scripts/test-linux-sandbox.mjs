#!/usr/bin/env node
/**
 * Tests desktop/linux/sandbox-setup.sh (Ubuntu 23.10+: let Winterland use Chromium's sandbox) on Linux, against a
 * pretend system in a temp folder: WL_SANDBOX_TEST_ROOT points its /proc switch and /etc/apparmor.d there, and
 * stand-in zenity answers its question. No root, nothing outside the temp folder is touched.
 *
 *   node scripts/test-linux-sandbox.mjs
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux') {
  console.log('Linux only: skipped');
  process.exit(0);
}
const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'desktop', 'linux', 'sandbox-setup.sh');
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures++;
};

/** One run. `restrict`: the /proc switch ('1', '0' or null = missing); `answer`: zenity's reply (0 yes, 1 no). */
function scenario(title, { restrict = '1', answer = 0, appimage = false, folderName = 'Winterland-linux-x64', before = () => {}, args = [] } = {}) {
  console.log(`\n${title}`);
  const root = mkdtempSync(join(tmpdir(), 'wl-sandbox-test-'));
  try {
    const sys = join(root, 'sys');
    if (restrict !== null) {
      mkdirSync(join(sys, 'proc', 'sys', 'kernel'), { recursive: true });
      writeFileSync(join(sys, 'proc', 'sys', 'kernel', 'apparmor_restrict_unprivileged_userns'), `${restrict}\n`);
    }
    mkdirSync(join(sys, 'etc', 'apparmor.d', 'abi'), { recursive: true });
    writeFileSync(join(sys, 'etc', 'apparmor.d', 'abi', '4.0'), '');
    const game = join(root, folderName);
    mkdirSync(game, { recursive: true });
    writeFileSync(join(game, 'winterland'), '#!/bin/sh\n');
    chmodSync(join(game, 'winterland'), 0o755);
    const copy = join(game, appimage ? 'sandbox-setup.sh' : 'Set up for Ubuntu.sh');
    copyFileSync(script, copy);
    chmodSync(copy, 0o755);
    const bin = join(root, 'bin');
    const log = join(root, 'asked.log');
    mkdirSync(bin);
    writeFileSync(join(bin, 'zenity'), `#!/bin/sh\necho "$*" >> '${log}'\ncase "$*" in *--question*) exit ${answer} ;; esac\nexit 0\n`);
    chmodSync(join(bin, 'zenity'), 0o755);
    before({ game, sys });
    const r = spawnSync('/bin/bash', [copy, ...(appimage ? ['--appimage', '--ask'] : ['--ask']), ...args], {
      encoding: 'utf8',
      env: { ...process.env, WL_SANDBOX_TEST_ROOT: sys, PATH: `${bin}:${process.env.PATH}`, DISPLAY: ':0', TMPDIR: root },
    });
    const profile = join(sys, 'etc', 'apparmor.d', appimage ? 'winterland-appimage' : 'winterland');
    return {
      status: r.status,
      output: `${r.stdout}${r.stderr}`,
      asked: existsSync(log) ? readFileSync(log, 'utf8') : '',
      profile: existsSync(profile) ? readFileSync(profile, 'utf8') : null,
      game,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

let s = scenario('Not Ubuntu (no AppArmor switch)', { restrict: null });
check(s.status === 0 && s.asked === '' && s.profile === null, 'starts, asks nothing, changes nothing');

s = scenario('Ubuntu with the switch off', { restrict: '0' });
check(s.status === 0 && s.asked === '' && s.profile === null, 'starts, asks nothing, changes nothing');

s = scenario('Ubuntu 24.04, zip, player allows it');
check(s.status === 0, 'the game can start');
check(/--question/.test(s.asked) && /Allow Winterland/.test(s.asked), 'asked once, in a window');
check(s.profile?.includes(`profile winterland "${s.game}/winterland" flags=(unconfined) {`), 'profile for exactly this game');
check(/^\s*userns,$/m.test(s.profile ?? '') && !/\b(capability|file|network|mount)\b/.test(s.profile?.replace(/^#.*$/gm, '') ?? ''), 'it allows the sandbox and nothing else');
check(s.profile?.includes('abi <abi/4.0>,'), 'uses the AppArmor 4 rules where present');

s = scenario('Ubuntu 24.04, zip, player says not now', { answer: 1 });
check(s.status === 1, 'the game does not start');
check(s.profile === null, 'nothing is changed');
check(/--info/.test(s.asked) && /can't start/.test(s.asked), 'explains why, in a window');

s = scenario('Ubuntu 24.04, AppImage, player allows it', { appimage: true });
check(s.status === 0 && s.profile?.includes('profile winterland-appimage "/tmp/.mount_*/winterland" flags=(unconfined) {'), 'profile for the AppImage mount');

s = scenario('Already set up', {
  before: ({ game, sys }) =>
    writeFileSync(join(sys, 'etc', 'apparmor.d', 'winterland'), `profile winterland "${game}/winterland" flags=(unconfined) {\n  userns,\n}\n`),
});
check(s.status === 0 && s.asked === '', 'starts without asking');

s = scenario('Set up for a folder that has moved since', {
  before: ({ sys }) => writeFileSync(join(sys, 'etc', 'apparmor.d', 'winterland'), 'profile winterland "/old/place/winterland" flags=(unconfined) {\n'),
});
check(s.status === 0 && /--question/.test(s.asked) && s.profile?.includes(s.game), 'asks again and points it at the new place');

s = scenario('A folder name AppArmor cannot hold', { folderName: 'Winter*land' });
check(s.status === 1 && s.profile === null && /Move the folder/.test(s.asked), 'changes nothing and says to move the folder');

console.log(failures ? `\n${failures} check(s) failed` : '\nall sandbox setup checks passed');
process.exit(failures ? 1 : 0);
