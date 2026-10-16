/**
 * 0.9.5 era hand nodes (eras/HandNode.ts): the harvest zone aims the player's era tool, only strikes carrying the
 * node's era yield, a full pile stops the swing, and the node is generic over every era 2..10.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../src/config';
import { EventBus } from '../src/core/EventBus';
import { createGameState, type GameContext, type GameEvents, type Item, type ItemKind } from '../src/core/types';
import { ERA_NODES } from '../src/assets/eraNodes';
import { HandNode, NODE_BASE_INTERVAL, NODE_PILE, handNodePlace } from '../src/eras/HandNode';
import { regionLayout } from '../src/eras/layout';

interface FakeZone {
  opts: { id: string; onStay?: () => void; onExit?: () => void };
  removed: boolean;
}

function makeNode(era: number) {
  const events = new EventBus<GameEvents>();
  const state = createGameState();
  const zones: FakeZone[] = [];
  const chop: { target: THREE.Vector3 | null; node?: { era: number; interval: number; tier: number } } = { target: null };
  let nextId = 1;
  const ctx = {
    scene: new THREE.Scene(),
    events,
    state,
    time: { elapsed: 0, frame: 0 },
    upgrades: { value: (id: keyof typeof UPGRADES) => UPGRADES[id].values[0], level: () => 0 },
    tweens: { killTweensOf: () => undefined, popIn: () => undefined, run: () => ({}), punchScale: () => undefined, squash: () => undefined, delay: () => undefined },
    player: {
      arms: { id: 'arms' },
      position: new THREE.Vector3(),
      setChopTarget: (p: THREE.Vector3 | null, node?: { era: number; interval: number; tier: number }) => {
        chop.target = p ? p.clone() : null;
        chop.node = node;
      },
    },
    zones: {
      add: (opts: FakeZone['opts']) => (zones.push({ opts, removed: false }), zones[zones.length - 1]),
      addTransfer: (opts: FakeZone['opts']) => (zones.push({ opts, removed: false }), zones[zones.length - 1]),
      remove: (z: FakeZone) => void (z.removed = true),
    },
    colliders: { addBox: () => ({}), remove: () => undefined },
    items: { create: (kind: ItemKind): Item => ({ id: nextId++, kind, value: 0, object: new THREE.Object3D() }) as Item, release: () => undefined },
    flights: { launch: (item: Item, to: { receive(i: Item, s: unknown): void }, slot: unknown) => to.receive(item, slot), inFlightTo: () => 0 },
  } as unknown as GameContext;
  const root = new THREE.Group();
  const node = new HandNode(ctx, era, { x: 10, z: 20 }, 0, root);
  const harvest = zones.find((z) => z.opts.id === `zone:node${era}`)!;
  return { ctx, events, state, node, harvest, zones, chop, root };
}

describe('HandNode', () => {
  for (const era of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    it(`era ${era}: standing in the zone aims the era tool; a strike puts ${ERA_NODES[era]!.yields} on the pile`, () => {
      const w = makeNode(era);
      w.harvest.opts.onStay!();
      expect(w.chop.target).not.toBeNull();
      expect(w.chop.node).toEqual({ era, interval: NODE_BASE_INTERVAL, tier: 0 });
      w.events.emit('player:chopHit', { position: w.chop.target!, node: era });
      expect(w.node.pile.count(ERA_NODES[era]!.yields)).toBe(1);
      expect(w.state.stats.materialsMade).toBe(1);
    });
  }

  it("ignores the giant log's strikes and other eras' nodes", () => {
    const w = makeNode(5);
    w.events.emit('player:chopHit', { position: new THREE.Vector3() });
    w.events.emit('player:chopHit', { position: new THREE.Vector3(), node: 6 });
    expect(w.node.pile.count()).toBe(0);
  });

  it('a full pile stops the swing, and leaving the zone clears the target', () => {
    const w = makeNode(7);
    const cap = NODE_PILE.cols * NODE_PILE.rows * NODE_PILE.layers;
    for (let i = 0; i < cap + 3; i++) w.events.emit('player:chopHit', { position: new THREE.Vector3(), node: 7 });
    expect(w.node.pile.count('crude')).toBe(cap);
    w.harvest.opts.onStay!();
    expect(w.chop.target).toBeNull();
    w.harvest.opts.onExit!();
    expect(w.chop.target).toBeNull();
  });

  it('dispose removes the zones, the listener and the model', () => {
    const w = makeNode(6);
    w.node.dispose();
    expect(w.zones.every((z) => z.removed)).toBe(true);
    expect(w.root.children).toHaveLength(0);
    w.events.emit('player:chopHit', { position: new THREE.Vector3(), node: 6 });
    expect(w.node.pile.count()).toBe(0);
  });

  it('the node stands at the layout node place, else mid harvest zone facing the gate, else nowhere', () => {
    const { node: _node, ...L } = regionLayout(5);
    expect(handNodePlace({ ...L, node: { x: 1, z: 2, yaw: 0 } } as never)).toEqual({ x: 1, z: 2, yaw: 0 });
    const harvest = { minX: 0, maxX: 20, minZ: 30, maxZ: 40 };
    expect(handNodePlace({ ...L, inward: 1, zones: { harvest } } as never)).toEqual({ x: 8.7, z: 35, yaw: Math.PI });
    expect(handNodePlace({ ...L, inward: -1, zones: { harvest } } as never)).toEqual({ x: 8.7, z: 35, yaw: 0 });
    const bare = { ...L } as Record<string, unknown>;
    delete bare.zones;
    delete bare.node;
    expect(handNodePlace(bare as never)).toBeNull();
  });
});
