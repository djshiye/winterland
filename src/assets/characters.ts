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
 * - WORKER (hired crew): crate runner / cashier / log hauler, see createWorkerModel.
 * - DRIVER (pickup truck): brown work jacket, grey flat cap; distinct from customers.
 *
 * Conventions: root origin at the feet, character faces local +Z. `body` is an upper-body pivot at hip
 * height (HIP_Y) that CharacterRig bobs / leans; `squash` (child of body) is the only thing that gets
 * scaled, so the anchors (carryPivot / backPivot, children of body) never deform carried items.
 * Draw calls: each animated pivot (torso, head, each arm, each boot) holds ONE baked vertex-coloured mesh
 * (render/batch.ts bake), so a character is 6 meshes and the axe is 1. Headwear is baked into the head.
 * handR sits at the end of armR; its local -Y axis points along the arm, away from the shoulder.
 */
import * as THREE from 'three';
import { COLORS, PALETTE } from '../config';
import { bake } from '../render/batch';
import { geo, mesh, toon } from '../render/materials';

/** 'worker': hired crew (crate runner / cashier / log hauler — variant 0 / 1 / 2; the porter is PORTER_VARIANT and up). */
export type CharacterKind = 'player' | 'customer' | 'courier' | 'driver' | 'worker';

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
}

interface PawnSpec {
  bodyColor: number;
  bodyR: number;
  bodyH: number;
  /** Plain cylinder (player) or capsule (NPCs). */
  capsule: boolean;
  headR: number;
  skin: number;
  /** Sleeve colour (default: the body colour). */
  armColor?: number;
  /** Mitten / glove colour. */
  hand: number;
  boot: number;
  carryZ: number;
  /** Extra torso parts (collars, scarf, stripes), in body-local space (y up from the hips). */
  torsoExtras?: (g: THREE.Group, topY: number) => void;
  /** Extra head parts (beard, hat), in head-local space. */
  headExtras?: (g: THREE.Group) => void;
}

const BASE_Y = 0.12;
const ARM_R = 0.085;
const ARM_LEN = 0.17;
/** Distance from the shoulder pivot to the hand centre. */
export const CHARACTER_ARM_REACH = 0.33;

const eyeColor = (): number => PALETTE.rubber;

/** Skeleton + body + head + arms + boots (each animated pivot is baked to one mesh); kind-specific parts via spec callbacks. */
function buildPawn(s: PawnSpec): CharacterModel & { headY: number; topY: number } {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = HIP;
  const squash = new THREE.Group();
  body.add(squash);

  const bodyMat = toon(s.bodyColor);
  const topY = BASE_Y + s.bodyH;

  // torso (+ collars / scarf / stripes): one mesh
  const torsoG = new THREE.Group();
  const torso = s.capsule
    ? mesh(geo.capsule(s.bodyR, s.bodyH - s.bodyR * 2, 6, 14), bodyMat)
    : mesh(geo.cylinder(s.bodyR * 0.93, s.bodyR, s.bodyH, 18), bodyMat);
  torso.position.y = BASE_Y + s.bodyH / 2 - HIP;
  torsoG.add(torso);
  s.torsoExtras?.(torsoG, topY);
  squash.add(bake(torsoG, { name: 'torso' }));

  // head (+ eyes, beard, hat): pivot group with one mesh
  const headY = topY + s.headR * 0.6;
  const head = new THREE.Group();
  head.position.y = headY - HIP;
  const headG = new THREE.Group();
  headG.add(mesh(geo.sphere(s.headR, 18, 14), toon(s.skin)));
  const eyeMat = toon(eyeColor());
  const ex = s.headR * 0.32;
  const ez = Math.sqrt(Math.max(0, s.headR * s.headR - ex * ex)) - 0.012;
  for (const sx of [-ex, ex]) {
    const eye = mesh(geo.sphere(0.036, 8, 6), eyeMat);
    eye.scale.set(1, 1.3, 0.7);
    eye.position.set(sx, 0.0, ez);
    headG.add(eye);
  }
  s.headExtras?.(headG);
  head.add(bake(headG, { name: 'head' }));
  squash.add(head);

  // arms: pivot at the shoulder, hanging down; each is one mesh (sleeve + mitten)
  const armMat = s.armColor === undefined ? bodyMat : toon(s.armColor);
  const handMat = toon(s.hand);
  const sx = s.bodyR + 0.03;
  const shoulder = topY - 0.14 - HIP;
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * sx, shoulder, 0);
    const ag = new THREE.Group();
    const a = mesh(geo.capsule(ARM_R, ARM_LEN, 4, 10), armMat);
    a.position.y = -ARM_LEN / 2 - ARM_R * 0.8;
    const h = mesh(geo.sphere(0.1, 10, 8), handMat);
    h.position.y = -CHARACTER_ARM_REACH;
    ag.add(a, h);
    arm.add(bake(ag, { name: 'arm' }));
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
    const lg = new THREE.Group();
    const boot = mesh(geo.box(0.22, 0.2, 0.32), bootMat);
    boot.position.set(0, -0.15, 0.05);
    lg.add(boot);
    leg.add(bake(lg, { name: 'boot' }));
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
    torsoExtras: (g, topY) => {
      // white torus collars at the base and at the neck
      g.add(torusRing(0.35, 0.055, COLORS.PLAYER_TRIM, BASE_Y + 0.05 - HIP));
      g.add(torusRing(0.325, 0.065, COLORS.PLAYER_TRIM, topY - 0.02 - HIP));
    },
    headExtras: (g) => {
      // white beard: flattened sphere over the lower face
      const beard = mesh(geo.sphere(0.255, 14, 10), toon(COLORS.PLAYER_TRIM));
      beard.scale.set(1, 0.52, 0.66);
      beard.position.set(0, -0.14, 0.17);
      // blue beanie: r 0.29 dome + darker cuff
      const dome = mesh(geo.sphere(0.29, 18, 12), toon(COLORS.PLAYER_COAT));
      dome.scale.set(1, 0.78, 1);
      dome.position.y = 0.13;
      const cuff = mesh(geo.torus(0.265, 0.05, 8, 20), toon(PALETTE.playerPants));
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = 0.1;
      g.add(beard, dome, cuff);
    },
  });
  m.height = m.headY + 0.13 + 0.29 * 0.78;
  return m;
}

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------

const CUSTOMER_SHADES = [COLORS.CUSTOMER_BLUE, PALETTE.customerDark, 0x7ec2fb] as const;
const SCARVES = [-1, COLORS.PLAYER_TRIM, COLORS.COURIER_YELLOW, COLORS.SAW_GLOW] as const;

function npcBody(
  color: number,
  skin: number,
  hand: number,
  torsoExtras?: PawnSpec['torsoExtras'],
  headExtras?: PawnSpec['headExtras'],
  armColor?: number,
): ReturnType<typeof buildPawn> {
  return buildPawn({
    bodyColor: color,
    armColor,
    bodyR: 0.3,
    bodyH: 0.75,
    capsule: true,
    headR: 0.22,
    skin,
    hand,
    boot: PALETTE.rubber,
    carryZ: 0.4,
    torsoExtras,
    headExtras,
  });
}

/** Customer variants at or above this are VIPs (createCustomerModel / createCharacterRig('customer', VIP_VARIANT_BASE + n)). */
export const VIP_VARIANT_BASE = 1000;
const VIP_GOLD = 0xffc933;
const VIP_COAT = [0x6b2f7a, 0x7a2e3a, 0x2f4b7a] as const;

/**
 * Wave 8 VIP: a rich plum / wine / navy coat with a gold scarf, a gold hem ring and a black top hat with a gold
 * band. Same structure as a normal customer (torso + head + 2 arms + 2 boots = 6 baked meshes): no extra draw calls.
 */
function createVipCustomerModel(variant: number): CharacterModel {
  const coat = VIP_COAT[hash(variant) % VIP_COAT.length]!;
  const m = npcBody(
    coat,
    COLORS.PLAYER_SKIN,
    PALETTE.rubber,
    (g, topY) => {
      g.add(torusRing(0.27, 0.075, VIP_GOLD, topY - 0.02 - HIP)); // chunky gold scarf
      g.add(torusRing(0.305, 0.04, VIP_GOLD, BASE_Y + 0.06 - HIP)); // gold hem
    },
    (g) => {
      const hat = toon(0x22232b);
      const brim = mesh(geo.cylinder(0.3, 0.3, 0.04, 20), hat);
      brim.position.y = 0.16;
      const crown = mesh(geo.cylinder(0.185, 0.2, 0.3, 20), hat);
      crown.position.y = 0.33;
      const band = mesh(geo.cylinder(0.205, 0.205, 0.07, 20), toon(VIP_GOLD));
      band.position.y = 0.21;
      g.add(brim, crown, band);
    },
  );
  m.height = m.headY + 0.48;
  return m;
}

export function createCustomerModel(variant = 0): CharacterModel {
  if (variant >= VIP_VARIANT_BASE) return createVipCustomerModel(variant);
  const h = hash(variant);
  const color = CUSTOMER_SHADES[h % CUSTOMER_SHADES.length]!;
  const scarf = SCARVES[(h >>> 4) % SCARVES.length]!;
  const m = npcBody(
    color,
    COLORS.PLAYER_SKIN,
    COLORS.PLAYER_SKIN,
    (g, topY) => {
      if (scarf >= 0) g.add(torusRing(0.265, 0.06, scarf, topY - 0.02 - HIP));
    },
    (g) => {
      // hood: a body-coloured sphere behind / above the face (the skin head pokes out of the front)
      const hood = mesh(geo.sphere(0.27, 16, 12), toon(color));
      hood.scale.set(1, 0.95, 1);
      hood.position.set(0, 0.04, -0.09);
      g.add(hood);
    },
  );
  m.height = m.headY + 0.04 + 0.27 * 0.95;
  return m;
}

export function createCourierModel(): CharacterModel {
  const m = npcBody(
    PALETTE.playerPants,
    COLORS.PLAYER_SKIN,
    COLORS.COURIER_YELLOW,
    (g) => {
      g.add(torusRing(0.305, 0.05, COLORS.COURIER_YELLOW, BASE_Y + 0.38 - HIP)); // hi-vis stripe
    },
    (g) => {
      const helmet = mesh(geo.sphere(0.26, 18, 12), toon(COLORS.COURIER_YELLOW));
      helmet.scale.set(1, 0.82, 1);
      helmet.position.y = 0.1;
      const visor = mesh(geo.box(0.34, 0.04, 0.16), toon(COLORS.COURIER_YELLOW));
      visor.position.set(0, 0.075, 0.24);
      visor.rotation.x = 0.15;
      g.add(helmet, visor);
    },
  );
  m.height = m.headY + 0.1 + 0.26 * 0.82;
  return m;
}

export function createDriverModel(variant = 0): CharacterModel {
  const jacket = variant % 2 === 0 ? COLORS.CRATE_STRIP : COLORS.MACHINE_STEEL;
  const m = npcBody(
    jacket,
    COLORS.PLAYER_SKIN,
    PALETTE.rubber,
    (g, topY) => {
      g.add(torusRing(0.305, 0.045, COLORS.SAW_GLOW, topY - 0.02 - HIP)); // orange scarf
    },
    (g) => {
      const dome = mesh(geo.sphere(0.245, 16, 10), toon(PALETTE.metalDark));
      dome.scale.set(1, 0.6, 1);
      dome.position.y = 0.11;
      const brim = mesh(geo.box(0.36, 0.04, 0.2), toon(PALETTE.metalDark));
      brim.position.set(0, 0.075, 0.24);
      g.add(dome, brim);
    },
  );
  m.height = m.headY + 0.11 + 0.245 * 0.6;
  return m;
}

/** Crew roles, indexed by `variant % 3` (matches UPGRADES crateRunner / cashier / logHauler). */
export const WORKER_ROLES = ['crateRunner', 'cashier', 'logHauler'] as const;

/**
 * Hired crew, chunky lumber-yard workers (all distinct from the blue player, light-blue customers and the
 * yellow-helmeted couriers):
 *   0 crate runner: orange hi-vis vest with white reflective bands, grey sleeves, white hard hat.
 *   1 cashier:      green vest over white sleeves, flat dark cap, a little brown satchel on the hip.
 *   2 log hauler:   red/black plaid jacket, black beanie with a red cuff, brown beard.
 */
/** Worker variants at or above this are town porters (createPorterModel). */
export const PORTER_VARIANT = 3;

/**
 * Wave 9 porter: a deep-teal duffel coat with a mustard scarf, a leather chest strap and a cream woolly hat with a
 * pompom. Same structure as the other workers (6 baked meshes).
 */
function createPorterModel(): CharacterModel {
  const COAT = 0x2f8f83;
  const SCARF = 0xe0a526;
  const m = npcBody(
    COAT,
    COLORS.PLAYER_SKIN,
    PALETTE.rubber,
    (g, topY) => {
      g.add(torusRing(0.288, 0.07, SCARF, topY - 0.02 - HIP)); // chunky mustard scarf
      g.add(torusRing(0.303, 0.03, PALETTE.barkDark, BASE_Y + 0.2 - HIP)); // belt
      const strap = mesh(geo.box(0.05, 0.78, 0.04), toon(PALETTE.barkDark));
      strap.position.set(0.02, BASE_Y + 0.5 - HIP, 0.285);
      strap.rotation.z = 0.6;
      const buckle = mesh(geo.box(0.09, 0.09, 0.03), toon(SCARF));
      buckle.position.set(0.02, BASE_Y + 0.5 - HIP, 0.3);
      g.add(strap, buckle);
    },
    (g) => {
      const wool = toon(0xf1e6cf);
      const dome = mesh(geo.sphere(0.25, 16, 10), wool);
      dome.scale.set(1, 0.8, 1);
      dome.position.y = 0.11;
      const cuff = mesh(geo.torus(0.23, 0.05, 8, 18), toon(SCARF));
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = 0.08;
      const pom = mesh(geo.sphere(0.08, 10, 8), wool);
      pom.position.y = 0.34;
      g.add(dome, cuff, pom);
    },
    COAT,
  );
  m.height = m.headY + 0.11 + 0.25 * 0.8 + 0.12;
  return m;
}

export function createWorkerModel(variant = 0): CharacterModel {
  if (variant >= PORTER_VARIANT) return createPorterModel();
  const role = ((variant % 3) + 3) % 3;
  if (role === 0) {
    const m = npcBody(
      COLORS.SAW_GLOW,
      COLORS.PLAYER_SKIN,
      PALETTE.rubber,
      (g, topY) => {
        g.add(torusRing(0.304, 0.035, COLORS.PLAYER_TRIM, BASE_Y + 0.28 - HIP));
        g.add(torusRing(0.304, 0.035, COLORS.PLAYER_TRIM, BASE_Y + 0.5 - HIP));
        g.add(torusRing(0.285, 0.05, PALETTE.metalDark, topY - 0.03 - HIP)); // collar
      },
      (g) => {
        const dome = mesh(geo.sphere(0.25, 16, 10), toon(COLORS.SNOW_WHITE));
        dome.scale.set(1, 0.72, 1);
        dome.position.y = 0.1;
        const brim = mesh(geo.box(0.36, 0.035, 0.16), toon(COLORS.SNOW_WHITE));
        brim.position.set(0, 0.08, 0.23);
        const ridge = mesh(geo.box(0.07, 0.04, 0.36), toon(COLORS.SAW_GLOW));
        ridge.position.set(0, 0.27, 0);
        g.add(dome, brim, ridge);
      },
      PALETTE.metalDark,
    );
    m.height = m.headY + 0.1 + 0.25 * 0.72 + 0.03;
    return m;
  }
  if (role === 1) {
    const m = npcBody(
      PALETTE.cashDark,
      COLORS.CRATE_BOX,
      COLORS.PLAYER_SKIN,
      (g, topY) => {
        g.add(torusRing(0.285, 0.05, COLORS.PLAYER_TRIM, topY - 0.03 - HIP)); // shirt collar
        // satchel on the left hip + strap across the chest
        const bag = mesh(geo.box(0.14, 0.22, 0.26), toon(COLORS.CRATE_STRIP));
        bag.position.set(-0.35, 0.36 - HIP, 0.04);
        const flap = mesh(geo.box(0.15, 0.06, 0.27), toon(PALETTE.barkDark));
        flap.position.set(-0.35, 0.49 - HIP, 0.04);
        const strap = mesh(geo.box(0.04, 0.8, 0.04), toon(COLORS.CRATE_STRIP));
        strap.position.set(-0.04, 0.55 - HIP, 0.285);
        strap.rotation.z = -0.62;
        g.add(bag, flap, strap);
      },
      (g) => {
        const dome = mesh(geo.sphere(0.24, 16, 10), toon(PALETTE.rubber));
        dome.scale.set(1, 0.55, 1);
        dome.position.y = 0.1;
        const brim = mesh(geo.box(0.34, 0.035, 0.2), toon(PALETTE.rubber));
        brim.position.set(0, 0.07, 0.23);
        const band = mesh(geo.cylinder(0.243, 0.243, 0.04, 16), toon(PALETTE.cashDark));
        band.position.y = 0.075;
        g.add(dome, brim, band);
      },
      COLORS.PLAYER_TRIM,
    );
    m.height = m.headY + 0.1 + 0.24 * 0.55 + 0.03;
    return m;
  }
  // 2: log hauler, plaid = red jacket with dark bands (rings + a vertical stripe)
  const m = npcBody(
    PALETTE.truckRed,
    COLORS.PLAYER_SKIN,
    PALETTE.rubber,
    (g, topY) => {
      for (const y of [0.32, 0.56]) g.add(torusRing(0.302, 0.022, PALETTE.rubber, BASE_Y + y - HIP));
      const stripe = mesh(geo.box(0.04, 0.62, 0.04), toon(PALETTE.rubber));
      stripe.position.set(0, BASE_Y + 0.4 - HIP, 0.29);
      const stripeL = mesh(geo.box(0.04, 0.62, 0.04), toon(PALETTE.rubber));
      stripeL.position.set(-0.19, BASE_Y + 0.4 - HIP, 0.235);
      const stripeR = mesh(geo.box(0.04, 0.62, 0.04), toon(PALETTE.rubber));
      stripeR.position.set(0.19, BASE_Y + 0.4 - HIP, 0.235);
      g.add(stripe, stripeL, stripeR, torusRing(0.29, 0.045, PALETTE.rubber, topY - 0.03 - HIP));
    },
    (g) => {
      const beard = mesh(geo.sphere(0.22, 14, 10), toon(COLORS.CRATE_STRIP));
      beard.scale.set(1, 0.55, 0.65);
      beard.position.set(0, -0.12, 0.13);
      const dome = mesh(geo.sphere(0.25, 16, 10), toon(PALETTE.rubber));
      dome.scale.set(1, 0.78, 1);
      dome.position.y = 0.11;
      const cuff = mesh(geo.torus(0.23, 0.045, 8, 18), toon(PALETTE.truckRed));
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = 0.085;
      g.add(beard, dome, cuff);
    },
    PALETTE.truckRed,
  );
  m.height = m.headY + 0.11 + 0.25 * 0.78;
  return m;
}

// ---------------------------------------------------------------------------
// Axe
// ---------------------------------------------------------------------------

/** Axe look per upgrade level (0–5): plain wood + iron, then steel with a red handle, then gold. */
const AXE_STYLES = [
  { handle: COLORS.LOG_BARK, head: 0x6f7b7c, knob: COLORS.LOG_BARK },
  { handle: COLORS.LOG_BARK, head: 0x8a9697, knob: COLORS.LOG_BARK },
  { handle: PALETTE.truckRed, head: 0xc9d3d6, knob: PALETTE.truckRed },
  { handle: PALETTE.truckRed, head: 0xe9f1f3, knob: 0xe9f1f3 },
  { handle: PALETTE.barkDark, head: 0xf2b92a, knob: 0xf2b92a },
  { handle: PALETTE.barkDark, head: COLORS.COURIER_YELLOW, knob: COLORS.COURIER_YELLOW },
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
  const handle = mesh(geo.cylinder(0.032, 0.038, 0.78, 8), toon(st.handle));
  handle.position.y = -0.3;
  // wedge = triangular prism (3 radial segments); apex = cutting edge toward -Z
  const head = mesh(geo.cylinder(0.19, 0.19, 0.3, 3), toon(st.head));
  const grow = 1 + 0.07 * lv;
  head.rotation.y = Math.PI;
  head.scale.set(0.5 * grow, grow, grow);
  head.position.set(0, -0.6, -0.03);
  const knob = mesh(geo.sphere(0.048, 8, 6), toon(st.knob));
  knob.position.y = 0.1;
  const body = new THREE.Group();
  body.add(handle, head, knob);
  g.add(bake(body, { name: 'axe' }));
  return g;
}

export const characterCatalog: Record<string, () => THREE.Object3D> = {
  player: () => createPlayerModel().root,
  customer: () => createCustomerModel(0).root,
  'customer (green scarf variant)': () => createCustomerModel(7).root,
  'customer (light variant)': () => createCustomerModel(2).root,
  'customer (VIP)': () => createCustomerModel(VIP_VARIANT_BASE).root,
  courier: () => createCourierModel().root,
  driver: () => createDriverModel(0).root,
  'driver (grey)': () => createDriverModel(1).root,
  'worker: crate runner': () => createWorkerModel(0).root,
  'worker: porter': () => createWorkerModel(PORTER_VARIANT).root,
  'worker: cashier': () => createWorkerModel(1).root,
  'worker: log hauler': () => createWorkerModel(2).root,
  'axe (lv 0, wood + iron)': () => createAxe(0),
  'axe (lv 2, steel)': () => createAxe(2),
  'axe (lv 4, gold)': () => createAxe(4),
};
