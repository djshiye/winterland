/** 0.9.7 comfort and controls: menu navigation picking, the gamepad's dead zone / directions / repeat, rumble. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextInDirection, tabIndexAfter, type NavBox } from '../src/input/menuNav';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESCAPE_ORDER, escapeTarget } from '../src/ui/escapeOrder';
import { BTN, deadZone, dirOf, PadReader, PadRepeat, REPEAT_DELAY, REPEAT_EVERY, rumble } from '../src/input/Gamepad';

const box = (x: number, y: number, w = 100, h = 40): NavBox => ({ left: x, top: y, right: x + w, bottom: y + h });

describe('menu navigation', () => {
  // a 2 x 2 grid of buttons and a wide one below
  const grid = [box(0, 0), box(120, 0), box(0, 60), box(120, 60), box(0, 120, 220)];

  it('arrows pick the nearest control in that direction', () => {
    const others = (i: number) => grid.filter((_, k) => k !== i);
    const pick = (i: number, d: 'up' | 'down' | 'left' | 'right') => {
      const j = nextInDirection(grid[i]!, others(i), d);
      return j < 0 ? -1 : grid.indexOf(others(i)[j]!);
    };
    expect(pick(0, 'right')).toBe(1);
    expect(pick(0, 'down')).toBe(2);
    expect(pick(1, 'down')).toBe(3);
    expect(pick(3, 'left')).toBe(2);
    expect(pick(2, 'down')).toBe(4);
    expect(pick(4, 'up')).toBe(2);
    expect(pick(0, 'up')).toBe(-1);
    expect(pick(1, 'right')).toBe(-1);
  });

  it('Down lands on the very next row even when its only control sits far to the side', () => {
    const tab = box(0, 0, 100, 40);
    const sw = box(380, 60, 90, 40);
    const slider = box(230, 130, 170, 30);
    expect(nextInDirection(tab, [slider, sw], 'down')).toBe(1);
    expect(nextInDirection(sw, [tab, slider], 'down')).toBe(1);
  });

  it('Tab cycles and wraps both ways', () => {
    expect(tabIndexAfter(-1, 3, false)).toBe(0);
    expect(tabIndexAfter(-1, 3, true)).toBe(2);
    expect(tabIndexAfter(2, 3, false)).toBe(0);
    expect(tabIndexAfter(0, 3, true)).toBe(2);
    expect(tabIndexAfter(0, 0, false)).toBe(-1);
  });
});

describe('gamepad', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ignores a resting stick and reaches full tilt', () => {
    expect(deadZone(0.1, -0.1)).toEqual({ x: 0, y: 0 });
    const full = deadZone(1, 0);
    expect(full.x).toBeCloseTo(1);
    const half = deadZone(0.6, 0);
    expect(half.x).toBeGreaterThan(0);
    expect(half.x).toBeLessThan(0.6);
  });

  it('turns a push into one menu direction (screen y down)', () => {
    expect(dirOf(0.2, 0.1)).toBeNull();
    expect(dirOf(0.9, 0.3)).toBe('right');
    expect(dirOf(-0.2, -0.8)).toBe('up');
    expect(dirOf(0, 1)).toBe('down');
  });

  it('repeats a held direction after a pause, then steadily', () => {
    const r = new PadRepeat();
    expect(r.step('down', 0)).toBe(true);
    expect(r.step('down', REPEAT_DELAY - 0.01)).toBe(false);
    expect(r.step('down', REPEAT_DELAY + 0.01)).toBe(true);
    expect(r.step('down', REPEAT_DELAY + 0.02)).toBe(false);
    expect(r.step('down', REPEAT_DELAY + REPEAT_EVERY + 0.02)).toBe(true);
    expect(r.step(null, 5)).toBe(false);
    expect(r.step('up', 5)).toBe(true);
  });

  it('reports buttons that went down this frame only once, and no pad without the API', () => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    const pad = { index: 0, connected: true, buttons, axes: [0, 0, 0, 0] };
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    const r = new PadReader();
    expect(r.read()!.pressed.size).toBe(0);
    buttons[BTN.a]!.pressed = true;
    expect(r.read()!.pressed.has(BTN.a)).toBe(true);
    expect(r.read()!.pressed.has(BTN.a)).toBe(false);
    expect(r.read()!.held.has(BTN.a)).toBe(true);
    vi.stubGlobal('navigator', {});
    expect(new PadReader().read()).toBeNull();
    expect(() => rumble(40)).not.toThrow();
  });

  it('rumbles the pad when it can', () => {
    const playEffect = vi.fn(() => Promise.resolve());
    const pad = { index: 0, connected: true, buttons: [], axes: [0, 0], vibrationActuator: { playEffect } };
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    rumble(40, 0.5);
    expect(playEffect).toHaveBeenCalledWith('dual-rumble', expect.objectContaining({ duration: 40 }));
  });
});

describe('Esc / gamepad B close the topmost menu (0.9.7 + the ending cards)', () => {
  it('closes the finale / stats card before anything else, so B never opens Settings behind it', () => {
    // (0.9.8: only the update card / changelog sits above it)
    expect(ESCAPE_ORDER[0]).toBe('update');
    expect(ESCAPE_ORDER[1]).toBe('seasonConfirm');
    expect(ESCAPE_ORDER[2]).toBe('finale');
    expect(escapeTarget({ finale: true, settings: true, map: true })).toBe('finale');
    expect(escapeTarget({ finale: true })).toBe('finale');
  });

  it('with the New Season confirm showing, Esc / B go back to the stats (its Cancel), never start or close', () => {
    expect(escapeTarget({ seasonConfirm: true, finale: true })).toBe('seasonConfirm');
  });

  it('keeps the old order for the other menus, and returns null with nothing open', () => {
    expect(escapeTarget({ settings: true, map: true })).toBe('settings');
    expect(escapeTarget({ map: true, shop: true })).toBe('map');
    expect(escapeTarget({ shop: true, build: true, ageCard: true })).toBe('shop');
    expect(escapeTarget({ ageCard: true })).toBe('ageCard');
    expect(escapeTarget({})).toBeNull();
  });

  it('HUD.escape asks escapeTarget and handles every target', () => {
    const hud = readFileSync(resolve(__dirname, '../src/ui/HUD.ts'), 'utf8').replace(/\r\n/g, '\n');
    const body = hud.slice(hud.indexOf('  private escape(): void {'), hud.indexOf('  private static buildArrow'));
    expect(body).toContain('escapeTarget({');
    for (const k of ESCAPE_ORDER) expect(body).toContain(`case '${k}':`);
  });
});
