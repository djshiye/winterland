/**
 * Night-sky aurora (wave 8). The iso camera (pitch 48°, 16 units tall) never sees the horizon or the sky: the ground
 * fills the whole frame, so a curtain placed "beyond the mountains" would be permanently off screen. Instead the
 * aurora is one screen-space quad over the top of the view: a soft green / teal / violet curtain with drifting
 * vertical rays plus a few twinkling stars, drawn additively (no depth test or write, low alpha) so the world below
 * stays fully readable. It exists only while it is dark (`visible = false` by day -> zero draw calls).
 */
import * as THREE from 'three';
import type { EnvPart } from './common';

const VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vP;
uniform float uTime;
uniform float uDark;
uniform float uAspect;

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), f);
}

// One curtain: wavy lower edge, vertical rays, colour by height. Returns premultiplied colour.
vec3 curtain(float x, float y, float seed, float speed, float base) {
  float wave = noise(x * 0.55 + uTime * speed + seed) * 0.6 + noise(x * 1.7 - uTime * speed * 1.4 + seed * 3.0) * 0.3;
  float edge = base + wave * 0.28;
  float h = y - edge;
  float rays = 0.45 + 0.55 * noise(x * 7.0 + wave * 4.0 + uTime * 0.5 + seed * 7.0);
  float body = smoothstep(-0.02, 0.07, h) * (1.0 - smoothstep(0.1, 0.62, h));
  float glowBelow = exp(-max(-h, 0.0) * 26.0) * 0.5 * step(h, 0.0);
  float a = (body + glowBelow) * rays;
  float t = smoothstep(0.0, 0.5, h);
  vec3 green = vec3(0.25, 1.0, 0.55);
  vec3 teal = vec3(0.2, 0.85, 0.95);
  vec3 violet = vec3(0.62, 0.38, 1.0);
  float sway = 0.5 + 0.5 * sin(x * 0.7 + uTime * 0.3 + seed);
  vec3 c = mix(mix(green, teal, sway * 0.7), violet, t * t);
  return c * a;
}

void main() {
  float x = vP.x * uAspect;
  float y = vP.y;
  vec3 col = curtain(x, y, 0.0, 0.12, 0.42) * 0.5 + curtain(x * 0.8 + 3.0, y, 7.0, 0.09, 0.56) * 0.38;

  // twinkling stars (sparse grid cells)
  vec2 g = vec2(x * 22.0, y * 22.0);
  vec2 cell = floor(g);
  float r = hash2(cell);
  vec2 f = fract(g) - vec2(0.25 + 0.5 * hash2(cell + 7.0), 0.25 + 0.5 * hash2(cell + 13.0));
  float star = step(0.955, r) * smoothstep(0.09, 0.0, length(f)) * (0.55 + 0.45 * sin(uTime * (1.5 + r * 4.0) + r * 40.0));
  star *= smoothstep(0.1, 0.5, y);

  vec3 outc = (col + vec3(0.8, 0.9, 1.0) * star * 0.9) * uDark;
  gl_FragColor = vec4(outc, 1.0); // additive: SRC_ALPHA (=1) * colour + dst
}
`;

export interface AuroraPart extends EnvPart {
  /** Fade with the night amount (0 day … 1 night). Hides the mesh while it is ~0. */
  setDarkness(d: number): void;
  /** Wave 13: 1 normal; the aurora event raises it (brighter curtains). */
  setStrength(k: number): void;
}

export function buildAurora(): AuroraPart {
  const group = new THREE.Group();
  group.name = 'aurora';
  const uniforms = {
    uTime: { value: 0 },
    uDark: { value: 0 },
    uAspect: { value: 1.78 },
  };
  let strength = 1;
  let dark = 0;
  const apply = (): void => {
    const k = Math.min(1, Math.max(0, (dark - 0.35) / 0.5));
    uniforms.uDark.value = k * k * (3 - 2 * k) * 1.1 * strength;
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  // NDC quad over the top 55% of the screen (the shader positions it directly).
  const geom = new THREE.PlaneGeometry(2, 0.55 * 2).translate(0, 1 - 0.55, 0);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'aurora-sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = 900;
  mesh.visible = false;
  mesh.onBeforeRender = (_r, _s, camera): void => {
    const c = camera as THREE.OrthographicCamera;
    const h = c.top - c.bottom;
    if (h > 0) uniforms.uAspect.value = (c.right - c.left) / h;
  };
  group.add(mesh);
  return {
    group,
    setDarkness(d: number): void {
      // fades in late (night proper), so dusk keeps its warm sky
      dark = d;
      apply();
      mesh.visible = d > 0.03;
    },
    setStrength(k: number): void {
      strength = Number.isFinite(k) ? Math.max(0, k) : 1;
      apply();
    },
    update(dt: number): void {
      if (mesh.visible) uniforms.uTime.value += dt;
    },
  };
}
