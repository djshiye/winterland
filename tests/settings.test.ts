/** Settings: tab memory and the save backup / restore validation (no DOM: storage and location are stubbed). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE } from '../src/config';
import { readSettingsTab, writeSettingsTab } from '../src/ui/SettingsPanel';
import { importSave, NOT_A_SAVE, saveFileName, validateSaveText } from '../src/ui/saveTransfer';

let store: Record<string, string> = {};
let reload = vi.fn();

beforeEach(() => {
  store = {};
  reload = vi.fn();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  });
  vi.stubGlobal('location', { reload });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const file = (text: string): File => new File([text], 'save.json', { type: 'application/json' });
const valid = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ v: SAVE.version, savedAt: 1700000000000, money: 120, state: {}, world: {}, salesRate: 0, ...over });

describe('importSave', () => {
  it('rejects text that is not JSON', async () => {
    expect(await importSave(file('not json {'))).toBe(NOT_A_SAVE);
    expect(store[SAVE.key]).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
  });

  it('rejects a wrong version, a missing state and bad numbers', async () => {
    for (const text of [valid({ v: 2 }), valid({ state: null }), valid({ state: 'x' }), valid({ money: '5' }), valid({ savedAt: null }), 'null', '[]', '42']) {
      expect(await importSave(file(text))).toBe(NOT_A_SAVE);
    }
    expect(store[SAVE.key]).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
  });

  it('stores a minimal valid save verbatim and reloads', async () => {
    const text = valid();
    expect(await importSave(file(text))).toBeNull();
    expect(store[SAVE.key]).toBe(text);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reports a storage failure without reloading', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(await importSave(file(valid()))).toMatch(/storage/);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('validateSaveText / saveFileName', () => {
  it('accepts the shape loadSave accepts', () => {
    expect(validateSaveText(valid())).toBeNull();
    expect(validateSaveText('')).toBe(NOT_A_SAVE);
  });

  it('names the file by local date and time', () => {
    expect(saveFileName(new Date(2026, 9, 5, 7, 3))).toBe('winterland-save-20261005-0703.json');
  });
});

describe('settings tab memory', () => {
  it('defaults to Sound and remembers the last tab', () => {
    expect(readSettingsTab()).toBe('sound');
    writeSettingsTab('display');
    expect(store['winterland:settingsTab']).toBe('display');
    expect(readSettingsTab()).toBe('display');
  });

  it('ignores junk and unavailable storage', () => {
    store['winterland:settingsTab'] = 'bogus';
    expect(readSettingsTab()).toBe('sound');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readSettingsTab()).toBe('sound');
    expect(() => writeSettingsTab('game')).not.toThrow();
  });
});
