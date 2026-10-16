/**
 * [MAIN] 0.9.0 "Ages": every data table for the ten eras, their materials, machines, regions, city districts and
 * buildings, the market (prices, trading, investments), taxes and Jack's swap cart. Pure data + pure helpers only:
 * no THREE, no GameContext. Shared contract — change only from the main session.
 *
 * Era numbering: era 1 = Survival = everything that existed before 0.9.0 (mill, ridge, village, Market Town; the old
 * village levels Camp … Winterland are now "settlement levels" inside Survival). Eras 2..10 = ERA_KEYS[n - 2]; each
 * is opened by paying its expansion pad (cash + the previous era's refined material) at its region's gate. Paying it
 * raises state.eras.age to n, opens the region (machine slots) and the city district of that era.
 */
import { ERA_KEYS, MATERIAL_KINDS, type EraKey, type MaterialKind } from '../core/kinds';
import type { ItemKind } from '../core/types';

export { ERA_KEYS, MATERIAL_KINDS, type EraKey, type MaterialKind };

/** Axis-aligned rectangle on the ground (same shape as config Rect; kept local so this file has no runtime imports). */
export interface ERect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
const R = (minX: number, maxX: number, minZ: number, maxZ: number): ERect => ({ minX, maxX, minZ, maxZ });

// ---------------------------------------------------------------------------
// Eras
// ---------------------------------------------------------------------------

export const MAX_ERA = 10;

/** Names of all ten eras, index = era number (index 0 unused). */
export const ERA_NAMES: readonly string[] = ['', 'Survival', 'Frontier', 'Iron Age', 'Steam Age', 'Industrial', 'Electric Age', 'Oil Age', 'Computer Age', 'Nuclear Power', 'AI Era'];

export interface EraDef {
  n: number;
  key: EraKey;
  name: string;
  /** One line for the era card / map. */
  tagline: string;
  /** The region's place name ("Granite Hollow"). */
  region: string;
  /** The era's worker (UPGRADES `${key}Crew`). */
  worker: { label: string; plural: string };
  /** City district name. */
  district: string;
  /**
   * Visual palette (hex), one row of the era table in docs/art/guide.md (ARGON): region ground, accent (machines /
   * signs), trim, fence, machine body, glow tint and worker coat. Builders may derive shades.
   */
  colors: { ground: number; accent: number; trim: number; fence: number; body: number; glow: number; coat: number };
  /** Expansion pad: cash + the previous era's refined material. */
  unlock: { cash: number; extra: { kind: ItemKind; count: number } };
  /** Shown on the era card. */
  perks: readonly string[];
}

/**
 * Era economy ×10 (docs/EXPANSION.md R11; config CLIMB.eraScale reads it): every era price and income (expansion pads,
 * machines, material values, city buildings and their income) is × this, so an era sits above Survival's last prices
 * (jack's last level is $750k). Survival numbers are untouched.
 */
export const ERA_SCALE = 10;

/** Expansion price of era n (2..10): 1.5M × 3^(n − 2) (150k × ERA_SCALE). */
export function unlockCash(n: number): number {
  return 150_000 * ERA_SCALE * 3 ** (n - 2);
}

function eraDef(n: number, key: EraKey, tagline: string, region: string, worker: [string, string], district: string, colors: EraDef['colors'], extra: { kind: ItemKind; count: number }, perks: string[]): EraDef {
  return { n, key, name: ERA_NAMES[n]!, tagline, region, worker: { label: worker[0], plural: worker[1] }, district, colors, unlock: { cash: unlockCash(n), extra }, perks };
}

/** ERAS[n] for n = 2..10 (indices 0 and 1 are null: Survival has no region). */
export const ERAS: readonly (EraDef | null)[] = [
  null,
  null,
  eraDef(2, 'frontier', 'Stone and brick: the settlement digs in', 'Granite Hollow', ['Quarryman', 'Quarrymen'], 'Brickside', { ground: 0xccd4de, accent: 0xb85239, trim: 0x5c4028, fence: 0x6e5a4f, body: 0x8c857b, glow: 0xffb347, coat: 0x8c4a32 }, { kind: 'crate', count: 40 }, ['Quarries and brick kilns', 'Quarrymen for hire', 'The Brickside district']),
  eraDef(3, 'iron', 'Ore in the hills, fire in the smelters', 'Iron Ridge', ['Miner', 'Miners'], 'Foundry Row', { ground: 0xd0d8e2, accent: 0x4a5559, trim: 0x2f3538, fence: 0x4f4c49, body: 0xa65e46, glow: 0xff9233, coat: 0x5c4d42 }, { kind: 'brick', count: 35 }, ['Iron mines and smelters', 'Miners for hire', 'The Foundry Row district']),
  eraDef(4, 'steam', 'Coal, gears and the hiss of steam', 'Coalbank Basin', ['Stoker', 'Stokers'], 'Steamworks Quarter', { ground: 0xc5ced9, accent: 0xd49a35, trim: 0x383d40, fence: 0x464b4f, body: 0x9e4737, glow: 0xffbe55, coat: 0x783a2d }, { kind: 'iron', count: 40 }, ['Coal pits and steam works', 'Stokers for hire', 'The Steamworks Quarter']),
  eraDef(5, 'industrial', 'Steel mills light up the night', 'Forge Flats', ['Steelworker', 'Steelworkers'], 'Mill Town', { ground: 0xbac4d0, accent: 0xe08a2b, trim: 0x333c42, fence: 0x525c63, body: 0x5a6973, glow: 0xffd166, coat: 0x485866 }, { kind: 'gear', count: 45 }, ['Deep mines, coke ovens, steel mills', 'Steelworkers for hire', 'The Mill Town district']),
  eraDef(6, 'electric', 'Copper wire hums across the snow', 'Copper Gorge', ['Lineman', 'Linemen'], 'Lamplight Avenue', { ground: 0xb4c0cc, accent: 0xd97f38, trim: 0x2b3b39, fence: 0x5c6b73, body: 0x4c6b68, glow: 0x7ce8c8, coat: 0x3d606e }, { kind: 'steel', count: 50 }, ['Copper mines and wire mills', 'Linemen for hire', 'Lamplight Avenue']),
  eraDef(7, 'oil', 'Black gold under the permafrost', 'Tundra Fields', ['Roughneck', 'Roughnecks'], 'Midtown', { ground: 0xaebac6, accent: 0xc44536, trim: 0x36383a, fence: 0x575552, body: 0xd99b26, glow: 0xffaa5a, coat: 0xb87b28 }, { kind: 'wire', count: 55 }, ['Oil pumps and refineries', 'Roughnecks for hire', 'The Midtown towers']),
  eraDef(8, 'computer', 'Silicon from sand, chips from silicon', 'Silicon Shore', ['Technician', 'Technicians'], 'Glass Heights', { ground: 0xc2ccd6, accent: 0x45858c, trim: 0x4a5259, fence: 0x7c858e, body: 0xe6dec8, glow: 0x66e0a3, coat: 0x4a7585 }, { kind: 'plastic', count: 60 }, ['Sand pits and chip fabs', 'Technicians for hire', 'The Glass Heights district']),
  eraDef(9, 'nuclear', 'Splitting atoms to light a city', 'Atom Valley', ['Atom Tech', 'Atom Techs'], 'Reactor Row', { ground: 0xcbd6e0, accent: 0x4ea885, trim: 0x3d5259, fence: 0x6f828a, body: 0xdce3e6, glow: 0x70f5d9, coat: 0x468275 }, { kind: 'chip', count: 65 }, ['Uranium mines, enrichers, reactors', 'Atom Techs for hire', 'The Reactor Row skyscrapers']),
  eraDef(10, 'ai', 'Thinking machines build the metropolis', 'Neural Plateau', ['Robot', 'Robots'], 'Metropolis Core', { ground: 0xcad4e0, accent: 0xe8a848, trim: 0x526475, fence: 0x8fa1b3, body: 0xf5f0e6, glow: 0xffe082, coat: 0x637a91 }, { kind: 'power', count: 70 }, ['Fusion plants, nano fabs, data centers, robot works', 'Robots for hire', 'The Metropolis Core']),
];

/** Era n (2..10) definition; throws on other numbers. */
export function era(n: number): EraDef {
  const d = ERAS[n];
  if (!d) throw new Error(`no era ${n}`);
  return d;
}
export const eraOfKey = (key: EraKey): number => ERA_KEYS.indexOf(key) + 2;

// ---------------------------------------------------------------------------
// Materials (new item kinds). Every one is carriable.
// ---------------------------------------------------------------------------

export type MaterialShape = 'block' | 'brick' | 'nugget' | 'ingot' | 'lump' | 'gear' | 'beam' | 'coil' | 'barrel' | 'pellet' | 'crystal' | 'chip' | 'rod' | 'cell' | 'core' | 'robot';

export interface MaterialDef {
  kind: MaterialKind;
  label: string;
  /** Era it belongs to (its price ladder rung and market). */
  era: number;
  /** raw = an extractor's product; refined = a processor's. */
  grade: 'raw' | 'refined';
  /** Base export price in dollars per unit (market index 1, no upgrades). */
  value: number;
  shape: MaterialShape;
  color: number;
  accent: number;
  /** Item box (metres) and stacking pitch, like config ITEM_SIZE. Footprints fit a 0.48 m pile grid. */
  size: { w: number; h: number; d: number; stackHeight: number };
}

/** Base export prices of era n's raw and refined materials (× ERA_SCALE, like every era price). */
const RAW = (n: number): number => 180 * ERA_SCALE * 3 ** (n - 2);
const REF = (n: number): number => 700 * ERA_SCALE * 3 ** (n - 2);
function mat(kind: MaterialKind, label: string, n: number, grade: 'raw' | 'refined', value: number, shape: MaterialShape, color: number, accent: number, w: number, h: number, d: number): MaterialDef {
  return { kind, label, era: n, grade, value: Math.round(value / 5) * 5, shape, color, accent, size: { w, h, d, stackHeight: h + 0.01 } };
}

export const MATERIALS: Record<MaterialKind, MaterialDef> = {
  stone: mat('stone', 'Stone', 2, 'raw', RAW(2), 'block', 0xa7a39b, 0x8a857c, 0.4, 0.28, 0.32),
  brick: mat('brick', 'Bricks', 2, 'refined', REF(2), 'brick', 0xb5543c, 0xd9cfc0, 0.42, 0.22, 0.28),
  ore: mat('ore', 'Iron Ore', 3, 'raw', RAW(3), 'nugget', 0x7c5a4a, 0xb0704e, 0.38, 0.26, 0.34),
  iron: mat('iron', 'Iron', 3, 'refined', REF(3), 'ingot', 0x8d949c, 0x5d6268, 0.44, 0.16, 0.22),
  coal: mat('coal', 'Coal', 4, 'raw', RAW(4), 'lump', 0x2c2b2e, 0x4a484d, 0.38, 0.26, 0.34),
  gear: mat('gear', 'Gears', 4, 'refined', REF(4), 'gear', 0xb08a3e, 0x6f5a2c, 0.4, 0.12, 0.4),
  steel: mat('steel', 'Steel', 5, 'refined', REF(5), 'beam', 0x7f8b99, 0x4b5562, 0.46, 0.18, 0.2),
  copper: mat('copper', 'Copper', 6, 'raw', RAW(6), 'nugget', 0xc9773a, 0x8f4f25, 0.38, 0.26, 0.34),
  wire: mat('wire', 'Wire', 6, 'refined', REF(6), 'coil', 0xd88a45, 0x5a3a20, 0.4, 0.22, 0.4),
  crude: mat('crude', 'Crude Oil', 7, 'raw', RAW(7), 'barrel', 0x2a2d33, 0xe0b03a, 0.34, 0.42, 0.34),
  plastic: mat('plastic', 'Plastic', 7, 'refined', REF(7), 'pellet', 0x48c0e8, 0xf2f2f2, 0.4, 0.24, 0.32),
  silicon: mat('silicon', 'Silicon', 8, 'raw', RAW(8), 'crystal', 0x8ea2b8, 0xdfe8f2, 0.36, 0.3, 0.3),
  chip: mat('chip', 'Microchips', 8, 'refined', REF(8), 'chip', 0x2f6f4e, 0xe8c650, 0.4, 0.1, 0.4),
  uranium: mat('uranium', 'Uranium', 9, 'raw', RAW(9), 'pellet', 0x4ea885, 0x3d5259, 0.38, 0.26, 0.34),
  fuelRod: mat('fuelRod', 'Fuel Rods', 9, 'refined', REF(9), 'rod', 0x8fdcb4, 0x5a6470, 0.46, 0.16, 0.16),
  power: mat('power', 'Power Cells', 9, 'refined', REF(9) * 0.5, 'cell', 0x70f5d9, 0x3d5259, 0.3, 0.36, 0.3),
  aiCore: mat('aiCore', 'AI Cores', 10, 'refined', REF(10), 'core', 0xe8a848, 0x526475, 0.34, 0.34, 0.34),
  robot: mat('robot', 'Robots', 10, 'refined', REF(10) * 2.6, 'robot', 0xf5f0e6, 0xe8a848, 0.36, 0.46, 0.3),
};

export function isMaterial(kind: ItemKind): kind is MaterialKind {
  return (MATERIAL_KINDS as readonly string[]).includes(kind);
}

/**
 * Base dollar value of one Survival item (Jack's swap cart, market display). Survival goods never fluctuate: their
 * value is this × the village demand price multiplier (deterministic, so era 1 plays exactly as before 0.9.0).
 */
export const SURVIVAL_VALUE: Record<Exclude<ItemKind, MaterialKind>, number> = {
  log: 10,
  plank: 5,
  crate: 15,
  cash: 0,
  furniture: 60,
  wheat: 8,
  bread: 30,
  meat: 12,
  sausage: 55,
  toy: 45,
};

// ---------------------------------------------------------------------------
// Machines (built on region slots)
// ---------------------------------------------------------------------------

export type MachineId =
  | 'quarry' | 'kiln'
  | 'ironMine' | 'smelter'
  | 'coalPit' | 'steamWorks'
  | 'deepMine' | 'cokeOven' | 'steelMill'
  | 'copperMine' | 'wireMill'
  | 'oilPump' | 'refinery'
  | 'sandPit' | 'chipFab'
  | 'uraniumMine' | 'enricher' | 'reactor'
  | 'fusionPlant' | 'nanoFab' | 'dataCenter' | 'robotWorks';

export interface MachineDef {
  id: MachineId;
  era: number;
  /** extractor: makes `output` from the ground (no inputs). processor: consumes `inputs` per cycle. */
  kind: 'extractor' | 'processor';
  label: string;
  blurb: string;
  inputs: readonly { kind: ItemKind; per: number }[];
  output: ItemKind;
  /** Items one cycle makes. */
  batch: number;
  /** Seconds per cycle at Rigs ×1 (divided by the era's `${key}Rigs` value). */
  cycle: number;
  /** Construction: cash + optional material (paid on the slot's construction pad). */
  cash: number;
  extra?: { kind: ItemKind; count: number };
  /** Model style hint for assets/eraMachines.ts (free-form, documented there). */
  style: string;
}

/** Input / output pile grids for every machine (small: every pile item is a mesh + a shadow draw call). */
export const MACHINE_PILES = {
  in: { cols: 2, rows: 2, layers: 2, spacing: { x: 0.5, y: 0.3, z: 0.5 } },
  out: { cols: 3, rows: 2, layers: 2, spacing: { x: 0.5, y: 0.3, z: 0.5 } },
} as const;

function machine(id: MachineId, n: number, kind: 'extractor' | 'processor', label: string, blurb: string, inputs: { kind: ItemKind; per: number }[], output: ItemKind, batch: number, cycle: number, costShare: number, extra: { kind: ItemKind; count: number } | undefined, style: string): MachineDef {
  const cash = Math.round((unlockCash(n) * costShare) / 1000) * 1000;
  return { id, era: n, kind, label, blurb, inputs, output, batch, cycle, cash, ...(extra ? { extra } : {}), style };
}

export const MACHINES: Record<MachineId, MachineDef> = {
  quarry: machine('quarry', 2, 'extractor', 'Quarry', 'Cuts stone blocks out of the hillside', [], 'stone', 1, 1.8, 0.1, undefined, 'crane over a stepped pit'),
  kiln: machine('kiln', 2, 'processor', 'Brick Kiln', '2 stone → bricks, fired in a beehive kiln', [{ kind: 'stone', per: 2 }], 'brick', 1, 2.4, 0.18, { kind: 'stone', count: 12 }, 'domed beehive kiln with chimney'),
  ironMine: machine('ironMine', 3, 'extractor', 'Iron Mine', 'A headframe winds ore out of the mountain', [], 'ore', 1, 1.8, 0.1, undefined, 'wooden headframe + mine cart'),
  smelter: machine('smelter', 3, 'processor', 'Smelter', '2 ore → an iron ingot', [{ kind: 'ore', per: 2 }], 'iron', 1, 2.4, 0.18, { kind: 'ore', count: 12 }, 'blast furnace tower, glowing mouth'),
  coalPit: machine('coalPit', 4, 'extractor', 'Coal Pit', 'Steam diggers bring up coal', [], 'coal', 1, 1.8, 0.1, undefined, 'steam shovel over a black pit'),
  steamWorks: machine('steamWorks', 4, 'processor', 'Steam Works', 'Iron + coal → gears', [{ kind: 'iron', per: 1 }, { kind: 'coal', per: 1 }], 'gear', 1, 2.6, 0.18, { kind: 'coal', count: 12 }, 'brick hall, big flywheel, steam stacks'),
  deepMine: machine('deepMine', 5, 'extractor', 'Deep Ore Mine', 'A steel headframe, twice as deep', [], 'ore', 2, 2.0, 0.08, undefined, 'steel lattice headframe'),
  cokeOven: machine('cokeOven', 5, 'extractor', 'Coke Ovens', 'A battery of ovens baking coal', [], 'coal', 2, 2.0, 0.08, undefined, 'row of brick ovens + quench tower'),
  steelMill: machine('steelMill', 5, 'processor', 'Steel Mill', 'Ore + 2 coal → steel beams', [{ kind: 'ore', per: 1 }, { kind: 'coal', per: 2 }], 'steel', 1, 2.6, 0.18, { kind: 'coal', count: 16 }, 'converter vessel pouring sparks, tall stack'),
  copperMine: machine('copperMine', 6, 'extractor', 'Copper Mine', 'An electric hoist lifts copper ore', [], 'copper', 1, 1.8, 0.1, undefined, 'electric hoist tower with pylons'),
  wireMill: machine('wireMill', 6, 'processor', 'Wire Mill', '2 copper → a coil of wire', [{ kind: 'copper', per: 2 }], 'wire', 1, 2.4, 0.18, { kind: 'copper', count: 12 }, 'long shed with spinning spools'),
  oilPump: machine('oilPump', 7, 'extractor', 'Oil Pump', 'A nodding pumpjack fills barrels', [], 'crude', 1, 1.8, 0.1, undefined, 'pumpjack with walking beam'),
  refinery: machine('refinery', 7, 'processor', 'Refinery', '2 crude → plastic pellets', [{ kind: 'crude', per: 2 }], 'plastic', 1, 2.4, 0.18, { kind: 'crude', count: 12 }, 'distillation columns, pipes, flare stack'),
  sandPit: machine('sandPit', 8, 'extractor', 'Sand Pit', 'Dredges pure quartz sand into silicon', [], 'silicon', 1, 1.8, 0.1, undefined, 'conveyor dredge + crystal grower'),
  chipFab: machine('chipFab', 8, 'processor', 'Chip Fab', 'Silicon + wire → microchips', [{ kind: 'silicon', per: 1 }, { kind: 'wire', per: 1 }], 'chip', 1, 2.8, 0.18, { kind: 'silicon', count: 12 }, 'white clean-room block with air vents'),
  uraniumMine: machine('uraniumMine', 9, 'extractor', 'Uranium Mine', 'Robotic diggers in lead-lined suits', [], 'uranium', 1, 1.8, 0.1, undefined, 'shielded headframe, hazard stripes'),
  enricher: machine('enricher', 9, 'processor', 'Enrichment Plant', '2 uranium → a fuel rod', [{ kind: 'uranium', per: 2 }], 'fuelRod', 1, 2.6, 0.18, { kind: 'uranium', count: 12 }, 'centrifuge cascade hall'),
  reactor: machine('reactor', 9, 'processor', 'Reactor', 'A fuel rod → 3 power cells', [{ kind: 'fuelRod', per: 1 }], 'power', 3, 3.2, 0.25, { kind: 'fuelRod', count: 6 }, 'cooling tower + containment dome'),
  fusionPlant: machine('fusionPlant', 10, 'extractor', 'Fusion Plant', 'A tokamak spins out power cells', [], 'power', 1, 2.0, 0.08, undefined, 'torus ring reactor with glow'),
  nanoFab: machine('nanoFab', 10, 'extractor', 'Nano Fab', 'Self-assembling microchips', [], 'chip', 1, 2.0, 0.08, undefined, 'sleek block with holo panels'),
  dataCenter: machine('dataCenter', 10, 'processor', 'Data Center', 'Chip + power cell → an AI core', [{ kind: 'chip', per: 1 }, { kind: 'power', per: 1 }], 'aiCore', 1, 3.0, 0.2, { kind: 'chip', count: 10 }, 'server halls with blinking racks'),
  robotWorks: machine('robotWorks', 10, 'processor', 'Robot Works', 'Steel + AI core → a robot', [{ kind: 'steel', per: 1 }, { kind: 'aiCore', per: 1 }], 'robot', 1, 3.4, 0.25, { kind: 'aiCore', count: 4 }, 'assembly hall with robot arms'),
};
export const MACHINE_IDS = Object.keys(MACHINES) as MachineId[];
export const machinesOfEra = (n: number): MachineId[] => MACHINE_IDS.filter((id) => MACHINES[id].era === n);

/** Demolishing a built machine / city building / town business costs this share of its cash price (no refund). */
export const DEMOLISH_SHARE = 0.2;
/** Minimum demolition price. */
export const DEMOLISH_MIN = 250;

// ---------------------------------------------------------------------------
// World layout of the new land (ground plane grows to ±320, see world/env/ground.ts)
// ---------------------------------------------------------------------------

/** Side of the region whose edge holds its gate (and faces its road). */
export type GateSide = 'north' | 'south';

export interface RegionLayoutDef {
  n: number;
  rect: ERect;
  gate: GateSide;
  /** Machine slots in this region (bigger eras get more). */
  slots: number;
  /**
   * 0.9.5: machine slots the plot has room for (the 0.10 counts). The processing zone is laid out for `room` slots
   * and the live `slots` take the first places in that grid, so raising `slots` up to `room` never moves a machine.
   */
  room: number;
}

/**
 * Era regions south of the old map, joined by roads, numbered along one snaking trail so the next era is always the
 * next plot along the road. 0.9.5: every plot is bigger than the whole of era 1's yard + village and each era's plot
 * is bigger than the last, with room for era-1-style zones (eras/layout.ts RegionZones) and the 0.10 slot counts.
 * Every gate is on the north edge, onto an east-west road:
 * - row A, below road R1 (z 62..66), read west from the town's south avenue: II, III, IV;
 * - row B, below road R2 (z 128..132, reached down the west link), read back east: V, VI, VII, VIII;
 * - row C, below road R3 (z 214..218, reached down the east link), read west again: IX, X.
 * Once the new land shows, the old era-1 river ends in a frozen pond north of R1 and the tricycle road ends on R1.
 * Same live slot counts as 0.9.3 (saves keep each slot's machine by index); `room` reserves the 0.10 counts.
 */
export const REGIONS: readonly (RegionLayoutDef | null)[] = [
  null,
  null,
  { n: 2, rect: R(-24, 40, 66, 114), gate: 'north', slots: 4, room: 8 }, // 64 × 48
  { n: 3, rect: R(-98, -30, 66, 118), gate: 'north', slots: 4, room: 8 }, // 68 × 52
  { n: 4, rect: R(-176, -104, 66, 122), gate: 'north', slots: 5, room: 8 }, // 72 × 56
  { n: 5, rect: R(-178, -100, 132, 192), gate: 'north', slots: 5, room: 8 }, // 78 × 60
  { n: 6, rect: R(-94, -10, 132, 196), gate: 'north', slots: 6, room: 8 }, // 84 × 64
  { n: 7, rect: R(-4, 86, 132, 200), gate: 'north', slots: 6, room: 8 }, // 90 × 68
  { n: 8, rect: R(92, 188, 132, 204), gate: 'north', slots: 7, room: 9 }, // 96 × 72
  { n: 9, rect: R(90, 192, 218, 294), gate: 'north', slots: 7, room: 9 }, // 102 × 76
  { n: 10, rect: R(-24, 84, 218, 298), gate: 'north', slots: 8, room: 10 }, // 108 × 80
];
export function regionDef(n: number): RegionLayoutDef {
  const r = REGIONS[n];
  if (!r) throw new Error(`no region ${n}`);
  return r;
}

/**
 * Roads (player-walkable once offered). `opensAt`: the era whose expansion pad must be OFFERED or previewed (era 2 =
 * the Great Lodge built, eras/gate.ts climbOpen; era n > 2 = age ≥ n − 1).
 */
export const ROADS: readonly { id: string; rect: ERect; opensAt: number }[] = [
  { id: 'southAvenue', rect: R(26, 30, 46.8, 66), opensAt: 2 }, // town's south fence (0.9.4: 0.6 m inside it) → R1
  { id: 'r1', rect: R(-184, 44, 62, 66), opensAt: 2 }, // ends on the city's west street
  { id: 'westLink', rect: R(-184, -180, 62, 132), opensAt: 5 }, // the trail's turn from IV down to V
  { id: 'r2', rect: R(-184, 198, 128, 132), opensAt: 5 },
  { id: 'eastLink', rect: R(194, 198, 128, 218), opensAt: 9 }, // the trail's turn from VIII down to IX
  { id: 'r3', rect: R(-28, 198, 214, 218), opensAt: 9 },
  // city (east): the avenue from the town to the districts, then the grid streets (the north-south ones run on to R2)
  { id: 'cityLink', rect: R(32, 44, 19, 23), opensAt: 2 },
  { id: 'cityWest', rect: R(40, 44, 14, 132), opensAt: 2 },
  { id: 'cityV1', rect: R(74, 78, 14, 132), opensAt: 4 },
  { id: 'cityV2', rect: R(108, 112, 14, 132), opensAt: 7 },
  { id: 'cityH1', rect: R(40, 142, 42, 46), opensAt: 3 },
  { id: 'cityH2', rect: R(40, 142, 74, 78), opensAt: 6 },
];

/**
 * 0.9.5: the old era-1 river runs on past the village; once the new land shows it ends in this frozen pond north of
 * R1 (world/env/frontier.ts), so it no longer stops dead in the snow or runs under the roads and plots. The channel
 * past the pond (to LAYOUT.river.maxZ) is capped with snow from RIVER_END_Z on.
 */
export const RIVER_POND: ERect = R(-22, -6, 47, 60.5);
/** Where the drawn river ends once the new land shows (inside the pond; the channel past it is snowed over). */
export const RIVER_END_Z = 56;
/** 0.9.5: once the new land shows, the era-1 tricycle road ends here, on R1 (its tail used to run into region II). */
export const TRIKE_ROAD_END_Z = 62;


// ---------------------------------------------------------------------------
// City (districts of lots east of the Market Town)
// ---------------------------------------------------------------------------

export interface DistrictDef {
  n: number;
  name: string;
  rect: ERect;
  /** Lots in this district (laid out by city/rules.ts districtLots). */
  lots: number;
}
const D = (n: number, minX: number, minZ: number, lots: number): DistrictDef => ({ n, name: era(n).district, rect: R(minX, minX + 30, minZ, minZ + 28), lots });
/**
 * DISTRICTS[n] for eras 2..10: a 3×3 grid, columns x 44/78/112, rows z 14/46/78 (30 × 28 m each), in reading order
 * from the corner nearest the town (0.9.3; before, the numbers were scattered over the grid): II III IV / V VI VII /
 * VIII IX X. Same plots and lot counts per era as before, so a save finds its buildings on the new plot.
 */
export const DISTRICTS: readonly (DistrictDef | null)[] = [
  null,
  null,
  D(2, 44, 14, 6),
  D(3, 78, 14, 6),
  D(4, 112, 14, 6),
  D(5, 44, 46, 8),
  D(6, 78, 46, 8),
  D(7, 112, 46, 8),
  D(8, 44, 78, 9),
  D(9, 78, 78, 9),
  D(10, 112, 78, 12),
];
export function districtDef(n: number): DistrictDef {
  const d = DISTRICTS[n];
  if (!d) throw new Error(`no district ${n}`);
  return d;
}

export type CityBuildingRole = 'Home' | 'Work' | 'Park' | 'Landmark';
export type CityBuildingId = `${EraKey}${CityBuildingRole}`;
export type CityBuildingKind = 'home' | 'work' | 'park' | 'landmark';

export interface CityBuildingDef {
  id: CityBuildingId;
  era: number;
  kind: CityBuildingKind;
  label: string;
  blurb: string;
  /** Construction: cash + the era's refined material. */
  cash: number;
  extra: { kind: ItemKind; count: number };
  /** Residents (home) — they count toward the city population and fill jobs. */
  people: number;
  /** Jobs (work / landmark) — income needs workers: employment = min(1, residents / jobs). */
  jobs: number;
  /** Dollars per second at full employment (work, landmark) or rent (home, independent of jobs). */
  income: number;
  /** City happiness share (park, landmark), summed and capped at 1. */
  happiness: number;
  /** Roof height in metres (models scale with it; skyscrapers from the Oil Age on). */
  height: number;
}

/** Refined material each district's buildings are made of. */
export const DISTRICT_MATERIAL: readonly (ItemKind | null)[] = [null, null, 'brick', 'iron', 'gear', 'steel', 'wire', 'plastic', 'chip', 'power', 'aiCore'];

const CITY_NAMES: Record<EraKey, [string, string, string, string]> = {
  frontier: ['Brick Cottages', 'Trading Post', 'Village School', 'Clock Tower'],
  iron: ['Iron Tenements', 'Foundry Office', 'Iron Bridge Park', 'Railway Station'],
  steam: ['Steam Row', 'Mill Office', 'Steam Baths', 'Grand Exchange'],
  industrial: ['Brick Apartments', 'Factory Office', 'Public Library', 'Expo Hall'],
  electric: ['Art-Deco Flats', 'Power Company', 'Picture Palace', 'Radio Tower'],
  oil: ['High-Rise Flats', 'Oil Company Tower', 'Shopping Mall', 'Sky Needle'],
  computer: ['Glass Condos', 'Tech Campus', 'Arcade Plaza', 'Data Spire'],
  nuclear: ['Skyscraper Homes', 'Energy Exchange', 'Science Museum', 'Atomic Monument'],
  ai: ['Arcology', 'AI Headquarters', 'Holo Park', 'Singularity Spire'],
};
const CITY_BLURBS: Record<CityBuildingRole, string> = {
  Home: 'Homes for new citizens: they pay rent and fill jobs',
  Work: 'Jobs and business: earns money while staffed',
  Park: 'Makes the city happier: every building earns more',
  Landmark: 'One per district: income, happiness and pride',
};

function cityBuildings(): Record<CityBuildingId, CityBuildingDef> {
  const out = {} as Record<CityBuildingId, CityBuildingDef>;
  for (const key of ERA_KEYS) {
    const n = eraOfKey(key);
    // prices and income × 3 per era (× ERA_SCALE); people × 2.2 per era
    const k = ERA_SCALE * 3 ** (n - 2);
    const p = 2.2 ** (n - 2);
    const material = DISTRICT_MATERIAL[n]!;
    const h = [5, 7, 9, 12, 16, 26, 34, 46, 62][n - 2]!;
    const names = CITY_NAMES[key];
    const mk = (role: CityBuildingRole, i: number, cash: number, count: number, people: number, jobs: number, income: number, happiness: number, height: number): void => {
      const id = `${key}${role}` as CityBuildingId;
      out[id] = { id, era: n, kind: role.toLowerCase() as CityBuildingKind, label: names[i]!, blurb: CITY_BLURBS[role], cash: Math.round((cash * k) / 1000) * 1000, extra: { kind: material, count }, people: Math.round(people * p), jobs: Math.round(jobs * p), income: Math.round(income * k), happiness, height };
    };
    mk('Home', 0, 40_000, 15, 40, 0, 4, 0, h);
    mk('Work', 1, 60_000, 20, 0, 30, 45, 0, h * 1.15);
    mk('Park', 2, 30_000, 10, 0, 4, 2, 0.12, 4);
    mk('Landmark', 3, 250_000, 60, 0, 60, 120, 0.3, h * 1.8);
  }
  return out;
}
export const CITY_BUILDINGS: Record<CityBuildingId, CityBuildingDef> = cityBuildings();
export const CITY_BUILDING_IDS = Object.keys(CITY_BUILDINGS) as CityBuildingId[];
export const cityBuildingsOfEra = (n: number): CityBuildingId[] => CITY_BUILDING_IDS.filter((id) => CITY_BUILDINGS[id].era === n);

/** City happiness multiplies all city income by up to 1 + this. */
export const CITY_HAPPINESS_BONUS = 0.5;

/**
 * City rank by total population (village + Market Town + districts); Metropolis also needs era 10. Cosmetic (skyline,
 * badge): minEra is the first era whose cumulative city capacity reaches the population (docs/EXPANSION.md R13: era 4's
 * districts hold about 2.1k people, era 7's about 37k), so a rank never promises the impossible.
 */
export const CITY_RANKS: readonly { name: string; minPopulation: number; minEra: number }[] = [
  { name: 'Town', minPopulation: 0, minEra: 1 },
  { name: 'City', minPopulation: 500, minEra: 2 },
  { name: 'Big City', minPopulation: 5_000, minEra: 5 },
  { name: 'Megacity', minPopulation: 40_000, minEra: 8 },
  { name: 'Metropolis', minPopulation: 100_000, minEra: 10 },
];

/** City income is credited every this many seconds (an 'income' event each time). */
export const CITY_TICK = 5;

// ---------------------------------------------------------------------------
// Market: prices, trading, investments
// ---------------------------------------------------------------------------

export const MARKET = {
  /** Seconds between price ticks (each tick appends a history point). */
  tick: 4,
  /** History points kept for sparklines (not saved; regenerated). */
  history: 48,
  /** Random-walk step (share of the index) per tick and the pull back toward 1 per tick. */
  volatility: 0.045,
  reversion: 0.06,
  /** The price index stays inside this band. */
  min: 0.55,
  max: 1.8,
  /** Supply pressure: every exported unit of a kind adds this much (refined); raw adds half. Decays per second. */
  pressurePerUnit: 0.002,
  pressureDecay: 0.01,
  pressureMax: 0.4,
  /** Trading spread (buy above / sell below the price), reduced by the Broker upgrade (divides it). */
  spread: 0.05,
  /** Physical orders delivered to a region's import dock pay this delivery surcharge on top of the buy price. */
  delivery: 0.1,
} as const;

export type InvestProductId = 'bond' | 'index' | 'venture';

export interface InvestProductDef {
  id: InvestProductId;
  label: string;
  blurb: string;
  /** Smallest deposit. */
  min: number;
  /** bond: seconds until maturity (early withdrawal returns the principal only). */
  lock?: number;
  /** bond: total return at maturity. index / venture: expected growth per minute (drift). */
  rate: number;
  /** index / venture: random step per tick (share of value). */
  volatility: number;
  /** Era needed before it is offered. */
  era: number;
}

export const INVEST: Record<InvestProductId, InvestProductDef> = {
  bond: { id: 'bond', label: 'Winter Bonds', blurb: 'Safe: +12% after 10 minutes. Early withdrawal returns your deposit only', min: 1_000, lock: 600, rate: 0.12, volatility: 0, era: 2 },
  index: { id: 'index', label: 'Snow Index Fund', blurb: 'Tracks the whole market: grows over time, wobbles on the way', min: 1_000, rate: 0.015, volatility: 0.012, era: 2 },
  venture: { id: 'venture', label: 'Era Ventures', blurb: 'Back the newest era: big swings, big rewards', min: 10_000, rate: 0.03, volatility: 0.04, era: 3 },
};
export const INVEST_IDS: readonly InvestProductId[] = ['bond', 'index', 'venture'];
/** Total money in bonds may not exceed this share of net worth (keeps the risk-free rate from dominating). */
export const BOND_CAP_SHARE = 0.5;
export const INVEST_MAX_POSITIONS = 12;

// ---------------------------------------------------------------------------
// Jack of all trades (swap cart)
// ---------------------------------------------------------------------------

export const JACK = {
  /** Seconds the player must linger at the cart before Jack starts buying (no accidental discards when passing). */
  delay: 0.7,
  /** Seconds between items at Jack level 0 (shrinks with the upgrade like other zones). */
  interval: 0.16,
  /** The yard cart (world x/z) — away from the customer path, trikes and the bot's routes. */
  yard: { x: -8.9, z: 6.3 },
} as const;
