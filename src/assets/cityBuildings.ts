/**
 * [city] 0.9.0 city district buildings (city/District.ts): a PARAMETRIC era building kit. createCityBuilding(id, seed)
 * builds any of the 36 CITY_BUILDINGS (eras/data.ts: home / work / park / landmark for each era 2..10) from its
 * def (kind, era, height) and the footprint it must fit: brick cottages and a clock tower in the Frontier, iron
 * tenements and a railway station, steam rows and a Grand Exchange, industrial apartments and an Expo hall, art-deco
 * flats and a radio tower, oil high-rises and a sky needle, glass condos and a data spire, nuclear skyscrapers and an
 * atomic monument, AI arcologies and a singularity spire. Parks are low gardens with trees, benches and fountains.
 *
 * CONTRACT
 * - Local frame: origin on the ground at the footprint CENTRE, the FRONT (door, pad side) faces local +Z. The model
 *   spans x in [-w/2, w/2], z in [-d/2, d/2] (roof overhangs stay inside); `w` x `d` is the footprint it was built for.
 * - Draw calls: <= 3 meshes per building: ONE merged vertex-coloured body, ONE window "glass" mesh (a thin shell over
 *   the walls drawn by a window-grid shader; its material is registered with the night-glow registry, so windows
 *   light up at night) and, for landmarks with moving parts, ONE animated pivot. Geometry is cached per
 *   (id, seed variant, footprint), so any number of identical buildings share GPU buffers.
 * - The drawn height is visualHeight(def.height): a 100 m data height would hide half a district in the isometric view.
 * - Snow on every roof. NOTHING needs to be registered by the caller.
 * - animate(t): turns the pivot (radio tower beacon, sky needle ring, atom, spire rings); no allocation.
 */
import * as THREE from 'three';
import { Batch, vcMat } from '../render/batch';
import { SNOW, palette } from '../render/palette';
import { geo, toon, toonUnique } from '../render/materials';
import { registerGlow } from '../world/env/glow';
import { CITY_BUILDINGS, CITY_BUILDING_IDS, type CityBuildingDef, type CityBuildingId } from '../eras/data';
import { maxFootprint, visualHeight } from '../city/rules';

export interface CityBuildingModel {
  readonly root: THREE.Group;
  /** Footprint (local X × Z) in metres. */
  readonly w: number;
  readonly d: number;
  /** Drawn height in metres. */
  readonly height: number;
  /** Turn the pivot (landmarks); a no-op for static buildings. */
  animate(t: number): void;
}

// ---------------------------------------------------------------------------
// palette
// ---------------------------------------------------------------------------


const SNOW_SH = 0xd7e4f2;
const LEAF = 0x2f7d52;
const LEAF_D = 0x256243;
const LEAF_L = 0x4fae6a;
const TRUNK = 0x6b4a33;
const STONE = 0xc9c0ae;
const STONE_D = 0x9a917f;
const WOOD = 0x8a6a48;
const WOOD_D = 0x6d5238;
const ICE = 0xbfe4f4;
const WATER = 0x7cc4e8;
const IRON_D = 0x3b3f47;
const PAVE = 0xb4b9c2;
const WHITE = 0xf4f6fa;
/** AI-era holograms (guide era 10 Glow) and the Nuclear sea-foam glow (era 9). */
const HOLO = 0xffe082;
const HOLO_D = 0xf2c46a;
const FOAM = 0x70f5d9;

/**
 * Per-era look: walls, a second wall tone, roof, trim, accent, window tint (a warm candle to sun-gold). Trims, accents
 * and the eras 6–10 materials follow the palette table of docs/art/guide.md (ARGON).
 */
interface Style {
  wall: number;
  wall2: number;
  roof: number;
  trim: number;
  accent: number;
  tint: number;
  floorH: number;
  cellW: number;
}

/** Storey height and window cell width per era (the colours come from render/palette.ts). */
const STOREYS: readonly (readonly [floorH: number, cellW: number])[] = [
  [0, 0], [0, 0], [2.2, 1.5], [2.5, 1.6], [2.6, 1.7], [2.8, 1.8], [3.0, 1.9], [3.2, 2.0], [3.2, 2.0], [3.4, 2.1], [3.4, 2.2],
];

const STYLES: readonly (Style | null)[] = STOREYS.map(([floorH, cellW], n) => {
  const c = n >= 2 ? palette(n).city : null;
  return c ? { ...c, floorH, cellW } : null;
});
const styleOf = (n: number): Style => STYLES[n]!;

// ---------------------------------------------------------------------------
// window glass: a thin shell over the walls; a shader cuts a grid of windows out of it
// ---------------------------------------------------------------------------

let glassMaterial: THREE.MeshToonMaterial | null = null;

/** Shared window material (vertex colour = window light tint). Registered with the night-glow registry once. */
function glassMat(): THREE.MeshToonMaterial {
  if (!glassMaterial) {
    const m = toonUnique(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.1 });
    m.vertexColors = true;
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWinUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWinUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWinUv;')
        .replace(
          '#include <emissivemap_fragment>',
          `vec2 wf = fract(vWinUv);
          vec2 wc = floor(vWinUv);
          float inWin = step(0.15, wf.x) * step(wf.x, 0.85) * step(0.2, wf.y) * step(wf.y, 0.82);
          if (inWin < 0.5) discard;
          float wh = fract(sin(dot(wc, vec2(12.9898, 78.233))) * 43758.5453);
          float lit = step(0.32, wh);
          diffuseColor.rgb = mix(vec3(0.11, 0.15, 0.21), vec3(0.2, 0.26, 0.34), wh) + vColor.rgb * 0.08;
          totalEmissiveRadiance = emissive * vColor.rgb * lit * (0.4 + 0.5 * wh);`,
        );
    };
    m.customProgramCacheKey = () => 'cityGlass';
    glassMaterial = registerGlow(m, 7);
  }
  return glassMaterial;
}

/** Collects window shell quads (position, normal, window-cell uv, tint) into one geometry. */
class Glass {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly idx: number[] = [];
  private readonly tint = new THREE.Color();

  constructor(tint: number) {
    this.tint.set(tint);
  }

  /** One wall: `a` → `b` is left → right seen from outside (outward normal nx, nz), windows between y0 and y1. */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number, cols: number, rows: number, uo: number, vo: number): void {
    const o = 0.045;
    const base = this.pos.length / 3;
    const corners: [number, number, number, number, number][] = [
      [ax, y0, az, 0, 0],
      [bx, y0, bz, cols, 0],
      [bx, y1, bz, cols, rows],
      [ax, y1, az, 0, rows],
    ];
    for (const [x, y, z, u, v] of corners) {
      this.pos.push(x + nx * o, y, z + nz * o);
      this.nor.push(nx, 0, nz);
      this.uv.push(u + uo, v + vo);
      this.col.push(this.tint.r, this.tint.g, this.tint.b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** The four walls of a box shaft (centre cx, cz). `skip` leaves a side out ('f' front, 'b' back, 'l', 'r'). */
  shaft(cx: number, cz: number, w: number, d: number, y0: number, y1: number, floorH: number, cellW: number, seed: number, skip = ''): void {
    if (y1 - y0 < floorH * 0.5 || w < 0.8 || d < 0.8) return;
    const rows = Math.max(1, Math.round((y1 - y0) / floorH));
    const cw = Math.max(1, Math.round(w / cellW));
    const cd = Math.max(1, Math.round(d / cellW));
    const hw = w / 2;
    const hd = d / 2;
    if (!skip.includes('f')) this.wall(cx - hw, cz + hd, cx + hw, cz + hd, y0, y1, 0, 1, cw, rows, seed * 7, seed);
    if (!skip.includes('b')) this.wall(cx + hw, cz - hd, cx - hw, cz - hd, y0, y1, 0, -1, cw, rows, seed * 11 + 3, seed + 2);
    if (!skip.includes('r')) this.wall(cx + hw, cz + hd, cx + hw, cz - hd, y0, y1, 1, 0, cd, rows, seed * 5 + 9, seed + 4);
    if (!skip.includes('l')) this.wall(cx - hw, cz - hd, cx - hw, cz + hd, y0, y1, -1, 0, cd, rows, seed * 3 + 5, seed + 6);
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------------------
// kit: a Batch with the handful of primitives the buildings need (origin of boxes / cylinders / cones = their bottom)
// ---------------------------------------------------------------------------

let gableGeo: THREE.BufferGeometry | null = null;
let vaultGeo: THREE.BufferGeometry | null = null;

/** Triangle prism: base width 1 (x), apex height 1 (y), depth 1 (z, centred). */
function gableGeometry(): THREE.BufferGeometry {
  gableGeo ??= new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]), { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
  return gableGeo;
}

/** Half-disc prism (barrel vault): radius 1 (x), height 1 (y), depth 1 (z, centred). */
function vaultGeometry(): THREE.BufferGeometry {
  if (!vaultGeo) {
    const s = new THREE.Shape();
    s.moveTo(-1, 0);
    s.absarc(0, 0, 1, Math.PI, 0, true);
    s.lineTo(-1, 0);
    vaultGeo = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 12 }).translate(0, 0, -0.5);
  }
  return vaultGeo;
}

class Kit {
  readonly body = new Batch();
  readonly pivot = new Batch();
  /** Where subsequent parts go (body by default, the pivot batch inside `spin`). */
  private cur = this.body;

  /** Box, origin at its bottom centre. */
  slab(c: number, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): void {
    this.cur.add(geo.boxBase(1, 1, 1), c, x, y, z, { sx: w, sy: h, sz: d, ry });
  }

  /** Cylinder (rt = top radius, rb = bottom radius), bottom at y. */
  cyl(c: number, rb: number, rt: number, h: number, x: number, y: number, z: number, seg = 10, o?: { rx?: number; rz?: number }): void {
    const ratio = Math.round((rt / rb) * 1000) / 1000;
    this.cur.add(geo.cylinder(ratio, 1, 1, seg), c, x, y + h / 2, z, { sx: rb, sy: h, sz: rb, rx: o?.rx, rz: o?.rz });
  }

  cone(c: number, r: number, h: number, x: number, y: number, z: number, seg = 10, ry = 0): void {
    this.cur.add(geo.cone(1, 1, seg), c, x, y + h / 2, z, { sx: r, sy: h, sz: r, ry });
  }

  sph(c: number, r: number, x: number, y: number, z: number, sy = 1): void {
    this.cur.add(geo.sphere(1, 10, 7), c, x, y, z, { sx: r, sy: r * sy, sz: r });
  }

  /** Torus, ring radius R, tube t: flat in the XZ plane by default (rx = 0 stands it up, facing +Z). */
  torus(c: number, R: number, t: number, x: number, y: number, z: number, o?: { rx?: number; ry?: number; rz?: number }): void {
    this.cur.add(geo.torus(1, t / R, 6, 18), c, x, y, z, { sx: R, sy: R, sz: R, rx: o?.rx ?? Math.PI / 2, ry: o?.ry, rz: o?.rz });
  }

  /** Slender box between two points (lattice legs, braces). */
  rod(c: number, t: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const a = new THREE.Vector3(x0, y0, z0);
    const b = new THREE.Vector3(x1, y1, z1);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(a.add(b).multiplyScalar(0.5), q, new THREE.Vector3(t, len, t));
    this.cur.addMatrix(geo.box(1, 1, 1), c, m);
  }

  /** Gable prism with its ridge along Z (or X with alongX), `span` wide, `rise` high, `len` long. */
  gable(c: number, span: number, rise: number, len: number, x: number, y: number, z: number, alongX = false): void {
    this.cur.add(gableGeometry(), c, x, y, z, { sx: span, sy: rise, sz: len, ry: alongX ? Math.PI / 2 : 0 });
  }

  /** Barrel vault: half-disc cross-section over `span`, ridge along Z (or X), arched `rise` high. */
  vault(c: number, span: number, rise: number, len: number, x: number, y: number, z: number, alongX = false): void {
    this.cur.add(vaultGeometry(), c, x, y, z, { sx: span / 2, sy: rise, sz: len, ry: alongX ? Math.PI / 2 : 0 });
  }

  /** Four-sided pyramid over a w × d footprint. */
  pyr(c: number, w: number, d: number, h: number, x: number, y: number, z: number): void {
    this.cur.add(geo.cone(1, 1, 4), c, x, y + h / 2, z, { sx: w / Math.SQRT2, sy: h, sz: d / Math.SQRT2, ry: Math.PI / 4 });
  }

  /** Switch to the pivot batch for `fn` (parts are positioned relative to `origin`, the pivot's turning point). */
  spin(fn: () => void): void {
    this.cur = this.pivot;
    fn();
    this.cur = this.body;
  }

  /** Snow cap on a flat roof: a slab slightly inside the roof outline. */
  snow(w: number, d: number, x: number, y: number, z: number, thick = 0.22): void {
    this.slab(SNOW, Math.max(0.2, w - 0.35), thick, Math.max(0.2, d - 0.35), x, y, z);
    this.slab(SNOW_SH, Math.max(0.2, w - 0.15), 0.08, Math.max(0.2, d - 0.15), x, y, z);
  }

  tree(x: number, z: number, s = 1, kind: 'pine' | 'round' | 'holo' = 'pine'): void {
    if (kind === 'holo') {
      this.cyl(0x526475, 0.1 * s, 0.1 * s, 0.7 * s, x, 0, z, 6);
      this.cone(HOLO, 0.7 * s, 1.5 * s, x, 0.7 * s, z, 6);
      this.cone(HOLO_D, 0.5 * s, 1.1 * s, x, 1.7 * s, z, 6);
      return;
    }
    if (kind === 'round') {
      this.cyl(TRUNK, 0.12 * s, 0.1 * s, 0.9 * s, x, 0, z, 6);
      this.sph(LEAF_L, 0.75 * s, x, 1.45 * s, z, 0.9);
      this.sph(SNOW, 0.55 * s, x, 1.9 * s, z, 0.4);
      return;
    }
    this.cyl(TRUNK, 0.13 * s, 0.11 * s, 0.7 * s, x, 0, z, 6);
    this.cone(LEAF_D, 0.85 * s, 1.1 * s, x, 0.5 * s, z, 7);
    this.cone(LEAF, 0.65 * s, 1.0 * s, x, 1.15 * s, z, 7);
    this.cone(LEAF_L, 0.42 * s, 0.9 * s, x, 1.8 * s, z, 7);
    this.cone(SNOW, 0.4 * s, 0.35 * s, x, 2.15 * s, z, 7);
  }

  bench(x: number, z: number, ry = 0, c = WOOD): void {
    this.slab(c, 1.1, 0.1, 0.36, x, 0.38, z, ry);
    this.slab(WOOD_D, 1.1, 0.34, 0.08, x - Math.sin(ry) * 0.17, 0.5, z - Math.cos(ry) * 0.17, ry);
    this.slab(IRON_D, 0.08, 0.38, 0.3, x + Math.cos(ry) * 0.45, 0, z - Math.sin(ry) * 0.45, ry);
    this.slab(IRON_D, 0.08, 0.38, 0.3, x - Math.cos(ry) * 0.45, 0, z + Math.sin(ry) * 0.45, ry);
    this.slab(SNOW, 1.1, 0.05, 0.3, x, 0.48, z, ry);
  }

  fountain(x: number, z: number, r = 0.9, water = WATER): void {
    this.cyl(STONE_D, r, r, 0.35, x, 0, z, 14);
    this.cyl(water, r * 0.88, r * 0.88, 0.04, x, 0.34, z, 14);
    this.cyl(STONE, 0.14, 0.2, 0.8, x, 0.3, z, 8);
    this.cyl(water, 0.45, 0.3, 0.12, x, 1.0, z, 10);
    this.cyl(STONE, 0.05, 0.05, 0.3, x, 1.1, z, 6);
  }

  geometry(): THREE.BufferGeometry {
    return this.body.geometry();
  }
}

// ---------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------

const shade = (c: number, f: number): number => {
  const col = new THREE.Color(c);
  col.multiplyScalar(f);
  return col.getHex();
};

interface Parts {
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry | null;
  pivot: THREE.BufferGeometry | null;
  pivotAt: THREE.Vector3;
  /** Pivot turn speed (rad/s) and axis (0 = Y, 1 = tilted wobble). */
  speed: number;
}

class Build {
  readonly k = new Kit();
  readonly g: Glass;
  pivotAt = new THREE.Vector3();
  speed = 0.6;

  constructor(
    readonly st: Style,
    readonly W: number,
    readonly D: number,
    readonly H: number,
    readonly seed: number,
  ) {
    this.g = new Glass(st.tint);
  }

  /** One stacked tier of a tower: walls, ledges, corner piers, windows. Returns the roof height. */
  tier(o: { cx?: number; cz?: number; w: number; d: number; y0: number; h: number; wall?: number; ledge?: number; piers?: boolean; base?: boolean; skip?: string }): number {
    const { k, st } = this;
    const cx = o.cx ?? 0;
    const cz = o.cz ?? 0;
    const wall = o.wall ?? st.wall;
    k.slab(wall, o.w, o.h, o.d, cx, o.y0, cz);
    const gap = o.base ? 1.15 : 0.3;
    if (o.base) {
      k.slab(st.wall2, o.w + 0.12, 1.0, o.d + 0.12, cx, o.y0, cz);
      k.slab(st.accent, Math.min(1.1, o.w * 0.3), 1.6, 0.14, cx, o.y0, cz + o.d / 2 + 0.02);
      k.slab(SNOW, Math.min(1.5, o.w * 0.4), 0.1, 0.5, cx, o.y0, cz + o.d / 2 + 0.3);
    }
    const floors = Math.max(1, Math.round(o.h / st.floorH));
    if (o.ledge) for (let f = o.ledge; f < floors; f += o.ledge) k.slab(st.trim, o.w + 0.16, 0.14, o.d + 0.16, cx, o.y0 + (f * o.h) / floors, cz);
    if (o.piers) {
      const px = o.w / 2 - 0.05;
      const pz = o.d / 2 - 0.05;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.slab(st.trim, 0.32, o.h, 0.32, cx + sx * px, o.y0, cz + sz * pz);
    }
    this.g.shaft(cx, cz, o.w, o.d, o.y0 + gap, o.y0 + o.h - 0.55, st.floorH, st.cellW, this.seed % 7, o.skip ?? '');
    return o.y0 + o.h;
  }

  /** Flat roof: trim parapet + snow. Returns the top of the snow. */
  flatRoof(w: number, d: number, y: number, cx = 0, cz = 0): number {
    const { k, st } = this;
    k.slab(st.trim, w + 0.16, 0.3, d + 0.16, cx, y, cz);
    k.snow(w + 0.1, d + 0.1, cx, y + 0.3, cz);
    return y + 0.55;
  }

  /** Hip roof with snow (mansard-ish): a pyramid in the roof colour plus a snow cap. */
  hipRoof(w: number, d: number, y: number, rise: number, cx = 0, cz = 0): number {
    const { k, st } = this;
    k.slab(st.trim, w + 0.2, 0.2, d + 0.2, cx, y, cz);
    k.pyr(st.roof, w + 0.3, d + 0.3, rise, cx, y + 0.2, cz);
    k.pyr(SNOW, w * 0.62, d * 0.62, rise * 0.62, cx, y + 0.2 + rise * 0.38, cz);
    return y + 0.2 + rise;
  }

  chimney(x: number, z: number, y: number, h = 1.3, w = 0.5): void {
    const { k, st } = this;
    k.slab(shade(st.wall2, 0.9), w, h, w, x, y, z);
    k.slab(st.trim, w + 0.14, 0.12, w + 0.14, x, y + h, z);
    k.slab(SNOW, w + 0.08, 0.1, w + 0.08, x, y + h + 0.12, z);
  }

  /** Little rooftop plant: boxes, a tank and a mast. */
  rooftop(y: number, w: number, d: number, tank = true, mast = 0): void {
    const { k, st } = this;
    k.slab(shade(st.wall, 0.8), w * 0.3, 0.8, d * 0.28, -w * 0.22, y, -d * 0.18);
    k.slab(SNOW, w * 0.3, 0.1, d * 0.28, -w * 0.22, y + 0.8, -d * 0.18);
    if (tank) {
      k.cyl(WOOD_D, 0.5, 0.5, 0.9, w * 0.2, y + 0.5, d * 0.1, 8);
      for (const sx of [-0.3, 0.3]) for (const sz of [-0.3, 0.3]) k.slab(IRON_D, 0.08, 0.5, 0.08, w * 0.2 + sx, y, d * 0.1 + sz);
      k.cone(SNOW, 0.55, 0.35, w * 0.2, y + 1.4, d * 0.1, 8);
    }
    if (mast > 0) {
      k.cyl(IRON_D, 0.05, 0.03, mast, w * 0.3, y, -d * 0.25, 5);
      k.slab(st.accent, 0.22, 0.22, 0.22, w * 0.3, y + mast, -d * 0.25);
    }
  }

  finish(): Parts {
    const pivot = this.k.pivot.empty ? null : this.k.pivot.geometry();
    return { body: this.k.geometry(), glass: this.g.empty ? null : this.g.geometry(), pivot, pivotAt: this.pivotAt, speed: this.speed };
  }
}

/** Number of tiers and their width / height shares by era (taller eras step back). */
function tierPlan(n: number, kind: 'home' | 'work'): { f: number; s: number }[] {
  if (n <= 5) return [{ f: 1, s: 1 }];
  if (n === 6) return [{ f: 0.52, s: 1 }, { f: 0.3, s: 0.78 }, { f: 0.18, s: 0.56 }];
  if (n === 7) return kind === 'home' ? [{ f: 0.75, s: 1 }, { f: 0.25, s: 0.8 }] : [{ f: 0.62, s: 1 }, { f: 0.38, s: 0.74 }];
  if (n === 8) return [{ f: 0.7, s: 1 }, { f: 0.3, s: 0.8 }];
  if (n === 9) return [{ f: 0.55, s: 1 }, { f: 0.3, s: 0.8 }, { f: 0.15, s: 0.55 }];
  return [{ f: 0.36, s: 1 }, { f: 0.28, s: 0.82 }, { f: 0.22, s: 0.64 }, { f: 0.14, s: 0.46 }];
}

// ---------------------------------------------------------------------------
// homes and workplaces (era 2: cottages / trading post, 3..10: stacked towers with era roofs)
// ---------------------------------------------------------------------------

function frontierHome(b: Build): void {
  const { k, st, W, D } = b;
  const wc = W * 0.47;
  const dc = D * 0.84;
  for (const [i, sx] of ([-1, 1] as const).entries()) {
    const cx = sx * (W * 0.265);
    const wallH = 2.5 + (i ? 0.3 : 0);
    const wall = i ? shade(st.wall, 0.92) : st.wall;
    k.slab(st.wall2, wc + 0.1, 0.5, dc + 0.1, cx, 0, 0);
    k.slab(wall, wc, wallH, dc, cx, 0, 0);
    // roof: ridge along X with slab overhang + snow
    const rise = 1.5;
    k.gable(st.roof, dc + 0.5, rise, wc + 0.4, cx, wallH, 0, true);
    k.gable(SNOW, dc + 0.6, rise * 0.55, wc + 0.5, cx, wallH + rise * 0.5, 0, true);
    k.slab(st.trim, 0.3, 0.14, 0.14, cx, wallH + rise * 0.45, 0);
    b.chimney(cx + wc * 0.28, -dc * 0.2, wallH + 0.4, 1.4, 0.46);
    // door and shutters
    k.slab(WOOD_D, 0.62, 1.4, 0.14, cx - wc * 0.2, 0, dc / 2 + 0.02);
    k.slab(SNOW, 0.9, 0.1, 0.5, cx - wc * 0.2, 0, dc / 2 + 0.3);
    b.g.wall(cx + wc * 0.05, dc / 2, cx + wc * 0.45, dc / 2, 0.9, 2.1, 0, 1, 1, 1, 3 + i * 5, i);
    b.g.wall(cx + wc / 2, dc / 2, cx + wc / 2, -dc / 2, 0.9, 2.1, 1, 0, 2, 1, 7, i);
    for (const s of [-1, 1]) k.slab(st.trim, 0.1, 1.2, 0.12, cx + wc * 0.25 + s * 0.34, 0.9, dc / 2 + 0.03);
  }
}

function frontierWork(b: Build): void {
  const { k, st, W, D } = b;
  const h = 2.9;
  k.slab(STONE_D, W, 0.6, D, 0, 0, 0);
  k.slab(WOOD, W - 0.2, h, D - 0.2, 0, 0.3, 0);
  for (let i = -2; i <= 2; i++) k.slab(WOOD_D, 0.12, h, 0.12, (i * (W - 0.5)) / 4, 0.3, (D - 0.2) / 2 + 0.01); // posts
  k.gable(st.roof, D + 0.6, 1.7, W + 0.5, 0, h + 0.3, 0, true);
  k.gable(SNOW, D + 0.7, 1.0, W + 0.6, 0, h + 0.3 + 0.8, 0, true);
  // porch awning (red/white stripes), sign, barrels and crates
  for (let i = 0; i < 6; i++) k.slab(i % 2 ? WHITE : st.wall, (W - 0.4) / 6, 0.07, 1.2, -W / 2 + 0.2 + ((i + 0.5) * (W - 0.4)) / 6, 2.35, D / 2 + 0.5);
  k.slab(SNOW, W - 0.6, 0.07, 1.0, 0, 2.43, D / 2 + 0.5);
  k.slab(st.accent, W * 0.5, 0.45, 0.1, 0, h + 0.05, D / 2 + 0.02);
  k.cyl(WOOD_D, 0.32, 0.32, 0.6, -W * 0.38, 0.3, D / 2 + 0.7, 8);
  k.cyl(WOOD, 0.3, 0.3, 0.55, -W * 0.28, 0.3, D / 2 + 0.85, 8);
  k.slab(WOOD, 0.55, 0.45, 0.45, W * 0.34, 0.3, D / 2 + 0.7);
  k.slab(WOOD_D, 0.5, 0.4, 0.4, W * 0.4, 0.3, D / 2 + 0.85);
  b.g.wall(-W * 0.4, D / 2 - 0.1, -W * 0.05, D / 2 - 0.1, 1.0, 2.2, 0, 1, 2, 1, 2, 0);
  b.g.wall(W * 0.1, D / 2 - 0.1, W * 0.42, D / 2 - 0.1, 1.0, 2.2, 0, 1, 2, 1, 5, 1);
  k.slab(WOOD_D, 0.7, 1.6, 0.14, W * 0.02, 0.3, D / 2);
}

function towerHome(b: Build, n: number, kind: 'home' | 'work'): void {
  const { k, st, W, D, H } = b;
  const plan = tierPlan(n, kind);
  let y = 0;
  let top = 0;
  plan.forEach((t, i) => {
    const w = W * t.s;
    const d = D * t.s;
    const h = Math.max(st.floorH, H * t.f);
    const wall = i % 2 && n >= 8 ? st.wall2 : st.wall;
    top = b.tier({ w, d, y0: y, h, wall: i ? shade(wall, 0.96) : wall, ledge: n >= 6 ? 2 : n === 5 ? 2 : 0, piers: n >= 3 && n <= 6, base: i === 0 });
    if (i < plan.length - 1) {
      // setback terrace: snow + (AI) a green roof garden
      k.slab(st.trim, w + 0.1, 0.18, d + 0.1, 0, top, 0);
      k.snow(w, d, 0, top + 0.18, 0, 0.16);
      if (n === 10) {
        k.slab(LEAF_L, w * 0.5, 0.35, 0.8, 0, top + 0.18, d * 0.38);
        k.tree(-w * 0.3, d * 0.34, 0.55, 'holo');
      }
    }
    y = top;
  });
  const w = W * plan[plan.length - 1]!.s;
  const d = D * plan[plan.length - 1]!.s;
  switch (n) {
    case 3: {
      const ry = b.flatRoof(w, d, top);
      for (const x of [-0.3, 0, 0.3]) k.slab(st.wall2, 0.28, 0.7, 0.28, x * w, ry - 0.2, -d * 0.2);
      b.chimney(w * 0.3, d * 0.1, top + 0.3, 1.2, 0.5);
      break;
    }
    case 4: {
      const r = b.hipRoof(w, d, top, Math.min(2.2, H * 0.28));
      b.chimney(w * 0.3, -d * 0.2, top + 0.4, r - top + 0.4, 0.5);
      for (const x of [-0.25, 0.25]) {
        k.slab(st.wall2, 0.7, 0.8, 0.5, x * w, top + 0.2, d / 2 - 0.35);
        k.gable(st.roof, 0.9, 0.5, 0.6, x * w, top + 1.0, d / 2 - 0.35, true);
      }
      break;
    }
    case 5: {
      const ry = b.flatRoof(w, d, top);
      b.rooftop(ry, w, d, true);
      // fire escape zig-zag down the right side
      const rows = Math.max(2, Math.round(H / st.floorH));
      for (let f = 1; f < rows; f++) {
        k.slab(IRON_D, 0.12, 0.08, d * 0.5, w / 2 + 0.12, (f * H) / rows, 0);
        k.slab(IRON_D, 0.06, (H / rows) * 0.9, 0.06, w / 2 + 0.12, (f * H) / rows - (H / rows) * 0.9, (f % 2 ? 1 : -1) * d * 0.22);
      }
      break;
    }
    case 6: {
      const ry = b.flatRoof(w, d, top);
      k.cyl(st.trim, 0.22, 0.04, 2.6, 0, ry, 0, 6);
      k.sph(st.accent, 0.22, 0, ry + 2.7, 0);
      for (const s of [-1, 1]) k.slab(st.trim, 0.2, 1.2, 0.2, s * w * 0.35, ry, 0);
      break;
    }
    case 7: {
      const ry = b.flatRoof(w, d, top);
      b.rooftop(ry, w, d, false, 2.6);
      k.slab(st.trim, w * 0.7, 0.18, d * 0.18, 0, ry, d * 0.3);
      break;
    }
    case 8: {
      const ry = b.flatRoof(w, d, top);
      for (const x of [-0.25, 0.2]) k.slab(0x2a4a6a, w * 0.34, 0.12, d * 0.5, x * w, ry + 0.25, 0, 0);
      k.slab(SNOW, w * 0.2, 0.08, d * 0.4, 0.2 * w, ry + 0.4, 0);
      k.cyl(st.trim, 0.05, 0.03, 2.2, w * 0.3, ry, -d * 0.3, 5);
      break;
    }
    case 9: {
      const ry = b.flatRoof(w, d, top);
      k.cyl(st.wall2, w * 0.2, w * 0.14, 1.6, -w * 0.2, ry, 0, 10);
      k.cone(SNOW, w * 0.15, 0.3, -w * 0.2, ry + 1.6, 0, 10);
      k.cyl(st.accent, 0.05, 0.03, 2.4, w * 0.25, ry, 0, 5);
      break;
    }
    default: {
      const ry = b.flatRoof(w, d, top);
      k.slab(LEAF_L, w * 0.7, 0.3, d * 0.7, 0, ry, 0);
      k.tree(0, 0, 0.5, 'holo');
      k.torus(st.accent, Math.min(w, d) * 0.45, 0.07, 0, ry + 1.4, 0);
    }
  }
  // work: a sign band over the entrance and an era extra
  if (kind === 'work') {
    k.slab(st.accent, W * 0.55, 0.5, 0.12, 0, 1.3, D / 2 + 0.06);
    if (n === 3) {
      k.cyl(st.wall2, 0.5, 0.35, 4.2, -W * 0.38, 0, -D * 0.3, 8);
      k.cyl(st.trim, 0.42, 0.42, 0.2, -W * 0.38, 4.2, -D * 0.3, 8);
      k.cyl(SNOW, 0.36, 0.36, 0.1, -W * 0.38, 4.4, -D * 0.3, 8);
    } else if (n === 5) {
      for (let i = 0; i < 3; i++) k.gable(shade(st.roof, 1.1), D * 0.3, 0.9, W * 0.3, -W * 0.3 + i * W * 0.3, top + 0.3, 0, true);
      k.cyl(st.wall2, 0.5, 0.4, 5, W * 0.4, 0, -D * 0.25, 8);
    } else if (n === 7) {
      k.slab(st.trim, W * 0.8, 0.18, 0.18, 0, top * 0.5, D / 2 + 0.1);
    } else if (n === 9) {
      k.cyl(st.wall2, 1.1, 0.8, 4, W * 0.4, 0, D * 0.1, 12);
      k.cyl(SNOW, 0.85, 0.85, 0.18, W * 0.4, 4, D * 0.1, 12);
    }
  }
}

// ---------------------------------------------------------------------------
// parks (low gardens with a themed centrepiece)
// ---------------------------------------------------------------------------

function park(b: Build, n: number): void {
  const { k, st, W, D } = b;
  k.slab(0xeaf2f8, W, 0.1, D, 0, 0, 0);
  k.slab(PAVE, W * 0.18, 0.12, D, 0, 0, 0);
  k.slab(PAVE, W, 0.12, D * 0.18, 0, 0, D * 0.12);
  const kind = n >= 10 ? 'holo' : n >= 6 ? 'round' : 'pine';
  switch (n) {
    case 2: {
      // village school: red schoolhouse with a bell cupola
      k.slab(st.wall2, W * 0.5, 0.4, D * 0.4, 0, 0.1, -D * 0.2);
      k.slab(st.wall, W * 0.46, 1.9, D * 0.36, 0, 0.1, -D * 0.2);
      k.gable(st.roof, D * 0.46, 1.1, W * 0.52, 0, 2.0, -D * 0.2, true);
      k.gable(SNOW, D * 0.5, 0.7, W * 0.56, 0, 2.4, -D * 0.2, true);
      k.slab(WHITE, 0.5, 0.6, 0.5, 0, 3.0, -D * 0.2);
      k.cone(st.accent, 0.42, 0.5, 0, 3.6, -D * 0.2, 4, Math.PI / 4);
      b.g.wall(-W * 0.2, -D * 0.2 + D * 0.18, W * 0.2, -D * 0.2 + D * 0.18 + 0, 0.7, 1.8, 0, 1, 3, 1, 4, 0);
      k.slab(WOOD_D, 0.5, 1.2, 0.1, 0, 0.1, -D * 0.02 + 0.06);
      break;
    }
    case 3: {
      // iron bridge over a frozen pond
      k.cyl(ICE, W * 0.34, W * 0.34, 0.06, 0, 0.1, -D * 0.1, 14);
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI;
        const x = Math.cos(a) * W * 0.3;
        const y = 0.3 + Math.sin(a) * 1.0;
        k.slab(IRON_D, 0.5, 0.14, 0.9, x, y, -D * 0.1);
        if (i % 2 === 0) for (const s of [-0.4, 0.4]) k.slab(IRON_D, 0.08, 0.6, 0.08, x, y, -D * 0.1 + s);
      }
      for (const s of [-1, 1]) k.cyl(IRON_D, 0.06, 0.05, 2.0, s * W * 0.4, 0, D * 0.25, 5);
      break;
    }
    case 4: {
      // steam baths: pavilion with two steaming pools
      k.slab(STONE, W * 0.7, 1.8, D * 0.38, 0, 0.1, -D * 0.28);
      k.sph(st.accent, W * 0.2, 0, 1.9, -D * 0.28, 0.8);
      k.sph(SNOW, W * 0.14, 0, 2.3, -D * 0.28, 0.5);
      for (const s of [-1, 1]) {
        k.cyl(STONE_D, W * 0.17, W * 0.17, 0.3, s * W * 0.22, 0.1, D * 0.12, 12);
        k.cyl(WATER, W * 0.14, W * 0.14, 0.04, s * W * 0.22, 0.38, D * 0.12, 12);
        k.sph(WHITE, 0.4, s * W * 0.22, 1.0, D * 0.12, 0.7);
        k.sph(WHITE, 0.3, s * W * 0.22 + 0.2, 1.5, D * 0.12, 0.7);
      }
      b.g.wall(-W * 0.3, -D * 0.28 + D * 0.19, W * 0.3, -D * 0.28 + D * 0.19, 0.6, 1.6, 0, 1, 3, 1, 1, 0);
      break;
    }
    case 5: {
      // public library: classical front with columns and a pediment
      k.slab(STONE, W * 0.78, 0.5, D * 0.46, 0, 0.1, -D * 0.22);
      k.slab(st.wall, W * 0.7, 2.3, D * 0.4, 0, 0.6, -D * 0.22);
      for (let i = 0; i < 5; i++) k.cyl(WHITE, 0.14, 0.14, 2.3, -W * 0.28 + i * W * 0.14, 0.6, -D * 0.22 + D * 0.2 + 0.2, 8);
      k.slab(STONE, W * 0.78, 0.25, D * 0.12, 0, 2.9, -D * 0.22 + D * 0.2 + 0.2);
      k.gable(STONE, D * 0.15, 0.7, W * 0.76, 0, 3.15, -D * 0.22 + D * 0.2 + 0.2, true);
      k.slab(SNOW, W * 0.72, 0.1, D * 0.46, 0, 3.0, -D * 0.22);
      b.g.wall(-W * 0.3, -D * 0.22 + D * 0.2, W * 0.3, -D * 0.22 + D * 0.2, 0.9, 2.5, 0, 1, 4, 1, 0, 0);
      break;
    }
    case 6: {
      // picture palace: a deco cinema with a glowing marquee
      k.slab(st.wall, W * 0.72, 2.8, D * 0.4, 0, 0.1, -D * 0.24);
      k.slab(st.trim, W * 0.76, 0.2, D * 0.44, 0, 2.9, -D * 0.24);
      k.slab(SNOW, W * 0.7, 0.14, D * 0.4, 0, 3.1, -D * 0.24);
      k.slab(st.accent, W * 0.5, 0.9, 0.14, 0, 1.6, -D * 0.04 + 0.06);
      k.slab(st.trim, W * 0.56, 0.18, 0.4, 0, 1.45, -D * 0.04 + 0.12);
      k.slab(0xffe08a, W * 0.2, 1.6, 0.12, W * 0.28, 1.4, -D * 0.04 + 0.1);
      b.g.wall(-W * 0.3, -D * 0.04, W * 0.12, -D * 0.04, 0.5, 1.3, 0, 1, 3, 1, 2, 0);
      break;
    }
    case 7: {
      // shopping mall: a wide low hall with a glass vault
      k.slab(st.wall, W * 0.8, 2.0, D * 0.45, 0, 0.1, -D * 0.22);
      k.slab(st.trim, W * 0.84, 0.18, D * 0.49, 0, 2.1, -D * 0.22);
      k.vault(0xa7c8d8, D * 0.3, 1.2, W * 0.5, 0, 2.28, -D * 0.22, true);
      k.slab(SNOW, W * 0.4, 0.12, D * 0.2, 0, 3.3, -D * 0.22);
      b.g.wall(-W * 0.38, -D * 0.0, W * 0.38, -D * 0.0, 0.5, 1.9, 0, 1, 5, 1, 3, 0);
      k.slab(st.trim, W * 0.9, 0.5, 0.1, 0, 2.3, -D * 0.0 + 0.03);
      break;
    }
    case 8: {
      // arcade plaza: neon arches and kiosks on a paved plaza
      k.slab(0xc9cdd2, W * 0.9, 0.14, D * 0.9, 0, 0.1, 0);
      for (const s of [-1, 0, 1]) {
        k.torus(st.accent, W * 0.12, 0.07, s * W * 0.28, 1.0 + W * 0.12, -D * 0.2, { rx: 0 });
        k.slab(st.trim, 0.14, 1.0, 0.14, s * W * 0.28 - W * 0.12, 0.1, -D * 0.2);
        k.slab(st.trim, 0.14, 1.0, 0.14, s * W * 0.28 + W * 0.12, 0.1, -D * 0.2);
      }
      for (const s of [-1, 1]) {
        k.slab(st.wall2, 1.0, 1.3, 0.8, s * W * 0.3, 0.1, D * 0.18);
        k.slab(st.accent, 1.2, 0.14, 1.0, s * W * 0.3, 1.4, D * 0.18);
        k.slab(SNOW, 1.1, 0.08, 0.9, s * W * 0.3, 1.54, D * 0.18);
      }
      break;
    }
    case 9: {
      // science museum: a dome with an atom sculpture
      k.slab(STONE, W * 0.7, 1.5, D * 0.4, 0, 0.1, -D * 0.22);
      k.sph(st.wall2, W * 0.26, 0, 1.6, -D * 0.22, 0.9);
      k.sph(SNOW, W * 0.18, 0, 2.15, -D * 0.22, 0.45);
      k.sph(st.accent, 0.3, W * 0.28, 1.4, D * 0.22);
      for (let i = 0; i < 3; i++) k.torus(st.trim, 0.7, 0.05, W * 0.28, 1.4, D * 0.22, { rx: Math.PI / 2 + (i * Math.PI) / 3, ry: (i * Math.PI) / 3 });
      b.g.wall(-W * 0.3, -D * 0.22 + D * 0.2, W * 0.3, -D * 0.22 + D * 0.2, 0.5, 1.5, 0, 1, 4, 1, 6, 0);
      break;
    }
    default: {
      // holo park: a glowing sphere over a pad, ring and holo trees
      k.cyl(st.roof, W * 0.28, W * 0.3, 0.2, 0, 0.1, 0, 16);
      k.cyl(st.accent, W * 0.22, W * 0.22, 0.06, 0, 0.3, 0, 16);
      k.sph(HOLO, 0.8, 0, 1.6, 0, 1);
      k.torus(st.accent, 1.3, 0.05, 0, 1.6, 0, { rx: Math.PI / 2 });
      k.torus(HOLO, 1.1, 0.04, 0, 1.6, 0, { rx: 0.5 });
    }
  }
  // trees on the corners, benches along the path, a fountain on the early plazas
  const tr = n >= 10 ? 0.9 : 1;
  for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]] as const) k.tree(x * W * 0.9, z * D * 0.82, 0.8 * tr + (b.seed % 3) * 0.05, kind);
  k.bench(-W * 0.2, D * 0.32, 0);
  k.bench(W * 0.2, D * 0.32, 0);
  if (n === 8 || n === 9) k.fountain(0, D * 0.14, 0.7);
  if (n === 5 || n === 2) k.fountain(-W * 0.3, D * 0.14, 0.6);
}

// ---------------------------------------------------------------------------
// landmarks (one per district)
// ---------------------------------------------------------------------------

function landmark(b: Build, n: number): void {
  const { k, st, W, D, H } = b;
  switch (n) {
    case 2: {
      // clock tower: stone shaft, clock faces, belfry, pyramid roof and a vane
      const w = Math.min(W, D) * 0.55;
      k.slab(st.wall2, W * 0.8, 0.8, D * 0.8, 0, 0, 0);
      const y1 = H * 0.62;
      k.slab(STONE, w, y1, w, 0, 0.8, 0);
      for (let i = 1; i < 4; i++) k.slab(STONE_D, w + 0.12, 0.1, w + 0.12, 0, 0.8 + (i * y1) / 4, 0);
      b.g.shaft(0, 0, w, w, 2.1, 0.8 + y1 - 2.5, 2.2, 1.4, 2);
      const yc = 0.8 + y1;
      k.slab(st.trim, w + 0.3, 0.3, w + 0.3, 0, yc, 0);
      k.slab(STONE, w * 0.9, 1.7, w * 0.9, 0, yc + 0.3, 0);
      const fo = w * 0.45 + 0.05;
      for (const [x, z, onX] of [[0, fo, false], [0, -fo, false], [fo, 0, true], [-fo, 0, true]] as const) {
        k.cyl(WHITE, 0.62, 0.62, 0.1, x, yc + 1.15 - 0.62, z, 14, onX ? { rz: Math.PI / 2 } : { rx: Math.PI / 2 });
        k.slab(IRON_D, onX ? 0.12 : 0.07, 0.5, onX ? 0.07 : 0.12, x, yc + 1.15, z);
      }
      const yr = yc + 2.0;
      k.pyr(st.roof, w + 0.5, w + 0.5, 2.4, 0, yr, 0);
      k.pyr(SNOW, w * 0.6, w * 0.6, 1.5, 0, yr + 0.9, 0);
      k.cyl(st.accent, 0.04, 0.03, 1.0, 0, yr + 2.4, 0, 5);
      b.pivotAt.set(0, yr + 3.2, 0);
      b.speed = 0.8;
      k.spin(() => {
        k.slab(st.accent, 0.6, 0.12, 0.05, 0, -0.06, 0);
        k.slab(st.accent, 0.12, 0.3, 0.05, 0.3, -0.06, 0);
      });
      for (const s of [-1, 1]) k.tree(s * W * 0.4, D * 0.38, 0.7);
      break;
    }
    case 3: {
      // railway station: a long hall with a barrel-vault shed and a clock turret
      k.slab(st.wall2, W, 0.5, D, 0, 0, 0);
      k.slab(st.wall, W * 0.94, 2.8, D * 0.5, 0, 0.5, -D * 0.22);
      k.vault(st.roof, D * 0.5, 1.6, W * 0.94, 0, 3.3, -D * 0.22, true);
      k.vault(SNOW, D * 0.52, 0.8, W * 0.9, 0, 4.1, -D * 0.22, true);
      b.g.shaft(0, -D * 0.22, W * 0.94, D * 0.5, 1.2, 3.0, 2.2, 1.7, 3, 'bl');
      // platform canopy in front
      k.slab(IRON_D, W * 0.9, 0.12, D * 0.3, 0, 2.5, D * 0.28);
      k.slab(SNOW, W * 0.86, 0.1, D * 0.26, 0, 2.62, D * 0.28);
      for (const s of [-1, 0, 1]) k.slab(IRON_D, 0.14, 2.5, 0.14, s * W * 0.4, 0.5, D * 0.4);
      // clock turret
      const tw = W * 0.14;
      k.slab(st.trim, tw, H * 0.7 - 1, tw, W * 0.32, 3.3, -D * 0.22);
      k.cyl(WHITE, tw * 0.4, tw * 0.4, 0.08, W * 0.32, H * 0.5 + 1.5, -D * 0.22 + tw / 2 + 0.02, 12, { rx: Math.PI / 2 });
      k.pyr(st.roof, tw + 0.3, tw + 0.3, 1.2, W * 0.32, H * 0.7 + 2.3, -D * 0.22);
      k.pyr(SNOW, tw * 0.6, tw * 0.6, 0.7, W * 0.32, H * 0.7 + 2.55, -D * 0.22);
      for (const s of [-1, 1]) k.slab(IRON_D, 0.14, 0.14, D * 0.2, s * W * 0.2, 0.5, D * 0.4);
      break;
    }
    case 4: {
      // grand exchange: stepped base, columns, a pediment and a dome
      k.slab(STONE, W, 0.3, D, 0, 0, 0);
      k.slab(STONE_D, W * 0.92, 0.3, D * 0.9, 0, 0.3, 0);
      k.slab(st.wall, W * 0.8, 3.2, D * 0.55, 0, 0.6, -D * 0.1);
      b.g.shaft(0, -D * 0.1, W * 0.8, D * 0.55, 1.0, 3.5, 2.4, 1.7, 4, 'f');
      for (let i = 0; i < 6; i++) k.cyl(WHITE, 0.16, 0.14, 3.2, -W * 0.38 + i * W * 0.152, 0.6, D * 0.2, 8);
      k.slab(STONE, W * 0.88, 0.35, D * 0.14, 0, 3.8, D * 0.2);
      k.gable(STONE, D * 0.16, 1.0, W * 0.86, 0, 4.15, D * 0.2, true);
      k.gable(SNOW, D * 0.17, 0.5, W * 0.86, 0, 4.6, D * 0.2, true);
      k.slab(STONE, W * 0.8, 0.3, D * 0.55, 0, 3.8, -D * 0.1);
      k.cyl(st.wall2, W * 0.26, W * 0.26, 0.9, 0, 4.1, -D * 0.1, 14);
      k.sph(st.accent, W * 0.26, 0, 5.0, -D * 0.1, 0.9);
      k.sph(SNOW, W * 0.18, 0, 5.4, -D * 0.1, 0.4);
      k.cyl(st.accent, 0.05, 0.04, 1.2, 0, 5.9, -D * 0.1, 5);
      break;
    }
    case 5: {
      // expo hall: an iron-and-glass vault between two brick end towers
      k.slab(st.wall2, W, 0.5, D, 0, 0, 0);
      k.slab(st.wall, W * 0.5, 2.2, D * 0.85, 0, 0.5, 0);
      k.vault(0xa7c8d8, W * 0.46, 2.6, D * 0.85, 0, 2.7, 0);
      k.vault(SNOW, W * 0.47, 1.1, D * 0.8, 0, 3.8, 0);
      for (let i = 0; i < 5; i++) k.slab(IRON_D, W * 0.5, 0.1, 0.14, 0, 0.5, -D * 0.38 + (i * D * 0.76) / 4);
      b.g.wall(-W * 0.2, D * 0.43, W * 0.2, D * 0.43, 0.9, 2.5, 0, 1, 4, 1, 1, 0);
      for (const s of [-1, 1]) {
        k.slab(st.wall, W * 0.2, H * 0.65, D * 0.5, s * W * 0.38, 0, -D * 0.1);
        b.g.shaft(s * W * 0.38, -D * 0.1, W * 0.2, D * 0.5, 1.2, H * 0.65 - 0.6, st.floorH, st.cellW, 5 + s);
        b.flatRoof(W * 0.2, D * 0.5, H * 0.65, s * W * 0.38, -D * 0.1);
        k.cyl(st.wall2, 0.3, 0.22, 2.2, s * W * 0.38, H * 0.65 + 0.5, -D * 0.1, 7);
      }
      k.slab(st.accent, W * 0.4, 0.5, 0.1, 0, 3.0, D * 0.43 + 0.05);
      break;
    }
    case 6: {
      // radio tower: a tapering lattice with cross-braces, a platform, a mast and a turning beacon
      const base = Math.min(W, D) * 0.72;
      k.slab(st.wall2, W * 0.9, 0.5, D * 0.9, 0, 0, 0);
      const top = base * 0.12;
      const steps = 6;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) k.rod(st.trim, 0.2, (sx * base) / 2, 0.5, (sz * base) / 2, sx * top, 0.5 + H * 0.85, sz * top);
      }
      for (let i = 1; i <= steps; i++) {
        const f = i / (steps + 1);
        const w = base * (1 - f) + top * 2 * f;
        const y = 0.5 + H * 0.85 * f;
        k.slab(st.trim, w, 0.1, 0.1, 0, y, w / 2);
        k.slab(st.trim, w, 0.1, 0.1, 0, y, -w / 2);
        k.slab(st.trim, 0.1, 0.1, w, w / 2, y, 0);
        k.slab(st.trim, 0.1, 0.1, w, -w / 2, y, 0);
      }
      k.slab(st.accent, top * 2.6, 0.2, top * 2.6, 0, 0.5 + H * 0.85, 0);
      k.slab(SNOW, top * 2.4, 0.08, top * 2.4, 0, 0.7 + H * 0.85, 0);
      k.cyl(IRON_D, 0.06, 0.03, H * 0.18, 0, 0.7 + H * 0.85, 0, 5);
      b.pivotAt.set(0, 0.9 + H * 0.85, 0);
      b.speed = 1.6;
      k.spin(() => {
        k.slab(0xff6a5a, 0.18, 0.18, 0.18, 0.5, 0, 0);
        k.slab(st.accent, 1.0, 0.07, 0.12, 0, 0, 0);
        k.slab(WHITE, 0.18, 0.18, 0.18, -0.5, 0, 0);
      });
      break;
    }
    case 7: {
      // sky needle: a slender shaft, a saucer with a revolving ring
      k.slab(st.wall2, W * 0.9, 0.5, D * 0.9, 0, 0, 0);
      k.slab(st.wall, W * 0.5, 2.6, D * 0.5, 0, 0.5, 0);
      b.g.shaft(0, 0, W * 0.5, D * 0.5, 1.0, 2.9, st.floorH, st.cellW, 7);
      const hs = H * 0.62;
      k.cyl(st.wall, 0.8, 0.45, hs, 0, 3.1, 0, 8);
      for (const a of [0, 1, 2]) k.slab(st.trim, 0.1, hs, 0.1, Math.cos((a * Math.PI * 2) / 3) * 0.7, 3.1, Math.sin((a * Math.PI * 2) / 3) * 0.7);
      const ys = 3.1 + hs;
      k.cyl(st.trim, 0.45, 2.0, 0.5, 0, ys, 0, 14);
      k.cyl(st.roof, 2.0, 2.0, 0.6, 0, ys + 0.5, 0, 14);
      k.cyl(SNOW, 2.0, 1.2, 0.3, 0, ys + 1.1, 0, 14);
      k.cyl(st.trim, 0.1, 0.03, H * 0.22, 0, ys + 1.4, 0, 5);
      b.pivotAt.set(0, ys + 0.8, 0);
      b.speed = 0.5;
      k.spin(() => {
        k.torus(st.trim, 2.15, 0.12, 0, 0, 0, { rx: Math.PI / 2 });
        for (let i = 0; i < 4; i++) k.sph(st.accent, 0.22, Math.cos((i * Math.PI) / 2) * 2.15, 0, Math.sin((i * Math.PI) / 2) * 2.15);
      });
      break;
    }
    case 8: {
      // data spire: a tall glass tower with server fins, antennas and a turning dish ring
      k.slab(st.wall2, W * 0.9, 0.6, D * 0.9, 0, 0, 0);
      const w = W * 0.55;
      const d = D * 0.55;
      const t1 = b.tier({ w, d, y0: 0.6, h: H * 0.6, wall: st.wall, ledge: 3, base: true });
      const t2 = b.tier({ w: w * 0.7, d: d * 0.7, y0: t1, h: H * 0.3, wall: st.wall2, ledge: 3 });
      for (const s of [-1, 1]) k.slab(st.accent, 0.12, H * 0.8, d * 0.5, (s * w) / 2, 0.6, 0);
      b.flatRoof(w * 0.7, d * 0.7, t2);
      k.cyl(st.trim, 0.1, 0.04, H * 0.3, 0, t2 + 0.5, 0, 6);
      k.cyl(st.accent, 0.5, 0.5, 0.2, 0, t2 + 0.6, 0, 10);
      b.pivotAt.set(0, t2 + 1.4, 0);
      b.speed = 1.2;
      k.spin(() => {
        k.torus(st.accent, 0.9, 0.08, 0, 0, 0, { rx: Math.PI / 2 });
        k.sph(WHITE, 0.2, 0.9, 0, 0);
        k.sph(WHITE, 0.2, -0.9, 0, 0);
      });
      break;
    }
    case 9: {
      // atomic monument: a plinth and a nucleus with three turning electron rings
      k.slab(st.wall2, W * 0.9, 0.5, D * 0.9, 0, 0, 0);
      k.slab(st.wall, W * 0.4, 1.4, D * 0.4, 0, 0.5, 0);
      k.slab(SNOW, W * 0.38, 0.1, D * 0.38, 0, 1.9, 0);
      k.cyl(st.wall2, 0.3, 0.2, H * 0.42, 0, 2.0, 0, 8);
      const yc = 2.0 + H * 0.42 + 2.2;
      b.pivotAt.set(0, yc, 0);
      b.speed = 0.9;
      k.sph(st.accent, 0.9, 0, yc, 0, 1);
      k.spin(() => {
        for (let i = 0; i < 3; i++) {
          k.torus(st.trim, 2.2, 0.1, 0, 0, 0, { rx: Math.PI / 2 + (i * Math.PI) / 3, ry: (i * Math.PI) / 3 });
          const a = (i * Math.PI * 2) / 3;
          k.sph(FOAM, 0.3, Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2);
        }
      });
      for (const s of [-1, 1]) k.tree(s * W * 0.38, D * 0.35, 0.8, 'round');
      break;
    }
    default: {
      // singularity spire: a twisting stack of tapering tiers with a crown of turning rings
      k.slab(st.wall2, W * 0.95, 0.5, D * 0.95, 0, 0, 0);
      let y = 0.5;
      const tiers = 6;
      for (let i = 0; i < tiers; i++) {
        const s = 0.7 - i * 0.1;
        const h = (H * 0.78) / tiers;
        const w = Math.min(W, D) * s;
        k.slab(i % 2 ? st.wall2 : st.wall, w, h, w, 0, y, 0, i * 0.28);
        k.slab(st.accent, w * 0.5, 0.14, w * 0.5, 0, y + h, 0, i * 0.28 + 0.4);
        y += h;
      }
      b.g.shaft(0, 0, Math.min(W, D) * 0.7, Math.min(W, D) * 0.7, 1.2, 3.5, st.floorH, st.cellW, 9);
      k.cyl(st.accent, 0.18, 0.04, H * 0.22, 0, y, 0, 6);
      b.pivotAt.set(0, y + H * 0.1, 0);
      b.speed = 1.0;
      k.spin(() => {
        for (let i = 0; i < 3; i++) k.torus(i === 1 ? HOLO : st.accent, 1.0 + i * 0.45, 0.06, 0, i * 0.5 - 0.5, 0, { rx: Math.PI / 2 + i * 0.35 });
        k.sph(WHITE, 0.3, 0, 0, 0);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------

const partsCache = new Map<string, Parts>();

function buildParts(def: CityBuildingDef, seed: number, W: number, D: number): Parts {
  const n = def.era;
  const st = styleOf(n);
  const H = visualHeight(def.height);
  const b = new Build(st, W, D, H, seed);
  switch (def.kind) {
    case 'park':
      park(b, n);
      break;
    case 'landmark':
      landmark(b, n);
      break;
    case 'work':
      if (n === 2) frontierWork(b);
      else towerHome(b, n, 'work');
      break;
    default:
      if (n === 2) frontierHome(b);
      else towerHome(b, n, 'home');
  }
  return b.finish();
}

/**
 * Build the model of city building `id` (an id of eras/data.ts CITY_BUILDINGS) for a `fit` footprint (default: the
 * widest lot of its era). `seed` varies the walls a little (seeds 0..2 are distinct variants, geometry is cached).
 */
export function createCityBuilding(id: CityBuildingId | string, seed = 1, fit?: { w: number; d: number }): CityBuildingModel {
  const def = CITY_BUILDINGS[id as CityBuildingId];
  if (!def) throw new Error(`no city building ${id}`);
  const f = fit ?? maxFootprint(def.era);
  const W = Math.round(f.w * 100) / 100;
  const D = Math.round(f.d * 100) / 100;
  const variant = ((seed % 3) + 3) % 3;
  const key = `${id}|${variant}|${W}|${D}`;
  let parts = partsCache.get(key);
  if (!parts) {
    parts = buildParts(def, variant, W, D);
    partsCache.set(key, parts);
  }
  const root = new THREE.Group();
  root.name = `city:${id}`;
  const body = new THREE.Mesh(parts.body, vcMat());
  body.castShadow = true;
  body.receiveShadow = true;
  body.name = 'body';
  root.add(body);
  if (parts.glass) {
    const glass = new THREE.Mesh(parts.glass, glassMat());
    glass.name = 'glass';
    glass.castShadow = false;
    glass.receiveShadow = false;
    root.add(glass);
  }
  let pivot: THREE.Mesh | null = null;
  if (parts.pivot) {
    pivot = new THREE.Mesh(parts.pivot, vcMat());
    pivot.name = 'pivot';
    pivot.position.copy(parts.pivotAt);
    pivot.castShadow = true;
    root.add(pivot);
  }
  const speed = parts.speed;
  return {
    root,
    w: W,
    d: D,
    height: visualHeight(def.height),
    animate: (t: number): void => {
      if (pivot) pivot.rotation.y = t * speed;
    },
  };
}

/** A construction site on a w × d footprint: a dirt patch with corner poles and a rising shell (setProgress 0..1). */
export function createCityScaffold(w: number, d: number, wall = 0xc9c0ae, height = 4): { group: THREE.Group; setProgress(p: number): void } {
  const base = new Batch();
  const box = geo.boxBase(1, 1, 1);
  base.add(box, 0x8d7b66, 0, 0, 0, { sx: w, sy: 0.12, sz: d });
  base.add(box, SNOW, -w * 0.3, 0.1, -d * 0.3, { sx: 0.9, sy: 0.25, sz: 0.7 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) base.add(box, WOOD, (sx * (w - 0.3)) / 2, 0.1, (sz * (d - 0.3)) / 2, { sx: 0.14, sy: height, sz: 0.14 });
  for (const y of [height * 0.35, height * 0.7]) {
    base.add(box, WOOD_D, 0, y, (d - 0.3) / 2, { sx: w - 0.3, sy: 0.1, sz: 0.1 });
    base.add(box, WOOD_D, 0, y, -(d - 0.3) / 2, { sx: w - 0.3, sy: 0.1, sz: 0.1 });
  }
  const shell = new THREE.Mesh(box, toon(wall));
  shell.castShadow = true;
  shell.position.y = 0.12;
  shell.scale.set(w * 0.8, 0.01, d * 0.8);
  const group = new THREE.Group();
  group.add(base.mesh(), shell);
  return {
    group,
    setProgress(p: number): void {
      shell.scale.y = Math.max(0.01, p * height * 0.9);
      shell.visible = p > 0.02;
    },
  };
}

/** Gallery (?gallery=cityBuildings): all 36 buildings plus the construction site. */
export const cityBuildingCatalog: Record<string, () => THREE.Object3D> = {
  ...Object.fromEntries(CITY_BUILDING_IDS.map((id) => [id, (): THREE.Object3D => createCityBuilding(id, 1).root])),
  cityScaffold: () => createCityScaffold(5, 4).group,
};
