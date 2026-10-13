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
  SNOW_WHITE: 0xeef5fc,
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
  // Upgrade pad texture (createPadTexture)
  PAD_BG: 0x4a4a4a,
  PAD_BORDER: 0xffffff,
  PAD_FILL: 0x2ecc71,
} as const;

/**
 * Legacy/semantic colour keys used across the codebase. Every key that has a master-palette
 * equivalent points at it; the rest are derived shades (darker variants of a master colour) or
 * scenery colours the art spec does not cover (pines, rocks, roads, mountains, sky).
 */
export const PALETTE = {
  sky: 0xcfe6f7,
  snow: COLORS.SNOW_WHITE,
  snowShade: 0xd9e6f2,
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
  // How many buyers come and how much they take depends on the village level: see DEMAND.
} as const;

// ---------------------------------------------------------------------------
// Upgrade pads
// ---------------------------------------------------------------------------

export type PadIdConst = 'harvester' | 'processor' | 'westConveyor' | 'eastConveyor' | 'megaSaw';

export interface PadDef {
  id: PadIdConst;
  cost: number;
  x: number;
  z: number;
  size: number;
  label: string;
  /** Icon key drawn on the pad (UpgradePad draws these procedurally on a canvas). */
  icon: 'saw' | 'factory' | 'conveyor' | 'megasaw';
}

export const PADS: Record<PadIdConst, PadDef> = {
  harvester: { id: 'harvester', cost: 150, x: -6.6, z: -4.8, size: 2.2, label: 'HARVESTER', icon: 'saw' },
  processor: { id: 'processor', cost: 700, x: 6.4, z: 6.6, size: 2.2, label: 'PROCESSOR', icon: 'factory' },
  westConveyor: { id: 'westConveyor', cost: 1200, x: -2.4, z: 4.6, size: 2.2, label: 'CONVEYOR', icon: 'conveyor' },
  eastConveyor: { id: 'eastConveyor', cost: 1200, x: -0.8, z: -3.0, size: 2.2, label: 'CONVEYOR', icon: 'conveyor' },
  megaSaw: { id: 'megaSaw', cost: 4000, x: -6.4, z: -8.2, size: 2.2, label: 'MEGA SAWMILL', icon: 'megasaw' },
};

// ---------------------------------------------------------------------------
// World layout (all world units; see header for axis → screen mapping)
// ---------------------------------------------------------------------------

const LOG_GRID_SPACING = { x: 0.66, y: 0.24, z: 0.26 };
const PLANK_GRID_SPACING = { x: 0.52, y: 0.125, z: 0.31 };
const CRATE_GRID_SPACING = { x: 0.48, y: 0.46, z: 0.48 };
const CASH_GRID: PileGrid = { cols: 3, rows: 3, layers: 20, spacing: { x: 0.37, y: 0.125, z: 0.22 } };
/** Every sales counter is the art-spec wooden table: 1.6 long × 0.6 deep × 0.8 high (FENCE_WOOD). */
const COUNTER_SIZE = { length: 1.6, depth: 0.6, height: 0.8 };

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
    /** Plank bundles on the table top. Capacity 36. */
    grid: { cols: 3, rows: 2, layers: 6, spacing: PLANK_GRID_SPACING } as PileGrid,
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
    /** Crates on the table top. Capacity 12. */
    grid: { cols: 3, rows: 1, layers: 4, spacing: CRATE_GRID_SPACING } as PileGrid,
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
      grid: { cols: 2, rows: 2, layers: 6, spacing: LOG_GRID_SPACING } as PileGrid,
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
    /** Each plot's construction pad sits in the street: plot centre + (−side × padOffset) along X. */
    padOffset: 2.2,
    padSize: 1.4,
    /** The Great Lodge (finale building) at the end of the street, its pad in front of it. */
    greatLodge: { x: 4.6, z: 29.6, w: 6.0, d: 3.6, pad: { x: 4.6, z: 26.3 } as XZ, padSize: 1.8 },
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
  | 'logHauler';

/** lumberjack + crew: bought in the cabin shop panel · machine: the machine's own pad re-arms as a level pad. */
export type UpgradeGroup = 'lumberjack' | 'machine' | 'crew';

export interface UpgradeRequirement {
  /** Minimum village level (index into VILLAGE.levels). */
  villageLevel?: number;
  /** Pad that must already be unlocked. */
  unlocked?: PadIdConst;
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
   */
  values: readonly number[];
  /** costs[n] = price to go from level n to n + 1 (length = values.length − 1). Multiples of 5. */
  costs: readonly number[];
  /** Upgrades.describe(): 'count' → "16 items", 'speed' → "7.4 m/s", 'rate' → items per second from an interval, 'crew' → "×1.3". */
  display: 'count' | 'speed' | 'rate' | 'crew';
  /** For display 'rate': items produced per cycle (mega saw: 3 logs per cut). Default 1. */
  perCycle?: number;
  /** Unit word for 'count' / 'rate' ("items", "logs/s", "chops/s"). */
  unit?: string;
  requires?: UpgradeRequirement;
}

export const UPGRADES: Record<UpgradeIdConst, UpgradeDef> = {
  carry: {
    id: 'carry',
    group: 'lumberjack',
    label: 'Strong Arms',
    blurb: 'Carry more logs and crates',
    values: [10, 13, 16, 19, 22, 25],
    costs: [100, 300, 800, 2000, 5000],
    display: 'count',
    unit: 'items',
  },
  speed: {
    id: 'speed',
    group: 'lumberjack',
    label: 'Snow Boots',
    blurb: 'Walk faster',
    values: [6.4, 6.9, 7.4, 7.9, 8.4, 9.0],
    costs: [80, 250, 700, 1800, 4500],
    display: 'speed',
  },
  axe: {
    id: 'axe',
    group: 'lumberjack',
    label: 'Sharp Axe',
    blurb: 'Chop the giant log faster',
    values: [0.4, 0.35, 0.31, 0.27, 0.24, 0.21],
    costs: [120, 350, 900, 2200, 5500],
    display: 'rate',
    unit: 'chops/s',
  },
  harvester: {
    id: 'harvester',
    group: 'machine',
    label: 'Harvester',
    blurb: 'Saws logs faster',
    values: [0.75, 0.62, 0.52, 0.44, 0.37],
    costs: [400, 1200, 3000, 7500],
    display: 'rate',
    unit: 'logs/s',
    requires: { unlocked: 'harvester' },
  },
  processor: {
    id: 'processor',
    group: 'machine',
    label: 'Processor',
    blurb: 'Makes crates faster',
    values: [1.0, 0.84, 0.71, 0.6, 0.5],
    costs: [1000, 2800, 7000, 16000],
    display: 'rate',
    unit: 'crates/s',
    requires: { unlocked: 'processor' },
  },
  megaSaw: {
    id: 'megaSaw',
    group: 'machine',
    label: 'Mega Sawmill',
    blurb: 'Cuts the giant log faster',
    values: [1.4, 1.2, 1.03, 0.89, 0.77],
    costs: [7000, 15000, 30000, 55000],
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
    values: [0, 1, 1.3, 1.65, 2.0],
    costs: [800, 2000, 5000, 11000],
    display: 'crew',
    requires: { villageLevel: 1, unlocked: 'processor' },
  },
  cashier: {
    id: 'cashier',
    group: 'crew',
    label: 'Cashier',
    blurb: 'Collects the cash piles for you',
    values: [0, 1, 1.3, 1.65, 2.0],
    costs: [2500, 6000, 13000, 26000],
    display: 'crew',
    requires: { villageLevel: 2 },
  },
  logHauler: {
    id: 'logHauler',
    group: 'crew',
    label: 'Log Hauler',
    blurb: 'Carries logs to the trucks',
    values: [0, 1, 1.3, 1.65, 2.0],
    costs: [6000, 12000, 24000, 45000],
    display: 'crew',
    requires: { villageLevel: 3, unlocked: 'megaSaw' },
  },
};

/** Crew base stats at work multiplier 1 (UPGRADES[id].values[level] scales them; capacity rounds down). */
export const CREW = {
  crateRunner: { walkSpeed: 3.0, capacity: 4 },
  /** Capacity in cash bundles. */
  cashier: { walkSpeed: 3.4, capacity: 16 },
  logHauler: { walkSpeed: 3.0, capacity: 6 },
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
    { id: 'cabin', label: 'Cabin', logs: 24, cash: 1800, residents: 7, requiresLevel: 2 },
    { id: 'lodge', label: 'Lodge', logs: 40, cash: 7000, residents: 12, requiresLevel: 3 },
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
    { name: 'Town', minPopulation: 36, perks: ['Busier roads', 'Lodges', 'Log Hauler for hire'] },
    { name: 'Winter City', minPopulation: 80, perks: ['Top prices', 'Build the Great Lodge!'] },
    { name: 'Winterland', minPopulation: Number.POSITIVE_INFINITY, perks: ['Everyone loves your mill'] },
  ] as readonly VillageLevelDef[],
  greatLodge: { label: 'GREAT LODGE', logs: 120, cash: 40000, requiresLevel: 4 },
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
  /** Every sale's amount is multiplied by this, then rounded to a multiple of cashBundleValue. */
  priceMult: number;
}

export const DEMAND: readonly DemandLevel[] = [
  // Camp: the original phase 1–5 tuning.
  { customerGap: [1.0, 1.5], customerQueue: 5, customerWant: [2, 4], trikeGap: [2.5, 4], trikeWant: [3, 6], truckGap: [3, 5], truckWant: [8, 12], priceMult: 1 },
  { customerGap: [0.9, 1.35], customerQueue: 6, customerWant: [2, 5], trikeGap: [2.3, 3.6], trikeWant: [3, 6], truckGap: [3, 5], truckWant: [8, 12], priceMult: 1.2 },
  { customerGap: [0.8, 1.2], customerQueue: 6, customerWant: [3, 6], trikeGap: [2.1, 3.3], trikeWant: [4, 7], truckGap: [2.8, 4.5], truckWant: [9, 13], priceMult: 1.45 },
  { customerGap: [0.7, 1.05], customerQueue: 7, customerWant: [3, 7], trikeGap: [1.9, 3.0], trikeWant: [4, 8], truckGap: [2.6, 4.2], truckWant: [10, 15], priceMult: 1.75 },
  { customerGap: [0.6, 0.9], customerQueue: 7, customerWant: [4, 8], trikeGap: [1.7, 2.7], trikeWant: [5, 8], truckGap: [2.4, 3.8], truckWant: [11, 17], priceMult: 2.1 },
  { customerGap: [0.55, 0.8], customerQueue: 7, customerWant: [4, 9], trikeGap: [1.6, 2.5], trikeWant: [5, 8], truckGap: [2.2, 3.5], truckWant: [12, 18], priceMult: 2.5 },
];

// ---------------------------------------------------------------------------
// Save / offline earnings (core/Save.ts)
// ---------------------------------------------------------------------------

export const SAVE = {
  /** localStorage key (bump the version suffix together with `version` when the schema changes). */
  key: 'winterland.save.v1',
  version: 1,
  /** Autosave cadence in simulation seconds (also saved when the tab is hidden or closed). */
  interval: 5,
} as const;

export const OFFLINE = {
  /** Offline time counted at most (seconds). */
  maxSeconds: 2 * 60 * 60,
  /** Fraction of the recent sales rate earned while away. */
  efficiency: 0.5,
  /** Shorter absences earn nothing (seconds). */
  minSeconds: 60,
  /** Smaller amounts are not worth a card. */
  minAmount: 25,
  /** Window of the rolling sales-rate sample (simulation seconds). */
  window: 300,
} as const;
