/**
 * 0.9.12 keyboard and gamepad pass (full review bundle 3, K1-K5): every build card, map place and top button is
 * reachable without a mouse, and the labels say what screen readers need. The menus are DOM code, so these checks
 * read the sources (as tests/controls097.test.ts does); the real play-through is done in the browser.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyLabel } from '../src/ui/dom';

const src = (p: string): string => readFileSync(resolve(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

describe('K1: build and choose cards are real buttons', () => {
  for (const file of ['src/ui/BuildPanel.ts', 'src/ui/ChoosePanel.ts']) {
    it(file, () => {
      const s = src(file);
      expect(s).toContain("h('button', 'wl-build-go')");
      expect(s).not.toContain("root.setAttribute('role', 'button')");
      // a locked card is still reachable and says why
      expect(s).toContain("go.setAttribute('aria-disabled', 'true')");
    });
  }
});

describe('menu navigation', () => {
  const nav = src('src/input/menuNav.ts');
  it('steps into a menu on its first real choice, never the corner X', () => {
    expect(nav).toContain("const CLOSE_X = '.wl-card-x, .wl-shop-close, .wl-build-close'");
    expect(nav).toContain('this.focus(firstChoice(items))');
  });
  it('K2: no second dialog round a card that already is one', () => {
    expect(nav).toContain('if (modal.querySelector(\'[role="dialog"], [role="alertdialog"]\')) return;');
  });
  it('the top buttons work as a menu for the gamepad', () => {
    expect(nav).toContain('toggleBar(): boolean');
    const input = src('src/input/Input.ts');
    expect(input).toContain('if (f.pressed.has(BTN.back)) nav.toggleBar();');
    expect(input).toContain("if (f.pressed.has(BTN.y)) this.shortcutCb?.('map');");
    expect(input).not.toContain('f.pressed.has(BTN.back)) this.shortcutCb');
  });
});

describe('controls list matches the bindings', () => {
  const s = src('src/ui/SettingsPanel.ts');
  it('names every gamepad button', () => {
    for (const k of ["'Stick'", "'D-pad'", "'A'", "'B'", "'Start'", "'Y / X'", "'Back / View'", "'LB / RB'"]) expect(s).toContain(`[${k},`);
  });
  it('says what Esc really does', () => {
    expect(s).toContain("['Esc', 'close the top card; with none open, fold the quests, then Settings']");
  });
});

describe('K3: states and names for screen readers', () => {
  it('the sound button says on / off', () => {
    const hud = src('src/ui/HUD.ts');
    expect(hud).toContain("this.muteBtn.setAttribute('aria-pressed', String(!muted))");
    expect(hud).not.toContain("'Toggle sound'");
  });
  it('shop, market and guidebook tabs are tabs with a selected one', () => {
    for (const f of ['src/ui/ShopPanel.ts', 'src/ui/MarketPanel.ts', 'src/ui/GuidebookPanel.ts']) {
      const s = src(f);
      expect(s).toContain("b.setAttribute('role', 'tab')");
      expect(s).toContain("setAttribute('aria-selected'");
    }
  });
  it('a shop button the player cannot afford keeps the focus and says why', () => {
    const s = src('src/ui/ShopPanel.ts');
    expect(s).not.toContain('c.btn.disabled =');
    expect(s).toContain(', not enough money yet');
  });
  it('map places are focusable buttons', () => {
    expect(src('src/ui/MapPanel.ts')).toContain('tabindex="0" role="button" aria-label="Travel to ');
  });
  it('the quest header and era chip read their progress in words', () => {
    expect(src('src/ui/QuestPanel.ts')).toContain('`Quests: ${q.doneCount} of ${q.total} done`');
    expect(src('src/ui/EraChip.ts')).toContain('settlement ${Math.min(c.settlement, c.settlementNeed)} of ${c.settlementNeed}');
  });
});

describe('K4: key hints', () => {
  it('keep the key with a keyboard (no window here = not touch-only)', () => {
    expect(keyLabel('Map', 'T')).toBe('Map (T)');
    expect(keyLabel('Guidebook', 'G', ': a new chapter to read')).toBe('Guidebook (G): a new chapter to read');
  });
});
