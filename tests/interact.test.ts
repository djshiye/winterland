/** Wave 10b hold-to-interact: the zone gate (Zones.ts) and the hold rule (Input.heldFrom). */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import type { GameContext, GameEvents, Item, ItemHolder, ItemKind } from '../src/core/types';
import { ZoneSystem } from '../src/items/Zones';
import { heldFrom, isInteractKey } from '../src/input/Input';

function holder(id: string, n: number, accepts = true): ItemHolder & { items: Item[] } {
  const items: Item[] = [];
  const h = {
    id,
    items,
    canAccept: (_k: ItemKind) => accepts,
    reserve: () => ({}) as never,
    getSlotWorldPosition: (_s: unknown, out: unknown) => out,
    getSlotWorldQuaternion: (_s: unknown, out: unknown) => out,
    receive: (it: Item) => void items.push(it),
    cancel: () => {},
    count: () => items.length,
    take: () => items.pop() ?? null,
  };
  return h as unknown as ItemHolder & { items: Item[] };
}

function world(kind: 'take' | 'give' | 'pay' | undefined, srcCount = 5, destAccepts = true) {
  const events = new EventBus<GameEvents>();
  const scene = {};
  const launched: Item[] = [];
  const input = { interactHeld: false };
  const player = { position: { x: 0, z: 0 } };
  const ctx = {
    events,
    scene,
    input,
    player,
    flights: { launch: (it: Item) => launched.push(it) },
  } as unknown as GameContext;
  const from = holder('from', 0);
  for (let i = 0; i < srcCount; i++) from.items.push({ kind: 'log', object: { parent: scene } } as unknown as Item);
  const to = holder('to', 0, destAccepts);
  const zones = new ZoneSystem(ctx);
  zones.addTransfer({
    id: 't',
    area: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
    from,
    to,
    kinds: ['log'],
    kind,
  });
  const prompts: { on: boolean; kind: string }[] = [];
  events.on('interact:prompt', (p) => prompts.push(p));
  return { zones, input, player, launched, prompts, from };
}

describe('TransferZone hold gate', () => {
  it('take: nothing moves while not held, one prompt on, no repeats', () => {
    const w = world('take');
    for (let i = 0; i < 60; i++) w.zones.update(1 / 60);
    expect(w.launched.length).toBe(0);
    expect(w.prompts).toEqual([{ on: true, kind: 'take' }]);
  });

  it('take: first item moves immediately when held, prompt turns off, no accumulated burst', () => {
    const w = world('take');
    for (let i = 0; i < 120; i++) w.zones.update(1 / 60); // 2 s idle must not bank time
    w.input.interactHeld = true;
    w.zones.update(1 / 60);
    expect(w.launched.length).toBe(1);
    expect(w.prompts).toEqual([
      { on: true, kind: 'take' },
      { on: false, kind: 'take' },
    ]);
  });

  it('pay uses the same gate and reports its kind', () => {
    const w = world('pay');
    w.zones.update(1 / 60);
    expect(w.launched.length).toBe(0);
    expect(w.prompts).toEqual([{ on: true, kind: 'pay' }]);
  });

  it('give (and default) moves regardless of the hold and never prompts', () => {
    for (const k of ['give', undefined] as const) {
      const w = world(k);
      w.zones.update(1 / 60);
      expect(w.launched.length).toBe(1);
      expect(w.prompts).toEqual([]);
    }
  });

  it('leaving the zone while prompting emits {on:false}', () => {
    const w = world('take');
    w.zones.update(1 / 60);
    w.player.position.x = 10;
    w.zones.update(1 / 60);
    w.zones.update(1 / 60);
    expect(w.prompts).toEqual([
      { on: true, kind: 'take' },
      { on: false, kind: 'take' },
    ]);
    expect(w.launched.length).toBe(0);
  });

  it('no prompt when there is nothing to take, or the target is full', () => {
    const empty = world('take', 0);
    empty.zones.update(1 / 60);
    expect(empty.prompts).toEqual([]);
    const full = world('take', 3, false);
    full.zones.update(1 / 60);
    expect(full.prompts).toEqual([]);
  });

  it('prompt turns off when the source empties while waiting', () => {
    const w = world('take', 1);
    w.zones.update(1 / 60);
    w.from.items.length = 0;
    w.zones.update(1 / 60);
    expect(w.prompts).toEqual([
      { on: true, kind: 'take' },
      { on: false, kind: 'take' },
    ]);
  });
});

describe('heldFrom', () => {
  const base = { hold: true, key: false, pointerDown: false, stickLen: 0, deadZone: 0.08, override: null };
  it('setting off: always held', () => expect(heldFrom({ ...base, hold: false })).toBe(true));
  it('setting on: idle is not held', () => expect(heldFrom(base)).toBe(false));
  it('key held', () => expect(heldFrom({ ...base, key: true })).toBe(true));
  it('stationary pointer is held, a displaced knob is not', () => {
    expect(heldFrom({ ...base, pointerDown: true, stickLen: 0.02 })).toBe(true);
    expect(heldFrom({ ...base, pointerDown: true, stickLen: 0.5 })).toBe(false);
    expect(heldFrom({ ...base, pointerDown: false, stickLen: 0 })).toBe(false);
  });
  it('override wins both ways', () => {
    expect(heldFrom({ ...base, override: true })).toBe(true);
    expect(heldFrom({ ...base, hold: false, key: true, override: false })).toBe(false);
  });
  it('interact keys are E and Space', () => {
    expect(isInteractKey({ key: 'e', code: 'KeyE' })).toBe(true);
    expect(isInteractKey({ key: 'E', code: 'KeyE' })).toBe(true);
    expect(isInteractKey({ key: ' ', code: 'Space' })).toBe(true);
    expect(isInteractKey({ key: 'w', code: 'KeyW' })).toBe(false);
  });
});
