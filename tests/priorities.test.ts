/** Wave 11 crew priorities: the pure wood-routing helpers in npc/crewHelpers.ts. */
import { describe, expect, it } from 'vitest';
import { PRIORITIES } from '../src/config';
import { pineTarget, woodDest } from '../src/npc/crewHelpers';

describe('woodDest (log hauler)', () => {
  const fill = (free: number, room = true) => ({ room, free });

  it('trucks: the truck counter whenever it has room, even when the walk-in is emptier', () => {
    expect(woodDest('trucks', fill(0.1), fill(0.9))).toBe('truck');
    expect(woodDest('trucks', fill(0.5), fill(0.5))).toBe('truck');
  });

  it('balanced: the counter with the larger free share, ties to the truck', () => {
    expect(woodDest('balanced', fill(0.1), fill(0.9))).toBe('walkIn');
    expect(woodDest('balanced', fill(0.9), fill(0.1))).toBe('truck');
    expect(woodDest('balanced', fill(0.5), fill(0.5))).toBe('truck');
  });

  it('trains and workshop steer like balanced', () => {
    for (const p of ['trains', 'workshop'] as const) {
      expect(woodDest(p, fill(0.1), fill(0.9))).toBe('walkIn');
      expect(woodDest(p, fill(0.9), fill(0.1))).toBe('truck');
    }
  });

  it('only a counter with room counts, and a missing truck counter is skipped', () => {
    for (const p of PRIORITIES.wood) {
      expect(woodDest(p, fill(0.9, false), fill(0.1))).toBe('walkIn');
      expect(woodDest(p, fill(0.1), fill(0.9, false))).toBe('truck');
      expect(woodDest(p, null, fill(0.1))).toBe('walkIn');
      expect(woodDest(p, null, null)).toBeNull();
      expect(woodDest(p, fill(0.5, false), fill(0.5, false))).toBeNull();
    }
  });
});

describe('pineTarget (pine hauler)', () => {
  const low = PRIORITIES.workshopLow;

  it('no workshop: always the platform', () => {
    for (const p of PRIORITIES.wood) expect(pineTarget(p, null, false)).toBe('platform');
  });

  it('feeds a low hopper when no sled loader is hired (balanced, trucks) or when the workshop is prioritised', () => {
    expect(pineTarget('balanced', 0, false)).toBe('hopper');
    expect(pineTarget('trucks', low - 1, false)).toBe('hopper');
    expect(pineTarget('workshop', 0, false)).toBe('hopper');
    expect(pineTarget('workshop', 0, true)).toBe('hopper');
  });

  it('leaves the hopper to the sled loader when one is hired and the workshop is not prioritised', () => {
    expect(pineTarget('balanced', 0, true)).toBe('platform');
    expect(pineTarget('trucks', 0, true)).toBe('platform');
  });

  it('a hopper at or above workshopLow gets nothing', () => {
    expect(pineTarget('workshop', low, false)).toBe('platform');
    expect(pineTarget('balanced', low + 3, false)).toBe('platform');
  });

  it('trains never diverts', () => {
    expect(pineTarget('trains', 0, false)).toBe('platform');
    expect(pineTarget('trains', 0, true)).toBe('platform');
  });
});
