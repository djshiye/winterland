/** Ambience: footprint helpers (pure) and the night-market era flag. */
import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../src/config';
import { FADE_SECONDS, MAX_ALPHA, SIDE_OFFSET, footprintAllowed, noPrintAreas, printAlpha, printPlacement } from '../src/fx/Footprints';
import { eraFor } from '../src/world/env/eras';

describe('footprintAllowed', () => {
  it('lays prints on open snow', () => {
    expect(footprintAllowed(-13, 20)).toBe(true);
    expect(footprintAllowed(-30, 40)).toBe(true);
    expect(footprintAllowed(20, -40)).toBe(true);
  });

  it('skips the yard dirt (including the expanded north part), the road, the village and the town district', () => {
    expect(footprintAllowed(0, 0)).toBe(false);
    expect(footprintAllowed(0, LAYOUT.expandedMinZ + 1)).toBe(false);
    expect(footprintAllowed(LAYOUT.tricycles.laneX, 20)).toBe(false);
    expect(footprintAllowed(4.5, 20)).toBe(false); // village street
    expect(footprintAllowed(24, 27)).toBe(false); // town square
  });

  it('every skip area is a real rectangle', () => {
    for (const a of noPrintAreas()) {
      expect(a.maxX).toBeGreaterThan(a.minX);
      expect(a.maxZ).toBeGreaterThan(a.minZ);
    }
  });
});

describe('printPlacement', () => {
  const out = { x: 0, z: 0 };
  it('offsets right / left of the heading by SIDE_OFFSET', () => {
    // heading +Z (yaw 0): right-hand side is +X
    printPlacement(1, 2, 0, 1, out);
    expect(out.x).toBeCloseTo(1 + SIDE_OFFSET);
    expect(out.z).toBeCloseTo(2);
    printPlacement(1, 2, 0, -1, out);
    expect(out.x).toBeCloseTo(1 - SIDE_OFFSET);
    // heading +X (yaw 90 deg): right-hand side is -Z
    printPlacement(0, 0, Math.PI / 2, 1, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(-SIDE_OFFSET);
  });

  it('is exactly SIDE_OFFSET from the path for any heading', () => {
    for (const yaw of [0.3, 1.9, -2.4, 3]) {
      printPlacement(5, -3, yaw, 1, out);
      expect(Math.hypot(out.x - 5, out.z + 3)).toBeCloseTo(SIDE_OFFSET);
    }
  });
});

describe('printAlpha', () => {
  it('starts visible, fades monotonically after the ease-in and is gone after 7 s', () => {
    expect(FADE_SECONDS).toBe(7);
    expect(printAlpha(0)).toBeGreaterThan(0);
    expect(printAlpha(0.2)).toBeLessThanOrEqual(MAX_ALPHA);
    let prev = printAlpha(0.2);
    for (let t = 0.5; t < FADE_SECONDS; t += 0.5) {
      const a = printAlpha(t);
      expect(a).toBeLessThan(prev);
      prev = a;
    }
    expect(printAlpha(FADE_SECONDS)).toBe(0);
    expect(printAlpha(99)).toBe(0);
    expect(printAlpha(-1)).toBe(0);
  });
});

describe('night market era flag', () => {
  it('appears at Winter City (level 4) and stays', () => {
    expect([0, 1, 2, 3, 4, 5].map((l) => eraFor(l).nightMarket)).toEqual([false, false, false, false, true, true]);
  });
});
