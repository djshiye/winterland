import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { DONE, JOURNAL, LOCK, STAGE, recoverSwap, readJournal, safeName } = require('../desktop/swap-recover.cjs') as {
  DONE: string;
  JOURNAL: string;
  LOCK: string;
  STAGE: string;
  recoverSwap(folder: string, platform: string, app?: string): string;
  readJournal(stage: string): { had: boolean; name: string }[] | null;
  safeName(name: unknown): boolean;
};

describe('desktop swap recovery (0.9.10 F9)', () => {
  let root: string;
  let folder: string;
  const f = (...p: string[]) => path.join(folder, ...p);
  const put = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const read = (file: string) => fs.readFileSync(file, 'utf8');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'winterland-swap-'));
    folder = path.join(root, 'game');
    fs.mkdirSync(folder);
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports none without a stage, and removes a finished swap\'s leftovers', () => {
    expect(recoverSwap(folder, 'linux')).toBe('none');
    put(f(DONE, 'old', 'x'), 'x');
    expect(recoverSwap(folder, 'linux')).toBe('cleaned');
    expect(fs.existsSync(f(DONE))).toBe(false);
  });

  it('rolls a half-done Linux swap back to the old version', () => {
    put(f(STAGE, JOURNAL), '1 resources\n1 winterland\n0 locales\n1 LICENSE\n');
    // resources: old moved aside, new in place
    put(f(STAGE, 'old', 'resources', 'app.txt'), 'old resources');
    put(f('resources', 'app.txt'), 'new resources');
    // winterland: not yet moved
    put(f('winterland'), 'old binary');
    // locales: new, already in place
    put(f('locales', 'en.pak'), 'new');
    // LICENSE: old moved aside, not yet replaced
    put(f(STAGE, 'old', 'LICENSE'), 'old license');
    put(f('my-notes.txt'), 'mine');

    expect(recoverSwap(folder, 'linux')).toBe('rolled-back');
    expect(read(f('resources', 'app.txt'))).toBe('old resources');
    expect(read(f('winterland'))).toBe('old binary');
    expect(read(f('LICENSE'))).toBe('old license');
    expect(fs.existsSync(f('locales'))).toBe(false);
    expect(fs.existsSync(f(STAGE))).toBe(false);
    expect(read(f('my-notes.txt'))).toBe('mine');
  });

  it('reads a CRLF journal (written on Windows) the same way', () => {
    put(f(STAGE, JOURNAL), '1 resources\r\n0 locales\r\n');
    expect(readJournal(f(STAGE))).toEqual([
      { had: true, name: 'resources' },
      { had: false, name: 'locales' },
    ]);
    put(f(STAGE, 'old', 'resources'), 'old');
    put(f('resources'), 'new');
    put(f('locales'), 'new');
    expect(recoverSwap(folder, 'win32')).toBe('rolled-back');
    expect(read(f('resources'))).toBe('old');
    expect(fs.existsSync(f('locales'))).toBe(false);
  });

  it('refuses a journal with a bad name and never touches anything outside the folder', () => {
    for (const bad of ['1 ../evil', '1 a/b', '2 x']) {
      put(f(STAGE, JOURNAL), `1 good\n${bad}\n`);
      expect(readJournal(f(STAGE))).toBeNull();
    }
    put(path.join(root, 'evil'), 'sibling');
    put(f(STAGE, JOURNAL), '1 ../evil\n');
    put(f(STAGE, 'old', 'keep.txt'), 'old');
    put(f('keep.txt'), 'live');
    // falls back to the legacy path: the old file has a replacement, so it stays
    expect(recoverSwap(folder, 'linux')).toBe('incomplete');
    expect(read(path.join(root, 'evil'))).toBe('sibling');
    expect(read(f('keep.txt'))).toBe('live');
  });

  it('legacy stage (no journal): moves back what is missing, keeps what has a replacement', () => {
    put(f(STAGE, 'old', 'a.txt'), 'old a');
    put(f(STAGE, 'old', 'b.txt'), 'old b');
    put(f('b.txt'), 'new b');
    expect(recoverSwap(folder, 'linux')).toBe('rolled-back');
    expect(read(f('a.txt'))).toBe('old a');
    expect(read(f('b.txt'))).toBe('new b');
    expect(fs.existsSync(f(STAGE, 'old', 'b.txt'))).toBe(true);
  });

  it('legacy stage is incomplete when nothing could be moved back', () => {
    put(f(STAGE, 'old', 'b.txt'), 'old b');
    put(f('b.txt'), 'new b');
    expect(recoverSwap(folder, 'linux')).toBe('incomplete');
    expect(fs.existsSync(f(STAGE))).toBe(true);
  });

  it('legacy stage with an empty old/ is just removed', () => {
    fs.mkdirSync(f(STAGE, 'old'), { recursive: true });
    expect(recoverSwap(folder, 'linux')).toBe('cleaned');
    expect(fs.existsSync(f(STAGE))).toBe(false);
  });

  it('a stage cut before the swap (only unpacked/) is cleaned and the game is untouched', () => {
    put(f(STAGE, 'unpacked', 'top', 'file'), 'new');
    put(f('winterland'), 'old binary');
    expect(recoverSwap(folder, 'linux')).toBe('cleaned');
    expect(fs.existsSync(f(STAGE))).toBe(false);
    expect(read(f('winterland'))).toBe('old binary');
  });

  it('does nothing while the updater that holds the lock is alive', () => {
    put(f(LOCK, 'pid'), String(process.pid));
    put(f(STAGE, 'old', 'a.txt'), 'old a');
    expect(recoverSwap(folder, 'linux')).toBe('busy');
    expect(fs.existsSync(f(STAGE, 'old', 'a.txt'))).toBe(true);
    expect(fs.existsSync(f('a.txt'))).toBe(false);
  });

  it('recovers when the lock belongs to a process that has exited', () => {
    const child = spawnSync(process.execPath, ['-e', '0']);
    put(f(LOCK, 'pid'), String(child.pid));
    put(f(STAGE, 'old', 'a.txt'), 'old a');
    expect(recoverSwap(folder, 'linux')).toBe('rolled-back');
    expect(read(f('a.txt'))).toBe('old a');
  });

  it('macOS: puts the old app back when the new one never arrived', () => {
    put(f(STAGE, 'old.app', 'Contents', 'Info.plist'), 'old plist');
    expect(recoverSwap(folder, 'darwin')).toBe('rolled-back');
    expect(read(f('Winterland.app', 'Contents', 'Info.plist'))).toBe('old plist');
    expect(fs.existsSync(f(STAGE))).toBe(false);
  });

  it('macOS: removes the leftovers when the new app is in place, using the given app path', () => {
    const app = f('Custom.app');
    put(path.join(app, 'new.txt'), 'new');
    put(f(STAGE, 'old.app', 'old.txt'), 'old');
    expect(recoverSwap(folder, 'darwin', app)).toBe('cleaned');
    expect(fs.existsSync(f(STAGE))).toBe(false);
    expect(read(path.join(app, 'new.txt'))).toBe('new');
  });

  it('macOS: restores to the given app path when it is missing', () => {
    const app = f('Custom.app');
    put(f(STAGE, 'old.app', 'old.txt'), 'old');
    expect(recoverSwap(folder, 'darwin', app)).toBe('rolled-back');
    expect(read(path.join(app, 'old.txt'))).toBe('old');
  });

  it('safeName accepts plain names only', () => {
    expect(safeName('Update Winterland.sh')).toBe(true);
    expect(safeName('resources')).toBe(true);
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'x\ny']) expect(safeName(bad)).toBe(false);
  });
});
