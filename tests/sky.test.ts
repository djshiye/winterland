/**
 * 0.9.8 brief 16: sky, weather and life. The northern lights are light on the world (no screen picture with an edge),
 * cloud shadows and the aurora reach every lit material through shared uniforms, the weather and the sun path are calm
 * and continuous, every era's air is built around its resource, chimney smoke sources come and go, and the crews'
 * families only ever walk on their green.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LIGHTING } from '../src/config';
import { REGIONS } from '../src/eras/data';
import { plotPlaces } from '../src/eras/layout';
import { eraSky, SKY } from '../src/render/palette';
import { installSkyLight, SKY_LIGHT } from '../src/render/skyLight';
import { placeSolids } from '../src/world/env/plots';
import { greenSpots } from '../src/world/life/RegionLife';
import { AURORA_WASH, auroraFade, auroraWash } from '../src/world/sky/aurora';
import { cloudShadowComfort } from '../src/world/sky/Sky';
import { MOTE_STYLES } from '../src/world/sky/motes';
import { addChimney, nearestSources, resetSmoke, smokeFrom, SOURCE_TTL } from '../src/world/sky/smoke';
import { NOON, snowiness, sunAt, weatherAt, type SunState } from '../src/world/sky/weather';

const src = (p: string): string => readFileSync(resolve(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const sun = (): SunState => ({ offset: new THREE.Vector3(), sun: new THREE.Color(), hemiSky: new THREE.Color() });
const ERA_NS = REGIONS.filter((r) => r !== null).map((r) => r!.n);

describe('northern lights (Validator note on PR #45)', () => {
  it('are no longer a screen-space quad: the old aurora file is gone and nothing in world/sky turns depth testing off', () => {
    expect(existsSync(resolve(__dirname, '..', 'src/world/env/aurora.ts'))).toBe(false);
    for (const f of ['aurora.ts', 'motes.ts', 'smoke.ts', 'birds.ts', 'Sky.ts']) expect(src(`src/world/sky/${f}`)).not.toMatch(/depthTest:\s*false/);
  });

  it('only show once night has properly fallen', () => {
    expect(auroraFade(0)).toBe(0);
    expect(auroraFade(0.35)).toBe(0); // dusk keeps its warm sky
    expect(auroraFade(0.6)).toBeGreaterThan(0);
    expect(auroraFade(1)).toBe(1);
  });

  it('keep a fainter wash in the warm-resource eras so embers and copper stay warm at night', () => {
    for (const n of [3, 4, 5]) expect(auroraWash(n)).toBeLessThan(AURORA_WASH);
    for (const n of [1, 2, 6, 10]) expect(auroraWash(n)).toBe(AURORA_WASH);
  });
});

describe('cloud shadows follow Comfort (Validator note on PR #52)', () => {
  it('are full on Full, halved on Calm, and off on Minimal or with Reduce motion', () => {
    expect(cloudShadowComfort('full', false)).toBe(1);
    expect(cloudShadowComfort('calm', false)).toBe(0.5);
    expect(cloudShadowComfort('minimal', false)).toBe(0);
    expect(cloudShadowComfort('full', true)).toBe(0);
  });
});

describe('sky light (render/skyLight.ts)', () => {
  installSkyLight();

  it('patches the lit shader chunks (fails loudly if a three upgrade moves the lines it hooks)', () => {
    const C = THREE.ShaderChunk as unknown as Record<string, string>;
    expect(C.lights_fragment_begin).toContain('directLight.color *= wlCloudShade( wlWorld );');
    expect(C.lights_fragment_begin).toContain('vec3 wlWorld =');
    expect(C.lights_fragment_end).toContain('wlAuroraLight(');
    expect(C.lights_pars_begin).toContain('uniform vec4 wlCloud;');
  });

  it('turns on for every built-in lit shader and shares one set of values by reference', () => {
    for (const id of ['toon', 'lambert', 'phong', 'physical'] as const) {
      const lib = THREE.ShaderLib[id]!;
      expect(lib.fragmentShader.startsWith('#define WL_SKY')).toBe(true);
      // a material's uniforms are a clone of these: typed arrays stay shared, so one write reaches every material
      const u = THREE.UniformsUtils.clone(lib.uniforms);
      expect(u.wlCloud!.value).toBe(SKY_LIGHT.cloud);
      expect(u.wlSky!.value).toBe(SKY_LIGHT.sky);
      expect(u.wlAurora1!.value).toBe(SKY_LIGHT.aurora1);
    }
  });

  it('is idempotent', () => {
    const before = THREE.ShaderChunk.lights_fragment_begin;
    installSkyLight();
    expect(THREE.ShaderChunk.lights_fragment_begin).toBe(before);
  });
});

describe('weather and sun path', () => {
  it('changes calmly: never a jump from one second to the next', () => {
    for (let t = 0; t < 3600; t += 1) expect(Math.abs(snowiness(t + 1) - snowiness(t))).toBeLessThan(0.02);
  });

  it('stays in range, from clear spells to steady snow', () => {
    let lo = 1;
    let hi = 0;
    for (let t = 0; t < 7200; t += 5) {
      const w = weatherAt(t);
      expect(w.clouds).toBeGreaterThanOrEqual(0);
      expect(w.clouds).toBeLessThanOrEqual(0.7);
      expect(w.snow).toBeGreaterThan(0.2);
      expect(w.snow).toBeLessThanOrEqual(1.3);
      lo = Math.min(lo, w.snow);
      hi = Math.max(hi, w.snow);
    }
    expect(hi - lo).toBeGreaterThan(0.6); // it really does vary
    expect(weatherAt(Number.NaN).clouds).toBeGreaterThan(0); // junk time is safe
    expect(snowiness(0)).toBeLessThan(0.4); // a new session opens on fair weather
  });

  it('is exactly the 0.9.7 sun at noon under a clear sky', () => {
    const s = sunAt(NOON, 0, sun());
    expect(s.offset.x).toBeCloseTo(LIGHTING.sunOffset.x, 6);
    expect(s.offset.y).toBeCloseTo(LIGHTING.sunOffset.y, 6);
    expect(s.offset.z).toBeCloseTo(LIGHTING.sunOffset.z, 6);
    expect(s.sun.getHex()).toBe(new THREE.Color(LIGHTING.sunColor).getHex());
    expect(s.hemiSky.getHex()).toBe(new THREE.Color(LIGHTING.hemiSky).getHex());
  });

  it('swings gently and continuously round the whole cycle, always well above the horizon', () => {
    const base = new THREE.Vector3(LIGHTING.sunOffset.x, LIGHTING.sunOffset.y, LIGHTING.sunOffset.z);
    const a = sun();
    const b = sun();
    for (let p = 0; p < 1; p += 0.001) {
      sunAt(p, 0.3, a);
      sunAt(p + 0.001, 0.3, b);
      expect(a.offset.length()).toBeCloseTo(base.length(), 6);
      expect(a.offset.angleTo(base)).toBeLessThan((25 * Math.PI) / 180);
      expect(a.offset.angleTo(b.offset)).toBeLessThan(0.002); // no jump, also across the wrap
      expect(a.offset.y / a.offset.length()).toBeGreaterThan(Math.sin((45 * Math.PI) / 180));
    }
  });

  it('warms the morning and the late afternoon, and dims a little under cloud', () => {
    const noon = sunAt(NOON, 0, sun()).sun.clone();
    const morning = sunAt(0.03, 0, sun()).sun;
    const evening = sunAt(0.52, 0, sun()).sun;
    expect(morning.b).toBeLessThan(noon.b);
    expect(evening.b).toBeLessThan(noon.b);
    const cloudy = sunAt(NOON, 1, sun()).sun;
    expect(cloudy.r).toBeLessThan(noon.r);
    expect(cloudy.r).toBeGreaterThan(noon.r * 0.85);
  });
});

describe("each era's air, built around its resource (R36)", () => {
  it('forge sparks in the Iron Age, steam in the Steam Age, fusion shimmer in the AI era, plain snow in era 1', () => {
    expect(eraSky(1).motes).toBe('none');
    expect(eraSky(3).motes).toBe('sparks');
    expect(eraSky(4).motes).toBe('steam');
    expect(eraSky(10).motes).toBe('fusion');
  });

  it('gives every era 2-10 its own air, and keeps it calm', () => {
    const kinds = new Set<string>();
    for (let n = 2; n <= 10; n++) {
      const k = eraSky(n).motes;
      expect(k).not.toBe('none');
      kinds.add(k);
    }
    expect(kinds.size).toBe(9);
    for (const s of Object.values(MOTE_STYLES)) {
      expect(s.count).toBeLessThanOrEqual(90);
      expect(Math.abs(s.rise)).toBeLessThanOrEqual(0.6);
      expect(Math.max(s.day, s.night)).toBeLessThanOrEqual(1);
    }
  });

  it('takes its colours from the palette module, never pure black', () => {
    for (let n = 1; n <= 10; n++) expect(eraSky(n).mote).toBeGreaterThan(0x202020);
    for (const c of Object.values(SKY)) expect(c).toBeGreaterThan(0x202020);
  });
});

describe('chimney smoke sources', () => {
  it('keeps a chimney smoking while it is called, and lets it stop after SOURCE_TTL', () => {
    resetSmoke();
    smokeFrom({ x: 1, y: 3, z: 1 });
    smokeFrom({ x: 1, y: 3, z: 1 }); // the same chimney again is still one source
    smokeFrom({ x: 200, y: 3, z: 200 }); // far from the camera: skipped
    expect(nearestSources(0, 0, 20)).toHaveLength(1);
    expect(nearestSources(0, 0, 20, SOURCE_TTL + 1)).toHaveLength(0);
  });

  it('keeps permanent chimneys until they are removed, nearest first', () => {
    resetSmoke();
    const off = addChimney({ x: 10, y: 4, z: 0 });
    addChimney({ x: 3, y: 4, z: 0 });
    const near = nearestSources(0, 0, 20, 1e6);
    expect(near.map((s) => s.x)).toEqual([3, 10]);
    off();
    expect(nearestSources(0, 0, 20, 1e6)).toHaveLength(1);
    resetSmoke();
  });
});

describe("the crews' families on their green", () => {
  const segmentClear = (ax: number, az: number, bx: number, bz: number, rects: { r: { minX: number; maxX: number; minZ: number; maxZ: number }; what: string }[]): string | null => {
    for (let t = 0; t <= 1; t += 0.02) {
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      for (const s of rects) if (s.what !== 'green centre' && x > s.r.minX && x < s.r.maxX && z > s.r.minZ && z < s.r.maxZ) return s.what;
    }
    return null;
  };

  it.each(ERA_NS)('era %i: every spot is on the green, clear of the centrepiece, and every walk between spots stays off huts, shops and beds', (n) => {
    const P = plotPlaces(n);
    const spots = greenSpots(P, P.huts.map(() => true));
    const G = P.green;
    const cx = (G.minX + G.maxX) / 2;
    const cz = (G.minZ + G.maxZ) / 2;
    expect(spots.filter((s) => s.door)).toHaveLength(P.huts.length);
    expect(spots.filter((s) => !s.door).length).toBeGreaterThanOrEqual(3);
    for (const s of spots) {
      expect(s.x).toBeGreaterThanOrEqual(G.minX);
      expect(s.x).toBeLessThanOrEqual(G.maxX);
      expect(s.z).toBeGreaterThanOrEqual(G.minZ);
      expect(s.z).toBeLessThanOrEqual(G.maxZ);
      if (!s.door) expect(Math.hypot(s.x - cx, s.z - cz)).toBeGreaterThan(1.6);
    }
    const solids = placeSolids(n);
    for (const a of spots) for (const b of spots) expect(segmentClear(a.x, a.z, b.x, b.z, solids)).toBeNull();
  });

  it('only opens a door for a hut that stands', () => {
    const P = plotPlaces(2);
    const built = P.huts.map((_, i) => i < 2);
    expect(greenSpots(P, built).filter((s) => s.door)).toHaveLength(2);
  });
});
