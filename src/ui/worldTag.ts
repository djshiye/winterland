/**
 * [0.9.8 — brief 14] World labels: how the floating pad / machine signs ("HARVESTER", "MANAGE", the cabin's
 * "UPGRADES") behave on screen. Their wooden-board art belongs to assets/pads.ts (brief 13); this module gives every
 * sign the label rules of DIRECTION "World labels" without any per-frame call from the owners, and the owners' own
 * fades (fx/manageSign.ts sets material.opacity) keep working on top of it:
 *   · a sign fades softly with ground distance from the camera's focus (tagFade), never fully gone;
 *   · its lettering never shows under MIN_TEXT_PX CSS px tall: on small windows and zoomed out it grows
 *     (up to MAX_GROW), so labels stay readable (the guide's 13 px floor).
 *   · 0.9.12 (V1): signs never pile up on screen. A few times a second the signs drawn last frame are measured on
 *     screen (board plus hanging price tag); nearest the camera's focus (the player) first, a sign whose box overlaps
 *     one already kept fades out until the way is clear (cabin and tent tags used to stack on each other in the
 *     village, lot tags in the Market Town). The one you walk up to always shows; a kept sign gets a small head start
 *     so two signs at about the same distance never flicker.
 * Pure parts (tagFade, tagGrow, declutter) are unit-tested.
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

/** Seconds between two declutter passes. */
const DECLUTTER_EVERY = 0.12;
/**
 * A sign counts as on screen while it was drawn within this many renderer.render calls (a frame is a few calls with
 * the post effects; counted in calls, not seconds, so a slow frame or a headless still still sees last frame's signs).
 */
const SEEN_FOR = 40;
/** Metres of head start a sign that is showing gets over one that is hidden (no flicker at equal distance). */
const KEEP_BONUS = 1.5;
/** Fade speed of a sign stepping out of / back into view (per second). */
const DECLUTTER_SPEED = 8;

export interface TagRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * [PURE] Which signs to show: `items` are screen boxes with a priority (smaller = nearer = first). A box overlapping a
 * kept one by more than a sliver (`slack` px) is hidden. Returns one flag per item, in the items' order.
 */
export function declutter(items: readonly { rect: TagRect; rank: number }[], slack = 3): boolean[] {
  const order = items.map((_, i) => i).sort((a, b) => items[a]!.rank - items[b]!.rank);
  const keep: boolean[] = items.map(() => false);
  const kept: TagRect[] = [];
  for (const i of order) {
    const r = items[i]!.rect;
    let clear = true;
    for (const k of kept) {
      if (r.left < k.right - slack && r.right > k.left + slack && r.top < k.bottom - slack && r.bottom > k.top + slack) {
        clear = false;
        break;
      }
    }
    if (clear) {
      keep[i] = true;
      kept.push(r);
    }
  }
  return keep;
}

interface TagEntry {
  mesh: THREE.Mesh;
  fade: { value: number };
  /** The distance fade (tagFade) of the last draw. */
  dist: number;
  /** Ground distance from the camera's focus at the last draw (m). */
  range: number;
  /** 1 = shown, 0 = stepped aside for a nearer sign (eased toward `want`). */
  room: number;
  want: number;
  /** renderer.info.render.frame of the last draw. */
  seenAt: number;
  /** In `entries` (a sign taken out of the scene is dropped from the list and comes back on its next draw). */
  listed: boolean;
}

const entries: TagEntry[] = [];
let passAt = -Infinity;
let easedAt = -Infinity;
const corner = new THREE.Vector3();
const now = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now()) / 1000;

/** True when the sign and every parent are visible and its material draws. */
function onShow(m: THREE.Mesh): boolean {
  const mat = m.material as THREE.Material;
  if (!mat.visible || mat.opacity < 0.05) return false;
  for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function inScene(o: THREE.Object3D): boolean {
  let p: THREE.Object3D = o;
  while (p.parent) p = p.parent;
  return (p as THREE.Scene).isScene === true;
}

/**
 * Screen box (CSS px) of a sign and its hanging tag: the corners of each flat quad's own (local) box, so a billboard
 * turned toward the camera measures as itself (a world-axis box around it would be far too big).
 */
function screenRect(m: THREE.Mesh, cam: THREE.Camera, w: number, h: number): TagRect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const parts: THREE.Object3D[] = [m, ...m.children];
  for (const part of parts) {
    const g = (part as THREE.Mesh).geometry;
    if (!g || !part.visible) continue;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox!;
    part.updateWorldMatrix(true, false);
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(part.matrixWorld).project(cam);
      const x = (corner.x * 0.5 + 0.5) * w;
      const y = (-corner.y * 0.5 + 0.5) * h;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return left < right ? { left, top, right, bottom } : null;
}

/** One declutter pass over the signs drawn lately (camera `cam`, canvas `w` x `h` CSS px). */
function declutterPass(cam: THREE.Camera, w: number, h: number, frame: number): void {
  const live: TagEntry[] = [];
  const items: { rect: TagRect; rank: number }[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (frame - e.seenAt > SEEN_FOR && !inScene(e.mesh)) {
      // a disposed pad's sign: forget it (no leak); a sign put back in the scene re-lists itself when drawn
      entries.splice(i, 1);
      e.listed = false;
      e.room = e.want = 1;
    }
  }
  for (const e of entries) {
    if (frame - e.seenAt > SEEN_FOR || !onShow(e.mesh)) {
      e.want = 1; // off screen or hidden by its owner: back to normal for when it shows again
      continue;
    }
    const rect = screenRect(e.mesh, cam, w, h);
    if (!rect) continue;
    live.push(e);
    items.push({ rect, rank: e.range - (e.want > 0 ? KEEP_BONUS : 0) });
  }
  const keep = declutter(items);
  for (let i = 0; i < live.length; i++) live[i]!.want = keep[i] ? 1 : 0;
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
  const entry: TagEntry = { mesh, fade, dist: 1, range: 0, room: 1, want: 1, seenAt: -Infinity, listed: true };
  entries.push(entry);
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
    entry.range = Math.hypot(at.x - focus.x, at.z - focus.z);
    entry.dist = tagFade(entry.range);
    const t = now();
    const frame = renderer.info.render.frame;
    entry.seenAt = frame;
    if (!entry.listed) {
      entry.listed = true;
      entries.push(entry);
    }
    renderer.getSize(size);
    if (t - passAt >= DECLUTTER_EVERY) {
      passAt = t;
      declutterPass(cam, size.x, size.y, frame);
    }
    if (t !== easedAt) {
      // ease every sign once per frame (a long gap, a headless still: jump straight there)
      const k = Math.min(1, Math.max(0, t - easedAt) * DECLUTTER_SPEED);
      easedAt = t;
      for (const e of entries) {
        e.room += (e.want - e.room) * k;
        if (Math.abs(e.want - e.room) < 0.01) e.room = e.want;
      }
    }
    fade.value = entry.dist * entry.room;
    if (!cam.isOrthographicCamera) return;
    if (!mesh.scale.equals(applied)) base.copy(mesh.scale);
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
