/**
 * [0.9.8 — look foundation] Material helpers on top of render/palette.ts, for the art threads:
 * - `glowMaterial(tint)`: a shared emissive toon material for windows, lamps, screens and furnace mouths. It blooms on
 *   Medium / High (its emissive light feeds the glow mask, render/materials.ts), brightens at night through the glow
 *   registry (world/env/glow.ts, scaled by the comfort Glow slider) and, with `vertexColors`, takes its tint from the
 *   geometry's vertex colours so one material serves a whole merged mesh of differently coloured lights.
 * - `floorMaterial(era, zone)`: the shared toon material of an era's base board (yard or processing floor, DIRECTION
 *   per-era table). With `vertexColors` it is white and the merged floor pattern carries the palette's colours itself
 *   (one draw call per zone); it sits a hair above the snow ground (polygon offset) so it never flickers.
 * Every result is cached and shared: never dispose or recolour it.
 */
import * as THREE from 'three';
import { toonUnique } from './materials';
import { palette } from './palette';
import { registerGlow } from '../world/env/glow';

const glowCache = new Map<string, THREE.MeshToonMaterial>();

/**
 * Shared glow material. `tint` = the light's colour (ignored with vertexColors: the vertex colours tint it), `boost` =
 * how much brighter it gets at full night (the glow registry's factor).
 */
export function glowMaterial(tint = 0xffd38a, opts: { vertexColors?: boolean; boost?: number } = {}): THREE.MeshToonMaterial {
  const vc = opts.vertexColors ?? false;
  const boost = opts.boost ?? 2.6;
  const key = `${vc ? 'vc' : tint.toString(16)}|${boost}`;
  let m = glowCache.get(key);
  if (!m) {
    m = toonUnique(vc ? 0xffffff : tint, { emissive: vc ? 0xffffff : tint, emissiveIntensity: 0.55 });
    if (vc) {
      m.vertexColors = true;
      m.onBeforeCompile = (shader): void => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;');
      };
      m.customProgramCacheKey = (): string => 'wlGlowVC';
    }
    registerGlow(m, boost);
    glowCache.set(key, m);
  }
  return m;
}

export type FloorZone = 'yard' | 'processing';

const floorCache = new Map<string, THREE.MeshToonMaterial>();

/** Shared floor material of era `era` (1..10) for a zone; see the file header. */
export function floorMaterial(era: number, zone: FloorZone = 'yard', opts: { vertexColors?: boolean } = {}): THREE.MeshToonMaterial {
  const vc = opts.vertexColors ?? false;
  const p = palette(era);
  const key = `${p.n}|${zone}|${vc}`;
  let m = floorCache.get(key);
  if (!m) {
    m = toonUnique(vc ? 0xffffff : p.floor[zone]);
    m.vertexColors = vc;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -1;
    floorCache.set(key, m);
  }
  return m;
}
