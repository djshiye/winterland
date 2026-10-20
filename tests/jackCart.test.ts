/** Jack's cart wears each era's colours; era 1 stays the frozen red / cream / green / yellow benchmark. */
import { describe, expect, it } from 'vitest';
import { createJackCartModel } from '../src/assets/jack';
import type * as THREE from 'three';

function colors(era?: number): number[] {
  const body = createJackCartModel(era).root.getObjectByName('jackCart') as THREE.Mesh;
  return Array.from(body.geometry.getAttribute('color').array as ArrayLike<number>);
}

describe('createJackCartModel eras', () => {
  const base = colors();
  it('era 1 equals the default', () => {
    expect(colors(1)).toEqual(base);
  });
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10])('era %i differs from era 1', (era) => {
    const c = colors(era);
    expect(c).not.toEqual(base);
  });
  it('keeps collider constants', () => {
    const m = createJackCartModel(8);
    expect([m.halfW, m.halfD]).toEqual([1.05, 0.55]);
  });
});
