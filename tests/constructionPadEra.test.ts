/**
 * 0.9.0 era construction pads (logs: 0): formatCost for millions / billions / trillions, the item zone taking only the
 * extra kind, and completion on cash + extra (or cash only). Built with a fake GameContext and a mocked assets/pads
 * (no canvas in the node test environment); formatCost is the real one.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import type { GameContext, GameEvents, Item, ItemKind } from '../src/core/types';

const textureCalls: { logs: { left: number; total: number }; cash: unknown; extra: unknown }[] = [];

vi.mock('../src/assets/pads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/assets/pads')>();
  return {
    formatCost: actual.formatCost,
    createConstructionTexture: (_icon: string, logs: { left: number; total: number }, cash: unknown, _target?: unknown, extra?: unknown) => {
      textureCalls.push({ logs: { ...logs }, cash, extra });
      return { image: null };
    },
    createPadModel: () => new THREE.Group(),
    createPadSign: () => new THREE.Mesh(),
    setPadSignLabel: () => undefined,
  };
});

const { ConstructionPad } = await import('../src/stations/ConstructionPad');
const { formatCost } = await import('../src/assets/pads');

interface FakeZone {
  opts: { id: string; kinds?: readonly ItemKind[] };
  enabled: boolean;
  setEnabled(on: boolean): void;
}

function makeCtx() {
  const events = new EventBus<GameEvents>();
  const zones: FakeZone[] = [];
  const paid: GameEvents['construction:paid'][] = [];
  events.on('construction:paid', (e) => paid.push(e));
  const ctx = {
    scene: new THREE.Scene(),
    events,
    addUpdatable: () => undefined,
    time: { elapsed: 0 },
    economy: { money: 0 },
    camera: new THREE.PerspectiveCamera(),
    player: { arms: { count: () => 0 }, back: {} },
    zones: {
      addTransfer: (opts: FakeZone['opts']) => {
        const z: FakeZone = { opts, enabled: false, setEnabled: (on) => void (z.enabled = on) };
        zones.push(z);
        return z;
      },
    },
    tweens: { killTweensOf: () => undefined, popIn: () => undefined, run: () => ({}), punchScale: () => undefined, squash: () => undefined, delay: (_s: number, fn: () => void) => fn() },
    particles: { ring: () => undefined },
    audio: { play: () => undefined },
    items: { release: () => undefined },
  } as unknown as GameContext;
  return { ctx, zones, paid };
}

const item = (kind: ItemKind, value = 1): Item => ({ kind, value, object: new THREE.Object3D() }) as unknown as Item;

function setup(extra: { kind: ItemKind; count: number } | undefined, cash = 1000) {
  const w = makeCtx();
  const done = vi.fn();
  const pad = new ConstructionPad(w.ctx, {
    label: 'KILN',
    icon: 'machine',
    logs: 0,
    cash,
    ...(extra ? { extra } : {}),
    key: 'machine:test',
    x: 0,
    z: 0,
    size: 1.8,
    onComplete: done,
  });
  pad.show(true);
  return { ...w, pad, done };
}

function land(pad: InstanceType<typeof ConstructionPad>, it: Item): void {
  pad.receive(it, pad.reserve(it));
}

describe('formatCost', () => {
  it('keeps the existing formats below a million', () => {
    expect(formatCost(0)).toBe('$0');
    expect(formatCost(350)).toBe('$350');
    expect(formatCost(9999)).toBe('$9999');
    expect(formatCost(10_000)).toBe('$10k');
    expect(formatCost(12_500)).toBe('$12.5k');
    expect(formatCost(16_000)).toBe('$16k');
    expect(formatCost(450_000)).toBe('$450k');
  });

  it('abbreviates millions, billions and trillions compactly', () => {
    expect(formatCost(1_000_000)).toBe('$1M');
    expect(formatCost(1_350_000)).toBe('$1.35M');
    expect(formatCost(12_500_000)).toBe('$12.5M');
    expect(formatCost(984_150_000)).toBe('$984M');
    expect(formatCost(1_200_000_000)).toBe('$1.2B');
    expect(formatCost(45_000_000_000)).toBe('$45B');
    expect(formatCost(3_000_000_000_000)).toBe('$3T');
  });

  it('never prints four digits before the unit', () => {
    expect(formatCost(999_600_000)).toBe('$1B');
    expect(formatCost(999_600_000_000)).toBe('$1T');
  });
});

describe('ConstructionPad with no logs (era pads)', () => {
  it('its item zone takes only the extra kind', () => {
    const { zones } = setup({ kind: 'stone', count: 3 });
    expect(zones[0]!.opts.kinds).toEqual(['stone']);
    expect(zones[0]!.enabled).toBe(true);
    expect(zones[1]!.enabled).toBe(true);
  });

  it('never accepts logs; accepts the extra kind and cash', () => {
    const { pad } = setup({ kind: 'stone', count: 3 });
    expect(pad.logsLeft).toBe(0);
    expect(pad.canAccept('log')).toBe(false);
    expect(pad.canAccept('stone')).toBe(true);
    expect(pad.canAccept('cash')).toBe(true);
    expect(pad.canAccept('brick')).toBe(false);
  });

  it('draws the texture without a log requirement', () => {
    setup({ kind: 'stone', count: 3 });
    expect(textureCalls.at(-1)!.logs.total).toBe(0);
  });

  it('completes exactly once when cash and extra are both paid', () => {
    const { pad, done, paid, zones } = setup({ kind: 'stone', count: 2 }, 100);
    land(pad, item('cash', 100));
    expect(done).not.toHaveBeenCalled();
    expect(zones[1]!.enabled).toBe(false); // cash met: its zone is off
    land(pad, item('stone'));
    expect(done).not.toHaveBeenCalled();
    land(pad, item('stone'));
    expect(done).toHaveBeenCalledTimes(1);
    // payload shape unchanged: an extra item reports as 'log', cash as 'cash'
    expect(paid.map((e) => e.kind)).toEqual(['cash', 'log', 'log']);
    expect(paid.at(-1)).toMatchObject({ key: 'machine:test', logsLeft: 0, cashLeft: 0 });
  });

  it('a cash-only target completes on cash and its item zone stays off', () => {
    const { pad, done, zones } = setup(undefined, 100);
    expect(zones[0]!.enabled).toBe(false);
    expect(pad.canAccept('stone')).toBe(false);
    land(pad, item('cash', 60));
    expect(done).not.toHaveBeenCalled();
    land(pad, item('cash', 40));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('payDirect credits cash and completes a cash-only target', () => {
    const { pad, done } = setup(undefined, 100);
    expect(pad.payDirect(70)).toBe(70);
    expect(done).not.toHaveBeenCalled();
    expect(pad.payDirect(500)).toBe(30);
    expect(done).toHaveBeenCalledTimes(1);
    expect(pad.payDirect(10)).toBe(0);
  });

  it('payDirect alone does not complete while the extra is missing', () => {
    const { pad, done } = setup({ kind: 'stone', count: 1 }, 100);
    pad.payDirect(100);
    expect(done).not.toHaveBeenCalled();
    land(pad, item('stone'));
    expect(done).toHaveBeenCalledTimes(1);
  });
});
