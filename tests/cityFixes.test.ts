/**
 * 0.9.0 city / town crew fixes: the scaffold frees its merged geometry, demolishing a lot the player stands on opens
 * the choose card, a demolish / rebuild across a rank threshold does not replay 'city:rankUp', and a cashier walking
 * to a demolished town till turns back at once. Stub contexts, no WebGL.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createCityScaffold } from '../src/assets/cityBuildings';
import { EventBus } from '../src/core/EventBus';
import { createGameState, type GameContext, type GameEvents, type GameState } from '../src/core/types';
import { cityBuildingsOfEra } from '../src/eras/data';
import { City } from '../src/city/City';
import { District, disposeScaffold } from '../src/city/District';
import { geo } from '../src/render/materials';
import { Cashier } from '../src/npc/crewHelpers';

// canvas textures (glow halos, signs) draw into a 2D context nobody looks at here
const noop: unknown = new Proxy(() => noop, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop), apply: () => noop });
vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });

interface FakeZone {
  area: unknown;
  enabled: boolean;
  playerInside: boolean;
  opts: { onEnter?: () => void; onExit?: () => void };
  setEnabled(on: boolean): void;
}

function makeCtx(state: GameState) {
  const events = new EventBus<GameEvents>();
  const zones: FakeZone[] = [];
  const ctx = {
    scene: new THREE.Scene(),
    state,
    events,
    addUpdatable: () => undefined,
    time: { elapsed: 0 },
    camera: new THREE.PerspectiveCamera(),
    player: { position: new THREE.Vector3(), arms: { count: () => 0 }, back: {} },
    economy: { money: 1e9, spend: () => true, add: () => undefined },
    upgrades: { value: () => 1 },
    colliders: { addBounds: () => undefined, addBox: () => ({}), remove: () => undefined },
    zones: {
      add: (opts: FakeZone['opts'] & { area: unknown; enabled: boolean }) => {
        const z: FakeZone = { area: opts.area, enabled: opts.enabled, playerInside: false, opts, setEnabled: (on) => void (z.enabled = on) };
        zones.push(z);
        return z;
      },
      addTransfer: () => ({ enabled: false, setEnabled: () => undefined }),
      isPlayerIn: () => false,
    },
    tweens: { killTweensOf: () => undefined, popIn: () => undefined, run: () => undefined, punchScale: () => undefined, delay: () => undefined },
    particles: { puff: () => undefined, ring: () => undefined },
    audio: { play: () => undefined },
    items: { release: () => undefined },
  } as unknown as GameContext;
  return { ctx, events, zones };
}

describe('city scaffold geometry', () => {
  it('disposeScaffold frees the merged base, not the shared unit box', () => {
    const s = createCityScaffold(5, 4);
    const shared = geo.boxBase(1, 1, 1);
    const own = s.group.children.map((o) => (o as THREE.Mesh).geometry).filter((g) => g !== shared);
    expect(own.length).toBeGreaterThan(0);
    const freed = vi.fn();
    const keep = vi.fn();
    for (const g of own) g.addEventListener('dispose', freed);
    shared.addEventListener('dispose', keep);
    disposeScaffold(s.group);
    expect(freed).toHaveBeenCalledTimes(own.length);
    expect(keep).not.toHaveBeenCalled();
    shared.removeEventListener('dispose', keep);
  });
});

describe('District.demolish while standing on the lot', () => {
  it('swaps the manage card for the choose card', () => {
    const state = createGameState();
    state.eras.age = 2;
    const { ctx, events, zones } = makeCtx(state);
    const d = new District(ctx, 2, () => undefined);
    d.activate();
    const id = cityBuildingsOfEra(2)[0]!;
    expect(d.debugBuild(0, id)).toBe(true);
    const z = zones[0]!;
    expect(z.enabled).toBe(true);
    // the player steps on: manage opens
    const open = vi.fn();
    events.on('choose:open', open);
    z.playerInside = true;
    z.opts.onEnter!();
    expect(d.demolish(0)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does not open a card for a player who is not on the tile', () => {
    const state = createGameState();
    state.eras.age = 2;
    const { ctx, events } = makeCtx(state);
    const d = new District(ctx, 2, () => undefined);
    d.activate();
    expect(d.debugBuild(0, cityBuildingsOfEra(2)[0]!)).toBe(true);
    const open = vi.fn();
    events.on('choose:open', open);
    expect(d.demolish(0)).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('City rank banner', () => {
  it('a drop below a threshold and back does not announce the rank again', () => {
    const state = createGameState();
    state.eras.age = 10;
    state.village.population = 0;
    const { ctx, events } = makeCtx(state);
    new City(ctx);
    const up = vi.fn();
    events.on('city:rankUp', up);
    state.village.population = 100000;
    events.emit('village:changed', undefined as never);
    const first = up.mock.calls.length;
    expect(first).toBe(1);
    state.village.population = 0;
    events.emit('village:changed', undefined as never);
    state.village.population = 100000;
    events.emit('village:changed', undefined as never);
    expect(up).toHaveBeenCalledTimes(first);
  });
});

describe('Cashier and a demolished town till', () => {
  const proto = Cashier.prototype as unknown as { think(dt: number): void; leave(passed?: number): void };
  const route = [{ x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 }];

  it('turns back while still walking when its stop has no pile any more', () => {
    let alive = true;
    const pile = {};
    const goReverse = vi.fn();
    const self = {
      phase: 'go',
      moving: true,
      routeIdx: 2,
      stop: { route, post: { x: 4, z: 0 }, look: { x: 4, z: 1 }, pile: () => (alive ? pile : null) },
      goReverse,
      leave: proto.leave,
    };
    proto.think.call(self, 0.1);
    expect(goReverse).not.toHaveBeenCalled();
    expect(self.phase).toBe('go');
    alive = false;
    proto.think.call(self, 0.1);
    expect(self.phase).toBe('back');
    // back over the two waypoints already passed, not out to the far end of the route first
    expect(goReverse).toHaveBeenCalledTimes(1);
    expect(goReverse.mock.calls[0]![0]).toEqual(route.slice(0, 2));
  });

  it('still walks the whole route home from the post', () => {
    const goReverse = vi.fn();
    const self = { phase: 'collect', routeIdx: route.length + 1, stop: { route }, goReverse };
    proto.leave.call(self);
    expect(goReverse.mock.calls[0]![0]).toEqual(route);
    expect(self.phase).toBe('back');
  });
});
