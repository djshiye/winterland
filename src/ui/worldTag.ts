/**
 * [0.9.8 — brief 14] World labels as hanging wooden tags (DIRECTION "World labels"). The floating pad / machine signs
 * ("HARVESTER", "MANAGE", the cabin's "UPGRADES") were dark plates with white text; they become little wooden tags on
 * a string, cream lettering with a soft ink edge, and a honey plank for the gold (era) signs.
 *
 * - paintWoodenTag(): draws one tag into a 2D canvas (TAG_W x TAG_H); colours come from the palette module only.
 * - wearTagLook(): gives a sign mesh its distance behaviour, entirely on the GPU side so the owners' own fades
 *   (fx/manageSign.ts sets material.opacity) keep working on top of it:
 *     · the tag fades softly with ground distance from the camera's focus (tagFade), never fully gone;
 *     · it never renders its lettering under MIN_TEXT_PX CSS px tall: on small windows and zoomed out it grows
 *       (up to MAX_GROW), so labels stay readable (the guide's 13 px floor).
 * Pure parts (tagFade, tagGrow) are unit-tested.
 */
import * as THREE from 'three';
import { CAMERA } from '../config';
import { CREAM, GOLD, INK, UI_TONES, mixHex, palette } from '../render/palette';

/** Canvas size of one tag (the plank sits under a short string). */
export const TAG_W = 512;
export const TAG_H = 184;
/** Lettering size on the canvas (px) and the plank's top edge (the string hangs above it). */
const FONT_PX = 62;
const PLANK_TOP = 46;

/** Fully clear within this ground distance (m) of the camera's focus; faded to TAG_MIN past TAG_FAR. */
export const TAG_NEAR = 12;
export const TAG_FAR = 30;
export const TAG_MIN = 0.3;
/** The lettering's smallest on-screen size (CSS px) and how much a tag may grow to keep it. */
export const MIN_TEXT_PX = 13;
export const MAX_GROW = 1.8;

const hex = (n: number): string => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

const WOOD = palette(1).body;
const WOOD_HI = mixHex(WOOD, CREAM, 0.22);
const WOOD_LO = mixHex(WOOD, INK, 0.45);
const HONEY_HI = mixHex(GOLD, CREAM, 0.35);
const HONEY_LO = mixHex(GOLD, INK, 0.4);
const ROPE = mixHex(CREAM, WOOD, 0.35);
const LEAF = UI_TONES.leaf;

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

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export interface WoodenTagOptions {
  /** Honey plank (the era / level signs). */
  gold?: boolean;
  /** A small green up-arrow before the text (the cabin's UPGRADES mat). */
  arrow?: boolean;
  /** Canvas font family (the game's Fredoka stack). */
  font: string;
}

/** Paint a hanging wooden tag with `text` into a TAG_W x TAG_H canvas. */
export function paintWoodenTag(g: CanvasRenderingContext2D, text: string, o: WoodenTagOptions): void {
  const w = TAG_W;
  const h = TAG_H;
  g.clearRect(0, 0, w, h);
  const top = PLANK_TOP;
  const x0 = 10;
  const pw = w - 20;
  const ph = h - top - 10;
  const hi = o.gold ? HONEY_HI : WOOD_HI;
  const base = o.gold ? GOLD : WOOD;
  const lo = o.gold ? HONEY_LO : WOOD_LO;
  // the string: two rope legs from a brass nail down to the plank's shoulders
  g.lineCap = 'round';
  g.lineWidth = 7;
  g.strokeStyle = hex(ROPE);
  g.beginPath();
  g.moveTo(w * 0.27, top + 12);
  g.lineTo(w / 2, 14);
  g.lineTo(w * 0.73, top + 12);
  g.stroke();
  g.fillStyle = hex(GOLD);
  g.strokeStyle = hex(INK);
  g.lineWidth = 4;
  g.beginPath();
  g.arc(w / 2, 14, 9, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  // the plank: a soft drop, the board, two quiet grain lines and a sunlit top edge
  roundRect(g, x0, top + 6, pw, ph, 30);
  g.fillStyle = hex(lo);
  g.fill();
  roundRect(g, x0, top, pw, ph, 30);
  const grad = g.createLinearGradient(0, top, 0, top + ph);
  grad.addColorStop(0, hex(hi));
  grad.addColorStop(1, hex(base));
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  g.globalAlpha = 0.22;
  g.strokeStyle = hex(lo);
  g.lineWidth = 4;
  for (const [y, a] of [
    [top + ph * 0.3, 6],
    [top + ph * 0.74, -5],
  ] as const) {
    g.beginPath();
    g.moveTo(x0, y);
    g.bezierCurveTo(w * 0.3, y + a, w * 0.6, y - a, x0 + pw, y + a * 0.5);
    g.stroke();
  }
  g.globalAlpha = 0.5;
  g.fillStyle = hex(CREAM);
  roundRect(g, x0 + 22, top + 7, pw - 44, 7, 4);
  g.fill();
  g.restore();
  roundRect(g, x0, top, pw, ph, 30);
  g.lineWidth = 6;
  g.strokeStyle = hex(lo);
  g.stroke();
  // two little peg holes where the rope ties on
  g.fillStyle = hex(lo);
  for (const px of [w * 0.27, w * 0.73]) {
    g.beginPath();
    g.arc(px, top + 14, 6, 0, Math.PI * 2);
    g.fill();
  }
  // the lettering: cream with a soft ink edge (gold plank: ink lettering with a cream edge)
  const cy = top + ph / 2 + 6;
  let cx = w / 2;
  let maxW = pw - 56;
  if (o.arrow) {
    const ax = x0 + 58;
    g.beginPath();
    g.arc(ax, cy - 2, 30, 0, Math.PI * 2);
    g.fillStyle = hex(LEAF);
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = hex(INK);
    g.stroke();
    g.beginPath();
    g.moveTo(ax, cy - 20);
    g.lineTo(ax + 15, cy - 2);
    g.lineTo(ax + 6, cy - 2);
    g.lineTo(ax + 6, cy + 15);
    g.lineTo(ax - 6, cy + 15);
    g.lineTo(ax - 6, cy - 2);
    g.lineTo(ax - 15, cy - 2);
    g.closePath();
    g.fillStyle = hex(CREAM);
    g.fill();
    g.lineWidth = 3;
    g.stroke();
    cx += 36;
    maxW -= 80;
  }
  g.font = `700 ${FONT_PX}px ${o.font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 12;
  g.strokeStyle = o.gold ? hex(CREAM) : hex(mixHex(INK, WOOD, 0.25));
  g.strokeText(text, cx, cy, maxW);
  g.fillStyle = o.gold ? hex(INK) : hex(CREAM);
  g.fillText(text, cx, cy, maxW);
}

/** The lettering's height as a share of the tag's height (for the 13 px floor). */
const TEXT_SHARE = FONT_PX / TAG_H;

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
 * 13 px lettering floor. The fade multiplies the material's own opacity in the shader, so owners keep their fades.
 */
export function wearTagLook(mesh: THREE.Mesh, planeH: number): void {
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
      const textPx = (planeH * worldScale * TEXT_SHARE * size.y) / Math.max(1e-3, viewH);
      u.uTagGrow.value = tagGrow(textPx);
    }
  };
}
