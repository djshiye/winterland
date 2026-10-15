/**
 * Wave 9 crew routes to the Market Town (npc/townRoutes.ts): every route a porter / cashier walks stays on walkable
 * ground (the yard → village gate → street → corridor → square chain) and clear of the real colliders, which are
 * replayed from tests/fixtures/townColliders.json (a dump of ctx.colliders with the yard machines and the
 * farm / bakery / ranch / butcher on lots 0-3 built).
 */
import { describe, expect, it } from 'vitest';
import { BUSINESSES, LAYOUT, type BusinessId, type Rect, type XZ } from '../src/config';
import {
  BENCH_LEG,
  CABIN_LEG,
  CLEARANCE,
  DROP_LEG,
  ENTRY,
  GATE_HUB,
  SQUARE_WALK,
  TRUNK,
  inRects,
  planSquare,
  routeLength,
  travel,
  walkUnion,
  zoneStand,
  TILL_SHIFT,
  ZONE_SPOTS,
  type Stop,
} from '../src/npc/townRoutes';
import { LOT_COUNT } from '../src/core/types';
import { ColliderWorld } from '../src/world/Colliders';
import { layoutFor, lotFrame, worldRect } from '../src/town/rules';
import fixture from './fixtures/townColliders.json';

type Dump = { tag: string; box?: Rect; circle?: { x: number; z: number; r: number } };
const DUMP = fixture as Dump[];
const T = LAYOUT.town;

function worldWith(filter: (tag: string) => boolean = () => true, extra: (w: ColliderWorld) => void = () => {}): ColliderWorld {
  const w = new ColliderWorld();
  w.setBounds(LAYOUT.yard);
  for (const r of [...LAYOUT.village.walk, ...T.walk]) w.addBounds(r);
  for (const c of DUMP) {
    if (!filter(c.tag)) continue;
    if (c.box) w.addBox(c.box, c.tag);
    else if (c.circle) w.addCircle(c.circle.x, c.circle.z, c.circle.r, c.tag);
  }
  extra(w);
  return w;
}

const isLot = (tag: string): boolean => /^town:\d/.test(tag);
const HOME: XZ = { x: 18.2, z: 28.4 };
const DROP: XZ = { x: -3.0, z: 1.4 };
const BENCH: XZ = { x: 5.95, z: 0.85 };
const CABIN: XZ = { x: 7.0, z: -5.0 };
const YARD_STOPS: Stop[] = [
  { p: DROP, leg: DROP_LEG },
  { p: BENCH, leg: BENCH_LEG },
  { p: CABIN, leg: CABIN_LEG },
];
const PORCH = 0.6; // endpoints sit next to the props they serve: exempt within this distance of the ends

/** Samples every 0.1 m of the polyline `from` -> pts and reports the first problem, or null. */
function check(w: ColliderWorld, from: XZ, pts: readonly XZ[], radius = 0.3): string | null {
  const union = walkUnion();
  const all = [from, ...pts];
  const total = routeLength(from, pts);
  let done = 0;
  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i]!;
    const b = all[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / 0.1));
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n;
      const z = a.z + ((b.z - a.z) * k) / n;
      const d = done + (len * k) / n;
      if (!inRects(union, x, z)) return `off the walkable ground at (${x.toFixed(2)}, ${z.toFixed(2)})`;
      if (d > PORCH && total - d > PORCH && w.overlaps(x, z, radius)) return `inside a collider at (${x.toFixed(2)}, ${z.toFixed(2)})`;
    }
    done += len;
  }
  return null;
}

/** Every stand point a porter / cashier uses on lot `lot` for business `id` (the zones that exist), for lanes 0..3. */
function standPoints(lot: number, id: BusinessId): XZ[] {
  const f = lotFrame(lot);
  const L = layoutFor(BUSINESSES[id], 1.8, f.variant);
  const out: XZ[] = [];
  const zones = [L.feed, L.pickup, L.collect].filter((r) => !!r);
  for (const z of zones) {
    const rect = worldRect(f, z!.u0, z!.u1, z!.v0, z!.v1);
    for (let lane = 0; lane < ZONE_SPOTS.length; lane++) out.push(zoneStand(rect, { x: f.fx, z: f.fz }, lane).p);
    if (z === L.collect) out.push(zoneStand(rect, { x: f.fx, z: f.fz }, 0, TILL_SHIFT).p); // the cashier's till spot
  }
  return out;
}

/** The lot's own colliders for business `id`: building body (conservative: the whole back of the lot) + props. */
function addLot(w: ColliderWorld, lot: number, id: BusinessId): void {
  const f = lotFrame(lot);
  const L = layoutFor(BUSINESSES[id], 1.8, f.variant);
  w.addBox(worldRect(f, -2.2, 2.2, -2.2, 1.8), `town:${lot}`);
  for (const s of L.solids) w.addBox(worldRect(f, s.u0, s.u1, s.v0, s.v1), `town:${lot}:prop`);
}

describe('trunk and legs', () => {
  it('stays inside the walk-rect chain from the yard to the square', () => {
    const w = worldWith((t) => !isLot(t));
    const pts = [...TRUNK];
    expect(check(w, GATE_HUB, pts)).toBeNull();
    expect(inRects(walkUnion(), ENTRY.x, ENTRY.z)).toBe(true);
    expect(inRects([SQUARE_WALK], ENTRY.x, ENTRY.z)).toBe(true);
  });

  it('every yard post reaches the gate hub over free ground', () => {
    const w = worldWith();
    for (const s of YARD_STOPS) expect(check(w, s.p, s.leg!), `${s.p.x},${s.p.z}`).toBeNull();
  });
});

describe('planSquare', () => {
  it('goes straight when the line is free and around the fir when it is not', () => {
    const w = worldWith();
    const blocked = (x: number, z: number): boolean => w.overlaps(x, z, CLEARANCE);
    expect(planSquare(ENTRY, { x: 18, z: 26.7 }, blocked)).toHaveLength(1);
    const east = { x: 31.6, z: 24.8 };
    const path = planSquare(ENTRY, east, blocked);
    expect(path.length).toBeGreaterThan(1);
    expect(path[path.length - 1]).toEqual(east);
    expect(check(w, ENTRY, path)).toBeNull();
    for (const p of path) expect(inRects([SQUARE_WALK], p.x, p.z)).toBe(true);
  });

  it('falls back to the goal when it cannot find a way', () => {
    const p = planSquare(ENTRY, { x: 30, z: 30 }, () => true);
    expect(p[p.length - 1]).toEqual({ x: 30, z: 30 });
  });
});

describe('town routes (lots 0-3 built as in the fixture)', () => {
  const w = worldWith();
  const blocked = (x: number, z: number): boolean => w.overlaps(x, z, CLEARANCE);
  const stops: Array<[string, Stop]> = [];
  const lots: Array<[number, BusinessId]> = [[0, 'farm'], [1, 'bakery'], [2, 'ranch'], [3, 'butcher']];
  for (const [lot, id] of lots) for (const p of standPoints(lot, id)) stops.push([`lot${lot}:${id}`, { p, leg: null }]);
  stops.push(['home', { p: HOME, leg: null }]);

  it('keeps every square stop inside the square and off the colliders', () => {
    for (const [name, s] of stops) {
      expect(inRects([SQUARE_WALK], s.p.x, s.p.z), name).toBe(true);
      expect(w.overlaps(s.p.x, s.p.z, 0.3), `${name} (${s.p.x.toFixed(2)}, ${s.p.z.toFixed(2)})`).toBe(false);
    }
  });

  it('routes yard <-> square <-> square on walkable, collider-free ground', () => {
    for (const y of YARD_STOPS) {
      for (const [name, s] of stops) {
        const there = travel(y, s, blocked);
        expect(check(w, y.p, there), `${y.p.x},${y.p.z} -> ${name}`).toBeNull();
        expect(there[there.length - 1]).toEqual(s.p);
        const back = travel(s, y, blocked);
        expect(check(w, s.p, back), `${name} -> ${y.p.x},${y.p.z}`).toBeNull();
        expect(back[back.length - 1]).toEqual(y.p);
      }
    }
    for (const [na, a] of stops) {
      for (const [nb, b] of stops) {
        if (a === b) continue;
        expect(check(w, a.p, travel(a, b, blocked)), `${na} -> ${nb}`).toBeNull();
      }
    }
  });

  it('routes between yard posts through the hub only when their legs differ', () => {
    expect(check(w, DROP, travel(YARD_STOPS[0]!, YARD_STOPS[1]!, blocked))).toBeNull();
    expect(travel(YARD_STOPS[0]!, YARD_STOPS[0]!, blocked)).toEqual([]);
  });
});

describe('stand points for any lot and business', () => {
  it('are walkable and clear of that lot\'s own props, for every lot x business', () => {
    const ids = Object.keys(BUSINESSES).filter((id) => BUSINESSES[id as BusinessId].kind !== 'home') as BusinessId[];
    for (let lot = 0; lot < LOT_COUNT; lot++) {
      for (const id of ids) {
        const w2 = worldWith((t) => !isLot(t), (cw) => addLot(cw, lot, id));
        const blocked = (x: number, z: number): boolean => w2.overlaps(x, z, CLEARANCE);
        for (const p of standPoints(lot, id)) {
          expect(inRects([SQUARE_WALK], p.x, p.z), `lot ${lot} ${id}`).toBe(true);
          expect(w2.overlaps(p.x, p.z, 0.3), `lot ${lot} ${id} (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`).toBe(false);
          const route = travel({ p: HOME, leg: null }, { p, leg: null }, blocked);
          expect(check(w2, HOME, route), `lot ${lot} ${id} route`).toBeNull();
        }
      }
    }
  });
});
