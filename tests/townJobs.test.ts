/** Wave 9 porters: pure job selection over small fakes of the town (npc/townJobs.ts). */
import { describe, expect, it } from 'vitest';
import {
  FIREWOOD_BELOW,
  TOPUP_BELOW,
  destKey,
  pickJob,
  pickShop,
  type Claims,
  type ShopView,
  type SourceView,
} from '../src/npc/townJobs';

const NONE: Claims = { sources: new Set(), dests: new Map() };
const claim = (sources: string[], dests: Array<[string, number]>): Claims => ({ sources: new Set(sources), dests: new Map(dests) });
const HOME = { x: 18, z: 28 };

const bakery = (stock: { wheat?: number; log?: number }, key = 'shop:1', x = 24.6): ShopView => ({
  key,
  pos: { x, z: 21.3 },
  room: { wheat: 9 - (stock.wheat ?? 0), log: 9 - (stock.log ?? 0) },
  stock: { wheat: stock.wheat ?? 0, log: stock.log ?? 0 },
});
const butcher = (stock: { meat?: number; log?: number }, key = 'shop:3'): ShopView => ({
  key,
  pos: { x: 24.6, z: 32.4 },
  room: { meat: 9 - (stock.meat ?? 0), log: 9 - (stock.log ?? 0) },
  stock: { meat: stock.meat ?? 0, log: stock.log ?? 0 },
});
const farm = (count: number, key = 'pallet:0'): SourceView => ({ key, kind: 'wheat', count, minTake: 2, pos: { x: 19.7, z: 21.3 }, shared: false });
const ranch = (count: number, key = 'pallet:2'): SourceView => ({ key, kind: 'meat', count, minTake: 2, pos: { x: 19.7, z: 32.4 }, shared: false });
const drop = (count: number): SourceView => ({ key: 'drop', kind: 'log', count, minTake: 2, pos: { x: -3, z: 1.4 }, shared: true });
const bench = (count: number): SourceView => ({ key: 'bench', kind: 'crate', count, minTake: 2, pos: { x: 5.95, z: 0.85 }, shared: true });
const toys = (crates: number): ShopView => ({ key: 'shop:5', pos: { x: 30, z: 32 }, room: { crate: 9 - crates }, stock: { crate: crates } });

describe('pickJob', () => {
  it('carries wheat from a pallet with >= 2 goods to a hopper that has room, up to capacity', () => {
    const job = pickJob([farm(10)], [bakery({ wheat: 0, log: 5 })], 6, NONE, HOME)!;
    expect(job).toMatchObject({ source: 'pallet:0', shop: 'shop:1', kind: 'wheat', take: 6 });
  });

  it('never takes more than the hopper has room for or the pallet holds', () => {
    expect(pickJob([farm(10)], [bakery({ wheat: 6, log: 5 })], 6, NONE, HOME)!.take).toBe(3);
    expect(pickJob([farm(4)], [bakery({ wheat: 0, log: 5 })], 6, NONE, HOME)!.take).toBe(4);
  });

  it('ignores a pallet with fewer than 2 goods, and a full hopper', () => {
    expect(pickJob([farm(1)], [bakery({ wheat: 2 })], 6, NONE, HOME)).toBeNull();
    expect(pickJob([farm(10)], [{ ...bakery({ wheat: 9 }) }], 6, NONE, HOME)).toBeNull();
  });

  it('does not make a trip for one item into a hopper that already has some', () => {
    expect(pickJob([farm(10)], [bakery({ wheat: 8 })], 6, NONE, HOME)).toBeNull();
    // ...but one item for an empty hopper is worth it (the shop is stopped without it)
    expect(pickJob([farm(2)], [bakery({ wheat: 0 })], 1, NONE, HOME)!.take).toBe(1);
  });

  it('sends goods only to a shop that takes that kind', () => {
    expect(pickJob([ranch(8)], [bakery({})], 6, NONE, HOME)).toBeNull();
    expect(pickJob([ranch(8)], [bakery({}), butcher({})], 6, NONE, HOME)!.shop).toBe('shop:3');
  });

  it('feeds the hungriest shop of a kind first', () => {
    const a = bakery({ wheat: 5, log: 5 }, 'shop:1');
    const b = bakery({ wheat: 1, log: 5 }, 'shop:4');
    expect(pickJob([farm(10)], [a, b], 6, NONE, HOME)!.shop).toBe('shop:4');
  });

  it('brings firewood to a shop running low: urgent below FIREWOOD_BELOW, a real load below TOPUP_BELOW', () => {
    // plenty of firewood: no trip
    expect(pickJob([drop(30)], [bakery({ wheat: 5, log: TOPUP_BELOW })], 6, NONE, HOME)).toBeNull();
    // running low: a trip for a worthwhile load (room 9 - 4 = 5, capacity 6 -> 5)
    expect(pickJob([drop(30)], [bakery({ wheat: 5, log: TOPUP_BELOW - 1 })], 6, NONE, HOME)).toMatchObject({ source: 'drop', kind: 'log', take: 5 });
    // not urgent and only a small load possible (a small drop pile): wait
    expect(pickJob([drop(3)], [bakery({ wheat: 5, log: TOPUP_BELOW - 1 })], 6, NONE, HOME)).toBeNull();
    // urgent: any pair is worth it
    expect(pickJob([drop(3)], [bakery({ wheat: 5, log: FIREWOOD_BELOW - 1 })], 6, NONE, HOME)).toMatchObject({ kind: 'log', take: 3 });
  });

  it('does not strip the drop zone: needs at least 2 logs lying there', () => {
    expect(pickJob([drop(1)], [bakery({ log: 0 })], 6, NONE, HOME)).toBeNull();
  });

  it('brings bench crates to a toy factory that is short of them', () => {
    expect(pickJob([bench(5)], [toys(0)], 6, NONE, HOME)).toMatchObject({ source: 'bench', shop: 'shop:5', kind: 'crate', take: 5 });
    expect(pickJob([bench(5)], [toys(TOPUP_BELOW)], 6, NONE, HOME)).toBeNull();
    expect(pickJob([bench(0)], [toys(0)], 6, NONE, HOME)).toBeNull();
  });

  it('prefers the shop that is stopped (0 of an input) over a topped-up one', () => {
    const stopped = bakery({ wheat: 4, log: 0 });
    const job = pickJob([farm(10), drop(30)], [stopped], 6, NONE, HOME)!;
    expect(job.kind).toBe('log'); // logs are what the bakery lacks
    const fed = bakery({ wheat: 0, log: 6 });
    expect(pickJob([farm(10), drop(30)], [fed], 6, NONE, HOME)!.kind).toBe('wheat');
  });

  it('peers do not chase the same job: a claimed pallet is skipped, a (shop, kind) hopper keeps its reserved room', () => {
    const shops = [bakery({ wheat: 0, log: 0 })];
    // a peer is bringing 6 logs: they count as stock, so firewood is no longer needed...
    const claims = claim([], [[destKey('shop:1', 'log'), 6]]);
    const second = pickJob([farm(10), drop(30)], shops, 6, claims, HOME)!;
    expect(second.kind).toBe('wheat');
    // ...and a pallet a peer is loading from is skipped (even for another shop); a shared source is not
    const pallet = claim(['pallet:0', 'drop'], []);
    expect(pickJob([farm(10)], [bakery({}, 'shop:4')], 6, pallet, HOME)).toBeNull();
    expect(pickJob([drop(30)], [bakery({}, 'shop:4')], 6, pallet, HOME)).not.toBeNull();
  });

  it('never overfills a hopper between two porters: reserved items come off the room', () => {
    const shops = [bakery({ wheat: 2, log: 5 })]; // wheat room 7
    const peerCarries = claim([], [[destKey('shop:1', 'wheat'), 5]]);
    expect(pickJob([farm(10, 'pallet:9')], shops, 6, peerCarries, HOME)!.take).toBe(2);
    const peerFills = claim([], [[destKey('shop:1', 'wheat'), 7]]);
    expect(pickJob([farm(10, 'pallet:9')], shops, 6, peerFills, HOME)).toBeNull();
  });

  it('weighs distance: with equal need the nearer source wins', () => {
    const near: SourceView = { ...farm(10, 'pallet:0'), pos: { x: 19, z: 21 } };
    const far: SourceView = { ...farm(10, 'pallet:9'), pos: { x: 35, z: 33 } };
    expect(pickJob([far, near], [bakery({ wheat: 0, log: 5 })], 6, NONE, HOME)!.source).toBe('pallet:0');
  });
});

describe('pickShop', () => {
  it('finds a shop with room for held goods, hungriest first, skipping claims and the excluded one', () => {
    const a = bakery({ wheat: 5 }, 'shop:1');
    const b = bakery({ wheat: 1 }, 'shop:4');
    expect(pickShop([a, b], 'wheat', NONE, HOME)!.key).toBe('shop:4');
    expect(pickShop([a, b], 'wheat', NONE, HOME, 'shop:4')!.key).toBe('shop:1');
    expect(pickShop([a, b], 'wheat', claim([], [[destKey('shop:4', 'wheat'), 8]]), HOME)!.key).toBe('shop:1');
    expect(pickShop([a, b], 'meat', NONE, HOME)).toBeNull();
    expect(pickShop([bakery({ wheat: 9 })], 'wheat', NONE, HOME)).toBeNull();
  });
});
