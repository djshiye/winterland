import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { FILE, MAX_BYTES, createMirror } = require('../desktop/save-mirror.cjs') as {
  FILE: string;
  MAX_BYTES: number;
  createMirror(dir: string): {
    file: string;
    read(): { save: string | null; bak: string | null };
    offer(text: unknown): boolean;
    flush(): boolean;
    setAside(now: number): boolean;
  };
};

const save = (n: number) => JSON.stringify({ v: 1, state: { n } });

describe('desktop save mirror (0.9.10 A5)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'winterland-mirror-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('read() on an empty folder gives no save and no backup', () => {
    expect(createMirror(dir).read()).toEqual({ save: null, bak: null });
  });

  it('offer() rejects texts that are not a save and accepts one that is', () => {
    const m = createMirror(dir);
    for (const bad of [42, null, undefined, '', 'not json', '[]', '{"v":1}', '{"state":null}', 'x'.repeat(MAX_BYTES + 1)]) {
      expect(m.offer(bad)).toBe(false);
    }
    expect(m.offer('{"v":1,"state":{}}')).toBe(true);
  });

  it('writes exactly the offered text, leaves no temp file, and keeps it private', () => {
    const m = createMirror(dir);
    const text = save(1);
    m.offer(text);
    expect(m.flush()).toBe(true);
    expect(fs.readFileSync(path.join(dir, FILE), 'utf8')).toBe(text);
    expect(fs.existsSync(path.join(dir, `${FILE}.tmp`))).toBe(false);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, FILE)).mode & 0o777).toBe(0o600);
    expect(m.read().save).toBe(text);
  });

  it('flush with nothing offered succeeds and writes nothing', () => {
    expect(createMirror(dir).flush()).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('the first flush backs up the save found on disk; later flushes leave the backup alone', () => {
    const a = save(1);
    fs.writeFileSync(path.join(dir, FILE), a);
    const m = createMirror(dir);
    m.offer(save(2));
    expect(m.flush()).toBe(true);
    m.offer(save(3));
    expect(m.flush()).toBe(true);
    expect(fs.readFileSync(path.join(dir, FILE), 'utf8')).toBe(save(3));
    expect(fs.readFileSync(path.join(dir, `${FILE}.bak`), 'utf8')).toBe(a);
  });

  it('does not create or change the backup when the save on disk equals the first write', () => {
    const a = save(1);
    fs.writeFileSync(path.join(dir, FILE), a);
    const m = createMirror(dir);
    m.offer(a);
    expect(m.flush()).toBe(true);
    expect(fs.existsSync(path.join(dir, `${FILE}.bak`))).toBe(false);

    fs.writeFileSync(path.join(dir, `${FILE}.bak`), 'older');
    const m2 = createMirror(dir);
    m2.offer(a);
    m2.flush();
    expect(fs.readFileSync(path.join(dir, `${FILE}.bak`), 'utf8')).toBe('older');
  });

  it('a new session rotates again: the backup becomes the previous session\'s last save', () => {
    const s1 = createMirror(dir);
    s1.offer(save(1));
    s1.flush();
    s1.offer(save(2));
    s1.flush();
    const s2 = createMirror(dir);
    s2.offer(save(3));
    s2.flush();
    expect(s2.read()).toEqual({ save: save(3), bak: save(2) });
  });

  it('flush returns false without throwing when the folder cannot be created', () => {
    const blocker = path.join(dir, 'a-file');
    fs.writeFileSync(blocker, 'x');
    const m = createMirror(path.join(blocker, 'sub'));
    m.offer(save(1));
    expect(() => m.flush()).not.toThrow();
    expect(m.flush()).toBe(false);
  });

  it('creates nothing in the folder besides save.json and save.json.bak', () => {
    fs.writeFileSync(path.join(dir, FILE), save(0));
    const m = createMirror(dir);
    m.offer(save(1));
    m.flush();
    m.offer(save(2));
    m.flush();
    expect(fs.readdirSync(dir).sort()).toEqual([FILE, `${FILE}.bak`]);
  });
  it('setAside moves both copies aside under a time stamp, deletes nothing, and the next write starts afresh', () => {
    fs.writeFileSync(path.join(dir, FILE), save(1));
    fs.writeFileSync(path.join(dir, `${FILE}.bak`), save(0));
    const m = createMirror(dir);
    m.offer(save(9)); // not written yet: dropped by setAside
    expect(m.setAside(1234)).toBe(true);
    expect(fs.readFileSync(path.join(dir, `${FILE}.replaced-1234`), 'utf8')).toBe(save(1));
    expect(fs.readFileSync(path.join(dir, `${FILE}.bak.replaced-1234`), 'utf8')).toBe(save(0));
    expect(m.read()).toEqual({ save: null, bak: null });
    expect(m.flush()).toBe(true);
    expect(fs.existsSync(path.join(dir, FILE))).toBe(false);
    m.offer(save(2));
    m.flush();
    expect(m.read()).toEqual({ save: save(2), bak: null });
    expect(fs.readdirSync(dir).sort()).toEqual([FILE, `${FILE}.bak.replaced-1234`, `${FILE}.replaced-1234`]);
  });

  it('setAside with nothing there succeeds', () => {
    expect(createMirror(dir).setAside(1)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
