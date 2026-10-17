/**
 * 0.9.8 brief 14 (menus, icons and moments): the pure parts of the UI theme, the icon kit and the wooden world tags.
 */
import { describe, expect, it } from 'vitest';
import { INK, lightness } from '../src/render/palette';
import { ICON_INK, kitIcon, liftFill } from '../src/ui/iconKit';
import { NIGHT_FADE, NIGHT_OFF, NIGHT_ON, eraAccent, inkOn, nightStep } from '../src/ui/theme';
import { MAX_GROW, MIN_TEXT_PX, TAG_FAR, TAG_MIN, TAG_NEAR, tagFade, tagGrow } from '../src/ui/worldTag';

describe('night card tone', () => {
  it('turns on at dusk and off at dawn with hysteresis', () => {
    expect(nightStep(0, false, NIGHT_ON - 0.01, 0.1).night).toBe(false);
    expect(nightStep(0, false, NIGHT_ON, 0.1).night).toBe(true);
    // between the two thresholds it keeps whatever it was
    const mid = (NIGHT_ON + NIGHT_OFF) / 2;
    expect(nightStep(1, true, mid, 0.1).night).toBe(true);
    expect(nightStep(0, false, mid, 0.1).night).toBe(false);
    expect(nightStep(1, true, NIGHT_OFF, 0.1).night).toBe(false);
  });

  it('fades over NIGHT_FADE seconds and never overshoots', () => {
    let n = 0;
    let night = false;
    for (let i = 0; i < 10; i++) ({ n, night } = nightStep(n, night, 1, NIGHT_FADE / 4));
    expect(n).toBe(1);
    const half = nightStep(0, false, 1, NIGHT_FADE / 2);
    expect(half.n).toBeCloseTo(0.5, 5);
  });
});

describe('era accents', () => {
  it('gives every era an accent and a readable ink on it', () => {
    for (let e = 1; e <= 10; e++) {
      const a = eraAccent(e);
      expect(Number.isInteger(a)).toBe(true);
      const ink = inkOn(a);
      // the text colour sits on the far side of the accent's lightness
      expect(Math.abs(lightness(ink) - lightness(a))).toBeGreaterThan(0.25);
    }
  });
});

describe('icon kit', () => {
  it('replaces the old navy outlines with the warm ink', () => {
    const out = kitIcon('<svg><path stroke="#1f2b46" fill="#2a3652"/></svg>');
    expect(out).not.toMatch(/1f2b46|2a3652/i);
    expect(out).toContain(ICON_INK);
  });

  it('lifts near-black fills and leaves the rest alone', () => {
    expect(lightness(liftFill(0x101010))).toBeGreaterThan(0.12);
    expect(liftFill(0xf2b644)).toBe(0xf2b644);
    expect(liftFill(INK)).toBe(INK);
    const out = kitIcon('<svg><rect fill="#050505"/><rect fill="#f2b644"/></svg>');
    expect(out).not.toContain('#050505');
    expect(out).toContain('#f2b644');
  });
});

describe('wooden world tags', () => {
  it('fade softly with distance but never vanish', () => {
    expect(tagFade(0)).toBe(1);
    expect(tagFade(TAG_NEAR)).toBe(1);
    expect(tagFade(TAG_FAR)).toBe(TAG_MIN);
    expect(tagFade(1e6)).toBe(TAG_MIN);
    const mid = tagFade((TAG_NEAR + TAG_FAR) / 2);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(TAG_MIN);
    // monotonic
    let last = 2;
    for (let d = 0; d <= TAG_FAR + 5; d += 0.5) {
      const f = tagFade(d);
      expect(f).toBeLessThanOrEqual(last);
      last = f;
    }
  });

  it('grow so their lettering is never under 13 px (within limits)', () => {
    expect(tagGrow(20)).toBe(1);
    expect(tagGrow(MIN_TEXT_PX)).toBe(1);
    expect(tagGrow(MIN_TEXT_PX / 1.5) * (MIN_TEXT_PX / 1.5)).toBeCloseTo(MIN_TEXT_PX, 5);
    expect(tagGrow(1)).toBe(MAX_GROW);
    expect(tagGrow(0)).toBe(1);
    expect(tagGrow(Number.NaN)).toBe(1);
  });
});
