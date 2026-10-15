/**
 * Wave 9 Market Town rules + geometry (town/rules.ts is pure, so no WebGL is needed): which buildings can be chosen,
 * silent settling of fully-paid lots, the save/snapshot shapes, and that every station layout keeps its zones
 * reachable and apart from its neighbours' on all eight lots.
 */
import { describe, expect, it } from 'vitest';
import { BUSINESSES, LAYOUT, TOWN, VILLAGE, inflate, type BusinessId, type Rect } from '../src/config';
import { villagePopulation } from '../src/core/demand';
import { sanitizeState } from '../src/core/Save';
import { createGameState, LOT_COUNT } from '../src/core/types';
import { BENCHES, SNOWMAN, STALLS } from '../src/town/spots';
import {
  QUEUE_STEP,
  canChoose,
  choicesFor,
  hopperPerKind,
  layoutFor,
  lotFrame,
  lotOpen,
  paidFraction,
  queueSpotOf,
  settlePaidLots,
  staffCount,
  toWorld,
  worldRect,
  type LRect,
} from '../src/town/rules';

const T = LAYOUT.town;
const IDS = (Object.keys(BUSINESSES) as BusinessId[]).filter((id) => !TOWN.hidden.includes(id));
const TOWN_LEVEL = 3;

const revealed = (level = TOWN_LEVEL) => {
  const s = createGameState();
  s.town.revealed = true;
  s.village.level = level;
  return s;
};

describe('choices', () => {
  it('offers every non-hidden building and nothing hidden', () => {
    const ids = choicesFor(TOWN_LEVEL).map((c) => c.def.id);
    expect(ids.sort()).toEqual([...IDS].sort());
    for (const h of TOWN.hidden) expect(ids).not.toContain(h);
  });

  it('greys a building until its era, with a reason naming the era', () => {
    for (const c of choicesFor(0)) {
      expect(c.available).toBe(false);
      expect(c.reason).toBe(`Needs ${VILLAGE.levels[c.def.era]!.name}`);
    }
    for (const c of choicesFor(TOWN_LEVEL)) {
      expect(c.available).toBe(BUSINESSES[c.def.id].era <= TOWN_LEVEL);
      if (c.available) expect(c.reason).toBeUndefined();
    }
  });
});

describe('canChoose', () => {
  it('needs a revealed town, a valid lot, an offered id and its era', () => {
    const s = revealed();
    expect(canChoose(s, 0, 'bakery')).toBe(true);
    expect(canChoose(createGameState(), 0, 'bakery')).toBe(false); // not revealed
    expect(canChoose(s, -1, 'bakery')).toBe(false);
    expect(canChoose(s, LOT_COUNT, 'bakery')).toBe(false);
    expect(canChoose(s, 0.5, 'bakery')).toBe(false);
    expect(canChoose(s, 0, 'toyFactory')).toBe(false); // era 4 (Winter City)
    expect(canChoose(s, 0, 'nope' as BusinessId)).toBe(false);
    s.village.level = TOWN_LEVEL - 1;
    expect(canChoose(s, 0, 'bakery')).toBe(false); // era not reached
  });

  it('allows changing the choice only while nothing is paid, never once built', () => {
    const s = revealed();
    const lot = s.town.lots[2]!;
    lot.building = 'farm';
    expect(lotOpen(s, 2)).toBe(true);
    expect(canChoose(s, 2, 'bakery')).toBe(true);
    lot.logs = 1;
    expect(lotOpen(s, 2)).toBe(false);
    expect(canChoose(s, 2, 'bakery')).toBe(false);
    lot.logs = 0;
    lot.cash = 5;
    expect(canChoose(s, 2, 'bakery')).toBe(false);
    lot.cash = 0;
    lot.tier = 0;
    expect(canChoose(s, 2, 'bakery')).toBe(false);
  });
});

describe('settlePaidLots', () => {
  it('finishes a fully paid lot once and leaves the others alone', () => {
    const s = revealed();
    const bk = BUSINESSES.bakery;
    s.town.lots[1] = { building: 'bakery', tier: -1, logs: bk.logs, cash: bk.cash };
    s.town.lots[3] = { building: 'farm', tier: -1, logs: BUSINESSES.farm.logs, cash: BUSINESSES.farm.cash - 5 };
    s.town.lots[4] = { building: 'townhouse', tier: 0, logs: 0, cash: 0 };
    expect(settlePaidLots(s)).toBe(1);
    expect(s.town.lots[1]).toEqual({ building: 'bakery', tier: 0, logs: 0, cash: 0 });
    expect(s.town.lots[3]!.tier).toBe(-1);
    expect(settlePaidLots(s)).toBe(0); // idempotent
  });

  it('survives the save sanitizer (a fully paid lot stays fully paid, an unknown id frees the lot)', () => {
    const s = revealed();
    s.town.lots[0] = { building: 'bakery', tier: -1, logs: BUSINESSES.bakery.logs, cash: BUSINESSES.bakery.cash };
    s.town.lots[1] = { building: 'gone' as BusinessId, tier: 0, logs: 3, cash: 3 };
    sanitizeState(s);
    expect(s.town.lots[0]).toEqual({ building: 'bakery', tier: -1, logs: BUSINESSES.bakery.logs, cash: BUSINESSES.bakery.cash });
    expect(s.town.lots[1]!.building).toBe('');
    expect(settlePaidLots(s)).toBe(1);
    expect(villagePopulation(s)).toBeGreaterThanOrEqual(BUSINESSES.bakery.people);
  });
});

describe('paidFraction', () => {
  it('is the mean of the logs and cash shares', () => {
    const s = revealed();
    const f = BUSINESSES.farm;
    s.town.lots[0] = { building: 'farm', tier: -1, logs: 0, cash: 0 };
    expect(paidFraction(s, 0)).toBe(0);
    s.town.lots[0] = { building: 'farm', tier: -1, logs: f.logs, cash: 0 };
    expect(paidFraction(s, 0)).toBeCloseTo(0.5);
    s.town.lots[0] = { building: 'farm', tier: -1, logs: f.logs, cash: f.cash };
    expect(paidFraction(s, 0)).toBe(1);
    s.town.lots[0] = { building: 'farm', tier: 0, logs: 0, cash: 0 };
    expect(paidFraction(s, 0)).toBe(0);
  });
});

describe('hopper + staff sizing', () => {
  it('fits at least four cycles per input and the shop counter', () => {
    for (const id of IDS) {
      const d = BUSINESSES[id];
      for (const i of d.inputs) expect(hopperPerKind(d)).toBeGreaterThanOrEqual(i.per * 4);
      if (d.kind === 'shop') expect(hopperPerKind(d)).toBeGreaterThanOrEqual(d.capacity / 2);
    }
  });
  it('shows about one worker per two jobs, none for homes', () => {
    expect(staffCount(BUSINESSES.townhouse)).toBe(0);
    expect(staffCount(BUSINESSES.farm)).toBe(2);
    expect(staffCount(BUSINESSES.bakery)).toBe(3);
  });
});

// ---- geometry -------------------------------------------------------------------------------------------------
const R = 0.36; // PLAYER.radius
/** v of the front of the building body: T1's models (0.9), a centred 3 m box (1.5) and in between. */
const MODEL_FRONTS = [0.9, 1.2, 1.5];
const inRect = (r: Rect, x: number, z: number): boolean => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const walkable = (x: number, z: number): boolean => T.walk.some((r) => inRect(r, x, z));
const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

/** Solid rects of lot `lot` for a business: the building (model w × d) and its props. */
function solidsOf(lot: number, id: BusinessId, depth: number): Rect[] {
  const f = lotFrame(lot);
  const def = BUSINESSES[id];
  const L = layoutFor(def, depth, f.variant);
  const body: LRect = { u0: -1.9, u1: 1.9, v0: -1.9, v1: depth };
  return [body, ...L.solids].map((s) => worldRect(f, s.u0, s.u1, s.v0, s.v1));
}

const SPOT_CIRCLES = [
  ...BENCHES.map((b) => ({ x: b.x, z: b.z, r: 1.0 })),
  ...STALLS.map((b) => ({ x: b.x, z: b.z, r: 1.0 })),
  { x: SNOWMAN.x, z: SNOWMAN.z, r: 0.5 },
  { x: T.tree.x, z: T.tree.z, r: T.tree.r },
];
const hitsCircle = (x: number, z: number, pad: number): boolean => SPOT_CIRCLES.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad);

/** A point of `zone` where the player (radius R) can actually stand. */
function reachable(zone: Rect, solids: Rect[]): boolean {
  for (let x = zone.minX; x <= zone.maxX; x += 0.1) {
    for (let z = zone.minZ; z <= zone.maxZ; z += 0.1) {
      if (!walkable(x, z) || hitsCircle(x, z, R)) continue;
      if (solids.some((s) => inRect(inflate(s, R), x, z))) continue;
      return true;
    }
  }
  return false;
}

describe.each(MODEL_FRONTS)('station layout, body front at v = %s', (depth) => {
  const all = (id: BusinessId): { lot: number; zones: Rect[]; solids: Rect[]; def: (typeof BUSINESSES)[BusinessId] }[] =>
    T.lots.map((_, lot) => {
      const f = lotFrame(lot);
      const L = layoutFor(BUSINESSES[id], depth, f.variant);
      const zones = [L.feed, L.pickup, L.collect].filter((z): z is LRect => !!z).map((z) => worldRect(f, z.u0, z.u1, z.v0, z.v1));
      return { lot, zones, solids: solidsOf(lot, id, depth), def: BUSINESSES[id] };
    });

  it.each(IDS)('%s: every zone is reachable by the player on every lot', (id) => {
    const lots = all(id);
    const solids = lots.flatMap((l) => l.solids);
    for (const l of lots) for (const z of l.zones) expect(reachable(z, solids), `lot ${l.lot} zone ${JSON.stringify(z)}`).toBe(true);
  });

  it('zones of different lots never overlap, whatever is built on each (and a lot\'s own zones are apart)', () => {
    for (const ia of IDS) {
      for (const ib of IDS) {
        const A = all(ia);
        const B = all(ib);
        for (let a = 0; a < A.length; a++) {
          for (let i = 0; i < A[a]!.zones.length; i++) {
            for (let j = i + 1; j < A[a]!.zones.length; j++) expect(overlap(A[a]!.zones[i]!, A[a]!.zones[j]!), `lot ${a} ${ia}`).toBe(false);
          }
          for (let b = a + 1; b < B.length; b++) {
            for (const za of A[a]!.zones) for (const zb of B[b]!.zones) expect(overlap(za, zb), `lots ${a}(${ia})/${b}(${ib})`).toBe(false);
          }
        }
      }
    }
  });

  it.each(IDS)('%s: no zone is centred inside another lot\'s solids', (id) => {
    const lots = all(id);
    for (const l of lots) {
      const others = lots.filter((o) => o.lot !== l.lot).flatMap((o) => o.solids);
      for (const z of l.zones) {
        // a zone's centre of mass stays out of any other lot's solids
        const cx = (z.minX + z.maxX) / 2;
        const cz = (z.minZ + z.maxZ) / 2;
        expect(others.some((s) => inRect(s, cx, cz))).toBe(false);
      }
    }
  });

  it('shop queue places are walkable, clear of props, benches and each other, within ~2.6 m of the lot front', () => {
    for (const id of IDS.filter((i) => BUSINESSES[i].kind === 'shop')) {
      const lots = all(id);
      const solids = lots.flatMap((l) => l.solids);
      for (const l of lots) {
        const f = lotFrame(l.lot);
        const L = layoutFor(BUSINESSES[id], depth, f.variant);
        for (let i = 0; i < TOWN.queuePerShop; i++) {
          const p = queueSpotOf(f, L, i, { x: 0, z: 0 });
          expect(walkable(p.x, p.z), `lot ${l.lot} q${i} walkable`).toBe(true);
          expect(hitsCircle(p.x, p.z, 0.3), `lot ${l.lot} q${i} circles`).toBe(false);
          expect(solids.some((s) => inRect(inflate(s, 0.3), p.x, p.z)), `lot ${l.lot} q${i} solids`).toBe(false);
          // distance from the lot's front edge (v = lotSize / 2)
          const front = toWorld(f, L.queueU, T.lotSize / 2);
          expect(Math.hypot(p.x - front.x, p.z - front.z)).toBeLessThanOrEqual(2.7 + 1e-6);
        }
        expect(QUEUE_STEP).toBeGreaterThanOrEqual(0.55);
      }
    }
  });
});

describe('queues of neighbouring shops', () => {
  it('never cross each other or stand in another lot\'s zones', () => {
    const def = BUSINESSES.bakery;
    for (const depth of MODEL_FRONTS) {
      const q = T.lots.map((_, lot) => {
        const f = lotFrame(lot);
        const L = layoutFor(def, depth, f.variant);
        const spots = Array.from({ length: TOWN.queuePerShop }, (_, i) => queueSpotOf(f, L, i, { x: 0, z: 0 }));
        const zones = [L.feed, L.pickup, L.collect].filter((z): z is LRect => !!z).map((z) => worldRect(f, z.u0, z.u1, z.v0, z.v1));
        return { spots, zones };
      });
      for (let a = 0; a < q.length; a++) {
        for (let b = a + 1; b < q.length; b++) {
          for (const p of q[a]!.spots) for (const o of q[b]!.spots) expect(Math.hypot(p.x - o.x, p.z - o.z), `queues ${a}/${b}`).toBeGreaterThanOrEqual(0.7);
        }
        for (let b = 0; b < q.length; b++) {
          if (a === b) continue;
          for (const p of q[a]!.spots) for (const z of q[b]!.zones) expect(inRect(inflate(z, 0.25), p.x, p.z), `queue ${a} in zone of ${b}`).toBe(false);
        }
      }
    }
  });
});

describe('save shape', () => {
  it('has one lot entry per LAYOUT.town.lots', () => {
    expect(createGameState().town.lots).toHaveLength(T.lots.length);
    expect(LOT_COUNT).toBe(T.lots.length);
  });
});
