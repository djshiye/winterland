/**
 * [0.9.8 — sky] Cozy chimney smoke (brief 16): soft plumes that curl up, widen, lean with the wind and fade, from every
 * chimney near the camera, instead of one round puff per chimney now and then.
 *
 * Sources: anything that smokes calls `smokeFrom(position, size)` now and then (the village and town still do it on
 * their round-robin tick; the yard cabin every few seconds). A source keeps smoking while it is called at least every
 * SOURCE_TTL seconds, so a demolished building simply stops. `addChimney()` registers a permanent one.
 *
 * Drawing: one Points object animated on the GPU. Each of the SLOTS nearest sources gets PER puffs whose age is a
 * function of time, so it costs one draw call and no per-frame CPU work beyond picking the nearest sources twice a
 * second. Smoke is light by day and a dim blue-grey at night. Comfort: Calm / Minimal effects thin it, Reduce motion
 * slows it.
 */
import * as THREE from 'three';
import { SKY } from '../../render/palette';

/** Sources drawn at once (the nearest to the camera), puffs per source. */
const SLOTS = 20;
const PER = 16;
/** A source stops smoking this long (s) after its last call. */
export const SOURCE_TTL = 45;
/** Sources farther than this from the camera target are skipped. */
const NEAR = 45;
/** Seconds a puff lives (rises ~3 m). */
const LIFE = 5.5;

interface Source {
  x: number;
  y: number;
  z: number;
  size: number;
  /** Time of the last call (s), Infinity for permanent chimneys. */
  seen: number;
}

const sources = new Map<string, Source>();
let now = 0;

const keyOf = (x: number, y: number, z: number): string => `${Math.round(x * 4)},${Math.round(y * 4)},${Math.round(z * 4)}`;

/** Keep the chimney at `p` smoking (`size` ~0.3 a stove pipe … 0.6 a big hearth). Cheap; call on any tick. */
export function smokeFrom(p: { x: number; y: number; z: number }, size = 0.45): void {
  const k = keyOf(p.x, p.y, p.z);
  const s = sources.get(k);
  if (s) {
    s.seen = Math.max(s.seen, now);
    s.size = size;
  } else sources.set(k, { x: p.x, y: p.y, z: p.z, size, seen: now });
}

/** A chimney that always smokes. Returns a function that removes it. */
export function addChimney(p: { x: number; y: number; z: number }, size = 0.45): () => void {
  const k = keyOf(p.x, p.y, p.z);
  sources.set(k, { x: p.x, y: p.y, z: p.z, size, seen: Infinity });
  return () => sources.delete(k);
}

/** For tests and a new game: forget every source. */
export function resetSmoke(): void {
  sources.clear();
  now = 0;
}

/** Live sources nearest to (x, z), at most `max` (pure apart from reading the registry). */
export function nearestSources(x: number, z: number, max: number, t = now): Source[] {
  const out: Source[] = [];
  for (const [k, s] of sources) {
    if (t - s.seen > SOURCE_TTL) {
      sources.delete(k);
      continue;
    }
    if (Math.abs(s.x - x) > NEAR || Math.abs(s.z - z) > NEAR) continue;
    out.push(s);
  }
  out.sort((a, b) => (a.x - x) ** 2 + (a.z - z) ** 2 - ((b.x - x) ** 2 + (b.z - z) ** 2));
  out.length = Math.min(out.length, max);
  return out;
}

const VERT = /* glsl */ `
attribute vec2 aSeed;  // slot, random
uniform vec4 uSrc[${SLOTS}];
uniform float uTime;
uniform vec2 uWind;     // m/s along x, z
uniform float uPx;      // px per m
uniform float uAmount;  // 0..1 share of puffs shown
varying float vAlpha;
varying float vAge;
void main() {
  vec4 src = uSrc[int(aSeed.x)];
  float r = aSeed.y;
  float age = fract(uTime / ${LIFE.toFixed(1)} + r);
  float show = step(r, uAmount) * step(0.001, src.w);
  float t = age * ${LIFE.toFixed(1)};
  vec3 p = src.xyz;
  // rise fast at the mouth, slow as it cools; widen and lean with the wind; a slow curl
  p.y += 3.0 * (1.0 - exp(-t * 0.42)) + 0.15;
  p.xz += uWind * t * age * 0.35;
  float curl = r * 6.2831853 + uTime * 0.7;
  p.x += sin(curl) * 0.22 * age;
  p.z += cos(curl * 0.8) * 0.22 * age;
  vAge = age;
  vAlpha = show * smoothstep(0.0, 0.08, age) * pow(1.0 - age, 1.4);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = show * src.w * (1.6 + 3.2 * age) * uPx;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uLight;
uniform vec3 uShade;
uniform float uAlpha;
varying float vAlpha;
varying float vAge;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  // a soft round puff, a little lighter on top (lit from above)
  float r = length(c) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * vAlpha * uAlpha;
  if (a < 0.004) discard;
  vec3 col = mix(uShade, uLight, clamp(0.35 - c.y * 1.1 + vAge * 0.35, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface Smoke {
  readonly object: THREE.Points;
  update(dt: number, center: THREE.Vector3, dark: number, wind: number, amount: number, speed: number): void;
}

export function buildSmoke(): Smoke {
  const seeds = new Float32Array(SLOTS * PER * 2);
  for (let i = 0; i < SLOTS * PER; i++) {
    seeds[i * 2] = Math.floor(i / PER);
    seeds[i * 2 + 1] = ((i % PER) + 0.5) / PER + (((i * 7919) % 97) / 97 - 0.5) * 0.04;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 2));
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SLOTS * PER * 3), 3));
  const src = Array.from({ length: SLOTS }, () => new THREE.Vector4());
  const dayLight = new THREE.Color(SKY.smoke);
  const dayShade = new THREE.Color(SKY.smokeShade);
  const uniforms = {
    uSrc: { value: src },
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uPx: { value: 40 },
    uAmount: { value: 1 },
    uLight: { value: dayLight.clone() },
    uShade: { value: dayShade.clone() },
    uAlpha: { value: 0.9 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false });
  const object = new THREE.Points(geometry, material);
  object.name = 'chimney-smoke';
  object.frustumCulled = false;
  object.renderOrder = 9;
  object.visible = false;
  const size = new THREE.Vector2();
  object.onBeforeRender = (renderer, _s, camera): void => {
    const c = camera as THREE.OrthographicCamera;
    renderer.getDrawingBufferSize(size);
    const h = (c.top - c.bottom) / (c.zoom || 1);
    if (h > 0) uniforms.uPx.value = size.y / h;
  };
  const night = new THREE.Color(SKY.smokeNight);
  let pick = 0;
  let time = 0;
  return {
    object,
    update(dt, center, dark, wind, amount, speed): void {
      now += dt;
      time += dt * speed;
      pick -= dt;
      if (pick <= 0) {
        pick = 0.5;
        const near = nearestSources(center.x, center.z, SLOTS);
        for (let i = 0; i < SLOTS; i++) {
          const s = near[i];
          if (s) src[i]!.set(s.x, s.y, s.z, s.size);
          else src[i]!.w = 0;
        }
        object.visible = near.length > 0 && amount > 0;
      }
      uniforms.uTime.value = time;
      uniforms.uWind.value.set(-wind, -wind * 0.35);
      uniforms.uAmount.value = amount;
      uniforms.uLight.value.copy(dayLight).lerp(night, dark);
      uniforms.uShade.value.copy(dayShade).lerp(night, dark).multiplyScalar(1 - dark * 0.3);
      uniforms.uAlpha.value = 0.9 - dark * 0.3;
    },
  };
}
