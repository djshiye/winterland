/**
 * 0.9.11 (running hot): belt rollers are culled like any mesh, cast no shadow, and only rebuild their matrices when
 * three is about to draw them (onBeforeRender), so belts out of view cost nothing per frame.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createRollerConveyor } from '../src/assets/machines';

const belt = () =>
  createRollerConveyor(
    [
      { x: 0, z: 0 },
      { x: 6, z: 0 },
      { x: 6, z: 4 },
    ],
    0.8,
    0.6,
  );

describe('belt rollers', () => {
  it('are culled by their own extent and cast no shadow', () => {
    const { rollers } = belt();
    expect(rollers.frustumCulled).toBe(true);
    expect(rollers.castShadow).toBe(false);
    const s = rollers.boundingSphere!;
    expect(s.radius).toBeGreaterThan(3);
    expect(s.radius).toBeLessThan(8);
  });

  it('a spin is applied when the rollers are drawn, not before', () => {
    const m = belt();
    const before = new THREE.Matrix4();
    const after = new THREE.Matrix4();
    m.rollers.getMatrixAt(0, before);
    m.setRollers(1.2);
    m.rollers.getMatrixAt(0, after);
    expect(after.equals(before)).toBe(true);
    const call = m.rollers.onBeforeRender as unknown as () => void;
    call();
    m.rollers.getMatrixAt(0, after);
    expect(after.equals(before)).toBe(false);
    // the roller keeps its spot, only its turn changes
    const p0 = new THREE.Vector3().setFromMatrixPosition(before);
    const p1 = new THREE.Vector3().setFromMatrixPosition(after);
    expect(p1.distanceTo(p0)).toBeLessThan(1e-6);
  });
});
