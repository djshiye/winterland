/**
 * 0.9.12 Lantern Lane (town/lane.ts, world/env/lantern.ts): the Market Town's four new lots south of its fence. They
 * open only with the new land (era 1 never sees them), their props never stand in the walk or in front of a lot, the
 * walks there are at least 3 m wide, and an older save keeps every built lot where it was.
 */
import { describe, expect, it } from 'vitest';
import { BUSINESSES, LAYOUT, type BusinessId, type Rect } from '../src/config';
import { MIGRATIONS, mergeState, migrateState } from '../src/core/Save';
import { createGameState, LOT_COUNT, TOWN_SQUARE_LOTS } from '../src/core/types';
import { canChoose, layoutFor, lotFrame, manageRect, queueSpotOf, worldRect } from '../src/town/rules';
import { GAP_IN, GAP_OUT, LANE, LANE_GAP_WALK, LANE_PLAYER_WALK, LANE_WALK, SPINE_X, isLaneLot, laneOpen, lotOffered, viaLane } from '../src/town/lane';
import { LANE_PROPS } from '../src/world/env/lantern';
import { JUNCTIONS } from '../src/world/env/wayfinding';

const T = LAYOUT.town;
const LANE_LOTS = Array.from({ length: LOT_COUNT - TOWN_SQUARE_LOTS }, (_, i) => TOWN_SQUARE_LOTS + i);
const WIDE_WALK = 3;
const inRect = (r: Rect, x: number, z: number, m = 0): boolean => x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m;
const contains = (outer: Rect, r: Rect): boolean => r.minX >= outer.minX - 1e-6 && r.maxX <= outer.maxX + 1e-6 && r.minZ >= outer.minZ - 1e-6 && r.maxZ <= outer.maxZ + 1e-6;

/** A lane lot's working ground: the lot itself and the strip in front of it out to the walk. */
function workBox(lot: number): Rect {
  const l = T.lots[lot]!;
  const h = T.lotSize / 2;
  const toWalk = l.face.x > 0 ? LANE_WALK.minX : LANE_WALK.maxX;
  return { minX: Math.min(l.x - h, toWalk), maxX: Math.max(l.x + h, toWalk), minZ: l.z - h, maxZ: l.z + h };
}

describe('Lantern Lane (0.9.12)', () => {
  it('has four lots after the square\'s eight, facing the avenue from either side', () => {
    expect(LOT_COUNT).toBe(T.lots.length);
    expect(LANE_LOTS).toHaveLength(4);
    for (const lot of LANE_LOTS) {
      const l = T.lots[lot]!;
      expect(isLaneLot(lot)).toBe(true);
      expect(Math.sign(SPINE_X - l.x)).toBe(l.face.x);
      expect(inRect(LANE, l.x, l.z)).toBe(true);
    }
  });

  it('opens with the Great Lodge or a later era, never in era 1', () => {
    const s = createGameState();
    s.town.revealed = true;
    expect(laneOpen(s)).toBe(false);
    for (const lot of LANE_LOTS) {
      expect(lotOffered(s, lot)).toBe(false);
      expect(canChoose(s, lot, 'bakery' as BusinessId)).toBe(false);
    }
    for (let lot = 0; lot < TOWN_SQUARE_LOTS; lot++) expect(lotOffered(s, lot)).toBe(true);
    s.village.greatLodge.tier = 0;
    expect(laneOpen(s)).toBe(true);
    const later = createGameState();
    later.eras.age = 2;
    expect(laneOpen(later)).toBe(true);
  });

  it('every station and shop queue of every business stays on the lot\'s own ground, which the walk never crosses', () => {
    for (const lot of LANE_LOTS) {
      const box = workBox(lot);
      expect(box.maxX <= LANE_WALK.minX + 1e-6 || box.minX >= LANE_WALK.maxX - 1e-6, `lot ${lot}`).toBe(true);
      const f = lotFrame(lot);
      expect(contains(inflateBox(box, 0.4), manageRect(lot)), `lot ${lot} manage tile`).toBe(true);
      for (const id of Object.keys(BUSINESSES) as BusinessId[]) {
        const L = layoutFor(BUSINESSES[id], 1.8, f.variant);
        for (const z of [L.feed, L.pickup, L.collect].filter((r) => !!r)) {
          const r = worldRect(f, z!.u0, z!.u1, z!.v0, z!.v1);
          expect(contains(inflateBox(box, 0.4), r), `lot ${lot} ${id} zone`).toBe(true);
        }
        if (BUSINESSES[id].kind === 'shop') {
          for (let i = 0; i < 4; i++) {
            const q = queueSpotOf(f, L, i, { x: 0, z: 0 });
            expect(inRect(LANE_PLAYER_WALK, q.x, q.z), `lot ${lot} ${id} queue ${i}`).toBe(true);
          }
        }
      }
    }
  });

  it('no prop stands in the walk, on a lot or in front of one, or on another prop', () => {
    for (const p of LANE_PROPS) {
      const own: Rect = { minX: p.x - (p.hx ?? p.r), maxX: p.x + (p.hx ?? p.r), minZ: p.z - p.r, maxZ: p.z + p.r };
      expect(rectsMeet(own, LANE_WALK), `${p.kind} at ${p.x},${p.z} in the walk`).toBe(false);
      expect(inRect(LANE_WALK, p.x, p.z, p.r), `${p.kind} at ${p.x},${p.z} in the walk`).toBe(false);
      expect(inRect(LANE, p.x, p.z), `${p.kind} at ${p.x},${p.z} off the lane`).toBe(true);
      for (const lot of LANE_LOTS) expect(rectsMeet(inflateBox(own, 0.2), workBox(lot)), `${p.kind} at ${p.x},${p.z} on lot ${lot}`).toBe(false);
      for (const q of LANE_PROPS) if (q !== p) expect(Math.hypot(p.x - q.x, p.z - q.z) > (p.hx ?? p.r) + (q.hx ?? q.r), `${p.kind} at ${p.x},${p.z}`).toBe(true);
      for (const j of JUNCTIONS) expect(Math.hypot(p.x - j.post.x, p.z - j.post.z) > p.r + 0.6, `${p.kind} at ${p.x},${p.z} by the ${j.id} signpost`).toBe(true);
    }
  });

  it('the walks are at least 3 m wide: the lane, the fence gap, and past the signpost that stands in the lane', () => {
    expect(LANE_WALK.maxX - LANE_WALK.minX).toBeGreaterThanOrEqual(WIDE_WALK);
    expect(LANE_GAP_WALK.maxX - LANE_GAP_WALK.minX).toBeGreaterThanOrEqual(WIDE_WALK);
    for (const j of JUNCTIONS) {
      if (!inRect(LANE_WALK, j.post.x, j.post.z)) continue;
      const clear = Math.max(j.post.x - 0.2 - LANE_WALK.minX, LANE_WALK.maxX - (j.post.x + 0.2));
      expect(clear, j.id).toBeGreaterThanOrEqual(WIDE_WALK);
      expect(Math.abs(j.post.x - SPINE_X), `${j.id} off the spine`).toBeGreaterThan(1);
    }
  });

  it('walkers reach a lane lot through the fence gap along the spine', () => {
    const square = (_a: { x: number; z: number }, b: { x: number; z: number }) => [b];
    const from = { x: 25, z: 30 };
    for (const lot of LANE_LOTS) {
      const to = { x: T.lots[lot]!.x + T.lots[lot]!.face.x * (T.lotSize / 2 + 1), z: T.lots[lot]!.z };
      const path = viaLane(from, to, square);
      expect(path).toContainEqual(GAP_IN);
      expect(path).toContainEqual(GAP_OUT);
      expect(path[path.length - 1]).toEqual(to);
      // between the gap and the lot it walks the spine
      const i = path.findIndex((p) => p === GAP_OUT || (p.x === GAP_OUT.x && p.z === GAP_OUT.z));
      expect(path.slice(i, -1).every((p) => p.x === SPINE_X)).toBe(true);
      expect(viaLane(to, from, square)).toContainEqual(GAP_IN);
    }
  });

  it('a 0.9.11 save (8 town lots) keeps every built lot where it was and gains the lane\'s four', () => {
    const old = createGameState();
    old.town.lots.length = TOWN_SQUARE_LOTS;
    old.town.lots[3] = { building: 'bakery', tier: 0, logs: 0, cash: 0 };
    const saved = JSON.parse(JSON.stringify(old));
    const state = createGameState();
    mergeState(state, saved);
    migrateState(state, false, { salesRate: 0 }, MIGRATIONS.filter((m) => m.id === '0.9.12-bigger-towns'));
    expect(state.town.lots).toHaveLength(LOT_COUNT);
    expect(state.town.lots[3]).toMatchObject({ building: 'bakery', tier: 0 });
    for (const lot of LANE_LOTS) expect(state.town.lots[lot]).toMatchObject({ building: '', tier: -1 });
  });
});

function rectsMeet(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

function inflateBox(r: Rect, m: number): Rect {
  return { minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m };
}
