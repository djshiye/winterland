/**
 * [0.9.8 — look foundation] The post stack of the Medium and High quality tiers (DIRECTION V7, D3): the scene is drawn
 * into an HDR target and then composited to the screen in one pass with
 * - soft ink outlines on depth edges (a depth Laplacian, so flat slopes never draw lines; warm dark ink, never black);
 * - selective bloom: only pixels that glow (the alpha glow mask written by every material, render/materials.ts) feed a
 *   small dual-filter blur chain, so windows, lamps and furnace mouths bloom and bright snow never does;
 * - Neutral tone mapping, then the era's colour grade (tint, plum shadow lift, saturation, contrast) and a soft vignette
 *   toward the lift colour (palette.ts EraLook);
 * - High only: a gentle depth of field around the camera's focus (the player), a toy-diorama tilt that only touches
 *   things far in front of or behind the player.
 * Cost: a handful of full-screen passes and draw calls (`passes` counts them), no extra scene draws.
 */
import * as THREE from 'three';

export interface PostSettings {
  /** Bloom chain depth (0 = no bloom). */
  bloomLevels: number;
  dof: boolean;
  /** MSAA samples of the scene target. */
  samples: number;
}

/** Values the Renderer sets every frame. Colours are linear 0..1 triples (sRGB space for the grade). */
export interface PostFrame {
  bloom: number;
  outline: number;
  tint: THREE.Color;
  lift: THREE.Color;
  saturation: number;
  contrast: number;
  vignette: number;
  /** CSS-to-buffer pixel ratio (outline width). */
  pixelRatio: number;
  /** View-space distance of the focus point (DOF). */
  focus: number;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Glow pixels only (rgb × (1 − alpha)), into the first bloom level. */
const PREFILTER = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 texel;
varying vec2 vUv;
vec3 tap(vec2 o) {
  vec4 c = texture2D(tSrc, vUv + o * texel);
  return min(c.rgb, vec3(8.0)) * clamp(1.0 - c.a, 0.0, 1.0);
}
void main() {
  vec3 s = tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0));
  gl_FragColor = vec4(s * 0.25, 1.0);
}`;

/** Dual-filter downsample (5 taps). */
const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + vec2(-1.0, -1.0) * texel).rgb;
  s += texture2D(tSrc, vUv + vec2(1.0, -1.0) * texel).rgb;
  s += texture2D(tSrc, vUv + vec2(-1.0, 1.0) * texel).rgb;
  s += texture2D(tSrc, vUv + vec2(1.0, 1.0) * texel).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

/** Dual-filter upsample (8-tap tent of the coarser level) plus the finer level. */
const UP = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tFine;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSrc, vUv + vec2(-2.0, 0.0) * texel).rgb;
  s += texture2D(tSrc, vUv + vec2(2.0, 0.0) * texel).rgb;
  s += texture2D(tSrc, vUv + vec2(0.0, -2.0) * texel).rgb;
  s += texture2D(tSrc, vUv + vec2(0.0, 2.0) * texel).rgb;
  s += texture2D(tSrc, vUv + vec2(-1.0, -1.0) * texel).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(1.0, -1.0) * texel).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(-1.0, 1.0) * texel).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(1.0, 1.0) * texel).rgb * 2.0;
  gl_FragColor = vec4(s / 12.0 + texture2D(tFine, vUv).rgb, 1.0);
}`;

/** Half-resolution soft copy of the scene for the depth of field. */
const BLUR = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(-1.5, -1.5) * texel).rgb;
  s += texture2D(tSrc, vUv + vec2(1.5, -1.5) * texel).rgb;
  s += texture2D(tSrc, vUv + vec2(-1.5, 1.5) * texel).rgb;
  s += texture2D(tSrc, vUv + vec2(1.5, 1.5) * texel).rgb;
  s += texture2D(tSrc, vUv + vec2(-3.0, 0.0) * texel).rgb * 0.5;
  s += texture2D(tSrc, vUv + vec2(3.0, 0.0) * texel).rgb * 0.5;
  s += texture2D(tSrc, vUv + vec2(0.0, -3.0) * texel).rgb * 0.5;
  s += texture2D(tSrc, vUv + vec2(0.0, 3.0) * texel).rgb * 0.5;
  gl_FragColor = vec4(min(s / 8.0, vec3(8.0)), 1.0);
}`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform sampler2D tBlur;
uniform vec2 texel;
uniform float near;
uniform float far;
uniform float outline;
uniform float outlinePx;
uniform float bloom;
uniform vec3 tint;
uniform vec3 lift;
uniform float saturation;
uniform float contrast;
uniform float vignette;
uniform float aspect;
uniform float focus;
uniform float dof;
varying vec2 vUv;

float viewZ(vec2 uv) {
  return near + texture2D(tDepth, uv).x * (far - near);
}

// three's Neutral tone mapping (Khronos PBR Neutral), as the Low tier gets from the renderer
vec3 neutral(vec3 color) {
  const float StartCompression = 0.8 - 0.04;
  const float Desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < StartCompression) return color;
  float d = 1.0 - StartCompression;
  float newPeak = 1.0 - d * d / (peak + d - StartCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (Desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  float z = viewZ(vUv);

  #ifdef DOF
    float coc = smoothstep(24.0, 60.0, abs(z - focus)) * dof;
    c = mix(c, texture2D(tBlur, vUv).rgb, coc);
  #else
    float coc = 0.0;
  #endif

  // soft ink on the near side of depth steps (a Laplacian: flat or sloped ground draws no line)
  vec2 o = texel * outlinePx;
  float lap = viewZ(vUv + vec2(o.x, 0.0)) + viewZ(vUv - vec2(o.x, 0.0)) + viewZ(vUv + vec2(0.0, o.y)) + viewZ(vUv - vec2(0.0, o.y)) - 4.0 * z;
  float edge = smoothstep(0.35, 1.4, lap) * outline * (1.0 - coc);
  c = mix(c, c * vec3(0.46, 0.36, 0.36) + vec3(0.012, 0.008, 0.01), edge);

  #ifdef BLOOM
    c += texture2D(tBloom, vUv).rgb * bloom;
  #endif

  c = toSRGB(clamp(neutral(c), 0.0, 1.0));

  // grade: era tint, saturation, contrast, then lift the shadows toward plum
  c *= tint;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c = (c - 0.5) * contrast + 0.5;
  c = lift + clamp(c, 0.0, 1.0) * (1.0 - lift);

  // vignette toward the lift colour (soft, corners only)
  vec2 v = (vUv - 0.5) * vec2(aspect, 1.0);
  float r = length(v) / length(vec2(aspect, 1.0) * 0.5);
  c = mix(c, c * (0.62 + lift * 2.0), vignette * smoothstep(0.55, 1.05, r));

  gl_FragColor = vec4(c, 1.0);
}`;

function pass(frag: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false });
}

function target(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
}

export class PostFX {
  /** The scene is rendered into this (HDR colour + glow mask in alpha, depth texture). */
  readonly scene: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private blur: THREE.WebGLRenderTarget | null = null;
  private readonly prefilter = pass(PREFILTER, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
  private readonly downMat = pass(DOWN, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
  private readonly upMat = pass(UP, { tSrc: { value: null }, tFine: { value: null }, texel: { value: new THREE.Vector2() } });
  private readonly blurMat = pass(BLUR, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
  private readonly composite: THREE.ShaderMaterial;
  private w = 1;
  private h = 1;
  /** MSAA samples of the scene target. */
  get samples(): number {
    return this.settings.samples;
  }
  /** Full-screen passes drawn by the last render (draw calls). */
  passes = 0;

  constructor(private readonly settings: PostSettings) {
    this.scene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: settings.samples, depthBuffer: true });
    this.scene.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.composite = pass(
      COMPOSITE,
      {
        tScene: { value: this.scene.texture },
        tDepth: { value: this.scene.depthTexture },
        tBloom: { value: null },
        tBlur: { value: null },
        texel: { value: new THREE.Vector2() },
        near: { value: 0.1 },
        far: { value: 400 },
        outline: { value: 1 },
        outlinePx: { value: 1 },
        bloom: { value: 1 },
        tint: { value: new THREE.Color(1, 1, 1) },
        lift: { value: new THREE.Color(0, 0, 0) },
        saturation: { value: 1 },
        contrast: { value: 1 },
        vignette: { value: 0 },
        aspect: { value: 1 },
        focus: { value: 70 },
        dof: { value: 0.55 },
      },
      { ...(settings.bloomLevels > 0 ? { BLOOM: '' } : {}), ...(settings.dof ? { DOF: '' } : {}) },
    );
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composite);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Match the drawing buffer size (device pixels). */
  setSize(w: number, h: number): void {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (w === this.w && h === this.h && this.down.length === this.settings.bloomLevels) return;
    this.w = w;
    this.h = h;
    this.scene.setSize(w, h);
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.down = [];
    this.up = [];
    let bw = w;
    let bh = h;
    for (let i = 0; i < this.settings.bloomLevels; i++) {
      bw = Math.max(1, Math.ceil(bw / 2));
      bh = Math.max(1, Math.ceil(bh / 2));
      this.down.push(target(bw, bh));
      if (i < this.settings.bloomLevels - 1) this.up.push(target(bw, bh));
    }
    if (this.settings.dof) {
      this.blur?.dispose();
      this.blur = target(Math.ceil(w / 2), Math.ceil(h / 2));
    }
    (this.composite.uniforms.texel!.value as THREE.Vector2).set(1 / w, 1 / h);
    this.composite.uniforms.aspect!.value = w / h;
  }

  private draw(r: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    r.setRenderTarget(to);
    r.render(this.quadScene, this.quadCam);
    this.passes++;
  }

  /** Composite `this.scene` (already drawn) to the screen. */
  render(r: THREE.WebGLRenderer, camera: THREE.OrthographicCamera, f: PostFrame): void {
    this.passes = 0;
    const u = this.composite.uniforms;
    const levels = this.down.length;
    if (levels > 0 && f.bloom > 0.001) {
      this.prefilter.uniforms.tSrc!.value = this.scene.texture;
      (this.prefilter.uniforms.texel!.value as THREE.Vector2).set(0.5 / this.w, 0.5 / this.h);
      this.draw(r, this.prefilter, this.down[0]!);
      for (let i = 1; i < levels; i++) {
        this.downMat.uniforms.tSrc!.value = this.down[i - 1]!.texture;
        (this.downMat.uniforms.texel!.value as THREE.Vector2).set(1 / this.down[i - 1]!.width, 1 / this.down[i - 1]!.height);
        this.draw(r, this.downMat, this.down[i]!);
      }
      let src = this.down[levels - 1]!;
      for (let i = levels - 2; i >= 0; i--) {
        this.upMat.uniforms.tSrc!.value = src.texture;
        this.upMat.uniforms.tFine!.value = this.down[i]!.texture;
        (this.upMat.uniforms.texel!.value as THREE.Vector2).set(0.5 / src.width, 0.5 / src.height);
        this.draw(r, this.upMat, this.up[i]!);
        src = this.up[i]!;
      }
      u.tBloom!.value = src.texture;
      u.bloom!.value = f.bloom;
    } else {
      u.tBloom!.value = this.down[0]?.texture ?? null;
      u.bloom!.value = 0;
    }
    if (this.blur) {
      this.blurMat.uniforms.tSrc!.value = this.scene.texture;
      (this.blurMat.uniforms.texel!.value as THREE.Vector2).set(1 / this.w, 1 / this.h);
      this.draw(r, this.blurMat, this.blur);
      u.tBlur!.value = this.blur.texture;
      u.focus!.value = f.focus;
    }
    u.near!.value = camera.near;
    u.far!.value = camera.far;
    u.outline!.value = f.outline;
    u.outlinePx!.value = Math.max(1, f.pixelRatio);
    (u.tint!.value as THREE.Color).copy(f.tint);
    (u.lift!.value as THREE.Color).copy(f.lift);
    u.saturation!.value = f.saturation;
    u.contrast!.value = f.contrast;
    u.vignette!.value = f.vignette;
    this.draw(r, this.composite, null);
  }

  dispose(): void {
    this.scene.depthTexture?.dispose();
    this.scene.dispose();
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.blur?.dispose();
    for (const m of [this.prefilter, this.downMat, this.upMat, this.blurMat, this.composite]) m.dispose();
    this.quad.geometry.dispose();
  }
}
