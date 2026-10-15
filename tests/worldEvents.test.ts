/** Wave 13 world events: kind picking, per-kind multipliers, scheduling, the transient price multiplier. */
import { describe, expect, it } from 'vitest';
import { EVENTS, type EventKind } from '../src/config';
import { getTransientPriceMult } from '../src/core/demand';
import { EventBus } from '../src/core/EventBus';
import { createGameState, type GameEvents } from '../src/core/types';
import { WorldEvents, pickNextEvent } from '../src/core/WorldEvents';
import { FIREWOOD_BELOW, TOPUP_BELOW, pickJob, type Claims, type ShopView, type SourceView } from '../src/npc/townJobs';

const KINDS = Object.keys(EVENTS.kinds) as EventKind[];

const make = (dark = 0) => {
  const state = createGameState();
  const events = new EventBus<GameEvents>();
  const seen: string[] = [];
  events.on('event:start', (e) => seen.push(`start:${e.kind}`));
  events.on('event:end', (e) => seen.push(`end:${e.kind}`));
  const darkness = { v: dark };
  const we = new WorldEvents(state, events, () => darkness.v);
  return { state, we, seen, darkness };
};

describe('pickNextEvent', () => {
  it('never repeats the last kind, whatever the roll', () => {
    for (const last of KINDS) {
      for (let r = 0; r < 1; r += 0.05) expect(pickNextEvent(last, true, () => r)).not.toBe(last);
    }
  });

  it('never picks the aurora by day, and can by night', () => {
    for (const last of [null, ...KINDS]) {
      for (let r = 0; r < 1; r += 0.05) expect(pickNextEvent(last, false, () => r)).not.toBe('aurora');
    }
    const night = new Set<EventKind>();
    for (let r = 0; r < 1; r += 0.05) night.add(pickNextEvent(null, true, () => r));
    expect(night.has('aurora')).toBe(true);
  });
});

describe('WorldEvents multipliers', () => {
  it('are neutral with no event', () => {
    const { we } = make();
    expect([we.walkSpeedMult, we.firewoodMult, we.townBuyMult, we.priceMult, we.snowfall]).toEqual([1, 1, 1, 1, 1]);
    expect(we.active).toBeNull();
  });

  it('snowstorm: slower walking, more firewood, heavier snow; nothing else', () => {
    const { we } = make();
    we.start('snowstorm');
    const k = EVENTS.kinds.snowstorm;
    expect([we.walkSpeedMult, we.firewoodMult, we.snowfall]).toEqual([k.walkSpeedMult, k.firewoodMult, k.snowfall]);
    expect([we.townBuyMult, we.priceMult]).toEqual([1, 1]);
  });

  it('festival: townsfolk buy more; nothing else', () => {
    const { we } = make();
    we.start('festival');
    expect(we.townBuyMult).toBe(EVENTS.kinds.festival.townBuyMult);
    expect([we.walkSpeedMult, we.firewoodMult, we.priceMult, we.snowfall]).toEqual([1, 1, 1, 1]);
  });

  it('aurora: better prices, written to the transient price multiplier; nothing else', () => {
    const { we } = make();
    we.start('aurora');
    expect(we.priceMult).toBe(EVENTS.kinds.aurora.priceMult);
    expect(getTransientPriceMult()).toBe(EVENTS.kinds.aurora.priceMult);
    expect([we.walkSpeedMult, we.firewoodMult, we.townBuyMult, we.snowfall]).toEqual([1, 1, 1, 1]);
  });
});

describe('WorldEvents scheduling', () => {
  it('starts nothing below the village level', () => {
    const { we, state, seen } = make(1);
    state.village.level = EVENTS.minVillageLevel - 1;
    for (let i = 0; i < 20; i++) we.update(EVENTS.every[1]);
    expect(we.active).toBeNull();
    expect(seen).toEqual([]);
  });

  it('starts one at the village level and ends it, resetting the price multiplier', () => {
    const { we, state, seen } = make(1);
    state.village.level = EVENTS.minVillageLevel;
    we.update(EVENTS.every[1] + 1);
    expect(we.active).not.toBeNull();
    const kind = we.active!;
    expect(we.remaining).toBeCloseTo(EVENTS.kinds[kind].seconds);
    we.update(EVENTS.kinds[kind].seconds + 1);
    expect(we.active).toBeNull();
    expect(we.remaining).toBe(0);
    expect(getTransientPriceMult()).toBe(1);
    expect(seen).toEqual([`start:${kind}`, `end:${kind}`]);
  });

  it('ending an aurora puts prices back to normal', () => {
    const { we, seen } = make(1);
    we.start('aurora', 5);
    expect(getTransientPriceMult()).toBe(EVENTS.kinds.aurora.priceMult);
    we.update(6);
    expect(getTransientPriceMult()).toBe(1);
    expect(seen).toEqual(['start:aurora', 'end:aurora']);
  });

  it('never starts twice in a row without an end, and never repeats a kind back to back', () => {
    const { we, state, seen } = make(1);
    state.village.level = EVENTS.minVillageLevel;
    for (let i = 0; i < 40000; i++) we.update(1);
    expect(seen.length).toBeGreaterThan(10);
    let open: string | null = null;
    let lastKind = '';
    for (const s of seen) {
      const [type, kind] = s.split(':') as [string, string];
      if (type === 'start') {
        expect(open).toBeNull();
        expect(kind).not.toBe(lastKind);
        open = kind;
        lastKind = kind;
      } else {
        expect(open).toBe(kind);
        open = null;
      }
    }
  });

  it('never schedules the aurora by day', () => {
    const { we, state, seen } = make(0);
    state.village.level = EVENTS.minVillageLevel;
    for (let i = 0; i < 40000; i++) we.update(1);
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.some((s) => s.endsWith(':aurora'))).toBe(false);
  });

  it('starting over a running event ends it first, and a non-positive length is ignored', () => {
    const { we, seen } = make();
    we.start('festival');
    we.start('snowstorm');
    we.start('aurora', 0);
    expect(seen).toEqual(['start:festival', 'end:festival', 'start:snowstorm']);
    expect(we.active).toBe('snowstorm');
  });
});

describe('porter firewood threshold x firewoodMult', () => {
  const NONE: Claims = { sources: new Set(), dests: new Map() };
  const drop: SourceView = { key: 'drop', kind: 'log', count: 20, minTake: 2, pos: { x: -3, z: 1.4 }, shared: true };
  const shop = (logs: number): ShopView => ({ key: 'shop:1', id: 'bakery', pos: { x: 24, z: 21 }, room: { log: 9 - logs }, stock: { log: logs } });
  const HOME = { x: 18, z: 28 };

  it('keeps hoppers fuller: a hopper that is fine on a calm day gets topped up in a storm', () => {
    const logs = TOPUP_BELOW; // not low on a calm day
    expect(pickJob([drop], [shop(logs)], 6, NONE, HOME)).toBeNull();
    const storm = EVENTS.kinds.snowstorm.firewoodMult;
    expect(storm).toBeGreaterThan(1);
    expect(pickJob([drop], [shop(logs)], 6, NONE, HOME, storm)).toMatchObject({ kind: 'log', shop: 'shop:1' });
    expect(FIREWOOD_BELOW * storm).toBeGreaterThan(FIREWOOD_BELOW);
  });
});
