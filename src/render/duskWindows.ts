/**
 * 0.9.13 (review idea 3, "windows that come on one by one"): at dusk the lit windows of the era huts and shops and of
 * the district towers switch on one at a time over the ~30 s the sky takes to darken, instead of all at once.
 *
 * Every window gets a threshold from a hash; while the night amount (world/env/glow.ts `dusk`) is below it the window
 * stays at its day look (and dims a little as the street darkens), past it the window is lit. At full day the look is
 * exactly the old one, at full night every window is on.
 *
 * The era plots' windows are batched into one vertex-coloured mesh, so a window's hash comes from its colour: a
 * DuskBatch nudges each part's colour by up to 2.5 % (invisible), and the shader hashes the colour.
 */
import * as THREE from 'three';
import { Batch } from './batch';
import { dusk } from '../world/env/glow';

/** The share of the night amount over which the windows come on (first at DUSK_FROM, last at DUSK_TO). */
const DUSK_FROM = 0.12;
const DUSK_TO = 0.85;

/** GLSL: is the window with hash `h` (0..1) lit at night amount `d`? Soft over a few percent, so no pane pops. */
export const DUSK_GLSL = `
uniform float uDusk;
float duskOn(float h) {
  float t = ${DUSK_FROM.toFixed(3)} + h * ${(DUSK_TO - DUSK_FROM).toFixed(3)};
  return smoothstep(t - 0.025, t + 0.025, uDusk);
}`;

/** A Batch whose parts each carry a slightly different colour (the window hash). Deterministic. */
export class DuskBatch extends Batch {
  private k = 0;
  private readonly c = new THREE.Color();

  override add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, x: number, y: number, z: number, o?: Parameters<Batch['add']>[5]): this {
    const u = (Math.sin(++this.k * 12.9898) * 43758.5453) % 1;
    this.c.set(color).multiplyScalar(1 - 0.025 * Math.abs(u));
    return super.add(g, this.c, x, y, z, o);
  }
}

/**
 * Patch an unlit vertex-coloured material (the era plots' windows): day look at night amount 0; as dusk falls a window
 * not yet on fades toward dark blue glass, then comes on at 1.3 × its day colour (a touch brighter, so it reads as lit).
 */
export function duskBasic(mat: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
  mat.onBeforeCompile = (shader): void => {
    shader.uniforms.uDusk = dusk;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${DUSK_GLSL}`).replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float wHash = fract(sin(dot(vColor.rgb, vec3(12.9898, 78.233, 45.164)) * 1000.0) * 43758.5453);
      vec3 wOff = mix(diffuseColor.rgb, vec3(0.3, 0.36, 0.46), uDusk * 0.85);
      diffuseColor.rgb = mix(wOff, diffuseColor.rgb * 1.3, duskOn(wHash));`,
    );
  };
  mat.customProgramCacheKey = (): string => 'wlDuskBasic';
  return mat;
}
