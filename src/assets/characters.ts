/**
 * AssetFactory — character models (0.9.8 brief 12: "one shared toy body"). Every person in Winterland is the same
 * little painted wooden toy: a rounded bean of a body, a big round head with a face (dark glossy eyes with a light
 * catch, rosy cheeks, a mouth that shows the mood), stubby mitten arms and round boots. Hats, coats, scarves, tools
 * and colours tell who is who. Every factory returns a CharacterModel handle that render/characters.ts (CharacterRig)
 * animates. Geometry (geo.*) and materials (toon()) are cached, so crowds share all GPU resources; only the Object3D
 * hierarchy is per instance.
 *
 * The cast:
 * - PLAYER: the lumberjack in a pine-green toggle coat with a leather belt, a red knit hat with a cream pompom, ginger
 *   fringe and a long cream scarf with red stripes whose tail flies behind when running (DIRECTION D4; nothing like the
 *   ad's blue pawn). carryPivot at (0, 0.5, 0.45): carried items stack upward from it.
 * - CUSTOMER: cosy coats in the CLOTH colours (never blue, R35) with an era hat: knit and hoods early on, bowlers and
 *   bonnets in the Steam Age, flat caps and cloches, fedoras, earmuffs and halo bands later (`createCustomerModel(variant,
 *   era)`). VIP customers keep their rich coat, gold scarf and gold-banded top hat.
 * - COURIER (cargo tricycle): mustard helmet with goggles and a pumpkin jacket. DRIVER: wool flat cap and a muffler.
 * - WORKER (the era-1 crew): the Survival outfit of assets/eraWorkers.ts with the crew role's hat colour and tool.
 * - AXE: handle + wedge head per Sharp Axe level.
 *
 * Conventions: root origin at the feet, character faces local +Z. `body` is an upper-body pivot at hip height
 * (CHARACTER_HIP_Y) that CharacterRig bobs / leans; `squash` (child of body) is the only thing that gets scaled, so the
 * anchors (carryPivot / backPivot, children of body) never deform carried items.
 * Draw calls: each animated pivot (torso, head, each arm, each boot) holds ONE baked vertex-coloured mesh (render/batch.ts
 * bake + shareBaked), so a character is 6 meshes, drawn instanced across the scene with every pawn of the same look
 * (render/instancer.ts). A role tool is one more small shared mesh in the right hand; the player's scarf tail is one more.
 * handR sits at the end of armR; its local -Y axis points along the arm, away from the shoulder.
 *
 * Colours: the fixed colours (snow, cream, ink, gold, pine) and era colours come from render/palette.ts; the few fabric,
 * skin and material tones that are not era colours live in CLOTH / SKIN_TONES / MAT below (one place).
 */
import * as THREE from 'three';
import { bake, shareBaked } from '../render/batch';
import { geo, mesh, toon } from '../render/materials';
import { CREAM, GOLD, INK, PINE, SNOW, mixHex, palette } from '../render/palette';

/** 'worker': hired era-1 crew (see createWorkerModel). */
export type CharacterKind = 'player' | 'customer' | 'courier' | 'driver' | 'worker';

/** Height of the body pivot (hips) above the feet, shared by every character. */
export const CHARACTER_HIP_Y = 0.25;
const HIP = CHARACTER_HIP_Y;

/**
 * What a character does with its hands while it works at a station, and as its idle fidget (CharacterRig plays it):
 * shovel = scoop and tip, flag = wave a signal flag, heave = hitch the pack up, gather = pick up and drop in the basket,
 * hammer = tap with the mallet, ledger = write in the book, dust = clap the dust off the mittens.
 */
export type WorkMotion = 'none' | 'shovel' | 'flag' | 'heave' | 'gather' | 'hammer' | 'ledger' | 'dust';

/** Parts of a character model that CharacterRig animates. */
export interface CharacterModel {
  root: THREE.Group;
  /** Upper-body pivot at hip height (bob / lean / twist). Child of root. */
  body: THREE.Group;
  /** Scaled for squash & stretch; holds torso, head and arms (but not the anchors). Child of body. */
  squash: THREE.Group;
  head: THREE.Group;
  /** Separate headwear pivot for a wobble; null now that headwear is baked into the head mesh. */
  hat: THREE.Object3D | null;
  armL: THREE.Group;
  armR: THREE.Group;
  /** Tool attach point (the player's axe), at the end of armR. */
  handR: THREE.Object3D;
  /** Carried-stack anchor (player: (0, 0.5, 0.45) relative to the feet). */
  carryPivot: THREE.Object3D;
  /** Cash-stack anchor on the back. */
  backPivot: THREE.Object3D;
  legL: THREE.Group;
  legR: THREE.Group;
  /** Top of the head/hat above the feet at scale 1. */
  height: number;
  /** The role tool in the right hand (hidden while carrying), if any. */
  tool?: THREE.Object3D | null;
  /** A scarf tail pivot at the back of the neck that flies out behind when running (the player), if any. */
  tail?: THREE.Object3D | null;
  /** The work / fidget motion (role). */
  motion?: WorkMotion;
}

// ---------------------------------------------------------------------------
// Colours that are not era colours (one place)
// ---------------------------------------------------------------------------

/** Skin tones (crowd variety). */
export const SKIN_TONES: readonly number[] = [0xf6d0b1, 0xe8b48c, 0xc48a62, 0x93613f];
/** Cosy fabric colours for coats, scarves and hats: warm and clear, never the ad's blue (R35). */
export const CLOTH = {
  brick: 0xd2553f,
  teal: 0x2f9e8f,
  mustard: 0xe9a93b,
  plum: 0x8a5aa8,
  pine: 0x3f9d5c,
  rose: 0xe57a9a,
  cream: 0xf1e6d2,
  pumpkin: 0xe8793a,
  cocoa: 0x8a5a36,
  heather: 0xa58fc0,
  berry: 0xb8405e,
  mint: 0x9be0c8,
  oat: 0xd9c4a0,
  blush: 0xf6b6cc,
} as const;
/** Materials: wood, leather, steel, the eyes' warm ink and the cheeks' blush. */
export const MAT = {
  wood: mixHex(palette(1).body, CREAM, 0.12),
  woodLight: mixHex(palette(1).body, CREAM, 0.42),
  leather: mixHex(palette(1).trim, palette(1).body, 0.3),
  boot: mixHex(palette(1).trim, INK, 0.25),
  steel: mixHex(palette(5).body, SNOW, 0.45),
  brass: mixHex(GOLD, palette(1).body, 0.25),
  eye: mixHex(INK, 0x1d1730, 0.5),
  cheek: 0xf09a8c,
  mouth: mixHex(INK, 0x8a3b3b, 0.35),
  hairGinger: 0xb8602f,
  hairBrown: 0x6b4430,
  hairDark: 0x3f2e2a,
  hairGrey: 0xc9c3bd,
} as const;
const HAIRS = [MAT.hairBrown, MAT.hairGinger, MAT.hairDark, MAT.hairGrey] as const;

// ---------------------------------------------------------------------------
// The toy body
// ---------------------------------------------------------------------------

/** Bottom of the torso above the feet. */
export const BASE_Y = 0.12;
const ARM_R = 0.085;
const ARM_LEN = 0.15;
/** Distance from the shoulder pivot to the hand centre. */
export const CHARACTER_ARM_REACH = 0.33;

/** The bean profile of every torso: (radius, height) fractions from the hem to the neck. */
const BEAN: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.8, 0],
  [0.94, 0.04],
  [1, 0.15],
  [1.01, 0.4],
  [0.97, 0.6],
  [0.88, 0.77],
  [0.72, 0.9],
  [0.46, 0.98],
  [0, 1],
];

/** Radius fraction of the bean at height fraction `f` (0 = hem, 1 = neck): place things on the coat's surface. */
export function beanRadius(f: number): number {
  for (let i = 1; i < BEAN.length; i++) {
    const [r1, y1] = BEAN[i]!;
    const [r0, y0] = BEAN[i - 1]!;
    if (f <= y1) return y1 === y0 ? r1 : r0 + ((r1 - r0) * (f - y0)) / (y1 - y0);
  }
  return 0;
}

const shapeCache = new Map<string, THREE.BufferGeometry>();
function shape<T extends THREE.BufferGeometry>(k: string, make: () => T): T {
  let g = shapeCache.get(k) as T | undefined;
  if (!g) {
    g = make();
    shapeCache.set(k, g);
  }
  return g;
}

/** The bean torso (origin at the hem centre). */
function beanGeometry(r: number, h: number): THREE.BufferGeometry {
  return shape(`bean|${r}|${h}`, () => {
    const pts: THREE.Vector2[] = [];
    // smooth the profile with a Catmull-Rom curve through the bean points
    const curve = new THREE.SplineCurve(BEAN.map(([a, b]) => new THREE.Vector2(a * r, b * h)));
    for (const p of curve.getPoints(16)) pts.push(new THREE.Vector2(Math.max(0, p.x), p.y));
    pts[0]!.set(0, 0);
    pts[pts.length - 1]!.set(0, h);
    return new THREE.LatheGeometry(pts, 18);
  });
}

/** A partial sphere (a hat dome): theta from the top down to `theta` radians. */
function domeGeometry(r: number, theta: number): THREE.BufferGeometry {
  return shape(`dome|${r}|${theta}`, () => new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, theta));
}

/** A half ring (the smile, closed eyes, a basket handle): the upper half of a torus in the XY plane. */
export function arcGeometry(r: number, tube: number): THREE.BufferGeometry {
  return shape(`arc|${r}|${tube}`, () => new THREE.TorusGeometry(r, tube, 5, 12, Math.PI));
}

const _v = new THREE.Vector3();

/** A part on a head of radius `R` at (x, y) on the front of the sphere (inset into it), facing out along the normal. */
function onHead(m: THREE.Mesh, R: number, x: number, y: number, inset = 0): THREE.Mesh {
  const z = Math.sqrt(Math.max(0, R * R - x * x - y * y)) - inset;
  m.position.set(x, y, z);
  _v.set(x, y, z).multiplyScalar(2);
  m.lookAt(_v);
  return m;
}

export type Expression = 'smile' | 'grin' | 'content' | 'o' | 'brave' | 'calm';

export interface FaceSpec {
  expr?: Expression;
  /** Eyebrow colour (null = none; 'brave' always draws them). */
  brows?: number | null;
  cheeks?: boolean;
}

/**
 * The face on a head of radius R (head-local space, +Z forward): two glossy ink eyes with a light catch (or closed
 * happy arcs), rosy cheeks, a small mouth for the mood, and brows when asked.
 */
export function addFace(g: THREE.Group, R: number, face: FaceSpec = {}): void {
  const expr = face.expr ?? 'smile';
  const ex = R * 0.34;
  const ey = -R * 0.02;
  const eyeMat = toon(MAT.eye);
  for (const sx of [-ex, ex]) {
    if (expr === 'content') {
      // closed, happy eyes: little upside-down U arcs
      const arc = onHead(mesh(arcGeometry(R * 0.11, R * 0.035), eyeMat), R, sx, ey, R * 0.02);
      g.add(arc);
    } else {
      const eye = onHead(mesh(geo.sphere(R * 0.17, 12, 9), eyeMat), R, sx, ey, R * 0.08);
      eye.scale.set(0.82, expr === 'calm' ? 0.85 : 1.15, 0.6);
      const glint = onHead(mesh(geo.sphere(R * 0.055, 6, 5), toon(SNOW)), R, sx + R * 0.055, ey + R * 0.08, R * 0.035);
      g.add(eye, glint);
    }
  }
  if (face.cheeks !== false) {
    for (const sx of [-1, 1]) {
      const cheek = onHead(mesh(geo.sphere(R * 0.17, 10, 6), toon(MAT.cheek)), R, sx * R * 0.6, -R * 0.26, R * 0.075);
      cheek.scale.set(1, 0.62, 0.35);
      g.add(cheek);
    }
  }
  const mouthMat = toon(MAT.mouth);
  if (expr === 'grin') {
    const m = onHead(mesh(geo.sphere(R * 0.13, 10, 6), mouthMat), R, 0, -R * 0.36, R * 0.07);
    m.scale.set(1.1, 0.62, 0.4);
    const tongue = onHead(mesh(geo.sphere(R * 0.07, 8, 5), toon(MAT.cheek)), R, 0, -R * 0.4, R * 0.02);
    tongue.scale.set(1, 0.55, 0.4);
    g.add(m, tongue);
  } else if (expr === 'o') {
    const m = onHead(mesh(geo.torus(R * 0.065, R * 0.03, 5, 10), mouthMat), R, 0, -R * 0.36, R * 0.01);
    g.add(m);
  } else {
    const r = expr === 'brave' ? R * 0.1 : R * 0.13;
    const m = onHead(mesh(arcGeometry(r, R * 0.035), mouthMat), R, 0, -R * 0.33, R * 0.015);
    m.rotateZ(Math.PI); // the lower half: a smile
    if (expr === 'brave') m.scale.set(1, 0.55, 1);
    g.add(m);
  }
  const browColor = face.brows ?? (expr === 'brave' ? MAT.hairBrown : null);
  if (browColor !== null) {
    for (const sx of [-1, 1]) {
      const b = onHead(mesh(geo.box(R * 0.3, R * 0.07, R * 0.06), toon(browColor)), R, sx * ex, ey + R * 0.27, R * 0.01);
      b.rotateZ(sx * (expr === 'brave' ? -0.28 : 0.12));
      g.add(b);
    }
  }
}

export interface PawnSpec {
  bodyColor: number;
  bodyR: number;
  bodyH: number;
  headR: number;
  skin: number;
  /** Sleeve colour (default: the body colour). */
  armColor?: number;
  /** A cuff ring at the wrist (default: none). */
  cuff?: number;
  /** Mitten / glove colour. */
  hand: number;
  boot: number;
  /** A fur / knit cuff on the boots (default: none). */
  bootCuff?: number;
  carryZ: number;
  face?: FaceSpec;
  /** Extra torso parts (collars, scarf, stripes), in body-local space (y up from the hips). */
  torsoExtras?: (g: THREE.Group, topY: number) => void;
  /** Extra head parts (hair, hat), in head-local space (+Z = the face). Draws the default face unless it returns false. */
  headExtras?: (g: THREE.Group) => void | boolean;
}

/** Skeleton + bean torso + head with a face + arms + round boots (each animated pivot is baked to one shared mesh). */
export function buildPawn(s: PawnSpec): CharacterModel & { headY: number; topY: number } {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = HIP;
  const squash = new THREE.Group();
  body.add(squash);

  const bodyMat = toon(s.bodyColor);
  const topY = BASE_Y + s.bodyH;

  // torso (+ collars / scarf / stripes): one mesh
  const torsoG = new THREE.Group();
  const torso = mesh(beanGeometry(s.bodyR, s.bodyH), bodyMat);
  torso.position.y = BASE_Y - HIP;
  torsoG.add(torso);
  s.torsoExtras?.(torsoG, topY);
  squash.add(shareBaked(bake(torsoG, { name: 'torso' })));

  // head (+ face, hair, hat): pivot group with one mesh
  const headY = topY + s.headR * 0.62;
  const head = new THREE.Group();
  head.position.y = headY - HIP;
  const headG = new THREE.Group();
  const skull = mesh(geo.sphere(s.headR, 20, 14), toon(s.skin));
  skull.scale.set(1.04, 0.97, 1);
  headG.add(skull);
  const faceOn = s.headExtras?.(headG);
  if (faceOn !== false) addFace(headG, s.headR, s.face);
  head.add(shareBaked(bake(headG, { name: 'head' })));
  squash.add(head);

  // arms: pivot at the shoulder, hanging down; each is one mesh (sleeve + cuff + mitten with a thumb)
  const armMat = s.armColor === undefined ? bodyMat : toon(s.armColor);
  const handMat = toon(s.hand);
  const sx = s.bodyR * 0.9 + 0.045;
  const shoulder = topY - 0.15 - HIP;
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * sx, shoulder, 0);
    const ag = new THREE.Group();
    const a = mesh(geo.capsule(ARM_R, ARM_LEN, 4, 10), armMat);
    a.position.y = -ARM_LEN / 2 - ARM_R * 0.8;
    const h = mesh(geo.sphere(0.098, 12, 9), handMat);
    h.scale.set(1, 1.06, 0.92);
    h.position.y = -CHARACTER_ARM_REACH;
    const thumb = mesh(geo.sphere(0.042, 8, 6), handMat);
    thumb.position.set(0, -CHARACTER_ARM_REACH + 0.035, 0.075);
    ag.add(a, h, thumb);
    if (s.cuff !== undefined) {
      const c = mesh(geo.torus(0.082, 0.032, 6, 14), toon(s.cuff));
      c.rotation.x = Math.PI / 2;
      c.position.y = -CHARACTER_ARM_REACH + 0.1;
      ag.add(c);
    }
    arm.add(shareBaked(bake(ag, { name: 'arm' })));
    squash.add(arm);
    arms.push(arm);
  }
  const armL = arms[0]!;
  const armR = arms[1]!;
  const handR = new THREE.Object3D();
  handR.position.y = -CHARACTER_ARM_REACH;
  armR.add(handR);

  // boots (no legs): pivot at the hip, swing like stubby legs
  const bootMat = toon(s.boot);
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * s.bodyR * 0.48, HIP, 0);
    const lg = new THREE.Group();
    const boot = mesh(geo.sphere(0.125, 12, 8), bootMat);
    boot.scale.set(0.95, 0.74, 1.3);
    boot.position.set(0, -0.155, 0.04);
    lg.add(boot);
    if (s.bootCuff !== undefined) {
      const c = mesh(geo.torus(0.085, 0.036, 6, 14), toon(s.bootCuff));
      c.rotation.x = Math.PI / 2;
      c.position.set(0, -0.075, 0.0);
      lg.add(c);
    }
    leg.add(shareBaked(bake(lg, { name: 'boot' })));
    root.add(leg);
    legs.push(leg);
  }

  const carryPivot = new THREE.Object3D();
  carryPivot.position.set(0, 0.5 - HIP, s.carryZ);
  const backPivot = new THREE.Object3D();
  backPivot.position.set(0, 0.5 - HIP, -(s.bodyR + 0.07));
  body.add(carryPivot, backPivot);
  root.add(body);

  return {
    root,
    body,
    squash,
    head,
    hat: null,
    armL,
    armR,
    handR,
    carryPivot,
    backPivot,
    legL: legs[0]!,
    legR: legs[1]!,
    height: headY + s.headR,
    headY,
    topY,
    tool: null,
    tail: null,
    motion: 'none',
  };
}

export function hash(n: number): number {
  let x = (Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
  return (x ^ (x >>> 12)) >>> 0;
}

/** Deterministic scale variation in [1 - 0.06, 1 + 0.06] for crowd variety. */
export function characterScale(variant: number): number {
  return 1 + (((hash(variant) % 13) - 6) / 6) * 0.06;
}

export function torusRing(major: number, tube: number, color: number, y: number): THREE.Mesh {
  const t = mesh(geo.torus(major, tube, 8, 22), toon(color));
  t.rotation.x = Math.PI / 2;
  t.position.y = y;
  return t;
}

// ---------------------------------------------------------------------------
// Wardrobe: hats, hair, scarves (head-local / body-local helpers shared with assets/eraWorkers.ts)
// ---------------------------------------------------------------------------

/** Head radius of every NPC (the player's is a touch bigger). */
export const NPC_HEAD_R = 0.27;
export const NPC_BODY_R = 0.3;
export const NPC_BODY_H = 0.66;

const part = (g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.Mesh => {
  const m = mesh(g, toon(color));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
};

/** Hair peeking out under a hat: a soft tuft over each ear and a little fringe at the back of the neck. */
export function fringe(g: THREE.Group, R: number, color: number): void {
  for (const sx of [-1, 1]) {
    g.add(part(geo.sphere(R * 0.3, 8, 6), color, sx * R * 0.9, R * 0.02, -R * 0.12, 0.5, 1, 0.95));
  }
  g.add(part(geo.sphere(R * 0.7, 10, 6), color, 0, -R * 0.02, -R * 0.5, 1.15, 0.62, 0.6));
}

/** Knit beanie with a ribbed cuff and an optional pompom. Returns the top height above the head centre. */
export function beanie(g: THREE.Group, R: number, color: number, cuff: number, pom: number | null): number {
  g.add(part(domeGeometry(R * 1.05, 1.72), color, 0, R * 0.32, 0, 1, 0.88, 1));
  g.add(part(geo.torus(R * 0.98, R * 0.17, 8, 22), cuff, 0, R * 0.36, 0).rotateX(Math.PI / 2));
  // ribs on the cuff: little bumps around the band
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    g.add(part(geo.sphere(R * 0.07, 5, 4), cuff, Math.sin(a) * R * 1.14, R * 0.36, Math.cos(a) * R * 1.14, 0.6, 1.5, 0.6));
  }
  if (pom === null) return R * 1.25;
  g.add(part(geo.icosahedron(R * 0.3, 1), pom, 0, R * 1.3, 0));
  return R * 1.58;
}

/** Hard hat: a rounded shell, a lip all round with a deeper peak in front, and a ridge along the top. */
export function hardHat(g: THREE.Group, R: number, color: number, ridge = true): number {
  const shade = mixHex(color, INK, 0.12);
  g.add(part(domeGeometry(R * 1.1, 1.62), color, 0, R * 0.2, 0, 1, 0.92, 1.02));
  g.add(part(geo.cylinder(R * 1.12, R * 1.16, R * 0.08, 20), shade, 0, R * 0.22, 0.0));
  g.add(part(geo.cylinder(R * 0.6, R * 0.6, R * 0.07, 16), shade, 0, R * 0.25, R * 0.82, 1.3, 1, 0.75));
  if (ridge) g.add(part(geo.box(R * 0.24, R * 0.16, R * 1.5), color, 0, R * 1.2, -R * 0.05));
  return R * 1.32;
}

/** Flat cap: a squashed crown leaning forward and a short peak. */
export function flatCap(g: THREE.Group, R: number, color: number, button?: number): number {
  g.add(part(domeGeometry(R * 1.12, 1.9), color, 0, R * 0.42, R * 0.05, 1.04, 0.56, 1.1));
  g.add(part(geo.cylinder(R * 0.55, R * 0.55, R * 0.07, 16), mixHex(color, INK, 0.15), 0, R * 0.36, R * 0.92, 1.25, 1, 0.8));
  g.add(part(geo.sphere(R * 0.11, 6, 5), button ?? color, 0, R * 1.05, R * 0.05));
  return R * 1.12;
}

/** A soft hood (round, framing the face) with an optional fur trim ring. */
export function hood(g: THREE.Group, R: number, color: number, trim: number | null): number {
  g.add(part(geo.sphere(R * 1.14, 18, 12), color, 0, R * 0.1, -R * 0.34, 1, 1.02, 1));
  if (trim !== null) g.add(part(geo.torus(R * 0.86, R * 0.2, 8, 22), trim, 0, R * 0.04, R * 0.62));
  return R * 1.26;
}

/** A neck scarf ring with a knitted tail down the chest (body-local, around the neck of a bean torso). */
export function neckScarf(g: THREE.Group, topY: number, bodyR: number, color: number, stripe?: number, tailX = 0.1): void {
  const y = topY - 0.06 - HIP;
  g.add(torusRing(bodyR * 0.78, 0.07, color, y));
  const tail = new THREE.Group();
  tail.position.set(tailX, y - 0.02, bodyR * 0.78);
  tail.rotation.set(0.22, 0, -0.1);
  tail.add(part(geo.box(0.12, 0.26, 0.05), color, 0, -0.13, 0));
  if (stripe !== undefined) for (const k of [0.55, 0.8]) tail.add(part(geo.box(0.125, 0.03, 0.055), stripe, 0, -0.26 * k, 0));
  g.add(tail);
}

/** A button-down front: a slightly darker placket with buttons (body-local). */
export function placket(g: THREE.Group, bodyR: number, bodyH: number, color: number, button: number, n = 3): void {
  const z = (f: number): number => bodyR * beanRadius(f);
  g.add(part(geo.box(0.06, bodyH * 0.62, 0.04), color, 0, BASE_Y + bodyH * 0.38 - HIP, z(0.38) - 0.005));
  for (let i = 0; i < n; i++) {
    const f = 0.18 + (i * 0.42) / Math.max(1, n - 1);
    g.add(part(geo.sphere(0.03, 6, 5), button, 0, BASE_Y + bodyH * f - HIP, z(f) + 0.02, 1, 1, 0.6));
  }
}

/** A belt round the waist with a buckle at the front (body-local). */
export function belt(g: THREE.Group, bodyR: number, color: number, buckle: number, f = 0.24, bodyH = NPC_BODY_H): void {
  const y = BASE_Y + bodyH * f - HIP;
  g.add(torusRing(bodyR * beanRadius(f) + 0.005, 0.032, color, y));
  g.add(part(geo.box(0.09, 0.08, 0.03), buckle, 0, y, bodyR * beanRadius(f) + 0.03));
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

const PLAYER_R = 0.34;
const PLAYER_H = 0.72;
const PLAYER_HEAD = 0.3;
/** The player's look (DIRECTION D4): pine-green toggle coat, red knit hat, cream scarf with red stripes. */
export const PLAYER_LOOK = {
  coat: mixHex(PINE, 0x6bb27c, 0.42),
  coatShade: mixHex(PINE, 0x6bb27c, 0.18),
  hat: mixHex(palette(1).accent, 0xe85a48, 0.45),
  hatCuff: mixHex(palette(1).accent, INK, 0.08),
  pom: CREAM,
  scarf: CREAM,
  stripe: mixHex(palette(1).accent, 0xe85a48, 0.45),
  mitten: MAT.leather,
  hair: MAT.hairGinger,
} as const;

/** The long back tail of the player's scarf: hangs from the back of the neck along -Y (one baked mesh). */
function scarfTail(color: number, stripe: number): THREE.Mesh {
  const g = new THREE.Group();
  g.add(part(geo.box(0.13, 0.42, 0.05), color, 0, -0.21, 0));
  for (const k of [0.3, 0.55, 0.8]) g.add(part(geo.box(0.135, 0.035, 0.055), stripe, 0, -0.42 * k, 0));
  // knotted fringe at the end
  for (const x of [-0.045, 0, 0.045]) g.add(part(geo.box(0.025, 0.07, 0.03), stripe, x, -0.45, 0));
  return shareBaked(bake(g, { name: 'scarfTail' }));
}

export function createPlayerModel(): CharacterModel {
  const L = PLAYER_LOOK;
  const m = buildPawn({
    bodyColor: L.coat,
    bodyR: PLAYER_R,
    bodyH: PLAYER_H,
    headR: PLAYER_HEAD,
    skin: SKIN_TONES[0]!,
    armColor: L.coat,
    cuff: L.coatShade,
    hand: L.mitten,
    boot: MAT.boot,
    bootCuff: CREAM,
    carryZ: 0.45,
    face: { expr: 'smile', brows: L.hair },
    torsoExtras: (g, topY) => {
      // toggle coat: a darker front band with three cream wooden toggles, a leather belt, two patch pockets
      const z = (f: number): number => PLAYER_R * beanRadius(f);
      g.add(part(geo.box(0.08, PLAYER_H * 0.62, 0.04), L.coatShade, 0, BASE_Y + PLAYER_H * 0.4 - HIP, z(0.4) - 0.005));
      for (const f of [0.36, 0.52, 0.68]) {
        g.add(part(geo.capsule(0.022, 0.07, 3, 6), CREAM, 0, BASE_Y + PLAYER_H * f - HIP, z(f) + 0.02).rotateZ(Math.PI / 2));
      }
      belt(g, PLAYER_R, MAT.leather, MAT.brass, 0.22, PLAYER_H);
      for (const sx of [-1, 1]) {
        g.add(part(geo.box(0.12, 0.11, 0.04), L.coatShade, sx * 0.17, BASE_Y + PLAYER_H * 0.12 - HIP, z(0.12) - 0.035).rotateY(sx * 0.5));
      }
      // fleece hem
      g.add(torusRing(PLAYER_R * 0.96, 0.04, CREAM, BASE_Y + 0.03 - HIP));
      neckScarf(g, topY, PLAYER_R, L.scarf, L.stripe, 0.12);
    },
    headExtras: (g) => {
      fringe(g, PLAYER_HEAD, L.hair);
      beanie(g, PLAYER_HEAD, L.hat, L.hatCuff, L.pom);
    },
  });
  m.height = m.headY + PLAYER_HEAD * 1.58;
  // the long scarf tail at the back of the neck: CharacterRig lets it fly out behind on the run
  const tail = new THREE.Group();
  tail.name = 'scarfTail';
  tail.position.set(-0.06, m.topY - 0.08 - HIP, -PLAYER_R * 0.72);
  tail.add(scarfTail(L.scarf, L.stripe));
  m.squash.add(tail);
  m.tail = tail;
  m.motion = 'none';
  return m;
}

const FOUNDER_RED = mixHex(palette(1).accent, 0xd32f2f, 0.4);
const FOUNDER_GOLD = mixHex(GOLD, 0xffd34a, 0.4);

/**
 * 0.9.0 climb: the Founder's Scarf (the Settlement 20 perk, SETTLEMENT.founder), worn by the player over the everyday
 * cream scarf: a chunky red knit ring and two tails with gold stripes and a gold fringe hanging at the front. One baked
 * mesh in the squash pivot's space (entities/Player.ts adds it to the rig, so it bobs and squashes with the coat).
 */
export function createFounderScarf(): THREE.Mesh {
  const topY = BASE_Y + PLAYER_H;
  const y = topY - 0.06 - HIP;
  const g = new THREE.Group();
  g.add(torusRing(PLAYER_R * 0.8, 0.09, FOUNDER_RED, y));
  for (const [x, len, tilt] of [[0.12, 0.34, -0.1], [-0.02, 0.27, 0.18]] as const) {
    const tail = new THREE.Group();
    tail.position.set(x, y - 0.02, PLAYER_R * 0.8);
    tail.rotation.set(0.22, 0, tilt);
    tail.add(part(geo.box(0.135, len, 0.06), FOUNDER_RED, 0, -len / 2, 0));
    for (const k of [0.6, 0.82]) tail.add(part(geo.box(0.14, 0.03, 0.065), FOUNDER_GOLD, 0, -len * k, 0));
    for (const fx of [-0.045, 0, 0.045]) tail.add(part(geo.box(0.025, 0.06, 0.03), FOUNDER_GOLD, fx, -len - 0.025, 0));
    g.add(tail);
  }
  return bake(g, { name: 'founderScarf' });
}

// ---------------------------------------------------------------------------
// Customers: cosy coats, a hat per era
// ---------------------------------------------------------------------------

type HatStyle = 'bobble' | 'furHood' | 'earflap' | 'fur' | 'bowler' | 'bonnet' | 'flatCap' | 'cloche' | 'fedora' | 'beret' | 'earmuffs' | 'visor' | 'halo' | 'beanie';

/** Two hat styles per era (index = era), so every region's shoppers dress for their time. */
const ERA_HATS: readonly (readonly [HatStyle, HatStyle])[] = [
  ['bobble', 'furHood'],
  ['bobble', 'furHood'],
  ['earflap', 'bonnet'],
  ['fur', 'furHood'],
  ['bowler', 'bonnet'],
  ['flatCap', 'cloche'],
  ['fedora', 'beret'],
  ['beret', 'bobble'],
  ['earmuffs', 'beanie'],
  ['visor', 'earmuffs'],
  ['halo', 'beanie'],
];

/** Coat colours customers pick from (era decides the order, so regions differ). */
const COATS: readonly number[] = [CLOTH.brick, CLOTH.teal, CLOTH.mustard, CLOTH.plum, CLOTH.pine, CLOTH.rose, CLOTH.pumpkin, CLOTH.cocoa, CLOTH.heather, CLOTH.berry];
const TRIMS: readonly number[] = [CLOTH.cream, CLOTH.mustard, CLOTH.mint, CLOTH.blush, CLOTH.oat, CLOTH.pumpkin, CLOTH.brick, CLOTH.teal];
const EXPRS: readonly Expression[] = ['smile', 'content', 'grin', 'smile', 'o', 'calm'];
/** Distinct customer looks per era (each look is 3 shared meshes: bounded so a busy queue stays a few draw calls). */
export const CUSTOMER_LOOKS = 6;

function customerHat(g: THREE.Group, R: number, style: HatStyle, coat: number, trim: number, era: number): number {
  const p = palette(era);
  switch (style) {
    case 'bobble':
      return beanie(g, R, trim, mixHex(trim, coat, 0.35), coat);
    case 'beanie':
      return beanie(g, R, coat, mixHex(coat, INK, 0.12), null);
    case 'furHood':
      return hood(g, R, coat, CLOTH.cream);
    case 'earflap': {
      const top = beanie(g, R, trim, trim, null);
      for (const sx of [-1, 1]) g.add(part(geo.sphere(R * 0.36, 10, 8), trim, sx * R * 0.92, -R * 0.12, -R * 0.02, 0.45, 1.05, 0.8));
      g.add(part(geo.sphere(R * 0.12, 6, 5), coat, 0, R * 1.33, 0));
      return top + R * 0.05;
    }
    case 'fur':
      g.add(part(geo.cylinder(R * 1.04, R * 1.08, R * 0.75, 18), CLOTH.oat, 0, R * 0.55, 0));
      g.add(part(geo.sphere(R * 1.04, 18, 8), CLOTH.oat, 0, R * 0.92, 0, 1, 0.3, 1));
      return R * 1.25;
    case 'bowler':
      g.add(part(geo.cylinder(R * 1.32, R * 1.32, R * 0.08, 22), mixHex(p.trim, INK, 0.1), 0, R * 0.42, 0, 1, 1, 0.92));
      g.add(part(domeGeometry(R * 0.86, 1.62), mixHex(p.trim, INK, 0.1), 0, R * 0.45, 0, 1, 1.05, 1));
      g.add(part(geo.cylinder(R * 0.87, R * 0.88, R * 0.14, 20), trim, 0, R * 0.53, 0));
      return R * 1.38;
    case 'bonnet':
      g.add(part(geo.sphere(R * 1.14, 18, 12), trim, 0, R * 0.2, -R * 0.3, 1, 0.98, 0.95));
      g.add(part(geo.torus(R * 0.88, R * 0.13, 8, 22), coat, 0, R * 0.16, R * 0.58));
      for (const sx of [-1, 1]) g.add(part(geo.box(R * 0.14, R * 0.5, R * 0.06), coat, sx * R * 0.55, -R * 0.75, R * 0.55).rotateZ(sx * 0.3));
      return R * 1.38;
    case 'flatCap':
      return flatCap(g, R, mixHex(coat, CLOTH.oat, 0.5));
    case 'cloche':
      g.add(part(domeGeometry(R * 1.1, 1.75), trim, 0, R * 0.25, -R * 0.02, 1, 0.95, 1));
      g.add(part(geo.torus(R * 1.02, R * 0.08, 6, 20), coat, 0, R * 0.42, 0).rotateX(Math.PI / 2));
      g.add(part(geo.sphere(R * 0.16, 8, 6), coat, R * 0.75, R * 0.6, R * 0.5));
      return R * 1.32;
    case 'fedora': {
      const felt = mixHex(coat, CLOTH.cocoa, 0.55);
      g.add(part(geo.cylinder(R * 1.45, R * 1.45, R * 0.07, 22), felt, 0, R * 0.48, 0, 1, 1, 0.95));
      g.add(part(geo.cylinder(R * 0.78, R * 0.88, R * 0.62, 18), felt, 0, R * 0.8, 0));
      g.add(part(geo.cylinder(R * 0.9, R * 0.9, R * 0.16, 18), trim, 0, R * 0.6, 0));
      return R * 1.15;
    }
    case 'beret':
      g.add(part(geo.sphere(R * 1.08, 18, 10), trim, R * 0.12, R * 0.62, 0, 1.08, 0.36, 1.05).rotateZ(-0.18));
      g.add(part(geo.sphere(R * 0.08, 6, 5), trim, R * 0.12, R * 1.0, 0));
      return R * 1.05;
    case 'earmuffs':
      fringe(g, R, MAT.hairBrown);
      g.add(part(arcGeometry(R * 1.02, R * 0.08), trim, 0, R * 0.02, 0));
      for (const sx of [-1, 1]) g.add(part(geo.sphere(R * 0.32, 10, 8), CLOTH.cream, sx * R * 1.0, 0, 0, 0.7, 1, 1));
      return R * 1.1;
    case 'visor':
      g.add(part(domeGeometry(R * 1.04, 1.4), trim, 0, R * 0.26, 0, 1, 0.75, 1));
      g.add(part(geo.cylinder(R * 0.62, R * 0.62, R * 0.06, 16), trim, 0, R * 0.4, R * 0.85, 1.2, 1, 0.9));
      return R * 1.05;
    case 'halo':
      // a soft sun-gold headband with a light band round it (bright flat colour: baked meshes cannot glow)
      fringe(g, R, MAT.hairBrown);
      g.add(part(geo.torus(R * 1.02, R * 0.09, 6, 22), CREAM, 0, R * 0.4, 0).rotateX(Math.PI / 2));
      g.add(part(geo.torus(R * 1.05, R * 0.045, 6, 22), p.glow, 0, R * 0.4, 0).rotateX(Math.PI / 2));
      return R * 1.15;
  }
}

/** Customer variants at or above this are VIPs (createCustomerModel / createCharacterRig('customer', VIP_VARIANT_BASE + n)). */
export const VIP_VARIANT_BASE = 1000;
const VIP_COAT = [mixHex(CLOTH.plum, INK, 0.2), mixHex(CLOTH.berry, INK, 0.2), mixHex(CLOTH.teal, INK, 0.25)] as const;

/**
 * Wave 8 VIP: a rich plum / wine / deep-teal coat with fur cuffs, a gold scarf and hem and a top hat with a gold band and
 * a little flower; a grand, pleased face. Same 6 baked meshes as everyone: no extra draw calls.
 */
function createVipCustomerModel(variant: number): CharacterModel {
  const coat = VIP_COAT[hash(variant) % VIP_COAT.length]!;
  const R = NPC_HEAD_R;
  const m = buildPawn({
    bodyColor: coat,
    bodyR: NPC_BODY_R,
    bodyH: NPC_BODY_H,
    headR: R,
    skin: SKIN_TONES[hash(variant + 7) % SKIN_TONES.length]!,
    cuff: CLOTH.cream,
    hand: CREAM,
    boot: MAT.boot,
    carryZ: 0.4,
    face: { expr: 'content', brows: MAT.hairGrey },
    torsoExtras: (g, topY) => {
      neckScarf(g, topY, NPC_BODY_R, FOUNDER_GOLD);
      g.add(torusRing(NPC_BODY_R * 0.95, 0.04, FOUNDER_GOLD, BASE_Y + 0.04 - HIP));
      placket(g, NPC_BODY_R, NPC_BODY_H, mixHex(coat, INK, 0.12), FOUNDER_GOLD);
    },
    headExtras: (g) => {
      const hat = mixHex(INK, 0x3a3348, 0.4);
      g.add(part(geo.cylinder(R * 1.3, R * 1.3, R * 0.08, 22), hat, 0, R * 0.48, 0));
      g.add(part(geo.cylinder(R * 0.8, R * 0.86, R * 1.05, 20), hat, 0, R * 1.0, 0));
      g.add(part(geo.cylinder(R * 0.88, R * 0.88, R * 0.22, 20), FOUNDER_GOLD, 0, R * 0.66, 0));
      g.add(part(geo.icosahedron(R * 0.15, 0), CLOTH.blush, R * 0.66, R * 0.7, R * 0.5));
      // a white moustache
      for (const sx of [-1, 1]) g.add(onHead(part(geo.sphere(R * 0.16, 8, 6), MAT.hairGrey, 0, 0, 0, 1.3, 0.6, 0.6), R, sx * R * 0.14, -R * 0.22, R * 0.02));
    },
  });
  m.height = m.headY + R * 1.55;
  return m;
}

/**
 * A walk-in customer: a cosy coat in one of the CLOTH colours with a scarf or a fur hem, the era's hat (ERA_HATS), skin,
 * hair and a happy face that vary per look. `era` 1 (the village) .. 10; looks repeat every CUSTOMER_LOOKS variants.
 */
export function createCustomerModel(variant = 0, era = 1): CharacterModel {
  if (variant >= VIP_VARIANT_BASE) return createVipCustomerModel(variant);
  const n = Math.max(1, Math.min(10, Math.round(era) || 1));
  const look = ((variant % CUSTOMER_LOOKS) + CUSTOMER_LOOKS) % CUSTOMER_LOOKS;
  const coat = COATS[(look * 3 + n * 7) % COATS.length]!;
  const trim = TRIMS[(look * 5 + n * 3) % TRIMS.length]!;
  const style = ERA_HATS[n]![look % 2]!;
  const R = NPC_HEAD_R;
  const skin = SKIN_TONES[(look + n) % SKIN_TONES.length]!;
  const hair = HAIRS[(look * 3 + n) % HAIRS.length]!;
  let top = R;
  const m = buildPawn({
    bodyColor: coat,
    bodyR: NPC_BODY_R,
    bodyH: NPC_BODY_H,
    headR: R,
    skin,
    cuff: look % 3 === 0 ? CLOTH.cream : undefined,
    hand: trim,
    boot: MAT.boot,
    bootCuff: look % 2 === 0 ? CLOTH.cream : undefined,
    carryZ: 0.4,
    face: { expr: EXPRS[look]! },
    torsoExtras: (g, topY) => {
      if (look % 3 === 1) {
        g.add(torusRing(NPC_BODY_R * 0.95, 0.045, CLOTH.cream, BASE_Y + 0.04 - HIP)); // fur hem
        placket(g, NPC_BODY_R, NPC_BODY_H, mixHex(coat, INK, 0.12), CLOTH.cream);
      } else {
        neckScarf(g, topY, NPC_BODY_R, trim, look % 2 === 0 ? mixHex(trim, coat, 0.6) : undefined, look % 2 ? -0.1 : 0.1);
      }
    },
    headExtras: (g) => {
      if (style !== 'earmuffs' && style !== 'halo' && style !== 'furHood' && style !== 'bonnet') fringe(g, R, hair);
      top = customerHat(g, R, style, coat, trim, n);
    },
  });
  m.height = m.headY + top;
  return m;
}

export function createCourierModel(): CharacterModel {
  const R = NPC_HEAD_R;
  const helmet = CLOTH.mustard;
  const m = buildPawn({
    bodyColor: CLOTH.pumpkin,
    bodyR: NPC_BODY_R,
    bodyH: NPC_BODY_H,
    headR: R,
    skin: SKIN_TONES[1]!,
    cuff: CLOTH.cream,
    hand: CLOTH.cocoa,
    boot: MAT.boot,
    carryZ: 0.4,
    face: { expr: 'grin' },
    torsoExtras: (g, topY) => {
      g.add(torusRing(NPC_BODY_R * beanRadius(0.45) + 0.006, 0.04, CLOTH.cream, BASE_Y + NPC_BODY_H * 0.45 - HIP)); // reflective band
      neckScarf(g, topY, NPC_BODY_R, CLOTH.teal);
      // a satchel strap across the chest
      g.add(part(geo.box(0.05, 0.62, 0.04), MAT.leather, 0.02, BASE_Y + 0.4 - HIP, NPC_BODY_R * 0.97).rotateZ(0.6));
    },
    headExtras: (g) => {
      fringe(g, R, MAT.hairDark);
      g.add(part(domeGeometry(R * 1.1, 1.55), helmet, 0, R * 0.2, -R * 0.02, 1, 0.92, 1.04));
      g.add(part(geo.box(R * 0.2, R * 0.12, R * 1.5), mixHex(helmet, INK, 0.15), 0, R * 1.18, -R * 0.05));
      // goggles pushed up onto the helmet: a strap round it and two brass-rimmed mint lenses at the front
      g.add(part(geo.torus(R * 1.1, R * 0.05, 6, 22), MAT.leather, 0, R * 0.5, 0).rotateX(Math.PI / 2));
      for (const sx of [-1, 1]) {
        const lens = onHead(part(geo.cylinder(R * 0.2, R * 0.2, R * 0.12, 14), MAT.brass, 0, 0, 0), R * 1.12, sx * R * 0.3, R * 0.58, 0);
        lens.rotateX(Math.PI / 2);
        g.add(lens, onHead(part(geo.sphere(R * 0.13, 8, 6), CLOTH.mint, 0, 0, 0, 1, 1, 0.5), R * 1.18, sx * R * 0.3, R * 0.58, 0));
      }
    },
  });
  m.height = m.headY + R * 1.3;
  return m;
}

export function createDriverModel(variant = 0): CharacterModel {
  const R = NPC_HEAD_R;
  const jacket = variant % 2 === 0 ? CLOTH.cocoa : CLOTH.teal;
  const muffler = variant % 2 === 0 ? CLOTH.pumpkin : CLOTH.mustard;
  const m = buildPawn({
    bodyColor: jacket,
    bodyR: NPC_BODY_R,
    bodyH: NPC_BODY_H,
    headR: R,
    skin: SKIN_TONES[(variant + 2) % SKIN_TONES.length]!,
    cuff: CLOTH.oat,
    hand: MAT.leather,
    boot: MAT.boot,
    carryZ: 0.4,
    face: { expr: variant % 2 ? 'content' : 'smile', brows: MAT.hairBrown },
    torsoExtras: (g, topY) => {
      neckScarf(g, topY, NPC_BODY_R, muffler, CLOTH.cream);
      placket(g, NPC_BODY_R, NPC_BODY_H, mixHex(jacket, INK, 0.12), CLOTH.oat);
    },
    headExtras: (g) => {
      fringe(g, R, variant % 2 ? MAT.hairGrey : MAT.hairBrown);
      flatCap(g, R, CLOTH.oat, muffler);
    },
  });
  m.height = m.headY + R;
  return m;
}

// ---------------------------------------------------------------------------
// Era-1 crew (assets/eraWorkers.ts createWorkerModel dresses them like every era's crew)
// ---------------------------------------------------------------------------

/** Crew roles of the legacy `worker` variants 0 / 1 / 2 (matches UPGRADES crateRunner / cashier / logHauler). */
export const WORKER_ROLES = ['crateRunner', 'cashier', 'logHauler'] as const;
/** Worker variants at or above this are town porters. */
export const PORTER_VARIANT = 3;

/**
 * Which era-crew role kit (hat colour, tool, motion; assets/eraWorkers.ts) each era-1 crew wears, so the Survival crew
 * reads like every other era's seven roles.
 */
export const CREW_ROLE_KIT: Record<string, string> = {
  logHauler: 'hauler',
  crateRunner: 'feeder',
  sledLoader: 'shipper',
  porter: 'porter',
  pineHauler: 'gatherer',
  foreman: 'foreman',
  cashier: 'clerk',
};

// ---------------------------------------------------------------------------
// Axe
// ---------------------------------------------------------------------------

/** Axe look per upgrade level (0–5): plain wood + iron, then steel with a red handle, then gold. */
const AXE_STYLES = [
  { handle: MAT.wood, head: mixHex(MAT.steel, INK, 0.25), knob: MAT.wood },
  { handle: MAT.wood, head: mixHex(MAT.steel, INK, 0.1), knob: MAT.wood },
  { handle: PLAYER_LOOK.hat, head: MAT.steel, knob: PLAYER_LOOK.hat },
  { handle: PLAYER_LOOK.hat, head: mixHex(MAT.steel, SNOW, 0.5), knob: SNOW },
  { handle: MAT.leather, head: GOLD, knob: GOLD },
  { handle: MAT.leather, head: mixHex(GOLD, 0xffe27a, 0.6), knob: mixHex(GOLD, 0xffe27a, 0.6) },
] as const;

/**
 * Handle + wedge head, one baked mesh. `tier` is the Sharp Axe upgrade level (0–5): 0–1 wood + iron, 2–3 steel
 * with a red handle, 4–5 gold; the head also grows a little per level. Parent it to a hand
 * (CharacterModel.handR): the handle runs along the hand's local -Y (the arm direction) and the cutting edge
 * leads the swing (local -Z). Each call bakes its own geometry (dispose `mesh.geometry` when swapping axes).
 */
export function createAxe(tier = 0): THREE.Group {
  const lv = Math.max(0, Math.min(AXE_STYLES.length - 1, Math.round(tier)));
  const st = AXE_STYLES[lv]!;
  const g = new THREE.Group();
  const handle = mesh(geo.cylinder(0.034, 0.04, 0.78, 8), toon(st.handle));
  handle.position.y = -0.3;
  // wedge = triangular prism (3 radial segments); apex = cutting edge toward -Z
  const head = mesh(geo.cylinder(0.19, 0.19, 0.3, 3), toon(st.head));
  const grow = 1 + 0.07 * lv;
  head.rotation.y = Math.PI;
  head.scale.set(0.5 * grow, grow, grow);
  head.position.set(0, -0.6, -0.03);
  const knob = mesh(geo.sphere(0.05, 8, 6), toon(st.knob));
  knob.position.y = 0.1;
  const grip = mesh(geo.cylinder(0.046, 0.046, 0.14, 8), toon(MAT.leather));
  grip.position.y = 0.0;
  const body = new THREE.Group();
  body.add(handle, head, knob, grip);
  g.add(bake(body, { name: 'axe' }));
  return g;
}

export const characterCatalog: Record<string, () => THREE.Object3D> = {
  player: () => createPlayerModel().root,
  'customer (village look 0)': () => createCustomerModel(0).root,
  'customer (village look 1)': () => createCustomerModel(1).root,
  'customer (village look 2)': () => createCustomerModel(2).root,
  'customer (VIP)': () => createCustomerModel(VIP_VARIANT_BASE).root,
  courier: () => createCourierModel().root,
  driver: () => createDriverModel(0).root,
  'driver (teal)': () => createDriverModel(1).root,
  'axe (lv 0, wood + iron)': () => createAxe(0),
  'axe (lv 2, steel)': () => createAxe(2),
  'axe (lv 4, gold)': () => createAxe(4),
};

/** Every era's six customer looks in rows (the one-click review: --query "gallery=customers by era"). */
characterCatalog['customers by era'] = () => {
  const g = new THREE.Group();
  for (let era = 1; era <= 10; era++) {
    for (let v = 0; v < CUSTOMER_LOOKS; v++) {
      const m = createCustomerModel(v, era).root;
      m.position.set((v - 2.5) * 0.95, 0, (era - 5.5) * 1.1);
      g.add(m);
    }
  }
  return g;
};
