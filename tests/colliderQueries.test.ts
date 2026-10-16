/**
 * 0.9.2: the ColliderWorld queries behind the player's steering assist (entities/Player.ts steer): which decor blocks
 * the way ahead, and whether a spot is walkable at all.
 */
import { describe, expect, it } from 'vitest';
import { ColliderWorld } from '../src/world/Colliders';

const world = (): ColliderWorld => {
  const c = new ColliderWorld();
  c.setBounds({ minX: 0, maxX: 10, minZ: 0, maxZ: 10 });
  c.addBounds({ minX: 9, maxX: 20, minZ: 4, maxZ: 6 }); // a corridor leaving the yard
  c.addCircle(5, 5, 1, 'town:tree');
  c.addBox({ minX: 2, maxX: 3, minZ: 2, maxZ: 3 }, 'town:0');
  return c;
};

describe('ColliderWorld queries', () => {
  it('overlapsWhere only counts the obstacles whose tag passes', () => {
    const c = world();
    const decor = (t: string): boolean => t === 'town:tree';
    expect(c.overlapsWhere(5.5, 5, 0.36, decor)).toBe(true);
    expect(c.overlapsWhere(2.5, 2.5, 0.36, decor)).toBe(false);
    expect(c.overlaps(2.5, 2.5, 0.36)).toBe(true);
  });

  it('inBounds follows the yard (shrunk by the radius) and the extra walkable rects', () => {
    const c = world();
    expect(c.inBounds(0.2, 5, 0.36)).toBe(false);
    expect(c.inBounds(1, 5, 0.36)).toBe(true);
    expect(c.inBounds(15, 5, 0.36)).toBe(true);
    expect(c.inBounds(15, 8, 0.36)).toBe(false);
  });

  it('isFree is inside the bounds and clear of every obstacle', () => {
    const c = world();
    expect(c.isFree(8, 8, 0.36)).toBe(true);
    expect(c.isFree(5, 5.8, 0.36)).toBe(false);
    expect(c.isFree(15, 8, 0.36)).toBe(false);
  });
});
