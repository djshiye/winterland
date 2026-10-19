/**
 * 0.9.12 machine yard links (eras/linkPlan.ts planYardLinks, assets/yardLinks.ts, eras/YardLinks.ts): every two
 * machines side by side are joined overhead, in the era's own style, and nothing new ever stands in anyone's way or
 * hides a pad. Uses the real region layouts and the real machine models (their body sizes).
 *
 * The guards, on the built geometry itself (every vertex of every mesh and every carrier at eight moments):
 * - everything outside a machine's solid body (its collider) is high overhead: above the highest raised belt with an
 *   item riding it, so the walking aisles, corridor belts, feed / take zones, pads and MANAGE zones stay clear;
 * - nothing seen from the camera (+X / +Z, 48° up) lands on a level pad tile or a MANAGE zone;
 * - the risers' feet stand inside the machine bodies;
 * - the carriers really travel from the producer to the consumer;
 * - colours come only from render/palette.ts, and the model stays cheap (≤ 4 draws, carriers cast no shadow).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA } from '../src/config';
import { createMachineModel } from '../src/assets/eraMachines';
import { createYardLinksModel } from '../src/assets/yardLinks';
import { createRollerConveyor } from '../src/assets/machines';
import { BELT_LIFT } from '../src/eras/EraBelts';
import { MACHINES, machinesOfEra, type MachineId } from '../src/eras/data';
import { regionLayout, type RegionLayout } from '../src/eras/layout';
import { SPAN_CLEAR, planYardLinks, type LinkMachine } from '../src/eras/linkPlan';
import { LEVEL_PAD_SIZE, levelPadLocal, machineFrame, worldRect, type LRect } from '../src/eras/rules';
import type { ERect } from '../src/eras/data';
import { YARD_LINKS } from '../src/render/palette';

const dims = new Map<MachineId, { w: number; d: number }>();
function dimsOf(id: MachineId): { w: number; d: number } {
  let v = dims.get(id);
  if (!v) {
    const m = createMachineModel(id);
    v = { w: m.w, d: m.d };
    dims.set(id, v);
  }
  return v;
}

/** Every slot of era n's region built, the era's machines in turn starting at `offset` (the perf scenario's fill). */
function fill(n: number, offset = 0): { L: RegionLayout; ids: MachineId[]; machines: LinkMachine[] } {
  const L = regionLayout(n);
  const list = machinesOfEra(n);
  const ids = L.slots.map((_, i) => list[(i + offset) % list.length]!);
  const machines = ids.map((id) => ({ inputs: MACHINES[id].inputs, output: MACHINES[id].output, ...dimsOf(id) }));
  return { L, ids, machines };
}

const inRect = (r: ERect, x: number, z: number, m = 0): boolean => x >= r.minX - m && x <= r.maxX + m && z >= r.minZ - m && z <= r.maxZ + m;

interface Rects {
  bodies: ERect[];
  pads: ERect[];
  manage: ERect[];
}

function rects(L: RegionLayout, machines: readonly LinkMachine[]): Rects {
  const out: Rects = { bodies: [], pads: [], manage: [] };
  machines.forEach((m, i) => {
    const p = L.slots[i]!;
    const at = { x: p.x, z: p.z };
    const f = machineFrame(m.w, m.d);
    out.bodies.push(worldRect(at, p.yaw, f.body));
    const l = levelPadLocal(m.w, m.d);
    const h = LEVEL_PAD_SIZE / 2;
    out.pads.push(worldRect(at, p.yaw, { u0: l.u - h, u1: l.u + h, v0: l.v - h, v1: l.v + h } as LRect));
    out.manage.push(worldRect(at, p.yaw, f.manage));
  });
  return out;
}

/** Every world vertex of the model's static meshes, plus every carrier's vertices at a dozen moments. */
function vertices(model: ReturnType<typeof createYardLinksModel>): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  for (let step = 0; step < 8; step++) {
    model.root.updateMatrixWorld(true);
    model.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const inst = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh) : null;
      if (!inst && step > 0) return;
      if (inst) (inst.onBeforeRender as unknown as () => void)();
      const count = inst ? inst.count : 1;
      for (let k = 0; k < count; k++) {
        if (inst) inst.getMatrixAt(k, m4);
        for (let i = 0; i < pos.count; i += inst ? 1 : 3) {
          v.fromBufferAttribute(pos, i);
          if (inst) v.applyMatrix4(m4);
          v.applyMatrix4(mesh.matrixWorld);
          out.push(v.clone());
        }
      }
    });
    model.update(0.37);
  }
  return out;
}

const yaw = THREE.MathUtils.degToRad(CAMERA.yawDeg);
const pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
/** Where a point at height y appears on the ground from the camera (it hides whatever is there). */
const onGround = (p: THREE.Vector3): { x: number; z: number } => {
  const run = p.y / Math.tan(pitch);
  return { x: p.x - Math.sin(yaw) * run, z: p.z - Math.cos(yaw) * run };
};

describe('machine yard links (eras 2-10)', () => {
  it('joins every two built machines side by side, and only those', () => {
    for (let n = 2; n <= 10; n++) {
      const { L, machines } = fill(n);
      const plan = planYardLinks(L, machines);
      let pairs = 0;
      L.slots.forEach((a, i) =>
        L.slots.forEach((b, j) => {
          if (Math.abs(a.z - b.z) < 0.01 && Math.abs(b.x - a.x - L.cell) < 0.01) pairs++;
          void j;
        }),
      );
      expect(plan.links.filter((l) => !l.branch).length, `era ${n}`).toBe(pairs);
      // a machine alone in its row (the 9th spot of eras 8 and 9) branches straight to the row in front
      const lone = L.slots.filter((a) => L.slots.filter((b) => Math.abs(a.z - b.z) < 0.01).length === 1).length;
      const branches = plan.links.filter((l) => l.branch);
      expect(branches.length, `era ${n} branches`).toBe(lone);
      for (const b of branches) {
        expect([b.from, b.to].some((i) => L.slots.filter((s) => Math.abs(s.z - L.slots[i]!.z) < 0.01).length === 1)).toBe(true);
      }
      expect(pairs, `era ${n}`).toBeGreaterThan(2);
      // a missing machine breaks its two links, and an empty region has none
      const holed = machines.map((m, i) => (i === 1 ? null : m));
      expect(planYardLinks(L, holed).links.every((l) => l.from !== 1 && l.to !== 1)).toBe(true);
      expect(planYardLinks(L, machines.map(() => null)).links).toHaveLength(0);
    }
  });

  it('flows from the machine that makes what the other one uses', () => {
    const { L, ids, machines } = fill(2);
    const plan = planYardLinks(L, machines);
    for (const l of plan.links) {
      const p = MACHINES[ids[l.from]!];
      const c = MACHINES[ids[l.to]!];
      expect(l.kind).toBe(p.output);
      const back = p.inputs.some((i) => i.kind === c.output);
      const fwd = c.inputs.some((i) => i.kind === p.output);
      if (back) expect(fwd, `${p.id} -> ${c.id}`).toBe(true);
    }
    expect(plan.links.some((l) => MACHINES[ids[l.to]!].inputs.some((i) => i.kind === MACHINES[ids[l.from]!].output))).toBe(true);
  });

  it('stands only inside machine bodies, keeps everything else overhead and never hides a pad or a MANAGE board', () => {
    // the highest raised belt with an item riding it (EraBelts beltY 0.5, ≤ 0.45 tall items)
    expect(SPAN_CLEAR).toBeGreaterThan(0.5 + BELT_LIFT[BELT_LIFT.length - 1]! + 0.45);
    for (let n = 2; n <= 10; n++) {
      for (const offset of [0, 1, 2]) {
        const { L, machines } = fill(n, offset);
        const plan = planYardLinks(L, machines);
        const R = rects(L, machines);
        for (const r of plan.risers) {
          const body = R.bodies[r.slot]!;
          // the riser's foot plate (0.6 m square) sits wholly inside its machine's collider
          expect(inRect(body, r.x - 0.3, r.z - 0.3) && inRect(body, r.x + 0.3, r.z + 0.3), `era ${n} riser on slot ${r.slot}`).toBe(true);
        }
        const model = createYardLinksModel(n, plan);
        let low = Infinity;
        let hides = '';
        for (const p of vertices(model)) {
          const inBody = R.bodies.some((b) => inRect(b, p.x, p.z, -0.02));
          if (!inBody) low = Math.min(low, p.y);
          if (p.y < 1 || hides) continue;
          const g = onGround(p);
          const pad = R.pads.findIndex((r) => inRect(r, g.x, g.z, 0.05));
          const man = R.manage.findIndex((r) => inRect(r, g.x, g.z, 0.05));
          if (pad >= 0) hides = `the level pad of slot ${pad} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
          else if (man >= 0) hides = `the MANAGE zone of slot ${man} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
        }
        expect(hides, `era ${n} offset ${offset}: a link hides`).toBe('');
        expect(low, `era ${n}: lowest point outside the machine bodies`).toBeGreaterThanOrEqual(SPAN_CLEAR - 1e-6);
        model.dispose();
      }
    }
  });

  it('carries visibly from the producer to the consumer', () => {
    // era 6: the bright beads ride the power line between the two arms' ends (path[1] → path[2])
    const { L, machines } = fill(6);
    const plan = planYardLinks(L, machines);
    const model = createYardLinksModel(6, plan);
    expect(model.carriers).toBeGreaterThanOrEqual(plan.links.length * 3);
    const inst = model.root.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
    const m4 = new THREE.Matrix4();
    const pos = (): THREE.Vector3 => {
      (inst.onBeforeRender as unknown as () => void)();
      inst.getMatrixAt(0, m4);
      return new THREE.Vector3().setFromMatrixPosition(m4);
    };
    const l = plan.links[0]!;
    const dir = new THREE.Vector2(l.path[2]!.x - l.path[1]!.x, l.path[2]!.z - l.path[1]!.z).normalize();
    model.update(0.01);
    const p0 = pos();
    model.update(0.5);
    const p1 = pos();
    const moved = new THREE.Vector2(p1.x - p0.x, p1.z - p0.z);
    expect(moved.length()).toBeGreaterThan(0.2);
    expect(moved.dot(dir)).toBeGreaterThan(0);
    model.dispose();
  });

  it('stays cheap: at most four draws, no carrier shadows, carriers culled by their spans', () => {
    for (let n = 2; n <= 10; n++) {
      const { L, machines } = fill(n);
      const model = createYardLinksModel(n, planYardLinks(L, machines));
      const meshes: THREE.Mesh[] = [];
      model.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
      });
      expect(meshes.length, `era ${n}`).toBeLessThanOrEqual(4);
      const inst = meshes.find((m) => (m as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
      expect(inst.castShadow).toBe(false);
      expect(inst.frustumCulled).toBe(true);
      expect(inst.boundingSphere).not.toBeNull();
      expect(inst.boundingSphere!.radius).toBeLessThan(60);
      model.dispose();
    }
  });

  it('takes its colours only from the palette module, a look for every era', () => {
    for (let n = 2; n <= 10; n++) expect(YARD_LINKS[n], `era ${n}`).toBeDefined();
    const src = readFileSync(resolve(__dirname, '../src/assets/yardLinks.ts'), 'utf8');
    expect(src).not.toMatch(/0x[0-9a-fA-F]{6}/);
    // era 1 keeps its red-and-cream belt; era regions paint theirs
    const a = createRollerConveyor([{ x: 0, z: 0 }, { x: 4, z: 0 }], 0.7, 0.5);
    const b = createRollerConveyor([{ x: 0, z: 0 }, { x: 4, z: 0 }], 0.7, 0.5, YARD_LINKS[7]!.belt);
    const color = (m: ReturnType<typeof createRollerConveyor>): number => (m.rollers.material as THREE.MeshToonMaterial).color.getHex();
    expect(color(a)).not.toBe(color(b));
  });
});
