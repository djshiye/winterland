/** Reveal order of the wave 7 pads (pure rules in src/progression/reveals.ts). */
import { describe, expect, it } from 'vitest';
import { REVEALS, type RevealQuery } from '../src/progression/reveals';
import { createGameState, type GameState, type PadId } from '../src/core/types';

const rule = (id: string) => REVEALS.find((r) => r.id === id)!;

/** A query over `state`, with the given seconds since each pad unlocked and a fixed cash pile count. */
function query(state: GameState, since: Partial<Record<PadId, number>> = {}, piles = 4): RevealQuery {
  return {
    state,
    sinceUnlock: (id) => since[id] ?? Number.NEGATIVE_INFINITY,
    sinceReveal: () => Number.NEGATIVE_INFINITY,
    cashPiles: () => piles,
  };
}

/** The state of a game that just built the mega saw. */
function afterMegaSaw(): GameState {
  const s = createGameState();
  for (const id of ['harvester', 'processor', 'westConveyor', 'eastConveyor', 'megaSaw'] as const) s.unlocked[id] = true;
  return s;
}

describe('reveal table', () => {
  it('has unique ids and flags', () => {
    const ids = REVEALS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const flags = REVEALS.map((r) => r.flag ?? `reveal:${r.id}`);
    expect(new Set(flags).size).toBe(flags.length);
  });

  it('every wave 7 pad has a pad rule and the two machines get level pads', () => {
    const pads = REVEALS.filter((r) => r.action.kind === 'pad').map((r) => (r.action.kind === 'pad' ? r.action.id : ''));
    for (const id of ['truckLoader', 'ridge', 'treeFeller', 'cashTubes']) expect(pads).toContain(id);
    const levels = REVEALS.filter((r) => r.action.kind === 'levelPad').map((r) => (r.action.kind === 'levelPad' ? r.action.id : ''));
    for (const id of ['treeFeller', 'cashTubes']) expect(levels).toContain(id);
  });
});

describe('wave 7 reveal order', () => {
  it('nothing is offered before the mega saw', () => {
    const s = createGameState();
    s.stats.trucksServed = 99;
    s.village.level = 5;
    const q = query(s);
    for (const id of ['truckLoaderPad', 'ridgePad', 'treeFellerPad', 'cashTubesPad']) expect(rule(id).ready(q)).toBe(false);
  });

  it('truck loader waits for a few truck sales; the ridge waits for the loader (or Town)', () => {
    const s = afterMegaSaw();
    expect(rule('truckLoaderPad').ready(query(s))).toBe(false);
    s.stats.trucksServed = 2;
    expect(rule('truckLoaderPad').ready(query(s))).toBe(false);
    s.stats.trucksServed = 3;
    expect(rule('truckLoaderPad').ready(query(s))).toBe(true);
    expect(rule('ridgePad').ready(query(s))).toBe(false);
    s.unlocked.truckLoader = true;
    expect(rule('ridgePad').ready(query(s))).toBe(true);
    expect(rule('truckLoaderPad').satisfied?.(query(s))).toBe(true);
  });

  it('the ridge also opens at Town without the loader', () => {
    const s = afterMegaSaw();
    s.village.level = 2;
    expect(rule('ridgePad').ready(query(s))).toBe(false);
    s.village.level = 3;
    expect(rule('ridgePad').ready(query(s))).toBe(true);
  });

  it('feller needs the ridge and a pause; cash tubes come after the feller pad', () => {
    const s = afterMegaSaw();
    expect(rule('treeFellerPad').ready(query(s, { ridge: 99 }))).toBe(false);
    s.unlocked.ridge = true;
    expect(rule('treeFellerPad').ready(query(s, { ridge: 1 }))).toBe(false);
    expect(rule('treeFellerPad').ready(query(s, { ridge: 6 }))).toBe(true);
    // never on the same tick as the feller pad
    expect(rule('cashTubesPad').ready(query(s, { ridge: 6 }))).toBe(false);
    expect(rule('cashTubesPad').ready(query(s, { ridge: 30 }))).toBe(true);
    // needs 3 cash piles
    expect(rule('cashTubesPad').ready(query(s, { ridge: 30 }, 2))).toBe(false);
  });

  it('level pads of the new machines appear 30 s after their unlock', () => {
    const s = afterMegaSaw();
    s.unlocked.treeFeller = true;
    s.unlocked.cashTubes = true;
    for (const id of ['treeFeller', 'cashTubes'] as const) {
      expect(rule(`levelPad:${id}`).ready(query(s, { [id]: 10 }))).toBe(false);
      expect(rule(`levelPad:${id}`).ready(query(s, { [id]: 31 }))).toBe(true);
    }
  });
});
