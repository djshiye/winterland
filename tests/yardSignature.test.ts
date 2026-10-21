/**
 * 0.9.13 (review E2) yard signatures (world/env/ground/yardSignature.ts): eras 6, 7 and 8 each get one structure in the
 * free floor of the yard band east of the shop mat (6 a deco power house and insulator pad, 7 a gas tank farm with a flare,
 * 8 a raised showroom deck with a dish and a kiosk). Pure layout guards on the real region layouts, plus the built
 * geometry's bounds: inside the free rect, off every machine cell, belt, link, path and facility, hides nothing from the camera.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Rect } from '../src/config';
import { CAMERA } from '../src/config';
import { REGIONS, machinesOfEra, MACHINES } from '../src/eras/data';
import { beltRoutes } from '../src/eras/belts';
import { regionLayout, type RegionLayout } from '../src/eras/layout';
import { planYardLinks } from '../src/eras/linkPlan';
import { LEVEL_PAD_SIZE, MACHINE_NOMINAL, levelPadLocal, machineFrame, toWorld, worldRect } from '../src/eras/rules';
import { eraKeepOut, GroundKit } from '../src/world/env/eraGround';
import { regionPaths } from '../src/world/env/frontier';
import { Rng } from '../src/world/env/common';
import { sightKeep } from '../src/world/env/ground/kit4to7';
import { buildYardSignature, yardSignatureFree, yardSignatureRects, yardSignatureSolids } from '../src/world/env/ground/yardSignature';

const EPS = 1e-6;
const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;
const inside = (a: Rect, outer: Rect, m = 0): boolean => a.minX >= outer.minX - m - EPS && a.maxX <= outer.maxX + m + EPS && a.minZ >= outer.minZ - m - EPS && a.maxZ <= outer.maxZ + m + EPS;
const box = (x: number, z: number, hx: number, hz = hx): Rect => ({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });

/** The ground a solid of height h hides from the isometric camera: its footprint swept toward −X/−Z. */
function shadow(r: Rect, h: number): Rect {
  const reach = h / Math.tan((CAMERA.pitchDeg * Math.PI) / 180) / Math.SQRT2;
  return { minX: r.minX - reach, maxX: r.maxX, minZ: r.minZ - reach, maxZ: r.maxZ };
}

const distToRect = (x: number, z: number, r: Rect): number => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
function distRectToPath(r: Rect, pts: readonly { x: number; z: number }[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
    for (let k = 0; k <= steps; k++) best = Math.min(best, distToRect(a.x + ((b.x - a.x) * k) / steps, a.z + ((b.z - a.z) * k) / steps, r));
  }
  return best;
}

/** Everything of a full-room region the player works in: pads, feed / take / MANAGE zones, bodies, facilities, the hand node. */
function claimed(L: RegionLayout, n: number): { what: string; r: Rect }[] {
  const out: { what: string; r: Rect }[] = [];
  const def = REGIONS[n]!;
  const saved = def.slots;
  (def as { slots: number }).slots = Math.max(def.slots, def.room);
  try {
    const full = regionLayout(n);
    const f = machineFrame(MACHINE_NOMINAL.w, MACHINE_NOMINAL.d);
    const lp = levelPadLocal(MACHINE_NOMINAL.w, MACHINE_NOMINAL.d);
    full.slots.forEach((s, i) => {
      const p = toWorld(s, s.yaw, lp.u, lp.v);
      out.push({ what: `slot ${i} level pad`, r: box(p.x, p.z, LEVEL_PAD_SIZE / 2) });
      out.push({ what: `slot ${i} build tile`, r: box(s.x, s.z, L.padSize / 2) });
      for (const k of ['body', 'feed', 'take', 'manage'] as const) out.push({ what: `slot ${i} ${k}`, r: worldRect(s, s.yaw, f[k]) });
    });
  } finally {
    (def as { slots: number }).slots = saved;
  }
  for (const k of ['depot', 'dock', 'jack', 'shopMat', 'cashSpot'] as const) out.push({ what: k, r: box(L[k].x, L[k].z, 1.6) });
  return out;
}

describe('0.9.13 yard signatures (eras 6-8)', () => {
  it('only eras 6, 7 and 8 have one', () => {
    for (let n = 2; n <= 10; n++) {
      const L = regionLayout(n);
      const has = n >= 6 && n <= 8;
      expect(yardSignatureRects(L).length > 0, `era ${n}`).toBe(has);
      expect(yardSignatureSolids(L).length > 0, `era ${n} solids`).toBe(has);
    }
  });

  for (const n of [6, 7, 8]) {
    const L = regionLayout(n);
    const rects = yardSignatureRects(L);
    const solids = yardSignatureSolids(L);
    const F = yardSignatureFree(L);

    it(`era ${n}: the free rect is east of the shop mat, west of the split path and 2.7-6.4 m in from the gate`, () => {
      expect(F.minX).toBeCloseTo(L.shopMat.x + 3, 6);
      expect(F.maxX).toBeCloseTo(L.zones.yard.maxX - 1.7, 6);
      const depths = [F.minZ, F.maxZ].map((z) => (z - L.gate.z) * L.inward).sort((a, b) => a - b);
      expect(depths[0]).toBeCloseTo(2.7, 6);
      expect(depths[1]).toBeCloseTo(6.4, 6);
    });

    it(`era ${n}: the footprints sit in the free rect, apart from each other, and are the era's keep-outs`, () => {
      expect(rects.length).toBeGreaterThanOrEqual(2);
      for (const r of rects) expect(inside(r, F), JSON.stringify(r)).toBe(true);
      rects.forEach((r, i) => rects.forEach((q, j) => i < j && expect(overlap(r, q), `rects ${i}/${j}`).toBe(false)));
      for (const s of solids) expect(rects.some((r) => inside(s.r, r)), s.what).toBe(true);
      const keep = eraKeepOut(n, L);
      for (const r of rects) expect(keep.some((q) => q.minX === r.minX && q.maxX === r.maxX && q.minZ === r.minZ && q.maxZ === r.maxZ)).toBe(true);
    });

    it(`era ${n}: off every machine cell, pad, MANAGE zone, facility, path, belt and yard link`, () => {
      const things = claimed(L, n);
      const paths = regionPaths(L);
      for (const r of rects) {
        for (const t of things) expect(overlap(r, t.r), `${t.what} under the signature`).toBe(false);
        for (const q of paths) expect(overlap(r, q), 'on a path').toBe(false);
      }
      // every belt route a full region could run (any producer to any consumer), kept 0.6 m off (rollers are 0.6 wide)
      const slots = L.slots.length;
      for (let a = 0; a < slots; a++) {
        for (let b = 0; b < slots; b++) {
          if (a === b) continue;
          for (const route of beltRoutes(L, a, b)) for (const r of rects) expect(distRectToPath(r, route), `belt ${a}>${b}`).toBeGreaterThan(0.6);
        }
      }
      // the overhead links: their ground plan stays off the footprints too
      const list = machinesOfEra(n);
      const machines = L.slots.map((_, i) => {
        const def = MACHINES[list[i % list.length]!];
        return { inputs: def.inputs, output: def.output, w: MACHINE_NOMINAL.w, d: MACHINE_NOMINAL.d };
      });
      const plan = planYardLinks(L, machines);
      for (const link of plan.links) for (const r of rects) expect(distRectToPath(r, link.path), 'yard link').toBeGreaterThan(0.3);
      for (const k of plan.risers) for (const r of rects) expect(overlap(r, box(k.x, k.z, 0.3)), 'riser').toBe(false);
    });

    it(`era ${n}: nothing hides a pad, counter, Jack or the hand node from the camera`, () => {
      const things = claimed(L, n);
      for (const s of solids) {
        for (const q of sightKeep(L, s.h)) expect(overlap(s.r, q), `${s.what} (${s.h} m) stands in the sight keep`).toBe(false);
        const sh = shadow(s.r, s.h);
        for (const t of things) {
          if (t.what.endsWith('body')) continue;
          expect(overlap(sh, t.r), `${s.what} shades ${t.what}`).toBe(false);
        }
      }
    });

    it(`era ${n}: the built geometry stays inside the free rect and costs no draw call of its own`, () => {
      const kit = new GroundKit();
      buildYardSignature(kit, L, new Rng(1));
      expect(kit.solid.empty).toBe(false);
      expect(kit.glow.empty).toBe(false);
      for (const [name, b] of [['solid', kit.solid], ['glow', kit.glow], ['floor', kit.floor]] as const) {
        if (b.empty) continue;
        const g = b.geometry();
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        expect(bb.min.x, `${name} minX`).toBeGreaterThanOrEqual(F.minX - 1e-3);
        expect(bb.max.x, `${name} maxX`).toBeLessThanOrEqual(F.maxX + 1e-3);
        expect(bb.min.z, `${name} minZ`).toBeGreaterThanOrEqual(F.minZ - 1e-3);
        expect(bb.max.z, `${name} maxZ`).toBeLessThanOrEqual(F.maxZ + 1e-3);
        expect(bb.min.y, `${name} minY`).toBeGreaterThanOrEqual(-1e-3);
        g.dispose();
      }
      // no meshes of its own except era 7's single flame
      expect(kit.extra.length).toBe(n === 7 ? 1 : 0);
      for (const o of kit.extra) expect((o as THREE.Mesh).isMesh).toBe(true);
      expect(kit.lamps.length).toBeGreaterThan(0);
      for (const p of kit.lamps) expect(rects.some((r) => p.x >= r.minX - 1 && p.x <= r.maxX + 1 && p.z >= r.minZ - 1 && p.z <= r.maxZ + 1)).toBe(true);
    });
  }

  it('the other eras build nothing', () => {
    for (const n of [2, 5, 9, 10]) {
      const kit = new GroundKit();
      buildYardSignature(kit, regionLayout(n), new Rng(1));
      expect(kit.solid.empty && kit.glow.empty && kit.floor.empty && kit.extra.length === 0 && kit.lamps.length === 0).toBe(true);
    }
  });
});
