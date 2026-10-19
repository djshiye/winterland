/**
 * 0.9.12: every fast-travel landing is in the place it names, and nearer to it than to any other place. Dino: "the
 * teleport to the 3rd era teleports you to the houses of the first" (the district jump landed on the street beside the
 * previous district's houses). scripts/traffic-check.mjs also travels to each one in the game and checks the player
 * stands where it lands (nothing shoves them off).
 */
import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/core/types';
import { DISTRICTS, MAX_ERA, REGIONS, type ERect } from '../src/eras/data';
import { regionLayout, travelPoints } from '../src/eras/layout';
import { goTarget } from '../src/ui/GateCard';
import { LAYOUT } from '../src/config';

const inside = (r: ERect, p: { x: number; z: number }, pad = 0): boolean => p.x >= r.minX - pad && p.x <= r.maxX + pad && p.z >= r.minZ - pad && p.z <= r.maxZ + pad;
/** Distance from a point to a rect (0 inside). */
const away = (r: ERect, p: { x: number; z: number }): number => Math.hypot(Math.max(r.minX - p.x, 0, p.x - r.maxX), Math.max(r.minZ - p.z, 0, p.z - r.maxZ));

function stateAt(age: number) {
  const s = createGameState();
  s.eras.age = age;
  for (let n = 2; n <= age; n++) if (s.eras.regions[n]) s.eras.regions[n]!.unlocked = true;
  s.village.revealed = true;
  s.town.revealed = true;
  return s;
}

describe('fast travel lands in the place it names', () => {
  const s = stateAt(MAX_ERA);
  const pts = travelPoints(s);

  for (let n = 2; n <= MAX_ERA; n++) {
    it(`district ${n} (${DISTRICTS[n]!.name}): inside it, nearer to it than to any other district`, () => {
      const p = pts.find((q) => q.id === `district:${n}`)!;
      expect(inside(DISTRICTS[n]!.rect, p)).toBe(true);
      for (let k = 2; k <= MAX_ERA; k++) {
        if (k === n) continue;
        expect(away(DISTRICTS[k]!.rect, p), `nearer to district ${k}`).toBeGreaterThan(away(DISTRICTS[n]!.rect, p) + 4);
      }
    });

    it(`region ${n}: inside its own fence, and its shop jump too`, () => {
      const p = pts.find((q) => q.id === `region:${n}`)!;
      expect(inside(REGIONS[n]!.rect, p)).toBe(true);
      for (let k = 2; k <= MAX_ERA; k++) if (k !== n) expect(inside(REGIONS[k]!.rect, p, 4)).toBe(false);
      const shop = goTarget({ state: s }, `shop:${n}`)!;
      expect(inside(REGIONS[n]!.rect, shop)).toBe(true);
    });

    it(`region ${n} before it is bought: on the road at its own gate`, () => {
      const before = stateAt(n - 1);
      const L = regionLayout(n);
      const p = travelPoints(before).find((q) => q.id === `region:${n}`)!;
      const gateDist = Math.hypot(p.x - L.gate.x, p.z - L.gate.z);
      expect(gateDist).toBeLessThan(10);
      for (let k = 2; k <= MAX_ERA; k++) {
        if (k === n || !REGIONS[k]) continue;
        const G = regionLayout(k).gate;
        expect(Math.hypot(p.x - G.x, p.z - G.z)).toBeGreaterThan(gateDist);
      }
    });
  }

  it('home points are in era 1: the yard, the village and the Market Town', () => {
    for (const id of ['yard', 'village', 'town']) {
      const p = pts.find((q) => q.id === id)!;
      for (let n = 2; n <= MAX_ERA; n++) {
        expect(inside(REGIONS[n]!.rect, p, 2)).toBe(false);
        expect(inside(DISTRICTS[n]!.rect, p, 2)).toBe(false);
      }
    }
    expect(inside(LAYOUT.town.area, pts.find((q) => q.id === 'town')!)).toBe(true);
  });
});
