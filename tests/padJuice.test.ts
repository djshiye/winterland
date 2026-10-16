/** Pad juice, the pure part (fx/padJuice.ts): the tick pitch ladder, jitter, voice cap, reduced-motion scaling, bounce. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PENTATONIC,
  PITCH_JITTER,
  REDUCED_MOTION_SCALE,
  TICK_RESET,
  TICK_STEP_EVERY,
  TickLadder,
  admitVoice,
  bounceScale,
  breath,
  burstCount,
  fillApproach,
  motionScale,
  pentatonicPitch,
  pitchJitter,
  reducedMotion,
  setReducedMotion,
} from '../src/fx/padJuice';

afterEach(() => {
  setReducedMotion(null);
  vi.unstubAllGlobals();
});

describe('pentatonic tick ladder', () => {
  it('pentatonicPitch follows the major pentatonic and clamps at both ends', () => {
    expect(pentatonicPitch(0)).toBe(1);
    expect(pentatonicPitch(-3)).toBe(1);
    expect(pentatonicPitch(3)).toBeCloseTo(Math.pow(2, 7 / 12), 10);
    const top = Math.pow(2, PENTATONIC[PENTATONIC.length - 1]! / 12);
    expect(pentatonicPitch(PENTATONIC.length - 1)).toBeCloseTo(top, 10);
    expect(pentatonicPitch(99)).toBeCloseTo(top, 10);
  });

  it('never gets shrill: the top of the ladder stays under two octaves', () => {
    expect(PENTATONIC[PENTATONIC.length - 1]!).toBeLessThan(24);
    for (let i = 1; i < PENTATONIC.length; i++) expect(PENTATONIC[i]!).toBeGreaterThan(PENTATONIC[i - 1]!);
  });

  it('climbs one step every TICK_STEP_EVERY ticks while paying, then holds at the top', () => {
    const l = new TickLadder();
    const pitches: number[] = [];
    for (let i = 0; i < 40; i++) pitches.push(l.next(i * 0.07));
    for (let i = 0; i < TICK_STEP_EVERY; i++) expect(pitches[i]).toBe(1);
    expect(pitches[TICK_STEP_EVERY]).toBeCloseTo(pentatonicPitch(1), 10);
    for (let i = 1; i < pitches.length; i++) expect(pitches[i]!).toBeGreaterThanOrEqual(pitches[i - 1]!);
    expect(pitches[pitches.length - 1]).toBeCloseTo(pentatonicPitch(PENTATONIC.length - 1), 10);
    expect(l.step).toBe(PENTATONIC.length - 1);
  });

  it('starts over at the bottom after a pause', () => {
    const l = new TickLadder();
    for (let i = 0; i < 12; i++) l.next(i * 0.07);
    expect(l.next(0.77 + TICK_RESET)).toBe(1);
    expect(l.step).toBe(0);
    l.reset();
    expect(l.next(100)).toBe(1);
  });

  it('jitter stays within ±3 % and is centred', () => {
    expect(pitchJitter(0)).toBeCloseTo(1 - PITCH_JITTER, 10);
    expect(pitchJitter(0.5)).toBe(1);
    expect(pitchJitter(1)).toBeCloseTo(1 + PITCH_JITTER, 10);
    expect(pitchJitter(5)).toBeCloseTo(1 + PITCH_JITTER, 10);
    for (let i = 0; i < 50; i++) {
      const p = pitchJitter();
      expect(Math.abs(p - 1)).toBeLessThanOrEqual(PITCH_JITTER + 1e-12);
    }
    const l = new TickLadder();
    expect(l.next(0, 1)).toBeCloseTo(1 + PITCH_JITTER, 10);
  });
});

describe('voice cap', () => {
  it('admits up to max overlapping voices and frees them as they end', () => {
    const ends: number[] = [];
    expect(admitVoice(ends, 0, 2, 0.2)).toBe(true);
    expect(admitVoice(ends, 0.05, 2, 0.2)).toBe(true);
    expect(admitVoice(ends, 0.1, 2, 0.2)).toBe(false);
    expect(ends).toHaveLength(2);
    expect(admitVoice(ends, 0.21, 2, 0.2)).toBe(true); // the first voice ended at 0.2
    expect(ends).toEqual([0.25, 0.41].map((v) => expect.closeTo(v, 10)));
  });
});

describe('reduced motion', () => {
  it('reads prefers-reduced-motion when no preference is forced', () => {
    const asked: string[] = [];
    const media = (matches: boolean) => (q: string) => {
      asked.push(q);
      return { matches, addEventListener: () => undefined };
    };
    vi.stubGlobal('window', { matchMedia: media(true) });
    setReducedMotion(null);
    expect(reducedMotion()).toBe(true);
    expect(asked).toEqual(['(prefers-reduced-motion: reduce)']);
    vi.stubGlobal('window', { matchMedia: media(false) });
    setReducedMotion(null);
    expect(reducedMotion()).toBe(false);
    setReducedMotion(true); // a forced preference wins over the media query
    expect(reducedMotion()).toBe(true);
    vi.stubGlobal('window', undefined);
    setReducedMotion(null);
    expect(reducedMotion()).toBe(false); // no window (tests, workers): full motion
  });

  it('scales bounces and skips bursts', () => {
    expect(motionScale(false)).toBe(1);
    expect(motionScale(true)).toBe(REDUCED_MOTION_SCALE);
    expect(REDUCED_MOTION_SCALE).toBeLessThan(0.5);
    expect(burstCount(16, false)).toBe(16);
    expect(burstCount(15.4, false)).toBe(15);
    expect(burstCount(16, true)).toBe(0);
    setReducedMotion(true);
    expect(motionScale()).toBe(REDUCED_MOTION_SCALE);
    expect(burstCount(10)).toBe(0);
  });

  it('holds the idle glow steady instead of breathing', () => {
    expect(breath(0, true)).toBe(breath(3.7, true));
    expect(breath(0, false)).not.toBe(breath(0.8, false));
    for (let t = 0; t < 10; t += 0.3) {
      const b = breath(t, false);
      expect(b).toBeGreaterThanOrEqual(0.35 - 1e-9);
      expect(b).toBeLessThanOrEqual(0.75 + 1e-9);
    }
  });
});

describe('bounce and fill easing', () => {
  it('bounceScale squashes and stretches, peaks near the middle and ends at exactly 1', () => {
    const s = bounceScale(0, 1.4);
    expect(s.y).toBeLessThan(1); // lands squashed
    expect(s.xz).toBeGreaterThan(1);
    expect(bounceScale(1, 1.4)).toEqual({ xz: 1, y: 1 });
    expect(bounceScale(1.5, 1.4)).toEqual({ xz: 1, y: 1 });
    const mid = bounceScale(0.5, 1.4);
    expect(Math.max(mid.xz, mid.y)).toBeGreaterThan(1.2);
  });

  it('reduced motion shrinks the bounce', () => {
    let full = 0;
    let small = 0;
    for (let k = 0; k <= 1; k += 0.05) {
      const a = bounceScale(k, 1.45, 1);
      const b = bounceScale(k, 1.45, REDUCED_MOTION_SCALE);
      full = Math.max(full, Math.abs(a.xz - 1), Math.abs(a.y - 1));
      small = Math.max(small, Math.abs(b.xz - 1), Math.abs(b.y - 1));
    }
    expect(small).toBeLessThan(full * 0.4);
  });

  it('fillApproach eases toward the target, frame-rate independent, and snaps when close', () => {
    expect(fillApproach(0, 1, 0)).toBe(0);
    const one = fillApproach(0, 1, 0.1);
    const two = fillApproach(fillApproach(0, 1, 0.05), 1, 0.05);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(1);
    expect(two).toBeCloseTo(one, 10);
    let v = 0;
    for (let i = 0; i < 200; i++) v = fillApproach(v, 0.6, 1 / 60);
    expect(v).toBe(0.6);
  });
});
