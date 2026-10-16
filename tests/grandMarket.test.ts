/**
 * Wave 13 Grand Market: the construction pad's optional third requirement (`extra`: toys), the pure rules (settling a
 * fully paid market, when its pad is offered, the site frame), the save sanitiser and the model's draw-call budget.
 * The pad is built with a fake GameContext and a mocked assets/pads (no canvas in the node test environment).
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT, VILLAGE } from '../src/config';
import { EventBus } from '../src/core/EventBus';
import { sanitizeState } from '../src/core/Save';
import { createGameState, type GameContext, type GameEvents, type Item, type ItemKind } from '../src/core/types';
import { createGrandMarketModel } from '../src/assets/grandMarket';
import { grandMarketFrame, grandMarketOffered, settlePaidGrandMarket } from '../src/town/rules';

const textureCalls: { icon: string; logs: unknown; cash: unknown; extra: unknown }[] = [];

vi.mock('../src/assets/pads', () => ({
  createConstructionTexture: (icon: string, logs: unknown, cash: unknown, _target?: unknown, extra?: unknown) => {
    textureCalls.push({ icon, logs: { ...(logs as object) }, cash: { ...(cash as object) }, extra: extra ? { ...(extra as object) } : undefined });
    return { image: null };
  },
  createPadModel: () => new THREE.Group(),
  createPadSign: () => new THREE.Mesh(),
  setPadSignLabel: () => undefined,
}));

// imported after the mock is registered (vi.mock is hoisted, so a static import would also work; this reads clearer)
const { ConstructionPad } = await import('../src/stations/ConstructionPad');

interface FakeZone {
  opts: { id: string; kinds?: readonly ItemKind[]; kind?: string };
  enabled: boolean;
  setEnabled(on: boolean): void;
}

function makeCtx() {
  const events = new EventBus<GameEvents>();
  const zones: FakeZone[] = [];
  const released: Item[] = [];
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
    tweens: {
      killTweensOf: () => undefined,
      popIn: () => undefined,
      run: () => ({}),
      punchScale: () => undefined,
      squash: () => undefined,
      delay: (_s: number, fn: () => void) => fn(), // fires at once (a tick later in the game)
    },
    particles: { ring: () => undefined },
    audio: { play: () => undefined },
    items: { release: (i: Item) => void released.push(i) },
  } as unknown as GameContext;
  return { ctx, zones, released, events };
}

const item = (kind: ItemKind, value = 1): Item => ({ kind, value, object: new THREE.Object3D() }) as unknown as Item;

function setup(extra: boolean, paid: { logs?: number; cash?: number; toys?: number } = {}) {
  const w = makeCtx();
  const progress: [number, number, number][] = [];
  const done = vi.fn();
  const pad = new ConstructionPad(w.ctx, {
    label: 'GRAND MARKET',
    icon: 'grandMarket',
    logs: 4,
    cash: 100,
    paidLogs: paid.logs ?? 0,
    paidCash: paid.cash ?? 0,
    ...(extra ? { extra: { kind: 'toy' as const, count: 3, paid: paid.toys ?? 0 } } : {}),
    key: 'grandMarket',
    x: 0,
    z: 0,
    size: 1.8,
    onProgress: (l, c, e) => progress.push([l, c, e]),
    onComplete: done,
  });
  return { ...w, pad, progress, done };
}

/** reserve + receive one item the way a flight does. */
function land(pad: InstanceType<typeof ConstructionPad>, it: Item): void {
  const slot = pad.reserve(it);
  pad.receive(it, slot);
}

beforeEach(() => {
  textureCalls.length = 0;
});

describe('ConstructionPad extra requirement', () => {
  it('keeps the holder id and zone ids; the item zone takes logs AND the extra kind', () => {
    const { pad, zones } = setup(true);
    expect(pad.id).toBe('pad:grandMarket');
    expect(zones.map((z) => z.opts.id)).toEqual(['pad:grandMarket:logs', 'pad:grandMarket:cash']);
    expect(zones[0]!.opts.kinds).toEqual(['log', 'toy']);
    expect(zones[0]!.opts.kind).toBe('pay');
    expect(pad.extraLeft).toBe(3);
    expect(pad.extraKind).toBe('toy');
  });

  it('a pad without extra is unchanged: logs only, no toys accepted, extraLeft 0', () => {
    const { pad, zones, done } = setup(false);
    expect(zones[0]!.opts.kinds).toEqual(['log']);
    pad.show(true);
    expect(pad.canAccept('toy')).toBe(false);
    expect(pad.extraLeft).toBe(0);
    expect(pad.extraKind).toBeNull();
    for (let i = 0; i < 4; i++) land(pad, item('log'));
    land(pad, item('cash', 100));
    expect(done).toHaveBeenCalledTimes(1);
    expect(textureCalls.at(-1)!.extra).toBeUndefined();
  });

  it('accepts the extra kind only while shown and while some is still missing (landed + in flight)', () => {
    const { pad } = setup(true);
    expect(pad.canAccept('toy')).toBe(false); // hidden
    pad.show(true);
    expect(pad.canAccept('toy')).toBe(true);
    expect(pad.canAccept('crate')).toBe(false);
    const slots = [item('toy'), item('toy'), item('toy')].map((i) => pad.reserve(i));
    expect(pad.canAccept('toy')).toBe(false); // 3 in flight cover the 3 needed
    pad.cancel(slots[2]!);
    expect(pad.canAccept('toy')).toBe(true);
  });

  it('counts a landed toy, releases it, reports a third progress argument and draws it', () => {
    const { pad, progress, released } = setup(true);
    pad.show(true);
    const t = item('toy');
    const slot = pad.reserve(t);
    expect(progress.at(-1)).toEqual([0, 0, 1]); // in flight already counts (a save mid-flight keeps it)
    pad.receive(t, slot);
    expect(pad.extraLeft).toBe(2);
    expect(progress.at(-1)).toEqual([0, 0, 1]);
    expect(released).toContain(t);
    expect(pad.logsLeft).toBe(4); // not eaten as a log
    expect(pad.cashLeft).toBe(100); // not eaten as cash
    expect(textureCalls.at(-1)!.extra).toEqual({ left: 2, total: 3, kind: 'toy' });
  });

  it('completes only when logs, cash AND extra are all paid, exactly once', () => {
    const { pad, done, events } = setup(true);
    pad.show(true);
    const paid: GameEvents['construction:paid'][] = [];
    events.on('construction:paid', (e) => paid.push(e));
    for (let i = 0; i < 4; i++) land(pad, item('log'));
    land(pad, item('cash', 100));
    expect(done).not.toHaveBeenCalled();
    land(pad, item('toy'));
    land(pad, item('toy'));
    expect(done).not.toHaveBeenCalled();
    land(pad, item('toy'));
    expect(done).toHaveBeenCalledTimes(1);
    expect(pad.visible).toBe(false);
    expect(paid.length).toBe(4 + 1 + 3);
  });

  it('payDirect completes a pad whose logs and extra are done, and not before', () => {
    const { pad, done } = setup(true, { logs: 4, toys: 2 });
    pad.show(true);
    expect(pad.payDirect(60)).toBe(60);
    expect(done).not.toHaveBeenCalled();
    land(pad, item('toy'));
    expect(done).not.toHaveBeenCalled(); // 40 of cash still missing
    expect(pad.payDirect(500)).toBe(40);
    expect(done).toHaveBeenCalledTimes(1);

    const b = setup(true, { logs: 4, toys: 0 });
    b.pad.show(true);
    b.pad.payDirect(100);
    expect(b.done).not.toHaveBeenCalled(); // toys still missing
  });

  it('a restored fully paid target (logs, cash, extra) completes when shown; one missing a toy does not', () => {
    const a = setup(true, { logs: 4, cash: 100, toys: 3 });
    a.pad.show(true);
    expect(a.done).toHaveBeenCalledTimes(1);
    const b = setup(true, { logs: 4, cash: 100, toys: 2 });
    b.pad.show(true);
    expect(b.done).not.toHaveBeenCalled();
    expect(b.pad.extraLeft).toBe(1);
  });

  it('rearm switches the extra requirement; the item zone follows what is missing', () => {
    const { pad, zones, done } = setup(true, { logs: 4, cash: 100, toys: 2 });
    pad.show(true);
    expect(zones[0]!.enabled).toBe(true); // a toy is missing although the logs are done
    land(pad, item('toy'));
    expect(done).toHaveBeenCalledTimes(1);
    pad.rearm({ label: 'NEXT', icon: 'grandMarket', logs: 1, cash: 5, extra: { kind: 'toy', count: 2 } });
    expect(pad.extraLeft).toBe(2);
    expect(pad.logsLeft).toBe(1);
  });

  it('a toy-only deficit keeps the item zone on and a toy-only surplus turns it off', () => {
    const { pad, zones } = setup(true, { logs: 4, cash: 0, toys: 0 });
    pad.show(true);
    expect(zones[0]!.enabled).toBe(true);
    for (let i = 0; i < 3; i++) pad.reserve(item('toy'));
    expect(zones[0]!.enabled).toBe(false); // logs done, 3 toys in flight
  });
});

describe('Grand Market rules', () => {
  const def = VILLAGE.grandMarket;

  it('a new game has the market unbuilt, nothing paid', () => {
    expect(createGameState().town.grandMarket).toEqual({ tier: -1, logs: 0, cash: 0, toys: 0 });
  });

  it('settlePaidGrandMarket finishes only a market paid in all three requirements, silently', () => {
    const s = createGameState();
    s.town.grandMarket = { tier: -1, logs: def.logs, cash: def.cash, toys: def.toys - 1 };
    expect(settlePaidGrandMarket(s)).toBe(0);
    s.town.grandMarket = { tier: -1, logs: def.logs - 1, cash: def.cash, toys: def.toys };
    expect(settlePaidGrandMarket(s)).toBe(0);
    s.town.grandMarket = { tier: -1, logs: def.logs, cash: def.cash - 5, toys: def.toys };
    expect(settlePaidGrandMarket(s)).toBe(0);
    s.town.grandMarket = { tier: -1, logs: def.logs, cash: def.cash, toys: def.toys };
    expect(settlePaidGrandMarket(s)).toBe(1);
    expect(s.town.grandMarket).toEqual({ tier: 0, logs: 0, cash: 0, toys: 0 });
    expect(settlePaidGrandMarket(s)).toBe(0); // idempotent
  });

  it('is offered only on a revealed town at the Winterland era, until it is built', () => {
    const s = createGameState();
    expect(grandMarketOffered(s)).toBe(false);
    s.town.revealed = true;
    s.village.level = def.requiresLevel - 1;
    expect(grandMarketOffered(s)).toBe(false);
    s.village.level = def.requiresLevel;
    expect(grandMarketOffered(s)).toBe(true);
    s.town.grandMarket.tier = 0;
    expect(grandMarketOffered(s)).toBe(false);
  });

  it('progress (logs, cash, toys) survives the save sanitiser, capped at the totals', () => {
    const s = createGameState();
    s.town.revealed = true;
    s.town.grandMarket = { tier: -1, logs: 40, cash: 12000, toys: 7 };
    const back = JSON.parse(JSON.stringify(s)) as typeof s;
    sanitizeState(back);
    expect(back.town.grandMarket).toEqual({ tier: -1, logs: 40, cash: 12000, toys: 7 });
    back.town.grandMarket.toys = 999;
    sanitizeState(back);
    expect(back.town.grandMarket.toys).toBeLessThanOrEqual(def.toys);
  });

  it('the site frame matches LAYOUT.town.grandMarket (front toward the camera side, +Z)', () => {
    const m = LAYOUT.town.grandMarket;
    const f = grandMarketFrame();
    expect(f.pad).toEqual(m.pad);
    expect(f.padRect.maxX - f.padRect.minX).toBeCloseTo(m.padSize);
    expect(f.rect.maxX - f.rect.minX).toBeCloseTo(m.w);
    expect(f.rect.maxZ - f.rect.minZ).toBeCloseTo(m.d);
    expect(Math.abs(Math.sin(f.yaw * 2))).toBeLessThan(1e-9);
  });
});

describe('Grand Market model', () => {
  it('is three meshes (body + window glow + bulbs), inside its footprint, with two chimneys above the roof', () => {
    const m = createGrandMarketModel();
    const meshes: THREE.Mesh[] = [];
    m.root.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh);
    });
    expect(meshes.length).toBe(3);
    expect(m.glow.length).toBe(2);
    for (const g of m.glow) expect(meshes).toContain(g);
    expect(m.w).toBeCloseTo(LAYOUT.town.grandMarket.w);
    expect(m.d).toBeCloseTo(LAYOUT.town.grandMarket.d);
    m.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m.root);
    const a = LAYOUT.town.grandMarket;
    expect(box.min.x).toBeGreaterThanOrEqual(-a.w / 2 - 0.06);
    expect(box.max.x).toBeLessThanOrEqual(a.w / 2 + 0.06);
    expect(box.min.z).toBeGreaterThanOrEqual(-a.d / 2 - 0.06);
    expect(box.max.z).toBeLessThanOrEqual(a.d / 2 + 0.06);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.05);
    expect(m.chimney.length).toBe(2);
    for (const c of m.chimney) {
      expect(Math.abs(c.x)).toBeLessThan(a.w / 2);
      expect(Math.abs(c.z)).toBeLessThan(a.d / 2);
      expect(c.y).toBeGreaterThan(3);
    }
    // a second model shares the baked geometry
    const again = createGrandMarketModel();
    expect((again.root.children[0] as THREE.Mesh).geometry).toBe(meshes[0]!.geometry);
  });
});
