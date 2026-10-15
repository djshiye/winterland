/** Foreman (npc/Foreman.ts): the pure parts — nearest-first site choice, the cash reserve and the payment chunk, the trip stitching. */
import { describe, expect, it } from 'vitest';
import { PRIORITIES } from '../src/config';
import { CASH_ONLY_BONUS, payAmount, pickSite, routeBetween, spendable, type SiteView } from '../src/npc/Foreman';

const site = (key: string, x: number, z: number, logs: boolean, cash: boolean): SiteView => ({ key, x, z, logs, cash });

describe('pickSite', () => {
  it('returns null when nothing needs anything', () => {
    expect(pickSite([], { x: 0, z: 0 })).toBeNull();
    expect(pickSite([site('a', 1, 1, false, false)], { x: 0, z: 0 })).toBeNull();
  });

  it('picks the nearest workable site', () => {
    const a = site('a', 4.6, 20, true, true);
    const b = site('b', 4.6, 14, true, true);
    expect(pickSite([a, b], { x: 2.4, z: 8.4 })?.key).toBe('b');
    expect(pickSite([a, b], { x: 4.6, z: 26 })?.key).toBe('a');
  });

  it('skips sites that need neither logs nor cash', () => {
    const near = site('near', 3, 10, false, false);
    const far = site('far', 4.6, 24, false, true);
    expect(pickSite([near, far], { x: 3, z: 10 })?.key).toBe('far');
  });

  it('prefers a cash-only site by 3 m, no more', () => {
    const haul = site('haul', 0, 10, true, true);
    const cashOnly = site('cash', 0, 10 + CASH_ONLY_BONUS - 0.5, false, true);
    expect(pickSite([haul, cashOnly], { x: 0, z: 0 })?.key).toBe('cash');
    const tooFar = site('cash', 0, 10 + CASH_ONLY_BONUS + 0.5, false, true);
    expect(pickSite([haul, tooFar], { x: 0, z: 0 })?.key).toBe('haul');
  });

  it('keeps the first of two equally good sites', () => {
    const a = site('a', 3, 0, true, false);
    const b = site('b', -3, 0, true, false);
    expect(pickSite([a, b], { x: 0, z: 0 })?.key).toBe('a');
  });
});

describe('cash rules', () => {
  it('keeps max(reserveMin, reserveShare of the wallet)', () => {
    expect(spendable(0)).toBe(0);
    expect(spendable(PRIORITIES.reserveMin)).toBe(0);
    expect(spendable(1000)).toBe(500); // the floor dominates
    const big = 100000;
    expect(spendable(big)).toBeCloseTo(big * (1 - PRIORITIES.reserveShare), 6);
  });

  it('pays min(payChunk, cashLeft, spendable) in whole dollars', () => {
    expect(payAmount(8000, 100000)).toBe(PRIORITIES.payChunk);
    expect(payAmount(120, 100000)).toBe(120);
    expect(payAmount(8000, 600)).toBe(100); // 600 - 500 reserve
  });

  it('waits when the wallet is at the reserve or the spare cash is a dribble', () => {
    expect(payAmount(8000, 500)).toBe(0);
    expect(payAmount(8000, 510)).toBe(0); // 10 spare < 25
    expect(payAmount(8, 520)).toBe(8); // a small remainder is paid in one go
    expect(payAmount(0, 100000)).toBe(0);
  });
});

describe('routeBetween', () => {
  const g = { x: 4.6, z: 10.4 };
  const top = { x: 4.6, z: 12 };
  const plotA = { path: [g, top, { x: 4.6, z: 17 }, { x: 3.6, z: 17 }] };
  const plotB = { path: [g, top, { x: 4.6, z: 13.4 }, { x: 5.6, z: 13.4 }] };

  it('walks the street between two plots without going home', () => {
    expect(routeBetween(plotA, plotB)).toEqual([{ x: 4.6, z: 17 }, { x: 4.6, z: 13.4 }, { x: 5.6, z: 13.4 }]);
  });

  it('goes out from home along the whole path', () => {
    expect(routeBetween({ path: [] }, plotB)).toEqual(plotB.path);
  });

  it('returns along the reversed path (the caller appends home)', () => {
    expect(routeBetween(plotA, { path: [] })).toEqual([{ x: 4.6, z: 17 }, top, g]);
  });

  it('is empty for the same place', () => {
    expect(routeBetween(plotA, plotA)).toEqual([]);
  });
});
