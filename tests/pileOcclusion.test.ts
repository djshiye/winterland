/**
 * 0.9.0 draw calls: a full single-kind world pile hides the items the fixed isometric camera cannot see (top and
 * camera-facing sides covered by landed neighbours); taking from the top shows them again. Stub context, no WebGL.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { TweenManager } from '../src/core/Tween';
import { createGameState, type GameContext, type GameEvents } from '../src/core/types';
import { ItemPool } from '../src/items/ItemPool';
import { Pile } from '../src/items/Pile';

function makeCtx(): GameContext {
  const c: Record<string, unknown> = { events: new EventBus<GameEvents>(), state: createGameState(), scene: new THREE.Scene(), time: { frame: 0, elapsed: 0 } };
  const ctx = c as unknown as GameContext;
  c.tweens = new TweenManager();
  c.items = new ItemPool(ctx);
  return ctx;
}

const grid = { cols: 3, rows: 7, layers: 4, spacing: { x: 0.66, y: 0.24, z: 0.26 } };
const visible = (p: Pile): number => p.root.children.filter((o) => o.visible).length;

describe('Pile hidden interior', () => {
  it('a full 3 x 7 x 4 log pile draws 48 of 84 and shows them again as it empties', () => {
    const ctx = makeCtx();
    const pile = new Pile(ctx, { id: 'pile:test', accepts: ['log'], position: new THREE.Vector3(), grid });
    pile.fill('log', 84);
    expect(pile.count()).toBe(84);
    expect(visible(pile)).toBe(84 - 2 * 6 * 3);
    // a taken item is visible wherever it goes
    const top = pile.take('log')!;
    expect(top.object.visible).toBe(true);
    expect(visible(pile)).toBe(47);
    // a hole over an interior item uncovers it
    const next = pile.take('log')!; // slot 82: col 1, row 6, top layer (row 6 faces the camera, so nothing below was hidden)
    expect(next.object.visible).toBe(true);
    for (let k = 0; k < 3; k++) pile.take('log'); // slots 81..79: (0,6), (2,5), (1,5) of the top layer
    expect(visible(pile)).toBe(47 - 4 + 1); // (1,5,2) below the hole is drawn again
    while (pile.count() > 21) pile.take('log');
    expect(visible(pile)).toBe(21);
  });

  it('piles on a moving parent and mixed piles draw everything', () => {
    const ctx = makeCtx();
    const parent = new THREE.Group();
    ctx.scene.add(parent);
    const bed = new Pile(ctx, { id: 'pile:bed', accepts: ['log'], position: new THREE.Vector3(), parent, grid });
    bed.fill('log', 84);
    expect(visible(bed)).toBe(84);
    const mixed = new Pile(ctx, { id: 'pile:mixed', accepts: ['log', 'crate'], position: new THREE.Vector3(), grid });
    mixed.fill('log', 84);
    expect(visible(mixed)).toBe(84);
  });
});
