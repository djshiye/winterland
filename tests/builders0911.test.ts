/**
 * 0.9.11 (Dino: "the builders are not bringing materials to the quarry and city"): what a chosen building still needs
 * stays on the piles for the foremen; the others (and the belts) only take the stock above it.
 */
import { describe, expect, it } from 'vitest';
import { NO_CLAIMS, pickJob, type JobMachine, type JobView } from '../src/npc/EraWorker';
import { carryView } from '../src/ui/CarryMeter';

const AT = { x: 9, z: 66 };
const quarry = (outCount: number): JobMachine => ({ slot: 0, extractor: true, inputs: [], output: 'stone', outCount, outFull: false, feed: { x: 0, z: 0 }, take: { x: 2, z: 60 } });
const kiln = (room: number): JobMachine => ({ slot: 1, extractor: false, inputs: [{ kind: 'stone', per: 2, room, stock: 0 }], output: 'brick', outCount: 0, outFull: false, feed: { x: 9, z: 62 }, take: { x: 11, z: 62 } });
const view = (machines: JobMachine[], over: Partial<JobView> = {}): JobView => ({
  machines,
  dock: {},
  dockSpot: { x: 4.5, z: 70 },
  depotSpot: { x: -1.5, z: 70 },
  depotAccepts: () => true,
  dockAccepts: () => true,
  ...over,
});

describe('builders get their material first (0.9.11)', () => {
  it('a feeder leaves the stone a chosen building needs on the quarry pile', () => {
    const hold = new Map([['stone', 8]] as const);
    expect(pickJob(view([quarry(6), kiln(8)], { hold }), 6, NO_CLAIMS, AT, true, undefined, 'feeder')).toBeNull();
    // only what is above the hold is fed
    expect(pickJob(view([quarry(10), kiln(8)], { hold }), 6, NO_CLAIMS, AT, true, undefined, 'feeder')).toMatchObject({ type: 'feed', take: 2 });
  });

  it('without a hold the feeder takes the pile as before', () => {
    expect(pickJob(view([quarry(6), kiln(8)]), 6, NO_CLAIMS, AT, false, undefined, 'feeder')).toMatchObject({ type: 'feed', take: 6 });
  });

  it('the foreman carries the held stone to the site', () => {
    const v = view([quarry(6), kiln(8)], { sites: [{ slot: 2, kind: 'stone', room: 8, spot: { x: 20, z: 62 } }] });
    expect(pickJob(v, 6, NO_CLAIMS, AT, false, undefined, 'foreman')).toMatchObject({ type: 'build', item: 'stone', take: 6, to: 'site2' });
  });
});

describe('carry meter shows what is held (0.9.11)', () => {
  it('names each kind in the label and keeps the newest first', () => {
    const v = carryView(9, 10, [
      ['brick', 5],
      ['roofTile', 4],
    ]);
    expect(v.text).toBe('9 / 10');
    expect(v.kinds).toEqual([
      { kind: 'brick', count: 5 },
      { kind: 'roofTile', count: 4 },
    ]);
    expect(v.label).toBe('Carrying 5 Bricks, 4 Roof Tiles (9 of 10)');
  });

  it('empty arms hold no kinds', () => {
    expect(carryView(0, 8).kinds).toEqual([]);
    expect(carryView(0, 8).label).toBe('Carrying 0 of 8');
  });
});
