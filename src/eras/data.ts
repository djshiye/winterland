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
import { guideColors } from '../render/palette';

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

/**
 * 0.9.12: an era's name as a noun for a sentence: "the Iron Age", "the AI Era", "the Industrial era" (names that end in
 * Age or Era already say it, so "Needs the AI Era era" never happens). Use as `Needs the ${eraNoun(n)}`.
 */
export function eraNoun(n: number): string {
  const name = ERA_NAMES[n];
  if (!name) return 'next era';
  return /\b(Age|Era)$/.test(name) ? name : `${name} era`;
}

/** 0.9.12: a label in running text: lower case, but "AI" stays "AI" ("AI Cores" → "AI cores", not "ai cores"). */
export function lowerLabel(label: string): string {
  return label.toLowerCase().replace(/\bai\b/g, 'AI');
}

/** 0.9.12: "1 gear", "24 gears", "1 battery", "5 stone": a count and a material label in running text. */
export function countOf(label: string, count: number): string {
  const word = lowerLabel(label);
  if (count !== 1 || !/s$/.test(word) || word === 'gas') return `${count.toLocaleString('en-US')} ${word}`;
  return `1 ${word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.slice(0, -1)}`;
}

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
   * Visual palette (hex), the era's guide row from render/palette.ts (docs/art/guide.md): region ground, accent
   * (machines / signs), trim, fence, machine body, glow tint and worker coat. Builders may derive shades.
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
  eraDef(2, 'frontier', 'Stone and brick: the settlement digs in', 'Granite Hollow', ['Quarryman', 'Quarrymen'], 'Brickside', guideColors(2), { kind: 'crate', count: 40 }, ['Quarries and brick kilns', 'Quarrymen for hire', 'The Brickside district']),
  eraDef(3, 'iron', 'Ore in the hills, fire in the smelters', 'Iron Ridge', ['Miner', 'Miners'], 'Foundry Row', guideColors(3), { kind: 'brick', count: 35 }, ['Iron mines and smelters', 'Miners for hire', 'The Foundry Row district']),
  eraDef(4, 'steam', 'Coal, gears and the hiss of steam', 'Coalbank Basin', ['Stoker', 'Stokers'], 'Steamworks Quarter', guideColors(4), { kind: 'iron', count: 40 }, ['Coal pits and steam works', 'Stokers for hire', 'The Steamworks Quarter']),
  eraDef(5, 'industrial', 'Steel mills light up the night', 'Forge Flats', ['Steelworker', 'Steelworkers'], 'Mill Town', guideColors(5), { kind: 'gear', count: 45 }, ['Pellet mines, coke ovens, steel mills', 'Steelworkers for hire', 'The Mill Town district']),
  eraDef(6, 'electric', 'Copper wire hums across the snow', 'Copper Gorge', ['Lineman', 'Linemen'], 'Lamplight Avenue', guideColors(6), { kind: 'steel', count: 50 }, ['Copper mines and wire mills', 'Linemen for hire', 'Lamplight Avenue']),
  eraDef(7, 'oil', 'Black gold under the permafrost', 'Tundra Fields', ['Roughneck', 'Roughnecks'], 'Midtown', guideColors(7), { kind: 'wire', count: 55 }, ['Oil pumps and refineries', 'Roughnecks for hire', 'The Midtown towers']),
  eraDef(8, 'computer', 'Silicon from sand, chips from silicon', 'Silicon Shore', ['Technician', 'Technicians'], 'Glass Heights', guideColors(8), { kind: 'plastic', count: 60 }, ['Sand pits and chip fabs', 'Technicians for hire', 'The Glass Heights district']),
  eraDef(9, 'nuclear', 'Splitting atoms to light a city', 'Atom Valley', ['Atom Tech', 'Atom Techs'], 'Reactor Row', guideColors(9), { kind: 'chip', count: 65 }, ['Uranium mines, enrichers, reactors', 'Atom Techs for hire', 'The Reactor Row skyscrapers']),
  eraDef(10, 'ai', 'Thinking machines build the metropolis', 'Neural Plateau', ['Robot', 'Robots'], 'Metropolis Core', guideColors(10), { kind: 'power', count: 70 }, ['Geode mines, helium skimmers, fusion reactors, robot works', 'Robots for hire', 'The Metropolis Core']),
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

export type MaterialShape =
  | 'block' | 'brick' | 'nugget' | 'native' | 'ingot' | 'lump' | 'gear' | 'beam' | 'coil' | 'barrel' | 'pellet' | 'crystal' | 'chip' | 'rod' | 'cell' | 'core' | 'robot'
  // 0.9.5 era 2-4 (assets/eraItems2to4.ts)
  | 'tile' | 'hearth' | 'tools' | 'rail' | 'boiler' | 'engine'
  // 0.9.5 era 5-7 (assets/eraItems5to7.ts)
  | 'girder' | 'plow' | 'bulb' | 'radio' | 'canister' | 'jerrycan' | 'snowmobile'
  // 0.9.7 era 5 iron pellets (a tray of taconite balls) and coke (assets/eraItems5to7.ts)
  | 'taconite' | 'coke'
  // 0.9.5 era 8-10 (assets/eraItems8to10.ts)
  | 'computer'
  // 0.9.7 era 10 rare earth (a cracked geode), helium-3 (a cryo flask) and fusion cells (assets/eraItems8to10.ts)
  | 'geode' | 'flask' | 'fusion';

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
/** 0.9.5 grades (docs/EXPANSION.md D): an era's second refined good is worth 0.8 × REF, its premium good 2.6 × REF. */
const REF2 = (n: number): number => 0.8 * REF(n);
const PREMIUM = (n: number): number => 2.6 * REF(n);
/** 0.9.5: a product sells for at least this × the value of its inputs. */
const VALUE_ADD = 1.3;
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
  copper: mat('copper', 'Copper', 6, 'raw', RAW(6), 'native', 0xc9773a, 0x8f4f25, 0.38, 0.26, 0.34),
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
  // 0.9.5 era 2-4 content (docs/ERA_RESOURCES.md): each era's second raw, second refined and premium good
  clay: mat('clay', 'Clay', 2, 'raw', RAW(2), 'lump', 0xc26a4a, 0xe0a07c, 0.38, 0.24, 0.34),
  roofTile: mat('roofTile', 'Roof Tiles', 2, 'refined', REF2(2), 'tile', 0xc0583a, 0xe8c9a8, 0.42, 0.18, 0.32),
  hearth: mat('hearth', 'Hearths', 2, 'refined', PREMIUM(2), 'hearth', 0xa7a39b, 0xffa040, 0.4, 0.42, 0.32),
  charcoal: mat('charcoal', 'Charcoal', 3, 'raw', RAW(3), 'lump', 0x3a3330, 0xd8703a, 0.38, 0.24, 0.34),
  tools: mat('tools', 'Tools', 3, 'refined', Math.max(REF2(3), (VALUE_ADD * (REF(3) + RAW(3))) / 2), 'tools', 0x8d949c, 0x9a6a42, 0.44, 0.14, 0.34),
  rail: mat('rail', 'Rails', 3, 'refined', PREMIUM(3), 'rail', 0x7a8088, 0x5c4028, 0.46, 0.16, 0.3),
  scrap: mat('scrap', 'Scrap', 4, 'raw', RAW(4), 'nugget', 0x8a7a6a, 0xc0763a, 0.38, 0.26, 0.34),
  boiler: mat('boiler', 'Boilers', 4, 'refined', REF2(4), 'boiler', 0x9e4737, 0xd49a35, 0.36, 0.4, 0.36),
  steamEngine: mat('steamEngine', 'Steam Engines', 4, 'refined', PREMIUM(4), 'engine', 0x383d40, 0xd49a35, 0.44, 0.42, 0.34),
  // ---- 0.9.5 era 5-7 content (ERA_RESOURCES.md). A product is worth at least 1.3× its inputs, so every step of
  // the chain pays: max(section D's grade price, VALUE_ADD × the inputs' value).
  girder: mat('girder', 'Girders', 5, 'refined', Math.max(REF(5) * 0.8, VALUE_ADD * 2 * REF(5)), 'girder', 0x7f8b99, 0xe08a2b, 0.48, 0.2, 0.24),
  snowplow: mat('snowplow', 'Snowplows', 5, 'refined', Math.max(REF(5) * 2.6, VALUE_ADD * (VALUE_ADD * 2 + 1) * REF(5)), 'plow', 0x485866, 0xe08a2b, 0.44, 0.36, 0.44),
  quartz: mat('quartz', 'Quartz', 6, 'raw', RAW(6), 'crystal', 0xeed3e2, 0xa9a49a, 0.36, 0.3, 0.3),
  bulb: mat('bulb', 'Light Bulbs', 6, 'refined', Math.max(REF(6) * 0.8, VALUE_ADD * (REF(6) + RAW(6))), 'bulb', 0xfff1c4, 0xf0e4cb, 0.3, 0.42, 0.3),
  radio: mat('radio', 'Radios', 6, 'refined', Math.max(REF(6) * 2.6, VALUE_ADD * (REF(6) + VALUE_ADD * (REF(6) + RAW(6)))), 'radio', 0xa8673c, 0xf0e4cb, 0.44, 0.36, 0.3),
  gas: mat('gas', 'Gas', 7, 'raw', RAW(7), 'canister', 0x4f7fa8, 0xf2f2f2, 0.3, 0.44, 0.3),
  fuel: mat('fuel', 'Fuel', 7, 'refined', Math.max(REF(7) * 0.8, VALUE_ADD * 2 * RAW(7)), 'jerrycan', 0xc44536, 0xe2ad3c, 0.4, 0.38, 0.2),
  snowmobile: mat('snowmobile', 'Snowmobiles', 7, 'refined', Math.max(REF(7) * 2.6, VALUE_ADD * (REF(7) + REF(7) * 0.8)), 'snowmobile', 0xd99b26, 0xc44536, 0.4, 0.34, 0.48),
  // 0.9.5 eras 8-10: every processing step adds value (tests/era8to10.test.ts), premium goods top each era
  gold: mat('gold', 'Gold', 8, 'raw', RAW(8) * 1.5, 'nugget', 0xe8b341, 0xb8862e, 0.32, 0.2, 0.28),
  board: mat('board', 'Circuit Boards', 8, 'refined', REF(8) * 1.9, 'chip', 0x3a7d5a, 0xe8c650, 0.48, 0.08, 0.38),
  computer: mat('computer', 'Home Computers', 8, 'refined', REF(8) * 4.2, 'computer', 0xe6dec8, 0x45858c, 0.42, 0.36, 0.36),
  graphite: mat('graphite', 'Graphite', 9, 'raw', RAW(9) * 1.3, 'block', 0x4a494e, 0x6e6c73, 0.36, 0.24, 0.3),
  battery: mat('battery', 'Batteries', 9, 'refined', REF(9) * 1.6, 'cell', 0x4ea885, 0xe8b341, 0.32, 0.4, 0.32),
  quantumCore: mat('quantumCore', 'Quantum Cores', 10, 'refined', REF(10) * 3.2, 'core', 0xb9a6e0, 0xe8a848, 0.36, 0.36, 0.36),
  // 0.9.7 era resources v2 (audit-1.0/era-resources-v2.md, approved 2026-10-16): each era's whole look revolves around
  // its own raw materials. Era 5: rust-red taconite pellets + coke from the ovens. Era 10: lavender rare earth +
  // helium-3 skimmed from the frost vents, fused into fusion cells.
  pellets: mat('pellets', 'Iron Pellets', 5, 'raw', RAW(5), 'taconite', 0xa8503a, 0x5a6973, 0.4, 0.2, 0.32),
  coke: mat('coke', 'Coke', 5, 'raw', RAW(5), 'coke', 0x8e8a86, 0xffa040, 0.38, 0.26, 0.34),
  rareEarth: mat('rareEarth', 'Rare Earth', 10, 'raw', RAW(10), 'geode', 0xb9a0e0, 0xe8c46a, 0.36, 0.3, 0.32),
  helium3: mat('helium3', 'Helium-3', 10, 'raw', RAW(10), 'flask', 0xf5efe2, 0xffc69a, 0.3, 0.4, 0.3),
  fusionCell: mat('fusionCell', 'Fusion Cells', 10, 'refined', REF(10) * 0.5, 'fusion', 0xf5f0e6, 0xf2b644, 0.34, 0.3, 0.34),
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
  // 0.9.5 era 2-4 content (models: assets/eraMachines2.ts)
  | 'clayPit' | 'tileKiln' | 'masonYard'
  | 'charcoalClamp' | 'forge' | 'railMill'
  | 'scrapYard' | 'boilerShop' | 'engineWorks'
  | 'deepMine' | 'cokeOven' | 'steelMill' | 'rollingMill' | 'plowWorks'
  | 'copperMine' | 'wireMill' | 'quartzPit' | 'bulbWorks' | 'radioWorks'
  | 'oilPump' | 'refinery' | 'gasWell' | 'cracker' | 'snowmobileWorks'
  | 'sandPit' | 'chipFab'
  | 'uraniumMine' | 'enricher' | 'reactor'
  | 'fusionPlant' | 'nanoFab' | 'dataCenter' | 'robotWorks' | 'heliumSkimmer'
  // 0.9.5 eras 8-10 (models: assets/eraMachines4.ts)
  | 'goldPanner' | 'boardShop' | 'pcAssembly'
  | 'graphitePit' | 'batteryPlant'
  | 'quantumLab';

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

/**
 * Input / output pile grids for every machine (small: every pile item is a mesh + a shadow draw call). 0.9.6 (F3): the
 * input hopper grows with the machine type's level, from `hopper.base` units at Lv 0-1 to `hopper.max` (the whole grid)
 * at Lv 10 (eras/rules.ts hopperSize), so a levelled processor keeps a buffer and never starves between two deliveries.
 */
export const MACHINE_PILES = {
  in: { cols: 3, rows: 2, layers: 4, spacing: { x: 0.5, y: 0.3, z: 0.5 } },
  out: { cols: 3, rows: 2, layers: 2, spacing: { x: 0.5, y: 0.3, z: 0.5 } },
  hopper: { base: 8, max: 24 },
} as const;

/**
 * 0.9.6: every era's machine cycles × this (index = era). The 0.9.6 recipes balance each chain (one extractor feeds its
 * processor, F3) and so make more per second; this pace keeps each era's pacing-model length (tests/pacing.test.ts)
 * where 0.9.5 had it. Solved with the pacing model; the economy re-tune may move it. 0.9.7: era 5 at 1.3, since its
 * pellets and coke sell at era-5 prices (the old coke ovens made era-4 coal); config CLIMB.bandTilt re-solved with it.
 * 0.9.7 plots: the pace stays; the extra slots' income is balanced by CLIMB.bandTilt (each era's own prices).
 */
export const ERA_PACE: readonly number[] = [1, 1, 1.16, 2.1, 1.66, 1.3, 2.38, 1, 1.7, 1.07, 0.86];

function machine(id: MachineId, n: number, kind: 'extractor' | 'processor', label: string, blurb: string, inputs: { kind: ItemKind; per: number }[], output: ItemKind, batch: number, cycle: number, costShare: number, extra: { kind: ItemKind; count: number } | undefined, style: string): MachineDef {
  const cash = Math.round((unlockCash(n) * costShare) / 1000) * 1000;
  return { id, era: n, kind, label, blurb, inputs, output, batch, cycle: Math.round(cycle * (ERA_PACE[n] ?? 1) * 100) / 100, cash, ...(extra ? { extra } : {}), style };
}

export const MACHINES: Record<MachineId, MachineDef> = {
  quarry: machine('quarry', 2, 'extractor', 'Quarry', 'Cuts stone blocks out of the hillside', [], 'stone', 1, 1.8, 0.1, undefined, 'crane over a stepped pit'),
  kiln: machine('kiln', 2, 'processor', 'Brick Kiln', '2 stone → bricks, fired in a beehive kiln', [{ kind: 'stone', per: 2 }], 'brick', 1, 2.4, 0.18, { kind: 'stone', count: 12 }, 'domed beehive kiln with chimney'),
  ironMine: machine('ironMine', 3, 'extractor', 'Iron Mine', 'A headframe winds ore out of the mountain', [], 'ore', 1, 1.8, 0.1, undefined, 'wooden headframe + mine cart'),
  smelter: machine('smelter', 3, 'processor', 'Smelter', '2 ore → two iron ingots', [{ kind: 'ore', per: 2 }], 'iron', 2, 2.4, 0.18, { kind: 'ore', count: 12 }, 'blast furnace tower, glowing mouth'),
  coalPit: machine('coalPit', 4, 'extractor', 'Coal Pit', 'Steam diggers bring up coal', [], 'coal', 1, 1.8, 0.1, undefined, 'steam shovel over a black pit'),
  steamWorks: machine('steamWorks', 4, 'processor', 'Steam Works', 'Scrap + coal → gears', [{ kind: 'scrap', per: 1 }, { kind: 'coal', per: 1 }], 'gear', 1, 2.6, 0.18, { kind: 'coal', count: 12 }, 'brick hall, big flywheel, steam stacks'),
  // 0.9.5 era 2-4: second extractor, second processor and premium works per era (docs/ERA_RESOURCES.md)
  clayPit: machine('clayPit', 2, 'extractor', 'Clay Pit', 'A bucket wheel scoops wet red clay', [], 'clay', 1, 1.2, 0.1, { kind: 'stone', count: 8 }, 'timber bucket wheel over a clay pond'),
  tileKiln: machine('tileKiln', 2, 'processor', 'Tile Kiln', '2 clay → roof tiles, fired in a long kiln', [{ kind: 'clay', per: 2 }], 'roofTile', 1, 2.4, 0.18, { kind: 'clay', count: 12 }, 'long low kiln with a tile rack'),
  masonYard: machine('masonYard', 2, 'processor', "Mason's Yard", 'Bricks + roof tiles → a cozy hearth', [{ kind: 'brick', per: 1 }, { kind: 'roofTile', per: 1 }], 'hearth', 1, 3.0, 0.25, { kind: 'brick', count: 10 }, 'open yard with a hoist and a half-built hearth'),
  charcoalClamp: machine('charcoalClamp', 3, 'extractor', 'Charcoal Clamp', 'A smouldering earth mound bakes charcoal', [], 'charcoal', 1, 1.4, 0.1, { kind: 'ore', count: 8 }, 'turf-covered smoking mound'),
  forge: machine('forge', 3, 'processor', 'Forge', 'Iron + charcoal → two bundles of tools', [{ kind: 'iron', per: 1 }, { kind: 'charcoal', per: 1 }], 'tools', 2, 2.8, 0.18, { kind: 'charcoal', count: 12 }, 'open forge with bellows and anvil'),
  railMill: machine('railMill', 3, 'processor', 'Rail Mill', 'Iron + charcoal → a length of rail', [{ kind: 'iron', per: 1 }, { kind: 'charcoal', per: 1 }], 'rail', 1, 3.0, 0.25, { kind: 'iron', count: 10 }, 'rolling stand with a trip hammer'),
  scrapYard: machine('scrapYard', 4, 'extractor', 'Scrap Yard', 'A magnet crane sorts old iron, two loads at a time', [], 'scrap', 2, 2.4, 0.1, { kind: 'coal', count: 8 }, 'magnet crane over a scrap heap'),
  boilerShop: machine('boilerShop', 4, 'processor', 'Boiler Shop', 'Scrap + coal → a riveted boiler', [{ kind: 'scrap', per: 1 }, { kind: 'coal', per: 1 }], 'boiler', 1, 2.6, 0.18, { kind: 'scrap', count: 12 }, 'riveting shed with a boiler on blocks'),
  engineWorks: machine('engineWorks', 4, 'processor', 'Engine Works', 'Gears + a boiler → a steam engine', [{ kind: 'gear', per: 1 }, { kind: 'boiler', per: 1 }], 'steamEngine', 1, 3.0, 0.25, { kind: 'gear', count: 8 }, 'erecting hall with a test engine'),
  // 0.9.7: era 5 runs on taconite pellets + coke (era resources v2). Ids stay, so saved levels and slots carry over.
  deepMine: machine('deepMine', 5, 'extractor', 'Pellet Mine', 'A steel headframe brings up rust-red taconite pellets', [], 'pellets', 1, 2.0, 0.08, undefined, 'steel lattice headframe over a pellet ridge'),
  cokeOven: machine('cokeOven', 5, 'extractor', 'Coke Ovens', 'A battery of glowing ovens bakes coke', [], 'coke', 1, 2.0, 0.08, undefined, 'row of brick ovens + quench tower'),
  steelMill: machine('steelMill', 5, 'processor', 'Steel Mill', '2 iron pellets + coke → two steel beams', [{ kind: 'pellets', per: 2 }, { kind: 'coke', per: 1 }], 'steel', 2, 2.6, 0.18, { kind: 'coke', count: 16 }, 'converter vessel pouring sparks, tall stack'),
  rollingMill: machine('rollingMill', 5, 'processor', 'Rolling Mill', 'Steel → a riveted girder', [{ kind: 'steel', per: 1 }], 'girder', 1, 2.8, 0.2, { kind: 'steel', count: 12 }, 'roller stands with a red-hot bar'),
  plowWorks: machine('plowWorks', 5, 'processor', 'Plow Works', 'Girder + steel → a snowplow', [{ kind: 'girder', per: 1 }, { kind: 'steel', per: 1 }], 'snowplow', 1, 3.4, 0.28, { kind: 'girder', count: 6 }, 'assembly shed, plow blade on a hoist'),
  copperMine: machine('copperMine', 6, 'extractor', 'Copper Mine', 'An electric hoist lifts copper ore', [], 'copper', 1, 1.8, 0.1, undefined, 'electric hoist tower with pylons'),
  wireMill: machine('wireMill', 6, 'processor', 'Wire Mill', '2 copper → two coils of wire', [{ kind: 'copper', per: 2 }], 'wire', 2, 2.4, 0.18, { kind: 'copper', count: 12 }, 'long shed with spinning spools'),
  quartzPit: machine('quartzPit', 6, 'extractor', 'Quartz Pit', 'An electric shovel digs pink quartz', [], 'quartz', 1, 1.8, 0.1, undefined, 'electric shovel over a quartz pit'),
  bulbWorks: machine('bulbWorks', 6, 'processor', 'Bulb Works', 'Wire + quartz → a light bulb', [{ kind: 'wire', per: 1 }, { kind: 'quartz', per: 1 }], 'bulb', 1, 2.6, 0.2, { kind: 'wire', count: 10 }, 'glass-blowing hall with a glowing furnace'),
  radioWorks: machine('radioWorks', 6, 'processor', 'Radio Works', 'Wire + bulb → a radio set', [{ kind: 'wire', per: 1 }, { kind: 'bulb', per: 1 }], 'radio', 1, 3.2, 0.28, { kind: 'bulb', count: 6 }, 'art-deco factory with a spinning antenna'),
  oilPump: machine('oilPump', 7, 'extractor', 'Oil Pump', 'A nodding pumpjack fills barrels', [], 'crude', 1, 1.8, 0.1, undefined, 'pumpjack with walking beam'),
  refinery: machine('refinery', 7, 'processor', 'Refinery', '2 crude → plastic pellets', [{ kind: 'crude', per: 2 }], 'plastic', 1, 2.4, 0.18, { kind: 'crude', count: 12 }, 'distillation columns, pipes, flare stack'),
  gasWell: machine('gasWell', 7, 'extractor', 'Gas Well', 'A wellhead fills gas bottles', [], 'gas', 1, 1.8, 0.1, undefined, 'wellhead tree with a flare'),
  cracker: machine('cracker', 7, 'processor', 'Cracker', 'Crude + gas → fuel', [{ kind: 'crude', per: 1 }, { kind: 'gas', per: 1 }], 'fuel', 1, 2.6, 0.2, { kind: 'crude', count: 12 }, 'catalytic cracking tower'),
  snowmobileWorks: machine('snowmobileWorks', 7, 'processor', 'Snowmobile Works', 'Plastic + fuel → a snowmobile', [{ kind: 'plastic', per: 1 }, { kind: 'fuel', per: 1 }], 'snowmobile', 1, 3.4, 0.28, { kind: 'plastic', count: 6 }, 'assembly line with a test track'),
  sandPit: machine('sandPit', 8, 'extractor', 'Sand Pit', 'Dredges pure quartz sand into silicon', [], 'silicon', 1, 1.5, 0.1, undefined, 'conveyor dredge + crystal grower'),
  chipFab: machine('chipFab', 8, 'processor', 'Chip Fab', '2 silicon → two microchips', [{ kind: 'silicon', per: 2 }], 'chip', 2, 2.8, 0.18, { kind: 'silicon', count: 12 }, 'white clean-room block with air vents'),
  uraniumMine: machine('uraniumMine', 9, 'extractor', 'Uranium Mine', 'Robotic diggers in lead-lined suits', [], 'uranium', 1, 1.4, 0.1, undefined, 'shielded headframe, hazard stripes'),
  enricher: machine('enricher', 9, 'processor', 'Enrichment Plant', '2 uranium → a fuel rod', [{ kind: 'uranium', per: 2 }], 'fuelRod', 1, 2.6, 0.18, { kind: 'uranium', count: 12 }, 'centrifuge cascade hall'),
  reactor: machine('reactor', 9, 'processor', 'Reactor', 'A fuel rod → 3 power cells', [{ kind: 'fuelRod', per: 1 }], 'power', 3, 3.2, 0.25, { kind: 'fuelRod', count: 6 }, 'cooling tower + containment dome'),
  // 0.9.7: era 10 runs on rare earth + helium-3, fused into fusion cells (era resources v2). The fusion plant became
  // the Fusion Reactor (a processor), fed by the new Helium Skimmer. The Neural Fab makes two AI cores a cycle, since
  // both the Robot Works and the Quantum Lab use them. Extractors first, then chain order (core/pacing.ts relies on it).
  nanoFab: machine('nanoFab', 10, 'extractor', 'Geode Mine', 'Nano drills cut lavender rare-earth crystals out of the geodes', [], 'rareEarth', 1, 2.0, 0.08, undefined, 'sleek block with holo panels'),
  heliumSkimmer: machine('heliumSkimmer', 10, 'extractor', 'Helium Skimmer', 'A gold ring skims helium-3 from the shimmering frost vents', [], 'helium3', 1, 2.0, 0.08, undefined, 'cream dome hood over a vent, gold collector ring'),
  fusionPlant: machine('fusionPlant', 10, 'processor', 'Fusion Reactor', 'Helium-3 → two fusion cells', [{ kind: 'helium3', per: 1 }], 'fusionCell', 2, 2.6, 0.18, { kind: 'helium3', count: 10 }, 'torus ring reactor with glow'),
  dataCenter: machine('dataCenter', 10, 'processor', 'Neural Fab', 'Rare earth + a fusion cell → two AI cores', [{ kind: 'rareEarth', per: 1 }, { kind: 'fusionCell', per: 1 }], 'aiCore', 2, 3.4, 0.2, { kind: 'rareEarth', count: 10 }, 'server halls with blinking racks'),
  robotWorks: machine('robotWorks', 10, 'processor', 'Robot Works', 'AI core + rare-earth magnets → a robot', [{ kind: 'aiCore', per: 1 }, { kind: 'rareEarth', per: 1 }], 'robot', 1, 3.4, 0.25, { kind: 'aiCore', count: 4 }, 'assembly hall with robot arms'),
  // 0.9.5 eras 8-10: second extractor, second processor and premium line of each era (docs/EXPANSION.md §D)
  goldPanner: machine('goldPanner', 8, 'extractor', 'Gold Panner', 'A rocker sluice washes gold out of the shore', [], 'gold', 1, 2.2, 0.12, undefined, 'rocker sluice with a spinning pan'),
  boardShop: machine('boardShop', 8, 'processor', 'Board Shop', 'Chip + gold → a circuit board', [{ kind: 'chip', per: 1 }, { kind: 'gold', per: 1 }], 'board', 1, 2.8, 0.2, { kind: 'gold', count: 10 }, 'solder line with a pick-and-place head'),
  pcAssembly: machine('pcAssembly', 8, 'processor', 'PC Assembly', 'Board + chip → a cozy home computer', [{ kind: 'board', per: 1 }, { kind: 'chip', per: 1 }], 'computer', 1, 3.4, 0.28, { kind: 'board', count: 8 }, 'assembly bench with a test screen'),
  graphitePit: machine('graphitePit', 9, 'extractor', 'Graphite Pit', 'A dragline scoops soft graphite', [], 'graphite', 1, 2.2, 0.12, undefined, 'dragline over a dark pit'),
  batteryPlant: machine('batteryPlant', 9, 'processor', 'Battery Plant', 'Power cell + graphite → a big battery', [{ kind: 'power', per: 1 }, { kind: 'graphite', per: 1 }], 'battery', 1, 3.2, 0.28, { kind: 'graphite', count: 10 }, 'stacking press with a charge rack'),
  quantumLab: machine('quantumLab', 10, 'processor', 'Quantum Lab', 'AI core + helium-3 to keep it cold → a quantum core', [{ kind: 'aiCore', per: 1 }, { kind: 'helium3', per: 1 }], 'quantumCore', 1, 3.8, 0.3, { kind: 'aiCore', count: 6 }, 'gold chandelier cryostat'),
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
  /**
   * 0.9.12 (Dino: "the area towns and everything" much larger): the depth (from the gate edge) the machine yard,
   * processing grid and hand node are laid out for. The plot is deeper than this; the extra depth goes to a bigger
   * market, a roomier hut green and a longer field, so no machine, node or facility moves and the pacing is unchanged.
   */
  work?: number;
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
  { n: 2, rect: R(-24, 40, 66, 122), gate: 'north', slots: 8, room: 8, work: 48 }, // 64 × 56 (0.9.12: was 48 deep)
  { n: 3, rect: R(-98, -30, 66, 122), gate: 'north', slots: 8, room: 8, work: 52 }, // 68 × 56 (was 52)
  { n: 4, rect: R(-176, -104, 66, 122), gate: 'north', slots: 8, room: 8 }, // 72 × 56
  { n: 5, rect: R(-178, -100, 132, 200), gate: 'north', slots: 8, room: 8, work: 60 }, // 78 × 68 (was 60)
  { n: 6, rect: R(-94, -10, 132, 204), gate: 'north', slots: 8, room: 8, work: 64 }, // 84 × 72 (was 64)
  { n: 7, rect: R(-4, 86, 132, 208), gate: 'north', slots: 8, room: 8, work: 68 }, // 90 × 76 (was 68)
  { n: 8, rect: R(92, 188, 132, 208), gate: 'north', slots: 9, room: 9, work: 72 }, // 96 × 76 (was 72)
  { n: 9, rect: R(90, 192, 218, 304), gate: 'north', slots: 9, room: 9, work: 76 }, // 102 × 86 (was 76)
  { n: 10, rect: R(-24, 84, 218, 308), gate: 'north', slots: 10, room: 10, work: 80 }, // 108 × 90 (was 80)
];
export function regionDef(n: number): RegionLayoutDef {
  const r = REGIONS[n];
  if (!r) throw new Error(`no region ${n}`);
  return r;
}

/**
 * 0.9.12 (Dino: "the town areas should be much larger, with more areas to build on"): the city grid. Every district is
 * CITY_GRID.w × CITY_GRID.d metres (was 30 × 28) with CITY_GRID.street-wide streets between them; the grid starts on
 * the city's west street (x 44) and its first row at z 14, and the last row ends 4 m short of R2 (z 128). The grid
 * streets (ROADS cityV1/cityV2/cityH1/cityH2) are derived from it.
 */
export const CITY_GRID = { x0: 44, z0: 14, w: 44, d: 34, street: 4 } as const;
/** West edge of grid column c (0..2) and north edge of grid row r (0..2). */
export const cityCol = (c: number): number => CITY_GRID.x0 + c * (CITY_GRID.w + CITY_GRID.street);
export const cityRow = (r: number): number => CITY_GRID.z0 + r * (CITY_GRID.d + CITY_GRID.street);
/** East edge of the whole city grid (the skyline starts past it). */
export const CITY_EAST = cityCol(2) + CITY_GRID.w;

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
  { id: 'r3', rect: R(-12, 198, 214, 218), opensAt: 9 }, // 0.9.9: ends past era X's gate, not 36 m on in the snow
  // city (east): the avenue from the town to the districts, then the grid streets (the north-south ones run on to R2 and
  // 0.9.9: end there in a T-junction, 0.6 m onto it, instead of running across it into regions VII and VIII's fences)
  { id: 'cityLink', rect: R(32, 44, 19, 23), opensAt: 2 },
  // 0.9.9: a second, wider way out of the Market Town's east side, between the two east lots, straight on from the
  // corridor mouth's walk across the square to the city's west street
  { id: 'townEast', rect: R(32, 40, 27.8, 32.6), opensAt: 2 },
  { id: 'cityWest', rect: R(40, 44, 14, 128.6), opensAt: 2 },
  { id: 'cityV1', rect: R(cityCol(1) - 4, cityCol(1), 14, 128.6), opensAt: 4 },
  { id: 'cityV2', rect: R(cityCol(2) - 4, cityCol(2), 14, 128.6), opensAt: 7 },
  { id: 'cityH1', rect: R(40, CITY_EAST, cityRow(1) - 4, cityRow(1)), opensAt: 3 },
  { id: 'cityH2', rect: R(40, CITY_EAST, cityRow(2) - 4, cityRow(2)), opensAt: 6 },
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
const D = (n: number, col: number, row: number, lots: number): DistrictDef => ({ n, name: era(n).district, rect: R(cityCol(col), cityCol(col) + CITY_GRID.w, cityRow(row), cityRow(row) + CITY_GRID.d), lots });
/**
 * DISTRICTS[n] for eras 2..10: a 3×3 grid (CITY_GRID) in reading order from the corner nearest the town (0.9.3): II III
 * IV / V VI VII / VIII IX X. 0.9.12: 12/15/18 lots (0.9.11: 6/8/9/12) on bigger plots, always a full 3-row grid; a save's buildings keep
 * their lot numbers. The settlement levels still read the 0.9.11 lot counts (core/demand.ts SETTLEMENT_BASIS), so the
 * new lots are room to build, not a longer climb.
 */
export const DISTRICTS: readonly (DistrictDef | null)[] = [
  null,
  null,
  D(2, 0, 0, 12),
  D(3, 1, 0, 12),
  D(4, 2, 0, 12),
  D(5, 0, 1, 15),
  D(6, 1, 1, 15),
  D(7, 2, 1, 15),
  D(8, 0, 2, 18),
  D(9, 1, 2, 18),
  D(10, 2, 2, 18),
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
  { name: 'Megacity', minPopulation: 80_000, minEra: 8 }, // 0.9.12: 40k → 80k with twice the lots (era 7 alone could hold 40k)
  { name: 'Metropolis', minPopulation: 200_000, minEra: 10 },
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
  /**
   * bond: total return at maturity. index / venture: trend growth per HOUR (0.9.6: was per minute, an AFK money loop),
   * compounding until the trend reaches `top`, where the position stops growing (so a night away can't explode).
   */
  rate: number;
  /** index / venture: random step per price tick of the wobble around the growth trend. */
  volatility: number;
  /** index / venture: the wobble stays within trend × [1 − dip, 1 + rise], so a position never beats top × (1 + rise). */
  dip?: number;
  rise?: number;
  /** index / venture: the most the trend grows a deposit (×). */
  top?: number;
  /** Money in this product may not exceed this share of net worth (bonds 0.5, as in 0.9). */
  cap: number;
  /**
   * 0.9.6 (validation of PR #35): nor this many minutes of the save's recent sales rate (the SalesMeter that offline
   * earnings use; interest and trading are left out of it), so re-investing can never outgrow the factories.
   */
  capMinutes: number;
  /** Era needed before it is offered. */
  era: number;
}

export const INVEST: Record<InvestProductId, InvestProductDef> = {
  // 0.9.11: investing is a side bonus, not a second factory. 0.9.6's rates (bonds +12% per 10 min, the fund ×2.2 and
  // ventures ×3 an hour) on 10 / 10 / 5 minutes of sales added about +50% to sales income (+58% with the Broker), and the
  // era pacing curve (tests/livePacing.test.ts) leaves investing out, so an investor cleared eras a third faster. Now the
  // best play adds about +10% (at most ~+15% with a maxed Broker, checking every price tick): tests/market.test.ts.
  bond: { id: 'bond', label: 'Winter Bonds', blurb: 'Safe and steady; a better Stock Broker pays more. Cash out early for just what you put in', min: 1_000, lock: 600, rate: 0.04, volatility: 0, cap: 0.5, capMinutes: 6, era: 2 },
  // a little better than bonds per 10 minutes (about +5% vs +4%), with no lock but some risk, and a ceiling
  index: { id: 'index', label: 'Snow Index Fund', blurb: 'Tracks the whole market: a bit faster than bonds, no lock, wobbles on the way, doubles at most', min: 1_000, rate: 0.35, volatility: 0.004, dip: 0.08, rise: 0.08, top: 2, cap: 0.3, capMinutes: 6, era: 2 },
  venture: { id: 'venture', label: 'Era Ventures', blurb: 'Back an era: faster growth up to ×3, but it can dip hard', min: 10_000, rate: 0.55, volatility: 0.01, dip: 0.35, rise: 0.15, top: 3, cap: 0.2, capMinutes: 3, era: 3 },
};
export const INVEST_IDS: readonly InvestProductId[] = ['bond', 'index', 'venture'];
/** Total money in bonds may not exceed this share of net worth (keeps the risk-free rate from dominating). */
export const BOND_CAP_SHARE = INVEST.bond.cap;
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
