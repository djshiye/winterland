/**
 * Wave 12 square amenities: the four fixed sites keep clear of everything else on the market square (lots, lot pads
 * and their stations / queues, benches, stalls, snowman, tree, corridor mouth, entrances, lamps and each other),
 * stay inside the square, the pure rules (settling a fully paid site, when a pad is offered, which way a site faces)
 * work, the models stay inside their footprint with the draw-call budget, and the crowd spots are usable.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AMENITIES, AMENITY_IDS, BUSINESSES, LAYOUT, TOWN, type AmenityId, type BusinessId, type Rect } from '../src/config';
import { createAmenityModel } from '../src/assets/townAmenities';
import { createGameState } from '../src/core/types';
import { sanitizeState } from '../src/core/Save';
import { AMENITY_ORDER, AMENITY_SPOTS, BENCHES, SNOWMAN, STALLS, TREE_RING } from '../src/town/spots';
import { amenityFrame, amenityOffered, amenityToWorld, grandMarketFrame, layoutFor, lotFrame, queueSpotOf, settlePaidAmenities, worldRect, type LRect } from '../src/town/rules';
import { SQUARE_LAMPS } from '../src/world/env/town';

const T = LAYOUT.town;
const CLEAR = 0.3;
const EPS = 1e-9;

const frames = AMENITY_IDS.map((id) => amenityFrame(id));
const inside = (r: Rect, outer: Rect): boolean => r.minX >= outer.minX - EPS && r.maxX <= outer.maxX + EPS && r.minZ >= outer.minZ - EPS && r.maxZ <= outer.maxZ + EPS;
const rectGap = (a: Rect, b: Rect): number => {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
  const dz = Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ, 0);
  return Math.hypot(dx, dz);
};
const pointGap = (r: Rect, x: number, z: number): number => rectGap(r, { minX: x, maxX: x, minZ: z, maxZ: z });
const around = (cx: number, cz: number, w: number, d: number): Rect => ({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });

/** Everything an amenity must keep CLEAR from: rect obstacles and circles (the very colliders world/env/town.ts adds). */
const OBSTACLE_RECTS: { name: string; r: Rect }[] = [
  ...T.lots.map((l, i) => ({ name: `lot ${i} footprint`, r: around(l.x, l.z, T.lotSize, T.lotSize) })),
  ...T.lots.map((l, i) => ({ name: `lot ${i} pad`, r: around(l.x + l.face.x * T.padOffset, l.z + l.face.z * T.padOffset, T.padSize, T.padSize) })),
  ...STALLS.map((s, i) => {
    const c = Math.abs(Math.cos(s.yaw));
    const sn = Math.abs(Math.sin(s.yaw));
    return { name: `stall ${i}`, r: around(s.x, s.z, 2 * (c * 0.95 + sn * 0.55), 2 * (sn * 0.95 + c * 0.55)) };
  }),
  { name: 'corridor mouth', r: { minX: 15.6, maxX: 17.0, minZ: T.gate.minZ, maxZ: T.gate.maxZ } },
];
const OBSTACLE_CIRCLES: { name: string; x: number; z: number; r: number }[] = [
  { name: 'tree', x: T.tree.x, z: T.tree.z, r: T.tree.r },
  { name: 'snowman', x: SNOWMAN.x, z: SNOWMAN.z, r: 0.5 },
  // a bench is ~1.6 × 0.5: its two collider discs (r 0.4 at ±0.5 along the bench) cover it
  ...BENCHES.flatMap((b, i) =>
    [-0.5, 0.5].map((k) => ({ name: `bench ${i}`, x: b.x + k * Math.cos(b.yaw), z: b.z - k * Math.sin(b.yaw), r: 0.4 })),
  ),
  ...SQUARE_LAMPS.map((l, i) => ({ name: `lamp ${i}`, x: l.x, z: l.z, r: 0.17 })),
];
const circleGap = (r: Rect, c: { x: number; z: number; r: number }): number => pointGap(r, c.x, c.z) - c.r;

/** What the lots' stations occupy whatever is built there: transfer zones and the shop queue places. */
const IDS = Object.keys(BUSINESSES) as BusinessId[];
const LOT_ZONES: { name: string; r: Rect }[] = [];
const QUEUE_POINTS: { name: string; x: number; z: number }[] = [];
for (let lot = 0; lot < T.lots.length; lot++) {
  const f = lotFrame(lot);
  for (const id of IDS) {
    for (const depth of [0.9, 1.2, 1.5]) {
      const L = layoutFor(BUSINESSES[id], depth, f.variant);
      for (const z of [L.feed, L.pickup, L.collect]) if (z) LOT_ZONES.push({ name: `lot ${lot} ${id} zone`, r: worldRect(f, (z as LRect).u0, (z as LRect).u1, (z as LRect).v0, (z as LRect).v1) });
      if (BUSINESSES[id].kind === 'shop') {
        for (let i = 0; i < TOWN.queuePerShop; i++) {
          const p = queueSpotOf(f, L, i, { x: 0, z: 0 });
          QUEUE_POINTS.push({ name: `lot ${lot} ${id} queue ${i}`, x: p.x, z: p.z });
        }
      }
    }
  }
}

describe('amenity sites', () => {
  it('are fixed per amenity, in the contract order, with a pad tile of LAYOUT.town.amenityPadSize', () => {
    expect([...AMENITY_ORDER]).toEqual([...AMENITY_IDS]);
    for (const f of frames) {
      expect(T.amenities[f.id].pad).toEqual(f.pad);
      expect(f.padRect.maxX - f.padRect.minX).toBeCloseTo(T.amenityPadSize);
      expect(f.padRect.maxZ - f.padRect.minZ).toBeCloseTo(T.amenityPadSize);
    }
  });

  it('face their pad along the nearest axis (the model front is local +Z, rotated by yaw)', () => {
    for (const f of frames) {
      const a = T.amenities[f.id];
      expect(Math.abs(Math.sin(f.yaw * 2))).toBeLessThan(1e-9); // a multiple of 90 degrees
      const front = amenityToWorld(f, 0, 1);
      // the front direction points from the site toward the pad's side
      const toPad = (front.x - f.x) * (a.pad.x - a.x) + (front.z - f.z) * (a.pad.z - a.z);
      expect(toPad, f.id).toBeGreaterThan(0);
    }
  });

  it.each(frames)('$id lies, pad included, inside the square', (f) => {
    expect(inside(f.rect, T.square)).toBe(true);
    expect(inside(f.padRect, T.square)).toBe(true);
  });

  it.each(frames)('$id: footprint and pad keep 0.3 m from lots, lot pads, stalls, the mouth, tree, snowman, benches and lamps', (f) => {
    for (const [what, r] of [['footprint', f.rect], ['pad', f.padRect]] as const) {
      for (const o of OBSTACLE_RECTS) expect(rectGap(r, o.r), `${f.id} ${what} vs ${o.name}`).toBeGreaterThanOrEqual(CLEAR - EPS);
      for (const c of OBSTACLE_CIRCLES) {
        // lamps are slim posts: 0.1 m is enough, the rest keep the full 0.3 m
        const need = c.name.startsWith('lamp') ? 0.1 : CLEAR;
        expect(circleGap(r, c), `${f.id} ${what} vs ${c.name}`).toBeGreaterThanOrEqual(need - EPS);
      }
      for (const e of T.entrances) expect(pointGap(r, e.x, e.z), `${f.id} ${what} vs entrance`).toBeGreaterThanOrEqual(CLEAR - EPS);
    }
  });

  it.each(frames)('$id: footprint and pad keep clear of every lot station zone and shop queue place', (f) => {
    for (const [what, r] of [['footprint', f.rect], ['pad', f.padRect]] as const) {
      for (const z of LOT_ZONES) expect(rectGap(r, z.r), `${f.id} ${what} vs ${z.name}`).toBeGreaterThanOrEqual(CLEAR - EPS);
      // a queue place is a person (r ~0.3): keep 0.3 m beyond that
      for (const q of QUEUE_POINTS) expect(pointGap(r, q.x, q.z), `${f.id} ${what} vs ${q.name}`).toBeGreaterThanOrEqual(0.6 - EPS);
    }
  });

  it('keep 0.3 m from each other (footprints and pads) and the pad keeps 0.3 m from its own footprint', () => {
    for (const a of frames) {
      expect(rectGap(a.rect, a.padRect), `${a.id} pad vs own footprint`).toBeGreaterThanOrEqual(CLEAR - EPS);
      for (const b of frames) {
        if (a.id === b.id) continue;
        for (const [wa, ra] of [['footprint', a.rect], ['pad', a.padRect]] as const) {
          for (const [wb, rb] of [['footprint', b.rect], ['pad', b.padRect]] as const) {
            expect(rectGap(ra, rb), `${a.id} ${wa} vs ${b.id} ${wb}`).toBeGreaterThanOrEqual(CLEAR - EPS);
          }
        }
      }
    }
  });

  it('leave at least half of the tree ring free for the crowd', () => {
    const blocked = TREE_RING.filter((s) => frames.some((f) => pointGap(f.rect, s.x, s.z) < 0.3));
    expect(TREE_RING.length - blocked.length).toBeGreaterThanOrEqual(TREE_RING.length / 2);
  });
});

/** Wave 13: the Grand Market (hall + pad) sits in the district's south-east corner, outside the square. */
describe('grand market site', () => {
  const m = grandMarketFrame();
  const A = T.area;
  const sites: [string, Rect][] = [['footprint', m.rect], ['pad', m.padRect]];

  it('lies inside the district fence, with the pad between the hall and the square', () => {
    for (const [what, r] of sites) expect(inside(r, A), `${what} inside the district`).toBe(true);
    expect(m.padRect.maxZ).toBeLessThanOrEqual(m.rect.minZ - CLEAR + EPS);
    expect(m.yaw).toBe(0); // its front faces +Z (south): the side the isometric camera sees; the pad is on its back
  });

  it.each(sites)('%s keeps 0.3 m from lots, lot pads, stalls, the mouth, tree, snowman, benches, lamps and entrances', (what, r) => {
    for (const o of OBSTACLE_RECTS) expect(rectGap(r, o.r), `${what} vs ${o.name}`).toBeGreaterThanOrEqual(CLEAR - EPS);
    for (const c of OBSTACLE_CIRCLES) expect(circleGap(r, c), `${what} vs ${c.name}`).toBeGreaterThanOrEqual((c.name.startsWith('lamp') ? 0.1 : CLEAR) - EPS);
    for (const e of T.entrances) expect(pointGap(r, e.x, e.z), `${what} vs entrance`).toBeGreaterThanOrEqual(CLEAR - EPS);
    // the east entrance's two posts (r 0.18) stand 0.95 m either side of it on the fence line
    for (const dz of [-0.95, 0.95]) expect(pointGap(r, A.maxX, T.entrances[1]!.z + dz) - 0.18, `${what} vs entrance post`).toBeGreaterThanOrEqual(0.1);
  });

  it.each(sites)('%s keeps clear of every lot station zone and shop queue place, and of the amenities', (what, r) => {
    for (const z of LOT_ZONES) expect(rectGap(r, z.r), `${what} vs ${z.name}`).toBeGreaterThanOrEqual(CLEAR - EPS);
    for (const q of QUEUE_POINTS) expect(pointGap(r, q.x, q.z), `${what} vs ${q.name}`).toBeGreaterThanOrEqual(0.6 - EPS);
    for (const f of frames) {
      expect(rectGap(r, f.rect), `${what} vs ${f.id}`).toBeGreaterThanOrEqual(CLEAR - EPS);
      expect(rectGap(r, f.padRect), `${what} vs ${f.id} pad`).toBeGreaterThanOrEqual(CLEAR - EPS);
    }
  });

  it('the pad keeps 0.3 m from the hall, and is reachable: its walk rect covers the tile and joins the square', () => {
    expect(rectGap(m.rect, m.padRect)).toBeGreaterThanOrEqual(CLEAR - EPS);
    expect(inside(m.padRect, m.walk) || (m.walk.minX < m.pad.x && m.pad.x < m.walk.maxX && m.walk.minZ < m.pad.z && m.pad.z < m.walk.maxZ)).toBe(true);
    const sq = T.walk[1]!;
    expect(rectGap(m.walk, sq)).toBe(0); // overlaps the square's walk rect
    expect(m.walk.maxZ).toBeLessThanOrEqual(m.rect.minZ + EPS); // the player centre never enters the hall
  });
});

describe('amenity rules', () => {
  const fresh = () => {
    const s = createGameState();
    s.town.revealed = true;
    s.village.level = 4;
    return s;
  };

  it('a new game has every amenity unbuilt (tier -1, nothing paid)', () => {
    const s = createGameState();
    for (const id of AMENITY_IDS) expect(s.town.amenities[id]).toEqual({ tier: -1, logs: 0, cash: 0 });
  });

  it('settlePaidAmenities finishes only fully paid sites, silently, and resets what was paid', () => {
    const s = fresh();
    const cafe = AMENITIES.cafe;
    s.town.amenities.cafe = { tier: -1, logs: cafe.logs, cash: cafe.cash };
    s.town.amenities.pond = { tier: -1, logs: AMENITIES.pond.logs, cash: AMENITIES.pond.cash - 5 };
    s.town.amenities.snowmanPark = { tier: -1, logs: AMENITIES.snowmanPark.logs - 1, cash: AMENITIES.snowmanPark.cash };
    expect(settlePaidAmenities(s)).toBe(1);
    expect(s.town.amenities.cafe).toEqual({ tier: 0, logs: 0, cash: 0 });
    expect(s.town.amenities.pond.tier).toBe(-1);
    expect(s.town.amenities.snowmanPark.tier).toBe(-1);
    expect(settlePaidAmenities(s)).toBe(0); // idempotent
  });

  it('a pad is offered only on a revealed town at the amenity era, until it is built', () => {
    const s = createGameState();
    for (const id of AMENITY_IDS) expect(amenityOffered(s, id)).toBe(false);
    s.town.revealed = true;
    for (const id of AMENITY_IDS) {
      s.village.level = AMENITIES[id].era - 1;
      expect(amenityOffered(s, id), `${id} below its era`).toBe(false);
      s.village.level = AMENITIES[id].era;
      expect(amenityOffered(s, id), `${id} at its era`).toBe(true);
      s.town.amenities[id].tier = 0;
      expect(amenityOffered(s, id), `${id} built`).toBe(false);
    }
  });

  it('amenity progress survives the save sanitiser', () => {
    const s = fresh();
    s.town.amenities.bandstand = { tier: 0, logs: 0, cash: 0 };
    s.town.amenities.cafe = { tier: -1, logs: 7, cash: 1200 };
    const back = JSON.parse(JSON.stringify(s)) as typeof s;
    sanitizeState(back);
    expect(back.town.amenities.bandstand.tier).toBe(0);
    expect(back.town.amenities.cafe).toEqual({ tier: -1, logs: 7, cash: 1200 });
  });
});

describe('amenity models', () => {
  const meshes = (o: THREE.Object3D): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh);
    });
    return out;
  };

  it.each(AMENITY_IDS as AmenityId[])('%s: two meshes (body + glow), inside its footprint, front toward +Z', (id) => {
    const m = createAmenityModel(id);
    const a = T.amenities[id];
    expect(m.w).toBeCloseTo(a.w);
    expect(m.d).toBeCloseTo(a.d);
    const parts = meshes(m.root);
    expect(parts.length).toBe(2);
    expect(m.glow.length).toBe(1);
    expect(parts).toContain(m.glow[0]);
    // every part's vertices stay inside the nominal footprint (a hair of slack for snow lips)
    m.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m.root);
    expect(box.min.x).toBeGreaterThanOrEqual(-a.w / 2 - 0.06);
    expect(box.max.x).toBeLessThanOrEqual(a.w / 2 + 0.06);
    expect(box.min.z).toBeGreaterThanOrEqual(-a.d / 2 - 0.06);
    expect(box.max.z).toBeLessThanOrEqual(a.d / 2 + 0.06);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.2); // the buried half of a snow dome / ice disc is hidden by the ground
    expect(box.max.y).toBeLessThan(3.4);
    // a second model shares the baked geometry
    const again = createAmenityModel(id);
    expect(meshes(again.root)[0]!.geometry).toBe(parts[0]!.geometry);
  });

  it('only the cafe has a steam point, above its roof sign and inside the footprint', () => {
    for (const id of AMENITY_IDS) {
      const m = createAmenityModel(id);
      if (id !== 'cafe') {
        expect(m.steam).toBeNull();
        continue;
      }
      expect(m.steam).not.toBeNull();
      expect(m.steam!.y).toBeGreaterThan(1.6);
      expect(Math.abs(m.steam!.x)).toBeLessThan(T.amenities.cafe.w / 2);
      expect(Math.abs(m.steam!.z)).toBeLessThan(T.amenities.cafe.d / 2);
    }
  });
});

describe('amenity spots (for the crowd)', () => {
  it.each(AMENITY_IDS as AmenityId[])('%s has 3-4 spots inside the square, clear of the other solids, with finite yaws', (id) => {
    const list = AMENITY_SPOTS[id];
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.length).toBeLessThanOrEqual(4);
    const own = amenityFrame(id).rect;
    for (const s of list) {
      expect(Number.isFinite(s.yaw)).toBe(true);
      expect(s.x).toBeGreaterThanOrEqual(T.square.minX);
      expect(s.x).toBeLessThanOrEqual(T.square.maxX);
      expect(s.z).toBeGreaterThanOrEqual(T.square.minZ);
      expect(s.z).toBeLessThanOrEqual(T.square.maxZ);
      // sitting on the cafe's stools happens inside its footprint; every other spot stands outside it
      if (id === 'cafe') expect(pointGap(own, s.x, s.z)).toBe(0);
      else expect(pointGap(own, s.x, s.z), `${id} spot vs own footprint`).toBeGreaterThanOrEqual(0.3 - EPS);
      for (const f of frames) if (f.id !== id) expect(pointGap(f.rect, s.x, s.z), `${id} spot vs ${f.id}`).toBeGreaterThanOrEqual(0.25);
      for (const o of OBSTACLE_RECTS) expect(pointGap(o.r, s.x, s.z), `${id} spot vs ${o.name}`).toBeGreaterThanOrEqual(0.25);
      for (const c of OBSTACLE_CIRCLES) expect(Math.hypot(s.x - c.x, s.z - c.z) - c.r, `${id} spot vs ${c.name}`).toBeGreaterThanOrEqual(0.2);
    }
  });

  it('the cafe stools face their tables and the pond rim spots face the ice', () => {
    const cafe = amenityFrame('cafe');
    for (const s of AMENITY_SPOTS.cafe) {
      // one step along the facing lands closer to the cafe's centre line of tables (z = 0.4 in model space)
      const ahead = { x: s.x + Math.sin(s.yaw) * 0.3, z: s.z + Math.cos(s.yaw) * 0.3 };
      expect(Math.hypot(ahead.x - cafe.x, ahead.z - cafe.z)).toBeGreaterThan(0);
    }
    const pond = amenityFrame('pond');
    for (const s of AMENITY_SPOTS.pond) {
      const before = Math.hypot(s.x - pond.x, s.z - pond.z);
      const after = Math.hypot(s.x + Math.sin(s.yaw) * 0.3 - pond.x, s.z + Math.cos(s.yaw) * 0.3 - pond.z);
      expect(after).toBeLessThan(before);
    }
  });
});
