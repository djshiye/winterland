/**
 * 0.9.0 era workers (npc/EraCrew.ts): one CharacterModel per era outfit, built on the shared "pawn" skeleton of
 * assets/characters.ts so CharacterRig animates them like every other character (6 baked meshes each: no extra draw
 * calls). Outfits: 2 Frontier quarryman, 3 Iron Age miner, 4 Steam stoker, 5 Industrial steelworker, 6 Electric
 * lineman, 7 Oil roughneck, 8 Computer technician, 9 Nuclear atom tech, 10 AI era robot. `variant` only varies the
 * skin tone. Every model is also listed in `eraWorkerCatalog` (gallery: --query gallery=eraWorkers).
 *
 * Baked meshes cannot be emissive, so "glow" (the miner's lamp, the robot's eyes) is a very bright flat colour.
 */
import * as THREE from 'three';
import { COLORS } from '../config';
import { geo, mesh, toon } from '../render/materials';
import {
  BASE_Y,
  CHARACTER_HIP_Y as HIP,
  buildPawn,
  characterScale,
  npcBody,
  torusRing,
  type CharacterModel,
  type PawnSpec,
} from './characters';

const SKINS = [COLORS.PLAYER_SKIN, 0xdfae86, 0xa8744f] as const;

/** Uniform scale a rig of this era / variant should use (crowd variety, same ±6 % as the other workers). */
export function eraWorkerScale(era: number, variant: number): number {
  return characterScale(variant + 400 + era * 17);
}

type TorsoFn = NonNullable<PawnSpec['torsoExtras']>;
type HeadFn = NonNullable<PawnSpec['headExtras']>;

const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh => {
  const m = mesh(geo.box(w, h, d), toon(color));
  m.position.set(x, y, z);
  return m;
};

const sphere = (r: number, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.Mesh => {
  const m = mesh(geo.sphere(r, 14, 10), toon(color));
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
};

/** Hard hat / helmet: dome + front brim + a ridge along the top; returns the height of the top above the head centre. */
function hardHat(g: THREE.Group, color: number, ridge = true): number {
  const dome = sphere(0.255, color, 0, 0.1, 0, 1, 0.74, 1);
  const brim = box(0.38, 0.035, 0.17, color, 0, 0.075, 0.23);
  g.add(dome, brim);
  if (ridge) g.add(box(0.07, 0.04, 0.36, color, 0, 0.275, 0));
  return 0.31;
}

/** Torso y (body-local) of a height above the feet. */
const ty = (fromFeet: number): number => fromFeet - HIP;

/** A model built with the shared NPC pawn, with its top height set. */
function npc(
  body: number,
  skin: number,
  hand: number,
  torso: TorsoFn | undefined,
  head: HeadFn | undefined,
  top: number,
  arm?: number,
): CharacterModel {
  const m = npcBody(body, skin, hand, torso, head, arm);
  m.height = m.headY + top;
  return m;
}

// --- 2 Frontier: quarryman -- flat cap, rolled brick-red shirt, leather apron ----------------------------------------
function quarryman(skin: number): CharacterModel {
  const LEATHER = 0x7a5230;
  return npc(
    0xb5543c,
    skin,
    0x8a8077,
    (g) => {
      // leather apron over the front with two shoulder straps and a chisel pocket
      g.add(box(0.4, 0.5, 0.06, LEATHER, 0, ty(BASE_Y + 0.3), 0.27));
      g.add(box(0.05, 0.5, 0.05, LEATHER, -0.13, ty(BASE_Y + 0.6), 0.265).rotateZ(0.15));
      g.add(box(0.05, 0.5, 0.05, LEATHER, 0.13, ty(BASE_Y + 0.6), 0.265).rotateZ(-0.15));
      g.add(box(0.16, 0.12, 0.05, 0x5c3b22, 0, ty(BASE_Y + 0.22), 0.31));
      g.add(torusRing(0.292, 0.03, 0x5c3b22, ty(BASE_Y + 0.05)));
    },
    (g) => {
      // flat cap: wide squashed dome + short peak
      g.add(sphere(0.255, 0x6d5a48, 0, 0.1, -0.01, 1, 0.5, 1.02));
      g.add(box(0.3, 0.035, 0.15, 0x5a4a3b, 0, 0.075, 0.24));
      g.add(sphere(0.03, 0x5a4a3b, 0, 0.215, 0));
    },
    0.1 + 0.255 * 0.5 + 0.03,
  );
}

// --- 3 Iron Age: miner -- dusty jacket, round helmet with a lamp ----------------------------------------------------
function miner(skin: number): CharacterModel {
  return npc(
    0x6e5b4e,
    skin,
    0x3d3a3a,
    (g, topY) => {
      g.add(torusRing(0.304, 0.03, 0x3d3a3a, ty(BASE_Y + 0.25))); // leather belt
      g.add(box(0.1, 0.1, 0.06, 0xd9a441, 0.0, ty(BASE_Y + 0.25), 0.3)); // buckle
      g.add(box(0.16, 0.14, 0.05, 0x4a3b30, -0.14, ty(BASE_Y + 0.5), 0.285)); // patch pocket
      g.add(torusRing(0.285, 0.045, 0x3d3a3a, topY - 0.03 - HIP)); // collar
      // soot smudges
      g.add(sphere(0.07, 0x3a342f, 0.15, ty(BASE_Y + 0.42), 0.27, 1, 0.7, 0.4));
    },
    (g) => {
      const HELM = 0xd9a441;
      g.add(sphere(0.255, HELM, 0, 0.1, 0, 1, 0.78, 1));
      g.add(box(0.4, 0.035, 0.17, HELM, 0, 0.075, 0.23));
      g.add(box(0.07, 0.04, 0.36, 0x9a6f22, 0, 0.275, 0));
      // helmet lamp: bracket + a glowing front lens
      g.add(box(0.12, 0.1, 0.08, 0x3d3a3a, 0, 0.22, 0.25));
      g.add(box(0.085, 0.07, 0.03, 0xfff3b0, 0, 0.22, 0.3));
      g.add(sphere(0.045, 0xfff3b0, 0, 0.22, 0.285));
    },
    0.1 + 0.255 * 0.78 + 0.04,
  );
}

// --- 4 Steam Age: stoker -- sooty grey shirt, red neckerchief, goggles, flat cap --------------------------------
function stoker(skin: number): CharacterModel {
  return npc(
    0x44403f,
    skin,
    0x2b2f36,
    (g, topY) => {
      g.add(torusRing(0.282, 0.06, 0xb23a2e, topY - 0.02 - HIP)); // red neckerchief
      g.add(box(0.07, 0.12, 0.05, 0xb23a2e, 0, topY - 0.12 - HIP, 0.27)); // its knot
      for (const x of [-0.16, 0.16]) g.add(box(0.05, 0.6, 0.04, 0x2b2f36, x, ty(BASE_Y + 0.4), 0.285)); // braces
      g.add(sphere(0.09, 0x1f1d1d, -0.1, ty(BASE_Y + 0.22), 0.27, 1.2, 0.8, 0.4)); // soot
      g.add(sphere(0.07, 0x1f1d1d, 0.14, ty(BASE_Y + 0.46), 0.27, 1, 0.8, 0.4));
    },
    (g) => {
      g.add(sphere(0.25, 0x2f2b2b, 0, 0.1, -0.01, 1, 0.55, 1));
      g.add(box(0.3, 0.035, 0.14, 0x2f2b2b, 0, 0.07, 0.24));
      // goggles pushed up on the forehead: strap + two brass rimmed lenses
      g.add(torusRing(0.235, 0.025, 0x5a3b22, 0.045));
      for (const x of [-0.085, 0.085]) {
        const rim = mesh(geo.cylinder(0.06, 0.06, 0.05, 12), toon(0xb08a3e));
        rim.rotation.x = Math.PI / 2;
        rim.position.set(x, 0.07, 0.215);
        const lens = mesh(geo.cylinder(0.045, 0.045, 0.06, 12), toon(0x8fd0e0));
        lens.rotation.x = Math.PI / 2;
        lens.position.set(x, 0.07, 0.218);
        g.add(rim, lens);
      }
      g.add(sphere(0.05, 0x1f1d1d, 0.12, -0.04, 0.19, 1, 0.8, 0.4)); // soot on the cheek
    },
    0.1 + 0.25 * 0.55 + 0.03,
  );
}

// --- 5 Industrial: steelworker -- denim overalls over grey sleeves, orange hard hat ---------------------------------
function steelworker(skin: number): CharacterModel {
  return npc(
    0x35558a,
    skin,
    0x3a3a3a,
    (g, topY) => {
      g.add(box(0.3, 0.26, 0.05, 0x2b4670, 0, ty(BASE_Y + 0.55), 0.285)); // bib
      g.add(box(0.12, 0.09, 0.03, 0x4c6ea6, 0.05, ty(BASE_Y + 0.58), 0.315)); // bib pocket
      for (const x of [-0.14, 0.14]) g.add(box(0.06, 0.3, 0.05, 0x2b4670, x, topY - 0.1 - HIP, 0.26)); // straps
      g.add(torusRing(0.288, 0.05, 0xc9ced2, topY - 0.02 - HIP)); // grey collar
      g.add(torusRing(0.304, 0.03, 0xd0702a, ty(BASE_Y + 0.12))); // orange hem stripe
    },
    (g) => {
      hardHat(g, 0xd0702a);
    },
    0.1 + 0.255 * 0.74 + 0.05,
    0xb9bec2,
  );
}

// --- 6 Electric: lineman -- grey-green work shirt, tool belt with pouches, yellow hard hat -------------------------
function lineman(skin: number): CharacterModel {
  const BELT = 0x6b4a2b;
  return npc(
    0x5a6b74,
    skin,
    0xe0761e,
    (g, topY) => {
      g.add(torusRing(0.31, 0.045, BELT, ty(BASE_Y + 0.22))); // wide tool belt
      g.add(box(0.12, 0.17, 0.09, 0x4a3320, -0.2, ty(BASE_Y + 0.2), 0.22)); // pouches
      g.add(box(0.12, 0.17, 0.09, 0x4a3320, 0.2, ty(BASE_Y + 0.2), 0.22));
      g.add(box(0.04, 0.22, 0.04, 0xc9d3d6, 0.27, ty(BASE_Y + 0.15), 0.15)); // pliers handle
      g.add(torusRing(0.305, 0.03, 0xf2c230, ty(BASE_Y + 0.52))); // hi-vis stripe
      g.add(torusRing(0.285, 0.05, 0x2e4a5a, topY - 0.03 - HIP));
    },
    (g) => {
      hardHat(g, 0xf2c230);
    },
    0.1 + 0.255 * 0.74 + 0.05,
  );
}

// --- 7 Oil: roughneck -- red coveralls with reflective bands, white hard hat, dark gloves --------------------------
function roughneck(skin: number): CharacterModel {
  return npc(
    0xc8362c,
    skin,
    0x272a30,
    (g, topY) => {
      for (const y of [0.3, 0.5]) g.add(torusRing(0.304, 0.032, 0xe0b03a, ty(BASE_Y + y))); // reflective bands
      g.add(torusRing(0.285, 0.05, 0x272a30, topY - 0.03 - HIP)); // collar
      g.add(box(0.14, 0.12, 0.05, 0x9a2820, -0.13, ty(BASE_Y + 0.62), 0.285)); // chest pocket
      g.add(sphere(0.07, 0x2b2420, 0.12, ty(BASE_Y + 0.12), 0.27, 1.3, 0.8, 0.4)); // oil stain
    },
    (g) => {
      hardHat(g, 0xeeeae0);
      g.add(box(0.2, 0.06, 0.04, 0x272a30, 0, 0.19, 0.245)); // dark badge on the front
    },
    0.1 + 0.255 * 0.74 + 0.05,
    0xc8362c,
  );
}

// --- 8 Computer: technician -- white bunny suit: hood, face mask, blue gloves, white boots ------------------------
function technician(skin: number): CharacterModel {
  const WHITE = 0xf2f4f6;
  const m = buildPawn({
    bodyColor: WHITE,
    bodyR: 0.3,
    bodyH: 0.75,
    capsule: true,
    headR: 0.22,
    skin,
    hand: 0x3aa0d8,
    boot: 0xdfe6ec,
    carryZ: 0.4,
    torsoExtras: (g, topY) => {
      g.add(box(0.045, 0.62, 0.04, 0xcfd6dc, 0, ty(BASE_Y + 0.4), 0.3)); // zipper strip
      g.add(torusRing(0.288, 0.05, 0x3aa0d8, topY - 0.03 - HIP)); // blue collar
      g.add(box(0.1, 0.07, 0.03, 0x3aa0d8, -0.12, ty(BASE_Y + 0.58), 0.3)); // badge
    },
    headExtras: (g) => {
      // hood over hair and ears, face opening, blue mask below the eyes
      g.add(sphere(0.255, WHITE, 0, 0.04, -0.04, 1, 0.98, 1.0));
      g.add(box(0.36, 0.1, 0.05, 0x9fd6ee, 0, -0.085, 0.205)); // mask
      g.add(box(0.4, 0.045, 0.06, 0xcfd6dc, 0, 0.12, 0.2)); // hood trim over the brow
      g.add(box(0.3, 0.075, 0.04, 0x1d3550, 0, 0.0, 0.222)); // glasses
      for (const x of [-0.075, 0.075]) g.add(box(0.1, 0.055, 0.02, 0x9fd6ee, x, 0.0, 0.242));
    },
    armColor: WHITE,
  });
  m.height = m.headY + 0.04 + 0.255;
  return m;
}

// --- 9 Nuclear: atom tech -- yellow hazmat suit, dark visor, respirator, trefoil badge ----------------------------
function atomTech(skin: number): CharacterModel {
  const YELLOW = 0xf2d21a;
  const m = buildPawn({
    bodyColor: YELLOW,
    bodyR: 0.3,
    bodyH: 0.75,
    capsule: true,
    headR: 0.22,
    skin,
    hand: 0x2b2f36,
    boot: 0x2b2f36,
    carryZ: 0.4,
    torsoExtras: (g, topY) => {
      g.add(torusRing(0.305, 0.04, 0x2b2f36, ty(BASE_Y + 0.2))); // belt
      g.add(torusRing(0.288, 0.05, 0xd9b80a, topY - 0.03 - HIP));
      // radiation trefoil badge: black disc + yellow wedge ring is too small to read, a black disc with a yellow core is enough
      const disc = mesh(geo.cylinder(0.095, 0.095, 0.03, 14), toon(0x2b2f36));
      disc.rotation.x = Math.PI / 2;
      disc.position.set(0, ty(BASE_Y + 0.5), 0.3);
      const core = mesh(geo.cylinder(0.04, 0.04, 0.04, 10), toon(YELLOW));
      core.rotation.x = Math.PI / 2;
      core.position.set(0, ty(BASE_Y + 0.5), 0.305);
      g.add(disc, core);
      g.add(box(0.045, 0.62, 0.04, 0xd9b80a, 0.17, ty(BASE_Y + 0.38), 0.298)); // seam
    },
    headExtras: (g) => {
      // hood, dark visor with a faint green rim, grey respirator canister
      g.add(sphere(0.26, YELLOW, 0, 0.03, -0.03, 1, 1.0, 1.02));
      g.add(box(0.34, 0.15, 0.06, 0x2b3a3c, 0, 0.02, 0.2));
      g.add(box(0.31, 0.12, 0.03, 0x4a6a60, 0, 0.02, 0.232));
      g.add(box(0.1, 0.1, 0.1, 0x8a9697, 0, -0.1, 0.235));
      g.add(box(0.2, 0.025, 0.04, 0xd9b80a, 0, 0.115, 0.215));
    },
    armColor: YELLOW,
  });
  m.height = m.headY + 0.03 + 0.26;
  return m;
}

// --- 10 AI era: a friendly boxy robot ------------------------------------------------------------------------------
/**
 * Boxy robot: the pawn's capsule torso and sphere head hide inside a box torso / box head (so every rig hook works),
 * with an antenna, ear dials, glowing cyan eyes and chest panel. Skin is ignored.
 */
function robot(_skin: number): CharacterModel {
  const SHELL = 0xdfe6ec;
  const SHADE = 0x8c90b8;
  const GLOW = 0x74f2ff;
  const ACCENT = 0x9b6cff;
  const m = buildPawn({
    bodyColor: SHELL,
    bodyR: 0.3,
    bodyH: 0.75,
    capsule: true,
    headR: 0.22,
    skin: SHELL,
    hand: ACCENT,
    boot: 0x4a4f66,
    carryZ: 0.4,
    armColor: SHADE,
    torsoExtras: (g, topY) => {
      const mid = ty(BASE_Y + 0.39);
      g.add(box(0.63, 0.8, 0.63, SHELL, 0, mid, 0)); // swallows the capsule
      g.add(box(0.66, 0.08, 0.66, SHADE, 0, ty(BASE_Y + 0.04), 0)); // base plate
      g.add(box(0.66, 0.06, 0.66, SHADE, 0, topY - 0.01 - HIP, 0)); // shoulder plate
      g.add(box(0.34, 0.26, 0.04, 0x1f2240, 0, ty(BASE_Y + 0.46), 0.325)); // chest screen
      g.add(box(0.28, 0.2, 0.03, GLOW, 0, ty(BASE_Y + 0.46), 0.345));
      for (const x of [-0.09, 0, 0.09]) g.add(box(0.05, 0.05, 0.03, ACCENT, x, ty(BASE_Y + 0.22), 0.325)); // buttons
      for (const x of [-0.27, 0.27]) g.add(box(0.05, 0.05, 0.05, ACCENT, x, ty(BASE_Y + 0.7), 0.31)); // rivets
    },
    headExtras: (g) => {
      g.add(box(0.46, 0.4, 0.46, SHELL, 0, 0.0, 0)); // swallows the sphere
      g.add(box(0.38, 0.17, 0.04, 0x1f2240, 0, 0.03, 0.235)); // visor
      for (const x of [-0.085, 0.085]) g.add(box(0.1, 0.1, 0.03, GLOW, x, 0.03, 0.26)); // eyes
      g.add(box(0.14, 0.03, 0.03, GLOW, 0, -0.1, 0.24)); // smile
      for (const x of [-0.26, 0.26]) {
        const ear = mesh(geo.cylinder(0.07, 0.07, 0.07, 12), toon(ACCENT));
        ear.rotation.z = Math.PI / 2;
        ear.position.set(x, 0.0, 0);
        g.add(ear);
      }
      const stem = mesh(geo.cylinder(0.014, 0.014, 0.16, 6), toon(SHADE));
      stem.position.set(0, 0.28, 0);
      g.add(stem, sphere(0.045, GLOW, 0, 0.38, 0));
    },
  });
  m.height = m.headY + 0.43;
  return m;
}

const BUILDERS: Record<number, (skin: number) => CharacterModel> = {
  2: quarryman,
  3: miner,
  4: stoker,
  5: steelworker,
  6: lineman,
  7: roughneck,
  8: technician,
  9: atomTech,
  10: robot,
};

/** The outfit of era `era` (2..10; anything else gets the Frontier quarryman). `variant` shifts the skin tone. */
export function createEraWorkerModel(era: number, variant = 0): CharacterModel {
  const build = BUILDERS[era] ?? quarryman;
  return build(SKINS[((variant % SKINS.length) + SKINS.length) % SKINS.length]!);
}

const NAMES: Record<number, string> = {
  2: 'Frontier quarryman',
  3: 'Iron Age miner',
  4: 'Steam stoker',
  5: 'Industrial steelworker',
  6: 'Electric lineman',
  7: 'Oil roughneck',
  8: 'Computer technician',
  9: 'Nuclear atom tech',
  10: 'AI era robot',
};

export const eraWorkerCatalog: Record<string, () => THREE.Object3D> = {};
for (let n = 2; n <= 10; n++) eraWorkerCatalog[`era ${n}: ${NAMES[n]}`] = () => createEraWorkerModel(n, 0).root;
eraWorkerCatalog['era 2: quarryman (tan variant)'] = () => createEraWorkerModel(2, 1).root;
eraWorkerCatalog['era 5: steelworker (brown variant)'] = () => createEraWorkerModel(5, 2).root;

/** All nine outfits in a row (also the one-click review: --query "gallery=era workers lineup"). */
eraWorkerCatalog['era workers lineup'] = () => {
  const row = new THREE.Group();
  for (let n = 2; n <= 10; n++) {
    const m = createEraWorkerModel(n, 0).root;
    m.position.x = (n - 6) * 1.25;
    row.add(m);
  }
  return row;
};
