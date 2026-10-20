/**
 * 0.9.12 (guide arrow): the walking map behind the guide arrow (world/navGrid.ts) and the ColliderWorld hooks it is
 * built from (navSource, navRevision). Covered: walks through a gap in a wall, detours out of a U-shaped dead end,
 * targets inside solids and zone (rect) goals, unreachable pockets, walkway width vs the player radius, the incremental
 * field (step) agreeing with a full solve, revision / disabled-collider handling, keeping off the walls, the polyline
 * helpers, and a speed sanity check on a large open map.
 */
import { describe, expect, it } from 'vitest';
import { ColliderWorld } from '../src/world/Colliders';
import { NAV_CELL, NavField, NavGrid, pointAlong, projectOnPath, type XZ } from '../src/world/navGrid';

const R = 0.36;
const yard = (maxX = 40, maxZ = 40): ColliderWorld => {
  const c = new ColliderWorld();
  c.setBounds({ minX: 0, maxX, minZ: 0, maxZ });
  return c;
};
const gridOf = (c: ColliderWorld): NavGrid => new NavGrid(c.navSource(), R);

/** A wall across x 19..21 with a gap at z 18..22. */
const wallWithGap = (): ColliderWorld => {
  const c = yard();
  c.addBox({ minX: 19, maxX: 21, minZ: 0, maxZ: 18 }, 'wall');
  c.addBox({ minX: 19, maxX: 21, minZ: 22, maxZ: 40 }, 'wall');
  return c;
};

describe('NavGrid walks', () => {
  it('goes through the gap in a wall: every leg is clear, the walk is longer than the straight line', () => {
    const g = gridOf(wallWithGap());
    const a = { x: 5, z: 5 };
    const b = { x: 35, z: 5 };
    const p = g.findPath(a, b)!;
    expect(p).not.toBeNull();
    for (let i = 1; i < p.points.length; i++) {
      const s = p.points[i - 1]!;
      const e = p.points[i]!;
      expect(g.lineOfSight(s.x, s.z, e.x, e.z)).toBe(true);
    }
    expect(p.length).toBeGreaterThan(30 + 5);
    // a corner (or a leg crossing the wall line) lies in the gap
    const crossing = p.points.find((q, i) => i > 0 && (p.points[i - 1]!.x - 20) * (q.x - 20) <= 0)!;
    expect(crossing).toBeDefined();
    const prev = p.points[p.points.indexOf(crossing) - 1]!;
    const t = (20 - prev.x) / (crossing.x - prev.x || 1);
    const zAtWall = crossing.x === prev.x ? crossing.z : prev.z + (crossing.z - prev.z) * t;
    expect(zAtWall).toBeGreaterThan(18);
    expect(zAtWall).toBeLessThan(22);
    expect(p.points.some((q) => Math.abs(q.x - 20) < 4 && q.z > 17 && q.z < 23)).toBe(true);
    // every point of the walk is open, sampled along its legs
    for (let i = 1; i < p.points.length; i++) {
      const s = p.points[i - 1]!;
      const e = p.points[i]!;
      for (let k = 0; k <= 20; k++) expect(g.isOpen(s.x + ((e.x - s.x) * k) / 20, s.z + ((e.z - s.z) * k) / 20)).toBe(true);
    }
  });

  it('starts at the start point and ends at the goal', () => {
    const g = gridOf(wallWithGap());
    const p = g.findPath({ x: 5, z: 5 }, { x: 35, z: 5 })!;
    expect(p.points[0]).toEqual({ x: 5, z: 5 });
    const last = p.points[p.points.length - 1]!;
    expect(Math.hypot(last.x - 35, last.z - 5)).toBeLessThan(1);
  });

  it('a U-shaped dead end: the first leg heads away from the target, toward the opening', () => {
    const c = yard(40, 40);
    // a cup open to the west: back wall at x 18..20, arms along z 12..13.5 and 26.5..28, x 8..20
    c.addBox({ minX: 18, maxX: 20, minZ: 12, maxZ: 28 }, 'u');
    c.addBox({ minX: 8, maxX: 20, minZ: 12, maxZ: 13.5 }, 'u');
    c.addBox({ minX: 8, maxX: 20, minZ: 26.5, maxZ: 28 }, 'u');
    const g = gridOf(c);
    const start = { x: 14, z: 20 }; // inside the cup
    const goal = { x: 30, z: 20 }; // straight east, behind the back wall
    const p = g.findPath(start, goal)!;
    expect(p).not.toBeNull();
    const first = p.points[1]!;
    expect(first.x).toBeLessThan(start.x - 1); // heading west, away from the goal
    expect(p.length).toBeGreaterThan(30); // straight line is 16
    expect(g.lineOfSight(start.x, start.z, first.x, first.z)).toBe(true);
  });

  it('a goal inside a solid box ends at the nearest open cell, within about 6 m', () => {
    const c = yard();
    c.addBox({ minX: 28, maxX: 34, minZ: 18, maxZ: 24 }, 'house');
    const g = gridOf(c);
    const goal = { x: 31, z: 21 };
    expect(g.isOpen(goal.x, goal.z)).toBe(false);
    const p = g.findPath({ x: 5, z: 21 }, goal)!;
    expect(p).not.toBeNull();
    const last = p.points[p.points.length - 1]!;
    expect(g.isOpen(last.x, last.z)).toBe(true);
    expect(Math.hypot(last.x - goal.x, last.z - goal.z)).toBeLessThan(6);
  });

  it('a goal with no open cell within reach has no walk (field invalid)', () => {
    const c = yard();
    c.addBox({ minX: 10, maxX: 30, minZ: 10, maxZ: 30 }, 'block');
    const g = gridOf(c);
    const f = new NavField(g, { x: 20, z: 20 });
    expect(f.valid).toBe(false);
    expect(g.findPath({ x: 2, z: 2 }, { x: 20, z: 20 })).toBeNull();
  });

  it('a rect goal: the walk ends inside the rect', () => {
    const g = gridOf(wallWithGap());
    const area = { minX: 30, maxX: 34, minZ: 30, maxZ: 34 };
    const p = g.findPath({ x: 5, z: 5 }, { x: 32, z: 32 }, area)!;
    const last = p.points[p.points.length - 1]!;
    expect(last.x).toBeGreaterThanOrEqual(area.minX);
    expect(last.x).toBeLessThanOrEqual(area.maxX);
    expect(last.z).toBeGreaterThanOrEqual(area.minZ);
    expect(last.z).toBeLessThanOrEqual(area.maxZ);
  });

  it('a rect goal is reached from the near side, not the centre point (stops at the first cell inside)', () => {
    const g = gridOf(yard());
    const area = { minX: 30, maxX: 38, minZ: 18, maxZ: 22 };
    const p = g.findPath({ x: 5, z: 20 }, { x: 34, z: 20 }, area)!;
    const last = p.points[p.points.length - 1]!;
    expect(last.x).toBeLessThan(31);
  });

  it('a start inside a solid (brushing a prop) still gets a walk from the nearest open cell', () => {
    const c = yard();
    c.addCircle(10, 10, 1, 'tree');
    const g = gridOf(c);
    const p = g.findPath({ x: 10, z: 10.2 }, { x: 30, z: 30 });
    expect(p).not.toBeNull();
    expect(g.isOpen(p!.points[0]!.x, p!.points[0]!.z)).toBe(true);
  });

  it('an enclosed pocket has no path: findPath is null, the field is done, distanceFrom is Infinity', () => {
    const c = yard();
    c.addBox({ minX: 10, maxX: 20, minZ: 10, maxZ: 11 }, 'ring');
    c.addBox({ minX: 10, maxX: 20, minZ: 19, maxZ: 20 }, 'ring');
    c.addBox({ minX: 10, maxX: 11, minZ: 10, maxZ: 20 }, 'ring');
    c.addBox({ minX: 19, maxX: 20, minZ: 10, maxZ: 20 }, 'ring');
    const g = gridOf(c);
    const inside = { x: 15, z: 15 };
    const outside = { x: 30, z: 30 };
    expect(g.isOpen(inside.x, inside.z)).toBe(true);
    expect(g.findPath(outside, inside)).toBeNull();
    const f = new NavField(g, inside);
    expect(f.valid).toBe(true);
    f.step(Infinity);
    expect(f.done).toBe(true);
    expect(f.distanceFrom(outside)).toBe(Infinity);
    expect(f.pathFrom(outside)).toBeNull();
    expect(f.knows(outside)).toBe(true); // proven impossible
    expect(f.distanceFrom(inside)).toBeLessThan(1);
  });
});

describe('NavGrid walkway width', () => {
  const walkway = (width: number): NavGrid => {
    const c = yard();
    const z0 = 20 - width / 2;
    c.addBox({ minX: 15, maxX: 25, minZ: 0, maxZ: z0 }, 'wall');
    c.addBox({ minX: 15, maxX: 25, minZ: z0 + width, maxZ: 40 }, 'wall');
    return gridOf(c);
  };

  it('a 1.6 m walkway stays passable', () => {
    const g = walkway(1.6);
    expect(g.findPath({ x: 5, z: 20 }, { x: 35, z: 20 })).not.toBeNull();
    // and it is a straight shot through
    expect(g.findPath({ x: 5, z: 20 }, { x: 35, z: 20 })!.length).toBeLessThan(31);
  });

  it('a 0.6 m walkway is closed (the player circle does not fit)', () => {
    const g = walkway(0.6);
    expect(g.findPath({ x: 5, z: 20 }, { x: 35, z: 20 })).toBeNull();
  });
});

describe('NavGrid cells', () => {
  it('open cells follow the yard shrunk by the radius and the extra rects as they are', () => {
    const c = yard(10, 10);
    c.addBounds({ minX: 9, maxX: 20, minZ: 4, maxZ: 6 });
    const g = gridOf(c);
    expect(g.isOpen(0.1, 5)).toBe(false);
    expect(g.isOpen(1, 5)).toBe(true);
    expect(g.isOpen(15, 5)).toBe(true);
    expect(g.isOpen(15, 8)).toBe(false);
    expect(g.isOpen(-50, -50)).toBe(false);
  });

  it('agrees with ColliderWorld.isFree on cell centres (to the grid resolution)', () => {
    const c = wallWithGap();
    c.addCircle(8, 30, 1.5, 'tree');
    const g = gridOf(c);
    let bad = 0;
    for (let i = 0; i < g.nx; i++) {
      for (let j = 0; j < g.nz; j++) {
        const x = g.cx(i);
        const z = g.cz(j);
        if (x < 0 || x > 40 || z < 0 || z > 40) continue;
        if (g.isOpen(x, z) !== c.isFree(x, z, R)) bad++;
      }
    }
    expect(bad).toBe(0);
  });

  it('marks cells beside a blocked one as edge cells', () => {
    const g = gridOf(wallWithGap());
    const k = g.cj(5) * g.nx + g.ci(18.4);
    expect(g.open[k]).toBe(1);
    expect(g.edge[k]).toBe(1);
    const mid = g.cj(5) * g.nx + g.ci(8);
    expect(g.edge[mid]).toBe(0);
  });

  it('nearestOpen finds the closest open cell within the range, else -1', () => {
    const c = yard();
    c.addBox({ minX: 10, maxX: 20, minZ: 10, maxZ: 20 }, 'b');
    const g = gridOf(c);
    const k = g.nearestOpen(15, 10.5, 3);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(g.open[k]).toBe(1);
    expect(g.nearestOpen(15, 15, 1)).toBe(-1);
    expect(g.nearestOpen(30, 30, 1)).toBe(g.cj(30) * g.nx + g.ci(30));
  });

  it('lineOfSight is blocked by a wall and clear in the open', () => {
    const g = gridOf(wallWithGap());
    expect(g.lineOfSight(5, 5, 35, 5)).toBe(false);
    expect(g.lineOfSight(5, 20, 35, 20)).toBe(true);
    expect(g.lineOfSight(5, 5, 15, 5)).toBe(true);
  });

  it('an unbounded world (default bounds) is clipped to the extra rects', () => {
    const c = new ColliderWorld();
    c.addBounds({ minX: 0, maxX: 10, minZ: 0, maxZ: 10 });
    const g = gridOf(c);
    expect(g.nx * g.nz).toBeLessThan(10_000);
    expect(g.isOpen(5, 5)).toBe(true);
    expect(g.isOpen(50, 5)).toBe(false);
  });
});

describe('NavField incremental solve', () => {
  const world = (): ColliderWorld => {
    const c = wallWithGap();
    c.addCircle(10, 8, 2, 'tree');
    return c;
  };

  it('small budgets give the same path as one full step', () => {
    const g = gridOf(world());
    const goal = { x: 35, z: 8 };
    const from = { x: 4, z: 6 };
    const full = new NavField(g, goal);
    full.step(Infinity);
    const inc = new NavField(g, goal);
    let calls = 0;
    while (!inc.done && calls < 100_000) {
      inc.step(50);
      calls++;
    }
    expect(calls).toBeGreaterThan(5);
    expect(inc.done).toBe(true);
    expect(inc.pathFrom(from)).toEqual(full.pathFrom(from));
    expect(inc.distanceFrom(from)).toBeCloseTo(full.distanceFrom(from), 4);
  });

  it('knows a nearby start before the field is done', () => {
    const g = gridOf(world());
    const f = new NavField(g, { x: 35, z: 8 });
    expect(f.knows({ x: 4, z: 6 })).toBe(false);
    expect(f.pathFrom({ x: 4, z: 6 })).toBeNull();
    expect(f.distanceFrom({ x: 4, z: 6 })).toBe(Infinity);
    f.step(600);
    expect(f.done).toBe(false);
    expect(f.knows({ x: 33, z: 8 })).toBe(true);
    expect(f.knows({ x: 4, z: 6 })).toBe(false);
    expect(f.pathFrom({ x: 33, z: 8 })).not.toBeNull();
  });

  it('settles the nearest cells first (distances never decrease with step order)', () => {
    const g = gridOf(yard());
    const f = new NavField(g, { x: 20, z: 20 });
    f.step(200);
    const near = f.distanceFrom({ x: 21, z: 20 });
    expect(near).toBeLessThan(2);
    expect(f.distanceFrom({ x: 5, z: 5 })).toBe(Infinity);
  });

  it('pathFrom(maxMetres) stops early on the way, not at the goal', () => {
    const g = gridOf(yard());
    const f = new NavField(g, { x: 38, z: 20 });
    f.step(Infinity);
    const part = f.pathFrom({ x: 2, z: 20 }, 10)!;
    const last = part.points[part.points.length - 1]!;
    expect(part.length).toBeLessThan(15);
    expect(Math.hypot(last.x - 38, last.z - 20)).toBeGreaterThan(20);
  });

  it('a field can reuse the buffers of an old one on the same grid without leaking its answers', () => {
    const g = gridOf(yard());
    const a = new NavField(g, { x: 5, z: 5 });
    a.step(Infinity);
    const b = new NavField(g, { x: 35, z: 35 }, null, a);
    expect(b.distanceFrom({ x: 5, z: 5 })).toBe(Infinity);
    b.step(Infinity);
    expect(b.distanceFrom({ x: 5, z: 5 })).toBeGreaterThan(35);
  });
});

describe('walks keep off the walls', () => {
  it('in a 6 m corridor the walk stays off the walls (midpoints more than 0.5 m away)', () => {
    const c = yard(60, 40);
    // a corridor z 17..23 between two long walls, with open ground at both ends
    c.addBox({ minX: 10, maxX: 50, minZ: 0, maxZ: 17 }, 'wall');
    c.addBox({ minX: 10, maxX: 50, minZ: 23, maxZ: 40 }, 'wall');
    const g = gridOf(c);
    // start hugging the south wall, then must come off it toward the middle
    const p = g.findPath({ x: 5, z: 20 }, { x: 55, z: 20 })!;
    expect(p).not.toBeNull();
    let checked = 0;
    for (let i = 1; i < p.points.length; i++) {
      const s = p.points[i - 1]!;
      const e = p.points[i]!;
      for (const t of [0.25, 0.5, 0.75]) {
        const x = s.x + (e.x - s.x) * t;
        const z = s.z + (e.z - s.z) * t;
        if (x < 12 || x > 48) continue;
        checked++;
        expect(Math.min(z - 17, 23 - z)).toBeGreaterThan(0.5);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('a start beside a wall is led out to the middle of a wide walkway rather than scraping along it', () => {
    const c = yard(60, 40);
    c.addBox({ minX: 10, maxX: 50, minZ: 0, maxZ: 17 }, 'wall');
    c.addBox({ minX: 10, maxX: 50, minZ: 23, maxZ: 40 }, 'wall');
    const g = gridOf(c);
    const p = g.findPath({ x: 12, z: 17.8 }, { x: 55, z: 17.8 })!;
    let minWallDist = Infinity;
    for (let i = 0; i < p.points.length; i++) {
      const q = p.points[i]!;
      if (q.x > 20 && q.x < 45) minWallDist = Math.min(minWallDist, q.z - 17, 23 - q.z);
    }
    expect(minWallDist).toBeGreaterThan(0.5);
  });
});

describe('ColliderWorld navSource / navRevision', () => {
  it('navSource copies the bounds, the extra rects and the enabled obstacles only', () => {
    const c = yard(10, 10);
    c.addBounds({ minX: 9, maxX: 20, minZ: 4, maxZ: 6 });
    c.addBox({ minX: 2, maxX: 3, minZ: 2, maxZ: 3 }, 'a');
    const h = c.addCircle(5, 5, 1, 'b');
    let src = c.navSource();
    expect(src.bounds).toEqual({ minX: 0, maxX: 10, minZ: 0, maxZ: 10 });
    expect(src.extra).toHaveLength(1);
    expect(src.solids).toHaveLength(2);
    expect(src.solids.map((s) => s.kind).sort()).toEqual([0, 1]);
    h.enabled = false;
    src = c.navSource();
    expect(src.solids).toHaveLength(1);
    expect(src.solids[0]!.kind).toBe(0);
    // a copy: changing it does not touch the world
    src.bounds.maxX = 99;
    expect(c.navSource().bounds.maxX).toBe(10);
  });

  it('navRevision changes when a collider is disabled, re-enabled or added, and not otherwise', () => {
    const c = yard();
    const h = c.addBox({ minX: 5, maxX: 6, minZ: 5, maxZ: 6 }, 'a');
    const r0 = c.navRevision();
    expect(c.navRevision()).toBe(r0);
    h.enabled = false;
    const r1 = c.navRevision();
    expect(r1).not.toBe(r0);
    h.enabled = true;
    expect(c.navRevision()).toBe(r0);
    c.addCircle(20, 20, 1, 'b');
    expect(c.navRevision()).not.toBe(r0);
  });

  it('navRevision changes when a walkable rect is added', () => {
    const c = yard();
    const r0 = c.navRevision();
    c.addBounds({ minX: 40, maxX: 50, minZ: 10, maxZ: 12 });
    expect(c.navRevision()).not.toBe(r0);
  });

  it('a disabled collider opens its cells in a rebuilt grid', () => {
    const c = yard();
    const h = c.addBox({ minX: 19, maxX: 21, minZ: 0, maxZ: 40 }, 'wall');
    expect(gridOf(c).findPath({ x: 5, z: 20 }, { x: 35, z: 20 })).toBeNull();
    h.enabled = false;
    expect(gridOf(c).findPath({ x: 5, z: 20 }, { x: 35, z: 20 })).not.toBeNull();
  });
});

describe('projectOnPath / pointAlong', () => {
  const line: XZ[] = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
  ];

  it('projectOnPath gives metres along, distance off and the leg', () => {
    expect(projectOnPath(line, { x: 4, z: 3 })).toEqual({ along: 4, off: 3, seg: 0 });
    const q = projectOnPath(line, { x: 12, z: 6 });
    expect(q.seg).toBe(1);
    expect(q.along).toBeCloseTo(16, 6);
    expect(q.off).toBeCloseTo(2, 6);
  });

  it('projectOnPath clamps to the ends', () => {
    expect(projectOnPath(line, { x: -5, z: 0 }).along).toBe(0);
    expect(projectOnPath(line, { x: 10, z: 50 }).along).toBeCloseTo(20, 6);
  });

  it('pointAlong walks the polyline and clamps at both ends', () => {
    expect(pointAlong(line, 0)).toEqual({ x: 0, z: 0 });
    expect(pointAlong(line, 5)).toEqual({ x: 5, z: 0 });
    expect(pointAlong(line, 15)).toEqual({ x: 10, z: 5 });
    expect(pointAlong(line, 999)).toEqual({ x: 10, z: 10 });
    expect(pointAlong(line, -3)).toEqual({ x: 0, z: 0 });
  });

  it('pointAlong and projectOnPath are inverses along a path', () => {
    for (const d of [1, 7.5, 12, 19]) {
      expect(projectOnPath(line, pointAlong(line, d)).along).toBeCloseTo(d, 6);
    }
  });
});

describe('performance', () => {
  it('a 300 m x 300 m map with scattered circles builds and completes a field quickly', () => {
    const c = yard(300, 300);
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 400; i++) c.addCircle(rnd() * 300, rnd() * 300, 0.5 + rnd() * 1.5, 'tree');
    const t0 = performance.now();
    const g = gridOf(c);
    const f = new NavField(g, { x: 290, z: 290 });
    f.step(Infinity);
    const ms = performance.now() - t0;
    expect(f.done).toBe(true);
    expect(f.expanded).toBeGreaterThan(100_000);
    expect(ms).toBeLessThan(2000);
    expect(NAV_CELL).toBe(0.5);
  });
});

describe('NavGrid steps round pads and piles (avoid)', () => {
  it('a pulled-tight leg never cuts across a pile the walk stepped round', () => {
    // a row of piles across the straight line (like a machine's output, feed and pay spots), open ground round it
    const pile = { minX: 15, maxX: 25, minZ: 18, maxZ: 22 };
    const g = new NavGrid({ ...yard().navSource(), avoid: [pile] }, R);
    const walk = g.findPath({ x: 5, z: 20 }, { x: 35, z: 20 }, null)!;
    expect(walk).not.toBeNull();
    const pts = walk.points;
    for (let s = 1; s < pts.length; s++) {
      const a = pts[s - 1]!;
      const b = pts[s]!;
      for (let t = 0; t <= 1; t += 0.02) {
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        expect(g.isAvoid(x, z), `leg ${s} crosses the pile at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(false);
      }
    }
  });

  it('still walks onto a pile that is the goal', () => {
    const pile = { minX: 15, maxX: 25, minZ: 18, maxZ: 22 };
    const g = new NavGrid({ ...yard().navSource(), avoid: [pile] }, R);
    const walk = g.findPath({ x: 5, z: 20 }, { x: 20, z: 20 }, pile)!;
    const end = walk.points[walk.points.length - 1]!;
    expect(end.x >= pile.minX && end.x <= pile.maxX && end.z >= pile.minZ && end.z <= pile.maxZ).toBe(true);
  });
});

describe('NavGrid avoid: starting on a pile', () => {
  it('a walk that starts on one pile still steps round the next one', () => {
    const start = { minX: 3, maxX: 7, minZ: 18, maxZ: 22 };
    const pile = { minX: 15, maxX: 25, minZ: 18, maxZ: 22 };
    const g = new NavGrid({ ...yard().navSource(), avoid: [start, pile] }, R);
    const walk = g.findPath({ x: 5, z: 20 }, { x: 35, z: 20 }, null)!;
    const pts = walk.points;
    for (let s = 1; s < pts.length; s++) {
      const a = pts[s - 1]!;
      const b = pts[s]!;
      for (let t = 0; t <= 1; t += 0.02) {
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        if (x > 10) expect(g.isAvoid(x, z), `leg ${s} crosses the pile at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(false);
      }
    }
  });
});
