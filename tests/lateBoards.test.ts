/**
 * 0.9.8 (10c): the late eras' base boards (world/env/ground/era08..era10.ts on the eraGround hook). Each era builds
 * its own board in a handful of draw calls, keeps the hand node's patch and the resource beds clear, stands nothing
 * tall where it could hide a pad (tall trees only on the west and gate strips the camera looks toward), and never
 * paints near-black. The city side: districts 8..10 pave in their era's own floor colours and climb lighter.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { plotPlaces, regionLayout } from '../src/eras/layout';
import { GroundKit, eraGround, eraKeepOut, eraOwnsFloor } from '../src/world/env/eraGround';
import { Rng } from '../src/world/env/common';
import type { RegionLayout, PlotPlaces } from '../src/eras/layout';
import { nodePatch } from '../src/world/env/frontier';
import { lightness, palette } from '../src/render/palette';

const LATE = [8, 9, 10] as const;

/** Bake a module's wild / open dressing the way eraGround does (minus the night halos, which need a DOM canvas). */
function bake(n: number, part: 'wild' | 'open', l: RegionLayout = regionLayout(n), P: PlotPlaces = plotPlaces(n)): THREE.Group {
  const k = new GroundKit();
  const m = eraGround(n)!;
  if (part === 'wild') m.wild!(k, l, new Rng(7300 + n * 53));
  else m.open!(k, l, P, new Rng(7700 + n * 61));
  k.lamps.length = 0;
  return k.build(`t${n}`);
}
const buildEraWild = (n: number, l: RegionLayout): THREE.Group => bake(n, 'wild', l);
const buildEraOpen = (n: number, l: RegionLayout, P: PlotPlaces): THREE.Group => bake(n, 'open', l, P);

/** Every vertex (world position, colour) of every mesh in a group (the kit bakes world coordinates). */
function vertices(g: THREE.Object3D): { x: number; y: number; z: number; c: number }[] {
  const out: { x: number; y: number; z: number; c: number }[] = [];
  const col = new THREE.Color();
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return;
    const pos = o.geometry.getAttribute('position');
    const c = o.geometry.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      if (c) col.setRGB(c.getX(i), c.getY(i), c.getZ(i), THREE.LinearSRGBColorSpace);
      out.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i), c: c ? col.getHex() : 0xffffff });
    }
  });
  return out;
}

const meshes = (g: THREE.Object3D): number => {
  let n = 0;
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
};

describe('late-era base boards (eras 8-10)', () => {
  it('each era has its own module that draws its floor and dresses its wild ground', () => {
    for (const n of LATE) {
      expect(eraGround(n)?.wild, `era ${n}`).toBeTypeOf('function');
      expect(eraGround(n)?.open, `era ${n}`).toBeTypeOf('function');
      expect(eraOwnsFloor(n)).toBe(true);
    }
  });

  it('costs a handful of draw calls per region', () => {
    for (const n of LATE) {
      const l = regionLayout(n);
      const wild = buildEraWild(n, l)!;
      const open = buildEraOpen(n, l, plotPlaces(n))!;
      // floor, solids, glow (+ the night halos)
      expect(meshes(wild), `era ${n} wild`).toBeLessThanOrEqual(4);
      expect(meshes(open), `era ${n} open`).toBeLessThanOrEqual(4);
    }
  });

  it('stays inside the region, clear of the hand node and the resource beds', () => {
    for (const n of LATE) {
      const l = regionLayout(n);
      const P = plotPlaces(n);
      const node = nodePatch(l);
      const r = l.rect;
      const bad: string[] = [];
      for (const v of vertices(buildEraWild(n, l)!)) {
        if (!(v.x > r.minX && v.x < r.maxX && v.z > r.minZ && v.z < r.maxZ)) bad.push(`outside at ${v.x.toFixed(1)}, ${v.z.toFixed(1)}`);
        if (v.y <= 0.3) continue;
        if (v.x > node.minX + 0.2 && v.x < node.maxX - 0.2 && v.z > node.minZ + 0.2 && v.z < node.maxZ - 0.2) bad.push(`on the node patch at ${v.x.toFixed(1)}, ${v.z.toFixed(1)}`);
        if (v.x > P.field.minX + 0.2 && v.x < P.field.maxX - 0.2 && v.z > P.field.minZ + 0.2 && v.z < P.field.maxZ - 0.2) bad.push(`on the beds at ${v.x.toFixed(1)}, ${v.z.toFixed(1)}`);
      }
      expect(bad.slice(0, 5), `era ${n}`).toEqual([]);
    }
  });

  it('stands tall things only on the west and gate strips (or low in the harvest field), so nothing hides a pad', () => {
    for (const n of LATE) {
      const l = regionLayout(n);
      const H = l.zones.harvest;
      const r = l.rect;
      for (const g of [buildEraWild(n, l)!, buildEraOpen(n, l, plotPlaces(n))!]) {
        const bad: string[] = [];
        for (const v of vertices(g)) {
          if (v.y <= 2.0) continue;
          const edge = v.x < r.minX + 4 || v.z < r.minZ + 4;
          const field = v.x > H.minX && v.x < H.maxX && v.z > H.minZ && v.z < H.maxZ && v.y < 2.4;
          if (!edge && !field) bad.push(`${v.y.toFixed(2)} m tall at ${v.x.toFixed(1)}, ${v.z.toFixed(1)}`);
        }
        expect(bad.slice(0, 5), `era ${n}`).toEqual([]);
      }
    }
  });

  it('never paints near-black (DIRECTION: the darkest colour is a warm trim)', () => {
    for (const n of LATE) {
      const l = regionLayout(n);
      for (const g of [buildEraWild(n, l)!, buildEraOpen(n, l, plotPlaces(n))!]) {
        let darkest = 1;
        for (const v of vertices(g)) darkest = Math.min(darkest, lightness(v.c));
        expect(darkest, `era ${n}`).toBeGreaterThan(0.2);
      }
    }
  });

  it("keeps era 10's fusion halo clear of the random props", () => {
    const l = regionLayout(10);
    const [halo] = eraKeepOut(10, l);
    expect(halo).toBeDefined();
    expect(halo!.minX).toBeGreaterThan(l.zones.harvest.minX);
    expect(halo!.maxZ).toBeLessThan(l.zones.harvest.maxZ);
  });

  it('gives each late era its own board and a clear daylight (firm sun, low sky fill)', () => {
    const boards = LATE.map((n) => palette(n).floor.board);
    expect(new Set(boards).size).toBe(3);
    for (const n of LATE) {
      const d = palette(n).look.day;
      expect(d.sun).toBeGreaterThan(1.1);
      expect(d.hemi).toBeLessThan(0.72);
      expect(palette(n).look.grade.day.saturation).toBeGreaterThan(1.08);
    }
  });
});

describe('city climbs lighter era by era (10c)', () => {
  it('walls of districts 8-10 are the lightest, and no city trim is near-black', () => {
    const wall = (n: number): number => lightness(palette(n).city!.wall);
    for (const n of [8, 9, 10]) expect(wall(n)).toBeGreaterThan(Math.max(wall(2), wall(3), wall(4), wall(5), wall(7)));
    expect(wall(9)).toBeGreaterThan(wall(8));
    for (let n = 2; n <= 10; n++) {
      const c = palette(n).city!;
      for (const k of [c.wall, c.wall2, c.roof, c.trim]) expect(lightness(k), `era ${n}`).toBeGreaterThan(0.18);
    }
  });
});
