/**
 * 0.9.3: a building standing between the camera and a pad (or the player) opens up, so the pad's price stays readable;
 * buildings off to the side or behind stay solid, and the shared materials come back once clear.
 * 0.9.8: the opening is a cutaway (an opaque clone that cuts a hole around the target), never a grey see-through ghost.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CAMERA } from '../src/config';
import { GHOST, MAX_HOLES, OcclusionFade } from '../src/render/OcclusionFade';
import type { GameContext } from '../src/core/types';

function world() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 400);
  const target = new THREE.Vector3(0, 0, 0);
  const yaw = (CAMERA.yawDeg * Math.PI) / 180;
  const pitch = (CAMERA.pitchDeg * Math.PI) / 180;
  camera.position.set(Math.sin(yaw) * Math.cos(pitch) * 60, Math.sin(pitch) * 60, Math.cos(yaw) * Math.cos(pitch) * 60);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  const time = { elapsed: 0 };
  const ctx = { scene, camera, cameraRig: { target }, time, addUpdatable: () => undefined } as unknown as GameContext;
  const fade = new OcclusionFade(ctx);
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      time.elapsed += 1 / 30;
      fade.update(1 / 30);
    }
  };
  return { scene, ctx, fade, run };
}

function tower(scene: THREE.Scene, x: number, z: number, h = 12): { root: THREE.Group; mat: THREE.MeshStandardMaterial } {
  const mat = new THREE.MeshStandardMaterial();
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, h, 4), mat);
  mesh.position.y = h / 2;
  root.add(mesh);
  root.position.set(x, 0, z);
  scene.add(root);
  root.updateMatrixWorld(true);
  return { root, mat };
}

function pad(scene: THREE.Scene, x: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, 0, z);
  scene.add(o);
  o.updateMatrixWorld(true);
  return o;
}

describe('buildings open a cutaway when they hide a pad', () => {
  it('a tower on the camera side of a pad fades, one behind it stays solid', () => {
    const { scene, fade, run } = world();
    const front = tower(scene, 4, 4); // camera sits toward +X / +Z
    const back = tower(scene, -6, -6);
    fade.addOccluder(front.root);
    fade.addOccluder(back.root);
    let shown = true;
    fade.addTarget(pad(scene, 0, 0), 2, () => shown);
    run(1);
    expect(fade.faded(front.root)).toBeCloseTo(GHOST);
    expect(fade.faded(back.root)).toBe(1);
    const mesh = front.root.children[0] as THREE.Mesh;
    const cut = mesh.material as THREE.Material;
    expect(cut).not.toBe(front.mat); // a cutaway clone, the shared material is untouched
    expect(cut.userData.wlCutaway).toBe(true);
    expect(cut.transparent).toBe(false); // solid colours, no grey ghost
    expect(cut.customProgramCacheKey()).toContain('wlCut');
    expect(front.mat.transparent).toBe(false);

    // the pad hides (bought out): the tower comes back solid with its own material
    shown = false;
    run(1);
    expect(fade.faded(front.root)).toBe(1);
    expect(mesh.material).toBe(front.mat);
  });

  it('a hidden pad or a far one does not fade anything', () => {
    const { scene, fade, run } = world();
    const t = tower(scene, 4, 4);
    fade.addOccluder(t.root);
    fade.addTarget(pad(scene, 0, 0), 2, () => false);
    fade.addTarget(pad(scene, 200, 200), 2, () => true);
    run(1);
    expect(fade.faded(t.root)).toBe(1);
  });

  it('removing a faded building gives its material back', () => {
    const { scene, fade, run } = world();
    const t = tower(scene, 4, 4);
    const off = fade.addOccluder(t.root);
    fade.addTarget(pad(scene, 0, 0), 2, () => true);
    run(1);
    expect(fade.faded(t.root)).toBeLessThan(1);
    off();
    expect((t.root.children[0] as THREE.Mesh).material).toBe(t.mat);
    expect(fade.faded(t.root)).toBeUndefined();
  });
});

describe('the cutaway shader', () => {
  it('cuts a hole around the hidden pad, on the camera side, and patches the shader', () => {
    const { scene, fade, run, ctx } = world();
    const t = tower(scene, 4, 4);
    fade.addOccluder(t.root);
    const p = pad(scene, 0, 0);
    fade.addTarget(p, 2, () => true);
    run(1);
    const mesh = t.root.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.Material;
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: '#include <common>\nvoid main() {\n#include <project_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main() {\n#include <clipping_planes_fragment>\n}',
    };
    mat.onBeforeCompile(shader as never, {} as never);
    expect(shader.vertexShader).toContain('vWlWorld = ');
    expect(shader.fragmentShader).toContain('discard');
    const holes = shader.uniforms.wlHoles!.value as THREE.Vector4[];
    expect(holes).toHaveLength(MAX_HOLES);
    expect(holes[0]!.x).toBeCloseTo(0);
    expect(holes[0]!.z).toBeCloseTo(0);
    expect(holes[0]!.w).toBeGreaterThan(1); // radius around the 2 m pad
    expect(holes[1]!.w).toBe(0);
    expect(shader.uniforms.wlOpen!.value).toBeCloseTo(1);
    // the view direction points at the camera
    const toCam = new THREE.Vector3();
    ctx.camera.getWorldDirection(toCam).negate();
    expect((shader.uniforms.wlView!.value as THREE.Vector3).dot(toCam)).toBeCloseTo(1);
  });
});
