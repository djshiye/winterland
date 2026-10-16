/**
 * 0.9.2: every Survival-era pad tile can be read from the fixed isometric camera. The camera sits toward +X/+Z
 * (CAMERA.yawDeg) looking down at CAMERA.pitchDeg, so anything tall on a pad's +X/+Z side covers the tile and its
 * price. The cash tubes and workshop level pads were half / fully behind their buildings, the tree feller pad behind
 * the pines: they moved to the camera side. Boxes are the colliders / footprints with a generous model height.
 */
import { describe, expect, it } from 'vitest';
import { CAMERA, LAYOUT, PADS, rect, type Rect } from '../src/config';
import { TOWER } from '../src/stations/CashTubes';
import { TOWER_HEIGHT } from '../src/assets/ridgeMachines';

interface Box {
  name: string;
  r: Rect;
  h: number;
}

const P = LAYOUT;
const Q = P.ridge.quarters;
const WS = P.ridge.workshop;
const TALL: Box[] = [
  { name: 'cabin', r: P.cabin, h: 3.8 },
  { name: 'cash tower', r: rect(TOWER.x, TOWER.z, 1.2, 1.0), h: TOWER_HEIGHT },
  { name: 'processor', r: rect(P.processor.x, P.processor.z, 1.6, 1.4), h: 2.6 },
  { name: 'mega saw', r: P.megaSaw.base, h: 4.5 },
  { name: 'harvester', r: P.harvester.collider, h: 3.0 },
  { name: 'workshop', r: rect(WS.x, WS.z, WS.w, WS.d), h: 3.6 },
  { name: 'bunkhouse', r: rect(Q.x, Q.z, Q.w, Q.d), h: 3.6 },
  { name: 'pine forest', r: P.ridge.forest, h: 5.5 },
];

const yaw = (CAMERA.yawDeg * Math.PI) / 180;
const rise = Math.tan((CAMERA.pitchDeg * Math.PI) / 180);
/** Horizontal step toward the camera. */
const ux = Math.sin(yaw);
const uz = Math.cos(yaw);

/** The first tall box the view ray from ground point (x, z) passes through, or null. */
function coveredBy(x: number, z: number): string | null {
  for (let d = 0.05; d < 14; d += 0.05) {
    const px = x + ux * d;
    const pz = z + uz * d;
    const y = d * rise;
    for (const b of TALL) {
      if (y < b.h && px > b.r.minX && px < b.r.maxX && pz > b.r.minZ && pz < b.r.maxZ) return b.name;
    }
  }
  return null;
}

/** Share of the tile (5 x 5 samples, the outer 10 % left out) the camera cannot see, and what covers it. */
function hidden(x: number, z: number, size: number): { share: number; by: string[] } {
  const by = new Set<string>();
  let n = 0;
  let hit = 0;
  for (let i = 0; i < 5; i++) {
    for (let k = 0; k < 5; k++) {
      const px = x + (i / 4 - 0.5) * size * 0.8;
      const pz = z + (k / 4 - 0.5) * size * 0.8;
      n++;
      const b = coveredBy(px, pz);
      if (b) {
        hit++;
        by.add(b);
      }
    }
  }
  return { share: hit / n, by: [...by] };
}

describe('pad tiles face the camera', () => {
  it('the camera looks from +X / +Z', () => {
    expect(ux).toBeGreaterThan(0);
    expect(uz).toBeGreaterThan(0);
  });

  for (const pad of Object.values(PADS)) {
    it(`${pad.label} is not hidden behind a building or trees`, () => {
      const h = hidden(pad.x, pad.z, pad.size);
      expect(h.share, `${pad.label} covered by ${h.by.join(', ')}`).toBe(0);
    });
  }

  it('the bunkhouse construction pad is not hidden behind its own building', () => {
    const h = hidden(Q.pad.x, Q.pad.z, Q.padSize);
    expect(h.share, h.by.join(', ')).toBe(0);
  });

  it('the old spots were hidden (the check really sees buildings)', () => {
    expect(hidden(25.0, 0.9, 2.0).share).toBeGreaterThan(0.5); // workshop level pad behind the workshop
    expect(hidden(4.0, -7.6, 2.0).by).toContain('cabin'); // cash tubes level pad behind the cabin
    expect(hidden(19.6, -9.6, 2.0).by).toContain('pine forest'); // tree feller pad behind the pines
  });
});
