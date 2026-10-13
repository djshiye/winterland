/**
 * AssetFactory — character models (owner: B1). Chunky "pawn" people built from compound primitives
 * with the master palette; every factory returns a CharacterModel handle that render/characters.ts
 * (CharacterRig) animates. Geometry (geo.*) and materials (toon()) are cached, so crowds of NPCs share
 * all GPU resources; only the Object3D hierarchy is per instance.
 *
 * Art spec:
 * - PLAYER (lumberjack): cylinder body r 0.35 / h 0.8 in PLAYER_COAT (#1E6FD9) with WHITE (PLAYER_TRIM)
 *   torus collars at the base and at the neck; head sphere r 0.28 in PLAYER_SKIN (#F5CBA7) with a WHITE
 *   beard (flattened sphere) and a BLUE beanie (r 0.29 dome). carryPivot at (0, 0.5, 0.45): carried
 *   items stack upward from it. ~1.5 tall.
 * - AXE: brown cylinder handle + silver wedge head (triangular prism, cutting edge toward -Z of the hand).
 * - CUSTOMER: capsule r 0.3 / h 0.75 in CUSTOMER_BLUE (#4FA8F8) with a hood sphere. `variant` varies the
 *   shade, scarf and headwear.
 * - COURIER (cargo-tricycle rider): yellow COURIER_YELLOW helmet + hi-vis stripe, seated pose.
 * - DRIVER (pickup truck): brown work jacket, grey flat cap; distinct from customers.
 *
 * Conventions: root origin at the feet, character faces local +Z. `body` is an upper-body pivot at hip
 * height (HIP_Y) that CharacterRig bobs / leans; `squash` (child of body) is the only thing that gets
 * scaled, so the anchors (carryPivot / backPivot, children of body) never deform carried items.
 * handR sits at the end of armR; its local -Y axis points along the arm, away from the shoulder.
 */
import * as THREE from 'three';
import { COLORS, PALETTE } from '../config';
import { geo, mesh, toon } from '../render/materials';

export type CharacterKind = 'player' | 'customer' | 'courier' | 'driver';

/** Height of the body pivot (hips) above the feet, shared by every character. */
export const CHARACTER_HIP_Y = 0.25;
const HIP = CHARACTER_HIP_Y;

/** Parts of a character model that CharacterRig animates. */
export interface CharacterModel {
  root: THREE.Group;
  /** Upper-body pivot at hip height (bob / lean / twist). Child of root. */
  body: THREE.Group;
  /** Scaled for squash & stretch; holds torso, head and arms (but not the anchors). Child of body. */
  squash: THREE.Group;
  head: THREE.Group;
  /** Headwear pivot (child of head) for a little wobble; null when there is none. */
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
}

interface PawnSpec {
  bodyColor: number;
  bodyR: number;
  bodyH: number;
  /** Plain cylinder (player) or capsule (NPCs). */
  capsule: boolean;
  headR: number;
  skin: number;
  /** Mitten / glove colour. */
  hand: number;
  boot: number;
  carryZ: number;
}

const BASE_Y = 0.12;
const ARM_R = 0.085;
const ARM_LEN = 0.17;
/** Distance from the shoulder pivot to the hand centre. */
export const CHARACTER_ARM_REACH = 0.33;

const eyeColor = (): number => PALETTE.rubber;

/** Skeleton + body + head + arms + boots; kind-specific details are added by the callers. */
function buildPawn(s: PawnSpec): CharacterModel & { headY: number; topY: number } {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = HIP;
  const squash = new THREE.Group();
  body.add(squash);

  const bodyMat = toon(s.bodyColor);
  const topY = BASE_Y + s.bodyH;
  const torso = s.capsule
    ? mesh(geo.capsule(s.bodyR, s.bodyH - s.bodyR * 2, 6, 14), bodyMat)
    : mesh(geo.cylinder(s.bodyR * 0.93, s.bodyR, s.bodyH, 18), bodyMat);
  torso.position.y = BASE_Y + s.bodyH / 2 - HIP;
  squash.add(torso);

  // head
  const headY = topY + s.headR * 0.6;
  const head = new THREE.Group();
  head.position.y = headY - HIP;
  head.add(mesh(geo.sphere(s.headR, 18, 14), toon(s.skin)));
  const eyeMat = toon(eyeColor());
  const ex = s.headR * 0.32;
  const ez = Math.sqrt(Math.max(0, s.headR * s.headR - ex * ex)) - 0.012;
  for (const sx of [-ex, ex]) {
    const eye = mesh(geo.sphere(0.036, 8, 6), eyeMat, { cast: false });
    eye.scale.set(1, 1.3, 0.7);
    eye.position.set(sx, 0.0, ez);
    head.add(eye);
  }
  squash.add(head);

  // arms: pivot at the shoulder, hanging down
  const armMat = bodyMat;
  const handMat = toon(s.hand);
  const sx = s.bodyR + 0.03;
  const shoulder = topY - 0.14 - HIP;
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * sx, shoulder, 0);
    const a = mesh(geo.capsule(ARM_R, ARM_LEN, 4, 10), armMat);
    a.position.y = -ARM_LEN / 2 - ARM_R * 0.8;
    const h = mesh(geo.sphere(0.1, 10, 8), handMat);
    h.position.y = -CHARACTER_ARM_REACH;
    arm.add(a, h);
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
    leg.position.set(side * s.bodyR * 0.5, HIP, 0);
    const boot = mesh(geo.box(0.22, 0.2, 0.32), bootMat);
    boot.position.set(0, -0.15, 0.05);
    leg.add(boot);
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
    height: topY + s.headR * 1.6,
    headY,
    topY,
  };
}

function hash(n: number): number {
  let x = (Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
  return (x ^ (x >>> 12)) >>> 0;
}

/** Deterministic scale variation in [1 - 0.06, 1 + 0.06] for crowd variety. */
export function characterScale(variant: number): number {
  return 1 + (((hash(variant) % 13) - 6) / 6) * 0.06;
}

function torusRing(major: number, tube: number, color: number, y: number): THREE.Mesh {
  const t = mesh(geo.torus(major, tube, 8, 22), toon(color));
  t.rotation.x = Math.PI / 2;
  t.position.y = y;
  return t;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export function createPlayerModel(): CharacterModel {
  const m = buildPawn({
    bodyColor: COLORS.PLAYER_COAT,
    bodyR: 0.35,
    bodyH: 0.8,
    capsule: false,
    headR: 0.28,
    skin: COLORS.PLAYER_SKIN,
    hand: COLORS.PLAYER_TRIM,
    boot: PALETTE.playerPants,
    carryZ: 0.45,
  });
  const sq = m.squash;
  // white torus collars at the base and at the neck
  sq.add(torusRing(0.35, 0.055, COLORS.PLAYER_TRIM, BASE_Y + 0.05 - HIP));
  sq.add(torusRing(0.325, 0.065, COLORS.PLAYER_TRIM, m.topY - 0.02 - HIP));
  // white beard: flattened sphere over the lower face
  const beard = mesh(geo.sphere(0.255, 14, 10), toon(COLORS.PLAYER_TRIM));
  beard.scale.set(1, 0.52, 0.66);
  beard.position.set(0, -0.14, 0.17);
  m.head.add(beard);
  // blue beanie: r 0.29 dome + darker cuff
  const hat = new THREE.Group();
  const dome = mesh(geo.sphere(0.29, 18, 12), toon(COLORS.PLAYER_COAT));
  dome.scale.set(1, 0.78, 1);
  dome.position.y = 0.13;
  const cuff = mesh(geo.torus(0.265, 0.05, 8, 20), toon(PALETTE.playerPants));
  cuff.rotation.x = Math.PI / 2;
  cuff.position.y = 0.1;
  hat.add(dome, cuff);
  m.head.add(hat);
  m.hat = hat;
  m.height = m.headY + 0.13 + 0.29 * 0.78;
  return m;
}

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------

const CUSTOMER_SHADES = [COLORS.CUSTOMER_BLUE, PALETTE.customerDark, 0x7ec2fb] as const;
const SCARVES = [-1, COLORS.PLAYER_TRIM, COLORS.COURIER_YELLOW, COLORS.SAW_GLOW] as const;

function npcBody(color: number, skin = COLORS.PLAYER_SKIN, hand: number = skin): ReturnType<typeof buildPawn> {
  return buildPawn({
    bodyColor: color,
    bodyR: 0.3,
    bodyH: 0.75,
    capsule: true,
    headR: 0.22,
    skin,
    hand,
    boot: PALETTE.rubber,
    carryZ: 0.4,
  });
}

export function createCustomerModel(variant = 0): CharacterModel {
  const h = hash(variant);
  const color = CUSTOMER_SHADES[h % CUSTOMER_SHADES.length]!;
  const m = npcBody(color);
  // hood: a body-coloured sphere behind / above the face (the skin head pokes out of the front)
  const hood = mesh(geo.sphere(0.27, 16, 12), toon(color));
  hood.scale.set(1, 0.95, 1);
  hood.position.set(0, 0.04, -0.09);
  const hat = new THREE.Group();
  hat.add(hood);
  m.head.add(hat);
  m.hat = hat;
  const scarf = SCARVES[(h >>> 4) % SCARVES.length]!;
  if (scarf >= 0) m.squash.add(torusRing(0.265, 0.06, scarf, m.topY - 0.02 - HIP));
  m.height = m.headY + 0.04 + 0.27 * 0.95;
  return m;
}

export function createCourierModel(): CharacterModel {
  const m = npcBody(PALETTE.playerPants, COLORS.PLAYER_SKIN, COLORS.COURIER_YELLOW);
  m.squash.add(torusRing(0.305, 0.05, COLORS.COURIER_YELLOW, BASE_Y + 0.38 - HIP)); // hi-vis stripe
  const hat = new THREE.Group();
  const helmet = mesh(geo.sphere(0.26, 18, 12), toon(COLORS.COURIER_YELLOW));
  helmet.scale.set(1, 0.82, 1);
  helmet.position.y = 0.1;
  const visor = mesh(geo.box(0.34, 0.04, 0.16), toon(COLORS.COURIER_YELLOW));
  visor.position.set(0, 0.075, 0.24);
  visor.rotation.x = 0.15;
  hat.add(helmet, visor);
  m.head.add(hat);
  m.hat = hat;
  m.height = m.headY + 0.1 + 0.26 * 0.82;
  return m;
}

export function createDriverModel(variant = 0): CharacterModel {
  const jacket = variant % 2 === 0 ? COLORS.CRATE_STRIP : COLORS.MACHINE_STEEL;
  const m = npcBody(jacket, COLORS.PLAYER_SKIN, PALETTE.rubber);
  m.squash.add(torusRing(0.305, 0.045, COLORS.SAW_GLOW, m.topY - 0.02 - HIP)); // orange scarf
  const hat = new THREE.Group();
  const dome = mesh(geo.sphere(0.245, 16, 10), toon(PALETTE.metalDark));
  dome.scale.set(1, 0.6, 1);
  dome.position.y = 0.11;
  const brim = mesh(geo.box(0.36, 0.04, 0.2), toon(PALETTE.metalDark));
  brim.position.set(0, 0.075, 0.24);
  hat.add(dome, brim);
  m.head.add(hat);
  m.hat = hat;
  m.height = m.headY + 0.11 + 0.245 * 0.6;
  return m;
}

// ---------------------------------------------------------------------------
// Axe
// ---------------------------------------------------------------------------

/**
 * Brown cylinder handle + silver wedge head. Parent it to a hand (CharacterModel.handR): the handle runs
 * along the hand's local -Y (the arm direction) and the cutting edge leads the swing (local -Z).
 */
export function createAxe(): THREE.Group {
  const g = new THREE.Group();
  const handle = mesh(geo.cylinder(0.032, 0.038, 0.78, 8), toon(COLORS.LOG_BARK));
  handle.position.y = -0.3;
  // wedge = triangular prism (3 radial segments); apex = cutting edge toward -Z
  const head = mesh(geo.cylinder(0.19, 0.19, 0.3, 3), toon(0xc9d3d6));
  head.rotation.y = Math.PI;
  head.scale.set(0.5, 1, 1);
  head.position.set(0, -0.6, -0.03);
  const knob = mesh(geo.sphere(0.048, 8, 6), toon(COLORS.LOG_BARK));
  knob.position.y = 0.1;
  g.add(handle, head, knob);
  return g;
}

export const characterCatalog: Record<string, () => THREE.Object3D> = {
  player: () => createPlayerModel().root,
  customer: () => createCustomerModel(0).root,
  'customer (green scarf variant)': () => createCustomerModel(7).root,
  'customer (light variant)': () => createCustomerModel(2).root,
  courier: () => createCourierModel().root,
  driver: () => createDriverModel(0).root,
  'driver (grey)': () => createDriverModel(1).root,
  axe: () => createAxe(),
};
