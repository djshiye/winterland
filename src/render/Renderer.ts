/**
 * [B1 — engine] WebGL renderer, scene, lights and shadows.
 *
 * - WebGLRenderer (antialias, sRGB output, neutral tone mapping so palette colours stay vibrant,
 *   pixel ratio ≤ 2), canvas fills `container`.
 * - Scene background = PALETTE.sky; no fog needed (orthographic).
 * - Day/night (wave 8): `setDarkness(d)` blends background, hemisphere and sun colour / intensity between the day
 *   look (d = 0, exactly LIGHTING.* / PALETTE.sky), a warm dusk (d = 0.5) and a moonlit blue night (d = 1). The
 *   sun keeps its position and shadow camera; only colour and intensity change. render() pulls the value from
 *   `darknessSource` (set by the Environment) so a paused debug render() follows the clock too.
 * - HemisphereLight (LIGHTING.hemi*) + one DirectionalLight "sun" (LIGHTING.sun*) with PCF (soft) shadows (PCFSoftShadowMap was removed in three r18x),
 *   LIGHTING.shadowMapSize, orthographic shadow box ±LIGHTING.shadowExtent.
 * - setShadowFocus(p) moves the sun + its target so the shadow box stays centred on p, snapped to
 *   shadow-map texels to avoid shimmering while the camera glides.
 * - OrthographicCamera is created here; CameraRig owns its placement & frustum.
 * - setQuality('high' | 'low'): high = PCF shadows + pixel ratio ≤ 2; low = no shadows, pixel ratio 1 (slow computers).
 *   Persisted in localStorage 'winterland:quality' and applied at construction. `stats` = last frame's draw calls / triangles.
 * - setScale(s) (wave 10): render-resolution scale 0.5..1 in 0.05 steps, multiplies the pixel ratio (Low = 1 × scale).
 *   Persisted in localStorage 'winterland:scale' (default 1, invalid → 1) and applied at construction. The canvas CSS
 *   size stays the container size (setSize updateStyle), only the backing store shrinks, so it still fills the view.
 */
import * as THREE from 'three';
import { LIGHTING, PALETTE } from '../config';
import { hideInstanced, prepareInstances, prepareSharedInstances, restoreInstances } from './instancer';

export type Quality = 'high' | 'low';

const QUALITY_KEY = 'winterland:quality';
const SCALE_KEY = 'winterland:scale';

/** Clamp to 0.5..1 and round to 0.05; non-finite → 1. */
export function normalizeScale(s: number): number {
  if (!Number.isFinite(s)) return 1;
  return Math.round(Math.max(0.5, Math.min(1, s)) * 20) / 20;
}

// Day / dusk / night looks (hex = sRGB). Day is the original LIGHTING / PALETTE look and stays untouched.
const SKY = { day: PALETTE.sky, dusk: 0xf0967a, night: 0x131b45 };
const HEMI_SKY = { day: LIGHTING.hemiSky, dusk: 0xffc4a6, night: 0x7a92e6 };
const HEMI_GROUND = { day: LIGHTING.hemiGround, dusk: 0xc08294, night: 0x4a5aa0 };
const SUN = { day: LIGHTING.sunColor, dusk: 0xff9c5e, night: 0xa4b8ff };
const HEMI_I = { day: LIGHTING.hemiIntensity, dusk: 1.25, night: 1.3 };
const SUN_I = { day: LIGHTING.sunIntensity, dusk: 1.9, night: 1.2 };

/** Three cached colours (day / dusk / night) for one lit property. */
class Tri {
  readonly day: THREE.Color;
  readonly dusk: THREE.Color;
  readonly night: THREE.Color;
  constructor(c: { day: number; dusk: number; night: number }) {
    this.day = new THREE.Color(c.day);
    this.dusk = new THREE.Color(c.dusk);
    this.night = new THREE.Color(c.night);
  }
  /** `out` = day … dusk (d 0…0.5) … night (d 1); exactly `day` at d = 0. */
  blend(out: THREE.Color, d: number): void {
    if (d <= 0) out.copy(this.day);
    else if (d < 0.5) out.lerpColors(this.day, this.dusk, d * 2);
    else out.lerpColors(this.dusk, this.night, (d - 0.5) * 2);
  }
}

const triNum = (t: { day: number; dusk: number; night: number }, d: number): number =>
  d <= 0 ? t.day : d < 0.5 ? t.day + (t.dusk - t.day) * d * 2 : t.dusk + (t.night - t.dusk) * (d - 0.5) * 2;

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly domElement: HTMLCanvasElement;

  private readonly sunOffset = new THREE.Vector3(LIGHTING.sunOffset.x, LIGHTING.sunOffset.y, LIGHTING.sunOffset.z);
  /** Light-space basis (right / up) for texel snapping. */
  private readonly lightRight = new THREE.Vector3();
  private readonly lightUp = new THREE.Vector3();
  private readonly texel: number;
  private readonly snapped = new THREE.Vector3();
  private q: Quality = 'high';
  /** Returns the current night amount (0 day … 1 night); the Environment sets it. Read once per render(). */
  darknessSource: (() => number) | null = null;
  private lastDark = -1;
  private readonly darkListeners: Array<(d: number) => void> = [];
  private readonly triSky = new Tri(SKY);
  private readonly triHemiSky = new Tri(HEMI_SKY);
  private readonly triHemiGround = new Tri(HEMI_GROUND);
  private readonly triSun = new Tri(SUN);

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    try {
      if (localStorage.getItem(QUALITY_KEY) === 'low') this.q = 'low';
      const raw = localStorage.getItem(SCALE_KEY);
      if (raw !== null && raw.trim() !== '') this.scale = normalizeScale(Number(raw));
    } catch {
      /* storage unavailable */
    }
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = this.q === 'high';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.domElement = this.renderer.domElement;
    this.domElement.style.touchAction = 'none';
    container.appendChild(this.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.sky);
    // pooled NPC / vehicle parts need this frame's world matrices: fold them in after three updates them
    this.scene.onBeforeRender = (_r, scene, camera) => {
      const sh = this.sun.castShadow && this.renderer.shadowMap.enabled ? this.sun.shadow : null;
      if (sh) sh.updateMatrices(this.sun); // what the shadow pass is about to use (it recomputes the same)
      if (this.instancing) prepareSharedInstances(scene, camera, sh ? sh.camera : null);
    };
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);

    this.hemi = new THREE.HemisphereLight(LIGHTING.hemiSky, LIGHTING.hemiGround, LIGHTING.hemiIntensity);
    this.sun = new THREE.DirectionalLight(LIGHTING.sunColor, LIGHTING.sunIntensity);
    this.sun.position.copy(this.sunOffset);
    this.sun.castShadow = this.q === 'high';
    const sh = this.sun.shadow;
    sh.mapSize.set(LIGHTING.shadowMapSize, LIGHTING.shadowMapSize);
    const e = LIGHTING.shadowExtent;
    Object.assign(sh.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: this.sunOffset.length() * 2 + 40 });
    sh.camera.updateProjectionMatrix();
    sh.bias = -0.0004;
    sh.normalBias = 0.03;
    sh.radius = 2;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    // Fixed light direction -> precompute the light's right/up axes once.
    const dir = this.sunOffset.clone().normalize();
    this.lightRight.set(0, 1, 0).cross(dir).normalize();
    this.lightUp.copy(dir).cross(this.lightRight).normalize();
    this.texel = (2 * e) / LIGHTING.shadowMapSize;

    this.resize();
  }

  /** Current night amount applied to the lights (0 day … 1 night). */
  get darkness(): number {
    return Math.max(0, this.lastDark);
  }

  /** Be told whenever the night amount changes (glow materials, aurora). Called with the new value. */
  onDarkness(fn: (d: number) => void): void {
    this.darkListeners.push(fn);
    if (this.lastDark >= 0) fn(this.lastDark);
  }

  /**
   * Blend sky / hemisphere / sun from `d` (0 day … 1 night). No allocations; does nothing when `d` is unchanged.
   * The sun's position and shadow camera are never touched.
   */
  setDarkness(d: number): void {
    d = d < 0 ? 0 : d > 1 ? 1 : d;
    if (d === this.lastDark) return;
    this.lastDark = d;
    this.triSky.blend(this.scene.background as THREE.Color, d);
    this.triHemiSky.blend(this.hemi.color, d);
    this.triHemiGround.blend(this.hemi.groundColor, d);
    this.triSun.blend(this.sun.color, d);
    this.hemi.intensity = triNum(HEMI_I, d);
    this.sun.intensity = triNum(SUN_I, d);
    for (const fn of this.darkListeners) fn(d);
  }

  /** Current graphics quality. */
  get quality(): Quality {
    return this.q;
  }

  /** Draw calls and triangles of the last render() (shadow pass included). */
  get stats(): { calls: number; triangles: number } {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  }

  /** Switch shadows / resolution; persists the choice. Materials recompile once on the next frame. */
  setQuality(q: Quality): void {
    try {
      localStorage.setItem(QUALITY_KEY, q);
    } catch {
      /* storage unavailable */
    }
    if (q === this.q) return;
    this.q = q;
    const shadows = q === 'high';
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    if (!shadows && this.sun.shadow.map) {
      // free the 2048² depth target; three recreates it when shadows come back
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    // the shadow define is baked into each program, so every material has to be rebuilt once
    const seen = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        mat.needsUpdate = true;
      }
    });
    this.resize();
  }

  /** Wave 10: render resolution scale 0.5..1 (persisted 'winterland:scale', default 1). Multiplies the pixel ratio. */
  scale = 1;

  /** Clamp 0.5..1, round to 0.05, persist, and resize the drawing buffer. */
  setScale(s: number): void {
    this.scale = normalizeScale(s);
    try {
      localStorage.setItem(SCALE_KEY, String(this.scale));
    } catch {
      /* storage unavailable */
    }
    this.resize();
  }

  private pixelRatio(): number {
    return (this.q === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2)) * this.scale;
  }

  /** Canvas size in CSS pixels. */
  get width(): number {
    return this.container.clientWidth || window.innerWidth;
  }

  get height(): number {
    return this.container.clientHeight || window.innerHeight;
  }

  /** Keep the shadow camera centred on `focus` (snapped to shadow texels so shadows never shimmer). */
  setShadowFocus(focus: THREE.Vector3): void {
    const r = focus.dot(this.lightRight);
    const u = focus.dot(this.lightUp);
    const sr = Math.round(r / this.texel) * this.texel - r;
    const su = Math.round(u / this.texel) * this.texel - u;
    this.snapped.copy(focus).addScaledVector(this.lightRight, sr).addScaledVector(this.lightUp, su);
    this.sun.target.position.copy(this.snapped);
    this.sun.position.copy(this.snapped).add(this.sunOffset);
    this.sun.target.updateMatrixWorld();
  }

  /** Match the drawing buffer to the container (CameraRig.resize handles the frustum). */
  resize(): void {
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(this.width, this.height);
  }

  /** Draw repeated items / NPC parts instanced (render/instancer.ts). Off = every mesh draws itself (A/B checks). */
  instancing = true;

  render(): void {
    if (this.darknessSource) this.setDarkness(this.darknessSource());
    // repeated pile / stack items and NPC parts draw as one instanced mesh per kind (render/instancer.ts)
    if (this.instancing) prepareInstances(this.scene);
    else hideInstanced();
    try {
      this.renderer.render(this.scene, this.camera);
    } finally {
      restoreInstances();
    }
  }
}
