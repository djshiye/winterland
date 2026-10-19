#!/usr/bin/env node
/**
 * Tests desktop/linux/sandbox-setup.sh (Ubuntu 23.10+: let Winterland use Chromium's sandbox) on Linux, against a
 * pretend system in a temp folder: WL_SANDBOX_TEST_ROOT points its /proc switch and /etc/apparmor.d there, HOME is
 * a temp folder, and stand-in zenity answers its question. The root step runs as is (without pkexec, without loading
 * the profile into the kernel). Nothing outside the temp folder is touched.
 *
 *   node scripts/test-linux-sandbox.mjs
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
const which = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).stdout.trim();

/**
 * One run. `restrict`: the /proc switch ('1', '0' or null = missing); `answer`: zenity's reply (0 yes, 1 no, null = no
 * dialog tool at all); `appimage`: run as the AppImage's copy (a pretend mount with build `build`).
 */
function scenario(title, { restrict = '1', answer = 0, appimage = false, build = 'b1', folderName = 'Winterland-linux-x64', before = () => {}, runs = 1 } = {}) {
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
    const home = join(root, 'home');
    mkdirSync(home);
    const game = join(root, appimage ? 'mount' : folderName);
    mkdirSync(join(game, 'resources'), { recursive: true });
    writeFileSync(join(game, 'winterland'), '#!/bin/sh\n');
    chmodSync(join(game, 'winterland'), 0o755);
    writeFileSync(join(game, 'resources', 'app.asar'), `game ${build}`);
    if (appimage) writeFileSync(join(game, '.winterland-build'), `0.9.11 ${build}\n`);
    const copy = join(game, appimage ? 'sandbox-setup.sh' : 'Set up for Ubuntu.sh');
    copyFileSync(script, copy);
    chmodSync(copy, 0o755);
    // PATH: the basic tools, plus a stand-in zenity (unless there is to be no dialog tool at all)
    const bin = join(root, 'bin');
    const log = join(root, 'asked.log');
    mkdirSync(bin);
    for (const t of ['cat', 'grep', 'dirname', 'stat', 'mktemp', 'cp', 'mv', 'rm', 'chmod', 'mkdir', 'sh']) symlinkSync(which(t), join(bin, t));
    if (answer !== null) {
      writeFileSync(join(bin, 'zenity'), `#!/bin/sh\necho "$*" >> '${log}'\ncase "$*" in *--question*) exit ${answer} ;; *--progress*) cat >/dev/null ;; esac\nexit 0\n`);
      chmodSync(join(bin, 'zenity'), 0o755);
    }
    const data = join(home, '.local', 'share', 'Winterland');
    before({ game, sys, data });
    let r;
    for (let i = 0; i < runs; i++) {
      r = spawnSync('/bin/bash', [copy, ...(appimage ? ['--appimage', '--ask'] : ['--ask'])], {
        encoding: 'utf8',
        env: { WL_SANDBOX_TEST_ROOT: sys, PATH: bin, HOME: home, DISPLAY: ':0', TMPDIR: root },
      });
    }
    const profile = join(sys, 'etc', 'apparmor.d', appimage ? 'winterland-appimage' : 'winterland');
    return {
      status: r.status,
      stdout: r.stdout.trim(),
      stderr: r.stderr,
      asked: existsSync(log) ? readFileSync(log, 'utf8') : '',
      profile: existsSync(profile) ? readFileSync(profile, 'utf8') : null,
      profileMode: existsSync(profile) ? statSync(profile).mode & 0o777 : null,
      leftovers: spawnSync('sh', ['-c', `ls -A '${join(sys, 'etc', 'apparmor.d')}' '${existsSync(data) ? data : root}'`], { encoding: 'utf8' }).stdout,
      game,
      data,
      copyBuild: existsSync(join(data, 'app', '.winterland-build')) ? readFileSync(join(data, 'app', '.winterland-build'), 'utf8').trim() : null,
      marker: existsSync(join(data, 'app', 'marker')),
      dataMode: existsSync(data) ? statSync(data).mode & 0o777 : null,
      note: existsSync(join(appimage ? data : game, 'why-winterland-did-not-start.txt')),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

let s = scenario('Not Ubuntu (no AppArmor switch)', { restrict: null });
check(s.status === 0 && s.asked === '' && s.profile === null, 'starts, asks nothing, changes nothing');

s = scenario('Ubuntu with the switch off, AppImage', { restrict: '0', appimage: true });
check(s.status === 0 && s.stdout === '' && s.copyBuild === null, 'runs the AppImage as is: no copy, no profile, no question');

s = scenario('Ubuntu 24.04, zip, player allows it');
check(s.status === 0, 'the game can start');
check(/--question/.test(s.asked) && /Allow Winterland/.test(s.asked), 'asked once, in a window');
check(s.profile?.includes(`profile winterland "${s.game}/winterland" flags=(unconfined) {`), 'profile for exactly this game');
check(/^\s*userns,$/m.test(s.profile ?? '') && !/\b(capability|file|network|mount)\b/.test(s.profile?.replace(/^#.*$/gm, '') ?? ''), 'it allows the sandbox and nothing else');
check(s.profile?.includes('abi <abi/4.0>,'), 'uses the AppArmor 4 rules where present');
check(s.profileMode === 0o644 && !/\.winterland-new/.test(s.leftovers), 'written whole (0644), no temporary file left');

s = scenario('Ubuntu 24.04, zip, player says not now', { answer: 1 });
check(s.status === 1 && s.profile === null, 'the game does not start, nothing is changed');
check(/--info/.test(s.asked) && /can't start/.test(s.asked), 'explains why, in a window');

s = scenario('Ubuntu 24.04, no dialog tool at all', { answer: null });
check(s.status === 1 && s.profile === null, 'does not start, changes nothing');
check(/can't start/.test(s.stderr) && s.note, 'explains on the error output and in a note in the game folder');

s = scenario('Ubuntu 24.04, AppImage, player allows it', { appimage: true });
check(s.status === 0, 'the game can start');
check(s.stdout === `${s.data}/app/winterland`, "AppRun is told to start the copy in the player's own folder");
check(s.copyBuild === '0.9.11 b1' && s.dataMode === 0o700, 'the copy is whole and its folder is private (0700)');
check(s.profile?.includes(`profile winterland-appimage "${s.data}/app/winterland" flags=(unconfined) {`), 'profile for exactly that copy');
check(!/\/tmp\/\.mount_/.test(s.profile ?? ''), 'nothing in /tmp is allowed');
check(/--progress/.test(s.asked), 'a "getting ready" window shows while copying');

s = scenario('AppImage started again, same version', {
  appimage: true,
  runs: 2,
  before: () => {},
});
check(s.status === 0 && s.copyBuild === '0.9.11 b1' && (s.asked.match(/--question/g) ?? []).length === 1, 'asks once, copies once');

s = scenario('AppImage after an update (new build)', {
  appimage: true,
  build: 'b2',
  before: ({ data, game, sys }) => {
    mkdirSync(join(data, 'app'), { recursive: true });
    writeFileSync(join(data, 'app', '.winterland-build'), '0.9.10 b1\n');
    writeFileSync(join(data, 'app', 'marker'), 'old copy');
    writeFileSync(join(sys, 'etc', 'apparmor.d', 'winterland-appimage'), `profile winterland-appimage "${join(data, 'app', 'winterland')}" flags=(unconfined) {\n`);
    void game;
  },
});
check(s.status === 0 && s.copyBuild === '0.9.11 b2' && !s.marker, 'the copy is replaced by the new version, whole');
check(s.asked === '' || !/--question/.test(s.asked), 'the profile still fits: no question');
check(!/\.app-(new|old)/.test(s.leftovers), 'no half copies left behind');

s = scenario('Already set up (zip)', {
  before: ({ game, sys }) =>
    writeFileSync(join(sys, 'etc', 'apparmor.d', 'winterland'), `profile winterland "${game}/winterland" flags=(unconfined) {\n  userns,\n}\n`),
});
check(s.status === 0 && s.asked === '', 'starts without asking');

s = scenario('Set up for a folder that has moved since', {
  before: ({ sys }) => writeFileSync(join(sys, 'etc', 'apparmor.d', 'winterland'), 'profile winterland "/old/place/winterland" flags=(unconfined) {\n'),
});
check(s.status === 0 && /--question/.test(s.asked) && s.profile?.includes(s.game), 'asks again and points it at the new place');

for (const name of ['Winter*land', 'Winter\\land', 'Winter"land']) {
  s = scenario(`A folder name AppArmor cannot hold (${name})`, { folderName: name });
  check(s.status === 1 && s.profile === null && /Move it somewhere simpler/.test(s.asked), 'changes nothing and says to move the folder');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall sandbox setup checks passed');
process.exit(failures ? 1 : 0);
