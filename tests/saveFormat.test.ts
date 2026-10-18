/**
 * 0.9.10 desktop safety (T5): an older or unknown save format is upgraded instead of refused (READINESS A3), the
 * desktop copy of the save (A5) is only written once nothing on disk can be lost, the window is throttled when hidden
 * (D9) and the workflows pin every action (F11).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAVE } from '../src/config';
import { backgroundShouldStep, backgroundSteps } from '../src/game/backgroundTick';
import { clearSave, FORMAT_STEPS, setAsideMirror, mergeState, migrateState, MIGRATIONS, parseSave, readMirror, sanitizeState, saveFormatOf, setMirrorWrites, startedFresh, upgradeFormat, writeSave, type SaveData } from '../src/core/Save';
import { listBackups } from '../src/core/saveVault';
import { createGameState } from '../src/core/types';

const raw = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const text = (over: Record<string, unknown> = {}): string => JSON.stringify({ v: SAVE.version, savedAt: 1700000000000, money: 120, state: {}, world: {}, salesRate: 0, ...over });

/** A plain-object Storage. */
function memStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

afterEach(() => {
  setMirrorWrites(false);
  vi.unstubAllGlobals();
});

describe('save format: older or unknown formats are upgraded, only newer ones refused (A3)', () => {
  it('reads the format number', () => {
    expect(saveFormatOf(1)).toBe(1);
    expect(saveFormatOf('1')).toBe(1);
    expect(saveFormatOf(' 2 ')).toBe(2);
    for (const v of [undefined, null, 0, -1, 1.5, 'one', '', {}, [], NaN]) expect(saveFormatOf(v)).toBe(0);
  });

  it('has a step from every older format up to this one', () => {
    for (let f = 0; f < SAVE.version; f++) expect(typeof FORMAT_STEPS[f]).toBe('function');
    const d: Record<string, unknown> = { v: 0, state: {} };
    expect(upgradeFormat(d, 0)).toBe(true);
    expect(d.v).toBe(SAVE.version);
  });

  it('a missing step reads as unreadable, never as a half-upgraded save', () => {
    expect(upgradeFormat({ state: {} }, 0, {})).toBe(false);
  });

  it.each([
    ['no format number', { v: undefined }],
    ['format 0', { v: 0 }],
    ['format as text', { v: '1' }],
    ['garbled format', { v: 'x' }],
    ['negative format', { v: -3 }],
  ])('%s opens as this format', (_name, over) => {
    const r = parseSave(text(over));
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.data.v).toBe(SAVE.version);
      expect(r.data.money).toBe(120);
    }
  });

  it('a newer format is still refused, and a broken shape is still corrupt', () => {
    expect(parseSave(text({ v: SAVE.version + 1 }))).toMatchObject({ kind: 'unreadable', reason: 'newer-format' });
    expect(parseSave(text({ v: String(SAVE.version + 1) }))).toMatchObject({ kind: 'unreadable', reason: 'newer-format' });
    for (const t of [text({ v: 0, state: null }), text({ state: [] }), text({ money: 'x' }), text({ savedAt: null }), '[]', 'null', '{'])
      expect(parseSave(t)).toMatchObject({ kind: 'unreadable', reason: 'corrupt' });
  });

  it.each(['save-format-none-0.9.7.json', 'save-format-0-0.9.6-era10.json'])('%s: loads and goes through the migrations like any save', (name) => {
    const r = parseSave(raw(name));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    // the same game as the format-1 save it came from (only `v` differs), before the migrations change the world
    const twin = parseSave(raw(name.includes('0.9.7') ? 'save-v9-0.9.7-season2.json' : 'save-v9-0.9.6-era10.json'));
    expect(twin.kind === 'ok' && twin.data).toEqual(r.data);
    const saved = JSON.parse(raw(name)) as SaveData;
    const state = createGameState();
    mergeState(state, r.data.state);
    sanitizeState(state);
    expect(state.eras.age).toBe(saved.state.eras.age);
    expect(state.prestige.season).toBe(saved.state.prestige.season);
    const report = migrateState(state, false, { salesRate: r.data.salesRate, saved: r.data.state, world: r.data.world });
    for (const m of MIGRATIONS) expect(state.migrations[m.id]).toBe(true);
    expect(Array.isArray(report.applied)).toBe(true);
  });

  it('Earlier saves lists an older-format copy too, since it opens', () => {
    const s = memStorage();
    s.setItem(`${SAVE.key}.bak`, text({ v: 0, savedAt: 5, money: 7 }));
    expect(listBackups(s).map((b) => [b.kind, b.savedAt, b.money])).toEqual([['rescue', 5, 7]]);
  });
});

describe('desktop copy of the save (A5)', () => {
  function desktopWith(files: { save: string | null; bak: string | null } | null) {
    const writes: string[] = [];
    const bridge = { read: vi.fn(() => files), write: vi.fn((t: string) => void writes.push(t)), setAside: vi.fn(() => true) };
    vi.stubGlobal('window', { winterlandDesktop: { saveMirror: bridge }, localStorage: memStorage() });
    vi.stubGlobal('localStorage', (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage);
    return { bridge, writes };
  }
  const data = (): SaveData => JSON.parse(text()) as SaveData;

  it('reads nothing on the web', () => {
    vi.stubGlobal('window', {});
    expect(readMirror()).toEqual({ kind: 'none' });
  });

  it('offers save.json when it opens, else the copy before it, else says it is unreadable', () => {
    const good = text({ money: 42 });
    desktopWith({ save: good, bak: null });
    expect(readMirror()).toMatchObject({ kind: 'ok', raw: good });
    desktopWith({ save: '{broken', bak: good });
    expect(readMirror()).toMatchObject({ kind: 'ok', raw: good });
    desktopWith({ save: text({ v: SAVE.version + 1 }), bak: '{' });
    expect(readMirror()).toEqual({ kind: 'unreadable' });
    desktopWith({ save: null, bak: null });
    expect(readMirror()).toEqual({ kind: 'none' });
    desktopWith(null);
    expect(readMirror()).toEqual({ kind: 'none' });
  });

  it('a bridge that fails to read is treated as a copy to leave alone', () => {
    expect(readMirror({ read: () => { throw new Error('ipc'); }, write: () => {}, setAside: () => true })).toEqual({ kind: 'unreadable' });
  });

  it('hands every save over only once writes are allowed', () => {
    const { writes } = desktopWith({ save: null, bak: null });
    expect(writeSave(data())).toBe(true);
    expect(writes).toHaveLength(0);
    setMirrorWrites(true);
    expect(writeSave(data())).toBe(true);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!).money).toBe(120);
  });

  it('moving the copy aside goes through the desktop app, and is a no-op on the web', () => {
    const { bridge } = desktopWith(null);
    expect(setAsideMirror()).toBe(true);
    expect(bridge.setAside).toHaveBeenCalledTimes(1);
    expect(setAsideMirror({ read: () => null, write: () => {}, setAside: () => false })).toBe(false);
    expect(setAsideMirror({ read: () => null, write: () => {}, setAside: () => { throw new Error('ipc'); } })).toBe(false);
    vi.stubGlobal('window', {});
    expect(setAsideMirror()).toBe(true);
  });

  it('a Reset marks the next start as fresh by choice, once', () => {
    desktopWith(null);
    clearSave();
    expect(startedFresh()).toBe(true);
    expect(startedFresh()).toBe(false);
  });
});

describe('hidden window catch-up (D9)', () => {
  const MAX_DT = 1 / 20;
  const sum = (a: number[]): number => a.reduce((n, x) => n + x, 0);

  it('steps only while hidden and running, so it never doubles up with frames', () => {
    expect(backgroundShouldStep(true, true)).toBe(true);
    expect(backgroundShouldStep(false, true)).toBe(false);
    expect(backgroundShouldStep(true, false)).toBe(false);
  });

  it('never simulates more than the real time that passed, in frame-sized steps', () => {
    for (const ms of [0, 16, 999, 1000, 1337, 5000, 59_999]) {
      const steps = backgroundSteps(10_000, 10_000 + ms, 60, MAX_DT);
      expect(sum(steps)).toBeCloseTo(ms / 1000, 6);
      expect(sum(steps)).toBeLessThanOrEqual(ms / 1000 + 1e-9);
      for (const dt of steps) expect(dt).toBeLessThanOrEqual(MAX_DT + 1e-12);
    }
  });

  it('a long gap (a sleeping computer) catches up at most the cap', () => {
    expect(sum(backgroundSteps(0, 3_600_000, 60, MAX_DT))).toBeCloseTo(60, 6);
  });

  it('time running backwards or a broken step size does nothing', () => {
    expect(backgroundSteps(5000, 4000, 60, MAX_DT)).toEqual([]);
    expect(backgroundSteps(0, 1000, 60, 0)).toEqual([]);
    expect(backgroundSteps(0, Number.NaN, 60, MAX_DT)).toEqual([]);
  });

  it('a tick followed by frames shares one clock: the next frame only sees the time since the tick', () => {
    // Game.backgroundTick moves lastTime to now, and the frame loop takes its dt from lastTime too
    const game = readFileSync(new URL('../src/game/Game.ts', import.meta.url), 'utf8');
    const tick = game.slice(game.indexOf('private backgroundTick()'), game.indexOf('/** Settings → Display'));
    expect(tick).toContain('this.lastTime = now;');
    // the menu-pause switch (Settings) holds the world while hidden too
    expect(tick).toMatch(/this\.paused \|\| \(menuPause\(\) && this\.ctx\.hud\.menuOpen\)/);
    expect(tick.indexOf('backgroundShouldStep(document.hidden')).toBeLessThan(tick.indexOf('this.lastTime = now;'));
  });
});

describe('desktop shell (D9, A5, F9)', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  const preload = readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  const game = readFileSync(new URL('../src/game/Game.ts', import.meta.url), 'utf8');

  it('throttles a hidden window and keeps saving on hide', () => {
    expect(main).toContain('backgroundThrottling: true');
    expect(main).not.toContain('backgroundThrottling: false');
    expect(game).toMatch(/visibilityState === 'hidden'\) this\.save\(\)/);
    expect(game).toContain('this.backgroundTick()');
  });

  it('the save copy is only for the game page, and only save.json in user data', () => {
    expect(main).toMatch(/'save:mirrorRead'[\s\S]{0,120}isAppUrl/);
    expect(main).toMatch(/'save:mirrorWrite'[\s\S]{0,120}isAppUrl/);
    expect(main).toContain("createMirror(app.getPath('userData'))");
    expect(preload).toContain("ipcRenderer.sendSync('save:mirrorRead')");
  });

  it('rolls back a cut-off update before the window opens (Linux, macOS)', () => {
    const ready = main.indexOf('app.whenReady()');
    expect(main.indexOf('recoverSwap(', ready)).toBeGreaterThan(ready);
    expect(main.indexOf('recoverSwap(', ready)).toBeLessThan(main.indexOf('createWindow();', ready));
  });
});

describe('workflows (F11)', () => {
  const read = (n: string): string => readFileSync(new URL(`../.github/workflows/${n}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it.each(['ci.yml', 'release.yml', 'updater.yml'])('%s pins every action to a full commit, with its tag in a comment', (n) => {
    const uses = [...read(n).matchAll(/^\s*-?\s*uses:\s*(\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, ref, rest] of uses) {
      expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(rest).toMatch(/^\s+# v\d+\.\d+\.\d+$/);
    }
  });

  it('CI keeps no npm cache', () => {
    for (const n of ['ci.yml', 'release.yml', 'updater.yml']) expect(read(n)).not.toMatch(/cache:\s*npm/);
  });

  it('release provenance signs from its own job, which runs no project code', () => {
    const yml = read('release.yml');
    const job = yml.slice(yml.indexOf('\n  provenance:'), yml.indexOf('\n  publish:'));
    expect(job).toContain('actions/attest-build-provenance@');
    expect(job).toMatch(/permissions:\n\s+contents: read\n\s+id-token: write\n\s+attestations: write/);
    expect(job).not.toMatch(/npm|checkout|node /);
    expect(yml.match(/id-token: write/g)).toHaveLength(1);
    expect(yml).toMatch(/publish:\n\s+needs: \[build, provenance\]/);
  });
});
