/** 0.9.12 review bundle 5 (phone and layout): the pure parts of the fixes. */
import { describe, expect, it } from 'vitest';
import { GAP, phoneObjectiveTop, questListShift } from '../src/ui/bannerStack';
import { declutter, type TagRect } from '../src/ui/worldTag';
import { playerHoleRadius } from '../src/render/OcclusionFade';
import { CAMERA } from '../src/config';
import { formatPopulation } from '../src/ui/agesLogic';

const r = (left: number, top: number, right: number, bottom: number): TagRect => ({ left, top, right, bottom });

describe('P1: phone camera', () => {
  it('a portrait phone shows at least 16 m across (the counter, cash piles and pads fit at the start)', () => {
    expect(CAMERA.minViewWidth).toBeGreaterThanOrEqual(16);
  });
});

describe('P2 / P4: phone objective banner', () => {
  it('sits GAP under the lowest piece of the top HUD', () => {
    expect(phoneObjectiveTop([55, 115, 151], 12)).toBe(151 + GAP);
    expect(phoneObjectiveTop([], 12)).toBe(12);
    expect(phoneObjectiveTop([Number.NaN, 40], 12)).toBe(40 + GAP);
  });
  it('an open quest list drops below the banner instead of moving it', () => {
    expect(questListShift(153, 210)).toBe(210 + GAP - 153);
    expect(questListShift(300, 210)).toBe(0);
    expect(questListShift(153, null)).toBe(0);
  });
});

describe('V1: world signs never pile up', () => {
  it('keeps the nearest sign and hides the one overlapping it', () => {
    const keep = declutter([
      { rect: r(100, 100, 200, 160), rank: 5 },
      { rect: r(150, 130, 250, 190), rank: 2 },
      { rect: r(400, 100, 500, 160), rank: 9 },
    ]);
    expect(keep).toEqual([false, true, true]);
  });
  it('signs that only touch (a few px) both stay', () => {
    expect(declutter([
      { rect: r(0, 0, 100, 50), rank: 1 },
      { rect: r(98, 0, 200, 50), rank: 2 },
    ])).toEqual([true, true]);
  });
  it('a chain: the far sign comes back once its blocker is hidden', () => {
    // A (nearest) hides B; C overlaps only B, so C shows
    expect(declutter([
      { rect: r(0, 0, 100, 50), rank: 1 },
      { rect: r(60, 0, 160, 50), rank: 2 },
      { rect: r(120, 0, 220, 50), rank: 3 },
    ])).toEqual([true, false, true]);
  });
});

describe('V4: towers open up around the player', () => {
  it('a low building keeps the small hole, the tallest towers a wide one', () => {
    expect(playerHoleRadius(4)).toBe(1.6);
    expect(playerHoleRadius(14)).toBeGreaterThan(2.5);
    expect(playerHoleRadius(22)).toBeCloseTo(4.8, 5);
    expect(playerHoleRadius(60)).toBe(5.2);
  });
});

describe('V5: population on the village badge', () => {
  it('reads 468K, not 468085', () => {
    expect(formatPopulation(468_085)).toBe('468K');
  });
});
