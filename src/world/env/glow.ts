/**
 * Night glow registry (wave 8, day/night). Windows and lamps keep their normal emissive look by day; at night
 * their shared material's `emissiveIntensity` is pushed up by `darkness` and lamp halos fade in.
 *
 * One entry per *material* (the toon() cache already shares them: shelters, ridge, village, cabin, lamps), so a
 * frame costs a handful of number writes and never traverses the scene. `updateGlow(d)` is driven from
 * Renderer.setDarkness (see Environment). At darkness 0 every value is restored exactly, so day is unchanged.
 * 0.9.8: the comfort Glow setting (`setGlowStrength`, fx/comfort glow) scales the night boost and the halos; 0 keeps
 * every light at its daytime look.
 */
import * as THREE from 'three';
import { CAMERA } from '../../config';
import { additiveKeepAlpha, makeCanvasTexture, markGlow } from '../../render/materials';
import { steadyHighlights } from '../../fx/comfort';

interface Entry {
  mat: THREE.MeshToonMaterial;
  base: number;
  boost: number;
}

const entries: Entry[] = [];
const halos: THREE.Object3D[] = [];
let haloMat: THREE.MeshBasicMaterial | null = null;
let bulbMat: THREE.MeshBasicMaterial | null = null;
let last = -1;
let twinkle = 0;
/** Comfort Glow 0..1. */
let strength = 1;
/** 0.9.13: the night amount × Comfort Glow as a shader uniform (render/duskWindows.ts: windows coming on at dusk). */
export const dusk = { value: 0 };

/**
 * Register a (shared) emissive material: at night its emissiveIntensity becomes `base * boost`.
 * Idempotent per material (the first registration wins).
 */
export function registerGlow<T extends THREE.MeshToonMaterial>(mat: T, boost = 2.7): T {
  if (!entries.some((e) => e.mat === mat)) {
    entries.push({ mat, base: mat.emissiveIntensity, boost });
    if (last > 0) applyEntry(entries[entries.length - 1]!, last);
  }
  return mat;
}

function applyEntry(e: Entry, d: number): void {
  e.mat.emissiveIntensity = d <= 0 ? e.base : e.base * (1 + (e.boost - 1) * d * strength);
}

/** Set the night amount (0 day … 1 night) on every registered glow material and halo. Cheap; safe every frame. */
export function updateGlow(d: number): void {
  if (d === last) return;
  last = d;
  for (const e of entries) applyEntry(e, d);
  dusk.value = Math.max(0, d) * strength;
  if (haloMat) haloMat.opacity = Math.min(1, d * 1.15) * strength;
  const on = d > 0.02 && strength > 0;
  for (const h of halos) h.visible = on;
  setBulbScale();
}

/** Comfort Glow (0..1): re-applies the current night amount at the new strength. */
export function setGlowStrength(k: number): void {
  const v = Math.max(0, Math.min(1, Number.isFinite(k) ? k : 1));
  if (v === strength) return;
  strength = v;
  const d = last;
  last = -1;
  if (d >= 0) updateGlow(d);
}

function setBulbScale(): void {
  if (!bulbMat) return;
  // unlit, so "glowing" means: a little dimmer by day, brighter than the dark scene at night (tone mapping is off)
  const d = Math.max(0, last);
  bulbMat.color.setScalar(0.84 + 0.3 * d * strength + twinkle * (0.03 + 0.05 * d));
}

/**
 * Shared unlit vertex-coloured material for fairy lights / string-light bulbs (wave 9 town + eras). Colours come
 * from the geometry (one merged mesh per set); brightness follows the night amount and twinkles gently.
 */
export function bulbMaterial(): THREE.MeshBasicMaterial {
  if (!bulbMat) {
    bulbMat = markGlow(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 0.85);
    setBulbScale();
  }
  return bulbMat;
}

/** Gentle shimmer of every bulb at once (cheap: one number). Call each frame with the elapsed time. */
export function twinkleBulbs(time: number): void {
  // 0.9.7: the bulbs glow steady with calmer effects / Reduce motion
  twinkle = steadyHighlights() ? 0 : Math.sin(time * 2.3) * 0.5 + Math.sin(time * 5.1 + 1.3) * 0.5;
  setBulbScale();
}

function haloMaterial(): THREE.MeshBasicMaterial {
  if (!haloMat) {
    const { ctx: g, texture } = makeCanvasTexture(64, 64);
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    texture.needsUpdate = true;
    haloMat = additiveKeepAlpha(
      new THREE.MeshBasicMaterial({
        map: texture,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    );
  }
  return haloMat;
}

export interface HaloSpot {
  x: number;
  y: number;
  z: number;
  /** Per-spot override of the disc size / ground pool size. */
  size?: number;
  pool?: number;
}

const WARM_HALO = new THREE.Color(1.0, 0.72, 0.34);

/**
 * ONE additive mesh with, per lamp, a camera-facing glow disc at the lamp head and a soft warm light pool on the
 * ground below it. The iso camera never rotates, so the discs are baked facing it. Hidden by day (0 draw calls).
 */
export function buildHalos(spots: readonly HaloSpot[], opts?: { size?: number; pool?: number; groundY?: number }): THREE.Mesh {
  const size = opts?.size ?? 2.2;
  const pool = opts?.pool ?? 5.2;
  const gy = opts?.groundY ?? 0.05;
  const yaw = THREE.MathUtils.degToRad(CAMERA.yawDeg);
  const pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const up = new THREE.Vector3(-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch));
  const toCam = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const quad = (c: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, half: number, k: number): void => {
    const base = pos.length / 3;
    for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      pos.push(c.x + (a.x * sa + b.x * sb) * half, c.y + (a.y * sa + b.y * sb) * half, c.z + (a.z * sa + b.z * sb) * half);
      uv.push((sa + 1) / 2, (sb + 1) / 2);
      col.push(WARM_HALO.r * k, WARM_HALO.g * k, WARM_HALO.b * k);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const c = new THREE.Vector3();
  const gx = new THREE.Vector3(1, 0, 0);
  const gz = new THREE.Vector3(0, 0, -1); // faces +Y (normal = gx × gz)
  for (const s of spots) {
    // pull the disc toward the camera so the lamp's own roof does not clip it
    c.set(s.x, s.y, s.z).addScaledVector(toCam, 0.7);
    quad(c, right, up, (s.size ?? size) / 2, 0.85);
    c.set(s.x, gy, s.z);
    quad(c, gx, gz, (s.pool ?? pool) / 2, 0.42);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geom.setIndex(idx);
  geom.computeBoundingSphere();
  const m = new THREE.Mesh(geom, haloMaterial());
  m.name = 'lamp-halos';
  m.castShadow = false;
  m.receiveShadow = false;
  m.renderOrder = 5;
  m.visible = last > 0.02;
  halos.push(m);
  return m;
}
