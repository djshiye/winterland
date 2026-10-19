/** 1.0 pure road router (city/roadRoute.ts): region gate → its district's lots over the open roads and the walkways. */
import { describe, expect, it } from 'vitest';
import { DISTRICTS, MAX_ERA, ROADS, districtDef, type ERect } from '../src/eras/data';
import { regionLayout } from '../src/eras/layout';
import { districtLots, type XZ } from '../src/city/rules';
import { cityRoute, cityWalkRects, crossingAt, districtWalkways, gateRoadSpot, inRect, kerbWait, lotStandSpot, routeOver } from '../src/city/roadRoute';

const EPS = 1e-3;

/** Every waypoint, and points along every leg, lie in one of `allowed`; none inside a lot's footprint. */
function checkPath(start: XZ, pts: readonly XZ[], allowed: readonly ERect[], forbidden: readonly ERect[]): void {
  let prev = start;
  for (const p of pts) {
    expect(allowed.some((r) => inRect(r, p, EPS)), `waypoint ${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBe(true);
    // a leg is straight inside one rect: both ends must share one
    expect(allowed.some((r) => inRect(r, prev, EPS) && inRect(r, p, EPS)), `leg to ${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBe(true);
    for (let k = 0; k <= 20; k++) {
      const q = { x: prev.x + ((p.x - prev.x) * k) / 20, z: prev.z + ((p.z - prev.z) * k) / 20 };
      for (const f of forbidden) {
        const inside = q.x > f.minX + EPS && q.x < f.maxX - EPS && q.z > f.minZ + EPS && q.z < f.maxZ - EPS;
        expect(inside, `through a building at ${q.x.toFixed(2)},${q.z.toFixed(2)}`).toBe(false);
      }
    }
    prev = p;
  }
}

/** Every point along the walk that is on a road lies in a crossing. */
function offRoad(start: XZ, pts: readonly XZ[], roads: readonly ERect[], crossings: readonly ERect[]): void {
  let prev = start;
  for (const p of pts) {
    for (let k = 0; k <= 40; k++) {
      const q = { x: prev.x + ((p.x - prev.x) * k) / 40, z: prev.z + ((p.z - prev.z) * k) / 40 };
      const on = roads.find((r) => inRect(r, q, -0.05));
      if (!on) continue;
      expect(crossings.some((c) => inRect(c, q, EPS)), `on the road at ${q.x.toFixed(2)},${q.z.toFixed(2)}`).toBe(true);
      // straight across, never diagonally through a junction: hardly any way along the traffic while on the road
      const along = on.maxX - on.minX >= on.maxZ - on.minZ ? Math.abs(p.x - prev.x) : Math.abs(p.z - prev.z);
      expect(along, `cuts along the road at ${q.x.toFixed(2)},${q.z.toFixed(2)}`).toBeLessThanOrEqual(1.2 + EPS);
    }
    prev = p;
  }
}

describe('routeOver', () => {
  const a: ERect = { minX: 0, maxX: 20, minZ: 0, maxZ: 4 };
  const b: ERect = { minX: 16, maxX: 20, minZ: 0, maxZ: 30 };
  const far: ERect = { minX: 50, maxX: 60, minZ: 50, maxZ: 54 };

  it('walks the lane centres and turns at the overlap', () => {
    const r = routeOver([a, b], { x: 1, z: 2 }, { x: 18, z: 28 })!;
    expect(r.at(-1)).toEqual({ x: 18, z: 28 });
    expect(r).toContainEqual({ x: 18, z: 2 }); // the overlap centre
    checkPath({ x: 1, z: 2 }, r, [a, b], []);
  });

  it('returns null when the rects do not join', () => {
    expect(routeOver([a, far], { x: 1, z: 2 }, { x: 55, z: 52 })).toBeNull();
    expect(routeOver([], { x: 1, z: 2 }, { x: 55, z: 52 })).toBeNull();
  });

  it('snaps a point outside every rect onto the nearest one first', () => {
    const r = routeOver([a], { x: 5, z: 10 }, { x: 15, z: 2 })!;
    expect(r[0]).toEqual({ x: 5, z: 4 });
    expect(r.at(-1)).toEqual({ x: 15, z: 2 });
  });

  it('picks the shorter of two chains', () => {
    const top: ERect = { minX: 0, maxX: 4, minZ: 0, maxZ: 40 };
    const right: ERect = { minX: 36, maxX: 40, minZ: 0, maxZ: 40 };
    const near: ERect = { minX: 0, maxX: 40, minZ: 0, maxZ: 4 };
    const farSide: ERect = { minX: 0, maxX: 40, minZ: 36, maxZ: 40 };
    const r = routeOver([top, right, near, farSide], { x: 2, z: 10 }, { x: 38, z: 10 })!;
    expect(r.every((p) => p.z < 20)).toBe(true);
  });
});

describe('district walkways', () => {
  for (let n = 2; n <= MAX_ERA; n++) {
    it(`district ${n}: inside the district, clear of every footprint and every street lamp`, () => {
      const d = districtDef(n).rect;
      const rects = districtWalkways(n);
      for (const w of rects) {
        expect(w.minX).toBeGreaterThanOrEqual(d.minX - EPS);
        expect(w.maxX).toBeLessThanOrEqual(d.maxX + EPS);
        expect(w.minZ).toBeGreaterThanOrEqual(d.minZ - EPS);
        expect(w.maxZ).toBeLessThanOrEqual(d.maxZ + EPS);
        for (const f of districtLots(n)) {
          const o = w.minX < f.rect.maxX && w.maxX > f.rect.minX && w.minZ < f.rect.maxZ && w.maxZ > f.rect.minZ;
          expect(o).toBe(false);
        }
      }
      // lamps (District.buildScenery): west / east every 7 m from minZ + 4, north / south every 8 m from minX + 8
      const lamps: XZ[] = [];
      for (let z = d.minZ + 4; z < d.maxZ - 2; z += 7) lamps.push({ x: d.minX + 0.9, z }, { x: d.maxX - 0.9, z });
      for (let x = d.minX + 8; x < d.maxX - 6; x += 8) lamps.push({ x, z: d.minZ + 0.9 }, { x, z: d.maxZ - 0.9 });
      for (const l of lamps) {
        // a walker (radius 0.3) on any walkway centre line keeps clear of a pole (base 0.34 m)
        for (const w of rects) {
          const lane = w.maxX - w.minX >= w.maxZ - w.minZ ? { x: l.x, z: (w.minZ + w.maxZ) / 2 } : { x: (w.minX + w.maxX) / 2, z: l.z };
          if (!inRect(w, lane)) continue;
          expect(Math.hypot(lane.x - l.x, lane.z - l.z)).toBeGreaterThan(0.45);
        }
      }
    });
  }
});

describe('cityRoute: every era from its region gate to every lot of its district', () => {
  for (let n = 2; n <= MAX_ERA; n++) {
    it(`era ${n}`, () => {
      const L = regionLayout(n);
      const g = gateRoadSpot(L);
      const district = DISTRICTS[n]!.rect;
      const roads = ROADS.filter((r) => r.opensAt <= n).map((r) => r.rect);
      const crossings = [...cityWalkRects(n).filter((r) => r.direct), ...crossingAt(n, g)];
      const allowed = [...cityWalkRects(n), ...crossingAt(n, g), L.rect, district];
      const footprints = districtLots(n).map((f) => f.rect);
      // the gate spot is on the region's road
      expect(roads.some((r) => inRect(r, g))).toBe(true);
      for (const f of districtLots(n)) {
        const { spot } = lotStandSpot(n, f.index);
        const there = cityRoute(n, g, spot);
        expect(there, `lot ${f.index}`).not.toBeNull();
        expect(there!.at(-1)).toEqual(spot);
        checkPath(g, there!, allowed, footprints);
        // 0.9.12: off the roadway (between the trucks' lanes) except where it crosses: a junction or the gate
        offRoad(g, there!, roads, crossings);
        // and every leg inside the district stays on its walkways (the street verge just inside its edge aside)
        for (const p of there!) if (inRect(district, p, -0.6)) expect(districtWalkways(n).some((w) => inRect(w, p, EPS))).toBe(true);
        const back = cityRoute(n, spot, g)!;
        expect(back.at(-1)).toEqual(g);
        checkPath(spot, back, allowed, footprints);
        offRoad(spot, back, roads, crossings);
        // the stand spot is just south of the pad tile, outside it
        expect(spot.z).toBeGreaterThan(f.zone.maxZ);
      }
    });
  }

  it('trips are long but finite: a few hundred metres at most', () => {
    for (let n = 2; n <= MAX_ERA; n++) {
      const g = gateRoadSpot(regionLayout(n));
      const r = cityRoute(n, g, lotStandSpot(n, 0).spot)!;
      let len = 0;
      let p = g;
      for (const q of r) {
        len += Math.hypot(q.x - p.x, q.z - p.z);
        p = q;
      }
      expect(len).toBeGreaterThan(40);
      expect(len).toBeLessThan(600);
    }
  });
});

describe('kerbWait: people look both ways', () => {
  const road: ERect = { minX: 40, maxX: 44, minZ: 14, maxZ: 128 };
  const p = { x: 39.6, z: 61.3 };
  const goal = { x: 44.4, z: 61.3 };
  it('steps out on a clear road', () => {
    expect(kerbWait(p, goal, [road], [])).toBe(false);
    // a truck far off, or driving away
    expect(kerbWait(p, goal, [road], [{ x: 42, z: 90, fx: 0, fz: 1, speed: 8 }])).toBe(false);
    expect(kerbWait(p, goal, [road], [{ x: 42, z: 72, fx: 0, fz: 1, speed: 8 }])).toBe(false);
  });
  it('waits for a truck coming at the crossing, or right by it', () => {
    expect(kerbWait(p, goal, [road], [{ x: 42, z: 76, fx: 0, fz: -1, speed: 8 }])).toBe(true);
    expect(kerbWait(p, goal, [road], [{ x: 42, z: 64, fx: 0, fz: 1, speed: 8 }])).toBe(true);
  });
  it('steps out ahead of a slow cart still far off', () => {
    // 10 m off at 3 m/s: over 3 s away
    expect(kerbWait(p, goal, [road], [{ x: 42, z: 72, fx: 0, fz: -1, speed: 3 }])).toBe(false);
    // creeping up its queue 3 m off: walks round it
    expect(kerbWait(p, goal, [road], [{ x: 42, z: 64.6, fx: 0, fz: -1, speed: 1 }])).toBe(false);
  });
  it('an era buyer brakes for walkers: only one too close to stop makes them wait', () => {
    expect(kerbWait(p, goal, [road], [{ x: 42, z: 73.3, fx: 0, fz: -1, speed: 6, yields: true }])).toBe(false);
    expect(kerbWait(p, goal, [road], [{ x: 42, z: 67.3, fx: 0, fz: -1, speed: 9, yields: true }])).toBe(true);
  });
  it('walks round a cart standing in its queue', () => {
    expect(kerbWait(p, goal, [road], [{ x: 42, z: 63, fx: 0, fz: -1, speed: 0 }])).toBe(false);
    // not measured yet: counted as moving
    expect(kerbWait(p, goal, [road], [{ x: 42, z: 63, fx: 0, fz: -1, speed: NaN }])).toBe(true);
  });
  it('never stops on the road itself, or on a walk that stays off it', () => {
    expect(kerbWait({ x: 42, z: 61.3 }, goal, [road], [{ x: 42, z: 64, fx: 0, fz: -1, speed: 8 }])).toBe(false);
    expect(kerbWait(p, { x: 39.6, z: 50 }, [road], [{ x: 42, z: 64, fx: 0, fz: -1, speed: 8 }])).toBe(false);
  });
});
