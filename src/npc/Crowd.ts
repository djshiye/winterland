/**
 * [T3 — townsfolk] The instanced crowd: ANY number of people (up to TOWN.crowdMax) for a fixed handful of draw calls.
 *
 * A "rigged" character is 6 draw calls (+6 shadow), so a market square of 40 people would cost ~500. Here every body
 * part of every person is one INSTANCE of a shared part mesh:
 *
 *   torso (coat + scarf) · head (skin + eyes) · hat (beanie + pompom) · arms (2 instances / person: sleeve + mitten)
 *   · boots (2 / person)                                  = 5 draw calls (+5 in the shadow pass), 0 when nobody is alive
 *   + basket (compacted: only buyers holding goods)       = +1 (+1 shadow) while a buyer carries goods
 *   + lanterns + their halos                              = +2, only while someone carries a lantern (night)
 * Measured on the market square with 48 people: +10 draw calls at High (shadows on), +5 at Low; ≈ 1900 triangles per
 * person across both passes (≈ 950 each).
 *
 * Look: the same toy body as assets/characters.ts buildPawn (lathe "bean" torso NPC_BODY_R × NPC_BODY_H, round head
 * NPC_HEAD_R with the shared addFace eyes, glints and cheeks, mittens with thumbs, round boots, beanie with pompom),
 * scaled 0.72 for kids. Coat and trim colours come from the CLOTH palette (no blue pawns).
 *
 * Colour: the parts are vertex-coloured (Batch) with one extra per-vertex `role` (0 = fixed colour, 1 = coat, 2 = trim)
 * and two per-instance colours (iCoat, iTrim) picked up by a patched toon material, so a coat, a scarf, a hat and a pair
 * of mittens can all differ per person without extra draw calls. Instance colours are written only when a person is
 * (re)spawned.
 *
 * Animation: every frame the active people's part matrices are composed straight into the instanceMatrix arrays (no
 * allocation): walk bob + waddle + arm / boot swing, idle breathing, sitting (lowered, boots forward), cheer hop with
 * both arms up, waving, working (staff), carrying a basket, holding a lantern, talking nods.
 *
 * Culling: each part carries ONE hand-set bounding sphere around the village street + the town (never recomputed from the
 * instances), so the meshes are culled correctly when the camera is elsewhere and cost nothing when nobody is alive.
 * Shadows: cast only at High quality (read per frame from the renderer).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAMERA, LAYOUT, TOWN } from '../config';
import { CHARACTER_HIP_Y, CLOTH, MAT, NPC_BODY_H, NPC_BODY_R, NPC_HEAD_R, SKIN_TONES, addFace, beanRadius } from '../assets/characters';
import { CREAM } from '../render/palette';
import { Batch, type PartOpts } from '../render/batch';
import { additiveKeepAlpha, geo, toonUnique } from '../render/materials';
import { registerGlow } from '../world/env/glow';

const HIP = CHARACTER_HIP_Y;
/** Lift of the root while sitting (hip ends up at seat height). */
export const SIT_LIFT = 0.34;
export const KID_SCALE = 0.72;

// ---------------------------------------------------------------------------
// Looks
// ---------------------------------------------------------------------------

/** Cosy coats (assets/characters.ts CLOTH: warm and clear, never the ad's blue; distinct from the player's pine green). */
export const COAT_COLORS: readonly number[] = [
  CLOTH.brick,
  CLOTH.teal,
  CLOTH.mustard,
  CLOTH.plum,
  CLOTH.berry,
  CLOTH.rose,
  CLOTH.cream,
  CLOTH.pumpkin,
  CLOTH.cocoa,
  CLOTH.heather,
];
/** Scarf / hat / mitten colours. */
export const TRIM_COLORS: readonly number[] = [CLOTH.cream, CLOTH.mustard, CLOTH.brick, CLOTH.mint, CLOTH.oat, CLOTH.pumpkin, CLOTH.blush, CLOTH.teal];
/** Goods colours shown in a buyer's basket. */
export const GOODS_COLORS: Record<string, number> = {
  bread: 0xe9b25f,
  sausage: 0xd9695f,
  toy: 0xe2453c,
  wheat: 0xf0cf6a,
  meat: 0xd9695f,
  default: 0xf4c46d,
};

/** One person's render state, written by Townsfolk, read by Crowd.update. All angles in radians. */
export class CrowdPerson {
  active = false;
  /** Instance index (stable). */
  readonly id: number;
  x = 0;
  z = 0;
  /** Extra height (cheer hops are added on top). */
  y = 0;
  yaw = 0;
  scale = 1;
  /** 0 … 1 pop-in / pop-out scale. */
  appear = 1;
  /** 0 … 1 how much of a walk cycle to show, and the cycle phase. */
  walk = 0;
  phase = 0;
  sit = 0;
  /** 0 … 1 cheer envelope (hop + arms up). */
  cheer = 0;
  wave = 0;
  work = 0;
  talk = 0;
  /** Both arms forward holding the basket. */
  carry = 0;
  /** Holds a lantern in the right hand (night). */
  lantern = 0;
  headYaw = 0;
  headPitch = 0;
  kid = false;
  basket = false;
  /** Random phase offset for idle motion. */
  seed = 0;
  /** Hat height multiplier (1 = beanie, ~1.6 = chef's toque) and roll. */
  hatH = 1;
  hatRoll = 0;
  /** Goods colour (linear rgb) shown piled in the basket. */
  gr = 1;
  gg = 1;
  gb = 1;

  constructor(id: number) {
    this.id = id;
  }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

type Role = 0 | 1 | 2;

/** Batch per colour role: merged into one geometry with a per-vertex `role` attribute. */
class PartBuilder {
  private readonly b: [Batch, Batch, Batch] = [new Batch(), new Batch(), new Batch()];

  add(role: Role, g: THREE.BufferGeometry, color: THREE.ColorRepresentation, x: number, y: number, z: number, o?: PartOpts): this {
    this.b[role].add(g, color, x, y, z, o);
    return this;
  }

  /** Every mesh under `group` (built the usual way with toon colours), at its transform, as fixed-colour parts. */
  addGroup(role: Role, group: THREE.Object3D): this {
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) this.b[role].addMatrix(m.geometry, (m.material as THREE.MeshToonMaterial).color, m.matrixWorld);
    });
    return this;
  }

  build(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    this.b.forEach((batch, role) => {
      if (batch.empty) return;
      const g = batch.geometry();
      const n = g.getAttribute('position').count;
      g.setAttribute('role', new THREE.BufferAttribute(new Float32Array(n).fill(role), 1));
      parts.push(g);
    });
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return merged;
  }
}

const SKIN = SKIN_TONES[0]!;
const BOOT = MAT.boot;
const BASE_Y = 0.12;
const BODY_R = NPC_BODY_R;
const BODY_H = NPC_BODY_H;
const TOP_Y = BASE_Y + BODY_H;
const HEAD_R = NPC_HEAD_R;
/** Local (hip-pivot) heights. */
const SCARF_Y = TOP_Y - 0.06 - HIP;
const HEAD_Y = TOP_Y + HEAD_R * 0.62 - HIP;
const SHOULDER_Y = TOP_Y - 0.15 - HIP;
const SHOULDER_X = BODY_R * 0.9 + 0.045;
const ARM_REACH = 0.33;

// Low-poly primitives (Batch copies them): ≈ 1100 triangles per person per pass.
const SPH = (r: number, w: number, h: number): THREE.BufferGeometry => new THREE.SphereGeometry(r, w, h);

/** The bean torso of assets/characters.ts at crowd detail (origin at the hem centre). */
function beanLathe(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    pts.push(new THREE.Vector2(i === 0 || i === 12 ? 0 : BODY_R * beanRadius(f), BODY_H * f));
  }
  pts.splice(1, 0, new THREE.Vector2(BODY_R * 0.8, 0));
  return new THREE.LatheGeometry(pts, 12);
}

function torsoGeometry(): THREE.BufferGeometry {
  const p = new PartBuilder();
  p.add(1, beanLathe(), 0xffffff, 0, BASE_Y - HIP, 0);
  // chunky scarf + a short tail down the front-right
  p.add(2, new THREE.TorusGeometry(BODY_R * 0.78, 0.07, 5, 12), 0xffffff, 0, SCARF_Y, 0, { rx: Math.PI / 2 });
  p.add(2, geo.box(0.11, 0.24, 0.05), 0xffffff, 0.1, SCARF_Y - 0.13, BODY_R * 0.8, { rx: 0.22, rz: -0.1 });
  return p.build();
}

function headGeometry(): THREE.BufferGeometry {
  const p = new PartBuilder();
  p.add(0, SPH(HEAD_R, 14, 10), SKIN, 0, 0, 0, { sx: 1.04, sy: 0.97 });
  // the face of every toy (eyes with a light catch, rosy cheeks, a smile)
  const face = new THREE.Group();
  addFace(face, HEAD_R, { expr: 'smile' });
  p.addGroup(0, face);
  return p.build();
}

function hatGeometry(): THREE.BufferGeometry {
  const p = new PartBuilder();
  const R = HEAD_R;
  // beanie dome + ribbed cuff + pompom, in head space (hat height scales it from the head centre)
  p.add(2, new THREE.SphereGeometry(R * 1.05, 12, 6, 0, Math.PI * 2, 0, 1.72), 0xffffff, 0, R * 0.32, 0, { sy: 0.88 });
  p.add(1, new THREE.TorusGeometry(R * 0.98, R * 0.17, 5, 14), 0xffffff, 0, R * 0.36, 0, { rx: Math.PI / 2 });
  p.add(0, new THREE.IcosahedronGeometry(R * 0.3, 1), CREAM, 0, R * 1.3, 0);
  // hair over the ears
  for (const sx of [-1, 1]) p.add(0, SPH(R * 0.3, 6, 4), MAT.hairBrown, sx * R * 0.9, R * 0.02, -R * 0.12, { sx: 0.5, sz: 0.95 });
  return p.build();
}

function armGeometry(): THREE.BufferGeometry {
  const p = new PartBuilder();
  p.add(1, new THREE.CapsuleGeometry(0.085, 0.15, 2, 6), 0xffffff, 0, -0.15 / 2 - 0.085 * 0.8, 0);
  p.add(2, SPH(0.098, 7, 5), 0xffffff, 0, -ARM_REACH, 0, { sy: 1.06, sz: 0.92 });
  p.add(2, SPH(0.042, 5, 4), 0xffffff, 0, -ARM_REACH + 0.035, 0.075);
  return p.build();
}

function bootGeometry(): THREE.BufferGeometry {
  const p = new PartBuilder();
  p.add(0, SPH(0.125, 8, 6), BOOT, 0, -0.155, 0.04, { sx: 0.95, sy: 0.74, sz: 1.3 });
  return p.build();
}

function basketGeometry(): THREE.BufferGeometry {
  const p = new PartBuilder();
  p.add(0, new THREE.CylinderGeometry(0.19, 0.15, 0.15, 8), 0xc08a4a, 0, 0, 0);
  // goods piled on top (tinted per buyer)
  for (const [x, z, s] of [[-0.07, 0.02, 1], [0.07, -0.03, 0.9], [0.0, 0.07, 0.85]] as const) {
    p.add(2, SPH(0.08, 5, 3), 0xffffff, x, 0.115, z, { sx: s, sy: 0.85 * s, sz: s });
  }
  return p.build();
}

/** Lantern hanging from the hand: dark cap + warm glowing glass (emissive material; origin = the handle). */
function lanternGeometry(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(geo.box(0.12, 0.03, 0.12), 0x4a3426, 0, -0.06, 0);
  b.add(geo.box(0.11, 0.13, 0.11), 0xffd88a, 0, -0.14, 0);
  b.add(geo.box(0.12, 0.025, 0.12), 0x4a3426, 0, -0.22, 0);
  b.add(geo.torus(0.04, 0.008, 4, 8), 0x4a3426, 0, -0.03, 0);
  return b.geometry();
}

/** Camera-facing glow quad (baked toward the fixed iso camera), centred on the origin. */
function haloGeometry(size: number): THREE.BufferGeometry {
  const yaw = THREE.MathUtils.degToRad(CAMERA.yawDeg);
  const pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const up = new THREE.Vector3(-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch));
  const pos: number[] = [];
  const uv: number[] = [];
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    pos.push((right.x * a + up.x * b) * size, (right.y * a + up.y * b) * size, (right.z * a + up.z * b) * size);
    uv.push((a + 1) / 2, (b + 1) / 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Soft radial glow without a canvas (works headless). */
function haloTexture(): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5) * 2;
      const a = Math.max(0, 1 - d);
      const v = Math.round(255 * a * a);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = v;
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Toon material that multiplies vertex colour by the instance's coat / trim colour according to the vertex role. */
function crowdMaterial(): THREE.MeshToonMaterial {
  const m = toonUnique(0xffffff);
  m.vertexColors = true;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float role;\nattribute vec3 iCoat;\nattribute vec3 iTrim;')
      .replace(
        '#include <color_vertex>',
        '#include <color_vertex>\n#ifdef USE_COLOR\nvColor.rgb *= role < 0.5 ? vec3(1.0) : (role < 1.5 ? iCoat : iTrim);\n#endif',
      );
  };
  m.customProgramCacheKey = () => 'winterland-crowd-v1';
  return m;
}

// ---------------------------------------------------------------------------
// Crowd
// ---------------------------------------------------------------------------

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _root = new THREE.Matrix4();
const _body = new THREE.Matrix4();
const _head = new THREE.Matrix4();
const _loc = new THREE.Matrix4();
const _out = new THREE.Matrix4();

function compose(m: THREE.Matrix4, px: number, py: number, pz: number, rx: number, ry: number, rz: number, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'XYZ');
  _q.setFromEuler(_e);
  return m.compose(_p.set(px, py, pz), _q, _s.set(sx, sy, sz));
}

const TO_CAM = new THREE.Vector3(
  Math.sin(THREE.MathUtils.degToRad(CAMERA.yawDeg)) * Math.cos(THREE.MathUtils.degToRad(CAMERA.pitchDeg)),
  Math.sin(THREE.MathUtils.degToRad(CAMERA.pitchDeg)),
  Math.cos(THREE.MathUtils.degToRad(CAMERA.yawDeg)) * Math.cos(THREE.MathUtils.degToRad(CAMERA.pitchDeg)),
).multiplyScalar(0.9);

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export class Crowd {
  /** All meshes hang under this group (add it to the scene). */
  readonly group = new THREE.Group();
  readonly capacity: number;
  readonly people: CrowdPerson[] = [];

  private readonly free: number[] = [];
  private live = 0;
  private high = 0; // highest active id + 1
  private shadows: boolean | null = null;
  private lanterns = 0;
  private baskets = 0;

  private readonly torso: THREE.InstancedMesh;
  private readonly head: THREE.InstancedMesh;
  private readonly hat: THREE.InstancedMesh;
  private readonly arms: THREE.InstancedMesh;
  private readonly boots: THREE.InstancedMesh;
  private readonly basket: THREE.InstancedMesh;
  private readonly lantern: THREE.InstancedMesh;
  private readonly halo: THREE.InstancedMesh;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private readonly shadowMeshes: THREE.InstancedMesh[];
  private readonly allMeshes: THREE.InstancedMesh[];
  /** Instance colours: per person (torso / head / hat / basket) and per limb (arms / boots). */
  private readonly coat1: THREE.InstancedBufferAttribute;
  private readonly trim1: THREE.InstancedBufferAttribute;
  private readonly coat2: THREE.InstancedBufferAttribute;
  private readonly trim2: THREE.InstancedBufferAttribute;
  private readonly goods: THREE.InstancedBufferAttribute;

  constructor(capacity: number = TOWN.crowdMax) {
    this.capacity = capacity;
    const n = capacity;
    const mat = crowdMaterial();
    this.coat1 = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.trim1 = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.coat2 = new THREE.InstancedBufferAttribute(new Float32Array(n * 6), 3);
    this.trim2 = new THREE.InstancedBufferAttribute(new Float32Array(n * 6), 3);
    this.goods = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    for (const a of [this.coat1, this.trim1, this.coat2, this.trim2, this.goods]) a.setUsage(THREE.DynamicDrawUsage);

    const make = (g: THREE.BufferGeometry, count: number, coat: THREE.InstancedBufferAttribute, trim: THREE.InstancedBufferAttribute): THREE.InstancedMesh => {
      g.setAttribute('iCoat', coat);
      g.setAttribute('iTrim', trim);
      return this.prep(new THREE.InstancedMesh(g, mat, count));
    };
    this.torso = make(torsoGeometry(), n, this.coat1, this.trim1);
    this.head = make(headGeometry(), n, this.coat1, this.trim1);
    this.hat = make(hatGeometry(), n, this.coat1, this.trim1);
    this.arms = make(armGeometry(), n * 2, this.coat2, this.trim2);
    this.boots = make(bootGeometry(), n * 2, this.coat2, this.trim2);
    // the basket's trim colour is the goods colour
    this.basket = make(basketGeometry(), n, this.coat1, this.goods); // goods colours are per compacted basket slot

    const lanternMat = toonUnique(0xffffff, { emissive: 0xffa640, emissiveIntensity: 1.5 });
    lanternMat.vertexColors = true;
    registerGlow(lanternMat, 2.0);
    this.lantern = this.prep(new THREE.InstancedMesh(lanternGeometry(), lanternMat, n));
    this.haloMat = additiveKeepAlpha(
      new THREE.MeshBasicMaterial({
        map: haloTexture(),
        color: new THREE.Color(1.0, 0.62, 0.24),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    );
    this.halo = this.prep(new THREE.InstancedMesh(haloGeometry(1.1), this.haloMat, n));
    this.halo.renderOrder = 6;

    this.shadowMeshes = [this.torso, this.head, this.hat, this.arms, this.boots, this.basket];
    this.allMeshes = [...this.shadowMeshes, this.lantern, this.halo];
    for (const m of this.allMeshes) {
      m.name = 'crowd';
      m.visible = false;
      m.receiveShadow = true;
      m.castShadow = false;
      this.group.add(m);
    }
    this.lantern.receiveShadow = false;
    this.halo.receiveShadow = false;

    // One sensible bounding sphere for everything: village street + market town.
    const v = LAYOUT.village.area;
    const t = LAYOUT.town.area;
    const minX = Math.min(v.minX, t.minX) - 4;
    const maxX = Math.max(v.maxX, t.maxX) + 4;
    const minZ = Math.min(v.minZ, t.minZ) - 4;
    const maxZ = Math.max(v.maxZ, t.maxZ) + 4;
    const sphere = new THREE.Sphere(new THREE.Vector3((minX + maxX) / 2, 1, (minZ + maxZ) / 2), Math.hypot(maxX - minX, maxZ - minZ) / 2);
    for (const m of this.allMeshes) m.boundingSphere = sphere.clone();

    for (let i = 0; i < n; i++) {
      this.people.push(new CrowdPerson(i));
      this.zero(i);
    }
    for (let i = n - 1; i >= 0; i--) this.free.push(i);
  }

  private prep(m: THREE.InstancedMesh): THREE.InstancedMesh {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = true;
    return m;
  }

  /** Live people. */
  get count(): number {
    return this.live;
  }

  /** Baskets drawn last frame. */
  get basketCount(): number {
    return this.baskets;
  }

  /** Lanterns drawn last frame. */
  get lanternCount(): number {
    return this.lanterns;
  }

  /** The meshes (tests / debugging). */
  get meshes(): readonly THREE.InstancedMesh[] {
    return this.allMeshes;
  }

  /** Draw calls this crowd costs right now (shadow pass excluded). */
  get drawCalls(): number {
    let n = 0;
    for (const m of this.allMeshes) if (m.visible) n++;
    return n;
  }

  /** Take a free slot (null when the crowd is full). The person is reset to a neutral standing pose. */
  acquire(coat: number, trim: number, goodsColor = GOODS_COLORS.default!): CrowdPerson | null {
    const id = this.free.pop();
    if (id === undefined) return null;
    const p = this.people[id]!;
    p.active = true;
    p.x = p.z = p.y = p.yaw = 0;
    p.scale = 1;
    p.appear = 0;
    p.walk = p.phase = p.sit = p.cheer = p.wave = p.work = p.talk = p.carry = p.lantern = 0;
    p.headYaw = p.headPitch = 0;
    p.kid = false;
    p.basket = false;
    p.seed = Math.random() * 6.28;
    p.hatH = 1;
    p.hatRoll = 0;
    this.setColors(id, coat, trim, goodsColor);
    this.live++;
    if (id + 1 > this.high) this.high = id + 1;
    return p;
  }

  release(p: CrowdPerson): void {
    if (!p.active) return;
    p.active = false;
    this.zero(p.id);
    this.free.push(p.id);
    this.live--;
    while (this.high > 0 && !this.people[this.high - 1]!.active) this.high--;
  }

  /** Re-colour a live person. */
  setColors(id: number, coat: number, trim: number, goodsColor: number): void {
    _c.set(coat);
    this.coat1.setXYZ(id, _c.r, _c.g, _c.b);
    this.coat2.setXYZ(id * 2, _c.r, _c.g, _c.b);
    this.coat2.setXYZ(id * 2 + 1, _c.r, _c.g, _c.b);
    _c.set(trim);
    this.trim1.setXYZ(id, _c.r, _c.g, _c.b);
    this.trim2.setXYZ(id * 2, _c.r, _c.g, _c.b);
    this.trim2.setXYZ(id * 2 + 1, _c.r, _c.g, _c.b);
    _c.set(goodsColor);
    const p = this.people[id]!;
    p.gr = _c.r;
    p.gg = _c.g;
    p.gb = _c.b;
    for (const a of [this.coat1, this.trim1, this.coat2, this.trim2]) a.needsUpdate = true;
  }

  private zero(id: number): void {
    for (const m of [this.torso, this.head, this.hat, this.lantern, this.halo]) m.instanceMatrix.array.fill(0, id * 16, id * 16 + 16);
    for (const m of [this.arms, this.boots]) m.instanceMatrix.array.fill(0, id * 32, id * 32 + 32);
  }

  /**
   * Compose every active person's part matrices. `t` = simulation seconds, `darkness` 0..1, `shadows` = High quality.
   */
  update(t: number, darkness: number, shadows: boolean): void {
    if (this.shadows !== shadows) {
      this.shadows = shadows;
      for (const m of this.shadowMeshes) m.castShadow = shadows;
    }
    const on = this.live > 0;
    for (const m of this.shadowMeshes) m.visible = on;
    if (!on) {
      this.basket.visible = false;
      this.lantern.visible = false;
      this.halo.visible = false;
      this.lanterns = 0;
      return;
    }
    const tA = this.torso.instanceMatrix.array;
    const hA = this.head.instanceMatrix.array;
    const htA = this.hat.instanceMatrix.array;
    const aA = this.arms.instanceMatrix.array;
    const bA = this.boots.instanceMatrix.array;
    const kA = this.basket.instanceMatrix.array;
    const lA = this.lantern.instanceMatrix.array;
    const gA = this.halo.instanceMatrix.array;
    let nl = 0;
    let nb = 0;
    const n = this.high;

    for (let i = 0; i < n; i++) {
      const p = this.people[i]!;
      if (!p.active) continue;
      const sc = p.scale * (p.kid ? KID_SCALE : 1) * p.appear;
      if (sc < 0.001) {
        this.zeroActive(i);
        continue;
      }
      const sit = p.sit;
      const walk = p.walk;
      const ph = p.phase;
      const s = Math.sin(ph);
      const hop = p.cheer > 0 ? Math.abs(Math.sin(t * 11 + p.seed)) * 0.2 * p.cheer : 0;

      compose(_root, p.x, p.y + sit * SIT_LIFT + hop * sc, p.z, 0, p.yaw, 0, sc);
      const bounce = Math.abs(s) * 0.05 * walk;
      const breathe = Math.sin(t * 2.2 + p.seed) * 0.012 * (1 - walk);
      const lean = 0.07 * walk + 0.1 * p.carry * (1 - sit) - 0.12 * sit;
      const roll = s * 0.07 * walk;
      compose(_loc, 0, HIP + bounce + breathe, 0, lean, 0, roll);
      _body.multiplyMatrices(_root, _loc);
      _body.toArray(tA, i * 16);

      // head (+ hat on the same pivot)
      let nod = p.headPitch;
      if (p.talk > 0) nod += Math.sin(t * 7 + p.seed) * 0.09 * p.talk;
      nod += Math.abs(s) * 0.04 * walk;
      const hs = p.kid ? 1.22 : 1;
      compose(_loc, 0, HEAD_Y + breathe * 0.5, 0, nod, p.headYaw, 0, hs);
      _head.multiplyMatrices(_body, _loc);
      _head.toArray(hA, i * 16);
      compose(_loc, 0, 0, 0, 0, 0, p.hatRoll, 1, p.hatH, 1);
      _out.multiplyMatrices(_head, _loc);
      _out.toArray(htA, i * 16);

      // arms
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? -1 : 1;
        let rx = -side * s * 0.75 * walk;
        let rz = side * (0.1 + 0.03 * Math.sin(t * 1.7 + p.seed + k));
        if (p.carry > 0) {
          rx = mix(rx, -1.3, p.carry);
          rz = mix(rz, -side * 0.5, p.carry);
        }
        if (sit > 0) {
          rx = mix(rx, -0.35, sit);
          rz = mix(rz, side * 0.25, sit);
        }
        if (side === 1) {
          if (p.lantern > 0) {
            rx = mix(rx, -0.85, p.lantern);
            rz = mix(rz, 0.1, p.lantern);
          }
          if (p.talk > 0) rx = mix(rx, -0.6 - 0.45 * Math.max(0, Math.sin(t * 3.1 + p.seed)), p.talk * 0.7);
          if (p.work > 0) rx = mix(rx, -0.95 + 0.55 * Math.sin(t * 4.2 + p.seed), p.work);
          if (p.wave > 0) {
            rx = mix(rx, 0, p.wave);
            rz = mix(rz, 2.35 + Math.sin(t * 10 + p.seed) * 0.38, p.wave);
          }
        } else if (p.work > 0) {
          rx = mix(rx, -0.55, p.work);
        }
        if (p.cheer > 0) {
          rx = mix(rx, 0, p.cheer);
          rz = mix(rz, side * (2.7 + Math.sin(t * 22 + p.seed + k) * 0.22), p.cheer);
        }
        compose(_loc, side * SHOULDER_X, SHOULDER_Y, 0, rx, 0, rz);
        _out.multiplyMatrices(_body, _loc);
        _out.toArray(aA, (i * 2 + k) * 16);

        if (side === 1 && p.lantern > 0.5) {
          // the lantern hangs from the hand and stays upright
          const hy = SHOULDER_Y - 0.38 * Math.cos(rx) * Math.cos(rz);
          const hz = -0.38 * Math.sin(rx) * Math.cos(rz);
          const hx = SHOULDER_X + 0.38 * Math.sin(rz);
          compose(_loc, hx, hy, hz, Math.sin(t * 2.4 + p.seed) * 0.08, 0, Math.sin(t * 1.9 + p.seed) * 0.05, 1.35);
          _out.multiplyMatrices(_body, _loc);
          _out.toArray(lA, nl * 16);
          // halo at the glass
          // pulled toward the (fixed) camera so the ground does not slice the glow
          _p.set(0, -0.15, 0).applyMatrix4(_out);
          compose(_loc, _p.x + TO_CAM.x, _p.y + TO_CAM.y, _p.z + TO_CAM.z, 0, 0, 0, sc * 1.5);
          _loc.toArray(gA, nl * 16);
          nl++;
        }
      }

      // boots (swing about the hips; sitting = stubby legs forward over the seat edge)
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? -1 : 1;
        const swing = side * s * 0.75 * walk;
        const rx = mix(swing, -1.0 - 0.05 * side, sit);
        compose(_loc, side * BODY_R * 0.5, HIP, 0, rx, 0, 0);
        _out.multiplyMatrices(_root, _loc);
        _out.toArray(bA, (i * 2 + k) * 16);
      }

      // basket (carried in front, follows the body lean); only buyers with goods are drawn (compacted slots)
      if (p.basket) {
        compose(_loc, 0, 0.2, 0.5, 0.1, 0, 0);
        _out.multiplyMatrices(_body, _loc);
        _out.toArray(kA, nb * 16);
        this.goods.setXYZ(nb, p.gr, p.gg, p.gb);
        nb++;
      }
    }

    this.lanterns = nl;
    this.lantern.count = nl;
    this.halo.count = nl;
    this.lantern.visible = nl > 0;
    this.halo.visible = nl > 0 && darkness > 0.04;
    this.haloMat.opacity = Math.min(0.55, darkness * 0.7);

    this.baskets = nb;
    this.basket.count = nb;
    this.basket.visible = nb > 0;
    if (nb > 0) this.goods.needsUpdate = true;
    this.torso.count = this.head.count = this.hat.count = n;
    this.arms.count = this.boots.count = n * 2;
    this.torso.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
    this.hat.instanceMatrix.needsUpdate = true;
    this.arms.instanceMatrix.needsUpdate = true;
    this.boots.instanceMatrix.needsUpdate = true;
    if (nb > 0) this.basket.instanceMatrix.needsUpdate = true;
    if (nl > 0) {
      this.lantern.instanceMatrix.needsUpdate = true;
      this.halo.instanceMatrix.needsUpdate = true;
    }
  }

  private zeroActive(i: number): void {
    this.torso.instanceMatrix.array.fill(0, i * 16, i * 16 + 16);
    this.head.instanceMatrix.array.fill(0, i * 16, i * 16 + 16);
    this.hat.instanceMatrix.array.fill(0, i * 16, i * 16 + 16);
    this.arms.instanceMatrix.array.fill(0, i * 32, i * 32 + 32);
    this.boots.instanceMatrix.array.fill(0, i * 32, i * 32 + 32);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.allMeshes) m.geometry.dispose();
    this.haloMat.dispose();
  }
}
