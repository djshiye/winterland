/**
 * render/instancer.ts (repeated meshes drawn as one InstancedMesh for a frame) and render/batch.ts shareBaked
 * (identical baked parts share one geometry). No WebGL: prepare / restore only move visibility and matrices.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCustomerModel } from '../src/assets/characters';
import { createTricycle } from '../src/assets/vehicles';
import { shareBaked, vcMat } from '../src/render/batch';
import { instanceAcrossScene, instanceChildren, prepareInstances, prepareSharedInstances, restoreInstances, stopInstancing } from '../src/render/instancer';

const geoA = new THREE.BoxGeometry(0.4, 0.2, 0.3);
const geoB = new THREE.SphereGeometry(0.2, 8, 6);

function pile(n: number, geometry = geoA): { scene: THREE.Scene; root: THREE.Group; items: THREE.Mesh[] } {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const items: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geometry, vcMat());
    m.position.set(i * 0.5, 0.1, 0);
    m.rotation.y = i * 0.05;
    root.add(m);
    items.push(m);
  }
  instanceChildren(root);
  return { scene, root, items };
}

/** Instance matrices are stored as float32. */
const close = (a: THREE.Matrix4, b: THREE.Matrix4): boolean => a.elements.every((v, i) => Math.abs(v - b.elements[i]!) < 1e-6);

const instancedIn = (o: THREE.Object3D): THREE.InstancedMesh[] =>
  o.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh && c.visible) as THREE.InstancedMesh[];

describe('instanceChildren', () => {
  it('draws a run of identical children as one instanced mesh with their exact transforms, for one frame', () => {
    const { scene, root, items } = pile(5);
    prepareInstances(scene);
    const im = instancedIn(root);
    expect(im).toHaveLength(1);
    expect(im[0]!.count).toBe(5);
    expect(items.every((m) => !m.visible)).toBe(true);
    const got = new THREE.Matrix4();
    items.forEach((m, i) => {
      im[0]!.getMatrixAt(i, got);
      expect(close(got, m.matrix)).toBe(true);
    });
    restoreInstances();
    expect(items.every((m) => m.visible)).toBe(true);
    stopInstancing(root);
    expect(instancedIn(root)).toHaveLength(0);
  });

  it('leaves single meshes, hidden items and other kinds alone', () => {
    const { scene, root, items } = pile(3);
    items[2]!.visible = false;
    const lone = new THREE.Mesh(geoB, vcMat());
    root.add(lone);
    prepareInstances(scene);
    expect(instancedIn(root)[0]!.count).toBe(2);
    expect(lone.visible).toBe(true);
    restoreInstances();
    expect(items[2]!.visible).toBe(false); // was hidden by the game: stays hidden
    stopInstancing(root);
  });

  it('does nothing for a pile that is not shown', () => {
    const { scene, root, items } = pile(4);
    root.visible = false;
    prepareInstances(scene);
    expect(items.every((m) => m.visible)).toBe(true);
    restoreInstances();
    stopInstancing(root);
  });

  it('keeps one instanced mesh per geometry', () => {
    const { scene, root } = pile(3);
    for (let i = 0; i < 2; i++) root.add(new THREE.Mesh(geoB, vcMat()));
    prepareInstances(scene);
    expect(instancedIn(root).map((m) => m.count).sort()).toEqual([2, 3]);
    restoreInstances();
    stopInstancing(root);
  });
});

describe('instanceAcrossScene', () => {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 50, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  it('pools the same pawn part across NPCs (world matrices) and skips NPCs far outside the view', () => {
    const scene = new THREE.Scene();
    const near = [createCustomerModel(0), createCustomerModel(0)];
    const far = createCustomerModel(0);
    near[0]!.root.position.set(-2, 0, 0);
    near[1]!.root.position.set(3, 0, 1);
    far.root.position.set(200, 0, 0);
    for (const c of [...near, far]) {
      scene.add(c.root);
      instanceAcrossScene(c.root);
    }
    scene.updateMatrixWorld();
    prepareSharedInstances(scene, camera, null);
    const boots = near.flatMap((c) => [c.legL.children[0] as THREE.Mesh, c.legR.children[0] as THREE.Mesh]);
    expect(boots.every((b) => !b.visible)).toBe(true);
    expect((far.legL.children[0] as THREE.Mesh).visible).toBe(true);
    const shared = scene.getObjectByName('instancer:shared')!;
    const bootMesh = shared.children.find((c) => (c as THREE.InstancedMesh).geometry === boots[0]!.geometry) as THREE.InstancedMesh;
    expect(bootMesh.count).toBe(4);
    const got = new THREE.Matrix4();
    bootMesh.getMatrixAt(0, got);
    expect(close(got, boots[0]!.matrixWorld)).toBe(true);
    restoreInstances();
    expect(boots.every((b) => b.visible)).toBe(true);
  });
});

describe('shareBaked', () => {
  it('gives identical pawns and carts the same part geometry, different looks their own', () => {
    const a = createCustomerModel(0);
    const b = createCustomerModel(0);
    const boot = (c: typeof a): THREE.BufferGeometry => (c.legL.children[0] as THREE.Mesh).geometry;
    expect(boot(a)).toBe(boot(b));
    expect((a.legL.children[0] as THREE.Mesh).geometry).toBe((a.legR.children[0] as THREE.Mesh).geometry);
    const t1 = createTricycle();
    const t2 = createTricycle();
    expect((t1.wheels[0]!.children[0] as THREE.Mesh).geometry).toBe((t2.wheels[0]!.children[0] as THREE.Mesh).geometry);
    const red = shareBaked(new THREE.Mesh(painted(0xff0000), vcMat()));
    const blue = shareBaked(new THREE.Mesh(painted(0x0000ff), vcMat()));
    expect(red.geometry).not.toBe(blue.geometry);
  });
});

function painted(color: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

describe('artModel', () => {
  it('builds at most 3 meshes, once per key, shared by every copy', async () => {
    const { artModel } = await import('../src/assets/artModel');
    const { Batch } = await import('../src/render/batch');
    let builds = 0;
    const make = () =>
      artModel('test:tower', () => {
        builds++;
        return {
          body: new Batch().add(geoA, 0xb5653e, 0, 1, 0),
          glow: new Batch().add(geoA, 0xffd978, 0, 2, 0.3),
          anim: { batch: new Batch().add(geoB, 0x6b4a3a, 0, 0, 0), x: 0, y: 3, z: 0 },
        };
      });
    const a = make();
    const b = make();
    expect(builds).toBe(1);
    let meshes = 0;
    a.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(3);
    expect(a.body.geometry).toBe(b.body.geometry);
    expect(a.glow!.castShadow).toBe(false);
    expect(a.anim!.position.y).toBe(3);
  });
});
