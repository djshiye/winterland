/**
 * 0.9.9 MANAGE boards: the board's post stands just outside its manage tile, on the side facing its building
 * (manageSignFoot), and the ground the upright board hides from the camera (manageBoardShadow) never covers a pad, feed /
 * take zone, counter or another manage tile the player has to see. Checked for every era 2..10 machine slot (slots at
 * full room), every city lot, and every Market Town lot; the post never stands in the building body or on a manage tile.
 */
import { describe, expect, it } from 'vitest';
import { AMENITY_IDS, LAYOUT, type Rect } from '../src/config';
import { districtLots } from '../src/city/rules';
import { REGIONS } from '../src/eras/data';
import { regionLayout, type RegionLayout } from '../src/eras/layout';
import { marketPlaces, DOCK_BODY, STALL_BODY } from '../src/eras/market';
import { LEVEL_PAD_SIZE, levelPadLocal, MACHINE_NOMINAL, machineFrame, toWorld, worldRect } from '../src/eras/rules';
import { MANAGE_POST_GAP, manageBoardShadow, manageSignFoot } from '../src/fx/manageSign';
import { amenityFrame, grandMarketFrame, lotFrame, manageRect } from '../src/town/rules';
import { nodePatch } from '../src/world/env/frontier';

type Pt = { x: number; z: number };
const EPS = 1e-6;
const ERA_NS = REGIONS.filter((r) => r !== null).map((r) => r!.n);
const box = (x: number, z: number, hx: number, hz = hx): Rect => ({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });
const inRect = (r: Rect, p: Pt): boolean => p.x > r.minX + EPS && p.x < r.maxX - EPS && p.z > r.minZ + EPS && p.z < r.maxZ - EPS;

/** Convex polygon vs axis-aligned rect, separating-axis test; touching (within EPS) is not an overlap. */
function polyHitsRect(poly: Pt[], r: Rect): boolean {
  const rc: Pt[] = [{ x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ }, { x: r.maxX, z: r.maxZ }, { x: r.minX, z: r.maxZ }];
  const axes: Pt[] = [{ x: 1, z: 0 }, { x: 0, z: 1 }];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    axes.push({ x: -(b.z - a.z) / len, z: (b.x - a.x) / len });
  }
  for (const ax of axes) {
    const pr = (pts: Pt[]): [number, number] => {
      const v = pts.map((p) => p.x * ax.x + p.z * ax.z);
      return [Math.min(...v), Math.max(...v)];
    };
    const [a0, a1] = pr(poly);
    const [b0, b1] = pr(rc);
    if (a1 <= b0 + EPS || b1 <= a0 + EPS) return false;
  }
  return true;
}

describe('manageSignFoot', () => {
  const zone: Rect = { minX: 10, maxX: 12, minZ: 20, maxZ: 22 }; // 2x2, centre (11, 21)
  it('stands just outside the edge facing the building, centred on the other axis', () => {
    expect(manageSignFoot(zone, { x: 11, z: 14 })).toEqual({ x: 11, z: 20 - MANAGE_POST_GAP }); // building north (-Z)
    expect(manageSignFoot(zone, { x: 11, z: 28 })).toEqual({ x: 11, z: 22 + MANAGE_POST_GAP }); // south (+Z)
    expect(manageSignFoot(zone, { x: 18, z: 21 })).toEqual({ x: 12 + MANAGE_POST_GAP, z: 21 }); // east (+X)
    expect(manageSignFoot(zone, { x: 4, z: 21 })).toEqual({ x: 10 - MANAGE_POST_GAP, z: 21 }); // west (-X)
  });
});

describe('manageBoardShadow', () => {
  it('is a quad on the far side of the foot from the camera (+X/+Z)', () => {
    const foot = { x: 3, z: -7 };
    const q = manageBoardShadow(foot);
    expect(q.length).toBe(4);
    for (const p of q) expect(p.x + p.z, 'toward the camera').toBeLessThan(foot.x + foot.z);
  });
});

/** Everything of a region the player has to see, per slot, with slots at full room; plus the market's pads and counters. */
function regionItems(L: RegionLayout, n: number): { slots: { place: Pt & { yaw: number }; manage: Rect; body: Rect; items: { what: string; r: Rect }[] }[]; market: { what: string; r: Rect }[] } {
  const def = REGIONS[n]!;
  const saved = def.slots;
  (def as { slots: number }).slots = Math.max(def.slots, def.room);
  try {
    const f = machineFrame(MACHINE_NOMINAL.w, MACHINE_NOMINAL.d);
    const slots = regionLayout(n).slots.map((s, i) => {
      const l = levelPadLocal(MACHINE_NOMINAL.w, MACHINE_NOMINAL.d);
      const p = toWorld(s, s.yaw, l.u, l.v);
      return {
        place: s,
        manage: worldRect(s, s.yaw, f.manage),
        body: worldRect(s, s.yaw, f.body),
        items: [
          { what: `slot ${i} level pad`, r: box(p.x, p.z, LEVEL_PAD_SIZE / 2) },
          { what: `slot ${i} build tile`, r: box(s.x, s.z, L.padSize / 2) },
          { what: `slot ${i} feed`, r: worldRect(s, s.yaw, f.feed) },
          { what: `slot ${i} take`, r: worldRect(s, s.yaw, f.take) },
        ],
      };
    });
    const P = marketPlaces(L);
    const market = [
      { what: 'vault pad', r: box(P.vaultPad.x, P.vaultPad.z, LEVEL_PAD_SIZE / 2) },
      { what: 'cash pile', r: box(P.cash.x, P.cash.z, 1) },
      { what: 'vault', r: box(P.vault.x, P.vault.z, 1.1, 1) },
      { what: 'dock counter', r: worldRect(P.dock, P.yaw, DOCK_BODY) },
      { what: 'stall counter', r: worldRect(P.stall, P.yaw, STALL_BODY) },
      { what: 'shopper queue', r: { minX: P.front.x - 9, maxX: P.front.x + 0.6, minZ: P.front.z - 0.6, maxZ: P.front.z + 0.6 } },
      { what: 'hand node', r: nodePatch(L) },
      ...(['depot', 'dock', 'jack', 'shopMat', 'cashSpot'] as const).map((k) => ({ what: k, r: box(L[k].x, L[k].z, 1.6) })),
    ];
    return { slots, market };
  } finally {
    (def as { slots: number }).slots = saved;
  }
}

describe('era machine MANAGE boards', () => {
  for (const n of ERA_NS) {
    it(`era ${n}: no board hides a pad, zone, counter or other manage tile; the post is clear of body and tiles`, () => {
      const R = regionItems(regionLayout(n), n);
      expect(R.slots.length).toBeGreaterThan(0);
      R.slots.forEach((s, i) => {
        const foot = manageSignFoot(s.manage, s.place);
        const shadow = manageBoardShadow(foot);
        expect(inRect(s.body, foot), `slot ${i} post in the body`).toBe(false);
        R.slots.forEach((o, j) => expect(inRect(o.manage, foot), `slot ${i} post on slot ${j} manage tile`).toBe(false));
        // a slot's own build tile is the machine itself once it stands (and a board exists only then), so it is skipped
        R.slots.forEach((o, j) => {
          for (const m of o.items) if (!(j === i && m.what.endsWith('build tile'))) expect(polyHitsRect(shadow, m.r), `slot ${i} board hides ${m.what}`).toBe(false);
        });
        R.slots.forEach((o, j) => {
          if (j !== i) expect(polyHitsRect(shadow, o.manage), `slot ${i} board hides slot ${j} manage tile`).toBe(false);
        });
        for (const m of R.market) expect(polyHitsRect(shadow, m.r), `slot ${i} board hides ${m.what}`).toBe(false);
      });
    });
  }
});

describe('city district MANAGE boards', () => {
  for (const n of ERA_NS) {
    it(`era ${n}: no board hides another lot's pad; the post is clear of its building and every pad tile`, () => {
      const lots = districtLots(n);
      for (const L of lots) {
        const foot = manageSignFoot(L.zone, L);
        const shadow = manageBoardShadow(foot);
        expect(inRect(L.rect, foot), `lot ${L.index} post in the building`).toBe(false);
        for (const O of lots) {
          expect(inRect(O.zone, foot), `lot ${L.index} post on lot ${O.index} pad`).toBe(false);
          if (O.index !== L.index) expect(polyHitsRect(shadow, O.zone), `lot ${L.index} board hides lot ${O.index} pad`).toBe(false);
        }
      }
    });
  }
});

describe('Market Town MANAGE boards', () => {
  const T = LAYOUT.town;
  // pads the player must see: every lot's build / business pad (lot centre + face x padOffset, padSize), each amenity's
  // pad tile, and the Grand Market's pad tile
  const lotPad = (i: number): Rect => {
    const l = T.lots[i]!;
    return box(l.x + l.face.x * T.padOffset, l.z + l.face.z * T.padOffset, T.padSize / 2);
  };
  const pads = (): { what: string; r: Rect }[] => [
    ...T.lots.map((_, i) => ({ what: `lot ${i} pad`, r: lotPad(i) })),
    ...AMENITY_IDS.map((id) => ({ what: `amenity ${id} pad`, r: amenityFrame(id).padRect })),
    { what: 'grand market pad', r: grandMarketFrame().padRect },
  ];
  it('no board hides another lot pad, an amenity pad or the grand market pad; the post is clear of its lot', () => {
    for (let i = 0; i < T.lots.length; i++) {
      const zone = manageRect(i);
      const foot = manageSignFoot(zone, lotFrame(i));
      const shadow = manageBoardShadow(foot);
      for (let j = 0; j < T.lots.length; j++) expect(inRect(manageRect(j), foot), `lot ${i} post on lot ${j} manage tile`).toBe(false);
      for (const p of pads()) {
        if (p.what === `lot ${i} pad`) continue;
        expect(polyHitsRect(shadow, p.r), `lot ${i} board hides ${p.what}`).toBe(false);
      }
    }
  });
});
