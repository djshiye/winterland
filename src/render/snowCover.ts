/**
 * 1.0 (review idea 5, "snow that builds up"): during a snowstorm the roofs and the harvest fields slowly gain a soft
 * snow layer, and shed it again over the next few minutes. No extra draw calls and no new meshes: a light, up-facing
 * snow blend in the toon shader, driven by two shared numbers.
 *
 * How: like render/skyLight.ts, the toon shader's light chunk gets a term under `#define WL_SNOW`. It whitens a pixel
 * by how much it faces the sky, with soft, drifting coverage (value noise in world space, so a slope fills from its
 * sheltered patches outward instead of turning white all at once):
 * - ROOFS: surfaces above ROOF_Y (eaves of the huts, houses and shops; never the ground, the belts, pads or anything at
 *   the player's height) take `SNOW_COVER.amount[0]`.
 * - FIELDS: the ground inside each era's harvest field (eras/layout.ts plotPlaces(n).field) takes `amount[1]`; the
 *   field rects are in `SNOW_COVER.fields`.
 * The uniforms are Float32Arrays shared by reference by every material (three copies typed arrays by reference), so
 * one write here reaches every program.
 *
 * Which materials: only the scenery's shared vertex-colour material. `snowify(root)` swaps vcMat() for its snowy twin
 * (`snowVcMat()`, the same material with WL_SNOW defined) on the meshes under the scenery roots; items, piles, zones,
 * people and vehicles keep vcMat() and never gather snow. The swap is cheap (a walk of the scenery, a few times a
 * minute) and also catches buildings that are built later. While the amounts are 0 the term is one uniform branch.
 *
 * Pure render module apart from the SnowCover driver at the bottom, which world/env/seasonal.ts updates.
 */
import * as THREE from 'three';
import { vcMat } from './batch';
import { instancerManaged } from './instancer';
import { SNOW } from './palette';
// the noise helpers (wlNoise) come with the sky light: install it first so this term lands after it
import './skyLight';

/** Pixels below this height (m) are never roofs. Village / town eaves start at ~1.6 m. */
export const ROOF_Y = 1.45;
/** Field rects the uniform array holds (eras 2..10). */
export const MAX_FIELDS = 10;

export const SNOW_COVER = {
  /** x: roof snow 0..1; y: field snow 0..1; z: field rect count; w: unused. */
  amount: new Float32Array([0, 0, 0, 0]),
  /** minX, minZ, maxX, maxZ per field (world). */
  fields: new Float32Array(MAX_FIELDS * 4),
  /** The snow colour (linear RGB). */
  color: new Float32Array(new THREE.Color(SNOW).toArray()),
};

const PARS = /* glsl */ `
#ifdef WL_SNOW
uniform vec4 wlSnow;
uniform vec4 wlSnowFields[ ${MAX_FIELDS} ];
uniform vec3 wlSnowColor;
float wlFieldIn( vec2 p ) {
  float f = 0.0;
  for ( int i = 0; i < ${MAX_FIELDS}; i ++ ) {
    if ( float( i ) >= wlSnow.z ) break;
    vec4 r = wlSnowFields[ i ];
    vec2 d = max( r.xy - p, p - r.zw );
    f = max( f, 1.0 - smoothstep( - 1.2, 0.0, max( d.x, d.y ) ) );
  }
  return f;
}
// How much snow lies on this pixel (0..1): its share of the layer, more on flat tops, filling in from soft patches. Even
// a full layer leaves a few thin spots and the steepest faces partly bare, so it reads as fallen snow, not paint. On a
// field it only ever drifts over part of the ground (and only veils the rest), so the beds stay easy to read.
float wlSnowAt( vec3 wp, float up, out float n ) {
  n = wlNoise( wp.xz * 1.3 + 4.1 ) * 0.62 + wlNoise( wp.xz * 4.7 - 2.3 ) * 0.38;
  float facing = smoothstep( 0.3, 0.85, up );
  float s = 0.0;
  float roof = wlSnow.x * smoothstep( ${ROOF_Y.toFixed(2)}, ${(ROOF_Y + 0.5).toFixed(2)}, wp.y );
  if ( roof > 0.001 ) s = smoothstep( n - 0.1, n + 0.28, roof * facing * 1.08 ) * ( 0.78 + 0.2 * facing );
  if ( wlSnow.y > 0.001 ) {
    float field = wlSnow.y * wlFieldIn( wp.xz );
    s = max( s, smoothstep( n - 0.14, n + 0.34, field * facing * 0.74 ) * 0.72 + field * facing * 0.1 );
  }
  return s;
}
#endif
`;

const APPLY = /* glsl */ `
#ifdef WL_SNOW
{
  vec3 wlWp = ( ( vec4( - vViewPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
  float wlUp = inverseTransformDirection( normal, viewMatrix ).y;
  float wlN;
  float wlS = wlSnowAt( wlWp, wlUp, wlN );
  // a faint cool shade where the layer thins and a soft drift grain, so it reads as snow, not paint
  diffuseColor.rgb = mix( diffuseColor.rgb, wlSnowColor * mix( 0.88, 1.0, wlS ) * ( 0.94 + 0.06 * wlN ), wlS );
}
#endif
`;

let installed = false;

/** Patch the toon shader once (before the first material compiles). Idempotent. */
export function installSnowCover(): void {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.lights_pars_begin = `${C.lights_pars_begin}\n${PARS}`;
  C.lights_toon_fragment = `${APPLY}\n${C.lights_toon_fragment}`;
  const lib = THREE.ShaderLib.toon;
  lib.uniforms.wlSnow = { value: SNOW_COVER.amount };
  lib.uniforms.wlSnowFields = { value: SNOW_COVER.fields };
  lib.uniforms.wlSnowColor = { value: SNOW_COVER.color };
}

installSnowCover();

let snowyVc: THREE.MeshToonMaterial | null = null;

/** vcMat() with the snow term: the scenery's roofs and fields. Never dispose it. */
export function snowVcMat(): THREE.MeshToonMaterial {
  if (!snowyVc) {
    snowyVc = vcMat().clone();
    snowyVc.defines = { ...(snowyVc.defines ?? {}), WL_SNOW: '' };
    snowyVc.name = 'snowVc';
  }
  return snowyVc;
}

/** Subtrees that never gather snow: item piles, zones and their halos, the jacks, people (and, below, anything the
 * instancer draws: vehicles, pawns, stacks). */
const SKIP = /^(pile|zone|jack|crowd|guide|instancer)/;

/** Give every scenery mesh under `root` the snowy material (vcMat() only). Returns how many changed. */
export function snowify(root: THREE.Object3D): number {
  const plain = vcMat();
  const snowy = snowVcMat();
  let n = 0;
  const walk = (o: THREE.Object3D): void => {
    if ((o.name && SKIP.test(o.name)) || instancerManaged(o)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material === plain && !m.userData.instancerOwned && !(m as THREE.SkinnedMesh).isSkinnedMesh) {
      m.material = snowy;
      n++;
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  return n;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Seconds of storm to the full layer, and of calm to shed it. */
export const SNOW_BUILD_S = 75;
export const SNOW_MELT_S = 210;

/**
 * The layer's state: `level` climbs 0 → 1 over SNOW_BUILD_S of storm and falls back over SNOW_MELT_S after it; the
 * shown amount is eased (slow start, slow finish). Fields hold a little less and melt a little sooner (warm earth).
 * Pure (tests/seasonal.test.ts).
 */
export class SnowLayer {
  level = 0;

  step(dt: number, storm: boolean): void {
    if (!(dt > 0)) return;
    this.level = storm ? Math.min(1, this.level + dt / SNOW_BUILD_S) : Math.max(0, this.level - dt / SNOW_MELT_S);
  }

  get roofs(): number {
    return smooth(this.level);
  }

  get fields(): number {
    return smooth(Math.max(0, Math.min(1, this.level * 1.1 - 0.1))) * 0.9;
  }

  /** Write the amounts into the shared uniform. */
  apply(): void {
    SNOW_COVER.amount[0] = this.roofs;
    SNOW_COVER.amount[1] = this.fields;
  }
}

/** Set the field rects the snow lies on (world). */
export function setSnowFields(rects: readonly { minX: number; maxX: number; minZ: number; maxZ: number }[]): void {
  const n = Math.min(MAX_FIELDS, rects.length);
  for (let i = 0; i < n; i++) {
    const r = rects[i]!;
    SNOW_COVER.fields.set([r.minX, r.minZ, r.maxX, r.maxZ], i * 4);
  }
  SNOW_COVER.amount[2] = n;
}
