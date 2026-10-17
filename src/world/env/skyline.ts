/**
 * [city] 0.9.0 the Metropolis skyline: an instanced background of towers east / south-east beyond the districts
 * (x 146..300, z -20..140), so the city feels HUGE from anywhere in it. It grows with the whole settlement: no towers
 * below 500 people, up to SKYLINE_MAX (220) at Metropolis size (rules.skylineCount), and the towers get taller with
 * the era. Towers fill a jittered grid, nearest to the districts first, and keep clear of the diagonal behind every
 * district (x - z >= 140) so they never hide a lot the player has to reach in the isometric view.
 *
 * Draw calls: 3 InstancedMeshes in total (shafts, crowns, antennas), no shadows. The shafts and crowns share ONE
 * material whose shader cuts a window grid out of the walls from WORLD coordinates (so windows keep their size
 * whatever the tower's scale) and lights a random share of them; the material is registered with the night-glow
 * registry, so the whole skyline sparkles after dusk at no extra cost.
 */
import * as THREE from 'three';
import { geo, toonUnique } from '../../render/materials';
import { skylineCount } from '../../city/rules';
import { registerGlow } from './glow';

/** Towers at Metropolis size. */
export const SKYLINE_MAX = 220;
/** Where towers may stand. */
export const SKYLINE_AREA = { minX: 146, maxX: 300, minZ: -20, maxZ: 140 } as const;
/** Towers keep x - z >= this (the diagonal behind the districts, which the camera looks along). */
export const SKYLINE_DIAGONAL = 140;
/**
 * 0.9.7 (R5): in front of that diagonal, low-rise blocks join the districts to the towers so the city reads as one
 * growing metropolis. They keep LOW_MIN_X clear of the districts (east edge x 142), stay north of LOW_MAX_Z (clear of
 * road R2 and the era regions) and never stand taller than LOW_MAX_H, so their camera shadow (toward -X / -Z, 0.64 m
 * per metre of height) never reaches a district lot.
 */
export const LOW_MIN_X = 148;
export const LOW_MAX_Z = 124;
export const LOW_MAX_H = 8;
const CELL = 8.6;

interface Slot {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Tallness 0..1 (downtown is taller). */
  tall: number;
  /** Crown / antenna roll 0..1. */
  roll: number;
  /** Tone 0..1 (picks the wall colour). */
  tone: number;
  /** 0.9.7: a low-rise block in front of the diagonal (height ≤ LOW_MAX_H). */
  low: boolean;
}

/** Deterministic tower slots (nearest to the city first). Pure: tests check the area and the diagonal. */
export function skylineSlots(max = SKYLINE_MAX): Slot[] {
  let s = 0x5ca11e;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const A = SKYLINE_AREA;
  const out: Slot[] = [];
  for (let x = A.minX + CELL / 2; x < A.maxX; x += CELL) {
    for (let z = A.minZ + CELL / 2; z < A.maxZ; z += CELL) {
      const w = 4.4 + rnd() * 2.6;
      const d = 4.4 + rnd() * 2.6;
      const px = x + (rnd() - 0.5) * (CELL - w - 0.6);
      const pz = z + (rnd() - 0.5) * (CELL - d - 0.6);
      // the whole footprint stays inside the area and behind the diagonal
      if (px - w / 2 < A.minX || px + w / 2 > A.maxX || pz - d / 2 < A.minZ || pz + d / 2 > A.maxZ) continue;
      const low = px - w / 2 - (pz + d / 2) < SKYLINE_DIAGONAL;
      if (low && (px - w / 2 < LOW_MIN_X || pz + d / 2 > LOW_MAX_Z)) continue;
      out.push({ x: px, z: pz, w, d, tall: 0, roll: rnd(), tone: rnd(), low });
    }
  }
  const ax = 160;
  const az = 10;
  out.sort((a, b) => Math.hypot(a.x - ax, a.z - az) - Math.hypot(b.x - ax, b.z - az));
  const far = Math.hypot(A.maxX - ax, A.maxZ - az);
  for (const t of out) {
    const near = 1 - Math.min(1, Math.hypot(t.x - ax, t.z - az) / far);
    t.tall = Math.min(1, 0.18 + 0.55 * rnd() ** 1.3 + 0.35 * near);
  }
  return out.slice(0, max);
}

/** Tower height (metres) of a slot at era `age` (2..10); a low-rise block stays within LOW_MAX_H. */
export function skylineHeight(tall: number, age: number, low = false): number {
  if (low) return Math.min(LOW_MAX_H, 4.5 + 3.5 * tall);
  return (12 + 78 * tall ** 1.25) * (0.45 + 0.055 * Math.max(1, age));
}

let towerMaterial: THREE.MeshToonMaterial | null = null;

/** Shared tower material: instance colour = wall, windows cut from WORLD coordinates and lit by the glow registry. */
function towerMat(): THREE.MeshToonMaterial {
  if (!towerMaterial) {
    const m = toonUnique(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.06 });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSkyP;\nvarying vec3 vSkyN;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
          mat4 skyM = modelMatrix * instanceMatrix;
          #else
          mat4 skyM = modelMatrix;
          #endif
          vSkyP = (skyM * vec4(transformed, 1.0)).xyz;
          vSkyN = normalize(mat3(skyM) * objectNormal);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSkyP;\nvarying vec3 vSkyN;')
        .replace(
          '#include <emissivemap_fragment>',
          `bool onX = abs(vSkyN.x) > 0.5;
          vec2 sw = vec2(onX ? vSkyP.z : vSkyP.x, vSkyP.y) / vec2(2.4, 3.6);
          float sd = onX ? vSkyP.x : vSkyP.z;
          vec2 sf = fract(sw);
          vec2 sc = floor(sw);
          float win = step(0.18, sf.x) * step(sf.x, 0.82) * step(0.22, sf.y) * step(sf.y, 0.8) * (1.0 - step(0.5, abs(vSkyN.y))) * step(3.0, vSkyP.y);
          float sh = fract(sin(dot(sc + vec2(sd * 0.713, sd * 1.37), vec2(12.9898, 78.233))) * 43758.5453);
          // 0.9.8 (10c): sky-blue glass by day (lighter toward each pane's top), not near-black holes
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.4, 0.52, 0.64), vec3(0.66, 0.77, 0.86), sf.y), win * 0.8);
          totalEmissiveRadiance = emissive * vec3(1.0, 0.82, 0.5) * win * step(0.4, sh) * (0.6 + 0.8 * sh);`,
        );
    };
    m.customProgramCacheKey = () => 'citySkyline';
    towerMaterial = registerGlow(m, 14);
  }
  return towerMaterial;
}

/** Wall tones, cool greys and glassy blues (older eras mix toward warm stone, see colorOf). */
// 0.9.7: softer, warmer city tones (cream, sand, sage, dusty blue) so the metropolis stays cosy against the snow
const TONES = [0xb8c2cc, 0xa9b6c2, 0xd2cbbd, 0x9fb1bd, 0xc6cdc0, 0xb3a796];
const WARM_TONES = [0xc9b496, 0xb9a38a, 0xd4c3a6, 0xae9479];
/** 0.9.8 (10c): the late eras' pearl, cream, mint-glaze and champagne towers: the skyline climbs lighter era by era. */
const LIGHT_TONES = [0xf2ece0, 0xe6eef0, 0xf5e8cc, 0xdcede6, 0xefe6d6, 0xf7efdf];
const _c = new THREE.Color();
const _w = new THREE.Color();

function colorOf(tone: number, age: number, out: THREE.Color): THREE.Color {
  out.set(TONES[Math.floor(tone * TONES.length) % TONES.length]!);
  _w.set(WARM_TONES[Math.floor(tone * 7.3) % WARM_TONES.length]!);
  out.lerp(_w, Math.max(0, (6 - age) / 6) * 0.7);
  _w.set(LIGHT_TONES[Math.floor(tone * 11.7) % LIGHT_TONES.length]!);
  return out.lerp(_w, Math.max(0, Math.min(1, (age - 6) / 4)) * 0.8);
}

export class Skyline {
  readonly group = new THREE.Group();
  private readonly slots = skylineSlots();
  private readonly shafts: THREE.InstancedMesh;
  private readonly crowns: THREE.InstancedMesh;
  private readonly masts: THREE.InstancedMesh;
  /** 0.9.7: a snow cap on every roof. */
  private readonly caps: THREE.InstancedMesh;
  private count = -1;
  private age = 0;
  private readonly o = new THREE.Object3D();

  constructor() {
    this.group.name = 'skyline';
    const n = this.slots.length;
    const mat = towerMat();
    this.shafts = this.make(geo.boxBase(1, 1, 1), mat, n);
    this.crowns = this.make(geo.boxBase(1, 1, 1), mat, n);
    this.masts = this.make(geo.boxBase(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x7a8090 }), n);
    this.caps = this.make(geo.boxBase(1, 1, 1), toonUnique(0xf4f8ff), n);
    this.group.add(this.shafts, this.crowns, this.masts, this.caps);
    this.group.visible = false;
  }

  private make(g: THREE.BufferGeometry, m: THREE.Material, n: number): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(g, m, Math.max(1, n));
    im.count = 0;
    im.castShadow = false;
    im.receiveShadow = false;
    im.frustumCulled = false;
    return im;
  }

  /** How many towers stand right now. */
  get towers(): number {
    return this.count;
  }

  /** Re-lay the towers for a settlement of `population` people in era `age`. Cheap when nothing changed. */
  setSize(population: number, age: number): void {
    const count = Math.min(this.slots.length, skylineCount(population, this.slots.length));
    if (count === this.count && age === this.age) return;
    this.count = count;
    this.age = age;
    this.group.visible = count > 0;
    const o = this.o;
    let crowns = 0;
    let masts = 0;
    const put = (im: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, c?: THREE.Color): void => {
      o.position.set(x, y, z);
      o.scale.set(sx, sy, sz);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
      if (c) im.setColorAt(i, c);
    };
    for (let i = 0; i < count; i++) {
      const t = this.slots[i]!;
      const h = skylineHeight(t.tall, age, t.low);
      const crown = !t.low && t.roll > 0.35;
      const shaft = crown ? h * 0.82 : h;
      const c = colorOf(t.tone, age, _c);
      put(this.shafts, i, t.x, 0, t.z, t.w, shaft, t.d, c);
      if (crown) {
        put(this.crowns, crowns, t.x, shaft, t.z, t.w * 0.68, h - shaft, t.d * 0.68, c.multiplyScalar(0.92));
        crowns++;
      }
      put(this.caps, i, t.x, h, t.z, crown ? t.w * 0.7 : t.w + 0.1, 0.25, crown ? t.d * 0.7 : t.d + 0.1);
      if (t.roll > 0.7 && h > 38) {
        put(this.masts, masts, t.x, h, t.z, 0.35, 6 + h * 0.12, 0.35);
        masts++;
      }
    }
    this.shafts.count = count;
    this.crowns.count = crowns;
    this.masts.count = masts;
    this.caps.count = count;
    for (const im of [this.shafts, this.crowns, this.masts, this.caps]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}
