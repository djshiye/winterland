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
    for (const id of ['truckLoader', 'ridge', 'treeFeller', 'cashTubes', 'workshop']) expect(pads).toContain(id);
    const levels = REVEALS.filter((r) => r.action.kind === 'levelPad').map((r) => (r.action.kind === 'levelPad' ? r.action.id : ''));
    for (const id of ['treeFeller', 'cashTubes', 'workshop']) expect(levels).toContain(id);
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

describe('wave 8 workshop reveal', () => {
  it('needs the tree feller, and shows 60 s after it was built', () => {
    const s = afterMegaSaw();
    s.unlocked.ridge = true;
    // no feller yet: never, however long the ridge has been open
    expect(rule('workshopPad').ready(query(s, { ridge: 999, treeFeller: 999 }))).toBe(false);
    s.unlocked.treeFeller = true;
    expect(rule('workshopPad').ready(query(s, { treeFeller: 0 }))).toBe(false);
    expect(rule('workshopPad').ready(query(s, { treeFeller: 59 }))).toBe(false);
    expect(rule('workshopPad').ready(query(s, { treeFeller: 60 }))).toBe(true);
    expect(rule('workshopPad').ready(query(s, { treeFeller: 600 }))).toBe(true);
  });

  it('is a pad rule for the workshop and counts as done once it is unlocked (debug unlock / restore)', () => {
    const r = rule('workshopPad');
    expect(r.action).toEqual({ kind: 'pad', id: 'workshop' });
    const s = afterMegaSaw();
    expect(r.satisfied?.(query(s))).toBe(false);
    s.unlocked.workshop = true;
    expect(r.satisfied?.(query(s))).toBe(true);
  });

  it('does not collide with the other ridge pads (staggered: workshop after the feller, never with the tubes)', () => {
    const s = afterMegaSaw();
    s.unlocked.ridge = true;
    s.unlocked.treeFeller = true;
    // the workshop waits a full minute after the feller; the tubes pad needs only the ridge clock
    expect(rule('workshopPad').ready(query(s, { ridge: 30, treeFeller: 20 }))).toBe(false);
    expect(rule('cashTubesPad').ready(query(s, { ridge: 30, treeFeller: 20 }))).toBe(true);
    expect(rule('workshopPad').delay).toBeGreaterThan(0);
  });

  it('the workshop level pad appears 30 s after the unlock and not before it', () => {
    const s = afterMegaSaw();
    const r = rule('levelPad:workshop');
    expect(r.action).toEqual({ kind: 'levelPad', id: 'workshop' });
    expect(r.ready(query(s, { workshop: 99 }))).toBe(false);
    s.unlocked.workshop = true;
    expect(r.ready(query(s, { workshop: 10 }))).toBe(false);
    expect(r.ready(query(s, { workshop: 31 }))).toBe(true);
  });

  it('each rule keeps its own flag so a reload can re-apply it', () => {
    expect(rule('workshopPad').flag ?? 'reveal:workshopPad').toBe('reveal:workshopPad');
    expect(rule('levelPad:workshop').flag ?? 'reveal:levelPad:workshop').toBe('reveal:levelPad:workshop');
  });
});
