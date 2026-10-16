/**
 * 1.0 district life (city/lifePlan.ts pure plan, city/DistrictLife.ts runtime over a fake crowd): how many people
 * walk a district, the spots they visit and that their routes never enter a building, and the near-the-player rule.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CITY_BUILDINGS, MAX_ERA, cityBuildingsOfEra, type CityBuildingId } from '../src/eras/data';
import { createGameState, type CityLotState, type GameContext } from '../src/core/types';
import { districtLots } from '../src/city/rules';
import { districtWalkways, inRect } from '../src/city/roadRoute';
import { lifeRoute, lifeSpots, lifeTarget, type LifeSpot } from '../src/city/lifePlan';
import { DistrictLife, LIFE_NEAR } from '../src/city/DistrictLife';
import { CrowdPerson, type Crowd } from '../src/npc/Crowd';

const EPS = 1e-3;
const built = (building: CityBuildingId | ''): CityLotState => ({ building, tier: building === '' ? -1 : 0, cash: 0, extra: 0 });
const ofKind = (n: number, kind: string): CityBuildingId => cityBuildingsOfEra(n).find((id) => CITY_BUILDINGS[id].kind === kind)!;

/** A district of era n with the given kinds per lot ('' = empty). */
function lotsOf(n: number, kinds: readonly string[]): CityLotState[] {
  return districtLots(n).map((_f, i) => built(kinds[i] ? ofKind(n, kinds[i]!) : ''));
}

describe('lifeTarget', () => {
  it('nobody in an empty district (or one with only lots under construction)', () => {
    for (let n = 2; n <= MAX_ERA; n++) {
      expect(lifeTarget(n, lotsOf(n, []))).toBe(0);
      const paying = lotsOf(n, []);
      paying[0] = { building: ofKind(n, 'home'), tier: -1, cash: 10, extra: 1 };
      expect(lifeTarget(n, paying)).toBe(0);
    }
  });

  it('grows with the homes and the era, capped 10 … 14 per district', () => {
    expect(lifeTarget(2, lotsOf(2, ['park']))).toBe(2);
    expect(lifeTarget(2, lotsOf(2, ['home']))).toBe(3);
    // Brickside of the audit: 6 buildings, 140 residents → people walking
    const brickside = lotsOf(2, ['home', 'home', 'home', 'work', 'park', 'landmark']);
    expect(lifeTarget(2, brickside)).toBe(5);
    for (let n = 2; n <= MAX_ERA; n++) {
      const full = lotsOf(n, districtLots(n).map(() => 'home'));
      const cap = 10 + Math.floor((n - 2) / 2);
      expect(lifeTarget(n, full)).toBeLessThanOrEqual(cap);
      expect(lifeTarget(n, full)).toBeGreaterThanOrEqual(lifeTarget(n, lotsOf(n, ['home'])));
      expect(cap).toBeLessThanOrEqual(14);
    }
    expect(lifeTarget(10, lotsOf(10, ['home']))).toBeGreaterThan(lifeTarget(2, lotsOf(2, ['home'])));
  });

  it('is halved on Low quality (at least one)', () => {
    const full = lotsOf(5, districtLots(5).map(() => 'home'));
    expect(lifeTarget(5, full, true)).toBe(Math.ceil(lifeTarget(5, full) / 2));
    expect(lifeTarget(2, lotsOf(2, ['park']), true)).toBe(1);
  });
});

describe('lifeSpots / lifeRoute', () => {
  const mixes = (n: number): string[][] => {
    const count = districtLots(n).length;
    const kinds = ['home', 'work', 'park', 'landmark'];
    return [0, 1, 2, 3].map((k) => Array.from({ length: count }, (_v, i) => (i === k ? 'landmark' : kinds[(i + k) % 3]!)));
  };

  for (let n = 2; n <= MAX_ERA; n++) {
    it(`district ${n}: every route stays on the walkways or in a park, never in a building`, () => {
      for (const kinds of mixes(n)) {
        const lots = lotsOf(n, kinds);
        const spots = lifeSpots(n, lots);
        const frames = districtLots(n);
        const parks = frames.filter((f) => CITY_BUILDINGS[lots[f.index]!.building as CityBuildingId]?.kind === 'park').map((f) => f.rect);
        const solid = frames.filter((f) => !parks.includes(f.rect)).map((f) => f.rect);
        const walk = districtWalkways(n);
        // the clear strip between a building front and the walk band (doors, shop fronts, the way into a park)
        const fronts = frames.map((f) => ({ minX: f.cell.minX, maxX: f.cell.maxX, minZ: f.rect.maxZ, maxZ: f.cell.maxZ + 0.6 }));
        const ok = (p: { x: number; z: number }): boolean => walk.some((w) => inRect(w, p, EPS)) || parks.some((r) => inRect(r, p, EPS)) || fronts.some((r) => inRect(r, p, EPS));
        expect(spots.filter((s) => s.kind === 'door').length).toBe(kinds.filter((k) => k === 'home').length);
        expect(spots.filter((s) => s.kind === 'bench').length).toBe(2 * parks.length);
        for (const s of spots) {
          expect(walk.some((w) => inRect(w, s.access, EPS)), `${s.kind} access`).toBe(true);
          expect(ok(s), `${s.kind} spot`).toBe(true);
        }
        const bad: string[] = [];
        for (const a of spots) {
          for (const b of spots) {
            if (a === b) continue;
            const pts = lifeRoute(n, a, b);
            const end = pts.at(-1);
            if (pts.length && (end!.x !== b.x || end!.z !== b.z)) bad.push(`${a.kind}→${b.kind} ends off the spot`);
            let prev = { x: a.x, z: a.z };
            for (const p of pts) {
              if (!ok(p)) bad.push(`${a.kind}→${b.kind} waypoint ${p.x.toFixed(2)},${p.z.toFixed(2)}`);
              for (let k = 0; k <= 12; k++) {
                const qx = prev.x + ((p.x - prev.x) * k) / 12;
                const qz = prev.z + ((p.z - prev.z) * k) / 12;
                for (const f of solid) {
                  if (qx > f.minX + EPS && qx < f.maxX - EPS && qz > f.minZ + EPS && qz < f.maxZ - EPS) bad.push(`${a.kind}→${b.kind} through a building`);
                }
              }
              prev = p;
            }
          }
        }
        expect(bad.slice(0, 5)).toEqual([]);
      }
    });
  }

  it('an empty district only has its sidewalk corners', () => {
    const spots = lifeSpots(3, lotsOf(3, []));
    expect(spots.every((s: LifeSpot) => s.kind === 'walk')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runtime over a fake crowd
// ---------------------------------------------------------------------------

function fakeCrowd(capacity = 56) {
  const people = Array.from({ length: capacity }, (_v, i) => new CrowdPerson(i));
  const live = new Set<CrowdPerson>();
  const crowd = {
    acquire: () => {
      const p = people.find((q) => !q.active);
      if (!p) return null;
      p.active = true;
      p.appear = 0;
      live.add(p);
      return p;
    },
    release: (p: CrowdPerson) => {
      p.active = false;
      live.delete(p);
    },
  } as unknown as Crowd;
  return { crowd, live };
}

function world(n: number, kinds: readonly string[]) {
  const state = createGameState();
  state.eras.age = MAX_ERA;
  state.city.districts[n]!.lots = lotsOf(n, kinds);
  const player = { position: new THREE.Vector3(0, 0, 0) };
  const ctx = { state, player, renderer: { quality: 'high' }, dayNight: { darkness: 0 } } as unknown as GameContext;
  const { crowd, live } = fakeCrowd();
  const life = new DistrictLife(ctx, n, () => crowd);
  return { state, player, life, live };
}

describe('DistrictLife', () => {
  it('runs only near the player: people pop in on arrival and are released on leaving', () => {
    const w = world(2, ['home', 'home', 'work', 'park', 'landmark', 'home']);
    const lots = districtLots(2);
    w.life.update(0.1);
    expect(w.life.count).toBe(0);
    w.player.position.set(lots[0]!.pad.x, 0, lots[0]!.pad.z + 3);
    w.life.update(0.1);
    expect(w.life.count).toBe(lifeTarget(2, w.state.city.districts[2]!.lots));
    expect(w.live.size).toBe(w.life.count);
    // they walk about for a while and never stand inside a building
    const solid = lots.filter((f) => CITY_BUILDINGS[w.state.city.districts[2]!.lots[f.index]!.building as CityBuildingId]?.kind !== 'park').map((f) => f.rect);
    for (let i = 0; i < 1200; i++) {
      w.life.update(1 / 20);
      for (const p of w.live) {
        for (const f of solid) expect(p.x > f.minX + EPS && p.x < f.maxX - EPS && p.z > f.minZ + EPS && p.z < f.maxZ - EPS).toBe(false);
      }
    }
    expect(w.life.count).toBeGreaterThan(0);
    // far away (beyond LIFE_NEAR): everybody released
    w.player.position.set(lots[0]!.pad.x - 60 - LIFE_NEAR, 0, 0);
    w.life.update(0.1);
    expect(w.life.count).toBe(0);
    expect(w.live.size).toBe(0);
  });

  it('an empty district stays empty; a demolished home sends the extras home', () => {
    const empty = world(4, []);
    const f = districtLots(4)[0]!;
    empty.player.position.set(f.pad.x, 0, f.pad.z);
    for (let i = 0; i < 40; i++) empty.life.update(0.1);
    expect(empty.life.count).toBe(0);

    const w = world(5, ['home', 'home', 'home', 'home', 'home', 'home', 'work', 'park']);
    const g = districtLots(5)[0]!;
    w.player.position.set(g.pad.x, 0, g.pad.z);
    w.life.update(0.1);
    const before = w.life.count;
    expect(before).toBe(lifeTarget(5, w.state.city.districts[5]!.lots));
    for (let i = 0; i < 6; i++) w.state.city.districts[5]!.lots[i] = built('');
    const after = lifeTarget(5, w.state.city.districts[5]!.lots);
    expect(after).toBeLessThan(before);
    for (let i = 0; i < 1200; i++) w.life.update(1 / 20);
    expect(w.life.count).toBeLessThanOrEqual(after);
  });
});
