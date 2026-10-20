/**
 * 0.9.12 guide fixes: expansionWants (the next expansion's cash is paid and it still wants an item kind, so the crate
 * runner leaves crates for the player) and sanitizeWorld keeping the saved player spot (`at`) only when it is two finite
 * numbers inside the world.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState } from '../src/core/types';
import { sanitizeWorld } from '../src/core/Save';
import { ERAS } from '../src/eras/data';
import { expansionOffered, expansionWants } from '../src/eras/layout';
import { meetGate } from './gateHelpers';

/** Era 1, the climb open and era 2's gate met: its pad is offered. */
function offered(): GameState {
  const s = createGameState();
  s.village.revealed = true;
  meetGate(s, 2);
  return s;
}

describe('expansionWants', () => {
  const kind = ERAS[2]!.unlock.extra.kind;
  const need = ERAS[2]!.unlock.extra.count;
  const cash = ERAS[2]!.unlock.cash;

  it('is false before the climb opens', () => {
    const s = createGameState();
    expect(expansionOffered(s, 2)).toBe(false);
    expect(expansionWants(s, kind)).toBe(false);
  });

  it('is false while the expansion is not offered, even with cash paid in (gate not met, nothing grandfathered)', () => {
    const s = createGameState();
    expect(expansionWants(s, kind)).toBe(false);
  });

  it('is false before the cash is paid', () => {
    const s = offered();
    expect(expansionOffered(s, 2)).toBe(true);
    expect(expansionWants(s, kind)).toBe(false);
    s.eras.regions[2]!.cash = cash - 1;
    expect(expansionWants(s, kind)).toBe(false);
  });

  it('is false when the expansion wants a different kind', () => {
    const s = offered();
    s.eras.regions[2]!.cash = cash;
    expect(expansionWants(s, kind)).toBe(true);
    expect(expansionWants(s, 'not-the-kind')).toBe(false);
    expect(expansionWants(s, 'log')).toBe(kind === 'log');
  });

  it('is true when the cash is paid in full and fewer than the needed items are delivered', () => {
    const s = offered();
    s.eras.regions[2]!.cash = cash;
    s.eras.regions[2]!.extra = 0;
    expect(expansionWants(s, kind)).toBe(true);
    s.eras.regions[2]!.extra = need - 1;
    expect(expansionWants(s, kind)).toBe(true);
  });

  it('is false once all the items are delivered', () => {
    const s = offered();
    s.eras.regions[2]!.cash = cash;
    s.eras.regions[2]!.extra = need;
    expect(expansionWants(s, kind)).toBe(false);
  });

  it('is false once the era is reached (the next expansion is era 3, not paid)', () => {
    const s = offered();
    s.eras.regions[2]!.cash = cash;
    s.eras.age = 2;
    expect(expansionWants(s, kind)).toBe(false);
  });
});

describe('sanitizeWorld keeps the saved spot', () => {
  it('keeps a valid at', () => {
    expect(sanitizeWorld({ at: { x: 12.5, z: -40 } }).at).toEqual({ x: 12.5, z: -40 });
    expect(sanitizeWorld({ at: { x: 5000, z: -5000 } }).at).toEqual({ x: 5000, z: -5000 });
  });

  it('keeps only x and z (no extra fields)', () => {
    expect(sanitizeWorld({ at: { x: 1, z: 2, y: 3, evil: 'x' } }).at).toEqual({ x: 1, z: 2 });
  });

  it('drops NaN, Infinity, strings, huge values, partial and non-object values', () => {
    for (const at of [
      { x: Number.NaN, z: 0 },
      { x: 0, z: Number.POSITIVE_INFINITY },
      { x: '3', z: 4 },
      { x: 5001, z: 0 },
      { x: 0, z: -5001 },
      { x: 1e9, z: 1e9 },
      { x: 3 },
      { z: 3 },
      {},
      null,
      'here',
      42,
      [1, 2],
    ]) {
      const w = sanitizeWorld({ at });
      expect('at' in w, JSON.stringify(at)).toBe(false);
    }
  });

  it('has no at when the field is missing, and the rest of the snapshot is unaffected', () => {
    const w = sanitizeWorld({});
    expect('at' in w).toBe(false);
    expect(w.piles.hopper).toBe(0);
    expect(sanitizeWorld(undefined).at).toBeUndefined();
  });
});
