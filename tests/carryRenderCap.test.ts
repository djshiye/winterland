/**
 * The climb's carry render cap (docs/EXPANSION.md §A1): the player's arms hold up to carry 50 + dog 12, but only
 * PLAYER.armsRenderCap (0.8.0's 40 + 6) items are drawn; the rest ride hidden and the badge counts them as "+N".
 * Stub context, no WebGL.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PLAYER } from '../src/config';
import type { GameContext, Item } from '../src/core/types';
import { CarryStack } from '../src/items/CarryStack';

// the badge's canvas texture draws into a 2D context nobody looks at here
const noop: unknown = new Proxy(() => noop, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop), apply: () => noop });
vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });

const ctx = {
  scene: new THREE.Scene(),
  time: { elapsed: 0, frame: 0 },
  items: { stackHeight: () => 0.2, release: () => undefined },
  tweens: { punchScale: () => undefined, killTweensOf: () => undefined },
} as unknown as GameContext;

const log = (): Item => ({ kind: 'log', object: new THREE.Object3D(), value: 0 }) as unknown as Item;

describe('CarryStack render cap', () => {
  it('draws the bottom renderCap items, hides the rest on top, and shows them again when taken', () => {
    const anchor = new THREE.Object3D();
    const cap = PLAYER.armsRenderCap;
    const stack = new CarryStack(ctx, { id: 't.arms', accepts: ['log'], capacity: 62, anchor, columnHeight: 3.4, renderCap: cap });
    const items = Array.from({ length: 62 }, log);
    for (const it of items) expect(stack.addImmediate(it)).toBe(true);
    expect(stack.size).toBe(62);
    expect(stack.isFull()).toBe(true);
    items.forEach((it, i) => expect(it.object.visible).toBe(i < cap));
    // hidden items take no room: they rest exactly on top of the last drawn one
    const top = items[cap - 1]!.object.position;
    for (let i = cap; i < 62; i++) expect(items[i]!.object.position.y).toBeCloseTo(top.y + 0.1, 6);
    const badge = anchor.children.find((o) => o.name === 't.arms.maxBadge')!;
    expect(badge.visible).toBe(true);

    const taken = stack.take()!;
    expect(taken).toBe(items[61]);
    expect(taken.object.visible).toBe(true);
    // emptying down to the cap leaves only drawn items and hides the badge
    while (stack.size > cap) stack.take();
    expect(items.slice(0, cap).every((it) => it.object.visible)).toBe(true);
    expect(badge.visible).toBe(false);
  });

  it('without a render cap every item is drawn (NPC stacks, 0.8.0 loads)', () => {
    const stack = new CarryStack(ctx, { id: 't.npc', accepts: ['log'], capacity: 50, anchor: new THREE.Object3D() });
    const items = Array.from({ length: 50 }, log);
    for (const it of items) stack.addImmediate(it);
    expect(items.every((it) => it.object.visible)).toBe(true);
  });
});
