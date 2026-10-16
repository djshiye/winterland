/** 0.9.2: the centred banners dodge the HUD beside them (ui/bannerStack.ts, pure layout). */
import { describe, expect, it } from 'vitest';
import { GAP, centreIn, freeSpan, type Box } from '../src/ui/bannerStack';

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

describe('banner free span', () => {
  const quests = box(12, 120, 230, 390); // the open quest list, top left
  const buttons = box(900, 12, 1268, 60); // the top-right button row
  it('is the whole width minus the margins when nothing shares the rows', () => {
    expect(freeSpan(1280, [quests, buttons], 400, 450, 12)).toEqual({ min: 12, max: 1268 });
  });
  it('starts right of the left column and ends left of the right-hand HUD on shared rows', () => {
    expect(freeSpan(1280, [quests], 150, 200, 12)).toEqual({ min: 230 + GAP, max: 1268 });
    expect(freeSpan(1280, [quests, buttons], 20, 200, 12)).toEqual({ min: 230 + GAP, max: 900 - GAP });
  });
  it('never inverts', () => {
    const s = freeSpan(400, [box(0, 0, 300, 100), box(250, 0, 400, 100)], 10, 50, 12);
    expect(s.max).toBeGreaterThanOrEqual(s.min);
  });
});

describe('banner centre', () => {
  it('stays on the screen centre when it fits there', () => {
    expect(centreIn(1280, { min: 238, max: 1268 }, 380)).toBe(640);
  });
  it('moves into the free room when the centre would overlap the left column (800 px wide, the event pill)', () => {
    const span = { min: 238, max: 788 };
    const x = centreIn(800, span, 420);
    expect(x - 210).toBeGreaterThanOrEqual(span.min);
    expect(x + 210).toBeLessThanOrEqual(span.max);
  });
  it('a banner wider than the room is centred in it', () => {
    expect(centreIn(700, { min: 238, max: 688 }, 600)).toBe(463);
  });
});
