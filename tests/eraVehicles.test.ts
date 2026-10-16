/**
 * 0.9.7: every era (2..10) has its own buyer vehicle (assets/eraVehicles.ts) and its own cash machine model in the
 * region market (assets/eraCash.ts). The vehicles keep the pickup's contract (faces −X, bed centre at TRUCK_BED_X so the
 * cargo lines up with the dock counter, wheels, driver seat, bubble) and fit the queue spacing; the cash models fit the
 * market's vault spot without hiding the level pad.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TRADE_POST, eraCashMachine } from '../src/config';
import { CASH_FIT, createEraCashModel } from '../src/assets/eraCash';
import { ERA_VEHICLE_KINDS, createEraVehicle, createEraVehicleWithDriver } from '../src/assets/eraVehicles';
import { TRUCK_BED_X } from '../src/assets/vehicles';
import { MAX_ERA } from '../src/eras/data';
import { regionLayout } from '../src/eras/layout';
import { DOCK_BODY, STALL_BODY, STALL_GIVE, marketPlaces } from '../src/eras/market';
import { worldRect } from '../src/eras/rules';

type R = { minX: number; maxX: number; minZ: number; maxZ: number };
const overlap = (a: R, b: R): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const within = (a: R, r: R): boolean => a.minX >= r.minX && a.maxX <= r.maxX && a.minZ >= r.minZ && a.maxZ <= r.maxZ;
const around = (p: { x: number; z: number }, half: number): R => ({ minX: p.x - half, maxX: p.x + half, minZ: p.z - half, maxZ: p.z + half });

function bounds(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
}

function isUnder(o: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let p = o.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

const ERA_NS = Array.from({ length: MAX_ERA - 1 }, (_, i) => i + 2);

describe('era buyer vehicles', () => {
  it('every era 2..10 has its own kind of vehicle', () => {
    const names = new Set<string>();
    const bodies = new Set<THREE.BufferGeometry>();
    for (const n of ERA_NS) {
      const m = createEraVehicle(n);
      expect(m.era).toBe(n);
      expect(m.root.name).toBe(`eraVehicle:${ERA_VEHICLE_KINDS[n]}`);
      names.add(m.root.name);
      const body = m.body.children.find((c) => (c as THREE.Mesh).isMesh && c.name.endsWith('Body')) as THREE.Mesh;
      bodies.add(body.geometry);
    }
    expect(names.size).toBe(ERA_NS.length);
    expect(bodies.size).toBe(ERA_NS.length);
  });

  for (const n of ERA_NS) {
    describe(`era ${n}: ${ERA_VEHICLE_KINDS[n]}`, () => {
      const { model: m, rig } = createEraVehicleWithDriver(n, undefined, 1);

      it('keeps the pickup contract: wheels, body, bed pivot at TRUCK_BED_X, driver seat, bubble', () => {
        expect(TRUCK_BED_X).toBeCloseTo(1.09, 5);
        expect(m.wheels.length).toBeGreaterThanOrEqual(2);
        for (const w of m.wheels) {
          expect(w).toBeInstanceOf(THREE.Object3D);
          expect(isUnder(w, m.root)).toBe(true);
          expect(isUnder(w, m.body)).toBe(false); // wheels do not bounce with the body
        }
        expect(m.wheelRadius).toBeGreaterThan(0);
        expect(m.root.children).toContain(m.body);
        expect(m.bedPivot.parent).toBe(m.body);
        expect(m.bedPivot.position.x).toBeCloseTo(TRUCK_BED_X, 1);
        expect(Math.abs(m.bedPivot.position.x - TRUCK_BED_X)).toBeLessThan(0.05);
        expect(m.bedPivot.position.z).toBe(0);
        expect(m.driverSeat.parent).toBe(m.body);
        expect(rig.root.parent).toBe(m.driverSeat);
        expect(m.bubbleY).toBeGreaterThan(0);
      });

      it('the bed pivot sits on the body, the bubble floats above it all, and it faces −X', () => {
        const bodyBox = bounds(m.body);
        const bed = m.bedPivot.getWorldPosition(new THREE.Vector3());
        expect(bodyBox.containsPoint(bed)).toBe(true);
        expect(bed.y).toBeGreaterThan(0.4);
        expect(bed.y).toBeLessThan(1.2);
        // (chimney smoke puffs may drift above the bubble)
        const all = new THREE.Box3();
        m.root.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && o.name !== 'puff') all.union(new THREE.Box3().setFromObject(o));
        });
        expect(m.bubbleY).toBeGreaterThan(all.max.y - 0.05);
        // the bed is at the back (+X), the front reaches toward −X
        expect(all.min.x).toBeLessThan(-1.5);
        expect(all.max.x).toBeGreaterThan(TRUCK_BED_X + 0.6);
        // queued vehicles (TRADE_POST.spacing apart) never overlap
        expect(all.max.x - all.min.x).toBeLessThan(TRADE_POST.spacing);
        expect(Math.max(-all.min.z, all.max.z)).toBeLessThan(1.3);
      });

      it('is cosy: no near-black parts', () => {
        const meshes: THREE.Mesh[] = [];
        m.root.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && !isUnder(o, rig.root)) meshes.push(o as THREE.Mesh);
        });
        for (const mesh of meshes) {
          const col = mesh.geometry.getAttribute('color');
          const mat = mesh.material as THREE.MeshToonMaterial;
          if (col && mat.vertexColors) {
            for (let i = 0; i < col.count; i++) expect(Math.max(col.getX(i), col.getY(i), col.getZ(i)), mesh.name).toBeGreaterThan(0.06);
          } else {
            const c = mat.color;
            expect(Math.max(c.r, c.g, c.b), mesh.name).toBeGreaterThan(0.06);
          }
        }
      });

      it('animates: the wheels turn while it drives and the pose stays sane', () => {
        const before = m.wheels.map((w) => w.rotation.z + w.rotation.y);
        for (let i = 0; i < 20; i++) m.animate(1 / 30, 5, 1);
        m.wheels.forEach((w, i) => expect(w.rotation.z + w.rotation.y).not.toBeCloseTo(before[i]!, 3));
        expect(Math.abs(m.body.position.y)).toBeLessThan(0.25);
        for (let i = 0; i < 20; i++) m.animate(1 / 30, 0, 0);
        expect(Number.isFinite(m.body.position.y)).toBe(true);
      });

      it('a paint tints it (the two buyer variants differ)', () => {
        const a = createEraVehicle(n, 0x3567d6);
        const b = createEraVehicle(n, 0xe2453c);
        const geoOf = (v: typeof a) => (v.body.children.find((c) => c.name.endsWith('Body')) as THREE.Mesh).geometry;
        expect(geoOf(a)).not.toBe(geoOf(b));
        // the same paint shares one baked body geometry (instancing across the scene)
        expect(geoOf(createEraVehicle(n, 0x3567d6))).toBe(geoOf(a));
      });
    });
  }
});

describe('era cash machine models', () => {
  for (const n of ERA_NS) {
    describe(`era ${n}: ${eraCashMachine(n)!.id}`, () => {
      const m = createEraCashModel(n);

      it("is the era's own machine, scaled to the vault spot", () => {
        expect(m.id).toBe(eraCashMachine(n)!.id);
        expect(m.w).toBeLessThanOrEqual(CASH_FIT.w + 1e-6);
        expect(m.d).toBeLessThanOrEqual(CASH_FIT.d + 1e-6);
        expect(m.h).toBeLessThanOrEqual(CASH_FIT.h + 1e-6);
        expect(m.w).toBeGreaterThan(1.0);
        expect(m.d).toBeGreaterThan(0.8);
        const box = bounds(m.root);
        expect(box.min.y).toBeGreaterThan(-0.02);
        expect(box.max.y).toBeLessThanOrEqual(CASH_FIT.h + 0.02);
        // the collider (w × d, centred) covers the model
        expect(box.min.x).toBeGreaterThan(-m.w / 2 - 0.05);
        expect(box.max.x).toBeLessThan(m.w / 2 + 0.05);
        expect(box.min.z).toBeGreaterThan(-m.d / 2 - 0.05);
        expect(box.max.z).toBeLessThan(m.d / 2 + 0.05);
      });

      it('the bundles fly into its top', () => {
        expect(m.mouth.y).toBeGreaterThan(m.h * 0.8);
        expect(m.mouth.y).toBeLessThanOrEqual(m.h + 0.05);
        expect(Math.abs(m.mouth.x)).toBeLessThan(m.w / 2);
        expect(Math.abs(m.mouth.z)).toBeLessThan(m.d / 2);
      });

      it('works while banking and stays inside its footprint', () => {
        const pose = (): string => {
          const parts: number[] = [];
          m.root.traverse((o) => parts.push(o.position.y, o.rotation.x, o.rotation.y, o.rotation.z));
          return parts.map((v) => v.toFixed(4)).join(',');
        };
        const before = pose();
        for (let i = 0; i < 25; i++) m.animate(1 / 30, true);
        expect(pose()).not.toBe(before);
        const box = bounds(m.root);
        expect(box.max.x - box.min.x).toBeLessThan(CASH_FIT.w + 0.3);
        expect(box.max.z - box.min.z).toBeLessThan(CASH_FIT.d + 0.3);
        expect(box.max.y).toBeLessThan(CASH_FIT.h + 0.2);
      });

      it('stands in the market clear of the counters, the cash pile, the clerk and its level pad', () => {
        const L = regionLayout(n);
        const P = marketPlaces(L);
        const vault: R = { minX: P.vault.x - m.w / 2, maxX: P.vault.x + m.w / 2, minZ: P.vault.z - m.d / 2, maxZ: P.vault.z + m.d / 2 };
        expect(within(vault, L.zones.market)).toBe(true);
        for (const o of [worldRect(P.dock, P.yaw, DOCK_BODY), worldRect(P.stall, P.yaw, STALL_BODY), worldRect(P.stall, P.yaw, STALL_GIVE), around(P.cash, 1.0), around(P.clerk, 0.6), around(P.vaultPad, 0.8 * 1.15)])
          expect(overlap(vault, o), `${JSON.stringify(vault)} vs ${JSON.stringify(o)}`).toBe(false);
      });
    });
  }

  it('an era without a model of its own gets the generic safe', () => {
    const m = createEraCashModel(1);
    expect(m.id).toBe('safe');
    expect(m.w).toBe(1.5);
    expect(() => m.animate(0.1, true)).not.toThrow();
  });
});
