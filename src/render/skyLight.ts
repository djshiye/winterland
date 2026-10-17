/**
 * [0.9.8 — sky] Light from the sky, added to every lit material without extra draw calls (brief 16).
 *
 * The iso camera never sees the sky (pitch 48°, the ground fills the frame), so the sky shows itself through the light
 * it throws on the world instead of as a picture:
 * - Cloud shadows: soft cloud shapes drift over the land with the wind and dim the sun (the direct light only, so the
 *   hemisphere fill keeps shaded snow blue-white, never grey). Coverage comes from the weather (world/sky/weather.ts).
 * - Northern lights: at night, slow green / teal / violet ribbons of light wander across the snow and the roofs, on top
 *   of a faint wash, lighting surfaces that face the sky (walls get a little, roofs and snow the most). There is no
 *   picture with an edge any more: it is light, so it sits on the ground and under the buildings exactly as lamps do.
 *
 * How: three's built-in lit shaders (toon, lambert, phong, physical) get `#define WL_SKY`; their shared light chunks
 * read the world position of each pixel and apply the two terms. The uniforms are Float32Arrays shared by reference by
 * every material (three's UniformsUtils copies typed arrays by reference), so one write here reaches every material,
 * including the ones that patch their own shader in onBeforeCompile. ShaderMaterials never define WL_SKY and are
 * untouched. Noise is computed in the shader (no texture unit used), on every tier.
 *
 * Pure render module: world/sky/Sky.ts writes `SKY_LIGHT` every frame.
 */
import * as THREE from 'three';

/** The values world/sky writes each frame (all 0 = no sky light at all). */
export const SKY_LIGHT = {
  /** x, z: wind offset of the cloud field (m); z: cloud scale (1 / m); w: cloud shadow strength 0..1. */
  cloud: new Float32Array([0, 0, 1 / 12, 0]),
  /** x: cloud coverage 0..1; y: aurora time (s); z: aurora strength; w: aurora wash (the soft glow between ribbons). */
  sky: new Float32Array([0.4, 0, 0, 0]),
  /** The three aurora colours (linear RGB): the low green, the teal, the violet crown. */
  aurora0: new Float32Array([0.12, 0.9, 0.42]),
  aurora1: new Float32Array([0.1, 0.62, 0.78]),
  aurora2: new Float32Array([0.5, 0.26, 0.95]),
};

const PARS = /* glsl */ `
#ifdef WL_SKY
uniform vec4 wlCloud;
uniform vec4 wlSky;
uniform vec3 wlAurora0;
uniform vec3 wlAurora1;
uniform vec3 wlAurora2;

float wlHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
float wlNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = wlHash( i );
  float b = wlHash( i + vec2( 1.0, 0.0 ) );
  float c = wlHash( i + vec2( 0.0, 1.0 ) );
  float d = wlHash( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
// 1 in the sun … 1 - strength under a cloud; soft edges, slow drift.
float wlCloudShade( vec3 wp ) {
  if ( wlCloud.w <= 0.001 ) return 1.0;
  vec2 p = ( wp.xz + wlCloud.xy ) * wlCloud.z;
  float n = wlNoise( p ) * 0.6 + wlNoise( p * 2.07 + vec2( 7.1, 3.7 ) ) * 0.28 + wlNoise( p * 4.3 + vec2( 1.3, 9.2 ) ) * 0.12;
  float t = mix( 0.64, 0.36, wlSky.x );
  return 1.0 - smoothstep( t, t + 0.13, n ) * wlCloud.w;
}
// The northern lights as light: ribbons + wash, strongest on surfaces that face the sky.
vec3 wlAuroraLight( vec3 wp, float up ) {
  float k = wlSky.z;
  if ( k <= 0.001 ) return vec3( 0.0 );
  float t = wlSky.y;
  vec2 p = wp.xz * 0.04;
  float warp = wlNoise( p * 0.55 + vec2( t * 0.012, - t * 0.008 ) ) + 0.5 * wlNoise( p * 1.3 - vec2( t * 0.02, 0.0 ) );
  float s = dot( p, vec2( 0.8, 0.6 ) ) + warp * 1.6 + t * 0.008;
  float band = 0.5 + 0.5 * sin( s * 6.2831853 );
  band *= band * band;
  float along = dot( p, vec2( - 0.6, 0.8 ) );
  float rays = 0.62 + 0.38 * wlNoise( vec2( along * 7.0 + t * 0.06, s * 2.0 ) );
  float hue = wlNoise( p * 0.8 + vec2( - t * 0.005, t * 0.004 ) );
  vec3 col = mix( wlAurora0, wlAurora1, smoothstep( 0.3, 0.62, hue ) );
  col = mix( col, wlAurora2, smoothstep( 0.6, 0.9, hue ) * 0.85 );
  float a = wlSky.w + band * rays;
  return col * a * k * ( 0.22 + 0.78 * clamp( up, 0.0, 1.0 ) );
}
#endif
`;

const WORLD = /* glsl */ `vec3 geometryPosition = - vViewPosition;
#ifdef WL_SKY
vec3 wlWorld = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
#endif`;

const CLOUD = /* glsl */ `getDirectionalLightInfo( directionalLight, directLight );
		#ifdef WL_SKY
		directLight.color *= wlCloudShade( wlWorld );
		#endif`;

const AURORA = /* glsl */ `
#ifdef WL_SKY
irradiance += wlAuroraLight( wlWorld, transformDirectionByInverseViewMatrix( geometryNormal, viewMatrix ).y );
#endif
`;

let installed = false;

/** Patch the light chunks and the built-in lit shaders once (before the first material compiles). Idempotent. */
export function installSkyLight(): void {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.lights_pars_begin = `${C.lights_pars_begin}\n${PARS}`;
  C.lights_fragment_begin = C.lights_fragment_begin!.replace('vec3 geometryPosition = - vViewPosition;', WORLD).replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    CLOUD,
  );
  C.lights_fragment_end = `${AURORA}${C.lights_fragment_end}`;
  for (const id of ['toon', 'lambert', 'phong', 'standard', 'physical'] as const) {
    const lib = THREE.ShaderLib[id];
    if (!lib || lib.fragmentShader.startsWith('#define WL_SKY')) continue;
    lib.fragmentShader = `#define WL_SKY\n${lib.fragmentShader}`;
    lib.uniforms.wlCloud = { value: SKY_LIGHT.cloud };
    lib.uniforms.wlSky = { value: SKY_LIGHT.sky };
    lib.uniforms.wlAurora0 = { value: SKY_LIGHT.aurora0 };
    lib.uniforms.wlAurora1 = { value: SKY_LIGHT.aurora1 };
    lib.uniforms.wlAurora2 = { value: SKY_LIGHT.aurora2 };
  }
}

installSkyLight();
