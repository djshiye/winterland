/**
 * 0.9.8 brief 12: the crews. One CharacterModel per era outfit and crew role, built on the shared toy body of
 * assets/characters.ts so CharacterRig animates them like every other character (6 baked meshes each, plus one shared
 * tool mesh in the hand).
 *
 * Outfits, each built around the era's resource (R36): 1 Survival woodsman (buffalo-check flannel, knit beanie),
 * 2 Frontier quarryman (brick shirt, leather apron, flat cap), 3 Iron Age miner (dusty jacket, helmet with a lamp),
 * 4 Steam stoker (rust shirt, braces, brass goggles on the cap), 5 Industrial steelworker (bib overalls, hard hat),
 * 6 Electric lineman (teal shirt, tool belt, copper badge), 7 Oil roughneck (honey coveralls, reflective bands),
 * 8 Computer technician (cream clean-room smock, hood, glasses), 9 Nuclear atom tech (mint suit, bubble hood),
 * 10 AI era helper robot (cream shell, screen face, antenna).
 *
 * Roles (config ERA_ROLES) read at play zoom by three things that stay the same in every era (V6):
 * - the HAT is the role's colour (the shop icons already show it there); the all-round hauler wears a plain cream or
 *   brown one, never a role colour;
 * - a TOOL in the right hand: feeder a scoop shovel, shipper a signal flag, gatherer a basket, foreman a mallet, clerk a
 *   ledger (porter and hauler keep their hands free for loads); it is hidden while the arms carry;
 * - something worn: the hauler's sack and the porter's big rucksack on the back, the shipper's satchel, the foreman's
 *   whistle and brave brows, the clerk's round glasses and bow tie; everyone but the hauler and clerk wears the role
 *   scarf.
 * Each role also has its own work / idle motion (CharacterModel.motion, played by CharacterRig).
 *
 * `variant` varies skin, hair and the face. Every model is listed in `eraWorkerCatalog` (gallery: --query
 * gallery=eraWorkers). Baked meshes cannot be emissive, so "glow" (the miner's lamp, the robot's eyes) is a very
 * bright flat colour. Era colours come from render/palette.ts.
 */
import * as THREE from 'three';
import { CAMERA, ERA_ROLES } from '../config';
import { CharacterRig } from '../render/characters';
import { bake, vcMat } from '../render/batch';
import { geo, mesh, toon } from '../render/materials';
import { CREAM, GOLD, INK, SNOW, mixHex, palette } from '../render/palette';
import {
  BASE_Y,
  CHARACTER_HIP_Y as HIP,
  CLOTH,
  CREW_ROLE_KIT,
  arcGeometry,
  MAT,
  NPC_BODY_H as BH,
  NPC_BODY_R as BR,
  NPC_HEAD_R as R,
  PORTER_VARIANT,
  SKIN_TONES,
  VIP_VARIANT_BASE,
  WORKER_ROLES,
  beanRadius,
  beanie,
  belt,
  buildPawn,
  characterScale,
  createCourierModel,
  createCustomerModel,
  createDriverModel,
  createPlayerModel,
  flatCap,
  fringe,
  hardHat,
  hash,
  neckScarf,
  torusRing,
  type CharacterModel,
  type Expression,
  type WorkMotion,
} from './characters';

/** Uniform scale a rig of this era / variant should use (crowd variety, same ±6 % as the other workers). */
export function eraWorkerScale(era: number, variant: number): number {
  return characterScale(variant + 400 + era * 17);
}

const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh => {
  const m = mesh(geo.box(w, h, d), toon(color));
  m.position.set(x, y, z);
  return m;
};

const sphere = (r: number, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.Mesh => {
  const m = mesh(geo.sphere(r, 12, 9), toon(color));
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
};

const cyl = (r: number, h: number, color: number, x: number, y: number, z: number, seg = 12): THREE.Mesh => {
  const m = mesh(geo.cylinder(r, r, h, seg), toon(color));
  m.position.set(x, y, z);
  return m;
};

/** Body-local y of a height fraction of the torso. */
const ty = (f: number): number => BASE_Y + BH * f - HIP;
/** Front surface z of the torso at a height fraction. */
const fz = (f: number): number => BR * beanRadius(f);

const panelCache = new Map<string, THREE.BufferGeometry>();
/**
 * A curved panel hugging the bean torso between height fractions f0..f1, `arc` radians wide, centred on the front
 * (+Z, turned by `yaw`): aprons, bibs, braces, check stripes. Sits `out` metres off the coat.
 */
function wrap(color: number, f0: number, f1: number, arc: number, out = 0.012, yaw = 0): THREE.Mesh {
  const k = `${f0}|${f1}|${arc}|${out}`;
  let g = panelCache.get(k);
  if (!g) {
    g = new THREE.CylinderGeometry(BR * beanRadius(f1) + out, BR * beanRadius(f0) + out, BH * (f1 - f0), 14, 1, true, -arc / 2, arc);
    panelCache.set(k, g);
  }
  const m = mesh(g, toon(color));
  m.position.y = ty((f0 + f1) / 2);
  m.rotation.y = yaw;
  return m;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

type ToolId = 'shovel' | 'flag' | 'basket' | 'mallet' | 'ledger';
type Worn = 'sack' | 'rucksack' | 'satchel' | 'pouch' | 'whistle' | 'apron' | 'bowtie';

interface RoleKit {
  tool: ToolId | null;
  worn: Worn;
  motion: WorkMotion;
  scarf: boolean;
  expr: Expression;
}

/** The role kits (hauler = the all-round hauler of 0.9.0; the rest are config ERA_ROLES). */
export const ROLE_KITS: Record<string, RoleKit> = {
  hauler: { tool: null, worn: 'sack', motion: 'dust', scarf: false, expr: 'content' },
  feeder: { tool: 'shovel', worn: 'apron', motion: 'shovel', scarf: true, expr: 'smile' },
  shipper: { tool: 'flag', worn: 'satchel', motion: 'flag', scarf: true, expr: 'grin' },
  porter: { tool: null, worn: 'rucksack', motion: 'heave', scarf: true, expr: 'calm' },
  gatherer: { tool: 'basket', worn: 'pouch', motion: 'gather', scarf: true, expr: 'content' },
  foreman: { tool: 'mallet', worn: 'whistle', motion: 'hammer', scarf: true, expr: 'brave' },
  clerk: { tool: 'ledger', worn: 'bowtie', motion: 'ledger', scarf: false, expr: 'smile' },
};

/** Role colour (hat, scarf, tool trim) per role; null = the era's own hat colour (the hauler). */
export const ROLE_COLOR: Record<string, number | null> = { hauler: null, ...Object.fromEntries(ERA_ROLES.map((r) => [r.role, r.scarf])) };
/** 0.9.5 name kept: scarf colour per crew role (the hauler wears none). */
export const ROLE_SCARF = ROLE_COLOR;

const toolCache = new Map<string, THREE.BufferGeometry>();

/**
 * The tool in the right hand: one baked mesh shared by every worker of that role (one instanced draw call scene-wide),
 * in hand space (origin = the mitten, -Y = along the arm away from the shoulder, +Z = forward).
 */
function createTool(id: ToolId, color: number): THREE.Mesh {
  const key = `${id}|${color}`;
  let geometry = toolCache.get(key);
  if (!geometry) {
    const g = new THREE.Group();
    switch (id) {
      case 'shovel': {
        g.add(cyl(0.022, 0.24, MAT.wood, 0, -0.04, 0.02, 8));
        g.add(cyl(0.034, 0.07, color, 0, 0.02, 0.02, 10)); // grip wrap
        const blade = new THREE.Group();
        blade.position.set(0, -0.2, 0.04);
        blade.rotation.x = 0.35;
        blade.add(box(0.15, 0.12, 0.03, MAT.steel, 0, 0, 0), sphere(0.075, MAT.steel, 0, -0.06, 0, 1, 0.45, 0.2));
        blade.add(box(0.15, 0.025, 0.05, color, 0, 0.06, 0)); // collar
        g.add(blade);
        break;
      }
      case 'flag': {
        const pole = new THREE.Group();
        pole.rotation.x = 0.85;
        pole.add(cyl(0.016, 0.5, MAT.wood, 0, 0.2, 0, 8), sphere(0.03, GOLD, 0, 0.46, 0));
        const pennant = mesh(geo.cylinder(0.12, 0.12, 0.02, 3), toon(color));
        pennant.rotation.set(0, 0, Math.PI / 2);
        pennant.scale.set(1, 1, 1.25);
        pennant.position.set(0, 0.34, 0.1);
        pole.add(pennant);
        g.add(pole);
        break;
      }
      case 'basket': {
        g.add(cyl(0.13, 0.13, MAT.woodLight, 0, -0.17, 0.02, 12));
        g.add(torusRing(0.13, 0.022, MAT.wood, -0.105).translateZ(0.02));
        const handle = mesh(geo.torus(0.11, 0.016, 5, 12), toon(MAT.wood));
        handle.position.set(0, -0.105, 0.02);
        handle.rotation.y = Math.PI / 2;
        g.add(handle);
        for (const [x, z, c] of [[-0.05, 0.0, color], [0.05, 0.05, CLOTH.mustard], [0.02, -0.04, CLOTH.brick]] as const) g.add(sphere(0.05, c, x, -0.09, z + 0.02));
        break;
      }
      case 'mallet': {
        g.add(cyl(0.022, 0.26, MAT.wood, 0, -0.08, 0, 8));
        const head = cyl(0.068, 0.2, MAT.woodLight, 0, -0.22, 0.02, 12);
        head.rotation.x = Math.PI / 2;
        g.add(head);
        for (const z of [-0.06, 0.1]) {
          const band = cyl(0.072, 0.025, color, 0, -0.22, z, 12);
          band.rotation.x = Math.PI / 2;
          g.add(band);
        }
        break;
      }
      case 'ledger':
        g.add(box(0.06, 0.25, 0.19, color, 0.02, -0.1, 0.03));
        g.add(box(0.05, 0.23, 0.17, CREAM, 0.02, -0.1, 0.035)); // the page block shows at the edges
        g.add(box(0.064, 0.04, 0.192, mixHex(color, INK, 0.25), 0.02, 0.0, 0.03)); // spine band
        g.add(cyl(0.012, 0.2, GOLD, 0.06, -0.08, 0.13, 6).rotateX(0.2)); // pencil
        break;
    }
    const baked = bake(g, { name: `tool:${id}` });
    geometry = baked.geometry;
    toolCache.set(key, geometry);
  }
  const m = new THREE.Mesh(geometry, vcMat());
  m.name = `tool:${id}`;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Worn role extras on the torso (body-local). */
function wearRole(g: THREE.Group, topY: number, kit: RoleKit, color: number): void {
  switch (kit.worn) {
    case 'sack': {
      const sack = CLOTH.oat;
      g.add(sphere(0.2, sack, 0, ty(0.5), -fz(0.5) - 0.08, 1, 1.15, 0.72));
      g.add(sphere(0.07, mixHex(sack, INK, 0.2), 0, ty(0.86), -fz(0.6) - 0.08, 1.2, 0.8, 1)); // the tied neck
      for (const sx of [-1, 1]) g.add(box(0.04, 0.5, 0.03, MAT.leather, sx * 0.13, ty(0.55), fz(0.55) + 0.005).rotateZ(sx * 0.05));
      break;
    }
    case 'rucksack': {
      const bag = mixHex(MAT.leather, CLOTH.oat, 0.35);
      g.add(box(0.42, 0.42, 0.2, bag, 0, ty(0.5), -fz(0.5) - 0.09));
      g.add(sphere(0.22, bag, 0, ty(0.72), -fz(0.5) - 0.09, 0.98, 0.35, 0.5)); // rounded top flap
      const roll = cyl(0.08, 0.46, color, 0, ty(0.97), -fz(0.6) - 0.08, 12);
      roll.rotation.z = Math.PI / 2;
      g.add(roll);
      g.add(box(0.2, 0.12, 0.05, mixHex(bag, INK, 0.15), 0, ty(0.35), -fz(0.4) - 0.2)); // side pocket
      for (const sx of [-1, 1]) g.add(box(0.045, 0.5, 0.03, MAT.leather, sx * 0.13, ty(0.55), fz(0.55) + 0.005));
      break;
    }
    case 'satchel': {
      g.add(box(0.05, 0.66, 0.035, MAT.leather, 0.0, ty(0.55), fz(0.55) + 0.01).rotateZ(-0.62));
      g.add(box(0.13, 0.2, 0.26, MAT.leather, -BR * 1.0, ty(0.3), 0.04));
      g.add(box(0.14, 0.09, 0.27, color, -BR * 1.0, ty(0.43), 0.04)); // flap
      break;
    }
    case 'pouch':
      belt(g, BR, MAT.leather, MAT.brass, 0.25);
      g.add(box(0.13, 0.13, 0.08, mixHex(color, MAT.leather, 0.45), BR * 0.62, ty(0.2), fz(0.2) - 0.02).rotateY(0.6));
      break;
    case 'whistle':
      belt(g, BR, MAT.leather, MAT.brass, 0.25);
      g.add(box(0.025, 0.24, 0.02, color, 0.0, ty(0.72), fz(0.72) + 0.012).rotateZ(0.08));
      g.add(cyl(0.025, 0.08, MAT.brass, 0.01, ty(0.56), fz(0.56) + 0.03, 8).rotateZ(Math.PI / 2));
      g.add(box(0.12, 0.12, 0.08, MAT.leather, -BR * 0.62, ty(0.2), fz(0.2) - 0.02).rotateY(-0.6)); // tool pouch
      break;
    case 'apron':
      g.add(wrap(mixHex(MAT.leather, CLOTH.cocoa, 0.5), 0.04, 0.5, 1.9, 0.014));
      g.add(box(0.14, 0.09, 0.03, color, 0.06, ty(0.32), fz(0.32) + 0.03)); // pocket
      break;
    case 'bowtie':
      for (const sx of [-1, 1]) g.add(sphere(0.06, color, sx * 0.055, topY - 0.09 - HIP, fz(0.88) + 0.02, 1, 0.75, 0.45).rotateZ(sx * 0.3));
      g.add(sphere(0.028, mixHex(color, INK, 0.2), 0, topY - 0.09 - HIP, fz(0.88) + 0.04));
      break;
  }
  if (kit.scarf) neckScarf(g, topY, BR, color, mixHex(color, CREAM, 0.55), kit.worn === 'whistle' ? -0.1 : 0.1);
}

// ---------------------------------------------------------------------------
// Era outfits
// ---------------------------------------------------------------------------

interface Dress {
  /** Role hat colour (the role's colour, or the era's own for the hauler). */
  hat: number;
  role: string;
  kit: RoleKit;
  variant: number;
  skin: number;
  hair: number;
}

interface Outfit {
  coat: number;
  arm?: number;
  cuff?: number;
  hand: number;
  boot: number;
  bootCuff?: number;
  /** Hat colour of the hauler (the era's own). */
  hat: number;
  torso?: (g: THREE.Group, topY: number, d: Dress) => void;
  /** Hair and hat; returns the top height above the head centre. Return false as `face` to skip the face (robot). */
  head: (g: THREE.Group, d: Dress) => number;
  face?: boolean;
  /** Skin override (the robot's shell). */
  skin?: number;
}

const p = palette;
const lighten = (c: number, t: number): number => mixHex(c, CREAM, t);

/** Beards on some faces (the hauler and foreman of eras 1-4, by variant). */
function beard(g: THREE.Group, color: number): void {
  const b = sphere(R * 0.82, color, 0, -R * 0.42, R * 0.38, 1.05, 0.62, 0.62);
  g.add(b);
  for (const sx of [-1, 1]) g.add(sphere(R * 0.17, color, sx * R * 0.16, -R * 0.24, R * 0.86, 1.35, 0.6, 0.6));
}

const OUTFITS: Record<number, Outfit> = {
  // 1 Survival: the forest and the log. Buffalo-check flannel, knit beanie, fur-cuffed boots.
  1: {
    coat: lighten(p(1).accent, 0.08),
    hand: MAT.leather,
    boot: MAT.boot,
    bootCuff: CLOTH.cream,
    cuff: mixHex(p(1).accent, INK, 0.45),
    hat: CLOTH.cocoa,
    torso: (g, topY) => {
      // buffalo check: two soft dark bands round the coat and two down the front
      const check = mixHex(p(1).accent, INK, 0.3);
      for (const f of [0.3, 0.62]) g.add(torusRing(BR * beanRadius(f) + 0.004, 0.034, check, ty(f)));
      for (const a of [-0.38, 0.38, Math.PI - 0.38, Math.PI + 0.38]) g.add(wrap(check, 0.05, 0.86, 0.2, 0.004, a));
      g.add(torusRing(BR * 0.74, 0.05, CLOTH.cream, topY - 0.05 - HIP)); // thermal collar
    },
    head: (g, d) => {
      fringe(g, R, d.hair);
      if ((d.role === 'hauler' || d.role === 'foreman') && d.variant % 2 === 0) beard(g, d.hair);
      return beanie(g, R, d.hat, mixHex(d.hat, INK, 0.12), CLOTH.cream);
    },
  },
  // 2 Frontier: stone and clay. Rolled brick shirt, leather apron, flat cap.
  2: {
    coat: lighten(p(2).coat, 0.18),
    hand: lighten(p(2).body, 0.2),
    boot: MAT.boot,
    cuff: CLOTH.oat,
    hat: lighten(p(2).body, 0.3),
    torso: (g) => {
      const leather = mixHex(MAT.leather, CLOTH.cocoa, 0.4);
      g.add(wrap(leather, 0.02, 0.62, 1.7, 0.012));
      for (const sx of [-1, 1]) g.add(box(0.045, 0.3, 0.035, leather, sx * 0.12, ty(0.76), fz(0.76) - 0.01).rotateZ(sx * 0.12));
      g.add(box(0.13, 0.1, 0.03, mixHex(leather, INK, 0.2), -0.08, ty(0.24), fz(0.24) + 0.03)); // chisel pocket
      g.add(box(0.025, 0.12, 0.025, MAT.steel, -0.05, ty(0.31), fz(0.31) + 0.04)); // chisel
    },
    head: (g, d) => {
      fringe(g, R, d.hair);
      if (d.role === 'foreman' && d.variant % 2 === 0) beard(g, d.hair);
      return flatCap(g, R, d.hat, mixHex(d.hat, INK, 0.2));
    },
  },
  // 3 Iron Age: ore. Dusty jacket, round helmet with a lamp, leather belt.
  3: {
    coat: lighten(p(3).coat, 0.22),
    hand: mixHex(p(3).trim, CREAM, 0.25),
    boot: MAT.boot,
    cuff: lighten(p(3).body, 0.2),
    hat: CREAM,
    torso: (g, topY) => {
      belt(g, BR, MAT.leather, MAT.brass, 0.24);
      g.add(box(0.13, 0.12, 0.04, mixHex(p(3).coat, INK, 0.1), -0.12, ty(0.58), fz(0.58))); // patch pocket
      g.add(torusRing(BR * 0.74, 0.045, lighten(p(3).body, 0.2), topY - 0.05 - HIP)); // collar
    },
    head: (g, d) => {
      fringe(g, R, d.hair);
      if (d.role === 'hauler' && d.variant % 2 === 0) beard(g, d.hair);
      const top = hardHat(g, R, d.hat, true);
      // the helmet lamp: a bracket and a bright cream lens (reads lit at night)
      g.add(box(R * 0.42, R * 0.34, R * 0.25, MAT.leather, 0, R * 0.78, R * 0.92));
      g.add(sphere(R * 0.16, 0xfff1b8, 0, R * 0.78, R * 1.05, 1, 1, 0.55));
      return top;
    },
  },
  // 4 Steam Age: coal and brass. A slate waistcoat with brass buttons over a rolled oat shirt, a railway cap with a
  // brass badge and goggles riding on the peak.
  4: {
    coat: lighten(p(4).trim, 0.32),
    arm: CLOTH.oat,
    hand: lighten(p(4).coat, 0.25),
    boot: MAT.boot,
    cuff: lighten(CLOTH.oat, 0.3),
    hat: lighten(p(4).trim, 0.12),
    torso: (g, topY, d) => {
      g.add(wrap(CLOTH.oat, 0.62, 0.92, 0.7, 0.006)); // shirt front in the waistcoat's V
      for (const f of [0.22, 0.36, 0.5]) g.add(sphere(0.026, MAT.brass, 0, ty(f), fz(f) + 0.012));
      g.add(box(0.03, 0.12, 0.02, MAT.brass, 0.1, ty(0.42), fz(0.42) + 0.01).rotateZ(1.2)); // watch chain
      if (!d.kit.scarf) g.add(torusRing(BR * 0.76, 0.055, p(4).accent, topY - 0.05 - HIP)); // neckerchief
    },
    head: (g, d) => {
      fringe(g, R, d.hair);
      if (d.role === 'hauler' && d.variant % 2 === 1) beard(g, d.hair);
      // railway cap: a straight crown, a flat top, a shiny peak and a brass badge
      g.add(cyl(R * 1.0, R * 0.55, d.hat, 0, R * 0.62, -R * 0.02, 20));
      g.add(cyl(R * 1.06, R * 0.1, d.hat, 0, R * 0.92, -R * 0.02, 20));
      g.add(cyl(R * 1.03, R * 0.12, mixHex(d.hat, INK, 0.25), 0, R * 0.42, -R * 0.02, 20)); // band
      const peak = cyl(R * 0.6, R * 0.07, mixHex(p(4).trim, INK, 0.1), 0, R * 0.4, R * 0.88, 16);
      peak.scale.set(1.2, 1, 0.75);
      g.add(peak, box(R * 0.24, R * 0.2, R * 0.06, MAT.brass, 0, R * 0.62, R * 1.0));
      // brass goggles on the crown
      for (const sx of [-1, 1]) {
        const rim = cyl(R * 0.2, R * 0.12, MAT.brass, sx * R * 0.34, R * 0.98, R * 0.45, 14);
        rim.rotation.x = -0.9;
        g.add(rim, sphere(R * 0.14, CLOTH.mint, sx * R * 0.34, R * 1.02, R * 0.5, 1, 0.5, 1));
      }
      return R * 1.05;
    },
  },
  // 5 Industrial: iron pellets and coke. Bib overalls over light sleeves, hard hat.
  5: {
    coat: lighten(p(5).coat, 0.18),
    arm: lighten(p(5).body, 0.55),
    hand: lighten(p(5).trim, 0.15),
    boot: MAT.boot,
    hat: CREAM,
    torso: (g, topY) => {
      const bib = lighten(p(5).coat, 0.05);
      g.add(wrap(bib, 0.42, 0.8, 1.3, 0.01));
      g.add(box(0.12, 0.08, 0.03, lighten(p(5).coat, 0.35), 0.05, ty(0.6), fz(0.6) + 0.025));
      for (const sx of [-1, 1]) g.add(sphere(0.025, MAT.brass, sx * 0.12, ty(0.7), fz(0.7) + 0.02));
      g.add(torusRing(BR * 0.74, 0.045, lighten(p(5).body, 0.55), topY - 0.05 - HIP)); // light collar
      g.add(torusRing(BR * 0.97, 0.03, p(5).accent, ty(0.05))); // orange hem stripe
    },
    head: (g, d) => {
      fringe(g, R, d.hair);
      return hardHat(g, R, d.hat, true);
    },
  },
  // 6 Electric: copper. Teal work shirt, tool belt with pouches, a copper badge.
  6: {
    coat: lighten(p(6).coat, 0.18),
    hand: lighten(p(6).accent, 0.1),
    boot: MAT.boot,
    cuff: lighten(p(6).coat, 0.45),
    hat: CREAM,
    torso: (g) => {
      belt(g, BR, MAT.leather, MAT.brass, 0.22);
      for (const sx of [-1, 1]) g.add(box(0.11, 0.15, 0.08, mixHex(MAT.leather, INK, 0.1), sx * 0.2, ty(0.18), fz(0.18) - 0.05).rotateY(sx * 0.6));
      g.add(torusRing(BR * beanRadius(0.52) + 0.004, 0.026, GOLD, ty(0.52))); // hi-vis stripe
      const badge = cyl(0.05, 0.02, p(6).accent, -0.12, ty(0.64), fz(0.64) + 0.01, 12);
      badge.rotation.x = Math.PI / 2;
      g.add(badge);
    },
    head: (g, d) => {
      fringe(g, R, d.hair);
      const top = hardHat(g, R, d.hat, false);
      // a little copper lightning badge on the front of the hat
      g.add(box(R * 0.14, R * 0.34, R * 0.06, p(6).accent, 0, R * 0.62, R * 1.0).rotateZ(0.4));
      return top;
    },
  },
  // 7 Oil: crude and honey. Honey coveralls with reflective bands, hard hat.
  7: {
    coat: lighten(p(7).coat, 0.12),
    hand: lighten(p(7).trim, 0.2),
    boot: MAT.boot,
    hat: CREAM,
    torso: (g, topY) => {
      for (const f of [0.3, 0.52]) g.add(torusRing(BR * beanRadius(f) + 0.004, 0.03, CLOTH.cream, ty(f)));
      g.add(torusRing(BR * 0.74, 0.045, lighten(p(7).trim, 0.25), topY - 0.05 - HIP));
      g.add(box(0.12, 0.1, 0.04, mixHex(p(7).coat, INK, 0.2), -0.12, ty(0.68), fz(0.68)));
    },
    head: (g, d) => {
      fringe(g, R, d.hair);
      return hardHat(g, R, d.hat, true);
    },
  },
  // 8 Computer: silicon. Cream clean-room smock with a zip, a soft hood in the role colour, round glasses.
  8: {
    coat: lighten(p(8).body, 0.35),
    hand: lighten(p(8).accent, 0.25),
    boot: lighten(p(8).trim, 0.55),
    cuff: lighten(p(8).accent, 0.3),
    hat: lighten(p(8).trim, 0.55),
    torso: (g, topY) => {
      g.add(box(0.04, BH * 0.7, 0.035, lighten(p(8).trim, 0.5), 0, ty(0.42), fz(0.42) + 0.005)); // zip
      g.add(box(0.11, 0.07, 0.03, p(8).glow, -0.12, ty(0.66), fz(0.66) + 0.01)); // screen-mint badge
      g.add(torusRing(BR * 0.74, 0.045, lighten(p(8).accent, 0.4), topY - 0.05 - HIP));
    },
    head: (g, d) => {
      g.add(sphere(R * 1.16, d.hat, 0, R * 0.12, -R * 0.2, 1, 1, 0.98));
      g.add(sphere(R * 1.18, lighten(d.hat, 0.35), 0, R * 0.12, -R * 0.2, 1.0, 0.18, 1.0)); // seam band
      fringe(g, R, d.hair);
      glasses(g, lighten(p(8).trim, 0.15));
      return R * 1.3;
    },
  },
  // 9 Nuclear: uranium. Mint suit with gold seams, a round bubble hood with a band in the role colour.
  9: {
    coat: lighten(p(9).coat, 0.3),
    hand: lighten(p(9).trim, 0.3),
    boot: lighten(p(9).trim, 0.25),
    cuff: GOLD,
    hat: CREAM,
    torso: (g, topY) => {
      g.add(torusRing(BR * beanRadius(0.22) + 0.004, 0.035, lighten(p(9).trim, 0.3), ty(0.22)));
      g.add(box(0.035, BH * 0.68, 0.03, GOLD, 0.15, ty(0.42), fz(0.42) - 0.01).rotateY(0.45)); // seam
      g.add(torusRing(BR * 0.74, 0.05, GOLD, topY - 0.05 - HIP));
      const disc = cyl(0.075, 0.02, lighten(p(9).trim, 0.15), -0.11, ty(0.6), fz(0.6) + 0.01, 14);
      disc.rotation.x = Math.PI / 2;
      const core = cyl(0.032, 0.03, p(9).glow, -0.11, ty(0.6), fz(0.6) + 0.02, 10);
      core.rotation.x = Math.PI / 2;
      g.add(disc, core);
    },
    head: (g, d) => {
      const suit = lighten(p(9).coat, 0.3);
      g.add(sphere(R * 1.22, suit, 0, R * 0.1, -R * 0.24, 1, 1.02, 1));
      const ring = mesh(geo.torus(R * 0.8, R * 0.13, 8, 22), toon(d.hat)); // the bubble hood's face ring
      ring.position.set(0, R * 0.02, R * 0.72);
      g.add(ring);
      g.add(sphere(R * 0.2, lighten(p(9).trim, 0.4), 0, -R * 0.9, R * 0.5, 1.1, 0.7, 0.7)); // respirator, tucked under the chin
      return R * 1.32;
    },
  },
  // 10 AI: rare earths and fusion. A friendly helper robot: cream shell, screen face, antenna light in the role colour.
  10: {
    coat: p(10).body,
    arm: lighten(p(10).coat, 0.35),
    hand: p(10).accent,
    boot: lighten(p(10).trim, 0.2),
    hat: SNOW,
    face: false,
    skin: p(10).body,
    torso: (g, topY, d) => {
      const shell = p(10).body;
      const shade = lighten(p(10).coat, 0.35);
      g.add(sphere(0.36, shell, 0, ty(0.45), 0, 1, 1.0, 0.95)); // round belly shell
      g.add(torusRing(BR * 1.04, 0.04, shade, ty(0.08)));
      g.add(torusRing(BR * 0.8, 0.045, shade, topY - 0.06 - HIP));
      g.add(box(0.26, 0.18, 0.04, lighten(p(10).trim, 0.15), 0, ty(0.5), 0.34)); // chest screen
      g.add(box(0.2, 0.12, 0.03, d.hat, 0, ty(0.5), 0.365));
      for (const x of [-0.08, 0, 0.08]) g.add(sphere(0.025, p(10).accent, x, ty(0.25), 0.33));
    },
    head: (g, d) => {
      const shell = p(10).body;
      const screen = lighten(p(10).trim, 0.12);
      g.add(sphere(R * 1.12, shell, 0, 0, 0, 1.08, 0.98, 1));
      const face = sphere(R * 0.9, screen, 0, -R * 0.02, R * 0.58, 1.1, 0.78, 0.72);
      g.add(face);
      // happy screen eyes and smile in the sun-gold glow
      for (const sx of [-1, 1]) g.add(sphere(R * 0.15, p(10).glow, sx * R * 0.34, R * 0.06, R * 1.2, 0.9, 1.15, 0.4));
      const smile = mesh(arcGeometry(R * 0.17, R * 0.05), toon(p(10).glow));
      smile.position.set(0, -R * 0.16, R * 1.2);
      smile.rotation.z = Math.PI;
      g.add(smile);
      for (const sx of [-1, 1]) {
        const ear = cyl(R * 0.26, R * 0.2, p(10).accent, sx * R * 1.18, 0, 0, 14);
        ear.rotation.z = Math.PI / 2;
        g.add(ear);
      }
      g.add(cyl(R * 0.05, R * 0.5, lighten(p(10).coat, 0.35), 0, R * 1.3, 0, 6));
      g.add(sphere(R * 0.2, d.hat, 0, R * 1.62, 0));
      return R * 1.82;
    },
  },
};

/** Round glasses on a head (head-local). */
function glasses(g: THREE.Group, frame: number): void {
  for (const sx of [-1, 1]) {
    const rim = mesh(geo.torus(R * 0.17, R * 0.035, 5, 14), toon(frame));
    rim.position.set(sx * R * 0.36, -R * 0.02, R * 0.95);
    rim.rotation.y = sx * 0.3;
    g.add(rim);
  }
  g.add(box(R * 0.2, R * 0.04, R * 0.04, frame, 0, R * 0.02, R * 1.0));
}

const HAIRS = [MAT.hairBrown, MAT.hairGinger, MAT.hairDark, MAT.hairGrey, MAT.hairBrown] as const;
const EXPR_VARIETY: readonly Expression[] = ['smile', 'content', 'grin'];

/**
 * The outfit of era `era` (1..10; anything else gets the Frontier quarryman) in crew role `role` (config ERA_ROLES, or
 * 'hauler'). `variant` varies skin, hair and the face.
 */
export function createEraWorkerModel(era: number, variant = 0, role = 'hauler'): CharacterModel {
  const outfit = OUTFITS[era] ?? OUTFITS[2]!;
  const kit = ROLE_KITS[role] ?? ROLE_KITS.hauler!;
  const roleColor = ROLE_COLOR[role] ?? null;
  const v = ((variant % 997) + 997) % 997;
  const dress: Dress = {
    hat: roleColor ?? outfit.hat,
    role,
    kit,
    variant: v,
    skin: outfit.skin ?? SKIN_TONES[hash(v + era * 13) % 3]!,
    hair: HAIRS[(v + era) % HAIRS.length]!,
  };
  // the foreman and the clerk keep their role face; the others vary a little per worker
  const expr = role === 'foreman' || role === 'clerk' || v % 2 === 0 ? kit.expr : EXPR_VARIETY[v % EXPR_VARIETY.length]!;
  let top = R;
  const m = buildPawn({
    bodyColor: outfit.coat,
    armColor: outfit.arm,
    cuff: outfit.cuff,
    bodyR: BR,
    bodyH: BH,
    headR: R,
    skin: dress.skin,
    hand: outfit.hand,
    boot: outfit.boot,
    bootCuff: outfit.bootCuff,
    carryZ: 0.4,
    face: { expr, brows: role === 'foreman' ? dress.hair : null },
    torsoExtras: (g, topY) => {
      outfit.torso?.(g, topY, dress);
      if (roleColor !== null || kit.worn === 'sack') wearRole(g, topY, kit, dress.hat);
    },
    headExtras: (g) => {
      top = outfit.head(g, dress);
      if (role === 'clerk' && era !== 8 && era !== 10) glasses(g, lighten(MAT.leather, 0.1));
      if (role === 'foreman' && era !== 10 && era !== 9) {
        for (const sx of [-1, 1]) g.add(sphere(R * 0.15, dress.hair, sx * R * 0.13, -R * 0.2, R * 0.93, 1.35, 0.55, 0.6)); // moustache
      }
      return outfit.face !== false;
    },
  });
  m.height = m.headY + top;
  m.motion = kit.motion;
  if (kit.tool) {
    const tool = createTool(kit.tool, dress.hat);
    m.handR.add(tool);
    m.tool = tool;
  }
  return m;
}

/** An era-1 crew member: `role` is a crew id (crateRunner, cashier, ...) or a legacy variant 0..2 / porter (3+). */
export function createWorkerModel(variant = 0, role?: string): CharacterModel {
  const id = role ?? (variant >= PORTER_VARIANT ? 'porter' : WORKER_ROLES[((variant % 3) + 3) % 3]!);
  return createEraWorkerModel(1, variant, CREW_ROLE_KIT[id] ?? 'hauler');
}

const NAMES: Record<number, string> = {
  1: 'Survival woodsman',
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

const ROLE_ORDER = ['hauler', ...ERA_ROLES.map((r) => r.role)] as const;

export const eraWorkerCatalog: Record<string, () => THREE.Object3D> = {};
for (let n = 1; n <= 10; n++) eraWorkerCatalog[`era ${n}: ${NAMES[n]}`] = () => createEraWorkerModel(n, 0).root;

/** One era's seven roles side by side (hauler, then the six ERA_ROLES). */
function crewRow(era: number): THREE.Group {
  const row = new THREE.Group();
  ROLE_ORDER.forEach((role, i) => {
    const m = createEraWorkerModel(era, i, role).root;
    m.position.x = (i - 3) * 1.0;
    row.add(m);
  });
  return row;
}
for (let n = 1; n <= 10; n++) eraWorkerCatalog[`era ${n}: seven crew roles`] = () => crewRow(n);

/** All ten crews, one row per era (the one-click review: --query "gallery=all crews"). */
eraWorkerCatalog['all crews'] = () => {
  const g = new THREE.Group();
  for (let n = 1; n <= 10; n++) {
    const row = crewRow(n);
    row.position.z = (n - 5.5) * 1.25;
    g.add(row);
  }
  return g;
};

/**
 * The release-notes group photo (--query "gallery=cast&zoom=2.1"): the player up front, the village folk and a VIP
 * either side, the courier and both drivers behind, and three rows of crews (eras 1, 5 and 10) at the back, packed
 * close so the characters fill the frame.
 */
eraWorkerCatalog['cast'] = () => {
  const g = new THREE.Group();
  // laid out in screen terms (x right, z toward the camera), then turned to the camera's yaw so the rows run level
  g.rotation.y = THREE.MathUtils.degToRad(CAMERA.yawDeg);
  const put = (o: THREE.Object3D, x: number, z: number, yaw = 0): void => {
    o.position.set(x, 0, z);
    o.rotation.y = yaw;
    g.add(o);
  };
  put(createPlayerModel().root, 0, 1.2);
  put(createCustomerModel(0).root, -1.0, 0.9, 0.25);
  put(createCustomerModel(1).root, 1.0, 0.9, -0.25);
  put(createCustomerModel(2).root, -2.0, 0.5, 0.35);
  put(createCustomerModel(VIP_VARIANT_BASE).root, 2.0, 0.5, -0.35);
  put(createCourierModel().root, -1.4, -0.2);
  put(createDriverModel(0).root, 0, -0.1);
  put(createDriverModel(1).root, 1.4, -0.2);
  [1, 5, 10].forEach((era, k) => {
    const row = crewRow(era);
    row.scale.setScalar(0.9);
    row.position.z = -1.2 - k * 1.0;
    row.position.x = k % 2 === 0 ? 0 : 0.45;
    g.add(row);
  });
  return g;
};

/** All ten outfits in a row (--query "gallery=era workers lineup"). */
eraWorkerCatalog['era workers lineup'] = () => {
  const row = new THREE.Group();
  for (let n = 1; n <= 10; n++) {
    const m = createEraWorkerModel(n, 0).root;
    m.position.x = (n - 5.5) * 1.1;
    row.add(m);
  }
  return row;
};


/**
 * The crews in motion (gallery review of the work / walk / carry cycles): each role works its station motion, then
 * walks in place, then carries, on a loop (`userData.galleryAnimate`, see debug/Gallery.ts).
 */
function crewInMotion(era: number): THREE.Group {
  const row = new THREE.Group();
  const rigs = ROLE_ORDER.map((role, i) => {
    const rig = new CharacterRig(createEraWorkerModel(era, i, role));
    rig.root.position.x = (i - 3) * 1.0;
    row.add(rig.root);
    return rig;
  });
  let t = 0;
  row.userData.galleryAnimate = (dt: number): void => {
    t += dt;
    const phase = Math.floor(t / 3) % 3;
    for (const rig of rigs) {
      rig.setWorking(phase === 0);
      rig.setCarrying(phase === 2);
      rig.animate(dt, phase === 1 ? 0.7 : 0);
    }
  };
  return row;
}
for (let n = 1; n <= 10; n++) eraWorkerCatalog[`era ${n}: crew at work`] = () => crewInMotion(n);
