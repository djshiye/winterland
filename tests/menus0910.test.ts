/**
 * 0.9.10 menus, accessibility and credits (T4): the dialog focus rules, the credits list (generated from package.json,
 * licences checked against node_modules), the "Pause when a menu is open" setting and the colour-blind pad inks.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { returnFocusTo, tabStep } from '../src/ui/dialog';
import { BUILT_WITH, COPYRIGHT, creditList, LICENSES } from '../src/ui/CreditsCard';
import { COMFORT_KEY, comfort, parseComfort, reloadComfort, setComfort } from '../src/fx/comfort';
import { tagInks } from '../src/assets/pads';
import { contrast } from '../src/ui/contrast';
import { PAD, UI_TONES } from '../src/render/palette';

const root = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const licenseOf = (name: string): string => (JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8')) as { license: string }).license;

describe('dialog focus rules', () => {
  it('gives focus back only to a keyboard-reached control that is still on screen and outside the card', () => {
    expect(returnFocusTo(null)).toBe(false);
    expect(returnFocusTo({ shown: true, keyboard: true, inside: false })).toBe(true);
    // a mouse opener (the gear after a click) keeps no focus: Space would press it again
    expect(returnFocusTo({ shown: true, keyboard: false, inside: false })).toBe(false);
    expect(returnFocusTo({ shown: false, keyboard: true, inside: false })).toBe(false);
    expect(returnFocusTo({ shown: true, keyboard: true, inside: true })).toBe(false);
  });

  it('Tab wraps both ways and starts at an end', () => {
    expect(tabStep(-1, 3, false)).toBe(0);
    expect(tabStep(-1, 3, true)).toBe(2);
    expect(tabStep(2, 3, false)).toBe(0);
    expect(tabStep(0, 3, true)).toBe(2);
    expect(tabStep(1, 3, false)).toBe(2);
    expect(tabStep(0, 0, false)).toBe(-1);
  });
});

describe('credits', () => {
  it('lists every dependency and the build / desktop tools, with readable licences', () => {
    const list = creditList();
    const pkgs = list.map((c) => c.pkg);
    for (const d of Object.keys(pkg.dependencies)) expect(pkgs).toContain(d);
    for (const d of BUILT_WITH) expect(pkgs).toContain(d);
    const by = Object.fromEntries(list.map((c) => [c.name, c.license]));
    expect(by).toMatchObject({ 'three.js': 'MIT', Electron: 'MIT', Vite: 'MIT', 'Fredoka font': 'SIL OFL 1.1' });
  });

  it('every credited package has a licence entry that matches its installed package.json', () => {
    for (const c of creditList()) {
      expect(LICENSES[c.pkg], `${c.pkg} needs an entry in LICENSES (ui/CreditsCard.ts)`).toBeTruthy();
      expect(LICENSES[c.pkg]).toBe(licenseOf(c.pkg));
    }
  });

  it('shows the same copyright line as the LICENSE file', () => {
    expect(readFileSync(resolve(root, 'LICENSE'), 'utf8').split(/\r?\n/)[0]).toBe(COPYRIGHT);
  });

  it('follows package.json: a new dependency shows up, a removed one goes', () => {
    const list = creditList({ three: '1', 'left-pad': '1' }, { vite: '1' });
    expect(list.map((c) => c.pkg)).toEqual(['three', 'vite', 'left-pad']);
    expect(list[2]).toMatchObject({ name: 'left-pad', license: 'See its licence' });
  });
});

describe('Pause when a menu is open', () => {
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

  it('is off by default and when the stored value is damaged', () => {
    expect(comfort().menuPause).toBe(false);
    expect(parseComfort('{"menuPause":"yes"}').menuPause).toBe(false);
    expect(parseComfort('{"menuPause":true}').menuPause).toBe(true);
  });

  it('is remembered with the other comfort settings', () => {
    setComfort({ menuPause: true });
    expect(JSON.parse(store[COMFORT_KEY]!).menuPause).toBe(true);
    reloadComfort();
    expect(comfort().menuPause).toBe(true);
  });
});

describe('colour-blind pad inks', () => {
  it('swap the greens for the HUD sky blue', () => {
    expect(tagInks(false)).toEqual({ done: PAD.done, cash: PAD.cashInk });
    const cb = tagInks(true);
    expect(cb.done).toBe(UI_TONES.cbgood);
    expect(cb.cash).not.toBe(PAD.cashInk);
  });

  it('keep the cash amount readable on the cream tag', () => {
    for (const on of [false, true]) expect(contrast(tagInks(on).cash, PAD.tag)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tagInks(true).done, PAD.tag)).toBeGreaterThanOrEqual(3);
  });
});
