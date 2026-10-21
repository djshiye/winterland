/**
 * 1.0 (review ideas 5-7): the river promenade keeps clear of everything that moves or is walked (world/env/promenade.ts),
 * and the storm's snow layer builds and melts at the pace the review asked for (render/snowCover.ts).
 */
import { describe, expect, it } from 'vitest';
import { LAYOUT, PLAYER, type Rect } from '../src/config';
import { REGIONS, RIVER_POND, ROADS } from '../src/eras/data';
import { PROMENADE_WALK, promenadeProps, type PromenadeProp } from '../src/world/env/promenade';
import { footpathRect } from '../src/world/env/wayfinding';
import { WinterFun } from '../src/world/life/WinterFun';
import { LANE } from '../src/town/lane';
import { ColliderWorld } from '../src/world/Colliders';
import { NavGrid } from '../src/world/navGrid';
import { SNOW_BUILD_S, SNOW_MELT_S, SnowLayer } from '../src/render/snowCover';

const hit = (a: Rect, b: Rect, m = 0): boolean => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;
const foot = (p: PromenadeProp): Rect => ({ minX: p.x - p.hx, maxX: p.x + p.hx, minZ: p.z - p.hz, maxZ: p.z + p.hz });
const r1 = ROADS.find((r) => r.id === 'r1')!.rect;
const river = LAYOUT.river;
/** The pond's ice and its snowy rim and rim stones (frontier.ts buildSeams: an ellipse 0.7 m past the ice). */
const POND = { x: (RIVER_POND.minX + RIVER_POND.maxX) / 2, z: (RIVER_POND.minZ + RIVER_POND.maxZ) / 2, rx: (RIVER_POND.maxX - RIVER_POND.minX) / 2 + 0.7, rz: (RIVER_POND.maxZ - RIVER_POND.minZ) / 2 + 0.7 };
const onPond = (r: Rect): boolean => {
  for (let x = r.minX; x <= r.maxX + 1e-9; x += (r.maxX - r.minX) / 6) {
    for (let z = r.minZ; z <= r.maxZ + 1e-9; z += (r.maxZ - r.minZ) / 6) {
      if (((x - POND.x) / POND.rx) ** 2 + ((z - POND.z) / POND.rz) ** 2 < 1) return true;
    }
  }
  return false;
};
/** Everything that is someone's way or ground: roads, regions, the customers' lane and its queue, the village, the town and its lane, the sledding hill, the trike road. */
const busy = (): { what: string; r: Rect }[] => [
  ...ROADS.map((r) => ({ what: r.id, r: r.rect })),
  ...REGIONS.filter((r) => r !== null).map((r) => ({ what: `region ${r!.n}`, r: r!.rect })),
  { what: 'customers lane', r: LAYOUT.customers.path },
  { what: 'village', r: LAYOUT.village.area },
  { what: 'town', r: LAYOUT.town.area },
  { what: 'lantern lane', r: LANE },
  { what: 'sledding hill', r: WinterFun.FOOTPRINT },
  { what: 'trike road', r: LAYOUT.tricycles.road },
  { what: 'yard', r: LAYOUT.yard },
];

describe('the river promenade', () => {
  it('joins up: the bank, the overlook and the footpath overlap each other, and the footpath runs onto R1', () => {
    const [bank, look, path] = PROMENADE_WALK as [Rect, Rect, Rect];
    expect(hit(bank, look)).toBe(true);
    expect(hit(look, path)).toBe(true);
    expect(hit(path, r1)).toBe(true);
    // it is the customers' trodden footpath, not a new way across the snow
    const F = footpathRect();
    expect(path.minX).toBeGreaterThanOrEqual(F.minX);
    expect(path.maxX).toBeLessThanOrEqual(F.maxX);
  });

  it('the walk stays off the water, the pond, the lane, the hill, the regions and the village', () => {
    for (const w of PROMENADE_WALK) {
      expect(w.minX - PLAYER.radius, 'river').toBeGreaterThan(river.maxX);
      expect(onPond({ minX: w.minX - PLAYER.radius, maxX: w.maxX + PLAYER.radius, minZ: w.minZ - PLAYER.radius, maxZ: w.maxZ + PLAYER.radius }), 'pond').toBe(false);
      for (const b of busy()) if (b.what !== 'r1') expect(hit(w, b.r), b.what).toBe(false);
    }
  });

  it('no prop stands on the walk, a road, a route, the water or the ice, or on another prop', () => {
    const props = promenadeProps();
    expect(props.filter((p) => p.kind === 'bench').length).toBeGreaterThanOrEqual(6);
    expect(props.filter((p) => p.kind === 'lamp').length).toBeGreaterThanOrEqual(6);
    expect(props.filter((p) => p.kind === 'bandstand').length).toBe(1);
    const F = footpathRect();
    props.forEach((p, i) => {
      const r = foot(p);
      const what = `${p.kind} at ${p.x},${p.z}`;
      // the player's whole body keeps clear of it anywhere on the walk
      for (const w of PROMENADE_WALK) expect(hit(r, w, PLAYER.radius), `${what} on the walk`).toBe(false);
      for (const b of busy()) expect(hit(r, b.r, 0.3), `${what} on ${b.what}`).toBe(false);
      // off the footpath's own edge stones (wayfinding.ts sets them 0.18 m outside it)
      expect(hit(r, F, 0.36), `${what} on the footpath's edge stones`).toBe(false);
      expect(r.minX, `${what} in the river`).toBeGreaterThan(river.maxX);
      expect(onPond(r), `${what} on the pond`).toBe(false);
      // the customers' queue and their walk out (on the lane) are far from it
      for (const q of [LAYOUT.customers.spawn, ...LAYOUT.customers.exitPath]) expect(hit(r, { minX: q.x, maxX: q.x, minZ: q.z, maxZ: q.z }, 0.8), `${what} on the customers' way`).toBe(false);
      // the snowman and the mill's sign (env/buildings.ts) north of the bank
      expect(hit(r, { minX: -9.3, maxX: -7.9, minZ: 13.7, maxZ: 15.1 }), `${what} on the snowman`).toBe(false);
      props.forEach((q, j) => {
        if (j > i) expect(hit(r, foot(q)), `${what} on ${q.kind} at ${q.x},${q.z}`).toBe(false);
      });
    });
  });

  it('with its colliders in, the whole walk can be walked from the mill end to R1', () => {
    const c = new ColliderWorld();
    c.setBounds(r1);
    for (const w of PROMENADE_WALK) c.addBounds(w);
    for (const p of promenadeProps()) {
      if (p.kind === 'bench') c.addBox(foot(p), 'bench');
      else c.addCircle(p.x, p.z, p.kind === 'lamp' ? 0.18 : p.hx, p.kind);
    }
    const grid = new NavGrid(c.navSource(), PLAYER.radius);
    const path = grid.findPath({ x: -7.9, z: 16.8 }, { x: -3, z: 64 });
    expect(path).not.toBeNull();
    // along the walk, not much longer than the straight legs (nothing makes it weave)
    expect(path!.length).toBeLessThan(28 + 6 + 21 + 4);
  });
});

describe('snow that builds up', () => {
  it('lays a full layer over a minute or so of storm and sheds it over a few minutes after', () => {
    expect(SNOW_BUILD_S).toBeGreaterThanOrEqual(60);
    expect(SNOW_BUILD_S).toBeLessThanOrEqual(90);
    expect(SNOW_MELT_S).toBeGreaterThanOrEqual(180);
    expect(SNOW_MELT_S).toBeLessThanOrEqual(240);
    const s = new SnowLayer();
    expect(s.roofs).toBe(0);
    let last = 0;
    for (let t = 0; t < 30; t += 0.5) {
      s.step(0.5, true);
      expect(s.roofs).toBeGreaterThanOrEqual(last);
      last = s.roofs;
    }
    // eased: a slow start, well under half after 30 s
    expect(s.roofs).toBeGreaterThan(0.1);
    expect(s.roofs).toBeLessThan(0.5);
    for (let t = 0; t < 60; t += 0.5) s.step(0.5, true);
    expect(s.roofs).toBe(1);
    expect(s.fields).toBeGreaterThan(0.8);
    // a minute after the storm most of it still lies; four minutes after, it is gone
    for (let t = 0; t < 60; t += 0.5) s.step(0.5, false);
    expect(s.roofs).toBeGreaterThan(0.6);
    for (let t = 0; t < 180; t += 0.5) s.step(0.5, false);
    expect(s.roofs).toBe(0);
    expect(s.fields).toBe(0);
  });

  it('ignores bad steps', () => {
    const s = new SnowLayer();
    s.step(Number.NaN, true);
    s.step(-1, true);
    expect(s.level).toBe(0);
  });
});
