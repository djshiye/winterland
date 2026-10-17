/**
 * [0.9.8 — sky] What drifts in each era's air, built around its resource (brief 16): kiln dust in the Frontier, forge
 * sparks in the Iron Age, steam wisps in the Steam Age, coke ash in the Industrial yards, little mint zaps in the
 * Electric Age, honey heat shimmer over the oil, mint pixels in the Computer era, aqua glow over the reactor pools and
 * sun-gold fusion shimmer in the AI era (render/palette.ts eraSky). Era 1 keeps plain snow.
 *
 * One Points object, animated entirely on the GPU (each mote is a seed; its position is a function of time, wrapped
 * around the camera), so it costs one draw call and no per-frame CPU work. Calm by design: few motes, slow motion,
 * low alpha; they glow a little more at night. Comfort: fewer with Calm / Minimal effects, slower with Reduce motion.
 * Changing era fades the old motes out before the new ones fade in.
 */
import * as THREE from 'three';
import { additiveKeepAlpha } from '../../render/materials';
import { eraSky, type MoteKind } from '../../render/palette';
import type { Rng } from '../env/common';

const MAX = 160;
const SPAN = 40;

/** How each kind moves and looks. */
interface MoteStyle {
  count: number;
  /** Rise speed (m/s, negative falls). */
  rise: number;
  /** Lowest / highest height (m). */
  y0: number;
  y1: number;
  /** Sideways sway (m) and its speed. */
  sway: number;
  swaySpeed: number;
  /** Size (m). */
  size: number;
  /** Peak alpha by day / at night. */
  day: number;
  night: number;
  /** 0 steady … 1 twinkles. */
  twinkle: number;
  /** 0 round soft dot, 1 square pixel, 2 big soft wisp. */
  shape: number;
  /** Additive (glowing) or plain. */
  glow: boolean;
}

export const MOTE_STYLES: Record<Exclude<MoteKind, 'none'>, MoteStyle> = {
  dust: { count: 70, rise: 0.05, y0: 0.3, y1: 5, sway: 0.8, swaySpeed: 0.25, size: 0.22, day: 0.55, night: 0.35, twinkle: 0.2, shape: 0, glow: false },
  sparks: { count: 60, rise: 0.55, y0: 0.4, y1: 7, sway: 0.5, swaySpeed: 0.9, size: 0.22, day: 0.75, night: 0.95, twinkle: 0.6, shape: 0, glow: true },
  steam: { count: 34, rise: 0.4, y0: 0.5, y1: 7, sway: 1.1, swaySpeed: 0.2, size: 1.5, day: 0.16, night: 0.1, twinkle: 0, shape: 2, glow: false },
  ash: { count: 90, rise: -0.32, y0: 0, y1: 9, sway: 0.6, swaySpeed: 0.5, size: 0.19, day: 0.6, night: 0.4, twinkle: 0, shape: 0, glow: false },
  zaps: { count: 46, rise: 0.08, y0: 1, y1: 6, sway: 0.4, swaySpeed: 1.6, size: 0.22, day: 0.6, night: 0.95, twinkle: 1, shape: 0, glow: true },
  shimmer: { count: 60, rise: 0.22, y0: 0.2, y1: 5, sway: 0.7, swaySpeed: 0.35, size: 0.24, day: 0.45, night: 0.7, twinkle: 0.4, shape: 0, glow: true },
  pixels: { count: 56, rise: 0.25, y0: 0.4, y1: 6, sway: 0.3, swaySpeed: 0.3, size: 0.26, day: 0.6, night: 0.9, twinkle: 0.5, shape: 1, glow: true },
  glow: { count: 70, rise: 0.06, y0: 0.4, y1: 4.5, sway: 0.9, swaySpeed: 0.3, size: 0.29, day: 0.45, night: 0.85, twinkle: 0.3, shape: 0, glow: true },
  fusion: { count: 80, rise: 0.15, y0: 0.4, y1: 6, sway: 0.6, swaySpeed: 0.4, size: 0.24, day: 0.6, night: 0.95, twinkle: 0.8, shape: 0, glow: true },
};

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCenter;
uniform vec4 uMove;   // rise, y0, y1, wind
uniform vec4 uSway;   // amount, speed, size (m), px per m
uniform float uTwinkle;
varying float vAlpha;
varying float vTw;
void main() {
  float h = uMove.z - uMove.y;
  float t = uTime;
  float sp = 0.6 + 0.8 * aSeed.w;
  float y = aSeed.y * h + uMove.x * sp * t;
  float cyc = fract(y / h);
  vec3 p;
  p.y = uMove.y + cyc * h;
  float ph = aSeed.w * 6.2831853;
  p.x = aSeed.x * ${SPAN.toFixed(1)} + sin(t * uSway.y * sp + ph) * uSway.x - uMove.w * t;
  p.z = aSeed.z * ${SPAN.toFixed(1)} + cos(t * uSway.y * 0.8 * sp + ph * 1.3) * uSway.x;
  // wrap around the camera target
  p.xz = uCenter.xz + mod(p.xz - uCenter.xz + ${(SPAN / 2).toFixed(1)}, ${SPAN.toFixed(1)}) - ${(SPAN / 2).toFixed(1)};
  vAlpha = smoothstep(0.0, 0.12, cyc) * (1.0 - smoothstep(0.75, 1.0, cyc));
  vTw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(t * (2.0 + 5.0 * aSeed.x) + ph * 3.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSway.z * uSway.w * (0.6 + 0.8 * aSeed.z);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uShape;
varying float vAlpha;
varying float vTw;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float a;
  if (uShape > 1.5) a = (1.0 - smoothstep(0.1, 1.0, r)) * 0.8;
  else if (uShape > 0.5) a = step(max(abs(c.x), abs(c.y)), 0.36);
  else a = 1.0 - smoothstep(0.35, 1.0, r);
  a *= vAlpha * vTw * uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface Motes {
  readonly object: THREE.Points;
  /** Per frame: the era the camera is in, how dark it is, the camera target, the wind and the amount (0..1). */
  update(dt: number, era: number, dark: number, center: THREE.Vector3, wind: number, amount: number, speed: number): void;
}

export function buildMotes(rng: Rng): Motes {
  const seeds = new Float32Array(MAX * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rng.next();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  // positions are computed in the shader; a dummy attribute keeps three's draw count right
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
  const uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uMove: { value: new THREE.Vector4() },
    uSway: { value: new THREE.Vector4(0, 0, 0.1, 40) },
    uTwinkle: { value: 0 },
    uColor: { value: new THREE.Color() },
    uAlpha: { value: 0 },
    uShape: { value: 0 },
  };
  const make = (glow: boolean): THREE.ShaderMaterial => {
    const m = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false });
    return glow ? additiveKeepAlpha(m) : m;
  };
  const plain = make(false);
  const glowing = make(true);
  const object = new THREE.Points(geometry, plain);
  object.name = 'sky-motes';
  object.frustumCulled = false;
  object.renderOrder = 11;
  object.visible = false;
  const size = new THREE.Vector2();
  object.onBeforeRender = (renderer, _s, camera): void => {
    const c = camera as THREE.OrthographicCamera;
    renderer.getDrawingBufferSize(size);
    const h = (c.top - c.bottom) / (c.zoom || 1);
    if (h > 0) uniforms.uSway.value.w = size.y / h;
  };

  let shown: MoteKind = 'none';
  let fade = 0; // 0 … 1 of the shown kind
  let time = 0;
  return {
    object,
    update(dt, era, dark, center, wind, amount, speed): void {
      const want = eraSky(era).motes;
      // fade the old kind out before the new one comes in
      if (want !== shown) {
        fade = Math.max(0, fade - dt / 0.8);
        if (fade <= 0) shown = want;
      } else fade = Math.min(1, fade + dt / 1.2);
      if (shown === 'none' || amount <= 0) {
        object.visible = false;
        return;
      }
      const s = MOTE_STYLES[shown];
      time += dt * speed;
      object.visible = true;
      object.material = s.glow ? glowing : plain;
      uniforms.uTime.value = time;
      uniforms.uCenter.value.copy(center);
      uniforms.uMove.value.set(s.rise, s.y0, s.y1, wind * 0.3);
      uniforms.uSway.value.x = s.sway;
      uniforms.uSway.value.y = s.swaySpeed;
      uniforms.uSway.value.z = s.size;
      uniforms.uTwinkle.value = s.twinkle * speed;
      uniforms.uShape.value = s.shape;
      uniforms.uColor.value.setHex(colorOf(shown));
      uniforms.uAlpha.value = (s.day + (s.night - s.day) * dark) * fade;
      geometry.setDrawRange(0, Math.max(1, Math.round(Math.min(MAX, s.count) * amount)));
    },
  };
}

/** The mote colour of the era that uses `kind` (also while it fades out after the camera has left that era). */
function colorOf(kind: MoteKind): number {
  for (let e = 1; e <= 10; e++) if (eraSky(e).motes === kind) return eraSky(e).mote;
  return 0xffffff;
}
