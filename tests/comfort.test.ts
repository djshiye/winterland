/** Comfort settings: storage parsing, defaults, and the multipliers the effects read (no DOM: storage is stubbed). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMFORT_KEY,
  clampUiScale,
  comfort,
  fitUiScale,
  TOAST_UI_MAX,
  parseComfort,
  particleScale,
  reloadComfort,
  scaledCount,
  setComfort,
  shakeScale,
  snowScale,
  steadyHighlights,
  UI_SCALE,
  uiScale,
  clampGlow,
  glowScale,
} from '../src/fx/comfort';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    const d = { motion: false, effects: 'full', colorBlind: false, uiScale: 1, glow: 1, snow: true, menuPause: false };
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
      uiScale: 1,
      glow: 1,
      snow: true,
      menuPause: false,
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
    expect(JSON.parse(store[COMFORT_KEY]!)).toEqual({ motion: false, effects: 'minimal', colorBlind: true, uiScale: 1, glow: 1, snow: true, menuPause: false });
    reloadComfort();
    expect(comfort()).toEqual({ motion: false, effects: 'minimal', colorBlind: true, uiScale: 1, glow: 1, snow: true, menuPause: false });
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

  it('Falling snow off stops the snow altogether (0.9.8), and survives a restart', () => {
    setComfort({ snow: false });
    expect(snowScale()).toBe(0);
    reloadComfort();
    expect(comfort().snow).toBe(false);
    setComfort({ snow: true });
    expect(snowScale()).toBe(1);
    expect(parseComfort('{"snow":"no"}').snow).toBe(true);
  });
});

describe('interface size (0.9.7)', () => {
  it('clamps to 80-150 % on 5 % steps; junk is 100 %', () => {
    expect(clampUiScale(1.23)).toBe(1.25);
    expect(clampUiScale(0.2)).toBe(UI_SCALE.min);
    expect(clampUiScale(9)).toBe(UI_SCALE.max);
    for (const junk of [NaN, Infinity, '1.2', null, {}]) expect(clampUiScale(junk)).toBe(1);
    expect(parseComfort('{"uiScale":1.4}').uiScale).toBe(1.4);
    expect(parseComfort('{"uiScale":"huge"}').uiScale).toBe(1);
  });

  it('is remembered, read back by uiScale() and an old setting without it loads at 100 %', () => {
    store[COMFORT_KEY] = '{"motion":true,"effects":"calm","colorBlind":false}';
    reloadComfort();
    expect(uiScale()).toBe(1);
    setComfort({ uiScale: 1.3 });
    reloadComfort();
    expect(uiScale()).toBe(1.3);
    expect(comfort().motion).toBe(true);
  });

  it('every HUD panel zooms by it, except the world-anchored effects', () => {
    const css = readFileSync(resolve(__dirname, '../src/ui/comfort.css'), 'utf8').replace(/\r\n/g, '\n');
    expect(css).toContain('.wl-hud > :not(.wl-float):not(.wl-edge):not(.wl-coin) {\n  zoom: var(--wl-ui, 1);');
  });

  it('a size above 100 % is fitted to the window, never below 100 % and never bigger than chosen', () => {
    expect(fitUiScale(1.5, 1920, 1080)).toBe(1.5);
    expect(fitUiScale(1.5, 1024, 600)).toBe(1.07); // the validator's crowded case: 600 / 560
    expect(fitUiScale(1.5, 1280, 720)).toBe(1.28);
    expect(fitUiScale(1.5, 800, 600)).toBe(1);
    expect(fitUiScale(1.5, 360, 640)).toBe(1);
    // 100 % and smaller always draw as chosen, even in a tiny window
    expect(fitUiScale(0.8, 360, 640)).toBe(0.8);
    expect(fitUiScale(1, 360, 640)).toBe(1);
    // no window (tests, workers): as chosen
    expect(fitUiScale(1.4, 0, 0)).toBe(1.4);
  });

  it('the centre toast stops at 125 %', () => {
    expect(TOAST_UI_MAX).toBe(1.25);
    const css = readFileSync(resolve(__dirname, '../src/ui/comfort.css'), 'utf8').replace(/\r\n/g, '\n');
    expect(css).toContain('.wl-hud > .wl-toast:not(.wl-float):not(.wl-edge):not(.wl-coin) {\n  zoom: var(--wl-ui-toast, 1);');
  });
});

describe('settings tabs', () => {
  it('has a Comfort tab the panel can remember', () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toContain('comfort');
    store['winterland:settingsTab'] = 'comfort';
    expect(readSettingsTab()).toBe('comfort');
  });
});

describe('glow (0.9.8)', () => {
  it('clamps to 0-100 % on 5 % steps; junk and old settings without it are 100 %', () => {
    expect(clampGlow(0.33)).toBe(0.35);
    expect(clampGlow(-1)).toBe(0);
    expect(clampGlow(3)).toBe(1);
    for (const junk of [NaN, Infinity, '0.5', null, {}]) expect(clampGlow(junk)).toBe(1);
    expect(parseComfort('{"glow":0.4}').glow).toBe(0.4);
    expect(parseComfort('{"motion":true}').glow).toBe(1);
  });

  it('is remembered and read back by glowScale()', () => {
    setComfort({ glow: 0.25 });
    reloadComfort();
    expect(glowScale()).toBe(0.25);
  });
});
