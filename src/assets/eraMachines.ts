/**
 * 0.9.0 era machine models (eras/data.ts MACHINES[id].style) plus the region's export depot and import dock.
 * Procedural, merged (render/batch.ts) and cached per id, so every slot of one machine shares GPU buffers.
 *
 * CONTRACT (eras/Machine.ts and eras/EraWorld.ts use it):
 * - Local frame: origin at floor centre, +Z = front (the side facing the front yard: the machine's input hopper sits
 *   front-left (−X), its output pile front-right (+X), both supplied by eras/Machine.ts, not part of the model).
 * - The solid part is centred on the origin and never exceeds 5.2 × 5.2 m, even with the animated part at any angle.
 *   `w` × `d` is the measured footprint of the model at rest (rounded up to 0.1 m). Height up to ~6 m.
 * - A machine is ≤ 3 meshes: the merged body, the merged glow (lit windows / furnace mouths / neon; the shared
 *   registered `eraGlowMaterial()`, so night lighting works with no caller code) and ONE animated pivot mesh named
 *   'pivot' (crane boom, flywheel, pumpjack beam, plasma ring, robot arm, smoke puff). `animate(dt, working)` runs the
 *   pivot at full speed while working and at a slow idle crawl otherwise. No allocation per frame.
 * - Depot / dock are plain Groups of ≤ 2 meshes (body + glow sign), ~3 × 2.4 m, static.
 * - Eras read distinct: timber + stone (2), rust iron (3), brick + brass (4), grey steel + orange (5), enamel teal +
 *   copper (6), honey yellow + crimson pipes (7), retro beige + sea teal + mint glow (8), porcelain + jade + sea-foam
 *   glow (9), cream + pewter slate + sun-gold (10). Eras 6–10 follow the palette table of docs/art/guide.md (ARGON).
 */
import * as THREE from 'three';
import type { MachineId } from '../eras/data';
import { ERAS, MACHINES, MACHINE_IDS } from '../eras/data';
import { vcMat } from '../render/batch';
import { MACHINE_SHADES } from '../render/palette';
import { ERA2_4_MACHINE_IDS, createEra2to4MachineModel } from './eraMachines2';
import { CLASSIC_MACHINE_IDS, createClassicMachineModel } from './eraMachinesClassic';
import { ERA5_7_MACHINE_IDS, createEra5to7MachineModel } from './eraMachines3';
import { ERA4_MACHINE_IDS, createEraMachine4 } from './eraMachines4';
import { TOY_MACHINE_IDS, createToyMachine } from './eraMachines6to10';
import { Kit, eraGlowMaterial, hcyl, pixelText, pixelTextWidth, type V3 } from './eraKit';

export interface MachineModel {
  root: THREE.Group;
  /** Footprint (metres) of the solid part, centred on the origin; ≤ slot cell − 2. */
  w: number;
  d: number;
  /** Advance animations (smoke, wheels, glow pulse); `working` = a cycle is running. */
  animate(dt: number, working: boolean): void;
  /**
   * 0.9.8: stack tops (model-local) that puff soft steam / smoke while the machine works (eras/Machine.ts emits the
   * puffs through the shared particle pool, comfort-scaled), and the puff colour.
   */
  vents?: readonly V3[];
  ventColor?: number;
}

// ---------------------------------------------------------------------------
// palette
// ---------------------------------------------------------------------------

const TIMBER = 0x8a6a46;
const TIMBER_D = 0x6d5a48;
const PLANK = 0xb4906a;
const IRON = 0x3d3a3a;
const IRON_L = 0x5d6268;
const BRASS = 0xb08a3e;
const STEEL_L = 0xb4bdc8;
const STEEL_D = 0x4b5562;
const CONCRETE = 0xb5b8bb;
const CONCRETE_D = 0x8d9195;
const COPPER = 0xc9773a;
// eras 6–10 machines live in assets/eraMachines6to10.ts; these tones remain for the depot / dock and era 5
const TEAL = 0x4c6b68;
const SEA = 0x45858c;

// glow tints (multiplied into the shared emissive material by vertex colour)
const G_WARM = 0xffd070;

const colors = (n: number) => ERAS[n]!.colors;

// ---------------------------------------------------------------------------
// recipe framework
// ---------------------------------------------------------------------------

interface Parts {
  body: Kit;
  glow: Kit;
  pivot: Kit;
}

/** The animated part: built around the origin of `pivot`, placed at `at`. Speeds are cycles per second. */
interface PivotSpec {
  at: V3;
  axis: 'x' | 'y' | 'z';
  /** spin = turn continuously; swing = sine rotation (±amp rad); slide = sine translation (±amp m); rise = loop upwards (amp m) while shrinking. */
  mode: 'spin' | 'swing' | 'slide' | 'rise';
  speed: number;
  amp?: number;
  /** Paint the pivot with the shared glow material instead of the toon vertex-colour one. */
  glow?: boolean;
}

type Recipe = (p: Parts) => PivotSpec | null;

interface Built {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
  pivot: THREE.BufferGeometry | null;
  spec: PivotSpec | null;
  w: number;
  d: number;
}

// eras 2-5: assets/eraMachinesClassic.ts (0.9.8)

// eras 6-10: assets/eraMachines6to10.ts (0.9.8)

/** 0.9.0 recipes (the 0.9.5 machines come from their own era files: OWN_MODELS below). */
const RECIPES: Partial<Record<MachineId, Recipe>> = {};

// ---------------------------------------------------------------------------
// building models from recipes
// ---------------------------------------------------------------------------

const builtCache = new Map<MachineId, Built>();

function build(id: MachineId): Built {
  let built = builtCache.get(id);
  if (built) return built;
  const parts: Parts = { body: new Kit(), glow: new Kit(), pivot: new Kit() };
  const spec = RECIPES[id]!(parts);
  const body = parts.body.geometry();
  const glow = parts.glow.batch.empty ? null : parts.glow.geometry();
  const pivot = spec && !parts.pivot.batch.empty ? parts.pivot.geometry() : null;
  const box = new THREE.Box3().copy(body.boundingBox!);
  if (glow) box.union(glow.boundingBox!);
  if (pivot && spec) box.union(pivot.boundingBox!.clone().translate(new THREE.Vector3(...spec.at)));
  const size = box.getSize(new THREE.Vector3());
  built = { body, glow, pivot, spec: pivot ? spec : null, w: Math.ceil(size.x * 10 - 1e-6) / 10, d: Math.ceil(size.z * 10 - 1e-6) / 10 };
  builtCache.set(id, built);
  return built;
}

/** Idle crawl as a share of the working speed. */
const IDLE = 0.12;

/** 0.9.5: machines whose models live in their era's own builder file. */
const OWN_MODELS: Partial<Record<MachineId, () => MachineModel>> = {
  // 0.9.8: the original era 2-5 machines, rebuilt as toys (assets/eraMachinesClassic.ts)
  ...Object.fromEntries(CLASSIC_MACHINE_IDS.map((id) => [id, () => createClassicMachineModel(id)])),
  // eras 2-4 (assets/eraMachines2.ts)
  ...Object.fromEntries(ERA2_4_MACHINE_IDS.map((id) => [id, () => createEra2to4MachineModel(id)])),
  // eras 5-7 (assets/eraMachines3.ts)
  ...Object.fromEntries(ERA5_7_MACHINE_IDS.map((id) => [id, () => createEra5to7MachineModel(id)])),
  // eras 8-10 (assets/eraMachines4.ts; the cash machines are not MachineIds)
  ...Object.fromEntries(ERA4_MACHINE_IDS.filter((id) => (MACHINE_IDS as string[]).includes(id)).map((id) => [id, () => createEraMachine4(id)])),
  // 0.9.8: every production machine of eras 6-10 (assets/eraMachines6to10.ts)
  ...Object.fromEntries(TOY_MACHINE_IDS.map((id) => [id, () => createToyMachine(id)])),
};

export function createMachineModel(id: MachineId): MachineModel {
  const own = OWN_MODELS[id];
  if (own) return own();
  const built = build(id);
  const root = new THREE.Group();
  root.name = `machine:${id}:${MACHINES[id].era}`;
  const bodyMesh = new THREE.Mesh(built.body, vcMat());
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyMesh.name = 'body';
  root.add(bodyMesh);
  if (built.glow) {
    const m = new THREE.Mesh(built.glow, eraGlowMaterial());
    m.name = 'glow';
    root.add(m);
  }
  let pivotMesh: THREE.Mesh | null = null;
  const spec = built.spec;
  if (built.pivot && spec) {
    pivotMesh = new THREE.Mesh(built.pivot, spec.glow ? eraGlowMaterial() : vcMat());
    pivotMesh.name = 'pivot';
    pivotMesh.castShadow = !spec.glow && spec.mode !== 'rise';
    pivotMesh.position.set(...spec.at);
    root.add(pivotMesh);
  }
  let phase = 0;
  let drive = IDLE;
  const animate = (dt: number, working: boolean): void => {
    if (!pivotMesh || !spec) return;
    drive += ((working ? 1 : IDLE) - drive) * Math.min(1, dt * 3);
    phase += dt * spec.speed * drive;
    const amp = spec.amp ?? 0;
    switch (spec.mode) {
      case 'spin':
        pivotMesh.rotation[spec.axis] = phase * Math.PI * 2;
        break;
      case 'swing':
        pivotMesh.rotation[spec.axis] = Math.sin(phase * Math.PI * 2) * amp;
        break;
      case 'slide':
        pivotMesh.position[spec.axis] = spec.at[spec.axis === 'x' ? 0 : spec.axis === 'y' ? 1 : 2] + Math.sin(phase * Math.PI * 2) * amp;
        break;
      case 'rise': {
        const f = phase - Math.floor(phase);
        pivotMesh.position.y = spec.at[1] + f * amp;
        pivotMesh.scale.setScalar(1 - 0.55 * f);
        break;
      }
    }
  };
  return { root, w: built.w, d: built.d, animate };
}

// ---------------------------------------------------------------------------
// depot + dock
// ---------------------------------------------------------------------------

/** Material tier of an era: 0 timber (2–3), 1 brick + iron (4–6), 2 steel + concrete (7–8), 3 white panel (9–10). */
function tier(era: number): 0 | 1 | 2 | 3 {
  return era <= 3 ? 0 : era <= 6 ? 1 : era <= 8 ? 2 : 3;
}

interface Skin {
  floor: number;
  post: number;
  board: number;
  trim: number;
  crate: number;
  crate2: number;
  sign: number;
}

function skin(era: number): Skin {
  const c = colors(era);
  switch (tier(era)) {
    case 0: return { floor: PLANK, post: TIMBER_D, board: era === 2 ? TIMBER : MACHINE_SHADES[3].timberD, trim: c.accent, crate: PLANK, crate2: TIMBER, sign: 0xffe8b0 };
    case 1: return { floor: era === 4 ? 0x7a7672 : CONCRETE_D, post: era === 4 ? MACHINE_SHADES[4].ironD : era === 5 ? MACHINE_SHADES[5].steelD : IRON, board: era === 6 ? TEAL : c.trim, trim: c.accent, crate: era === 6 ? COPPER : BRASS, crate2: STEEL_D, sign: era === 6 ? 0xfff2c0 : 0xffd98a };
    case 2: return { floor: CONCRETE, post: c.trim, board: c.trim, trim: c.accent, crate: c.body, crate2: era === 7 ? STEEL_L : SEA, sign: era === 7 ? 0xffe08a : 0xc8f5dc };
    default: return { floor: era === 9 ? 0xd2d8d8 : 0xe9e3d4, post: c.trim, board: c.trim, trim: c.accent, crate: c.accent, crate2: c.body, sign: era === 9 ? 0xc8fbef : 0xfff0c0 };
  }
}

const groupCache = new Map<string, { body: THREE.BufferGeometry; glow: THREE.BufferGeometry }>();

function signGlowColor(era: number): number {
  return tier(era) >= 2 ? colors(era).glow : G_WARM;
}

function assemble(key: string, era: number, make: (b: Kit, g: Kit, s: Skin) => void): THREE.Group {
  let geos = groupCache.get(key);
  if (!geos) {
    const b = new Kit();
    const g = new Kit();
    make(b, g, skin(era));
    geos = { body: b.geometry(), glow: g.geometry() };
    groupCache.set(key, geos);
  }
  const root = new THREE.Group();
  root.name = key;
  const body = new THREE.Mesh(geos.body, vcMat());
  body.castShadow = true;
  body.receiveShadow = true;
  const glow = new THREE.Mesh(geos.glow, eraGlowMaterial());
  root.add(body, glow);
  return root;
}

/** Sign board on two posts at z, with glowing pixel text. */
function signBoard(b: Kit, g: Kit, s: Skin, text: string, era: number, z: number, y: number): void {
  const px = 0.085;
  const w = pixelTextWidth(text, px) + 0.5;
  for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) b.box(s.post, 0.14, y, 0.14, x, 0, z);
  b.box(s.board, w, 0.72, 0.1, 0, y - 0.1, z);
  b.box(s.trim, w + 0.1, 0.07, 0.14, 0, y + 0.62, z);
  b.box(s.trim, w + 0.1, 0.07, 0.14, 0, y - 0.15, z);
  b.snow(0, y + 0.69, z, w + 0.1, 0.2, 0.09);
  pixelText(g, text, s.sign, px, 0, y + 0.02, z + 0.07, 0.05);
}

/** Export depot (freight dock where materials are sold), era-styled. Origin floor centre, +Z front. ~3 × 2.4 m. */
export function createDepotModel(era: number): THREE.Group {
  return assemble(`depot:${era}`, era, (b, g, s) => {
    const t = tier(era);
    // loading platform with a ramp
    b.box(s.floor, 3.0, 0.3, 1.5, 0, 0, -0.55);
    b.box(s.trim, 3.04, 0.06, 0.06, 0, 0.3, 0.2);
    b.box(s.floor, 1.4, 0.08, 0.95, 0, 0.11, 0.75, { rx: -0.3 });
    b.snow(-0.9, 0.3, -0.55, 1.1, 1.4, 0.06);
    // wheel stops / bollards
    for (const x of [-1.35, 1.35]) b.cyl(s.trim, 0.09, 0.4, x, 0.3, 0.1, 8);
    // cargo waiting for export (themed per tier)
    if (t === 0) {
      b.box(s.crate, 0.7, 0.5, 0.6, 0.8, 0.3, -0.5);
      b.box(s.crate2, 0.5, 0.45, 0.5, 0.75, 0.8, -0.5, { ry: 0.3 });
      for (let i = 0; i < 3; i++) hcyl(b, s.crate2, 0.17, 0.6, -0.9 + i * 0.36, 0.47, -0.2, 'z', 8);
    } else if (t === 1) {
      b.box(s.crate, 0.7, 0.55, 0.65, 0.8, 0.3, -0.5);
      b.cyl(s.crate2, 0.22, 0.6, -0.8, 0.3, -0.3, 10);
      b.cyl(s.crate2, 0.22, 0.6, -0.4, 0.3, -0.5, 10);
    } else if (t === 2) {
      b.box(s.crate, 0.9, 0.7, 0.8, 0.7, 0.3, -0.5);
      b.box(s.crate2, 0.8, 0.12, 0.8, -0.8, 0.3, -0.4);
      b.box(s.crate, 0.7, 0.6, 0.7, -0.8, 0.42, -0.4);
    } else {
      b.box(s.crate2, 0.9, 0.7, 0.8, 0.7, 0.3, -0.5);
      g.box(signGlowColor(era), 0.9, 0.05, 0.05, 0.7, 0.55, -0.09);
      b.box(s.crate, 0.7, 0.6, 0.7, -0.8, 0.3, -0.4);
      g.box(signGlowColor(era), 0.7, 0.05, 0.05, -0.8, 0.5, -0.04);
    }
    signBoard(b, g, s, 'EXPORT', era, -1.0, 1.55);
    // lamp
    b.beam(s.post, [1.35, 0.3, -1.0], [1.35, 1.6, -1.0], 0.1);
    g.sph(signGlowColor(era), 0.1, 1.35, 1.7, -1.0);
  });
}

/** Import dock (pallet bay where market orders arrive), era-styled. Origin floor centre, +Z front. ~3 × 2.4 m. */
export function createDockModel(era: number): THREE.Group {
  return assemble(`dock:${era}`, era, (b, g, s) => {
    const t = tier(era);
    b.box(s.floor, 3.0, 0.1, 2.0, 0, 0, 0.1);
    b.box(s.trim, 3.0, 0.06, 0.06, 0, 0.1, 1.1);
    // pallets with parcels
    for (const x of [-0.7, 0.55]) {
      for (let i = 0; i < 3; i++) b.box(PLANK, 0.9, 0.05, 0.22, x, 0.1 + 0.0, 0.5 + (i - 1) * 0.32);
      b.box(TIMBER_D, 0.9, 0.06, 0.9, x, 0.15, 0.5);
    }
    b.box(s.crate, 0.5, 0.4, 0.4, -0.7, 0.21, 0.5);
    b.box(s.crate2, 0.4, 0.3, 0.35, -0.65, 0.61, 0.5, { ry: 0.2 });
    if (t >= 2) {
      // roller conveyor into the bay, with status strip
      for (let i = 0; i < 5; i++) hcyl(b, STEEL_L, 0.07, 0.8, 1.15, 0.28, -0.2 + i * 0.3, 'x', 8);
      b.box(s.post, 0.1, 0.3, 1.4, 0.7, 0.1, 0.2);
      b.box(s.post, 0.1, 0.3, 1.4, 1.6, 0.1, 0.2);
      g.box(signGlowColor(era), 0.05, 0.05, 1.3, 0.7, 0.4, 0.2);
    } else {
      // jib crane with a hook
      b.beam(s.post, [1.2, 0.1, -0.3], [1.2, 2.1, -0.3], 0.16);
      b.beam(t === 0 ? TIMBER : IRON_L, [1.2, 2.0, -0.3], [-0.1, 2.0, 0.3], 0.12);
      b.beam(s.trim, [1.2, 1.1, -0.3], [0.6, 1.95, 0.0], 0.08);
      b.beam(IRON_L, [-0.0, 2.0, 0.3], [-0.0, 0.9, 0.3], 0.025);
      b.box(IRON, 0.14, 0.2, 0.14, 0.0, 0.72, 0.3);
      b.box(s.post, 0.5, 0.2, 0.5, 1.2, 0.1, -0.3);
      b.snow(1.2, 2.12, -0.3, 0.3, 0.3, 0.06);
    }
    signBoard(b, g, s, 'IMPORT', era, -0.95, 1.6);
  });
}

// ---------------------------------------------------------------------------
// gallery catalog (?gallery=eraMachines)
// ---------------------------------------------------------------------------

const catalog: Record<string, () => THREE.Object3D> = {};
for (const id of MACHINE_IDS) catalog[id] = () => createMachineModel(id).root;
for (const era of [2, 4, 6, 8, 10]) {
  catalog[`depot${era}`] = () => createDepotModel(era);
  catalog[`dock${era}`] = () => createDockModel(era);
}
export const eraMachineCatalog: Record<string, () => THREE.Object3D> = catalog;

// one review sheet per era (its machines in a row, then depot and dock): `?gallery=era5` or `?gallery=eraSheets`.
// Its own gallery domain, so the eraMachines row stays one model per cell.
const sheets: Record<string, () => THREE.Object3D> = {};
for (let era = 2; era <= 10; era++) {
  sheets[`era${era}`] = () => {
    const sheet = new THREE.Group();
    sheet.name = `era${era}`;
    let x = 0;
    for (const id of MACHINE_IDS) {
      if (MACHINES[id].era !== era) continue;
      const m = createMachineModel(id);
      m.root.position.x = x + 3.1;
      x += 6.4;
      sheet.add(m.root);
    }
    const depot = createDepotModel(era);
    depot.position.set(x + 1.8, 0, -0.6);
    const dock = createDockModel(era);
    dock.position.set(x + 1.8, 0, 2.2);
    sheet.add(depot, dock);
    return sheet;
  };
}
export const eraSheetCatalog: Record<string, () => THREE.Object3D> = sheets;
