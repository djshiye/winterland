/**
 * [0.9.8 — brief 14] World labels: how the floating pad / machine signs ("HARVESTER", "MANAGE", the cabin's
 * "UPGRADES") behave on screen. Their wooden-board art belongs to assets/pads.ts (brief 13); this module gives every
 * sign the label rules of DIRECTION "World labels", entirely on the GPU side so the owners' own fades
 * (fx/manageSign.ts sets material.opacity) keep working on top of it:
 *   · a sign fades softly with ground distance from the camera's focus (tagFade), never fully gone;
 *   · its lettering never shows under MIN_TEXT_PX CSS px tall: on small windows and zoomed out it grows
 *     (up to MAX_GROW), so labels stay readable (the guide's 13 px floor).
 * Pure parts (tagFade, tagGrow) are unit-tested.
 */
import * as THREE from 'three';
import { CAMERA } from '../config';

/** Fully clear within this ground distance (m) of the camera's focus; faded to TAG_MIN past TAG_FAR. */
export const TAG_NEAR = 12;
export const TAG_FAR = 30;
export const TAG_MIN = 0.3;
/** The lettering's smallest on-screen size (CSS px) and how much a tag may grow to keep it. */
export const MIN_TEXT_PX = 13;
export const MAX_GROW = 1.8;

/** [PURE] Tag opacity for a ground distance (m) from the camera's focus. */
export function tagFade(d: number): number {
  if (!(d > TAG_NEAR)) return 1;
  if (d >= TAG_FAR) return TAG_MIN;
  const k = (d - TAG_NEAR) / (TAG_FAR - TAG_NEAR);
  const s = k * k * (3 - 2 * k);
  return 1 - (1 - TAG_MIN) * s;
}

/** [PURE] How much to grow a tag whose lettering would show `textPx` CSS px tall (1 = as built). */
export function tagGrow(textPx: number): number {
  if (!(textPx > 0)) return 1;
  return Math.min(MAX_GROW, Math.max(1, MIN_TEXT_PX / textPx));
}

interface TagUniforms {
  uTagFade: { value: number };
  uTagGrow: { value: number };
}

const fwd = new THREE.Vector3();
const focus = new THREE.Vector3();
const at = new THREE.Vector3();
const size = new THREE.Vector2();

/**
 * Give a sign mesh (a plane of height `planeH` world units, billboarded by its owner) the tag's distance fade and the
 * 13 px lettering floor; `textShare` is the lettering's height as a share of the plane's. The fade multiplies the
 * material's own opacity in the shader, so owners keep their fades.
 */
export function wearTagLook(mesh: THREE.Mesh, planeH: number, textShare = 0.5): void {
  const mat = mesh.material as THREE.MeshBasicMaterial;
  const u: TagUniforms = { uTagFade: { value: 1 }, uTagGrow: { value: 1 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTagFade = u.uTagFade;
    shader.uniforms.uTagGrow = u.uTagGrow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTagGrow;')
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3( position.xy * uTagGrow, position.z );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTagFade;')
      .replace('#include <opaque_fragment>', 'diffuseColor.a *= uTagFade;\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'wl-wooden-tag';
  mat.needsUpdate = true;
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const cam = camera as THREE.OrthographicCamera;
    // the camera's focus on the ground: it looks along -Z from CAMERA.distance away
    fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    focus.copy(cam.position).addScaledVector(fwd, CAMERA.distance);
    mesh.getWorldPosition(at);
    u.uTagFade.value = tagFade(Math.hypot(at.x - focus.x, at.z - focus.z));
    if (cam.isOrthographicCamera) {
      renderer.getSize(size);
      const viewH = (cam.top - cam.bottom) / Math.max(1e-3, cam.zoom);
      const worldScale = mesh.matrixWorld.getMaxScaleOnAxis();
      const textPx = (planeH * worldScale * textShare * size.y) / Math.max(1e-3, viewH);
      u.uTagGrow.value = tagGrow(textPx);
    }
  };
}
