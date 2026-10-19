/**
 * 0.9.11 forgiving reach (full review I1, I6, I7): pickups and drop-offs count the player's body with slack and a
 * sticky exit; payments stay exact and, in walk-over mode, need the player to slow down; a wrong load is never silent.
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import type { GameContext, GameEvents, Item, ItemHolder, ItemKind } from '../src/core/types';
import { PAY_WALK_MAX, REACH, ZoneSystem, rectDistance } from '../src/items/Zones';
import { PLAYER } from '../src/config';

const SCENE = { add: () => {} };

function holder(id: string, kinds: ItemKind[] = []): ItemHolder & { items: Item[] } {
  const items: Item[] = [];
  const h = {
    id,
    items,
    canAccept: () => true,
    reserve: () => ({}) as never,
    getSlotWorldPosition: (_s: unknown, out: unknown) => out,
    getSlotWorldQuaternion: (_s: unknown, out: unknown) => out,
    receive: (it: Item) => void items.push(it),
    cancel: () => {},
    count: (k?: ItemKind) => (k ? items.filter((i) => i.kind === k).length : items.length),
    take: (k?: ItemKind) => {
      const i = items.findIndex((it) => !k || it.kind === k);
      return i < 0 ? null : items.splice(i, 1)[0]!;
    },
  };
  for (const k of kinds) items.push({ kind: k, object: { parent: SCENE } } as unknown as Item);
  return h as unknown as ItemHolder & { items: Item[] };
}

function world(opts: { kind?: 'take' | 'give' | 'pay'; hold?: boolean; armKinds?: ItemKind[]; kinds?: ItemKind[] } = {}) {
  const events = new EventBus<GameEvents>();
  const launched: Item[] = [];
  const floats: string[] = [];
  const arms = holder('arms', opts.armKinds ?? []);
  const player = { position: { x: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, arms };
  const ctx = {
    events,
    scene: SCENE,
    input: { interactHeld: true, holdToInteract: opts.hold ?? false },
    player,
    hud: { floatText: (_p: unknown, t: string) => floats.push(t) },
    flights: { launch: (it: Item) => launched.push(it) },
  } as unknown as GameContext;
  const kind = opts.kind ?? 'take';
  const pile = holder('pile', ['log', 'log', 'log', 'log', 'log', 'log', 'log', 'log', 'log', 'log']);
  const zones = new ZoneSystem(ctx);
  const zone = zones.addTransfer({
    id: 'z',
    area: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
    from: kind === 'take' ? pile : arms,
    to: kind === 'take' ? arms : pile,
    kinds: opts.kinds ?? ['log'],
    kind,
    interval: 10, // one item per visit keeps the counts readable
  });
  const at = (x: number): void => {
    player.position.x = x;
  };
  const step = (s: number): void => {
    for (let t = 0; t < s - 1e-9; t += 1 / 60) zones.update(1 / 60);
  };
  return { zones, zone, player, launched, floats, at, step };
}

describe('rectDistance', () => {
  it('is 0 inside, the gap to an edge beside it and the corner distance diagonally', () => {
    const r = { minX: 0, maxX: 2, minZ: 0, maxZ: 1 };
    expect(rectDistance(r, 1, 0.5)).toBe(0);
    expect(rectDistance(r, 3, 0.5)).toBeCloseTo(1);
    expect(rectDistance(r, -0.5, 0.5)).toBeCloseTo(0.5);
    expect(rectDistance(r, 3, 2)).toBeCloseTo(Math.SQRT2);
  });
});

describe('body reach (pickups and drop-offs)', () => {
  it('counts the whole body: touching the zone with the body edge starts the flow', () => {
    expect(REACH.enter).toBeGreaterThan(PLAYER.radius);
    const w = world();
    w.at(1 + PLAYER.radius); // centre outside, body edge on the zone's edge
    w.step(1 / 60);
    expect(w.zone.playerInside).toBe(true);
    expect(w.launched.length).toBe(1);
  });

  it('does not reach from further than the slack', () => {
    const w = world();
    w.at(1 + REACH.enter + 0.05);
    w.step(0.5);
    expect(w.zone.playerInside).toBe(false);
    expect(w.launched.length).toBe(0);
  });

  it('keeps flowing while the player drifts a little past the arrival line (hysteresis)', () => {
    const w = world();
    w.at(0);
    w.step(1 / 60);
    w.at(1 + REACH.leave - 0.02); // well beyond where they could arrive, still inside the leave line
    w.step(1);
    expect(w.zone.playerInside).toBe(true);
  });

  it('lets go after the exit grace once past the leave line', () => {
    const w = world();
    w.at(0);
    w.step(1 / 60);
    w.at(5);
    w.step(REACH.grace / 2);
    expect(w.zone.playerInside).toBe(true);
    w.step(REACH.grace);
    expect(w.zone.playerInside).toBe(false);
  });
});

describe('payments stay exact and deliberate', () => {
  it('a pay zone needs the centre on it (no slack)', () => {
    const w = world({ kind: 'pay', armKinds: ['log', 'log'] });
    w.at(1.2);
    w.step(0.5);
    expect(w.zone.playerInside).toBe(false);
    w.at(0.9);
    w.step(1 / 60);
    expect(w.zone.playerInside).toBe(true);
  });

  it('walk-over mode: crossing at walking pace pays nothing; slowing down pays', () => {
    const w = world({ kind: 'pay', armKinds: ['log', 'log'], hold: false });
    w.at(0);
    w.player.velocity.x = 4;
    w.step(0.5);
    expect(w.launched.length).toBe(0);
    w.player.velocity.x = PAY_WALK_MAX / 2;
    w.step(1 / 60);
    expect(w.launched.length).toBe(1);
  });

  it('hold mode: holding E on the pad pays even while moving (a deliberate press)', () => {
    const w = world({ kind: 'pay', armKinds: ['log', 'log'], hold: true });
    w.at(0);
    w.player.velocity.x = 4;
    w.step(1 / 60);
    expect(w.launched.length).toBe(1);
  });
});

describe('overlapping give and take between the same arms and pile (era dock)', () => {
  it('goods never bounce back and forth: the nearer zone works, the other waits', () => {
    const w = world({ kind: 'take', armKinds: ['log', 'log', 'log'] });
    // a give zone back into the same pile, right beside the take zone so body reach covers both
    const pile = (w.zone as unknown as { t: { from: ItemHolder } }).t.from;
    const arms = w.player.arms;
    const give = w.zones.addTransfer({
      id: 'g',
      area: { minX: 1.2, maxX: 3, minZ: -1, maxZ: 1 },
      from: arms,
      to: pile,
      kinds: ['log'],
      kind: 'give',
      interval: 0.05,
    });
    let flips = 0;
    let last = '';
    const watch = (): void => {
      const now = `${w.zone.yielding ? 'G' : 'T'}`;
      if (last && now !== last) flips++;
      last = now;
    };
    w.at(1.1); // between the two zones: inside both under body reach
    for (let i = 0; i < 180; i++) {
      w.zones.update(1 / 60);
      watch();
    }
    expect(w.zone.playerInside && give.playerInside).toBe(true);
    expect(w.zone.yielding !== give.yielding).toBe(true);
    expect(flips).toBe(0);
    // standing nearer the give side: only giving happens, so the pile only grows
    w.at(1.5); // 0.3 m from the give zone, 0.5 m from the take zone (still held by hysteresis)
    const before = (pile as unknown as { items: Item[] }).items.length;
    w.step(1);
    expect(w.zone.playerInside && w.zone.yielding).toBe(true);
    expect(give.yielding).toBe(false);
    expect((pile as unknown as { items: Item[] }).items.length).toBeGreaterThanOrEqual(before);
  });
});

describe('wrong load hint (I6)', () => {
  it('floats "Takes Logs" once per visit when the player stops with only other goods', () => {
    const w = world({ kind: 'give', armKinds: ['crate', 'crate'] });
    w.at(0);
    w.step(1);
    expect(w.floats).toEqual(['Takes Logs']);
    w.at(5);
    w.step(1);
    w.at(0);
    w.step(0.2);
    expect(w.floats).toEqual(['Takes Logs', 'Takes Logs']);
  });

  it('stays quiet while walking past, with empty arms, or when the load fits', () => {
    const moving = world({ kind: 'give', armKinds: ['crate'] });
    moving.player.velocity.x = 4;
    moving.at(0);
    moving.step(0.5);
    expect(moving.floats).toEqual([]);
    const empty = world({ kind: 'give' });
    empty.at(0);
    empty.step(0.5);
    expect(empty.floats).toEqual([]);
    const fits = world({ kind: 'give', armKinds: ['log'] });
    fits.at(0);
    fits.step(0.5);
    expect(fits.floats).toEqual([]);
  });
});
