/**
 * Shared toon materials + cached primitive geometries. Always build visuals through these so the
 * whole game shares one look (3-step cel shading) and GPU state (materials/geometries are reused).
 * Never dispose objects returned from here.
 *
 * 0.9.8 look foundation (DIRECTION V7):
 * - The cel ramp is warm / cool: lit faces take a touch of warm gold, the mid and shadow steps a cool plum-blue, instead of the
 *   neutral grey 90 / 175 / 255. three's toon shader reads only the ramp's red channel, so the gradient chunk is patched
 *   once (below) to read all three.
 * - Glow mask: every opaque lit material writes how much it glows (its emissive light) into the alpha channel as
 *   1 − glow, and materials flagged with `markGlow()` glow fully. The post stack (render/PostFX.ts) blooms only those
 *   pixels, so bright snow never blooms. When the game draws straight to the screen (Low quality) the canvas has no
 *   alpha and the mask is simply ignored.
 */
import * as THREE from 'three';

THREE.ShaderChunk.gradientmap_pars_fragment = THREE.ShaderChunk.gradientmap_pars_fragment.replace(
  'return vec3( texture2D( gradientMap, coord ).r );',
  'return texture2D( gradientMap, coord ).rgb;',
);
THREE.ShaderChunk.opaque_fragment = `${THREE.ShaderChunk.opaque_fragment}
#ifdef OPAQUE
{
  float wlGlow = 0.0;
  #if defined( TOON ) || defined( LAMBERT ) || defined( PHONG ) || defined( STANDARD )
    wlGlow = clamp( dot( totalEmissiveRadiance, vec3( 0.2126, 0.7152, 0.0722 ) ) * 1.4 - 0.08, 0.0, 1.0 );
  #endif
  #ifdef WL_GLOW
    wlGlow = max( wlGlow, float( WL_GLOW ) );
  #endif
  gl_FragColor.a = 1.0 - wlGlow;
}
#endif
`;

/** The warm / cool cel ramp (linear multipliers per channel): shadow, mid, lit. */
export const RAMP: readonly (readonly [number, number, number])[] = [
  [0.32, 0.33, 0.48],
  [0.70, 0.70, 0.76],
  [1.04, 1.015, 0.985],
];

// 3-tone cel ramp: shadow / mid / lit (float, so the lit step can go a touch above 1).
const gradientMap = (() => {
  const data = new Float32Array(RAMP.flatMap(([r, g, b]) => [r, g, b, 1]));
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

/**
 * Flag a material as a full glow for the bloom (unlit bulbs, neon, screens; lit materials glow by their emissive
 * light already). `amount` 0..1. Returns the material.
 */
export function markGlow<T extends THREE.Material>(mat: T, amount = 1): T {
  mat.defines = { ...(mat.defines ?? {}), WL_GLOW: amount.toFixed(3) };
  mat.needsUpdate = true;
  return mat;
}

/**
 * Additive blending that leaves the alpha (the glow mask) alone, so halos, auroras and sparkles add their light
 * without switching off the bloom of what lies behind them. Returns the material.
 */
export function additiveKeepAlpha<T extends THREE.Material>(mat: T): T {
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.SrcAlphaFactor;
  mat.blendDst = THREE.OneFactor;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  return mat;
}

export interface ToonOptions {
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  depthWrite?: boolean;
  map?: THREE.Texture;
}

const toonCache = new Map<string, THREE.MeshToonMaterial>();
const basicCache = new Map<string, THREE.MeshBasicMaterial>();

function key(color: THREE.ColorRepresentation, opts?: object): string {
  return `${new THREE.Color(color).getHexString()}|${opts ? JSON.stringify(opts, (_k, v) => (v instanceof THREE.Texture ? v.uuid : v)) : ''}`;
}

/** Cached cel-shaded material. Use for everything lit. */
export function toon(color: THREE.ColorRepresentation, opts?: ToonOptions): THREE.MeshToonMaterial {
  const k = key(color, opts);
  let m = toonCache.get(k);
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color,
      gradientMap,
      emissive: opts?.emissive ?? 0x000000,
      emissiveIntensity: opts?.emissiveIntensity ?? 1,
      transparent: opts?.transparent ?? false,
      opacity: opts?.opacity ?? 1,
      side: opts?.side ?? THREE.FrontSide,
      depthWrite: opts?.depthWrite ?? true,
      map: opts?.map ?? null,
    });
    toonCache.set(k, m);
  }
  return m;
}

export interface BasicOptions {
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  depthWrite?: boolean;
  map?: THREE.Texture;
}

/** Cached unlit material (ground decals, UI-in-world, glows). */
export function basic(color: THREE.ColorRepresentation, opts?: BasicOptions): THREE.MeshBasicMaterial {
  const k = key(color, opts);
  let m = basicCache.get(k);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent: opts?.transparent ?? false,
      opacity: opts?.opacity ?? 1,
      side: opts?.side ?? THREE.FrontSide,
      depthWrite: opts?.depthWrite ?? true,
      map: opts?.map ?? null,
    });
    basicCache.set(k, m);
  }
  return m;
}

/** Fresh (uncached) toon material — use when you need to animate color/opacity per object. */
export function toonUnique(color: THREE.ColorRepresentation, opts?: ToonOptions): THREE.MeshToonMaterial {
  return toon(color, opts).clone();
}

// ---------------------------------------------------------------------------
// Cached geometries
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(k: string, make: () => T): T {
  let g = geoCache.get(k) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(k, g);
  }
  return g;
}

export const geo = {
  box: (w: number, h: number, d: number) => cached(`box|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)),
  /** Box whose origin is at the centre of its bottom face (handy for buildings / furniture). */
  boxBase: (w: number, h: number, d: number) =>
    cached(`boxBase|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0)),
  cylinder: (rTop: number, rBottom: number, h: number, seg = 16) =>
    cached(`cyl|${rTop}|${rBottom}|${h}|${seg}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, seg)),
  sphere: (r: number, wSeg = 16, hSeg = 12) => cached(`sph|${r}|${wSeg}|${hSeg}`, () => new THREE.SphereGeometry(r, wSeg, hSeg)),
  capsule: (r: number, length: number, capSeg = 6, radialSeg = 14) =>
    cached(`cap|${r}|${length}|${capSeg}|${radialSeg}`, () => new THREE.CapsuleGeometry(r, length, capSeg, radialSeg)),
  cone: (r: number, h: number, seg = 12) => cached(`cone|${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  torus: (r: number, tube: number, rSeg = 8, tSeg = 24) =>
    cached(`torus|${r}|${tube}|${rSeg}|${tSeg}`, () => new THREE.TorusGeometry(r, tube, rSeg, tSeg)),
  plane: (w: number, h: number) => cached(`plane|${w}|${h}`, () => new THREE.PlaneGeometry(w, h)),
  /** Flat ground-plane geometry (already rotated to lie in XZ, facing +Y). */
  ground: (w: number, d: number) => cached(`ground|${w}|${d}`, () => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2)),
  circleGround: (r: number, seg = 32) =>
    cached(`circleGround|${r}|${seg}`, () => new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2)),
  ringGround: (inner: number, outer: number, seg = 40) =>
    cached(`ringGround|${inner}|${outer}|${seg}`, () => new THREE.RingGeometry(inner, outer, seg).rotateX(-Math.PI / 2)),
  icosahedron: (r: number, detail = 0) => cached(`ico|${r}|${detail}`, () => new THREE.IcosahedronGeometry(r, detail)),
  dodecahedron: (r: number, detail = 0) => cached(`dodec|${r}|${detail}`, () => new THREE.DodecahedronGeometry(r, detail)),
};

/** Convenience: mesh from cached geometry + material, with shadow flags. */
export function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  opts?: { cast?: boolean; receive?: boolean },
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = opts?.cast ?? true;
  m.receiveShadow = opts?.receive ?? true;
  return m;
}

/** Recursively set shadow flags. */
export function setShadows<T extends THREE.Object3D>(obj: T, cast = true, receive = true): T {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
  return obj;
}

/**
 * Canvas-backed texture helper for in-world labels (pad costs, speech bubbles, signs).
 * Returns the canvas + texture; redraw on the canvas then set `texture.needsUpdate = true`.
 */
export function makeCanvasTexture(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, ctx, texture };
}

/** Font stack for in-world canvas text and DOM HUD (Fredoka loads from index.html). */
export const GAME_FONT = `'Fredoka', 'Nunito', 'Arial Rounded MT Bold', system-ui, sans-serif`;
