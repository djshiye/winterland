/** 0.9.0 new land: road opening rules, walk connectivity (town → roads → region gates / districts), no overlap with the old map. */
import { describe, expect, it } from 'vitest';
import { LAYOUT, type Rect } from '../src/config';
import { DISTRICTS, REGIONS, ROADS } from '../src/eras/data';
import { regionLayout } from '../src/eras/layout';
import { blockedNewLand, NEW_LAND } from '../src/world/env/common';
import { gateWalk, landVisible, regionWalk, roadOpen } from '../src/world/env/frontier';

/** `lodge`: the Great Lodge is built (the climb is open, eras/gate.ts climbOpen). */
const state = (lodge: boolean, age: number) => ({ village: { greatLodge: { tier: lodge ? 0 : -1 } }, eras: { age } });
const EPS = 1e-6;
/** True when the rects overlap or touch (shared edge counts). */
const touch = (a: Rect, b: Rect): boolean => a.minX <= b.maxX + EPS && b.minX <= a.maxX + EPS && a.minZ <= b.maxZ + EPS && b.minZ <= a.maxZ + EPS;
/** True when the rects overlap with positive area. */
const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;

const regions = REGIONS.filter((r) => r !== null).map((r) => r!);
const districts = DISTRICTS.filter((d) => d !== null).map((d) => d!);

describe('roadOpen', () => {
  it('opens era 2 roads once the Great Lodge is built or era 2 is reached', () => {
    expect(roadOpen(state(false, 1), 2)).toBe(false);
    expect(roadOpen(state(true, 1), 2)).toBe(true);
    expect(roadOpen(state(false, 2), 2)).toBe(true);
  });

  it('opens a later road once the previous era is reached (opensAt n → age ≥ n − 1)', () => {
    for (let n = 3; n <= 10; n++) {
      expect(roadOpen(state(true, n - 2), n)).toBe(false);
      expect(roadOpen(state(false, n - 1), n)).toBe(true);
      expect(roadOpen(state(false, n), n)).toBe(true);
    }
  });

  it('matches the table: the first roads are open with the Great Lodge, the last one only from era 6', () => {
    const open = (lodge: boolean, age: number): string[] => ROADS.filter((r) => roadOpen(state(lodge, age), r.opensAt)).map((r) => r.id);
    expect(open(false, 1)).toEqual([]);
    expect(open(true, 1)).toEqual(['southAvenue', 'r1', 'cityLink', 'cityWest']);
    expect(open(true, 3)).toContain('cityV1');
    expect(open(true, 3)).not.toContain('r2');
    expect(open(true, 6)).toContain('r2');
    expect(open(true, 5)).not.toContain('cityV2');
    expect(open(true, 10)).toHaveLength(ROADS.length);
  });

  it('shows the new land only with the Great Lodge or era 2 (era 1 looks like 0.8.0)', () => {
    expect(landVisible(state(false, 1))).toBe(false);
    expect(landVisible(state(true, 1))).toBe(true);
    expect(landVisible(state(false, 2))).toBe(true);
  });
});

describe('walk connectivity', () => {
  // nodes: the Market Town (where the walk starts), every road, every region's gate opening, every district
  const nodes: { id: string; rect: Rect }[] = [
    { id: 'town', rect: LAYOUT.town.area },
    ...ROADS.map((r) => ({ id: `road:${r.id}`, rect: r.rect })),
    ...regions.map((r) => ({ id: `gate:${r.n}`, rect: gateWalk(regionLayout(r.n)) })),
    ...districts.map((d) => ({ id: `district:${d.n}`, rect: d.rect })),
  ];

  const reach = (): Set<string> => {
    const seen = new Set<string>(['town']);
    const queue = ['town'];
    while (queue.length) {
      const id = queue.shift();
      const cur = nodes.find((n) => n.id === id)!;
      for (const o of nodes) {
        if (seen.has(o.id) || !touch(cur.rect, o.rect)) continue;
        // regions and districts are leaves: a walk goes through roads only
        seen.add(o.id);
        if (o.id.startsWith('road:') || o.id === 'town') queue.push(o.id);
      }
    }
    return seen;
  };

  it('reaches every road, region gate and district from the town', () => {
    const seen = reach();
    for (const n of nodes) expect(seen.has(n.id), n.id).toBe(true);
  });

  it('gives every road a neighbour road, the town, or a gate', () => {
    for (const r of ROADS) {
      const others = nodes.filter((n) => n.id !== `road:${r.id}` && (n.id.startsWith('road:') || n.id.startsWith('gate:') || n.id === 'town'));
      expect(others.some((n) => touch(n.rect, r.rect)), r.id).toBe(true);
    }
  });

  it('keeps every region gate opening on a road and joined to its region walk rect', () => {
    for (const r of regions) {
      const l = regionLayout(r.n);
      expect(ROADS.some((road) => touch(road.rect, gateWalk(l))), `gate ${r.n} on a road`).toBe(true);
      expect(touch(gateWalk(l), regionWalk(l)), `gate ${r.n} into its region`).toBe(true);
      // the whole 4 m gap lies on the road, and the expansion pad sits on it too
      const road = ROADS.find((q) => touch(q.rect, gateWalk(l)))!;
      expect(l.gate.x - 2).toBeGreaterThanOrEqual(road.rect.minX);
      expect(l.gate.x + 2).toBeLessThanOrEqual(road.rect.maxX);
      expect(l.expansionPad.x).toBeGreaterThan(road.rect.minX);
      expect(l.expansionPad.x).toBeLessThan(road.rect.maxX);
    }
  });

  it('opens every region road no later than its region can be bought', () => {
    for (const r of regions) {
      const l = regionLayout(r.n);
      const road = ROADS.find((q) => touch(q.rect, gateWalk(l)))!;
      // the pad is offered or previewed at age n − 1 (era 2: the Great Lodge): that road must be open by then
      expect(roadOpen(state(true, r.n - 1), road.opensAt), `region ${r.n} via ${road.id}`).toBe(true);
    }
  });
});

describe('the new land keeps off the old map', () => {
  const old: Record<string, Rect> = {
    yard: { ...LAYOUT.yard, minZ: LAYOUT.expandedMinZ },
    river: LAYOUT.river,
    village: LAYOUT.village.area,
    town: LAYOUT.town.area,
    ridge: LAYOUT.ridge.area,
    customerPath: { ...LAYOUT.customers.path, maxZ: 42 },
  };

  it('puts no region or district on any old rect', () => {
    for (const r of regions) for (const [name, o] of Object.entries(old)) expect(overlap(r.rect, o), `region ${r.n} vs ${name}`).toBe(false);
    for (const d of districts) for (const [name, o] of Object.entries(old)) expect(overlap(d.rect, o), `district ${d.n} vs ${name}`).toBe(false);
  });

  it('lets only the two roads that leave the Market Town touch the old rects (and only the town)', () => {
    for (const r of ROADS) {
      const hits = Object.entries(old).filter(([, o]) => overlap(r.rect, o)).map(([name]) => name);
      if (r.id === 'southAvenue' || r.id === 'cityLink') expect(hits, r.id).toEqual(['town']);
      else expect(hits, r.id).toEqual([]);
    }
  });

  it('keeps regions, roads and districts from overlapping each other (roads may cross roads)', () => {
    const solid = [...regions.map((r) => ({ id: `region ${r.n}`, rect: r.rect })), ...districts.map((d) => ({ id: `district ${d.n}`, rect: d.rect }))];
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) expect(overlap(solid[i]!.rect, solid[j]!.rect), `${solid[i]!.id} vs ${solid[j]!.id}`).toBe(false);
      for (const road of ROADS) expect(overlap(solid[i]!.rect, road.rect), `${solid[i]!.id} vs ${road.id}`).toBe(false);
    }
  });

  it('keeps decor off every region, road and district (inflated 1.5 m)', () => {
    expect(NEW_LAND.length).toBe(regions.length + ROADS.length + districts.length);
    for (const r of regions) expect(blockedNewLand((r.rect.minX + r.rect.maxX) / 2, (r.rect.minZ + r.rect.maxZ) / 2)).toBe(true);
    for (const r of ROADS) expect(blockedNewLand(r.rect.minX - 1.4, (r.rect.minZ + r.rect.maxZ) / 2)).toBe(true);
    expect(blockedNewLand(0, 0)).toBe(false);
    expect(blockedNewLand(-120, 200)).toBe(false);
  });
});

describe('ColliderWorld.carve (town fence gaps)', () => {
  it('splits a wall around the gap and keeps the rest solid', async () => {
    const THREE = await import('three');
    const { ColliderWorld } = await import('../src/world/Colliders');
    const w = new ColliderWorld();
    w.addBox({ minX: 0, maxX: 20, minZ: -0.1, maxZ: 0.1 }, 'town:fence');
    w.addBox({ minX: 0, maxX: 20, minZ: 5, maxZ: 5.2 }, 'other');
    w.carve('town:fence', { minX: 8, maxX: 12, minZ: -1, maxZ: 1 });
    const solid = (x: number, z: number) => w.overlaps(x, z, 0.3);
    expect(solid(10, 0)).toBe(false); // the gap
    expect(solid(4, 0)).toBe(true);
    expect(solid(16, 0)).toBe(true);
    expect(solid(10, 5.1)).toBe(true); // other tags untouched
    const p = new THREE.Vector3(10, 0, 0);
    w.resolveCircle(p, 0.3);
    expect(p.x).toBeCloseTo(10);
  });
});
