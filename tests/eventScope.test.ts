import { describe, expect, it } from 'vitest';
import { eventShowsIn } from '../src/ui/eventScope';

describe('event banners show only where the event changes something (0.9.13, U2)', () => {
  it('rush hour and festival day show at the mill and the Market Town only', () => {
    expect(eventShowsIn('rush', 0)).toBe(true);
    expect(eventShowsIn('festival', 0)).toBe(true);
    for (let n = 2; n <= 10; n++) {
      expect(eventShowsIn('rush', n)).toBe(false);
      expect(eventShowsIn('festival', n)).toBe(false);
    }
  });

  it('snowstorm and the northern lights show everywhere', () => {
    for (const n of [0, 2, 9]) {
      expect(eventShowsIn('snowstorm', n)).toBe(true);
      expect(eventShowsIn('aurora', n)).toBe(true);
    }
  });
});
