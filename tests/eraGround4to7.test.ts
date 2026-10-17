/**
 * 0.9.8 world eras 4..7 (brief 10b): each era's landmark set pieces (steam siding, coke battery, coil tower, flare stack)
 * and its lamp poles stand inside the region, off the paths and the plots, and nothing tall hides a pad, counter or
 * pile from the camera (R22). Keep-outs stay inside the region so frontier props only lose ground they could use.
 */
import { describe, expect, it } from 'vitest';
import type { Rect } from '../src/config';
import { CAMERA } from '../src/config';
import { REGIONS } from '../src/eras/data';
import { plotPlaces, regionLayout, type RegionLayout } from '../src/eras/layout';
import { marketPlaces, DOCK_BODY, STALL_BODY } from '../src/eras/market';
import { LEVEL_PAD_SIZE, levelPadLocal, MACHINE_NOMINAL, machineFrame, toWorld, worldRect } from '../src/eras/rules';
import { nodePatch, regionPaths } from '../src/world/env/frontier';
import { hutFootprint } from '../src/world/env/plots';
import { era04, era04Solids } from '../src/world/env/ground/era04';
import { era05, era05Solids } from '../src/world/env/ground/era05';
import { era06, era06Solids } from '../src/world/env/ground/era06';
import { era07, era07Solids } from '../src/world/env/ground/era07';

const EPS = 1e-6;
const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;
const inside = (a: Rect, outer: Rect): boolean => a.minX >= outer.minX - EPS && a.maxX <= outer.maxX + EPS && a.minZ >= outer.minZ - EPS && a.maxZ <= outer.maxZ + EPS;
const box = (x: number, z: number, hx: number, hz = hx): Rect => ({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });

/** The ground a solid of height h hides from the isometric camera (which sits toward +X/+Z): its footprint swept toward −X/−Z. */
function shadow(r: Rect, h: number): Rect {
  const reach = h / Math.tan((CAMERA.pitchDeg * Math.PI) / 180) / Math.SQRT2;
  return { minX: r.minX - reach, maxX: r.maxX, minZ: r.minZ - reach, maxZ: r.maxZ };
}

/** Every pad, counter and pile of a region the player has to see and reach (slots at full room, so later slots count). */
function mustSee(L: RegionLayout, n: number): { what: string; r: Rect }[] {
  const out: { what: string; r: Rect }[] = [];
  const def = REGIONS[n]!;
  const saved = def.slots;
  (def as { slots: number }).slots = Math.max(def.slots, def.room);
  try {
    const full = regionLayout(n);
    full.slots.forEach((s, i) => {
      const l = levelPadLocal(MACHINE_NOMINAL.w, MACHINE_NOMINAL.d);
      const p = toWorld(s, s.yaw, l.u, l.v);
      out.push({ what: `slot ${i} level pad`, r: box(p.x, p.z, LEVEL_PAD_SIZE / 2) });
      out.push({ what: `slot ${i} build tile`, r: box(s.x, s.z, L.padSize / 2) });
      const f = machineFrame(MACHINE_NOMINAL.w, MACHINE_NOMINAL.d);
      out.push({ what: `slot ${i} feed`, r: worldRect(s, s.yaw, f.feed) });
      out.push({ what: `slot ${i} take`, r: worldRect(s, s.yaw, f.take) });
    });
  } finally {
    (def as { slots: number }).slots = saved;
  }
  const P = marketPlaces(L);
  out.push({ what: 'vault pad', r: box(P.vaultPad.x, P.vaultPad.z, LEVEL_PAD_SIZE / 2) });
  out.push({ what: 'cash pile', r: box(P.cash.x, P.cash.z, 1) });
  out.push({ what: 'vault', r: box(P.vault.x, P.vault.z, 1.1, 1) });
  out.push({ what: 'dock counter', r: worldRect(P.dock, P.yaw, DOCK_BODY) });
  out.push({ what: 'stall counter', r: worldRect(P.stall, P.yaw, STALL_BODY) });
  out.push({ what: 'shopper queue', r: { minX: P.front.x - 9, maxX: P.front.x + 0.6, minZ: P.front.z - 0.6, maxZ: P.front.z + 0.6 } });
  out.push({ what: 'hand node', r: nodePatch(L) });
  for (const k of ['depot', 'dock', 'jack', 'shopMat', 'cashSpot'] as const) out.push({ what: k, r: box(L[k].x, L[k].z, 1.6) });
  return out;
}

const ERAS = [
  { n: 4, mod: era04, solids: era04Solids },
  { n: 5, mod: era05, solids: era05Solids },
  { n: 6, mod: era06, solids: era06Solids },
  { n: 7, mod: era07, solids: era07Solids },
];

describe('0.9.8 world eras 4..7 ground set pieces', () => {
  for (const { n, mod, solids } of ERAS) {
    const L = regionLayout(n);
    const P = plotPlaces(n);
    const S = solids(L);

    it(`era ${n}: registers wild, open, keep-outs and its own props`, () => {
      expect(typeof mod.wild).toBe('function');
      expect(typeof mod.open).toBe('function');
      expect(mod.props?.tall && mod.props.mid && mod.props.low).toBeTruthy();
      expect(S.length).toBeGreaterThan(0);
    });

    it(`era ${n}: set pieces stand inside the region, off the paths, beds and huts`, () => {
      const paths = regionPaths(L);
      for (const s of S) {
        expect(inside(s.r, L.rect), `${s.what} inside`).toBe(true);
        for (const q of paths) expect(overlap(s.r, q), `${s.what} on a path`).toBe(false);
        for (const b of P.beds) expect(overlap(s.r, b), `${s.what} on a bed`).toBe(false);
        for (const h of P.huts) expect(overlap(s.r, hutFootprint(h, true)), `${s.what} on hut ${h.role}`).toBe(false);
      }
    });

    it(`era ${n}: nothing tall hides a pad, counter or pile from the camera (R22)`, () => {
      const see = mustSee(L, n);
      for (const s of S) for (const m of see) expect(overlap(shadow(s.r, s.h), m.r), `${s.what} hides ${m.what}`).toBe(false);
    });

    it(`era ${n}: keep-outs lie inside the region`, () => {
      for (const r of mod.keepOut!(L)) expect(inside(r, L.rect)).toBe(true);
    });
  }
});
