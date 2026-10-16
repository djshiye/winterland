/**
 * 0.9.6 save safety (S5): an unreadable save is kept, never overwritten; rolling backups; every save from 0.9.0 to
 * 0.9.5 loads; levels past Lv 10 are refunded once with the Mastery bonus frozen; the desktop shell's locks.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATE, SAVE, UPGRADES } from '../src/config';
import { masteryOf } from '../src/core/demand';
import { costAt } from '../src/core/ladder';
import { MASTERY_KEEP, MASTERY_PAYOUT_SECONDS, masteryPayout, originalCost, refundPrice } from '../src/core/refund';
import { mergeState, migrateState, MIGRATIONS, newSeasonSave, parseSave, sanitizeState, sanitizeWorld, type SaveData } from '../src/core/Save';
import { BEFORE_KEY, backupKey, isBackupKey, keepUnreadable, listBackups, pushBackup, readBackup, RESCUE_KEY, snapshotBefore, unreadableKeys } from '../src/core/saveVault';
import { createGameState, type GameState } from '../src/core/types';
import { GAME_VERSION, isNewerVersion, parseVersion } from '../src/core/version';
import { fuseConfig } from '../scripts/fuses.mjs';
import { FuseV1Options } from '@electron/fuses';
import { mergeTradeIntoSales } from '../src/core/salesMerge';

const raw = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const load = (name: string): SaveData => JSON.parse(raw(name));

/** In-memory Storage; `quota` (characters) makes setItem throw like a full localStorage. */
function memStorage(quota = Infinity): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const used = (): number => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem(k: string, v: string) {
      const before = data.get(k);
      data.set(k, v);
      if (used() > quota) {
        if (before === undefined) data.delete(k);
        else data.set(k, before);
        throw new DOMException('full', 'QuotaExceededError');
      }
    },
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

function loaded(name: string): { state: GameState; save: SaveData } {
  const save = load(name);
  const state = createGameState();
  mergeState(state, save.state);
  sanitizeState(state);
  return { state, save };
}

const OLD_CLIMB = ['save-v9-0.9.1-era3.json', 'save-v9-0.9.2-era5.json', 'save-v9-0.9.3-era7.json', 'save-v9-0.9.4-era10-mastery.json'];
const EVERY_09 = ['save-v8-climb.json', ...OLD_CLIMB, 'save-v9-0.9.5-era4-lv10.json'];

describe('parseSave: what is on disk', () => {
  const ok = (over: Record<string, unknown> = {}): string => JSON.stringify({ v: SAVE.version, savedAt: 1, money: 5, state: {}, world: {}, ...over });

  it('opens a good save and stamps nothing it does not know', () => {
    const r = parseSave(ok());
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.newer).toBeNull();
  });

  it('reports corrupt text as unreadable with the exact text, never as "no save"', () => {
    for (const text of ['{"v":1,"state":{', 'null', '[]', ok({ money: 'x' }), ok({ state: null }), ok({ v: 0 })]) {
      const r = parseSave(text);
      expect(r).toEqual({ kind: 'unreadable', raw: text, reason: 'corrupt' });
    }
  });

  it('tells a newer save format apart from a corrupt one', () => {
    expect(parseSave(ok({ v: SAVE.version + 1 }))).toMatchObject({ kind: 'unreadable', reason: 'newer-format' });
  });

  it('flags a save written by a newer build', () => {
    const r = parseSave(ok({ game: '99.0.0' }));
    expect(r.kind === 'ok' && r.newer).toBe('99.0.0');
    const same = parseSave(ok({ game: GAME_VERSION }));
    expect(same.kind === 'ok' && same.newer).toBeNull();
    const junk = parseSave(ok({ game: '<b>9</b>' }));
    expect(junk.kind === 'ok' && junk.data.game).toBeUndefined();
  });

  it('compares x.y.z versions only', () => {
    expect(isNewerVersion('0.9.10', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.9.6', '0.9.6')).toBe(false);
    expect(isNewerVersion('1.0', '0.9.6')).toBe(false);
    expect(parseVersion('1.2.3.4')).toBeNull();
    expect(parseVersion(GAME_VERSION)).not.toBeNull();
  });
});

describe('saveVault: backups next to the save', () => {
  it('keeps the newest SAVE.backups autosaves, newest first, and skips a copy identical to the newest', () => {
    const s = memStorage();
    for (const t of ['a', 'b', 'b', 'c', 'd']) pushBackup(t, s);
    expect(Array.from({ length: SAVE.backups }, (_, i) => s.getItem(backupKey(i)))).toEqual(['d', 'c', 'b']);
    expect(s.getItem(backupKey(SAVE.backups))).toBeNull();
  });

  it('keeps the exact text of an unreadable save, once, and only the newest few', () => {
    const s = memStorage();
    const key = keepUnreadable('{"broken', 1000, s);
    expect(key && s.getItem(key)).toBe('{"broken');
    expect(keepUnreadable('{"broken', 2000, s)).toBe(key); // a reload of the same broken save adds nothing
    for (let i = 0; i < 5; i++) keepUnreadable(`junk ${i}`, 3000 + i, s);
    expect(unreadableKeys(s)).toHaveLength(SAVE.unreadableKept);
    expect(s.getItem(unreadableKeys(s)[0]!)).toBe('junk 4');
  });

  it('says so when storage is full, so the caller never overwrites the original', () => {
    const s = memStorage(50);
    expect(keepUnreadable('x'.repeat(80), 1, s)).toBeNull();
  });

  it('a full storage still keeps the newest backup by giving up older slots', () => {
    const s = memStorage(120);
    const big = (c: string): string => c.repeat(30);
    pushBackup(big('a'), s);
    pushBackup(big('b'), s);
    pushBackup(big('c'), s);
    expect(s.getItem(backupKey(0))).toBe(big('c'));
  });

  it('only ever restores from its own backup keys', () => {
    const s = memStorage();
    s.setItem(SAVE.key, 'live');
    s.setItem('winterland:settingsTab', 'x');
    expect(readBackup(SAVE.key, s)).toBeNull();
    expect(readBackup('winterland:settingsTab', s)).toBeNull();
    expect(readBackup(`${SAVE.key}.unreadable.1`, s)).toBeNull();
    expect(isBackupKey(backupKey(0)) && isBackupKey(BEFORE_KEY) && isBackupKey(RESCUE_KEY)).toBe(true);
  });

  it('lists only saves that open, newest first, with the reason for a "before" copy', () => {
    const s = memStorage();
    const save = (at: number, money: number): string => JSON.stringify({ v: SAVE.version, savedAt: at, money, state: {}, world: {} });
    pushBackup(save(100, 1), s);
    pushBackup('{"not a save', s);
    snapshotBefore(save(300, 3), 'reset', s);
    s.setItem(RESCUE_KEY, save(200, 2));
    expect(listBackups(s).map((b) => [b.kind, b.savedAt, b.money, b.why])).toEqual([
      ['before', 300, 3, 'reset'],
      ['rescue', 200, 2, ''],
      ['autosave', 100, 1, ''],
    ]);
  });
});

describe('every 0.9.0 to 0.9.5 save loads', () => {
  it.each(EVERY_09)('%s: merges, sanitizes, migrates and round-trips', (name) => {
    const text = raw(name);
    const r = parseSave(text);
    expect(r.kind).toBe('ok');
    const { state, save } = loaded(name);
    expect(state.eras.age).toBe(save.state.eras.age);
    migrateState(state, false);
    for (const def of Object.values(UPGRADES)) expect(state.upgrades[def.id]).toBeLessThanOrEqual(10);
    const again = createGameState();
    mergeState(again, JSON.parse(JSON.stringify(state)));
    sanitizeState(again);
    expect(again).toEqual(state);
    const world = sanitizeWorld(save.world);
    expect(sanitizeWorld(JSON.parse(JSON.stringify(world)))).toEqual(world);
  });
});

describe('0.9.6 migration: levels past Lv 10 refunded, Mastery kept (decisions 2 and 6)', () => {
  it('runs in the literal gate mode the game ships with', () => {
    expect(GATE.mode).toBe('literal');
  });

  it.each(OLD_CLIMB)('%s: refunds every level past 10 at what it cost then and pays Mastery out once', (name) => {
    const { state, save } = loaded(name);
    let refund = 0;
    let levels = 0;
    for (const def of Object.values(UPGRADES)) {
      for (let k = 10; k < state.upgrades[def.id]; k++) refund += refundPrice(def, k);
      levels += Math.max(0, state.upgrades[def.id] - 10);
    }
    expect(levels).toBeGreaterThan(0);
    const mastery = masteryOf(state);
    const rate = save.salesRate > 0 ? save.salesRate : state.stats.moneyEarned / state.playTime;
    // 0.9.6-trade-merge (core/salesMerge.ts) runs on the clamped levels and adds its own Trade refund
    const clamped = Object.fromEntries(Object.entries(state.upgrades).map(([id, v]) => [id, Math.min(10, v)]));
    const trade = mergeTradeIntoSales(clamped, save.state.upgrades);
    const report = migrateState(state, false, { salesRate: save.salesRate, upgrades: save.state.upgrades });
    expect(report.applied).toEqual(MIGRATIONS.map((m) => m.id));
    expect(report.refundedLevels).toBe(levels);
    expect(report.tradeLevels).toBe(trade.levels);
    expect(report.refund).toBe(Math.floor(refund) + trade.refund);
    expect(report.refund).toBeGreaterThan(0);
    expect(MASTERY_KEEP).toBe('cash');
    expect(mastery).toBeGreaterThan(1);
    expect(report.masteryHad).toBe(mastery);
    expect(report.masteryPayout).toBe(masteryPayout(mastery, rate));
    expect(report.masteryPayout).toBeGreaterThan(0);
    // retired: nothing multiplies sales any more
    expect(state.legacy.masteryMult).toBe(1);
    expect(masteryOf(state)).toBe(1);
    for (const def of Object.values(UPGRADES)) expect(state.upgrades[def.id]).toBeLessThanOrEqual(10);
    // once only: a second load (state written back and read again) changes nothing and pays nothing
    const next = createGameState();
    mergeState(next, JSON.parse(JSON.stringify(state)));
    sanitizeState(next);
    const second = migrateState(next, false, { salesRate: save.salesRate, upgrades: save.state.upgrades });
    expect(second).toEqual({ applied: [], refund: 0, refundedLevels: 0, masteryMult: 1, masteryHad: 1, masteryPayout: 0, tradeLevels: 0, resourcesAge: 0 });
    expect(next).toEqual(state);
  });

  it('Mastery pays out the extra it would earn over one era of play', () => {
    expect(masteryPayout(1.5, 1000)).toBe(0.5 * 1000 * MASTERY_PAYOUT_SECONDS);
    expect(masteryPayout(1, 1e9)).toBe(0);
    expect(masteryPayout(1.76, -5)).toBe(0);
    expect(masteryPayout(1.76, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('a new season keeps the applied migrations and any frozen bonus', () => {
    const { state } = loaded('save-v9-0.9.4-era10-mastery.json');
    migrateState(state, false);
    state.legacy.masteryMult = 1.2; // as MASTERY_KEEP 'multiplier' would leave it
    const season = newSeasonSave(state, 1).state;
    expect(season.legacy.masteryMult).toBe(1.2);
    expect(season.migrations).toEqual(state.migrations);
  });

  it('prices a refunded level as 0.9.1-0.9.4 did, not at today\'s prices', () => {
    expect(refundPrice).toBe(originalCost);
    // spot values from v0.9.4's own core/ladder.ts costAt (every 0.9.4 id and stored level 10..99 matched when written)
    const SPOT: [string, number, number][] = [["carry",10,95000],["carry",35,7100000],["carry",99,39500000000],["jack",10,827000],["jack",35,14200000],["jack",99,79000000000],["frontierCrew",10,1730000],["frontierCrew",35,54300000],["frontierCrew",99,172000000000],["aiCrew",10,85900000000],["aiCrew",35,2330000000000],["aiCrew",99,20100000000000000],["taxOffice",10,1920000],["taxOffice",35,60400000],["taxOffice",99,191000000000]];
    for (const [id, s, cost] of SPOT) expect(originalCost(UPGRADES[id as keyof typeof UPGRADES], s)).toBe(cost);
    expect(originalCost(UPGRADES.frontierCrew, 20)).toBeLessThan(costAt(UPGRADES.frontierCrew, 20));
  });

  it('a 0.9.5 save (already Lv 10 at most) gets no refund and no card', () => {
    const { state } = loaded('save-v9-0.9.5-era4-lv10.json');
    const before = JSON.stringify(state.upgrades);
    const report = migrateState(state, false);
    expect(report.refund).toBe(0);
    expect(report.refundedLevels).toBe(0);
    expect(JSON.stringify(state.upgrades)).toBe(before);
  });

  it('a fresh game marks every migration done without running any', () => {
    const state = createGameState();
    const report = migrateState(state, true);
    expect(report.applied).toEqual([]);
    for (const m of MIGRATIONS) expect(state.migrations[m.id]).toBe(true);
    expect(state.legacy.masteryMult).toBe(1);
  });

  it('sanitizeState keeps the legacy bonus in range', () => {
    const state = createGameState();
    mergeState(state, { legacy: { masteryMult: 1e9 }, migrations: { a: true, b: 3 } });
    sanitizeState(state);
    expect(state.legacy.masteryMult).toBe(10);
    expect(state.migrations).toEqual({ a: true });
  });
});

describe('desktop shell locks (READINESS F)', () => {
  const require = createRequire(import.meta.url);
  const w = require('../desktop/window-options.cjs') as {
    APP_ORIGIN: string;
    CSP: string;
    distFile(dist: string, url: string): string | null;
    isAppUrl(url: string): boolean;
  };
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');

  it('pins the name and origin the saves live under', () => {
    expect(w.APP_ORIGIN).toBe('app://game');
    expect(main).toContain("app.setName('Winterland')");
    expect(main).toContain("win.loadURL('app://game/index.html')");
  });

  it('serves only files inside dist', () => {
    expect(w.distFile('/srv/dist', 'app://game/index.html')).toBe(resolve('/srv/dist', 'index.html'));
    for (const url of ['app://game/%2e%2e%2fsecret', 'app://game/..%2f..%2fetc%2fpasswd', 'app://game/%E0%A4%A', 'app://other/index.html', 'file:///etc/passwd', 'app://game/a%00b'])
      expect(w.distFile('/srv/dist', url)).toBeNull();
  });

  it('keeps the window on the game', () => {
    expect(w.isAppUrl('app://game/index.html')).toBe(true);
    for (const url of ['https://example.com', 'app://evil/', 'file:///x', 'javascript:alert(1)']) expect(w.isAppUrl(url)).toBe(false);
  });

  it('has a strict Content-Security-Policy', () => {
    expect(w.CSP).toContain("default-src 'none'");
    expect(w.CSP).toContain("script-src 'self'");
    expect(w.CSP).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
    expect(w.CSP).toContain("object-src 'none'");
  });

  it('one copy at a time, no dev tools in a release, every permission denied, navigation guarded', () => {
    expect(main).toContain('requestSingleInstanceLock()');
    expect(main).toContain('devTools: !app.isPackaged');
    expect(main).toContain('setPermissionRequestHandler');
    expect(main).toContain("'will-navigate'");
    expect(main).toContain("'Content-Security-Policy'");
  });

  it('turns off the Node switches in the packaged binary', () => {
    for (const platform of ['linux', 'win32', 'darwin']) {
      const f = fuseConfig(platform) as Record<number, boolean>;
      expect(f[FuseV1Options.RunAsNode]).toBe(false);
      expect(f[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false);
      expect(f[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false);
      expect(f[FuseV1Options.OnlyLoadAppFromAsar]).toBe(true);
    }
    expect((fuseConfig('darwin') as Record<number, boolean>)[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(true);
  });
});

describe('release workflow token', () => {
  it('is read-only except for the publish job', () => {
    const yml = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(yml).toMatch(/^permissions:\n  contents: read$/m);
    expect(yml.match(/contents: write/g)).toHaveLength(1);
    expect(yml.indexOf('contents: write')).toBeGreaterThan(yml.indexOf('  publish:'));
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(ci).toMatch(/^permissions:\n  contents: read$/m);
  });
});
