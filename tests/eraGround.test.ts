/**
 * 0.9.8 world (10a): each era's own base board (world/env/eraGround.ts + ground/eraNN.ts) and its daylight.
 * - Every era's board, yard and processing floor are its own (no two eras share the pale snow look by day, Validator
 *   note on PR #45), and the daylight keeps a firm sun over a weaker sky fill.
 * - The dressing an era module adds never covers a pad, counter, pile, facility or the hand node, in plan or in the
 *   camera's view (tall trees and lanterns hide the ground toward −X/−Z).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA, type Rect } from '../src/config';
import { REGIONS } from '../src/eras/data';
import { plotPlaces, regionLayout, type RegionLayout } from '../src/eras/layout';
import { marketPlaces, DOCK_BODY, STALL_BODY } from '../src/eras/market';
import { LEVEL_PAD_SIZE, levelPadLocal, MACHINE_NOMINAL, machineFrame, toWorld, worldRect } from '../src/eras/rules';
import { lightness, palette, SNOW } from '../src/render/palette';
import { eraGround, eraOwnsFloor, GroundKit } from '../src/world/env/eraGround';
import { nodePatch } from '../src/world/env/frontier';
import { Rng } from '../src/world/env/common';

const dist = (a: number, b: number): number => Math.max(...[16, 8, 0].map((s) => Math.abs(((a >> s) & 0xff) - ((b >> s) & 0xff))));
const box = (x: number, z: number, hx: number, hz = hx): Rect => ({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });
const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
/** The ground a solid of height h hides from the isometric camera: its footprint swept toward −X/−Z. */
function shadow(r: Rect, h: number): Rect {
  const reach = h / Math.tan((CAMERA.pitchDeg * Math.PI) / 180) / Math.SQRT2;
  return { minX: r.minX - reach, maxX: r.maxX, minZ: r.minZ - reach, maxZ: r.maxZ };
}

/** Pads, counters, piles and facilities the player must see and reach (slots at full room). */
function mustSee(n: number): { what: string; r: Rect }[] {
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
      out.push({ what: `slot ${i} build tile`, r: box(s.x, s.z, full.padSize / 2) });
      const f = machineFrame(MACHINE_NOMINAL.w, MACHINE_NOMINAL.d);
      out.push({ what: `slot ${i} feed`, r: worldRect(s, s.yaw, f.feed) });
      out.push({ what: `slot ${i} take`, r: worldRect(s, s.yaw, f.take) });
    });
  } finally {
    (def as { slots: number }).slots = saved;
  }
  const L = regionLayout(n);
  const P = marketPlaces(L);
  out.push({ what: 'vault pad', r: box(P.vaultPad.x, P.vaultPad.z, LEVEL_PAD_SIZE / 2) });
  out.push({ what: 'cash pile', r: box(P.cash.x, P.cash.z, 1) });
  out.push({ what: 'dock counter', r: worldRect(P.dock, P.yaw, DOCK_BODY) });
  out.push({ what: 'stall counter', r: worldRect(P.stall, P.yaw, STALL_BODY) });
  out.push({ what: 'hand node', r: nodePatch(L) });
  out.push({ what: 'expansion pad', r: box(L.expansionPad.x, L.expansionPad.z, L.padSize / 2) });
  for (const k of ['depot', 'dock', 'jack', 'shopMat', 'cashSpot'] as const) out.push({ what: k, r: box(L[k].x, L[k].z, 1.6) });
  return out;
}

/** Every instanced piece of a built group: footprint rect and height (from the geometry's bounds × the instance scale). */
function pieces(g: THREE.Object3D): { what: string; r: Rect; h: number }[] {
  const out: { what: string; r: Rect; h: number }[] = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  g.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh) return;
    im.geometry.computeBoundingBox();
    const bb = im.geometry.boundingBox!;
    const rad = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      m.decompose(p, q, s);
      out.push({ what: im.name, r: box(p.x, p.z, rad * Math.max(s.x, s.z)), h: bb.max.y * s.y });
    }
  });
  return out;
}

/**
 * Every part a module added to its solid and glow batches (the late eras build their props as merged batches, not
 * instances): footprint and height. Flat parts (top under 6 cm: floor inlays, walk studs) are paving and may sit
 * under a pad, so they are left out; the floor batch is paving by definition.
 */
function batchPieces(k: GroundKit, tag: string): { what: string; r: Rect; h: number }[] {
  const out: { what: string; r: Rect; h: number }[] = [];
  for (const [name, b] of [['solid', k.solid], ['glow', k.glow]] as const) {
    for (const bb of b.bounds()) {
      if (bb.max.y < 0.06) continue;
      const at = `${((bb.min.x + bb.max.x) / 2).toFixed(1)},${((bb.min.z + bb.max.z) / 2).toFixed(1)}`;
      out.push({ what: `${tag}:${name} part at ${at}`, r: { minX: bb.min.x, maxX: bb.max.x, minZ: bb.min.z, maxZ: bb.max.z }, h: bb.max.y });
    }
  }
  return out;
}

const MODULE_ERAS = [2, 3, 4, 5, 6, 7, 8, 9, 10].filter((n) => eraGround(n));

describe('era base boards (0.9.8 world)', () => {
  it('eras 1-3 each stand on their own board, yard and processing floor', () => {
    for (const a of [1, 2, 3]) {
      for (const b of [1, 2, 3]) {
        if (a >= b) continue;
        expect(dist(palette(a).floor.board, palette(b).floor.board), `boards ${a}/${b}`).toBeGreaterThan(24);
        expect(dist(palette(a).floor.yard, palette(b).floor.yard), `yards ${a}/${b}`).toBeGreaterThan(24);
      }
      // the board reads against the snow by day: clearly darker and warmer than it
      expect(lightness(SNOW) - lightness(palette(a).floor.board), `era ${a} board vs snow`).toBeGreaterThan(0.12);
    }
  });

  it('daylight: a firm sun over a weaker sky fill (readable shadows), every era', () => {
    for (let n = 1; n <= 10; n++) {
      const d = palette(n).look.day;
      expect(d.sun).toBeGreaterThanOrEqual(1);
      expect(d.hemi).toBeLessThanOrEqual(0.9);
      expect(d.hemi).toBeGreaterThan(0.5);
    }
  });

  it('eras 1-3 have their modules; a module with floors replaces the plain paving', () => {
    for (const n of [2, 3]) {
      expect(eraGround(n)?.wild).toBeTypeOf('function');
      expect(eraGround(n)?.open).toBeTypeOf('function');
      expect(eraOwnsFloor(n)).toBe(true);
    }
  });

  for (const n of MODULE_ERAS) {
    it(`era ${n}: the dressing stays inside the plot, off every pad, counter and the hand node, and hides none of them`, () => {
      const L: RegionLayout = regionLayout(n);
      const see = mustSee(n);
      // built as buildEraWild / buildEraOpen do, minus the night halos (they need a canvas)
      const kw = new GroundKit();
      eraGround(n)!.wild?.(kw, L, new Rng(1));
      const k = new GroundKit();
      eraGround(n)!.open?.(k, L, plotPlaces(n), new Rng(1));
      const lamps = [...kw.lamps, ...k.lamps];
      kw.lamps.length = 0;
      k.lamps.length = 0;
      const parts = [...batchPieces(kw, 'w'), ...batchPieces(k, 'o')];
      const all = [...parts, ...pieces(kw.build('w')), ...pieces(k.build('o'))];
      expect(all.length).toBeGreaterThan(0);
      for (const piece of all) {
        for (const s of see) {
          expect(overlap(piece.r, s.r), `${piece.what} on ${s.what}`).toBe(false);
          if (piece.h > 0.6) expect(overlap(shadow(piece.r, piece.h), s.r), `${piece.what} (h ${piece.h.toFixed(1)}) hides ${s.what}`).toBe(false);
        }
      }
      // lanterns: off every pad and counter, and their 2 m posts hide none of them
      for (const lamp of lamps) {
        const r = box(lamp.x, lamp.z, 0.35);
        for (const s of see) expect(overlap(shadow(r, 2.2), s.r), `lantern at ${lamp.x.toFixed(1)},${lamp.z.toFixed(1)} vs ${s.what}`).toBe(false);
      }
    });
  }
});
