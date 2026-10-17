/**
 * [0.9.0 — assets] Jack's swap cart and Jack himself (npc/Jack.ts).
 *
 * The cart (createJackCartModel) faces local +Z, origin on the ground at the cart centre; footprint ~2.1 (X) × 1.1 (Z)
 * without the shafts. A painted wooden hand-cart with a striped awning, a heap of odds and ends, a hanging bell and a
 * hand-painted "JACK'S SWAPS" board. Three meshes (the sign is textured, the bell swings, so they cannot merge):
 *   body — wheels, cart, counter, posts, striped awning, heap, hanging pots, sign board: one vertex-coloured mesh
 *   sign — the canvas-painted lettering plane (unlit)
 *   bell — the animated pivot (npc/Jack.ts rings it when Jack buys)
 *
 * Jack (createJackModel) is a CharacterModel for render/characters CharacterRig: a patched coat, a mustard top hat
 * with a red band and a big ginger moustache (torso + head + 2 arms + 2 boots = 6 baked meshes).
 *
 * Every model this file makes is also listed in `jackCatalog` (shown by the ?gallery page: --query gallery=jack).
 */
import * as THREE from 'three';
import { Batch, bake } from '../render/batch';
import { GAME_FONT, basic, geo, makeCanvasTexture, mesh, toon } from '../render/materials';
import { BASE_Y, CHARACTER_HIP_Y, NPC_BODY_H, NPC_BODY_R, NPC_HEAD_R, SKIN_TONES, beanRadius, buildPawn, type CharacterModel } from './characters';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const RED = 0xd8432f;
const CREAM = 0xf3e6c8;
const GREEN = 0x2f9d6a;
const YELLOW = 0xf2c23a;
const BLUE = 0x3f86c8;
const WOOD = 0xb98450;
const WOOD_L = 0xd9a86a;
const WOOD_D = 0x6b4226;
const IRON = 0x3b3f47;
const GOLD = 0xe8b53a;
const COAT = 0x2f7f86;
const COAT_D = 0x276a70;
const GINGER = 0x9a4a1f;

// ---------------------------------------------------------------------------
// The cart
// ---------------------------------------------------------------------------

export interface JackCartModel {
  /** Local frame: origin on the ground at the cart centre, the front (counter side) faces +Z. */
  readonly root: THREE.Group;
  /** The bell pivot (child of root); rotate about Z to ring it. */
  readonly bell: THREE.Object3D;
  /** Where swapped goods land (on the counter, local). */
  readonly heap: THREE.Vector3;
  /** Footprint half extents (local X / Z) for the collider. */
  readonly halfW: number;
  readonly halfD: number;
}

const HALF_W = 1.05;
const HALF_D = 0.55;
const COUNTER_Y = 0.93;
const STRIPES = 8;
const STRIPE_W = 0.25;

/** The hand-painted board: a cream plate with a red frame, lettering and two coins. Unlit, so it stays readable at night. */
let signMat: THREE.Material | null = null;
function signMaterial(): THREE.Material {
  if (signMat) return signMat;
  if (typeof document === 'undefined') return (signMat = toon(CREAM)); // node (unit tests): no canvas
  const { canvas, ctx, texture } = makeCanvasTexture(512, 128);
  ctx.fillStyle = '#f6ead0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#d8432f';
  ctx.lineWidth = 10;
  ctx.strokeRect(7, 7, canvas.width - 14, canvas.height - 14);
  ctx.strokeStyle = '#2f9d6a';
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 64;
  ctx.font = `800 ${size}px ${GAME_FONT}`;
  while (size > 24 && ctx.measureText("JACK'S SWAPS").width > canvas.width - 120) {
    size -= 4;
    ctx.font = `800 ${size}px ${GAME_FONT}`;
  }
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#f6ead0';
  ctx.strokeText("JACK'S SWAPS", canvas.width / 2, canvas.height / 2 + 4);
  ctx.fillStyle = '#a8321f';
  ctx.fillText("JACK'S SWAPS", canvas.width / 2, canvas.height / 2 + 4);
  for (const x of [46, canvas.width - 46]) {
    ctx.fillStyle = '#e8b53a';
    ctx.beginPath();
    ctx.arc(x, canvas.height / 2, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b8862a';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  signMat = basic(0xffffff, { map: texture });
  return signMat;
}

function addWheel(b: Batch, sx: number): void {
  const x = sx * 0.98;
  const y = 0.4;
  const z = -0.05;
  b.add(geo.cylinder(0.36, 0.36, 0.08, 16), WOOD_L, x, y, z, { rz: Math.PI / 2 });
  b.add(geo.torus(0.38, 0.045, 6, 18), RED, x, y, z, { ry: Math.PI / 2 });
  b.add(geo.cylinder(0.1, 0.1, 0.14, 8), GOLD, x, y, z, { rz: Math.PI / 2 });
  for (let k = 0; k < 3; k++) b.add(geo.box(0.11, 0.7, 0.06), WOOD_D, x, y, z, { rx: (k * Math.PI) / 3 });
}

/** The cart model. */
export function createJackCartModel(): JackCartModel {
  const b = new Batch();

  for (const sx of [-1, 1]) addWheel(b, sx);

  // body: painted green box with a yellow front panel and a plank counter
  b.add(geo.box(1.7, 0.5, 0.9), GREEN, 0, 0.65, 0);
  b.add(geo.box(1.5, 0.3, 0.03), YELLOW, 0, 0.65, 0.455);
  b.add(geo.box(1.76, 0.06, 1.04), WOOD_L, 0, COUNTER_Y, 0);
  b.add(geo.box(1.76, 0.1, 0.06), WOOD_D, 0, 0.45, 0.45); // front skirt
  // pull shafts + crossbar at the back
  for (const sx of [-1, 1]) b.add(geo.box(0.07, 0.07, 1.15), WOOD, sx * 0.55, 0.5, -0.95, { rx: 0.12 });
  b.add(geo.box(1.2, 0.07, 0.07), WOOD, 0, 0.39, -1.5);
  // a crate seat for the stack of swaps on the left of the cart's back
  b.add(geo.box(0.34, 0.3, 0.34), WOOD, -0.6, 0.15, -0.8);

  // awning posts (front ones shorter: the roof slopes toward the customer)
  for (const sx of [-1, 1]) {
    b.add(geo.cylinder(0.035, 0.035, 1.12, 6), WOOD_D, sx * 0.88, 1.49, -0.4);
    b.add(geo.cylinder(0.035, 0.035, 0.87, 6), WOOD_D, sx * 0.88, 1.365, 0.4);
  }
  // striped awning: 8 tilted slats alternating red / cream, a scalloped valance along the front edge
  const slope = Math.atan2(0.32, 1.5);
  for (let i = 0; i < STRIPES; i++) {
    const x = (i - (STRIPES - 1) / 2) * STRIPE_W;
    const c = i % 2 === 0 ? RED : CREAM;
    b.add(geo.box(STRIPE_W, 0.05, 1.534), c, x, 1.94, 0.2, { rx: slope });
    b.add(geo.box(STRIPE_W, 0.12, 0.04), c, x, 1.7, 0.96);
    b.add(geo.cone(STRIPE_W / 2, 0.1, 6), c, x, 1.59, 0.96, { rz: Math.PI });
  }

  // the heap of odds and ends on the back half of the counter
  b.add(geo.box(0.3, 0.12, 0.2), WOOD_D, -0.62, 1.02, -0.28, { ry: 0.3 }); // boot
  b.add(geo.box(0.12, 0.22, 0.14), WOOD_D, -0.5, 1.07, -0.3, { ry: 0.3 });
  b.add(geo.sphere(0.15, 8, 6), BLUE, -0.2, 1.08, -0.3); // teapot
  b.add(geo.cone(0.04, 0.16, 5), BLUE, -0.04, 1.08, -0.3, { rz: -1.1 }); // spout
  b.add(geo.sphere(0.05, 6, 4), YELLOW, -0.2, 1.25, -0.3); // lid knob
  b.add(geo.cylinder(0.14, 0.14, 0.5, 10), RED, 0.22, 1.06, -0.3, { rz: Math.PI / 2 }); // rolled rug
  b.add(geo.cylinder(0.145, 0.145, 0.06, 10), CREAM, 0.22, 1.06, -0.3, { rz: Math.PI / 2, sx: 1, sy: 1.0 });
  b.add(geo.box(0.26, 0.26, 0.26), WOOD, 0.62, 1.09, -0.28, { ry: 0.25 }); // little crate
  b.add(geo.box(0.22, 0.05, 0.16), YELLOW, 0.62, 1.25, -0.28, { ry: -0.3 }); // books on top
  b.add(geo.cylinder(0.07, 0.07, 0.18, 8), IRON, -0.8, 1.05, -0.05); // lantern
  b.add(geo.cone(0.09, 0.08, 8), IRON, -0.8, 1.18, -0.05);
  b.add(geo.sphere(0.06, 6, 4), YELLOW, -0.8, 1.05, -0.05);
  // hanging pots and a ladle under the back of the awning
  for (const [x, c] of [[-0.55, IRON], [0.0, GOLD], [0.5, BLUE]] as const) {
    b.add(geo.cylinder(0.008, 0.008, 0.3, 4), WOOD_D, x, 1.82, -0.45);
    b.add(geo.cylinder(0.1, 0.07, 0.12, 8), c, x, 1.6, -0.45);
  }

  // the sign board on top of the awning (back plate; the lettering plane is its own mesh)
  b.add(geo.box(1.5, 0.4, 0.05), WOOD_D, 0, 2.38, -0.52);
  for (const sx of [-1, 1]) b.add(geo.box(0.06, 0.4, 0.06), WOOD_D, sx * 0.62, 2.2, -0.52);

  const body = b.mesh({ cast: true, receive: true });
  body.name = 'jackCart';

  const sign = new THREE.Mesh(geo.plane(1.42, 0.355), signMaterial());
  sign.position.set(0, 2.38, -0.488);
  sign.name = 'jackSign';
  sign.castShadow = false;
  sign.receiveShadow = false;

  // the bell: a pivot under the awning's front-right, bell hangs below it
  const bellPivot = new THREE.Group();
  bellPivot.position.set(0.55, 1.8, 0.62);
  const bellG = new THREE.Group();
  const cord = mesh(geo.cylinder(0.01, 0.01, 0.12, 4), toon(WOOD_D));
  cord.position.y = -0.06;
  const dome = mesh(geo.cylinder(0.05, 0.115, 0.15, 10), toon(GOLD));
  dome.position.y = -0.2;
  const lip = mesh(geo.cylinder(0.12, 0.12, 0.025, 10), toon(GOLD));
  lip.position.y = -0.28;
  const clapper = mesh(geo.sphere(0.03, 6, 4), toon(WOOD_D));
  clapper.position.y = -0.3;
  bellG.add(cord, dome, lip, clapper);
  const bell = bake(bellG, { cast: false, receive: false, name: 'jackBell' });
  bellPivot.add(bell);

  const root = new THREE.Group();
  root.name = 'jackCartModel';
  root.add(body, sign, bellPivot);
  return { root, bell: bellPivot, heap: new THREE.Vector3(0, COUNTER_Y + 0.12, 0.2), halfW: HALF_W, halfD: HALF_D };
}

// ---------------------------------------------------------------------------
// Jack
// ---------------------------------------------------------------------------

const HIP = CHARACTER_HIP_Y;
const BODY_R = NPC_BODY_R + 0.01;
const BODY_H = NPC_BODY_H + 0.04;
const HEAD_R = NPC_HEAD_R;

function torusRing(major: number, tube: number, color: number, y: number): THREE.Mesh {
  const t = mesh(geo.torus(major, tube, 8, 22), toon(color));
  t.rotation.x = Math.PI / 2;
  t.position.y = y;
  return t;
}

/** Patched coat parts in torso-local space: a belt with a gold buckle, a scarf and four mismatched patches. */
function coatExtras(g: THREE.Group, topY: number): void {
  const beltF = 0.42;
  g.add(torusRing(BODY_R * beanRadius(beltF) + 0.01, 0.05, WOOD_D, BASE_Y + BODY_H * beltF - HIP)); // belt
  const buckle = mesh(geo.box(0.12, 0.1, 0.05), toon(GOLD));
  buckle.position.set(0, BASE_Y + BODY_H * beltF - HIP, BODY_R * beanRadius(beltF) + 0.04);
  g.add(buckle);
  g.add(torusRing(BODY_R * 0.78, 0.07, RED, topY - 0.06 - HIP)); // scarf
  const patches: Array<[number, number, number, number]> = [
    [0.15, 0.2, YELLOW, 0.1],
    [-0.14, 0.55, CREAM, -0.2],
    [0.18, 0.62, RED, 0.3],
    [-0.16, 0.14, BLUE, 0.15],
  ];
  for (const [x, yy, c, rz] of patches) {
    const p = mesh(geo.box(0.13, 0.13, 0.04), toon(c));
    const rr = BODY_R * beanRadius(yy / BODY_H);
    const z = Math.sqrt(Math.max(0.0, rr * rr - x * x)) + 0.005;
    p.position.set(x, BASE_Y + yy - HIP, z);
    p.rotation.set(0, Math.atan2(x, z), rz);
    g.add(p);
  }
}

/** Head parts in head-local space: nose, a big curly ginger moustache, a mustard top hat with a red band. */
function headExtras(g: THREE.Group): void {
  const nose = mesh(geo.sphere(0.06, 8, 6), toon(0xe59a7e));
  nose.position.set(0, -0.06, HEAD_R - 0.005);
  g.add(nose);
  const must = toon(GINGER);
  for (const sx of [-1, 1]) {
    const m = mesh(geo.sphere(0.12, 10, 8), must);
    m.scale.set(1.45, 0.55, 0.8);
    m.position.set(sx * 0.12, -0.12, HEAD_R - 0.035);
    m.rotation.z = -sx * 0.35;
    const curl = mesh(geo.sphere(0.035, 6, 5), must);
    curl.position.set(sx * 0.27, -0.06, HEAD_R - 0.08);
    g.add(m, curl);
  }
  const hat = toon(YELLOW);
  const brim = mesh(geo.cylinder(0.36, 0.36, 0.045, 20), hat);
  brim.position.y = 0.13;
  const crown = mesh(geo.cylinder(0.22, 0.24, 0.34, 20), hat);
  crown.position.y = 0.32;
  const band = mesh(geo.cylinder(0.245, 0.245, 0.08, 20), toon(RED));
  band.position.y = 0.19;
  const flower = mesh(geo.sphere(0.06, 7, 5), toon(CREAM));
  flower.position.set(0.2, 0.21, 0.12);
  g.add(brim, crown, band, flower);
}

/**
 * Jack: the shared toy body of assets/characters.ts (0.9.8: bean coat, face with a grin and rosy cheeks) in his patched
 * teal coat, ready for `new CharacterRig(model)`.
 */
export function createJackModel(): CharacterModel {
  const m = buildPawn({
    bodyColor: COAT,
    armColor: COAT_D,
    cuff: CREAM,
    bodyR: BODY_R,
    bodyH: BODY_H,
    headR: HEAD_R,
    skin: SKIN_TONES[0]!,
    hand: CREAM,
    boot: WOOD_D,
    carryZ: 0.4,
    face: { expr: 'grin', brows: GINGER },
    torsoExtras: coatExtras,
    headExtras,
  });
  m.height = m.headY + 0.5;
  return m;
}

/** Gallery entries: the cart alone, Jack alone and the two together. */
export const jackCatalog: Record<string, () => THREE.Object3D> = {
  jackCart: () => createJackCartModel().root,
  jack: () => createJackModel().root,
  jackStall: () => {
    const g = new THREE.Group();
    g.add(createJackCartModel().root);
    const j = createJackModel().root;
    j.position.set(-1.5, 0, 0.45);
    j.rotation.y = 0.5;
    g.add(j);
    return g;
  },
};
