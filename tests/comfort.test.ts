/** Comfort settings: storage parsing, defaults, and the multipliers the effects read (no DOM: storage is stubbed). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMFORT_KEY,
  comfort,
  parseComfort,
  particleScale,
  reloadComfort,
  scaledCount,
  setComfort,
  shakeScale,
  snowScale,
  steadyHighlights,
} from '../src/fx/comfort';
import { backOut, cubicOut } from '../src/ui/dom';
import { readSettingsTab, SETTINGS_TABS } from '../src/ui/SettingsPanel';

let store: Record<string, string> = {};

beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  });
  reloadComfort();
});

afterEach(() => {
  vi.unstubAllGlobals();
  reloadComfort();
});

describe('parseComfort', () => {
  it('falls back to the defaults for missing, broken or hostile values', () => {
    const d = { motion: false, effects: 'full', colorBlind: false };
    for (const text of [null, '', 'not json', 'null', '[]', '42', '"x"', '{"__proto__":{"motion":true}}']) {
      expect(parseComfort(text)).toEqual(d);
    }
    expect(parseComfort('{"motion":"yes","effects":"loud","colorBlind":1}')).toEqual(d);
  });

  it('keeps valid fields and drops unknown ones', () => {
    expect(parseComfort('{"motion":true,"effects":"calm","colorBlind":true,"extra":5}')).toEqual({
      motion: true,
      effects: 'calm',
      colorBlind: true,
    });
  });

  it('follows the system "reduce motion" preference until the player picks', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    expect(parseComfort(null).motion).toBe(true);
    expect(parseComfort('{"motion":false}').motion).toBe(false);
  });
});

describe('setComfort', () => {
  it('remembers the choice and survives a restart', () => {
    setComfort({ effects: 'minimal', colorBlind: true });
    expect(JSON.parse(store[COMFORT_KEY]!)).toEqual({ motion: false, effects: 'minimal', colorBlind: true });
    reloadComfort();
    expect(comfort()).toEqual({ motion: false, effects: 'minimal', colorBlind: true });
  });

  it('still applies for the session when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    reloadComfort();
    expect(comfort().effects).toBe('full');
    setComfort({ effects: 'calm' });
    expect(comfort().effects).toBe('calm');
  });

  it('ignores a bad level instead of storing it', () => {
    setComfort({ effects: 'loud' as never });
    expect(comfort().effects).toBe('full');
  });
});

describe('effect multipliers', () => {
  it('full effects change nothing', () => {
    expect(particleScale()).toBe(1);
    expect(shakeScale()).toBe(1);
    expect(snowScale()).toBe(1);
    expect(steadyHighlights()).toBe(false);
    expect(scaledCount(9)).toBe(9);
    expect(backOut(0.6)).toBeGreaterThan(1); // the bouncy overshoot
  });

  it('calm and minimal turn particles and shake down, never to zero particles', () => {
    setComfort({ effects: 'calm' });
    expect(shakeScale()).toBeCloseTo(0.4);
    expect(steadyHighlights()).toBe(true);
    expect(scaledCount(10)).toBe(5);
    expect(scaledCount(3, () => 0)).toBe(2);
    expect(scaledCount(3, () => 0.99)).toBe(1);
    setComfort({ effects: 'minimal' });
    expect(shakeScale()).toBe(0);
    expect(scaledCount(1)).toBe(1);
    expect(scaledCount(50, () => 0.99)).toBe(10);
    expect(scaledCount(0)).toBe(0);
  });

  it('reduce motion stops shake and bounces and thins the snow', () => {
    setComfort({ motion: true });
    expect(shakeScale()).toBe(0);
    expect(snowScale()).toBe(0.5);
    expect(steadyHighlights()).toBe(true);
    for (const t of [0, 0.3, 0.6, 1]) expect(backOut(t)).toBeCloseTo(cubicOut(t));
  });
});

describe('settings tabs', () => {
  it('has a Comfort tab the panel can remember', () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toContain('comfort');
    store['winterland:settingsTab'] = 'comfort';
    expect(readSettingsTab()).toBe('comfort');
  });
});
