/**
 * [B1 — engine] WebGL renderer, scene, lights and shadows.
 *
 * - WebGLRenderer (antialias, sRGB output, neutral tone mapping so palette colours stay vibrant (the post stack applies the
 *   same tone mapping itself),
 *   pixel ratio ≤ 2), canvas fills `container`.
 * - Scene background = PALETTE.sky; no fog needed (orthographic).
 * - Day/night (wave 8): `setDarkness(d)` blends background, hemisphere and sun colour / intensity between the era's
 *   daylight (d = 0: PALETTE.sky, LIGHTING.* scaled and tinted by the era's palette `look.day`), a warm dusk (d = 0.5)
 *   and the era's warm night (d = 1). The
 *   sun keeps its position and shadow camera; only colour and intensity change. render() pulls the value from
 *   `darknessSource` (set by the Environment) so a paused debug render() follows the clock too.
 * - HemisphereLight (LIGHTING.hemi*) + one DirectionalLight "sun" (LIGHTING.sun*) with PCF (soft) shadows (PCFSoftShadowMap was removed in three r18x),
 *   LIGHTING.shadowMapSize, orthographic shadow box ±LIGHTING.shadowExtent.
 * - setShadowFocus(p) moves the sun + its target so the shadow box stays centred on p, snapped to
 *   shadow-map texels to avoid shimmering while the camera glides.
 * - OrthographicCamera is created here; CameraRig owns its placement & frustum.
 * - 0.9.8 quality tiers (DIRECTION V13), setQuality('low' | 'medium' | 'high'), persisted in localStorage
 *   'winterland:quality' (0.9.7's 'high' / 'low' keep meaning the same) and applied at construction:
 *     Low    no shadows, pixel ratio 1, drawn straight to the screen (no post);
 *     Medium 1024² shadows, pixel ratio ≤ 1.5, post: outlines, bloom (3 levels), grade, vignette (render/PostFX.ts);
 *     High   2048² shadows, pixel ratio ≤ 2, post as Medium with 4 bloom levels, 4× MSAA and a gentle depth of field.
 *   `stats` = the last frame's draw calls / triangles: shadow pass, scene and post passes together.
 * - 0.9.8 era looks: `eraSource` (set by the Environment) says which era the camera is in (1 outside the regions); its
 *   palette look (render/palette.ts EraLook: its daylight, a warm night and a day / night colour grade) crossfades in over
 *   LOOK_FADE seconds. `glow` (the comfort Glow slider, 0..1) scales the bloom.
 * - setScale(s) (wave 10): render-resolution scale 0.5..1 in 0.05 steps, multiplies the pixel ratio (Low = 1 × scale).
 *   Persisted in localStorage 'winterland:scale' (default 1, invalid → 1) and applied at construction. The canvas CSS
 *   size stays the container size (setSize updateStyle), only the backing store shrinks, so it still fills the view.
 */
import * as THREE from 'three';
import { LIGHTING, PALETTE } from '../config';
import { hideInstanced, prepareInstances, prepareSharedInstances, restoreInstances } from './instancer';
import { eraIndex, palette, type DayLight, type Grade, type NightLight } from './palette';
import { PostFX, type PostFrame } from './PostFX';

export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

/** What each tier turns on (see the file header). */
export const TIERS: Record<Quality, { shadows: number; maxRatio: number; post: boolean; samples: number; bloomLevels: number; dof: boolean }> = {
  low: { shadows: 0, maxRatio: 1, post: false, samples: 0, bloomLevels: 0, dof: false },
  medium: { shadows: 1024, maxRatio: 1.5, post: true, samples: 2, bloomLevels: 3, dof: false },
  high: { shadows: LIGHTING.shadowMapSize, maxRatio: 2, post: true, samples: 4, bloomLevels: 4, dof: true },
};

const QUALITY_KEY = 'winterland:quality';
const SCALE_KEY = 'winterland:scale';

/** Seconds an era's look takes to fade in when the camera moves into it. */
const LOOK_FADE = 1.6;
/** Bloom by day / at night (× the Glow comfort setting). */
const BLOOM_DAY = 0.45;
const BLOOM_NIGHT = 1.15;
/** Ink outline strength. */
const OUTLINE = 0.7;

/** A stored quality ('low' / 'medium' / 'high'); anything else is null. */
export function parseQuality(v: unknown): Quality | null {
  return QUALITIES.includes(v as Quality) ? (v as Quality) : null;
}

/** Clamp to 0.5..1 and round to 0.05; non-finite → 1. */
export function normalizeScale(s: number): number {
  if (!Number.isFinite(s)) return 1;
  return Math.round(Math.max(0.5, Math.min(1, s)) * 20) / 20;
}

// Day / dusk looks (hex = sRGB). Day is LIGHTING / PALETTE scaled and tinted by the era's palette `look.day`; night
// comes from the era's palette look.
const SKY = { day: PALETTE.sky, dusk: 0xf0a08a };
const HEMI_SKY = { day: LIGHTING.hemiSky, dusk: 0xffc8aa };
const HEMI_GROUND = { day: LIGHTING.hemiGround, dusk: 0xc08a8c };
const SUN = { day: LIGHTING.sunColor, dusk: 0xff9c5e };
const HEMI_I = { day: LIGHTING.hemiIntensity, dusk: 1.25, night: 1.2 };
const SUN_I = { day: LIGHTING.sunIntensity, dusk: 1.9, night: 1.0 };

const color = (hex: number): THREE.Color => new THREE.Color(hex);
/** A grade colour in sRGB numbers (no linear conversion: the grade runs after the sRGB encode). */
const raw = (hex: number, out = new THREE.Color()): THREE.Color => out.setHex(hex, THREE.LinearSRGBColorSpace);

/** `out` = day … dusk (d 0…0.5) … night (d 1); exactly `day` at d = 0. */
function tri(out: THREE.Color, day: THREE.Color, dusk: THREE.Color, night: THREE.Color, d: number): void {
  if (d <= 0) out.copy(day);
  else if (d < 0.5) out.lerpColors(day, dusk, d * 2);
  else out.lerpColors(dusk, night, (d - 0.5) * 2);
}

const triNum = (t: { day: number; dusk: number; night: number }, d: number): number =>
  d <= 0 ? t.day : d < 0.5 ? t.day + (t.dusk - t.day) * d * 2 : t.dusk + (t.night - t.dusk) * (d - 0.5) * 2;

/** Daylight, night light and grades of one era as colours (cached per era). */
interface LookColors {
  day: { hemiSky: THREE.Color; hemiGround: THREE.Color; sun: number; hemi: number };
  night: Record<keyof NightLight, THREE.Color>;
  bright: GradeColors;
  dark: GradeColors;
}
interface GradeColors {
  tint: THREE.Color;
  lift: THREE.Color;
  saturation: number;
  contrast: number;
  vignette: number;
}

const lookCache = new Map<number, LookColors>();
function lookColors(era: number): LookColors {
  let l = lookCache.get(era);
  if (!l) {
    const p = palette(era).look;
    const g = (x: Grade): GradeColors => ({ tint: raw(x.tint), lift: raw(x.lift), saturation: x.saturation, contrast: x.contrast, vignette: x.vignette });
    const dl: DayLight = p.day;
    l = {
      day: { hemiSky: color(dl.hemiSky), hemiGround: color(dl.hemiGround), sun: LIGHTING.sunIntensity * dl.sun, hemi: LIGHTING.hemiIntensity * dl.hemi },
      night: { sky: color(p.night.sky), hemiSky: color(p.night.hemiSky), hemiGround: color(p.night.hemiGround), moon: color(p.night.moon) },
      bright: g(p.grade.day),
      dark: g(p.grade.night),
    };
    lookCache.set(era, l);
  }
  return l;
}

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
  private texel: number;
  private readonly snapped = new THREE.Vector3();
  private readonly sunScratch = new THREE.Vector3();
  private q: Quality = 'high';
  private post: PostFX | null = null;
  /** Returns the current night amount (0 day … 1 night); the Environment sets it. Read once per render(). */
  darknessSource: (() => number) | null = null;
  /** Returns the era (1..10) the camera is in; the Environment sets it. Read once per render(). */
  eraSource: (() => number) | null = null;
  /** Glow comfort setting 0..1: scales the bloom (fx/comfort.ts, wired by the Environment). */
  glow = 1;
  private lastDark = -1;
  private readonly darkListeners: Array<(d: number) => void> = [];
  private readonly day = { sky: color(SKY.day), hemiSky: color(HEMI_SKY.day), hemiGround: color(HEMI_GROUND.day), sun: color(SUN.day) };
  private readonly dusk = { sky: color(SKY.dusk), hemiSky: color(HEMI_SKY.dusk), hemiGround: color(HEMI_GROUND.dusk), sun: color(SUN.dusk) };
  /** The blended era daylight intensities (crossfading between two eras' looks; colours live in `day`). */
  private readonly hemiI: { day: number; dusk: number; night: number } = { ...HEMI_I };
  private readonly sunI: { day: number; dusk: number; night: number } = { ...SUN_I };
  /** The blended era night (crossfading between two eras' looks). */
  private readonly night = { sky: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), moon: new THREE.Color() };
  private eraFrom = 1;
  private eraTo = 1;
  /** Crossfade progress from eraFrom to eraTo (1 = done). */
  private eraT = 1;
  private lastLookAt = 0;
  private lookDirty = true;
  private readonly frame: PostFrame = {
    bloom: 0,
    outline: OUTLINE,
    tint: new THREE.Color(1, 1, 1),
    lift: new THREE.Color(0, 0, 0),
    saturation: 1,
    contrast: 1,
    vignette: 0,
    pixelRatio: 1,
    focus: 70,
  };
  private readonly gradeA = { tint: new THREE.Color(), lift: new THREE.Color() };
  private readonly gradeB = { tint: new THREE.Color(), lift: new THREE.Color() };

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    try {
      this.q = parseQuality(localStorage.getItem(QUALITY_KEY)) ?? 'high';
      const raw = localStorage.getItem(SCALE_KEY);
      if (raw !== null && raw.trim() !== '') this.scale = normalizeScale(Number(raw));
    } catch {
      /* storage unavailable */
    }
    // shadow, scene and post passes all count toward `stats` (reset once per frame in render())
    this.renderer.info.autoReset = false;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = TIERS[this.q].shadows > 0;
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
    this.sun.castShadow = TIERS[this.q].shadows > 0;
    const sh = this.sun.shadow;
    const size = TIERS[this.q].shadows || LIGHTING.shadowMapSize;
    sh.mapSize.set(size, size);
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
    this.texel = (2 * e) / size;

    this.makePost();
    this.applyLook(0);
    this.resize();
  }

  /** Current night amount applied to the lights (0 day … 1 night). */
  get darkness(): number {
    return Math.max(0, this.lastDark);
  }

  /** The era whose look is showing (the one fading in, while it fades). */
  get era(): number {
    return this.eraTo;
  }

  /** Be told whenever the night amount changes (glow materials, aurora). Called with the new value. */
  onDarkness(fn: (d: number) => void): void {
    this.darkListeners.push(fn);
    if (this.lastDark >= 0) fn(this.lastDark);
  }

  /**
   * Blend sky / hemisphere / sun from `d` (0 day … 1 night). No allocations; does nothing when `d` and the era look are
   * unchanged. The sun's position and shadow camera are never touched.
   */
  setDarkness(d: number): void {
    d = d < 0 ? 0 : d > 1 ? 1 : d;
    if (d === this.lastDark && !this.lookDirty) return;
    const changed = d !== this.lastDark;
    this.lastDark = d;
    this.lookDirty = false;
    const n = this.night;
    tri(this.scene.background as THREE.Color, this.day.sky, this.dusk.sky, n.sky, d);
    tri(this.hemi.color, this.day.hemiSky, this.dusk.hemiSky, n.hemiSky, d);
    tri(this.hemi.groundColor, this.day.hemiGround, this.dusk.hemiGround, n.hemiGround, d);
    tri(this.sun.color, this.day.sun, this.dusk.sun, n.moon, d);
    this.hemi.intensity = triNum(this.hemiI, d);
    this.sun.intensity = triNum(this.sunI, d);
    this.blendGrade(d);
    if (changed) for (const fn of this.darkListeners) fn(d);
  }

  /**
   * 0.9.8 sky (world/sky/Sky.ts): where the sun stands (its offset from the shadow focus) and the daytime sun and sky
   * colours, moved gently over the day. Takes effect on the next render() / setShadowFocus(). No allocations.
   */
  setSunPath(offset: THREE.Vector3, sun: THREE.Color, hemiSky: THREE.Color): void {
    if (!offset.equals(this.sunOffset)) {
      this.sunOffset.copy(offset);
      const dir = this.sunScratch.copy(offset).normalize();
      this.lightRight.set(0, 1, 0).cross(dir).normalize();
      this.lightUp.copy(dir).cross(this.lightRight).normalize();
      this.sun.shadow.camera.far = offset.length() * 2 + 40;
      this.sun.shadow.camera.updateProjectionMatrix();
    }
    if (!sun.equals(this.day.sun) || !hemiSky.equals(this.day.hemiSky)) {
      this.day.sun.copy(sun);
      this.day.hemiSky.copy(hemiSky);
      this.lookDirty = true;
    }
  }

  /** Show era `era`'s look (1..10): fades in over LOOK_FADE seconds, or at once with `instant`. */
  setEra(era: number, instant = false): void {
    const n = eraIndex(era);
    if (instant) {
      this.eraFrom = this.eraTo = n;
      this.eraT = 1;
      this.applyLook(1);
      return;
    }
    if (n === this.eraTo) return;
    // fading back toward where we came from: continue from the current mix instead of jumping
    if (n === this.eraFrom && this.eraT < 1) this.eraT = 1 - this.eraT;
    else this.eraT = 0;
    this.eraFrom = this.eraTo;
    this.eraTo = n;
    this.applyLook(this.eraT);
  }

  /** Blend the two eras' daylights and nights at crossfade `t` (smoothstep), then re-light. */
  private applyLook(t: number): void {
    const A = lookColors(this.eraFrom);
    const B = lookColors(this.eraTo);
    const k = t * t * (3 - 2 * t);
    this.day.hemiSky.lerpColors(A.day.hemiSky, B.day.hemiSky, k);
    this.day.hemiGround.lerpColors(A.day.hemiGround, B.day.hemiGround, k);
    this.hemiI.day = A.day.hemi + (B.day.hemi - A.day.hemi) * k;
    this.sunI.day = A.day.sun + (B.day.sun - A.day.sun) * k;
    const a = A.night;
    const b = B.night;
    this.night.sky.lerpColors(a.sky, b.sky, k);
    this.night.hemiSky.lerpColors(a.hemiSky, b.hemiSky, k);
    this.night.hemiGround.lerpColors(a.hemiGround, b.hemiGround, k);
    this.night.moon.lerpColors(a.moon, b.moon, k);
    this.lookDirty = true;
    if (this.lastDark >= 0) this.setDarkness(this.lastDark);
  }

  /** The post frame's grade for night amount `d` and the current era crossfade. */
  private blendGrade(d: number): void {
    const t = this.eraT * this.eraT * (3 - 2 * this.eraT);
    const A = lookColors(this.eraFrom);
    const B = lookColors(this.eraTo);
    const f = this.frame;
    const pick = (L: LookColors, out: { tint: THREE.Color; lift: THREE.Color }): { s: number; c: number; v: number } => {
      out.tint.lerpColors(L.bright.tint, L.dark.tint, d);
      out.lift.lerpColors(L.bright.lift, L.dark.lift, d);
      return {
        s: L.bright.saturation + (L.dark.saturation - L.bright.saturation) * d,
        c: L.bright.contrast + (L.dark.contrast - L.bright.contrast) * d,
        v: L.bright.vignette + (L.dark.vignette - L.bright.vignette) * d,
      };
    };
    const a = pick(A, this.gradeA);
    const b = pick(B, this.gradeB);
    f.tint.lerpColors(this.gradeA.tint, this.gradeB.tint, t);
    f.lift.lerpColors(this.gradeA.lift, this.gradeB.lift, t);
    f.saturation = a.s + (b.s - a.s) * t;
    f.contrast = a.c + (b.c - a.c) * t;
    f.vignette = a.v + (b.v - a.v) * t;
  }

  /** Current graphics quality. */
  get quality(): Quality {
    return this.q;
  }

  /** Draw calls and triangles of the last render() (shadow pass, scene and post passes). */
  get stats(): { calls: number; triangles: number } {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  }

  /** Switch tier (shadows, resolution, post); persists the choice. Materials recompile once on the next frame. */
  setQuality(q: Quality): void {
    try {
      localStorage.setItem(QUALITY_KEY, q);
    } catch {
      /* storage unavailable */
    }
    if (q === this.q) return;
    const before = TIERS[this.q];
    this.q = q;
    const tier = TIERS[q];
    const shadows = tier.shadows > 0;
    const sh = this.sun.shadow;
    if (sh.map && (!shadows || sh.mapSize.x !== tier.shadows)) {
      // free the depth target; three recreates it at the new size when shadows are drawn
      sh.map.dispose();
      sh.map = null;
    }
    if (shadows) {
      sh.mapSize.set(tier.shadows, tier.shadows);
      this.texel = (2 * LIGHTING.shadowExtent) / tier.shadows;
    }
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    this.makePost();
    if (shadows !== before.shadows > 0) {
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
    }
    this.resize();
  }

  /** (Re)build the post stack for the current tier. */
  private makePost(): void {
    this.post?.dispose();
    const t = TIERS[this.q];
    this.post = t.post ? new PostFX({ bloomLevels: t.bloomLevels, dof: t.dof, samples: t.samples }) : null;
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
    return Math.min(window.devicePixelRatio || 1, TIERS[this.q].maxRatio) * this.scale;
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
    if (this.post) {
      const v = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.post.setSize(v.x, v.y);
    }
  }

  /** Draw repeated items / NPC parts instanced (render/instancer.ts). Off = every mesh draws itself (A/B checks). */
  instancing = true;

  /** Advance the era crossfade by real time (so a paused debug render() never animates it). */
  private stepLook(): void {
    const now = performance.now();
    const dt = this.lastLookAt ? Math.min(0.1, (now - this.lastLookAt) / 1000) : 0;
    this.lastLookAt = now;
    if (this.eraSource) this.setEra(this.eraSource());
    if (this.eraT < 1) {
      this.eraT = Math.min(1, this.eraT + dt / LOOK_FADE);
      this.applyLook(this.eraT);
    }
  }

  render(): void {
    this.renderer.info.reset();
    this.stepLook();
    if (this.darknessSource) this.setDarkness(this.darknessSource());
    // repeated pile / stack items and NPC parts draw as one instanced mesh per kind (render/instancer.ts)
    try {
      if (this.instancing) prepareInstances(this.scene);
      else hideInstanced();
      const post = this.post;
      if (post) {
        this.renderer.setRenderTarget(post.scene);
        this.renderer.render(this.scene, this.camera);
        const f = this.frame;
        const d = this.darkness;
        f.bloom = (BLOOM_DAY + (BLOOM_NIGHT - BLOOM_DAY) * d) * Math.max(0, Math.min(1, this.glow));
        f.pixelRatio = this.renderer.getPixelRatio();
        f.focus = this.camera.position.distanceTo(this.sun.target.position);
        post.render(this.renderer, this.camera, f);
      } else {
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);
      }
    } finally {
      restoreInstances();
    }
  }
}
