/**
 * [0.9.8 — brief 14] World labels: how the floating pad / machine signs ("HARVESTER", "MANAGE", the cabin's
 * "UPGRADES") behave on screen. Their wooden-board art belongs to assets/pads.ts (brief 13); this module gives every
 * sign the label rules of DIRECTION "World labels" without any per-frame call from the owners, and the owners' own
 * fades (fx/manageSign.ts sets material.opacity) keep working on top of it:
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

const fwd = new THREE.Vector3();
const focus = new THREE.Vector3();
const at = new THREE.Vector3();
const size = new THREE.Vector2();

/** Multiply a material's alpha by `fade` in its shader (its own opacity still applies on top). */
function fadeInShader(mat: THREE.Material, fade: { value: number }): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTagFade = fade;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTagFade;')
      .replace('#include <opaque_fragment>', 'diffuseColor.a *= uTagFade;\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'wl-world-tag';
  mat.needsUpdate = true;
}

/**
 * Give a sign mesh (a plane of height `planeH` world units, billboarded by its owner) the tag's distance fade and the
 * 13 px lettering floor; `textShare` is the lettering's height as a share of the plane's.
 * - The fade multiplies the material's own opacity in the shader, so owners keep their fades; meshes hung on the sign
 *   (brief 13's price tags) fade with it.
 * - The growth scales the sign object (children follow, so a hanging price tag stays on its nail). It is applied on
 *   top of the owner's own scale: when the owner sets a new scale, that becomes the new base.
 */
export function wearTagLook(mesh: THREE.Mesh, planeH: number, textShare = 0.5): void {
  const fade = { value: 1 };
  fadeInShader(mesh.material as THREE.Material, fade);
  const worn = new WeakSet<THREE.Object3D>();
  const base = new THREE.Vector3().copy(mesh.scale);
  const applied = new THREE.Vector3().copy(mesh.scale);
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    for (const c of mesh.children) {
      if (worn.has(c) || !(c instanceof THREE.Mesh)) continue;
      worn.add(c);
      fadeInShader(c.material as THREE.Material, fade);
    }
    const cam = camera as THREE.OrthographicCamera;
    // the camera's focus on the ground: it looks along -Z from CAMERA.distance away
    fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    focus.copy(cam.position).addScaledVector(fwd, CAMERA.distance);
    mesh.getWorldPosition(at);
    fade.value = tagFade(Math.hypot(at.x - focus.x, at.z - focus.z));
    if (!cam.isOrthographicCamera) return;
    if (!mesh.scale.equals(applied)) base.copy(mesh.scale);
    renderer.getSize(size);
    const viewH = (cam.top - cam.bottom) / Math.max(1e-3, cam.zoom);
    const parentScale = mesh.parent ? mesh.parent.matrixWorld.getMaxScaleOnAxis() : 1;
    const textPx = (planeH * parentScale * Math.max(base.x, base.y) * textShare * size.y) / Math.max(1e-3, viewH);
    const grow = tagGrow(textPx);
    applied.copy(base).multiplyScalar(grow);
    if (!mesh.scale.equals(applied)) {
      mesh.scale.copy(applied);
      mesh.updateMatrixWorld(true);
    }
  };
}
