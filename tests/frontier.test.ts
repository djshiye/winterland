/** 0.9.0 new land: road opening rules, walk connectivity (town → roads → region gates / districts), no overlap with the old map. */
import { describe, expect, it } from 'vitest';
import { LAYOUT, type Rect } from '../src/config';
import { DISTRICTS, REGIONS, RIVER_POND, ROADS, TRIKE_ROAD_END_Z } from '../src/eras/data';
import { eraTrail, regionLayout } from '../src/eras/layout';
import { peakOnNewLand } from '../src/world/env/mountains';
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
    // 0.9.5: the era-1 lanes that run south off the old map (as drawn once the new land shows)
    trikeRoad: { ...LAYOUT.tricycles.road, maxZ: TRIKE_ROAD_END_Z },
    rail: { minX: LAYOUT.ridge.rail.x - 1.8, maxX: LAYOUT.ridge.rail.x + 1.8, minZ: -31, maxZ: LAYOUT.ridge.rail.exitZ + 0.8 },
  };

  it('puts no region or district on any old rect', () => {
    for (const r of regions) for (const [name, o] of Object.entries(old)) expect(overlap(r.rect, o), `region ${r.n} vs ${name}`).toBe(false);
    for (const d of districts) for (const [name, o] of Object.entries(old)) expect(overlap(d.rect, o), `district ${d.n} vs ${name}`).toBe(false);
  });

  it('lets only the two roads that leave the Market Town touch the old rects (and only the town), and R1 bridge the river', () => {
    for (const r of ROADS) {
      const hits = Object.entries(old).filter(([, o]) => overlap(r.rect, o)).map(([name]) => name);
      if (r.id === 'southAvenue') expect(hits, r.id).toEqual(['town']);
      // the avenue to the city has always crossed the Timber Ridge rail at a level crossing
      else if (r.id === 'cityLink') expect(hits, r.id).toEqual(['town', 'rail']);
      else if (r.id === 'r1') expect(hits, r.id).toEqual(['river']);
      else expect(hits, r.id).toEqual([]);
    }
  });

  it('ends the era-1 lanes cleanly at the new land: the trike road on R1, the rail at a buffer stop before it, the river in its pond', () => {
    const r1 = ROADS.find((r) => r.id === 'r1')!.rect;
    const tr = LAYOUT.tricycles.road;
    expect(TRIKE_ROAD_END_Z).toBe(r1.minZ);
    expect(tr.minX >= r1.minX && tr.maxX <= r1.maxX).toBe(true);
    // the trikes leave the map before the road ends, so none drives onto the hidden tail
    expect(LAYOUT.tricycles.exitZ).toBeLessThan(TRIKE_ROAD_END_Z);
    expect(LAYOUT.ridge.rail.exitZ + 0.8).toBeLessThan(r1.minZ);
    // the river runs under R1 and out into the pond, which covers its end
    expect(LAYOUT.river.maxZ).toBeGreaterThan(r1.maxZ);
    expect(RIVER_POND.minZ).toBeLessThanOrEqual(LAYOUT.river.maxZ);
    expect(RIVER_POND.maxZ).toBeGreaterThan(LAYOUT.river.maxZ);
    expect(RIVER_POND.minX).toBeLessThan(LAYOUT.river.minX);
    expect(RIVER_POND.maxX).toBeGreaterThan(LAYOUT.river.maxX);
    for (const r of regions) expect(overlap(r.rect, RIVER_POND), `pond vs region ${r.n}`).toBe(false);
    for (const r of ROADS) expect(overlap(r.rect, RIVER_POND), `pond vs ${r.id}`).toBe(false);
  });

  it('keeps regions, roads and districts from overlapping each other (roads may cross roads)', () => {
    const solid = [...regions.map((r) => ({ id: `region ${r.n}`, rect: r.rect })), ...districts.map((d) => ({ id: `district ${d.n}`, rect: d.rect }))];
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) expect(overlap(solid[i]!.rect, solid[j]!.rect), `${solid[i]!.id} vs ${solid[j]!.id}`).toBe(false);
      for (const road of ROADS) expect(overlap(solid[i]!.rect, road.rect), `${solid[i]!.id} vs ${road.id}`).toBe(false);
    }
  });

  it('keeps decor off every region, road and district (inflated 1.5 m)', () => {
    expect(NEW_LAND.length).toBe(regions.length + ROADS.length + districts.length + 1); // + the river's pond
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

describe('0.9.3: eras read in order on the ground and on the map', () => {
  const onRoad = (x: number, z: number): boolean => ROADS.some((r) => x >= r.rect.minX - EPS && x <= r.rect.maxX + EPS && z >= r.rect.minZ - EPS && z <= r.rect.maxZ + EPS);

  it('walks the era trail along roads only, through every gate in order', () => {
    const trail = eraTrail(10);
    // every leg is axis-aligned and every sample on it is on a road
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1]!;
      const b = trail[i]!;
      expect(a.x === b.x || a.z === b.z, `leg ${i}`).toBe(true);
      for (let t = 0; t <= 1; t += 0.05) expect(onRoad(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t), `leg ${i} at ${t}`).toBe(true);
    }
    // the gates come in era order
    let at = 0;
    for (let n = 2; n <= 10; n++) {
      const L = regionLayout(n);
      const i = trail.findIndex((q, k) => k > at && Math.abs(q.x - L.gate.x) < EPS && Math.abs(q.z - (L.gate.z - L.inward)) < EPS);
      expect(i, `gate ${n}`).toBeGreaterThan(at);
      at = i;
    }
  });

  it('snakes: the regions of a row are side by side in era order (II III IV west, V … VIII east, IX X west)', () => {
    const cx = (n: number): number => (REGIONS[n]!.rect.minX + REGIONS[n]!.rect.maxX) / 2;
    const row = (n: number): string => regionLayout(n).road;
    expect([2, 3, 4].map(row)).toEqual(['r1', 'r1', 'r1']);
    expect([5, 6, 7, 8].map(row)).toEqual(['r2', 'r2', 'r2', 'r2']);
    expect([9, 10].map(row)).toEqual(['r3', 'r3']);
    expect(cx(3)).toBeLessThan(cx(2));
    expect(cx(4)).toBeLessThan(cx(3));
    for (let n = 6; n <= 8; n++) expect(cx(n)).toBeGreaterThan(cx(n - 1));
    expect(cx(10)).toBeLessThan(cx(9));
  });

  it('numbers the city districts in reading order from the corner nearest the town', () => {
    for (let n = 3; n <= 10; n++) {
      const a = DISTRICTS[n - 1]!.rect;
      const b = DISTRICTS[n]!.rect;
      expect(b.minZ > a.minZ || (b.minZ === a.minZ && b.minX > a.minX), `district ${n}`).toBe(true);
    }
  });

  it('opens each district road no later than its district', () => {
    for (const d of districts) {
      const roads = ROADS.filter((r) => touch(r.rect, d.rect));
      expect(roads.some((r) => roadOpen(state(true, d.n), r.opensAt)), `district ${d.n}`).toBe(true);
    }
  });

  it('keeps no mountain peak on the new land once it shows (the 0.9.2 Copper Gorge peak)', () => {
    expect(peakOnNewLand(-61, 84, 12, 18)).toBe(true); // era III's plot
    expect(peakOnNewLand(-75, -20, 14, 20)).toBe(false);
  });
});
