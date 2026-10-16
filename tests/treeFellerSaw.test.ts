/**
 * Guard: the tree feller SAWS the trunk. The saw head sits at the tip of the boom, hangs level, and its blade
 * lies flat at the cut height, so the turret slew drags the spinning blade through the trunk. (0.9.2 showed the
 * head at the elbow: the bare forearm jabbed the trunk like a hammer while the tilted blade floated in the air.)
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createTreeFeller } from '../src/assets/ridgeMachines';

// Poses used by stations/TreeFeller.ts: carry (0.55, 1.95), work height 0.85 at reach 0.7..1.75.
const CARRY = { reach: 0.55, height: 1.95 };
const WORK_HEIGHT = 0.85;
const REACHES = [0.7, 1.0, 1.3, 1.6, 1.75];

const m = createTreeFeller();
const world = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3());
const bladeAxis = (): THREE.Vector3 => new THREE.Vector3(0, 0, 1).transformDirection(m.blade.matrixWorld);
const pose = (reach: number, height: number): void => {
  m.setBoom(reach, height);
  m.root.updateMatrixWorld(true);
};

describe('tree feller saw head', () => {
  it.each(REACHES)('at reach %s the head is at the boom tip, on the cut height', (reach) => {
    pose(reach, WORK_HEIGHT);
    const head = world(m.head);
    expect(head.z).toBeCloseTo(m.shoulder.z + reach, 2);
    expect(head.y).toBeCloseTo(WORK_HEIGHT, 2);
  });

  it.each(REACHES)('at reach %s the blade lies flat, low on the trunk, just ahead of the head', (reach) => {
    pose(reach, WORK_HEIGHT);
    expect(Math.abs(bladeAxis().y)).toBeGreaterThan(0.999);
    const blade = world(m.blade);
    expect(blade.y).toBeGreaterThan(0.3);
    expect(blade.y).toBeLessThan(0.8);
    // the trunk stands ~0.3 m past the boom tip; the 0.62 m blade must cover it
    const trunkZ = m.shoulder.z + reach + 0.3;
    expect(Math.abs(blade.z - trunkZ)).toBeLessThan(0.4);
  });

  it('nothing on the boom reaches past the blade toward the trunk (no bare arm to hammer with)', () => {
    for (const reach of REACHES) {
      pose(reach, WORK_HEIGHT);
      const fore = m.head.parent!;
      const tip = fore.localToWorld(new THREE.Vector3(0, 0, 1.05));
      expect(tip.distanceTo(world(m.head))).toBeLessThan(0.05);
    }
  });

  it('carried, the blade stays flat and clear of the cab', () => {
    pose(CARRY.reach, CARRY.height);
    expect(Math.abs(bladeAxis().y)).toBeGreaterThan(0.999);
    const blade = world(m.blade);
    expect(blade.y).toBeGreaterThan(1.2);
    expect(blade.z - 0.62).toBeGreaterThan(0.6); // the cab's front face is at z 0.6
  });
});
