/**
 * 0.9.11 frame limiter (core/fps.ts): Auto draws at most 60 fps, 30 while another window has focus, and a capped rate
 * averages out right on 60, 75, 120 and 144 Hz screens.
 */
import { describe, expect, it } from 'vitest';
import { AUTO_FPS, UNFOCUSED_FPS, frameDue, targetFps } from '../src/core/fps';

/** Frames drawn in one second of a `hz` display under `fps`. */
function drawn(hz: number, fps: number): number {
  let last = 0;
  let n = 0;
  for (let i = 1; i <= hz; i++) {
    const due = frameDue((i * 1000) / hz, last, fps);
    if (due === null) continue;
    last = due;
    n++;
  }
  return n;
}

describe('frame rate', () => {
  it('Auto is 60 focused, 30 unfocused; a set cap never rises', () => {
    expect(targetFps(0, true)).toBe(AUTO_FPS);
    expect(targetFps(0, false)).toBe(UNFOCUSED_FPS);
    expect(targetFps(60, false)).toBe(30);
    expect(targetFps(30, true)).toBe(30);
  });

  it.each([60, 75, 120, 144, 165])('a %i Hz screen draws about 60 under Auto', (hz) => {
    expect(Math.abs(drawn(hz, 60) - Math.min(hz, 60))).toBeLessThanOrEqual(2);
  });

  it.each([60, 120, 144])('a %i Hz screen draws about 30 unfocused', (hz) => {
    expect(Math.abs(drawn(hz, 30) - 30)).toBeLessThanOrEqual(2);
  });

  it('a stall restarts the clock instead of drawing a burst of catch-up frames', () => {
    const last = frameDue(2000, 1000, 60);
    expect(last).toBe(2000);
    expect(frameDue(2005, 2000, 60)).toBeNull();
  });
});
