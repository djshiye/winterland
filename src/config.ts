/**
 * Winterland — single source of truth for layout, tuning and palette.
 *
 * READ-ONLY for feature builders: if you need a new constant, define it locally in
 * your own module (or ask the main session to add it here).
 *
 * World axes (Three.js, Y up, ground plane = XZ, 1 unit ≈ 1 metre).
 * The isometric camera sits toward +X/+Z of its target, so on screen:
 *   -X → upper-left  ("NW" edge: river + giant log)
 *   +Z → lower-left  ("SW" edge: walk-in customer queue)
 *   +X → lower-right ("SE" edge: tricycle road)
 *   -Z → upper-right ("North": highway + mountains, phase-5 expansion)
 * See docs/ARCHITECTURE.md for the ASCII map.
 */

import type { ItemKind } from './core/types';
import { PAD, SNOW, SNOW_SHADE } from './render/palette';
import { ERA_KEYS, ERA_NAMES, MATERIALS, MATERIAL_KINDS, ERA_SCALE, ERAS, MACHINES, MACHINE_IDS, type EraKey, type MachineId, type MaterialKind } from './eras/data';
import { eraPlayerUpgrades, type EraPlayerUpgradeId } from './eras/playerUpgrades';

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface XZ {
  x: number;
  z: number;
}

/** Grid used by world piles: logs lie along the pile's local X axis. */
export interface PileGrid {
  cols: number; // along local X
  rows: number; // along local Z
  layers: number; // stacked upward
  spacing: { x: number; y: number; z: number };
}

/** Rect from centre + size (w along X, d along Z). */
export function rect(cx: number, cz: number, w: number, d: number): Rect {
  return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 };
}

/** Grow a rect by `m` on every side. */
export function inflate(r: Rect, m: number): Rect {
  return { minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m };
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * MASTER PALETTE (art-direction spec; exact values — do not tweak). New code should use these names.
 * Materials: toon() from render/materials.ts (MeshToonMaterial, 3-step cel ramp).
 */
export const COLORS = {
  // Environment
  /** The guide's snow (render/palette.ts SNOW). */
  SNOW_WHITE: SNOW,
  RIVER_BLUE: 0x1ca3ec,
  RIVER_FOAM: 0x74ccf4,
  YARD_DIRT: 0x9e8272,
  DROP_ZONE_GREY: 0x8e969e,
  DROP_ZONE_BORDER: 0xd6dcdf,
  FENCE_WOOD: 0xd68646,
  // Resources
  LOG_BARK: 0xc86d28,
  /** End caps of logs + wood-chip particles. */
  LOG_CORE: 0xf4c46d,
  /** Freshly cut band on the giant log at the active chopping section. */
  LOG_CUT_BAND: 0xf7d070,
  PLANK_WOOD: 0xe29547,
  CRATE_BOX: 0xc68b59,
  CRATE_STRIP: 0x8a5a36,
  CASH_GREEN: 0x4cd964,
  CASH_BAND: 0xffffff,
  // Characters & machines
  PLAYER_COAT: 0x1e6fd9,
  PLAYER_TRIM: 0xffffff,
  PLAYER_SKIN: 0xf5cba7,
  CUSTOMER_BLUE: 0x4fa8f8,
  COURIER_YELLOW: 0xffd026,
  MACHINE_BLUE: 0x1a75ff,
  MACHINE_STEEL: 0x7f8c8d,
  SAW_GLOW: 0xff9f1c,
  // Pads (0.9.8: the look lives in render/palette.ts PAD; the fill and its rings are honey)
  PAD_BG: PAD.ink,
  PAD_BORDER: 0xffffff,
  PAD_FILL: PAD.honey,
} as const;

/**
 * Legacy/semantic colour keys used across the codebase. Every key that has a master-palette
 * equivalent points at it; the rest are derived shades (darker variants of a master colour) or
 * scenery colours the art spec does not cover (pines, rocks, roads, mountains, sky).
 */
export const PALETTE = {
  sky: 0xcfe6f7,
  snow: COLORS.SNOW_WHITE,
  snowShade: SNOW_SHADE,
  yardDirt: COLORS.YARD_DIRT,
  yardDirtDark: 0x8a6f60,
  dropSlab: COLORS.DROP_ZONE_GREY,
  dropSlabEdge: COLORS.DROP_ZONE_BORDER,
  water: COLORS.RIVER_BLUE,
  waterDeep: 0x1588c9,
  foam: COLORS.RIVER_FOAM,
  ice: 0xe4f5ff,
  bark: COLORS.LOG_BARK,
  barkDark: 0xa4561c,
  woodEnd: COLORS.LOG_CORE,
  woodRing: 0xd9a24f,
  plank: COLORS.PLANK_WOOD,
  crate: COLORS.CRATE_BOX,
  crateDark: COLORS.CRATE_STRIP,
  cash: COLORS.CASH_GREEN,
  cashDark: 0x34b84d,
  cashBand: COLORS.CASH_BAND,
  fence: COLORS.FENCE_WOOD,
  fenceDark: 0xb06a33,
  pine: 0x2f7a55,
  pineDark: 0x245f43,
  trunk: 0x8f4f22,
  rock: 0x8f9bab,
  rockDark: 0x6c7889,
  road: 0xa7b3c3,
  asphalt: 0x4b5361,
  roadLine: 0xf6d04d,
  mountain: 0x9fb2c8,
  mountainDark: 0x7d90a8,
  machine: COLORS.MACHINE_BLUE,
  machineDark: 0x125bd1,
  accent: COLORS.COURIER_YELLOW,
  metal: COLORS.MACHINE_STEEL,
  metalDark: 0x5f6b6c,
  rubber: 0x2b2f36,
  playerShirt: COLORS.PLAYER_COAT,
  playerPants: 0x174f9c,
  playerHat: COLORS.PLAYER_COAT,
  skin: COLORS.PLAYER_SKIN,
  customer: COLORS.CUSTOMER_BLUE,
  customerDark: 0x2f8de0,
  trike: COLORS.MACHINE_BLUE,
  truckRed: 0xe2453c,
  truckBlue: 0x3567d6,
  padBase: COLORS.PAD_BG,
  padBorder: COLORS.PAD_BORDER,
  padFill: COLORS.PAD_FILL,
  zoneMarker: 0xffffff,
} as const;

// ---------------------------------------------------------------------------
// Camera / rendering
// ---------------------------------------------------------------------------

export const CAMERA = {
  /** Rotation of the camera around its target. 45° = classic isometric diamond. */
  yawDeg: 45,
  /** Elevation of the camera above the ground plane. */
  pitchDeg: 48,
  /** Distance from target (orthographic: only matters for near/far clipping). */
  distance: 70,
  /** World units visible vertically at zoom 1. */
  viewHeight: 16,
  /** On narrow (portrait) screens never show fewer than this many units across. */
  minViewWidth: 12,
  /** Exponential damping rate for follow (higher = snappier). */
  followLambda: 5,
  /** Phase-5 zoom multiplier (<1 shows more of the world). */
  expansionZoom: 0.8,
} as const;

export const LIGHTING = {
  /** Sun position relative to the camera target (shadows fall toward +X / screen right). */
  sunOffset: { x: -12, y: 24, z: 4 },
  sunIntensity: 2.4,
  sunColor: 0xfff4e0,
  hemiSky: 0xdcefff,
  hemiGround: 0x9fb4cc,
  hemiIntensity: 1.35,
  shadowMapSize: 2048,
  /** Half-size of the orthographic shadow camera box (world units). */
  shadowExtent: 22,
} as const;

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export const PLAYER = {
  speed: 6.4,
  accel: 45,
  decel: 60,
  /** Collision radius (body capsule r 0.35 + a hair). */
  radius: 0.36,
  /** Exponential rate for turning toward movement direction. */
  turnLambda: 14,
  /** Max goods (logs + crates) carried in the arms. */
  armsCapacity: 10,
  /** Max cash bundles drawn on the back (money itself is uncapped). */
  cashVisualCap: 36,
  /**
   * Most goods drawn in the arms: 0.8.0's top load, Strong Arms 40 + Sled Dog 6. The climb's extra capacity
   * (carry 50, dog 12) is carried but hidden behind a "+N" tag, so it costs no draw calls (docs/EXPANSION.md §A1).
   */
  armsRenderCap: 46,
  spawn: { x: -2.5, z: 2.5 } as XZ,
} as const;

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * Item dimensions (art spec). Item meshes are centred on their origin. Logs lie along local X;
 * planks and cash have their long side along local X. stackHeight = vertical pitch when stacked.
 */
export const ITEM_SIZE = {
  /** Small log: r 0.12, length 0.6, LOG_CORE end caps. */
  log: { length: 0.6, radius: 0.12, stackHeight: 0.24 },
  /** Plank bundle (what the walk-in counter displays / sells): 0.5 × 0.12 × 0.3, PLANK_WOOD. */
  plank: { w: 0.5, h: 0.12, d: 0.3, stackHeight: 0.125 },
  /** Crate: 0.45 cube, CRATE_BOX with CRATE_STRIP crossbars. */
  crate: { size: 0.45, stackHeight: 0.46 },
  /** Cash bundle: 0.35 × 0.12 × 0.2, CASH_GREEN with a white band 0.1 × 0.125 × 0.21. */
  cash: { w: 0.35, h: 0.12, d: 0.2, stackHeight: 0.125 },
  /** Wave 8: a wooden chair (the furniture workshop's product), footprint 0.42 × 0.42, stacks 0.5 apart. */
  furniture: { w: 0.42, h: 0.5, d: 0.42, stackHeight: 0.5 },
  // Wave 9 town goods (assets/items.ts). Footprints fit a 0.48 m grid; stackHeight = vertical pitch.
  /** Burlap grain sack (farm → bakery), carried. */
  wheat: { w: 0.4, h: 0.3, d: 0.3, stackHeight: 0.3 },
  /** A round loaf (bakery counter), never carried. */
  bread: { w: 0.36, h: 0.18, d: 0.26, stackHeight: 0.19 },
  /** Wrapped ham cut (ranch → butcher), carried. */
  meat: { w: 0.38, h: 0.24, d: 0.3, stackHeight: 0.25 },
  /** A coil of sausages (butcher counter), never carried. */
  sausage: { w: 0.36, h: 0.14, d: 0.36, stackHeight: 0.15 },
  /** Wooden toy train (toy factory counter), never carried. */
  toy: { w: 0.4, h: 0.26, d: 0.22, stackHeight: 0.27 },
  /** 0.9.0 era materials (eras/data.ts MATERIALS[kind].size). */
  ...(Object.fromEntries(MATERIAL_KINDS.map((k) => [k, MATERIALS[k].size])) as Record<MaterialKind, { w: number; h: number; d: number; stackHeight: number }>),
} as const;

// ---------------------------------------------------------------------------
// Timing / juice
// ---------------------------------------------------------------------------

export const TIMING = {
  /** Spec: every pickup / drop-off / payment arc lasts 0.15 s. */
  arcTime: 0.15,
  arcHeight: 1.2,
  /** Longer, higher "launch" arc for chopped / harvested logs flying into the drop zone. */
  launchTime: 0.5,
  launchHeight: 3.2,
  /** Player picks one item from a pile every N seconds (accelerates to minInterval). */
  pickupInterval: 0.075,
  /** Player drops one item onto a counter / hopper every N seconds. */
  dropInterval: 0.075,
  /** Cash bundle flies from player to an upgrade pad every N seconds. */
  payInterval: 0.045,
  /** Fastest any transfer zone may run after acceleration. */
  minInterval: 0.035,
  /** Axe swing period while standing at the giant log. */
  chopInterval: 0.4,
  /** NPC takes one item from its counter every N seconds. */
  npcTakeInterval: 0.14,
  /**
   * 0.9.3: delivery customers (walk-in buyers, tricycles, trucks, sleds, trains) load twice as fast as townsfolk; their
   * dock upgrade divides this again (up to ×dockLoadMax), so a busy dock turns customers over quickly.
   */
  dockTakeInterval: 0.07,
  /** 0.9.3: the most a dock upgrade speeds loading (its value, clamped). */
  dockLoadMax: 4,
  /** Seconds the player must stand on a pad before cash starts flying (walking across one pays nothing). */
  padHoldDelay: 0.25,
  /** A pad payment takes about this many flights, whatever the cost (each bundle carries cost / N, a multiple of 5). */
  padFlights: 24,
} as const;

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

export const ECONOMY = {
  /** Every physical cash bundle is worth this many dollars. All prices are multiples of it. */
  cashBundleValue: 5,
  startMoney: 0,
  plankPrice: 5, // walk-in customers, per plank bundle (each made from one log)
  cratePrice: 15, // cargo tricycles, per crate
  truckLogPrice: 10, // phase-5 pickup trucks, per log (bulk)
  pinePrice: 20, // Timber Ridge freight trains, per log
  furniturePrice: 60, // wave 8: dog sleds, per piece of furniture (each made from one log)
  // Wave 9 town shops (townsfolk buyers), per item: see BUSINESSES[id].price.
  // How many buyers come and how much they take depends on the village level: see DEMAND.
} as const;

// ---------------------------------------------------------------------------
// Upgrade pads
// ---------------------------------------------------------------------------

export type PadIdConst =
  | 'harvester'
  | 'processor'
  | 'westConveyor'
  | 'eastConveyor'
  | 'megaSaw'
  // wave 7: Timber Ridge + advanced automation
  | 'ridge'
  | 'treeFeller'
  | 'truckLoader'
  | 'cashTubes'
  // wave 8
  | 'workshop';

export interface PadDef {
  id: PadIdConst;
  cost: number;
  x: number;
  z: number;
  size: number;
  label: string;
  /** Icon key drawn on the pad (UpgradePad draws these procedurally on a canvas). */
  icon: 'saw' | 'factory' | 'conveyor' | 'megasaw' | 'ridge' | 'feller' | 'loader' | 'tubes' | 'workshop';
}

export const PADS: Record<PadIdConst, PadDef> = {
  harvester: { id: 'harvester', cost: 150, x: -6.6, z: -4.8, size: 2.2, label: 'HARVESTER', icon: 'saw' },
  processor: { id: 'processor', cost: 700, x: 6.4, z: 6.6, size: 2.2, label: 'PROCESSOR', icon: 'factory' },
  westConveyor: { id: 'westConveyor', cost: 900, x: -2.4, z: 4.6, size: 2.2, label: 'CONVEYOR', icon: 'conveyor' },
  eastConveyor: { id: 'eastConveyor', cost: 900, x: -0.8, z: -3.0, size: 2.2, label: 'CONVEYOR', icon: 'conveyor' },
  megaSaw: { id: 'megaSaw', cost: 3200, x: -6.4, z: -8.2, size: 2.2, label: 'MEGA SAWMILL', icon: 'megasaw' },
  // Wave 7. Spots are proposals: the owning builders validate them against colliders / zones / paths.
  /** In front of the east-fence gate: opens Timber Ridge (LAYOUT.ridge). */
  ridge: { id: 'ridge', cost: 12000, x: 8.4, z: -1.7, size: 1.8, label: 'TIMBER RIDGE', icon: 'ridge' },
  /** On the ridge, by the forest: the tracked tree feller that cuts pines onto the log deck. */
  treeFeller: { id: 'treeFeller', cost: 9000, x: 17.4, z: -8.6, size: 2.0, label: 'TREE FELLER', icon: 'feller' },
  /** Expanded north yard: a belt from the drop zone to the truck counter. */
  truckLoader: { id: 'truckLoader', cost: 10000, x: -1.2, z: -12.5, size: 2.0, label: 'TRUCK LOADER', icon: 'loader' },
  /** Beside the cabin: pneumatic tubes that bank every cash pile. */
  cashTubes: { id: 'cashTubes', cost: 14000, x: 3.4, z: -6.4, size: 2.0, label: 'CASH TUBES', icon: 'tubes' },
  // Wave 8 (proposal; owners validate). On Timber Ridge in front of the workshop site.
  workshop: { id: 'workshop', cost: 15000, x: 28.0, z: 1.2, size: 2.0, label: 'WORKSHOP', icon: 'workshop' },
};

// ---------------------------------------------------------------------------
// World layout (all world units; see header for axis → screen mapping)
// ---------------------------------------------------------------------------

const LOG_GRID_SPACING = { x: 0.66, y: 0.24, z: 0.26 };
const PLANK_GRID_SPACING = { x: 0.52, y: 0.125, z: 0.31 };
const CRATE_GRID_SPACING = { x: 0.48, y: 0.46, z: 0.48 };
export const CASH_GRID: PileGrid = { cols: 3, rows: 3, layers: 10, spacing: { x: 0.37, y: 0.125, z: 0.22 } };
/** Every sales counter is the art-spec wooden table: 1.6 long × 0.6 deep × 0.8 high (FENCE_WOOD). */
const COUNTER_SIZE = { length: 1.6, depth: 0.6, height: 0.8 };

/**
 * 0.9.4: the Market Town was too cramped to walk once everything was built. Everything south of the square's north edge
 * (z 21: the north lots, their pads and the corridor mouth stay put) is stretched along Z by TOWN_STRETCH, so the
 * square, the amenities, the south and east lots and the Grand Market spread out. Building sizes and pad offsets keep
 * their size, so every gap between them grows. Saves keep lot / amenity indices, so old towns load on the new plots.
 */
export const TOWN_STRETCH = 1.5;
export const townZ = (z: number): number => (z <= 21 ? z : Math.round((21 + TOWN_STRETCH * (z - 21)) * 100) / 100);

export const LAYOUT = {
  /** Walkable yard (the player is clamped inside). The -X edge is the river bank (no fence). */
  yard: { minX: -10.2, maxX: 10, minZ: -10, maxZ: 10 } as Rect,
  /** Phase 5 moves the north (-Z) fence out to here. */
  expandedMinZ: -20,

  river: {
    minX: -16.4,
    maxX: -10.4,
    minZ: -90,
    maxZ: 70,
    /** Water surface height (ground is y = 0; the river sits in a channel below it). */
    waterY: -0.35,
    bedY: -1.3,
    /** Flow direction is +Z (from the mountains, upper-right, toward lower-left). */
    flowSpeed: 1.2,
  },

  /** Art spec: cylinder r 1.8, length 12, LOG_BARK; end caps r 1.65 LOG_CORE with 3 darker rings. */
  giantLog: {
    x: -12.6,
    /** Centre height: floats half-submerged (water at -0.35), top at y = 1.55. */
    y: -0.25,
    /** Resting centre Z (after it crashes into the gate). Spans z ∈ [-8, 4]. */
    z: -2,
    length: 12,
    radius: 1.8,
    /** End-cap disc radius (a bark rim shows around it). */
    capRadius: 1.65,
    /** Z of the active chopping section: LOG_CUT_BAND band + where the axe strikes. */
    cutZ: 2.0,
    /** Intro: the log's centre starts here and floats +Z until it hits the gate. */
    introStartZ: -80,
    /** Wooden gate / fence spanning the river just downstream of the log's +Z end. */
    gateZ: 4.6,
    introDuration: 3.2,
  },

  /** Player stands here (river bank, beside the cut band) to auto-swing the axe at the giant log. */
  chopZone: rect(-9.05, 2.0, 2.3, 3.6),

  /** Grey slab (DROP_ZONE_GREY, DROP_ZONE_BORDER rim) where all raw logs land. Capacity 3*7*4 = 84. */
  dropZone: {
    x: -5.2,
    z: -0.4,
    slab: { w: 2.8, d: 2.7 },
    grid: { cols: 3, rows: 7, layers: 4, spacing: LOG_GRID_SPACING } as PileGrid,
    /** Player pickup area (pile footprint is solid; stand next to it). */
    zone: rect(-5.2, -0.4, 3.8, 3.7),
    collider: rect(-5.2, -0.4, 2.1, 2.0),
  },

  /**
   * Straddles the south fence. The player delivers LOGS (inside the yard, -Z side); each one turns
   * into a PLANK BUNDLE on landing; customers (outside, +Z side) buy the planks.
   */
  walkInCounter: {
    x: -4.0,
    z: 9.9,
    /** Long axis along X. */
    ...COUNTER_SIZE,
    rotationY: 0,
    /** Plank bundles on the table top: 36, up to 72 with the Shop Counter upgrade (0.9.2: the grid holds the most it can reach). */
    grid: { cols: 3, rows: 2, layers: 12, spacing: PLANK_GRID_SPACING } as PileGrid,
    baseRoom: 36,
    /** Player stands here (inside the yard) to drop logs on the counter. */
    playerZone: rect(-4.0, 9.0, 2.2, 1.4),
  },

  customers: {
    /** Front of the queue (customer faces -Z toward the counter). */
    front: { x: -4.0, z: 10.95 } as XZ,
    /** Each further customer stands this much further +Z. */
    spacing: 1.1,
    maxQueue: 5,
    spawn: { x: -4.0, z: 32 } as XZ,
    /** After paying, customers walk this path and despawn at the end. */
    exitPath: [
      { x: -2.3, z: 11.9 },
      { x: -2.3, z: 34 },
    ] as XZ[],
    /** Fenced snow path outside the yard (visual only). */
    path: { minX: -5.5, maxX: -1.0, minZ: 10.3, maxZ: 42 } as Rect,
    walkSpeed: 3.2,
  },

  /** Cash grid right beside the walk-in counter (inside the yard). */
  walkInCash: {
    x: -2.0,
    z: 8.8,
    grid: CASH_GRID,
    zone: rect(-2.0, 8.8, 2.2, 2.0),
  },

  processor: {
    /**
     * Art spec: blue tunnel box 1.6 (X) × 1.5 (high) × 1.4 (Z). Logs enter the dark -X opening,
     * crates leave through the +X opening onto the workbench.
     */
    x: 4.4,
    z: -0.4,
    w: 1.6,
    d: 1.4,
    h: 1.5,
    /** Infeed tray in front of the -X opening. Logs lie along X (pointing into the tunnel). */
    hopper: {
      x: 3.05,
      z: -0.4,
      w: 0.9,
      d: 1.0,
      h: 0.4,
      rotationY: 0,
      grid: { cols: 1, rows: 3, layers: 5, spacing: LOG_GRID_SPACING } as PileGrid,
    },
    /** Wooden output workbench (FENCE_WOOD) in front of the +X opening. */
    outputTable: {
      x: 5.95,
      z: -0.4,
      w: 1.1,
      d: 1.1,
      h: 0.75,
      grid: { cols: 2, rows: 2, layers: 3, spacing: CRATE_GRID_SPACING } as PileGrid,
    },
    /** Player feeds logs while standing here. */
    inputZone: rect(2.6, -0.4, 2.4, 2.8),
    /** Player picks crates up while standing here. */
    outputZone: rect(6.1, -0.4, 2.4, 2.8),
    /** Seconds to turn one log into one crate. */
    cycleTime: 1.0,
  },

  /** Straddles the east fence; tricycles stop on the road outside it. */
  seCounter: {
    x: 9.9,
    z: 3.6,
    /** Long axis along Z. */
    ...COUNTER_SIZE,
    rotationY: Math.PI / 2,
    /** Crates on the table top: 12, up to 24 with the Tricycle Dock (0.9.2: the grid holds the most it can reach). */
    grid: { cols: 3, rows: 1, layers: 8, spacing: CRATE_GRID_SPACING } as PileGrid,
    baseRoom: 12,
    playerZone: rect(9.0, 3.6, 1.4, 2.4),
  },

  tricycles: {
    /** Road lane X. Trikes drive +Z: they arrive from -Z (upper right) and leave toward +Z. */
    laneX: 11.9,
    frontZ: 3.6,
    /** Queue extends toward -Z by this spacing. */
    spacing: 3.0,
    maxQueue: 4,
    spawnZ: -45,
    exitZ: 48,
    driveSpeed: 6,
    /** Art spec: open-top cargo tray 0.9 × 0.3 × 0.9, up to 6 crates (2 × 2 base, 2 layers). */
    cargoGrid: { cols: 2, rows: 2, layers: 2, spacing: { x: 0.46, y: 0.46, z: 0.46 } } as PileGrid,
    road: { minX: 10.8, maxX: 14.8, minZ: -70, maxZ: 70 } as Rect,
  },

  /** Cash grid beside the SE counter. */
  seCash: {
    x: 8.9,
    z: 6.0,
    grid: CASH_GRID,
    zone: rect(8.9, 6.0, 2.0, 1.8),
  },

  harvester: {
    /** Rail along the river bank; the machine shuttles between minTravelZ and maxTravelZ. */
    railX: -9.2,
    railMinZ: -7.6,
    railMaxZ: -1.0,
    minTravelZ: -6.8,
    maxTravelZ: -1.8,
    collider: { minX: -10.2, maxX: -8.3, minZ: -7.8, maxZ: -0.8 } as Rect,
    /** Seconds between launched logs. */
    interval: 0.75,
  },

  /** Conveyors have no collider: the player may walk across the rollers. */
  westConveyor: {
    /** Drop zone → walk-in counter (travels +Z). Logs ride across the belt (along X). */
    path: [
      { x: -4.4, z: 1.05 },
      { x: -4.4, z: 9.2 },
    ] as XZ[],
    width: 0.8,
    beltY: 0.5,
    speed: 2.6,
    spacing: 0.4,
  },

  eastConveyor: {
    /** Drop zone → processor infeed tray (travels +X). Logs ride across the belt (along Z). */
    path: [
      { x: -3.8, z: -0.4 },
      { x: 2.5, z: -0.4 },
    ] as XZ[],
    width: 0.8,
    beltY: 0.5,
    speed: 2.6,
    spacing: 0.4,
  },

  megaSaw: {
    /** Giant blade over the river at the log's upstream (-Z) end (the log spans z ∈ [-8, 4]). */
    x: -12.6,
    z: -8.6,
    bladeRadius: 2.3,
    /** Yard-side machine base (solid). */
    base: rect(-9.3, -9.0, 1.8, 1.8),
    cycleTime: 1.4,
    logsPerCycle: 3,
  },

  /** Phase 5: yard grows north (-Z) to LAYOUT.expandedMinZ. */
  expansion: {
    /** Straddles the new north fence; trucks (raw-log buyers) stop on the highway beyond it. */
    truckCounter: {
      x: 1.0,
      z: -19.9,
      ...COUNTER_SIZE,
      rotationY: 0,
      /** Logs on the table: 24, up to 48 with the Truck Dock (0.9.2: the grid holds the most it can reach). */
      grid: { cols: 2, rows: 2, layers: 12, spacing: LOG_GRID_SPACING } as PileGrid,
      baseRoom: 24,
      playerZone: rect(1.0, -19.0, 2.2, 1.4),
    },
    trucks: {
      /** Trucks drive -X along the highway lane; queue extends toward +X (the tunnel). */
      laneZ: -22.6,
      frontX: 1.0,
      spacing: 4.6,
      maxQueue: 3,
      spawnX: 42,
      exitX: -48,
      driveSpeed: 7,
      /** Logs in the pickup bed, lying along the truck: 2 × 5 × 2 = 20 ≥ the biggest order (ECONOMY.truckWant). */
      bedGrid: { cols: 2, rows: 5, layers: 2, spacing: LOG_GRID_SPACING } as PileGrid,
    },
    truckCash: { x: 2.9, z: -18.6, grid: CASH_GRID, zone: rect(2.9, -18.6, 2.0, 1.8) },
  },

  /**
   * Timber Ridge (wave 7): open snow east of the tricycle road (lane x ≈ 11.9), reached through a gate in the yard's
   * east fence and a crossing over the road. Pines in `forest` (the tree feller's work area), a log deck by the
   * feller, a rail platform where freight trains buy pine logs, and the crew bunkhouse.
   * Spots are proposals: the owning builders validate them and report changes.
   */
  ridge: {
    area: { minX: 13.4, maxX: 34, minZ: -18, maxZ: 8 } as Rect,
    /** Gap in the yard's east fence (x = yard.maxX). */
    gate: { minZ: -2.8, maxZ: -0.6 },
    /** Walkable additions once open (centre-space rects, ColliderWorld.addBounds): crossing, then the ridge. */
    walk: [
      { minX: 9.6, maxX: 14.6, minZ: -2.4, maxZ: -1.0 },
      { minX: 14.2, maxX: 32.4, minZ: -16.4, maxZ: 6.4 },
    ] as Rect[],
    forest: { minX: 22, maxX: 31.4, minZ: -16.6, maxZ: -3.2 } as Rect,
    /** Pine logs land here from the feller (pile; player / pine hauler pick up from `zone`). */
    deck: { x: 19.6, z: -5.6, grid: { cols: 3, rows: 4, layers: 4, spacing: LOG_GRID_SPACING } as PileGrid, zone: rect(19.6, -3.9, 2.6, 1.4) },
    /** Freight line along the east edge, trains run along Z (arrive from −Z, leave toward +Z). */
    rail: { x: 33.6, spawnZ: -60, exitZ: 60, stopZ: -0.8 },
    platform: {
      x: 31.4,
      z: 0.2,
      ...COUNTER_SIZE,
      rotationY: Math.PI / 2,
      /** Pine logs: 30, up to 60 with the Rail Platform upgrade (0.9.2). */
      grid: { cols: 2, rows: 3, layers: 10, spacing: LOG_GRID_SPACING } as PileGrid,
      baseRoom: 30,
      playerZone: rect(30.1, 0.2, 1.4, 2.4),
    },
    platformCash: { x: 30.4, z: 3.6, grid: CASH_GRID, zone: rect(30.4, 3.6, 2.0, 1.8) },
    /**
     * Wave 8 furniture workshop (proposal; B6 validates): a log-cabin workshop. Logs go in the west hopper, chairs
     * come out on the east bench. Dog sleds stop on `sledLane` south of it and buy from `sledCounter`.
     */
    workshop: {
      x: 25.0,
      z: 3.2,
      w: 3.2,
      d: 2.0,
      hopper: { x: 22.8, z: 3.2, grid: { cols: 1, rows: 3, layers: 5, spacing: LOG_GRID_SPACING } as PileGrid, zone: rect(21.9, 3.2, 1.2, 1.8) },
      bench: { x: 27.3, z: 3.2, grid: { cols: 2, rows: 2, layers: 4, spacing: { x: 0.48, y: 0.5, z: 0.48 } } as PileGrid, zone: rect(28.2, 3.2, 1.2, 1.8) },
    },
    /** Dog sleds run along X at `z` (arrive from +X, stop with the sled beside the counter, turn back). */
    sledLane: { z: 7.9, spawnX: 60, stopX: 25.0, exitX: 60 },
    sledCounter: {
      x: 25.0,
      z: 6.9,
      ...COUNTER_SIZE,
      rotationY: 0,
      /** Furniture: 18, up to 36 with the Sled Dock upgrade (0.9.2). */
      grid: { cols: 3, rows: 2, layers: 6, spacing: { x: 0.48, y: 0.5, z: 0.48 } } as PileGrid,
      baseRoom: 18,
      playerZone: rect(25.0, 5.9, 2.4, 1.0),
    },
    sledCash: { x: 21.6, z: 6.0, grid: CASH_GRID, zone: rect(21.6, 6.0, 2.0, 1.8) },
    /** Crew bunkhouse: building footprint centre + its construction pad in front of it. */
    quarters: { x: 18.2, z: 1.2, w: 5.0, d: 3.2, pad: { x: 18.2, z: 4.6 }, padSize: 1.8 },
  },

  /** Background scenery (visual only). */
  highway: { z: -23, width: 4.4, minX: -90, maxX: 90 },
  tunnel: { x: 30, z: -23 },
  mountains: { z: -34 },
  /** Cosy cabin in the yard's -Z/+X corner (solid). */
  cabin: rect(7.8, -7.8, 3.6, 3.0),

  /** Upgrade shop: a doormat in front of the cabin door (+Z face, door near x ≈ 7). Standing on it opens the shop panel. */
  shop: {
    mat: rect(7.2, -4.8, 2.2, 1.6),
    /** Where crew members appear when hired and where the cashier drops its cash (the cabin door). */
    door: { x: 7.0, z: -5.9 } as XZ,
  },

  /**
   * Winter village outside the south fence, between the customer path (fence at x = −1) and the tricycle road
   * (x ≥ 10.8). A street runs +Z from a gate in the yard's south fence; plots line both sides of it and the
   * Great Lodge closes its far end. See VILLAGE for costs and levels.
   */
  village: {
    /** Whole village footprint (decor keep-out, village fence). */
    area: { minX: -0.4, maxX: 9.6, minZ: 10.8, maxZ: 31.8 } as Rect,
    /** Gate: a gap in the yard's south fence (z = 10.4), closed until the village is revealed. */
    gate: { minX: 3.4, maxX: 5.8 },
    /** Packed-snow street between the two plot rows. */
    street: { minX: 2.6, maxX: 6.6, minZ: 10.4, maxZ: 27.6 } as Rect,
    /**
     * Extra walkable areas for the player's CENTRE (ColliderWorld.addBounds, no radius shrink): the gate corridor
     * (overlaps the yard) and the street (overlaps the corridor). The player never walks onto the plots.
     */
    walk: [
      { minX: 3.8, maxX: 5.4, minZ: 9.0, maxZ: 11.8 },
      { minX: 2.95, maxX: 6.25, minZ: 11.2, maxZ: 27.3 },
    ] as Rect[],
    /** Square lot size; a building's footprint stays within it (lodge ≈ 2.8 m). */
    plotSize: 3.0,
    /**
     * Plot centres, in unlock order (VILLAGE.plotLevels): rows grow away from the gate. side −1 = west row (the
     * door faces +X), +1 = east row (the door faces −X).
     */
    plots: [
      { x: 1.1, z: 13.4, side: -1 },
      { x: 8.1, z: 13.4, side: 1 },
      { x: 1.1, z: 17.0, side: -1 },
      { x: 8.1, z: 17.0, side: 1 },
      { x: 1.1, z: 20.6, side: -1 },
      { x: 8.1, z: 20.6, side: 1 },
      { x: 1.1, z: 24.2, side: -1 },
      { x: 8.1, z: 24.2, side: 1 },
    ] as { x: number; z: number; side: -1 | 1 }[],
    /**
     * Each plot's construction pad sits in the street: plot centre + (−side × padOffset) along X. Wave 10b: the tiles
     * hug the plots (x 2.6–3.9 and 5.3–6.6) so the middle of the street is a 1.4 m lane that pays for nothing.
     */
    padOffset: 2.15,
    padSize: 1.3,
    /** The Great Lodge (finale building) at the end of the street, its pad in front of it. */
    greatLodge: { x: 4.6, z: 29.6, w: 6.0, d: 3.6, pad: { x: 4.6, z: 26.3 } as XZ, padSize: 1.8 },
  },

  /**
   * Wave 9 Market Town: open snow EAST of the village across the tricycle road and SOUTH of the sled lane's
   * keep-out (z ≤ 11.2). A corridor leaves the village street's south-east end, crosses the road (painted zebra
   * stripes) and enters the market square; 8 lots surround the square. Revealed at village level 3 (Town).
   * Coordinates are proposals: the owning builders validate them and report changes.
   */
  town: {
    /** Whole district footprint (decor keep-out, fences, ground). */
    area: { minX: 15.2, maxX: 38.0, minZ: 13.6, maxZ: townZ(38.6) } as Rect,
    /** Gap in the village's east fence (x = village.area.maxX) where the corridor leaves, closed until revealed. */
    gate: { minZ: 25.9, maxZ: 27.5 },
    /**
     * Walkable additions once revealed (player-centre rects, ColliderWorld.addBounds): the corridor (overlaps the
     * village street) and the square (lots' fronts + pads are inside it; lot footprints are not).
     */
    walk: [
      { minX: 5.4, maxX: 16.4, minZ: 25.9, maxZ: 27.5 },
      { minX: 15.6, maxX: 32.2, minZ: 21.0, maxZ: townZ(35.8) - 2.6 },
    ] as Rect[],
    /**
     * 0.9.2: extra room for the PLAYER only (the townsfolk's routes keep `walk`). The square's edges stopped the player
     * half-way onto the lot pads; this reaches the lot fronts (north z 20.0, south z 33.6) and the strip up to the rail
     * (x 33.6). Buildings, stalls and the fence keep their own colliders.
     */
    playerWalk: { minX: 15.5, maxX: 32.7, minZ: 20.1, maxZ: townZ(35.8) - 2.3 } as Rect,
    /** Packed-snow / cobbled square (visual) and its centrepiece (a big lit fir; solid circle). */
    square: { minX: 15.6, maxX: 32.2, minZ: 21.0, maxZ: townZ(35.8) - 2.6 } as Rect,
    tree: { x: 24.0, z: townZ(27.1), r: 1.3 },
    /** Square lot size; a building's footprint stays within it. */
    lotSize: 4.4,
    /**
     * Lot centres in offer order. `face` = the direction the front (door, counter, pads) faces, toward the square:
     * a unit XZ vector. The lot's construction / business pads sit `padOffset` in front of the lot centre.
     */
    lots: [
      { x: 19.0, z: 17.8, face: { x: 0, z: 1 } },
      { x: 24.6, z: 17.8, face: { x: 0, z: 1 } },
      { x: 19.0, z: townZ(35.8), face: { x: 0, z: -1 } },
      { x: 24.6, z: townZ(35.8), face: { x: 0, z: -1 } },
      { x: 30.2, z: 17.8, face: { x: 0, z: 1 } },
      { x: 30.2, z: townZ(35.8), face: { x: 0, z: -1 } },
      { x: 35.0, z: townZ(23.8), face: { x: -1, z: 0 } },
      { x: 35.0, z: townZ(30.4), face: { x: -1, z: 0 } },
    ] as { x: number; z: number; face: XZ }[],
    padOffset: 3.4,
    padSize: 1.6,
    /** Where townsfolk enter / leave the district (the corridor mouth and a lane off the south-east corner). */
    entrances: [
      { x: 15.0, z: 26.7 },
      { x: 37.6, z: townZ(35.8) - 2.2 },
    ] as XZ[],
    /**
     * Wave 12: fixed amenity sites on the square (built like the Great Lodge: a pad beside each, logs + cash).
     * x / z = site centre, w / d = footprint in the model's frame (front = +Z, which faces the pad along the nearest
     * axis: town/rules.ts amenityFrame); pad = the construction tile centre (any side, >= 0.3 m from the site).
     * Placed (and sized) by the amenities builder so footprint and pad keep >= 0.3 m from the lots, lot pads, lot
     * station zones + shop queue places, benches, stalls, snowman, tree, corridor mouth and lamps, and from each other
     * (tests/townAmenities.test.ts checks all of it).
     */
    amenities: {
      cafe: { x: 21.2, z: townZ(27.25), w: 2.2, d: 1.4, pad: { x: 18.5, z: 33.0 } as XZ },
      pond: { x: 22.5, z: townZ(30.1), w: 2.8, d: 1.8, pad: { x: 24.45, z: townZ(29.7) } as XZ },
      bandstand: { x: 22.5, z: townZ(23.5), w: 2.2, d: 2.2, pad: { x: 24.65, z: townZ(23.9) } as XZ },
      snowmanPark: { x: 28.2, z: townZ(27.1), w: 2.2, d: 1.6, pad: { x: 26.35, z: townZ(27.1) } as XZ },
    },
    amenityPadSize: 1.5,
    /**
     * Wave 13: the Grand Market hall in the south-east corner of the district (clear of the south lots x ≤ 32.4 and
     * the east lots z ≤ 32.6); its pad in front, toward the square. The builder validates clearance.
     */
    grandMarket: { x: 35.4, z: townZ(36.7), w: 4.2, d: 3.0, pad: { x: 35.4, z: townZ(33.9) } as XZ, padSize: 1.8 },
  },
} as const;

// ---------------------------------------------------------------------------
// Upgrades (core/Upgrades.ts). Levels are 0-based and live in GameState.upgrades.
// ---------------------------------------------------------------------------

export type UpgradeIdConst =
  | 'carry'
  | 'speed'
  | 'axe'
  | 'harvester'
  | 'processor'
  | 'megaSaw'
  | 'crateRunner'
  | 'cashier'
  | 'logHauler'
  | 'plankQuality'
  | 'crateQuality'
  | 'bulkDeals'
  // wave 7
  | 'treeFeller'
  | 'cashTubes'
  | 'pineHauler'
  | 'pineContracts'
  // wave 8
  | 'workshop'
  | 'furnitureQuality'
  // wave 9
  | 'porter'
  | 'sledLoader'
  | 'foreman'
  | 'dog'
  // 0.9.2: the delivery docks (bigger counters, more customers)
  | 'trikeDock'
  | 'truckDock'
  | 'shopDock'
  | 'sledDock'
  | 'railDock'
  // 0.9.0 Ages: Jack's swap cart + finance, and three upgrades per era (generated: eraUpgrades below)
  | 'jack'
  | 'taxOffice'
  | 'broker'
  | `${EraKey}${'Rigs' | 'Crew' | 'Dock' | 'Stall' | 'Cash'}`
  // 0.9.5: the player's era upgrades (eras/playerUpgrades.ts)
  | EraPlayerUpgradeId
  // 0.9.5: the rest of each era's crew (six roles beside the Crew hauler), its conveyor belts and one level per machine
  | `${EraKey}${EraRoleKey}`
  | `${EraKey}Belts`
  | MachineId
  // 0.9.5: one quality upgrade per era material (its buyers pay more), in that material's era
  | `${MaterialKind}Quality`;

/**
 * lumberjack + crew + sales: bought in the cabin shop panel (one tab each) · machine: the machine's own pad re-arms
 * as a level pad.
 */
export type UpgradeGroup = 'lumberjack' | 'machine' | 'crew' | 'sales' | 'industry' | 'finance';

/** What a sale is for (sales upgrades multiply one product's price). */
export type ProductId = 'plank' | 'crate' | 'log' | 'pine' | 'furniture' | 'bread' | 'sausage' | 'toy';

export interface UpgradeRequirement {
  /** Minimum village level (index into VILLAGE.levels). */
  villageLevel?: number;
  /** Pad that must already be unlocked. */
  unlocked?: PadIdConst;
  /** Minimum crew bunkhouse tier (GameState.quarters.tier; 0 = the first tier built). */
  quarters?: number;
  /** 0.9.0: minimum era (GameState.eras.age; 1 = Survival). */
  era?: number;
  /** Minimum settlement level (core/demand.ts settlementLevel; the era roles of docs/EXPANSION.md §B perks j = 2 / 4). */
  settlement?: number;
}

export interface UpgradeDef {
  id: UpgradeIdConst;
  group: UpgradeGroup;
  label: string;
  /** One line for the shop card. */
  blurb: string;
  /**
   * Effect at each level (index = level). The last index is the max level.
   * - lumberjack: the raw stat (carry count, walk speed m/s, axe swing interval s).
   * - machine: seconds per cycle (harvester interval, processor / mega-saw cycleTime).
   * - crew: level 0 = not hired (value 0); otherwise a work multiplier on CREW base speed / capacity.
   * - sales: a price multiplier for `product` (core/demand.ts salePrice).
   */
  values: readonly number[];
  /**
   * costs[n] = price to go from level n to n + 1 (length = values.length − 1). Multiples of 5. Era 1 only (Survival +
   * jack): ids from era 2 on leave it empty and are priced on the climb's band curve (core/ladder.ts costAt).
   */
  costs: readonly number[];
  /** Upgrades.describe(): 'count' → "16 items", 'speed' → "7.4 m/s", 'rate' → items per second from an interval, 'crew' → "×1.3". */
  display: 'count' | 'speed' | 'rate' | 'crew' | 'mult' | 'boost' | 'share' | 'income' | 'factor' | 'belt';
  /** sales: the product whose price this multiplies. */
  product?: ProductId;
  /** 0.9.0 industry upgrades: the era they belong to (2..10), for the shop's Industry tab grouping. */
  era?: number;
  /** For display 'rate': items produced per cycle (mega saw: 3 logs per cut). Default 1. */
  perCycle?: number;
  /** Unit word for 'count' / 'rate' ("items", "logs/s", "chops/s"). */
  unit?: string;
  requires?: UpgradeRequirement;
}

/**
 * 0.9.5: the six crew roles every era 2..10 gets beside its `${key}Crew` hauler (docs/EXPANSION.md §D, Survival's
 * crews as the model). One npc/EraWorker class runs them all; the role decides which trips it takes (EraWorker pickJob):
 * - feeder: machine output → the processors that use it (the logHauler's job);
 * - shipper: finished goods and surplus → the export depot (the crateRunner's);
 * - porter: import-dock goods (market orders, the player's drops) → the machines (the porter's);
 * - gatherer: keeps the extractors running: raw material from a filling extractor → a reserve on the import dock;
 * - foreman: carries the era's materials to machine slots the player has started paying for (never cash);
 * - clerk: banks the region's cash (the cashier's job) once sales leave cash, otherwise ships the fullest pile first.
 * `settlement`: band offset of the settlement level that unlocks the role (5·(n − 1) + offset; 0 = era n opens it).
 * `scarf`: the knitted scarf the role wears over the era outfit (and its shop icon's hat): sage, honey, sky, teal,
 * terracotta, lavender, so a glance tells the roles apart (the hauler wears none).
 */
export type EraRoleKey = 'Feeder' | 'Shipper' | 'Porter' | 'Gatherer' | 'Foreman' | 'Clerk';
export type EraRole = 'hauler' | 'feeder' | 'shipper' | 'porter' | 'gatherer' | 'foreman' | 'clerk';
export const ERA_ROLES: readonly { key: EraRoleKey; role: EraRole; settlement: number; blurb: string; scarf: number }[] = [
  { key: 'Feeder', role: 'feeder', settlement: 0, blurb: 'Carries raw material from one machine to the next', scarf: 0x7cc28a },
  { key: 'Shipper', role: 'shipper', settlement: 0, blurb: 'Takes finished goods to the export depot', scarf: 0xf2c14e },
  { key: 'Porter', role: 'porter', settlement: 2, blurb: 'Brings import-dock goods to the machines', scarf: 0x6fa8dc },
  { key: 'Gatherer', role: 'gatherer', settlement: 2, blurb: 'Clears full extractors into a reserve on the dock', scarf: 0x58b8a8 },
  { key: 'Foreman', role: 'foreman', settlement: 4, blurb: 'Hauls materials to machines you are building', scarf: 0xe07a5f },
  { key: 'Clerk', role: 'clerk', settlement: 4, blurb: 'Banks the market cash, then keeps the fullest piles moving', scarf: 0xb48ad6 },
];

/**
 * 0.9.5: role names per era (index = era; 0 and 1 unused), in ERA_ROLES order. docs/EXPANSION.md §D's table; the
 * hauler keeps ERAS[n].worker.
 */
export const ERA_ROLE_NAMES: readonly (readonly string[])[] = [
  [],
  [],
  ['Kiln Feeder', 'Carter', 'Dock Hand', 'Stonebreaker', 'Master Mason', 'Tally Clerk'],
  ['Ore Sorter', 'Rail Carter', 'Lumper', 'Prospector', 'Pit Boss', 'Paymaster'],
  ['Coal Heaver', 'Engine Driver', 'Navvy', 'Coal Picker', 'Chief Engineer', 'Bookkeeper'],
  ['Crane Hand', 'Teamster', 'Stevedore', 'Slag Raker', 'Plant Manager', 'Payroll Clerk'],
  ['Coil Winder', 'Tram Driver', 'Freight Hand', 'Copper Scrapper', 'Electrical Foreman', 'Switchboard Clerk'],
  ['Pipefitter', 'Tanker Driver', 'Dockworker', 'Seep Skimmer', 'Toolpusher', 'Accountant'],
  ['Wafer Handler', 'Courier', 'Logistics Tech', 'Sand Sifter', 'Project Lead', 'Data Clerk'],
  ['Rod Handler', 'Hazmat Driver', 'Decon Porter', 'Crystal Cutter', 'Shift Supervisor', 'Auditor'],
  ['Feeder Bot', 'Courier Drone', 'Dock Bot', 'Prospector Drone', 'Builder Bot', 'Ledger AI'],
];

/** Crew work multipliers (index = stored level; 0 = not hired), shared by every era role. */
const ERA_CREW_VALUES = [0, 1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.3, 2.6, 3.0, 3.5] as const;

export const UPGRADES: Record<UpgradeIdConst, UpgradeDef> = {
  // 0.9.0: Jack, finance and the era upgrades (shop tabs Finance / Industry)
  ...financeUpgrades(),
  ...eraUpgrades(),
  ...eraPlayerUpgrades(),
  ...qualityUpgrades(),
  carry: {
    id: 'carry',
    group: 'lumberjack',
    label: 'Strong Arms',
    blurb: 'Carry more logs and crates',
    values: [10, 13, 16, 19, 22, 25, 28, 31, 35, 40],
    costs: [100, 300, 800, 2000, 5000, 9000, 15000, 24000, 38000],
    display: 'count',
    unit: 'items',
  },
  /** Wave 13: a husky companion. values = extra carry capacity (0 = no dog). */
  dog: {
    id: 'dog',
    group: 'lumberjack',
    label: 'Sled Dog',
    blurb: 'A husky follows you and carries extra logs and crates',
    values: [0, 2, 3, 4, 6],
    costs: [2500, 9000, 25000, 60000],
    display: 'count',
    unit: 'extra items',
    requires: { villageLevel: 2 },
  },
  speed: {
    id: 'speed',
    group: 'lumberjack',
    label: 'Snow Boots',
    blurb: 'Walk faster',
    values: [6.4, 6.9, 7.4, 7.9, 8.4, 9.0, 9.5, 10.0, 10.5, 11.0],
    costs: [80, 250, 700, 1800, 4500, 8000, 13000, 21000, 34000],
    display: 'speed',
  },
  axe: {
    id: 'axe',
    group: 'lumberjack',
    label: 'Sharp Axe',
    blurb: 'Chop the giant log faster',
    values: [0.4, 0.35, 0.31, 0.27, 0.24, 0.21, 0.19, 0.17, 0.15, 0.13],
    costs: [120, 350, 900, 2200, 5500, 9500, 16000, 26000, 40000],
    display: 'rate',
    unit: 'chops/s',
  },
  harvester: {
    id: 'harvester',
    group: 'machine',
    label: 'Harvester',
    blurb: 'Saws logs faster',
    values: [0.75, 0.62, 0.52, 0.44, 0.37, 0.32, 0.28, 0.25],
    costs: [400, 1200, 3000, 7500, 13000, 22000, 36000],
    display: 'rate',
    unit: 'logs/s',
    requires: { unlocked: 'harvester' },
  },
  processor: {
    id: 'processor',
    group: 'machine',
    label: 'Processor',
    blurb: 'Makes crates faster',
    values: [1.0, 0.84, 0.71, 0.6, 0.5, 0.43, 0.37, 0.32],
    costs: [1000, 2800, 7000, 16000, 26000, 40000, 60000],
    display: 'rate',
    unit: 'crates/s',
    requires: { unlocked: 'processor' },
  },
  megaSaw: {
    id: 'megaSaw',
    group: 'machine',
    label: 'Mega Sawmill',
    blurb: 'Cuts the giant log faster',
    values: [1.4, 1.2, 1.03, 0.89, 0.77, 0.67, 0.59, 0.52],
    costs: [7000, 15000, 30000, 55000, 80000, 110000, 150000],
    display: 'rate',
    perCycle: 3,
    unit: 'logs/s',
    requires: { unlocked: 'megaSaw' },
  },
  crateRunner: {
    id: 'crateRunner',
    group: 'crew',
    label: 'Crate Runner',
    blurb: 'Carries crates from the processor to the tricycle counter',
    values: [0, 1, 1.3, 1.65, 2.0, 2.4, 2.8],
    costs: [800, 2000, 5000, 11000, 20000, 34000],
    display: 'crew',
    requires: { villageLevel: 1, unlocked: 'processor' },
  },
  cashier: {
    id: 'cashier',
    group: 'crew',
    label: 'Cashier',
    blurb: 'Collects the cash piles for you',
    values: [0, 1, 1.3, 1.65, 2.0, 2.4, 2.8],
    costs: [1200, 4000, 10000, 22000, 36000, 52000],
    display: 'crew',
    requires: { villageLevel: 2 },
  },
  logHauler: {
    id: 'logHauler',
    group: 'crew',
    label: 'Log Hauler',
    blurb: 'Carries logs to the trucks',
    values: [0, 1, 1.3, 1.65, 2.0, 2.4, 2.8],
    costs: [3500, 9000, 20000, 40000, 60000, 85000],
    display: 'crew',
    requires: { villageLevel: 3, unlocked: 'megaSaw' },
  },
  porter: {
    id: 'porter',
    group: 'crew',
    label: 'Town Porter',
    blurb: 'Keeps the town shops stocked: farm goods and firewood',
    values: [0, 1, 1.3, 1.65, 2.0, 2.4, 2.8],
    costs: [3000, 8000, 18000, 36000, 55000, 80000],
    display: 'crew',
    requires: { villageLevel: 3 },
  },
  // wave 11: automation
  sledLoader: {
    id: 'sledLoader',
    group: 'crew',
    label: 'Sled Loader',
    blurb: 'Carries chairs to the dog sleds and keeps the workshop hopper fed',
    values: [0, 1, 1.3, 1.65, 2.0, 2.4, 2.8],
    costs: [6000, 14000, 28000, 45000, 65000, 90000],
    display: 'crew',
    requires: { unlocked: 'workshop' },
  },
  foreman: {
    id: 'foreman',
    group: 'crew',
    label: 'Foreman',
    blurb: 'Builds for you: hauls logs to the next house or lot and pays for it from your cash',
    values: [0, 1, 1.3, 1.65, 2.0, 2.4, 2.8],
    costs: [20000, 40000, 70000, 110000, 160000, 220000],
    display: 'crew',
    requires: { villageLevel: 4 },
  },
  plankQuality: {
    id: 'plankQuality',
    group: 'sales',
    label: 'Fine Planks',
    blurb: 'Customers pay more for every plank',
    values: [1, 1.15, 1.3, 1.5, 1.75, 2.0],
    costs: [300, 1500, 6000, 18000, 45000],
    display: 'mult',
    product: 'plank',
    requires: { villageLevel: 1 },
  },
  shopDock: {
    id: 'shopDock',
    group: 'sales',
    label: 'Shop Counter',
    blurb: 'A bigger plank counter, and customers come more often and buy faster',
    values: [1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.25, 2.5],
    costs: [300, 900, 2500, 6000, 12000, 22000, 40000],
    display: 'boost',
    requires: { villageLevel: 1 },
  },
  crateQuality: {
    id: 'crateQuality',
    group: 'sales',
    label: 'Sturdy Crates',
    blurb: 'Tricycles pay more for every crate',
    values: [1, 1.15, 1.3, 1.5, 1.75, 2.0],
    costs: [800, 4000, 14000, 35000, 80000],
    display: 'mult',
    product: 'crate',
    requires: { unlocked: 'processor' },
  },
  trikeDock: {
    id: 'trikeDock',
    group: 'sales',
    label: 'Tricycle Dock',
    blurb: 'A bigger crate table, and tricycles come more often and load faster',
    values: [1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.25, 2.5],
    costs: [500, 1500, 4000, 9000, 18000, 32000, 55000],
    display: 'boost',
    requires: { unlocked: 'processor' },
  },
  truckDock: {
    id: 'truckDock',
    group: 'sales',
    label: 'Truck Dock',
    blurb: 'A bigger log table, and trucks come more often and load faster',
    values: [1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.25, 2.5],
    costs: [2500, 7000, 15000, 30000, 55000, 90000, 140000],
    display: 'boost',
    requires: { unlocked: 'megaSaw' },
  },
  bulkDeals: {
    id: 'bulkDeals',
    group: 'sales',
    label: 'Bulk Deals',
    blurb: 'Trucks pay more for every log',
    values: [1, 1.15, 1.3, 1.5, 1.75, 2.0],
    costs: [3000, 12000, 30000, 60000, 120000],
    display: 'mult',
    product: 'log',
    requires: { unlocked: 'megaSaw' },
  },
  // --- wave 7 ---
  treeFeller: {
    id: 'treeFeller',
    group: 'machine',
    label: 'Tree Feller',
    blurb: 'Fells pines faster',
    /** Seconds per tree (drive + cut + topple); each tree yields RIDGE.logsPerTree logs. */
    values: [6, 5.1, 4.3, 3.6, 3.0, 2.5],
    costs: [12000, 24000, 42000, 70000, 110000],
    display: 'rate',
    perCycle: 4,
    unit: 'logs/s',
    requires: { unlocked: 'treeFeller' },
  },
  cashTubes: {
    id: 'cashTubes',
    group: 'machine',
    label: 'Cash Tubes',
    blurb: 'Banks the cash piles faster',
    /** Seconds per bundle sucked from each cash pile. */
    values: [0.9, 0.7, 0.55, 0.42, 0.32, 0.24],
    costs: [16000, 30000, 50000, 80000, 120000],
    display: 'rate',
    unit: 'bundles/s',
    requires: { unlocked: 'cashTubes' },
  },
  pineHauler: {
    id: 'pineHauler',
    group: 'crew',
    label: 'Pine Hauler',
    blurb: 'Carries pine logs from the log deck to the train',
    values: [0, 1, 1.3, 1.65, 2.0, 2.4, 2.8],
    costs: [4000, 10000, 22000, 40000, 65000, 95000],
    display: 'crew',
    requires: { unlocked: 'treeFeller', quarters: 0 },
  },
  railDock: {
    id: 'railDock',
    group: 'sales',
    label: 'Rail Platform',
    blurb: 'A bigger log platform, and trains come more often and load faster',
    values: [1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.25, 2.5],
    costs: [1200, 3500, 8000, 16000, 30000, 50000, 80000],
    display: 'boost',
    requires: { unlocked: 'treeFeller' },
  },
  pineContracts: {
    id: 'pineContracts',
    group: 'sales',
    label: 'Rail Contracts',
    blurb: 'Trains pay more for every pine log',
    values: [1, 1.15, 1.3, 1.5, 1.75, 2.0],
    costs: [8000, 25000, 55000, 100000, 180000],
    display: 'mult',
    product: 'pine',
    requires: { unlocked: 'treeFeller' },
  },
  // wave 8
  workshop: {
    id: 'workshop',
    group: 'machine',
    label: 'Workshop',
    blurb: 'Builds furniture faster',
    values: [3.0, 2.5, 2.1, 1.8, 1.5, 1.3],
    costs: [14000, 26000, 45000, 70000, 100000],
    display: 'rate',
    unit: 'pieces/s',
    requires: { unlocked: 'workshop' },
  },
  sledDock: {
    id: 'sledDock',
    group: 'sales',
    label: 'Sled Dock',
    blurb: 'A bigger furniture table, and dog sleds come more often and load faster',
    values: [1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.25, 2.5],
    costs: [1500, 4000, 9000, 18000, 32000, 55000, 90000],
    display: 'boost',
    requires: { unlocked: 'workshop' },
  },
  furnitureQuality: {
    id: 'furnitureQuality',
    group: 'sales',
    label: 'Fine Joinery',
    blurb: 'Dog sleds pay more for every piece of furniture',
    values: [1, 1.15, 1.3, 1.5, 1.75, 2.0],
    costs: [9000, 24000, 50000, 90000, 160000],
    display: 'mult',
    product: 'furniture',
    requires: { unlocked: 'workshop' },
  },
};

/** Round a price to 3 significant figures, then to a multiple of 5. */
export function price3(v: number): number {
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, v))) - 2);
  return Math.max(5, Math.round(Math.round(v / mag) * mag / 5) * 5);
}

/**
 * The ten-era climb (docs/EXPANSION.md §A): every upgrade of every era tops out at Lv 10 (core/ladder.ts). Past an
 * upgrade's authored max, the price of the step from shown level A to A + 1 is
 *   F(group, A) = weights[group] · unit · bandGrowth^(band − 2) · bandTilt[band] · stepGrowth^(A mod 10), band = floor(A / 10) + 1
 * and a Survival id also never drops below its last authored price × legacyStep per level (0.9.6: 1.01, the lowest
 * that keeps every price strictly rising after price3; the five Survival price upgrades also gain +0.5 a level past
 * their tables, core/ladder.ts, so the post-Lodge climb takes about 80 model minutes, CODE_AUDIT P1-9). 0.9.7: Mastery (a bonus for levels
 * past a hard cap) is gone: no level for sale reaches a cap. Old saves were paid for it once (core/refund.ts).
 */
export const CLIMB = {
  /** Era economy (R11): expansion pads, machines, material values, city prices and income × this (eras/data.ts). */
  eraScale: ERA_SCALE,
  /** Levels per band: era n's gate needs every owned upgrade at shown level bandSize · (n − 1). */
  bandSize: 10,
  /**
   * Calibrated with the pacing model (core/pacing.ts, tests/pacing.test.ts). 0.9.5 ('literal' gate: an era's gate is
   * the previous era's own upgrades at Lv 10, each era's prices in its own band): every era runs longer than the last,
   * era 2 about 90 model minutes, +9 per era, era 10 about 160, a purchase about every 35–60 s, with the buyer walking
   * to each pad or shop mat (PACING.walkPerBuy) and the Founder's Scarf's Renown from Settlement 20.
   */
  unit: 190_000,
  bandGrowth: 4.3,
  stepGrowth: 1.08,
  /**
   * Per-band price multiplier (index = band = the era whose own upgrades it prices; bands past the end use the last), on top of
   * bandGrowth^(band − 2). Era 2 starts from Survival income alone while era 3 inherits a running region, so band 3
   * steps up hard; later bands ease off as each older region's Rigs, sales upgrades and Renown compound less. Solved
   * with the pacing model (bisection per era; re-solved in 0.9.6 after the Trade/Fine merge and the authored Lv 10s, again on the 0.9.6 era chains, and for bands 5-10 on
   * the 0.9.7 era resources v2, whose era 5 sells at its own era's prices now; and for every band on the 0.9.7 plots,
   * whose regions hold 7, 7, 7, 7, 7, 7, 8, 8, 9 machines, so each era earns more and its prices rise to keep its length).
   */
  bandTilt: [1, 1, 2.16, 6.27, 6.64, 6.63, 6.5, 4.29, 3.59, 3.27, 3.11] as readonly number[],
  /**
   * 0.9.9 (Dino: "each era's stuff needs to be SIGNIFICANTLY more expensive"): per-band price growth from one level to
   * the next (index = band; stepGrowth for bands not listed), sized from each era's live income growth Lv 0 → Lv 10
   * (scripts measured with every pile banked), so the late levels of an era cost as much more as the era earns more
   * and money never piles up near the gate. Was 1.08 everywhere (Lv 10 cost 2× Lv 1 while era 2 earned 100× more).
   */
  bandStep: [1.08, 1.08, 1.08, 1.08, 1.08, 1.08, 1.08, 1.08, 1.08, 1.08, 1.08] as readonly number[],
  legacyStep: 1.01,
  weights: { lumberjack: 0.5, machine: 0.8, crew: 0.8, sales: 0.9, industry: 0.9, finance: 1.0 } satisfies Record<UpgradeGroup, number>,
  /**
   * Crew work multiplier clamps past the authored tables (Upgrades.crewStats): walk ×min(v, walkMax), capacity
   * ×min(v, capMax) (Survival crews draw carried meshes, era crews are instanced), cadence ÷min(v, cadenceMax).
   */
  crew: { walkMax: 3.5, capMaxSurvival: 2.8, capMaxEra: 4, cadenceMax: 8 },
  /** Broker factor bond payouts read at most (its Lv 9, the 0.9.5 top): Lv 10 and past only tighten the spread. */
  bondBrokerMax: 3.5,
} as const;

/**
 * The era gate's level convention (docs/EXPANSION.md R4). 'offset': an upgrade introduced in era e shows
 * stored + 10 · (e − 1), so every era asks +10 levels of everything; 'literal': shown = stored for every id.
 * 0.9.5 (Dino): 'literal'. Every era's own upgrades go Lv 1 → 10 and stop there; era n + 1 opens once era n's own
 * upgrades are all at Lv 10 (eras/gate.ts). Prices still climb era by era (core/ladder.ts priceBase).
 */
export const GATE: { mode: 'offset' | 'literal' } = { mode: 'literal' };

/**
 * Settlement levels 6..50 (docs/EXPANSION.md §B; the pure rules are in core/demand.ts). Levels 0..5 stay the village
 * levels (VILLAGE.levels); from Winterland on, level L = 5·(k − 1) + j (band k = era 2..10, j = 1..5) needs age ≥ k
 * and a city population (district residents + region machine staff, the village excluded) of at least P(L). Band 2
 * climbs linearly from 0 to its anchor A₂, later bands geometrically from A_{k−1} to A_k; A_k = anchorShare × the city's
 * capacity through era k (each district (lots − 2) homes + a work building + a landmark, every region slot built),
 * rounded to 2 significant figures. The best level ever reached is saved (state.eras.settlement).
 */
export const SETTLEMENT = {
  max: 50,
  /** Levels per era band. */
  band: 5,
  /** Region staff per built machine of era n: round(staffBase · staffGrowth^(n − 2)), ¼ of an era-n home. */
  staffBase: 10,
  staffGrowth: 2.2,
  anchorShare: 0.75,
  /** Renown: every level past Winterland multiplies sales, exports and city income by this (×2.2 at 45, ×2.3 with founder). */
  renown: 1.02,
  /** Every level's gift pile is worth this many seconds of city income (at least giftMin); a Charter (j = 5) adds charterSeconds. */
  giftSeconds: 60,
  charterSeconds: 300,
  giftMin: 1_000,
  /** The gift pile (walk over it to collect): on the city avenue where the road from the Market Town comes in. */
  giftPile: { x: 42, z: 27, grid: CASH_GRID, zone: rect(42, 27, 2.2, 2.0) },
  /** Perks by band position: j = 3 adds city happiness, j = 4 one more investment position (per band reached). */
  decorHappiness: 0.05,
  investPerBand: 1,
  /**
   * The Founder's Scarf (docs/EXPANSION.md §A2), the Settlement `level` perk: a knitted red-and-gold scarf on the
   * player (entities/Player.ts) and Renown × `renown` on top of the per-level Renown. Not an upgrade (no gate row) and
   * nothing automatic: upgrades stay hands-on.
   */
  founder: { level: 20, renown: 1.05 },
  /** Level names, index = L − 6 (levels 0..5 are VILLAGE.levels). */
  names: [
    'Frontier Post', 'Stone Village', 'Brick Town', 'Kiln Borough', 'Frontier Town',
    'Iron Village', 'Forge Town', 'Mining Borough', 'Railway Town', 'Iron City',
    'Coal Town', 'Gearworks', 'Steam Borough', 'Clockwork Town', 'Steam City',
    'Foundry Town', 'Smokestack Borough', 'Steel Town', 'Factory City', 'Industrial City',
    'Bright Town', 'Copperfield', 'Tram City', 'Radio Town', 'Electric City',
    'Boomtown', 'Derrick City', 'Highway City', 'Skyline City', 'Oil Capital',
    'Silicon Town', 'Circuit City', 'Byte Bay', 'Network City', 'Digital Capital',
    'Atom Town', 'Reactor City', 'Science City', 'Fusion Capital', 'Atomic Metropolis',
    'Smart City', 'Neural City', 'Robot Metropolis', 'Arcology', 'Winterland Prime',
  ] as readonly string[],
} as const;

/** 0.9.0: Jack's swap cart (share of an item's value he pays), the tax office and the broker. */
function financeUpgrades(): Record<'jack' | 'taxOffice' | 'broker', UpgradeDef> {
  return {
    jack: {
      id: 'jack', group: 'finance', label: "Jack's Swap Cart",
      blurb: 'Jack buys anything off your hands. Upgrades make him pay more and take it faster',
      values: [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75],
      costs: [400, 1200, 3000, 8000, 20000, 50000, 120000, 300000, 750000],
      display: 'share',
    },
    taxOffice: {
      id: 'taxOffice', group: 'finance', label: 'City Hall',
      blurb: 'Better bookkeeping: every city building earns more',
      values: [1, 1.15, 1.3, 1.45, 1.6, 1.8, 2.0, 2.25, 2.5, 3.0, 3.6],
      costs: [],
      display: 'income',
      requires: { era: 2 },
    },
    broker: {
      id: 'broker', group: 'finance', label: 'Stock Broker',
      blurb: 'Tighter trading spreads and better bond rates',
      values: [1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.3, 2.6, 3.0, 3.5, 4.2],
      costs: [],
      display: 'factor',
      requires: { era: 2 },
    },
  };
}

/**
 * Upgrades of era n (2..10), eleven authored values each (Lv 0..10; 0.9.6: Lv 10 is authored and the biggest step);
 * every one is bought hands-on at the era's shop mat or the machine's level pad, and caps at Lv 10 (core/ladder.ts
 * capStored): era n + 1 opens once all of them reach it.
 * - `${key}Rigs`: every machine of the era works faster (cycle ÷ value).
 * - `${key}Crew`: hires the era's haulers (0 = none; workers = 1 / 2 / 3 at levels 1 / 4 / 7) and speeds them up.
 * - 0.9.5 `${key}<Role>`: the six other crew roles (ERA_ROLES; workers ERA_ROLE_COUNT).
 * - 0.9.5 `${key}Belts`: conveyor belts between the era's machines (Lv 1 builds them, each level speeds them up).
 * - 0.9.5 one level per machine type (the MachineId): that machine works faster, bought on its level pad.
 * - 0.9.5 `${key}Dock`: the region market's loading dock grows and its buyer vehicles come more often and load faster.
 * - 0.9.5 `${key}Stall`: the region market's stall grows and its walk-in shoppers come more often.
 * No cost tables: every step is priced on the climb's band curve (core/ladder.ts costAt, CLIMB), like taxOffice / broker.
 */
function eraUpgrades(): Record<`${EraKey}${'Rigs' | 'Crew' | 'Belts' | 'Dock' | 'Stall' | 'Cash' | EraRoleKey}` | MachineId, UpgradeDef> {
  const out = {} as Record<`${EraKey}${'Rigs' | 'Crew' | 'Belts' | 'Dock' | 'Stall' | 'Cash' | EraRoleKey}` | MachineId, UpgradeDef>;
  ERA_KEYS.forEach((key, i) => {
    const n = i + 2;
    const name = ERA_NAMES[n]!;
    const band = 5 * (n - 1);
    out[`${key}Rigs`] = {
      id: `${key}Rigs`, group: 'industry', era: n, label: `${name} Rigs`, blurb: `Every ${name} machine works faster`,
      values: [1, 1.15, 1.3, 1.5, 1.7, 1.9, 2.15, 2.4, 2.7, 3.0, 3.6], costs: [],
      display: 'boost', requires: { era: n },
    };
    out[`${key}Belts`] = {
      id: `${key}Belts`, group: 'industry', era: n, label: `${name} Belts`, blurb: 'Conveyor belts link the machines that feed each other',
      values: [0, 1, 1.15, 1.3, 1.45, 1.6, 1.8, 2.0, 2.25, 2.5, 2.9], costs: [],
      display: 'belt', requires: { era: n },
    };
    out[`${key}Crew`] = {
      id: `${key}Crew`, group: 'crew', era: n, label: ERAS[n]?.worker.label ?? `${name} Crew`, blurb: `Haulers move ${name} materials wherever they are needed`,
      values: ERA_CREW_VALUES, costs: [],
      display: 'crew', requires: { era: n },
    };
    ERA_ROLES.forEach((r, k) => {
      const id = `${key}${r.key}` as const;
      out[id] = {
        id, group: 'crew', era: n, label: ERA_ROLE_NAMES[n]![k]!, blurb: r.blurb,
        values: ERA_CREW_VALUES, costs: [],
        display: 'crew', requires: r.settlement > 0 ? { era: n, settlement: band + r.settlement } : { era: n },
      };
    });
    for (const m of MACHINE_IDS) {
      const d = MACHINES[m];
      if (d.era !== n) continue;
      out[m] = {
        id: m, group: 'machine', era: n, label: d.label, blurb: `Every ${d.label} works faster`,
        values: [1, 1.06, 1.12, 1.18, 1.24, 1.3, 1.36, 1.42, 1.48, 1.54, 1.6], costs: [],
        display: 'boost', requires: { era: n },
      };
    }
    // 0.9.5: the region market (eras/RegionMarket.ts), era 1's Truck Dock and Shop Counter for the era's buyers
    out[`${key}Dock`] = {
      id: `${key}Dock`, group: 'sales', era: n, label: `${name} Loading Dock`, blurb: 'A bigger loading dock: buyers drive up more often and load faster',
      values: [1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.25, 2.5, 2.75, 3.0, 3.5], costs: [],
      display: 'boost', requires: { era: n },
    };
    out[`${key}Stall`] = {
      id: `${key}Stall`, group: 'sales', era: n, label: `${name} Market Stall`, blurb: 'A bigger market stall: shoppers drop by more often',
      values: [1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.25, 2.5, 2.75, 3.0, 3.5], costs: [],
      display: 'boost', requires: { era: n },
    };
    // 0.9.5: the era's cash machine (eras/CashMachine.ts), era 1's Cash Tubes: Lv 1 builds it on its level pad by the
    // market cash pile, every level banks faster. Pad-only (group 'machine'), like the machine levels.
    const cash = eraCashMachine(n)!;
    out[`${key}Cash`] = {
      id: `${key}Cash`, group: 'machine', era: n, label: cash.label, blurb: 'Banks the market cash pile for you',
      // bundles a second (0 = not built; Lv 10 ≈ era 1's best Cash Tubes ×1.4)
      values: [0, 1.2, 1.5, 1.8, 2.2, 2.6, 3.1, 3.6, 4.2, 4.9, 5.6], costs: [],
      display: 'count', unit: 'bundles/s', requires: { era: n },
    };
  });
  return out;
}

/** 0.9.5: workers of one era role per stored level: 1 from level 1, 2 from 4, 3 from 7 (like the haulers). */
export function eraRoleCount(level: number): number {
  return level <= 0 ? 0 : level < 4 ? 1 : level < 7 ? 2 : 3;
}

/**
 * 0.9.5: each era's cash machine (docs/EXPANSION.md §D; ids as in the era content template), index = era 2..10. It banks
 * the region market's cash pile like era 1's Cash Tubes (eras/CashMachine.ts). A function, not a const: eraUpgrades()
 * reads it while UPGRADES is built, before the rest of this file has run.
 */
export function eraCashMachine(n: number): { id: string; label: string } | undefined {
  return [
    undefined,
    undefined,
    { id: 'strongbox', label: 'Strongbox' },
    { id: 'mintChute', label: 'Mint Chute' },
    { id: 'pneumaticTubes', label: 'Pneumatic Tubes' },
    { id: 'bankVault', label: 'Bank Vault' },
    { id: 'tillLine', label: 'Till Line' },
    { id: 'driveThruVault', label: 'Drive-Thru Vault' },
    { id: 'atmNetwork', label: 'ATM Network' },
    { id: 'atomicVault', label: 'Atomic Vault' },
    { id: 'quantumBank', label: 'Quantum Bank' },
  ][n];
}

/** 0.9.0: era workers per `${key}Crew` level (index = level; 0 = not hired). */
export const ERA_CREW_COUNT: readonly number[] = [0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3];

/**
 * 0.9.5: `${kind}Quality` for every era material, era 1's Fine Planks / Sturdy Crates for the eras. It belongs to the
 * material's own era (MATERIALS[kind].era). 0.9.6 (decision 9): the era's Trade upgrade is merged into it, so it is the
 * one sales upgrade per material: buyers pay this much more for it at every counter (export depot, loading dock, stall;
 * core/Market.ts salesMult). Its table is about the old Trade × Fine product, Lv 10 the biggest step. Old saves carry
 * max(Trade, Fine) over (core/Save.ts).
 */
function qualityUpgrades(): Record<`${MaterialKind}Quality`, UpgradeDef> {
  const out = {} as Record<`${MaterialKind}Quality`, UpgradeDef>;
  for (const kind of MATERIAL_KINDS) {
    const m = MATERIALS[kind];
    out[`${kind}Quality`] = {
      id: `${kind}Quality`, group: 'sales', era: m.era, label: `Fine ${m.label}`, blurb: `${m.label} sells for more, wherever you sell it`,
      values: [1, 1.15, 1.3, 1.5, 1.75, 2.0, 2.3, 2.65, 3.05, 3.5, 4.2], costs: [],
      display: 'mult', requires: { era: m.era },
    };
  }
  return out;
}

/**
 * 0.9.5: every era region's market (eras/RegionMarket.ts) in its layout zone (eras/layout.ts zones.market): a loading
 * dock by the fence where buyer vehicles (npc/EraBuyers.ts) stop on the road, and a market stall where walk-in shoppers
 * (npc/EraShoppers.ts) queue, both paying into the market's cash pile (era 1's CashPile: the player or a crew collects
 * it). The export depot hands what it receives to the dock (raw goods) or the stall (refined goods) while they have
 * room, and sells at once only when both are full. Buyers pay the depot price × the material's Quality upgrade.
 * `${key}Dock` / `${key}Stall` multiply room, arrival rate and loading speed (up to TIMING.dockLoadMax) like era 1's
 * docks.
 */
export const TRADE_POST = {
  /** Room on each counter at ×1 (× the dock / stall value, up to the grid's 5 × 2 × 4 = 40). */
  room: 14,
  grid: { cols: 5, rows: 2, layers: 4, spacing: { x: 0.56, y: 0.34, z: 0.4 } } as PileGrid,
  /** Seconds between two vehicles at Dock ×1 (÷ the Dock value) and units per order. */
  gap: [7, 11] as readonly [number, number],
  want: [4, 10] as readonly [number, number],
  maxWant: 12,
  maxQueue: 3,
  /** Metres between queued vehicles (a pickup is about 3.6 m long). */
  spacing: 4.6,
  driveSpeed: 6.5,
  /** A buyer at the counter that gets nothing for this long pays for what it has and leaves. */
  patience: 5,
  /** Material in the pickup bed: 3 × 3 × 2 = 18 ≥ maxWant. */
  bedGrid: { cols: 3, rows: 3, layers: 2, spacing: { x: 0.44, y: 0.32, z: 0.48 } } as PileGrid,
  /** Walk-in shoppers: seconds between two at Stall ×1, units each, line length, walk speed. */
  shopGap: [4, 7] as readonly [number, number],
  shopWant: [1, 4] as readonly [number, number],
  shopQueue: 4,
  shopSpacing: 1.1,
  walkSpeed: 2.6,
} as const;

/** 0.9.0: era worker base stats at work multiplier 1 (×`${key}Crew` value). */
export const ERA_WORKER = { walkSpeed: 3.6, capacity: 6 } as const;

/** Crew base stats at work multiplier 1 (UPGRADES[id].values[level] scales them; capacity rounds down). */
export const CREW = {
  crateRunner: { walkSpeed: 3.0, capacity: 4 },
  /** Capacity in cash bundles. */
  cashier: { walkSpeed: 3.4, capacity: 16 },
  logHauler: { walkSpeed: 3.0, capacity: 6 },
  pineHauler: { walkSpeed: 3.0, capacity: 6 },
  /** Wave 9: carries producer goods (wheat, meat) and drop-zone firewood to the town shops' hoppers. */
  porter: { walkSpeed: 3.2, capacity: 6 },
  /** Wave 11. */
  sledLoader: { walkSpeed: 3.2, capacity: 6 },
  /** Capacity in logs; cash is paid directly from the wallet (ConstructionPad.payDirect). */
  foreman: { walkSpeed: 3.0, capacity: 8 },
} as const;

/** Wave 11: crew priorities (GameState.priorities) and the foreman's rules. */
export type WoodPriority = 'balanced' | 'trucks' | 'trains' | 'workshop';
export type TownPriority = 'balanced' | 'bakery' | 'butcher' | 'toys';
export const PRIORITIES = {
  wood: ['balanced', 'trucks', 'trains', 'workshop'] as readonly WoodPriority[],
  town: ['balanced', 'bakery', 'butcher', 'toys'] as readonly TownPriority[],
  /** Score bonus for the favoured target in pickJob / pickStop style scoring. */
  weight: 1.5,
  /** The foreman keeps this share of the wallet (and at least `reserveMin`) untouched. */
  reserveShare: 0.2,
  reserveMin: 500,
  /** Cash per foreman payment chunk and seconds between chunks at work multiplier 1. */
  payChunk: 250,
  payInterval: 0.35,
  /** The workshop hopper is "low" below this many logs (sled loader / pine hauler top-up). */
  workshopLow: 6,
} as const;

/**
 * Crew bunkhouse ("living quarters") on Timber Ridge, built like a shelter (logs + cash on a construction pad,
 * ridge/Quarters.ts). Each tier houses more helpers: `crew[role]` = how many of that role may work (index = tier + 1,
 * so [0] applies before the bunkhouse exists). Read through core/crew.ts crewSlots().
 */
export const QUARTERS = {
  tiers: [
    { id: 'bunkhouse', label: 'Bunkhouse', logs: 30, cash: 8000 },
    { id: 'lodge', label: 'Crew Lodge', logs: 50, cash: 25000 },
    { id: 'hall', label: 'Crew Hall', logs: 80, cash: 60000 },
  ],
  crew: {
    crateRunner: [1, 2, 2, 3],
    cashier: [1, 1, 2, 3],
    logHauler: [1, 1, 2, 3],
    porter: [1, 1, 2, 3],
    pineHauler: [1, 1, 2, 3],
    sledLoader: [1, 1, 2, 2],
    foreman: [1, 1, 1, 2],
  },
} as const;

/** Timber Ridge (wave 7): the forest the tree feller works, trains, the bunkhouse. Layout in LAYOUT.ridge. */
export const RIDGE = {
  /** Pine logs per felled tree. */
  logsPerTree: 4,
  /** Seconds before a felled tree's stump grows back into a full pine. */
  regrowSeconds: 40,
} as const;

/**
 * New Season (prestige, after the finale): the run restarts from scratch, the season count survives. Every season
 * adds `bonusPerSeason` to all sale prices (core/demand.ts) and `startMoneyPerSeason` to the starting money.
 */
export const PRESTIGE = {
  bonusPerSeason: 0.25,
  startMoneyPerSeason: 250,
} as const;

// ---------------------------------------------------------------------------
// Village: shelters, population, levels (village/Village.ts) and the demand they drive (core/demand.ts)
// ---------------------------------------------------------------------------

export type ShelterTierId = 'tent' | 'hut' | 'cabin' | 'lodge';

export interface ShelterTier {
  id: ShelterTierId;
  label: string;
  /** Logs delivered from the player's arms. */
  logs: number;
  /** Dollars paid from the player's cash. */
  cash: number;
  /** Villagers living in it (replaces the previous tier's count). */
  residents: number;
  /** Village level needed before this tier can be built. */
  requiresLevel: number;
}

export interface VillageLevelDef {
  name: string;
  /** Population needed to reach this level. */
  minPopulation: number;
  /** Shown on the level-up toast. */
  perks: readonly string[];
}

export const VILLAGE = {
  tiers: [
    { id: 'tent', label: 'Tent', logs: 6, cash: 60, residents: 2, requiresLevel: 0 },
    { id: 'hut', label: 'Hut', logs: 12, cash: 350, residents: 4, requiresLevel: 1 },
    { id: 'cabin', label: 'Cabin', logs: 24, cash: 1500, residents: 7, requiresLevel: 2 },
    { id: 'lodge', label: 'Lodge', logs: 36, cash: 4500, residents: 12, requiresLevel: 3 },
  ] as readonly ShelterTier[],
  /** plotLevels[i]: village level at which plot i (LAYOUT.village.plots[i]) is offered. */
  plotLevels: [0, 0, 1, 1, 2, 2, 3, 3] as readonly number[],
  /**
   * Levels by population. The last one ("Winterland") is never reached by population: it is granted when the Great
   * Lodge is built (the finale).
   */
  levels: [
    { name: 'Camp', minPopulation: 0, perks: [] },
    { name: 'Hamlet', minPopulation: 4, perks: ['Customers buy more', 'Huts', 'Crate Runner for hire'] },
    { name: 'Village', minPopulation: 14, perks: ['Bigger orders, better prices', 'Cabins', 'Cashier for hire'] },
    { name: 'Town', minPopulation: 36, perks: ['The Market Town opens', 'Lodges', 'Log Hauler for hire'] },
    { name: 'Winter City', minPopulation: 110, perks: ['Top prices', 'Build the Great Lodge!'] },
    { name: 'Winterland', minPopulation: Number.POSITIVE_INFINITY, perks: ['Everyone loves your mill'] },
  ] as readonly VillageLevelDef[],
  greatLodge: { label: 'GREAT LODGE', logs: 100, cash: 25000, requiresLevel: 4 },
  /** Wave 13: the Winterland-era finale on the square; it also takes toys from the toy factory. */
  grandMarket: { label: 'GRAND MARKET', logs: 120, cash: 60000, toys: 20, requiresLevel: 5 },
} as const;

/** What buyers do at each village level (index = GameState.village.level). Read live at spawn / pay time. */
export interface DemandLevel {
  /** Seconds between walk-in customer spawns. */
  customerGap: readonly [number, number];
  customerQueue: number;
  /** Planks per customer. */
  customerWant: readonly [number, number];
  trikeGap: readonly [number, number];
  /** Crates per tricycle (cargo tray holds at most 8). */
  trikeWant: readonly [number, number];
  truckGap: readonly [number, number];
  /** Logs per truck (bed holds at most 20). */
  truckWant: readonly [number, number];
  /** Freight trains on Timber Ridge (wave 7): seconds between trains and pine logs per train. */
  trainGap: readonly [number, number];
  trainWant: readonly [number, number];
  /** Every sale's amount is multiplied by this, then rounded to a multiple of cashBundleValue. */
  priceMult: number;
  /** Wave 8: share of walk-in customers who are VIPs (tip VIP.tipMult × the sale on top). */
  vipChance: number;
  /** Wave 8: dog sleds at the workshop (seconds between sleds, furniture per sled). */
  sledGap: readonly [number, number];
  sledWant: readonly [number, number];
}

export const DEMAND: readonly DemandLevel[] = [
  // Camp: the original phase 1–5 tuning.
  { customerGap: [1.0, 1.5], customerQueue: 5, customerWant: [2, 4], trikeGap: [2.5, 4], trikeWant: [3, 6], truckGap: [3, 5], truckWant: [8, 12], trainGap: [9, 13], trainWant: [16, 24], priceMult: 1, vipChance: 0, sledGap: [12, 16], sledWant: [3, 5] },
  { customerGap: [0.9, 1.35], customerQueue: 6, customerWant: [2, 5], trikeGap: [2.3, 3.6], trikeWant: [3, 6], truckGap: [3, 5], truckWant: [8, 12], trainGap: [9, 13], trainWant: [16, 24], priceMult: 1.2, vipChance: 0.06, sledGap: [12, 16], sledWant: [3, 5] },
  { customerGap: [0.8, 1.2], customerQueue: 6, customerWant: [3, 6], trikeGap: [2.1, 3.3], trikeWant: [4, 7], truckGap: [2.8, 4.5], truckWant: [9, 13], trainGap: [8, 12], trainWant: [18, 26], priceMult: 1.45, vipChance: 0.08, sledGap: [11, 15], sledWant: [4, 6] },
  { customerGap: [0.7, 1.05], customerQueue: 7, customerWant: [3, 7], trikeGap: [1.9, 3.0], trikeWant: [4, 8], truckGap: [2.6, 4.2], truckWant: [10, 15], trainGap: [7.5, 11], trainWant: [20, 28], priceMult: 1.75, vipChance: 0.1, sledGap: [10, 14], sledWant: [4, 7] },
  { customerGap: [0.6, 0.9], customerQueue: 7, customerWant: [4, 8], trikeGap: [1.7, 2.7], trikeWant: [5, 8], truckGap: [2.4, 3.8], truckWant: [11, 17], trainGap: [7, 10], trainWant: [22, 30], priceMult: 2.1, vipChance: 0.12, sledGap: [9, 13], sledWant: [5, 8] },
  { customerGap: [0.55, 0.8], customerQueue: 7, customerWant: [4, 9], trikeGap: [1.6, 2.5], trikeWant: [5, 8], truckGap: [2.2, 3.5], truckWant: [12, 18], trainGap: [6.5, 9], trainWant: [24, 32], priceMult: 2.5, vipChance: 0.14, sledGap: [8, 12], sledWant: [6, 9] },
];

/** Wave 8: VIP walk-in customers (gold scarf, crown bubble); chance per DEMAND row. */
export const VIP = {
  /** The tip is this share of the sale, paid on top (rounded to whole bundles). */
  tipMult: 1.0,
} as const;

/**
 * Wave 8: rush hours (core/Rush.ts). Once the village reaches `minVillageLevel`, every `every` seconds a rush of
 * `seconds` starts: walk-in customers and tricycles arrive `spawnMult`× as often. Transient (not saved).
 */
/**
 * Wave 13: world events (core/WorldEvents.ts). One at a time, every `every` seconds once the village is a Village;
 * transient (not saved). Snowstorm: slower walking, shops burn firewood faster, heavy snowfall. Festival: townsfolk
 * buy twice as often. Aurora: a strong aurora and better prices, only at night.
 */
export type EventKind = 'snowstorm' | 'festival' | 'aurora';
export const EVENTS = {
  minVillageLevel: 2,
  every: [240, 420] as readonly [number, number],
  kinds: {
    snowstorm: { seconds: 60, walkSpeedMult: 0.6, firewoodMult: 2, snowfall: 3, label: 'Snowstorm!', hint: 'Slow going, and the shops burn firewood fast' },
    festival: { seconds: 90, townBuyMult: 2, label: 'Festival day!', hint: 'Townsfolk buy twice as much' },
    aurora: { seconds: 120, priceMult: 1.25, requiresNight: true, label: 'Northern lights!', hint: 'Every sale pays 25% more' },
  },
} as const;

/**
 * Wave 13: delivery contracts (core/Contracts.ts). One offer at a time from the village gate's notice board: sell
 * `count` of `kind` within `seconds` for a cash `bonus` on top of the sales. Saved (state.contract).
 * 0.9.6 (F9): `offers` are Survival's (era 1, frozen). From era 2 on a contract follows the current era instead: one of
 * that era's materials its built machines make, `era.count` of them, for a bonus of `era.incomeSeconds` of the
 * player's recent sales (never below `era.minShare` × the goods' own export value), so it stays worth a few minutes
 * of play in every era rather than "15 sausages · +$2,500" at $218B.
 */
export const CONTRACTS = {
  minVillageLevel: 3,
  every: [150, 260] as readonly [number, number],
  seconds: 180,
  era: { count: [20, 40] as readonly [number, number], incomeSeconds: 120, minShare: 0.5 },
  offers: [
    { kind: 'plank', count: 40, bonus: 800, requires: null },
    { kind: 'crate', count: 30, bonus: 1200, requires: 'processor' },
    { kind: 'bread', count: 20, bonus: 1500, requires: 'bakery' },
    { kind: 'furniture', count: 12, bonus: 2000, requires: 'workshop' },
    { kind: 'sausage', count: 15, bonus: 2500, requires: 'butcher' },
    { kind: 'toy', count: 10, bonus: 3000, requires: 'toyFactory' },
  ] as readonly { kind: ItemKind; count: number; bonus: number; requires: PadIdConst | BusinessId | null }[],
} as const;

export const RUSH = {
  minVillageLevel: 1,
  every: [150, 240] as readonly [number, number],
  seconds: 35,
  spawnMult: 2.2,
} as const;

/**
 * Wave 8: day / night (core/DayNight.ts). One full day lasts `cycleSeconds`; the clock is saved (state.clock).
 * darkness(t) is 0 by day and rises to 1 at midnight over `duskShare` of the cycle on each side.
 * Purely visual + a Settings toggle (localStorage, outside the save).
 */
export const DAYNIGHT = {
  cycleSeconds: 480,
  /** Cycle share (0..1) of: start of dusk, full night, start of dawn, full day (wraps). */
  duskStart: 0.55,
  nightFull: 0.65,
  dawnStart: 0.88,
  dayFull: 0.98,
  /** A fresh game starts in the morning. */
  startAt: 0.05,
} as const;

// ---------------------------------------------------------------------------
// Wave 9: the Market Town (town/Town.ts, town/Business.ts, npc/Townsfolk.ts). Eras ARE the village levels
// (VILLAGE.levels): every town building adds people (jobs / residents) to the population that drives them.
// ---------------------------------------------------------------------------

export type BusinessId = 'farm' | 'bakery' | 'townhouse' | 'ranch' | 'butcher' | 'toyFactory';

/**
 * - producer: makes `output` from nothing (just its workers) onto an out pile the player / porters carry from.
 * - shop: consumes `inputs` (hopper, fed from the player's arms) and puts `output` on its own counter, where
 *   townsfolk buy it and pay into the shop's till (a CashPile).
 * - home: houses `people` residents; makes nothing.
 */
export type BusinessKind = 'producer' | 'shop' | 'home';

export interface BusinessDef {
  id: BusinessId;
  kind: BusinessKind;
  label: string;
  /** One line for the build panel. */
  blurb: string;
  /** Minimum village level (era) before it can be chosen. */
  era: number;
  /** Construction cost (paid like a shelter on the lot's construction pad). */
  logs: number;
  cash: number;
  /** People it brings to the population: jobs (producer / shop) or residents (home). */
  people: number;
  /** Items consumed per cycle (shop; producers take none). Kinds must be carriable: log, crate, wheat, meat. */
  inputs: readonly { kind: ItemKind; per: number }[];
  /** What one cycle makes; null for homes. */
  output: ItemKind | null;
  /** Items one cycle makes (default 1): a shop turns one hopper load into a small batch, so every haul counts. */
  batch?: number;
  /** Seconds per cycle. */
  cycle: number;
  /** Shop: price per item sold to townsfolk (before village / season multipliers; core/demand salePrice). */
  price: number;
  /** Townsfolk buy between want[0] and want[1] items per visit (shops). */
  want: readonly [number, number];
  /** Out pile / counter capacity in items. */
  capacity: number;
}

export const BUSINESSES: Record<BusinessId, BusinessDef> = {
  farm: {
    id: 'farm', kind: 'producer', label: 'Farm', blurb: 'Grows wheat in a warm greenhouse',
    era: 3, logs: 24, cash: 2500, people: 4, inputs: [], output: 'wheat', cycle: 2.6, price: 0, want: [0, 0], capacity: 24,
  },
  bakery: {
    id: 'bakery', kind: 'shop', label: 'Bakery', blurb: 'Wheat + firewood → fresh bread',
    era: 3, logs: 30, cash: 4000, people: 6,
    inputs: [{ kind: 'wheat', per: 1 }, { kind: 'log', per: 1 }], output: 'bread', batch: 3, cycle: 3.0, price: 30, want: [2, 5], capacity: 18,
  },
  townhouse: {
    id: 'townhouse', kind: 'home', label: 'Townhouse', blurb: 'A cosy home for 10 townsfolk',
    era: 3, logs: 40, cash: 6000, people: 10, inputs: [], output: null, cycle: 0, price: 0, want: [0, 0], capacity: 0,
  },
  ranch: {
    id: 'ranch', kind: 'producer', label: 'Ranch', blurb: 'Cows and pigs in a snug barn',
    era: 3, logs: 30, cash: 5000, people: 4, inputs: [], output: 'meat', cycle: 3.2, price: 0, want: [0, 0], capacity: 24,
  },
  butcher: {
    id: 'butcher', kind: 'shop', label: 'Butcher', blurb: 'Meat + smoking wood → sausages',
    era: 3, logs: 36, cash: 9000, people: 6,
    inputs: [{ kind: 'meat', per: 1 }, { kind: 'log', per: 1 }], output: 'sausage', batch: 3, cycle: 3.2, price: 55, want: [2, 5], capacity: 18,
  },
  toyFactory: {
    id: 'toyFactory', kind: 'shop', label: 'Toy Factory', blurb: 'Crates → toy trains (the Grand Market needs 20)',
    era: 4, logs: 50, cash: 14000, people: 10,
    inputs: [{ kind: 'crate', per: 1 }], output: 'toy', batch: 2, cycle: 2.4, price: 45, want: [3, 6], capacity: 24,
  },
};

/** Wave 12: amenities, the cosy things on the square that raise town happiness. */
export type AmenityId = 'cafe' | 'pond' | 'bandstand' | 'snowmanPark';
export interface AmenityDef {
  id: AmenityId;
  label: string;
  blurb: string;
  /** Minimum village level. */
  era: number;
  logs: number;
  cash: number;
  /** Happiness this amenity adds (the four sum to 1). */
  happiness: number;
}
export const AMENITIES: Record<AmenityId, AmenityDef> = {
  cafe: { id: 'cafe', label: 'Cocoa Café', blurb: 'Hot cocoa by the square. Townsfolk linger with a mug', era: 3, logs: 20, cash: 3000, happiness: 0.25 },
  snowmanPark: { id: 'snowmanPark', label: 'Snowman Park', blurb: 'A family of snowmen the kids never leave alone', era: 3, logs: 14, cash: 1500, happiness: 0.2 },
  bandstand: { id: 'bandstand', label: 'Bandstand', blurb: 'A little stage; a band plays at dusk', era: 3, logs: 28, cash: 5000, happiness: 0.25 },
  pond: { id: 'pond', label: 'Skating Pond', blurb: 'Frozen and lit; skaters loop on it all night', era: 4, logs: 36, cash: 9000, happiness: 0.3 },
};
export const AMENITY_IDS: readonly AmenityId[] = ['cafe', 'snowmanPark', 'bandstand', 'pond'];
/** Town happiness (0..1, the sum of built amenities) raises every sale price by up to this share. */
export const HAPPINESS = { priceBonus: 0.3 } as const;

export const TOWN = {
  /** Business ids not offered (none: every building has its model and goods). */
  hidden: [] as readonly BusinessId[],
  /** Townsfolk buyers: seconds between spawns per open shop, by village level (index), and max queue per shop. */
  buyerGap: [12, 12, 12, 7, 5, 4] as readonly number[],
  queuePerShop: 3,
  /** Wandering townsfolk (cosy crowd), by village level; AutoQuality / Low quality halves it. */
  wanderers: [0, 2, 4, 10, 16, 22] as readonly number[],
  /** Hard cap on crowd instances (render/draw-call budget: the crowd is instanced, ~8 draw calls total). */
  crowdMax: 48,
} as const;

// ---------------------------------------------------------------------------
// Save / offline earnings (core/Save.ts)
// ---------------------------------------------------------------------------

export const SAVE = {
  /** localStorage key (bump the version suffix together with `version` when the schema changes). */
  key: 'winterland.save.v1',
  version: 1,
  /** Autosave cadence in simulation seconds (also saved when the tab is hidden or closed). */
  interval: 5,
  /**
   * 0.9.6 rolling backups (core/saveVault.ts): how many earlier autosaves are kept, and how often (simulation seconds)
   * the one on disk is copied into that ring before being overwritten. The save a session started from is copied too.
   */
  backups: 3,
  backupInterval: 600,
  /** Copies of saves that could not be opened, kept for the player to export (oldest dropped first). */
  unreadableKept: 3,
} as const;

export const OFFLINE = {
  /** Offline time counted at most (seconds). */
  maxSeconds: 2 * 60 * 60,
  /** Fraction of the recent sales rate earned while away. */
  efficiency: 0.25,
  /** …and never more than this share of everything earned so far (stats.moneyEarned), so an absence can't skip the game. */
  maxShareOfEarned: 0.2,
  /** Shorter absences earn nothing (seconds). */
  minSeconds: 60,
  /** Smaller amounts are not worth a card. */
  minAmount: 25,
  /** Window of the rolling sales-rate sample (simulation seconds). */
  window: 300,
} as const;
