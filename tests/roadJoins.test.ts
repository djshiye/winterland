/**
 * 0.9.12: roads join cleanly at junctions, ends and era borders (world/env/roadJoins.ts, frontier.ts, wayfinding.ts).
 */
import { describe, expect, it } from 'vitest';
import { LAYOUT, type Rect } from '../src/config';
import { ROADS } from '../src/eras/data';
import { regionLayout } from '../src/eras/layout';
import {
  arcSegments,
  axisEnds,
  cutters,
  deadEnds,
  endStrip,
  gatePavings,
  GATE_PAVING_LENGTH,
  isStreet,
  overlapArea,
  rutPlan,
  surfacePieces,
  TERMINALS,
  townApron,
} from '../src/world/env/roadJoins';
import { armSegments, JUNCTIONS } from '../src/world/env/wayfinding';

const rect = (id: string): Rect => ROADS.find((r) => r.id === id)!.rect;
const area = (r: Rect): number => (r.maxX - r.minX) * (r.maxZ - r.minZ);

describe('road ends', () => {
  it('every road end touches another road or is a listed, explained terminal', () => {
    expect(deadEnds(ROADS)).toEqual([]);
  });

  it('every terminal names a real road end, says why, and really touches no road', () => {
    for (const t of TERMINALS) {
      const road = ROADS.find((r) => r.id === t.id);
      expect(road, t.id).toBeTruthy();
      expect(axisEnds(road!.rect), `${t.id}.${t.end}`).toContain(t.end);
      expect(t.why.length, t.id).toBeGreaterThan(10);
      const strip = endStrip(road!.rect, t.end);
      expect(ROADS.some((o) => o.id !== t.id && overlapArea(strip, o.rect)), `${t.id}.${t.end} touches a road, so it is no terminal`).toBe(false);
    }
  });

  it('the dead-end check does catch a road that stops in the snow', () => {
    const stub = [...ROADS, { id: 'stub', rect: { minX: 300, maxX: 304, minZ: 0, maxZ: 40 } }];
    expect(deadEnds(stub)).toEqual(['stub.minZ', 'stub.maxZ']);
  });

  it('the south avenue is carried through the town fence gap to the square cobbles', () => {
    const apron = townApron();
    const av = rect('southAvenue');
    const sq = LAYOUT.town.square;
    expect(apron.maxZ).toBeCloseTo(av.minZ, 6);
    expect(apron.minZ).toBeLessThan(sq.maxZ); // reaches onto the square
    expect(apron.minX).toBeGreaterThanOrEqual(sq.minX);
    expect(apron.maxX).toBeLessThanOrEqual(sq.maxX);
    expect(apron.minX).toBe(av.minX);
    expect(apron.maxX).toBe(av.maxX);
  });
});

describe('junction squares', () => {
  it('are drawn once: no two roads draw the same ground', () => {
    for (const a of ROADS) {
      for (const pa of surfacePieces(ROADS, a.id)) {
        for (const b of ROADS) {
          if (a.id === b.id) continue;
          for (const pb of surfacePieces(ROADS, b.id)) expect(overlapArea(pa, pb), `${a.id} / ${b.id}`).toBeNull();
        }
      }
    }
  });

  it('keep the whole road covered (the pieces add up to the union)', () => {
    for (const r of ROADS) {
      const drawn = surfacePieces(ROADS, r.id).reduce((s, p) => s + area(p), 0);
      const owned = cutters(ROADS, r.id).reduce((s, c) => s + area(overlapArea(r.rect, c)!), 0);
      // overlaps with several cutters never overlap each other more than a crossing's square
      expect(drawn).toBeLessThanOrEqual(area(r.rect) + 1e-6);
      expect(drawn).toBeGreaterThanOrEqual(area(r.rect) - owned - 1e-6);
    }
  });

  it('a street that ends on R2 stops at R2, which keeps the square', () => {
    for (const id of ['cityWest', 'cityV1', 'cityV2']) {
      const pieces = surfacePieces(ROADS, id);
      expect(Math.max(...pieces.map((p) => p.maxZ)), id).toBeCloseTo(rect('r2').minZ, 6);
    }
    expect(surfacePieces(ROADS, 'r2').length).toBe(1);
  });

  it('city streets and the town lane are one street style, the trails another', () => {
    for (const r of ROADS) expect(isStreet(r.id), r.id).toBe(r.id.startsWith('city') || r.id === 'townEast');
  });
});

describe('wheel ruts', () => {
  const plan = rutPlan(ROADS);

  it('no straight rut enters another road (they stop at the edge of the road they end in)', () => {
    expect(plan.lines.length).toBeGreaterThan(0);
    for (const l of plan.lines) {
      // the rut's own footprint: 0.34 m wide across its run, ending exactly at its ends
      const acrossX = l.x0 === l.x1 ? 0.17 : 0;
      const acrossZ = l.z0 === l.z1 ? 0.17 : 0;
      const seg: Rect = { minX: Math.min(l.x0, l.x1) - acrossX, maxX: Math.max(l.x0, l.x1) + acrossX, minZ: Math.min(l.z0, l.z1) - acrossZ, maxZ: Math.max(l.z0, l.z1) + acrossZ };
      for (const o of ROADS) {
        if (o.id === l.road) continue;
        // the junction square belongs to the road that runs through it (its ruts run straight on there); the rest of
        // another road's ground is off limits
        for (const piece of surfacePieces(ROADS, o.id)) expect(overlapArea(seg, piece), `${l.road} rut enters ${o.id}`).toBeNull();
      }
      const own = rect(l.road);
      expect(Math.min(l.x0, l.x1)).toBeGreaterThanOrEqual(own.minX);
      expect(Math.max(l.x0, l.x1)).toBeLessThanOrEqual(own.maxX);
      expect(Math.min(l.z0, l.z1)).toBeGreaterThanOrEqual(own.minZ);
      expect(Math.max(l.z0, l.z1)).toBeLessThanOrEqual(own.maxZ);
    }
  });

  it('streets have no ruts', () => {
    for (const l of plan.lines) expect(isStreet(l.road), l.road).toBe(false);
  });

  it('every L corner of the trail has one curved pair, and nothing else curves', () => {
    expect(plan.arcs.length).toBe(8);
    const corners = [
      ['r1', 'westLink'],
      ['westLink', 'r2'],
      ['r2', 'eastLink'],
      ['eastLink', 'r3'],
    ];
    for (const [a, b] of corners) {
      const sq = overlapArea(rect(a!), rect(b!))!;
      const here = plan.arcs.filter((c) => c.cx >= sq.minX - 1e-6 && c.cx <= sq.maxX + 1e-6 && c.cz >= sq.minZ - 1e-6 && c.cz <= sq.maxZ + 1e-6);
      expect(here.length, `${a}/${b}`).toBe(2);
      // concentric, the inner one tighter, both a quarter turn
      expect(here[0]!.r).not.toBeCloseTo(here[1]!.r, 3);
      for (const c of here) {
        expect(Math.abs(c.sweep)).toBeCloseTo(Math.PI / 2, 6);
        // the curve stays inside the corner square
        for (const [x0, z0, x1, z1] of arcSegments(c)) {
          for (const [x, z] of [[x0, z0], [x1, z1]] as const) {
            expect(x).toBeGreaterThanOrEqual(sq.minX - 1e-6);
            expect(x).toBeLessThanOrEqual(sq.maxX + 1e-6);
            expect(z).toBeGreaterThanOrEqual(sq.minZ - 1e-6);
            expect(z).toBeLessThanOrEqual(sq.maxZ + 1e-6);
          }
        }
      }
    }
  });

  it('each curve joins the straight ruts of both roads end to end', () => {
    const near = (x: number, z: number, roadId: string): boolean =>
      plan.lines.some((l) => l.road === roadId && ((Math.abs(l.x0 - x) < 1e-6 && Math.abs(l.z0 - z) < 1e-6) || (Math.abs(l.x1 - x) < 1e-6 && Math.abs(l.z1 - z) < 1e-6)));
    for (const c of plan.arcs) {
      const segs = arcSegments(c);
      const [sx, sz] = [segs[0]![0], segs[0]![1]];
      const last = segs[segs.length - 1]!;
      const [ex, ez] = [last[2], last[3]];
      const roads = [c.road, ...ROADS.filter((o) => o.id !== c.road && overlapArea(rect(c.road), o.rect)).map((o) => o.id)];
      expect(roads.some((id) => near(sx, sz, id)), `arc start ${sx},${sz}`).toBe(true);
      expect(roads.some((id) => near(ex, ez, id)), `arc end ${ex},${ez}`).toBe(true);
    }
  });

  it('a T-junction side road stops at the main road edge', () => {
    const av = plan.lines.filter((l) => l.road === 'southAvenue');
    expect(av.length).toBe(2);
    for (const l of av) expect(Math.max(l.z0, l.z1)).toBeCloseTo(rect('r1').minZ, 6);
    // r1's ruts stop at the city street's kerb
    for (const l of plan.lines.filter((x) => x.road === 'r1')) expect(Math.max(l.x0, l.x1)).toBeCloseTo(rect('cityWest').minX, 6);
  });
});

describe('paving in front of each region gate', () => {
  const ps = gatePavings();
  it('covers 10 m of the road each gate opens on, for eras 2..10', () => {
    expect(ps.map((p) => p.era)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const p of ps) {
      const l = regionLayout(p.era);
      const road = rect(p.road);
      expect(p.road).toBe(l.road);
      expect(p.rect.maxX - p.rect.minX).toBeCloseTo(GATE_PAVING_LENGTH, 6);
      expect((p.rect.minX + p.rect.maxX) / 2).toBeCloseTo(l.gate.x, 6);
      expect(p.rect.minZ).toBe(road.minZ);
      expect(p.rect.maxZ).toBe(road.maxZ);
      expect(p.rect.minX).toBeGreaterThanOrEqual(road.minX);
      expect(p.rect.maxX).toBeLessThanOrEqual(road.maxX);
      // the road's edge is the gate's line
      expect([road.minZ, road.maxZ]).toContain(l.gate.z);
    }
  });

  it('stays clear of junction squares (it is plain road)', () => {
    for (const p of ps) for (const o of ROADS) if (o.id !== p.road) expect(overlapArea(p.rect, o.rect), `era ${p.era} / ${o.id}`).toBeNull();
  });
});

describe('fingerposts do not crowd each other', () => {
  it('no two posts within 6 m', () => {
    for (let i = 0; i < JUNCTIONS.length; i++) {
      for (let j = i + 1; j < JUNCTIONS.length; j++) {
        const a = JUNCTIONS[i]!.post;
        const b = JUNCTIONS[j]!.post;
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${JUNCTIONS[i]!.id} / ${JUNCTIONS[j]!.id}`).toBeGreaterThan(6);
      }
    }
  });

  it('arms of different posts never touch or cross (plan view, 0.6 m margin)', () => {
    const segs = JUNCTIONS.map((j) => ({ id: j.id, s: armSegments(j) }));
    const box = (s: { x0: number; z0: number; x1: number; z1: number }): Rect => ({
      minX: Math.min(s.x0, s.x1) - 0.3,
      maxX: Math.max(s.x0, s.x1) + 0.3,
      minZ: Math.min(s.z0, s.z1) - 0.3,
      maxZ: Math.max(s.z0, s.z1) + 0.3,
    });
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        for (const a of segs[i]!.s) for (const b of segs[j]!.s) expect(overlapArea(box(a), box(b)), `${segs[i]!.id} / ${segs[j]!.id}`).toBeNull();
      }
    }
  });

  it('no post repeats another post’s trail arm within 20 m', () => {
    for (const j of JUNCTIONS) {
      for (const k of JUNCTIONS) {
        if (j === k || Math.hypot(j.at.x - k.at.x, j.at.z - k.at.z) > 20) continue;
        expect(j.trail === false || k.trail === false, `${j.id} / ${k.id}`).toBe(true);
      }
    }
  });
});
