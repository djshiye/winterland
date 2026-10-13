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

export const PALETTE = {
  sky: 0xcfe6f7,
  snow: 0xf3f7fc,
  snowShade: 0xdde7f3,
  yardDirt: 0xd8b388,
  yardDirtDark: 0xc39a6b,
  dropSlab: 0x8e959e,
  dropSlabEdge: 0x6f7680,
  water: 0x46b5ea,
  waterDeep: 0x2a87cf,
  foam: 0xffffff,
  ice: 0xe4f5ff,
  bark: 0x8a5a33,
  barkDark: 0x6b4325,
  woodEnd: 0xf0cf9a,
  woodRing: 0xd6a66a,
  plank: 0xc98f52,
  crate: 0xdca15a,
  crateDark: 0xa86f32,
  cash: 0x46c35f,
  cashDark: 0x2e9c48,
  cashBand: 0xf3fff0,
  fence: 0xa8743f,
  fenceDark: 0x7f5328,
  pine: 0x2f7a55,
  pineDark: 0x245f43,
  trunk: 0x7a4f2c,
  rock: 0x8f9bab,
  rockDark: 0x6c7889,
  road: 0xa7b3c3,
  asphalt: 0x4b5361,
  roadLine: 0xf6d04d,
  mountain: 0x9fb2c8,
  mountainDark: 0x7d90a8,
  machine: 0x2f80ed,
  machineDark: 0x1f5fbf,
  accent: 0xf6c343,
  metal: 0xb8c2cf,
  metalDark: 0x5d6673,
  rubber: 0x2b2f36,
  playerShirt: 0xe2483d,
  playerPants: 0x2f3e5c,
  playerHat: 0xf4c430,
  skin: 0xf3c7a1,
  customer: 0x3d8ef0,
  customerDark: 0x2b6dc4,
  trike: 0x2f7ff0,
  truckRed: 0xe2453c,
  truckBlue: 0x3567d6,
  padBase: 0x2e3a4d,
  padBorder: 0xffffff,
  padFill: 0x5ee07a,
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
  viewHeight: 21,
  /** On narrow (portrait) screens never show fewer than this many units across. */
  minViewWidth: 15,
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
  shadowExtent: 26,
} as const;

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export const PLAYER = {
  speed: 6.4,
  accel: 45,
  decel: 60,
  radius: 0.42,
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

/** Item dimensions. Item meshes are centred on their origin. Logs lie along local X. */
export const ITEM_SIZE = {
  log: { length: 1.0, radius: 0.19, stackHeight: 0.4 },
  crate: { size: 0.56, stackHeight: 0.58 },
  cash: { w: 0.5, h: 0.12, d: 0.27, stackHeight: 0.13 },
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
} as const;

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

export const ECONOMY = {
  /** Every physical cash bundle is worth this many dollars. All prices are multiples of it. */
  cashBundleValue: 5,
  startMoney: 0,
  logPrice: 5, // walk-in customers, per log
  cratePrice: 15, // cargo tricycles, per crate
  truckLogPrice: 10, // phase-5 pickup trucks, per log (bulk)
  customerWant: [2, 4] as [number, number],
  tricycleWant: [3, 5] as [number, number],
  truckWant: [8, 12] as [number, number],
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
  harvester: { id: 'harvester', cost: 100, x: -6.6, z: -4.8, size: 2.2, label: 'HARVESTER', icon: 'saw' },
  processor: { id: 'processor', cost: 200, x: 6.4, z: 6.6, size: 2.2, label: 'PROCESSOR', icon: 'factory' },
  westConveyor: { id: 'westConveyor', cost: 150, x: -2.4, z: 4.6, size: 2.2, label: 'CONVEYOR', icon: 'conveyor' },
  eastConveyor: { id: 'eastConveyor', cost: 150, x: -0.8, z: -3.0, size: 2.2, label: 'CONVEYOR', icon: 'conveyor' },
  megaSaw: { id: 'megaSaw', cost: 200, x: -6.4, z: -8.2, size: 2.2, label: 'MEGA SAWMILL', icon: 'megasaw' },
};

// ---------------------------------------------------------------------------
// World layout (all world units; see header for axis → screen mapping)
// ---------------------------------------------------------------------------

const LOG_GRID_SPACING = { x: 1.08, y: 0.4, z: 0.44 };
const CRATE_GRID_SPACING = { x: 0.62, y: 0.58, z: 0.62 };
const CASH_GRID: PileGrid = { cols: 3, rows: 3, layers: 20, spacing: { x: 0.56, y: 0.13, z: 0.32 } };

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

  giantLog: {
    x: -12.6,
    y: -0.05,
    /** Resting centre Z (after it crashes into the gate). Spans z ∈ [-10, 6]. */
    z: -2,
    length: 16,
    radius: 1.6,
    /** Intro: the log's centre starts here and floats +Z until it hits the gate. */
    introStartZ: -80,
    /** Wooden gate / fence spanning the river just downstream of the log. */
    gateZ: 6.6,
    introDuration: 3.2,
  },

  /** Player stands here (river bank) to auto-swing the axe at the giant log. */
  chopZone: rect(-9.05, 3.2, 2.3, 5.2),

  /** Grey slab where all raw logs land. Logs lie along X. Capacity 2*5*6 = 60. */
  dropZone: {
    x: -5.2,
    z: -0.4,
    slab: { w: 3.2, d: 3.1 },
    grid: { cols: 2, rows: 5, layers: 6, spacing: LOG_GRID_SPACING } as PileGrid,
    /** Player pickup area (pile footprint is solid; stand next to it). */
    zone: rect(-5.2, -0.4, 4.6, 4.4),
    collider: rect(-5.2, -0.4, 2.3, 2.3),
  },

  walkInCounter: {
    x: -4.0,
    z: 9.9,
    /** Long axis along X. */
    length: 3.4,
    depth: 1.1,
    height: 0.95,
    rotationY: 0,
    grid: { cols: 2, rows: 2, layers: 6, spacing: LOG_GRID_SPACING } as PileGrid,
    /** Player stands here (inside the yard) to drop logs on the counter. */
    playerZone: rect(-3.4, 8.55, 2.8, 1.5),
  },

  customers: {
    /** Front of the queue (customer faces -Z toward the counter). */
    front: { x: -4.0, z: 11.4 } as XZ,
    /** Each further customer stands this much further +Z. */
    spacing: 1.3,
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

  walkInCash: {
    x: -0.9,
    z: 8.6,
    grid: CASH_GRID,
    zone: rect(-0.9, 8.6, 3.7, 3.0),
  },

  processor: {
    /** Machine body (blue box). */
    x: 4.4,
    z: -0.4,
    w: 2.6,
    d: 2.4,
    h: 2.3,
    /** Input hopper/bin on the machine's west face. Logs lie along Z inside it. */
    hopper: {
      x: 2.55,
      z: -0.4,
      w: 1.1,
      d: 1.4,
      h: 0.9,
      rotationY: Math.PI / 2,
      grid: { cols: 1, rows: 2, layers: 6, spacing: LOG_GRID_SPACING } as PileGrid,
    },
    /** Output table on the machine's south (+Z) face. */
    outputTable: {
      x: 4.4,
      z: 1.95,
      w: 1.6,
      d: 1.5,
      h: 0.75,
      grid: { cols: 2, rows: 2, layers: 4, spacing: CRATE_GRID_SPACING } as PileGrid,
    },
    /** Player feeds logs while standing here. */
    inputZone: rect(2.5, -0.4, 2.2, 4.6),
    /** Player picks crates up while standing here. */
    outputZone: rect(4.4, 2.45, 2.8, 2.9),
    /** Seconds to turn one log into one crate. */
    cycleTime: 1.0,
  },

  seCounter: {
    x: 9.9,
    z: 3.6,
    /** Long axis along Z. */
    length: 3.4,
    depth: 1.1,
    height: 0.95,
    rotationY: Math.PI / 2,
    grid: { cols: 4, rows: 1, layers: 4, spacing: { x: 0.66, y: 0.58, z: 0.62 } } as PileGrid,
    playerZone: rect(8.6, 3.6, 1.6, 3.6),
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
    cargoGrid: { cols: 2, rows: 2, layers: 2, spacing: CRATE_GRID_SPACING } as PileGrid,
    road: { minX: 10.8, maxX: 14.8, minZ: -70, maxZ: 70 } as Rect,
  },

  seCash: {
    x: 7.4,
    z: 7.0,
    grid: CASH_GRID,
    zone: rect(7.4, 7.0, 3.7, 3.0),
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

  westConveyor: {
    /** Drop zone → walk-in counter (travels +Z). Logs ride oriented along X. */
    path: [
      { x: -5.2, z: 1.0 },
      { x: -5.2, z: 8.95 },
    ] as XZ[],
    width: 0.95,
    beltY: 0.55,
    speed: 2.6,
    spacing: 0.55,
  },

  eastConveyor: {
    /** Drop zone → processor hopper (travels +X). Logs ride oriented along Z. */
    path: [
      { x: -3.95, z: -0.4 },
      { x: 1.95, z: -0.4 },
    ] as XZ[],
    width: 0.95,
    beltY: 0.55,
    speed: 2.6,
    spacing: 0.55,
  },

  megaSaw: {
    /** Giant blade over the river near the log's upstream end. */
    x: -12.6,
    z: -9.0,
    bladeRadius: 2.3,
    /** Yard-side machine base (solid). */
    base: rect(-9.3, -9.0, 1.8, 1.8),
    cycleTime: 1.4,
    logsPerCycle: 3,
  },

  /** Phase 5: yard grows north (-Z) to LAYOUT.expandedMinZ. */
  expansion: {
    truckCounter: {
      x: 1.0,
      z: -19.9,
      length: 3.4,
      depth: 1.1,
      height: 0.95,
      rotationY: 0,
      grid: { cols: 2, rows: 2, layers: 6, spacing: LOG_GRID_SPACING } as PileGrid,
      playerZone: rect(1.0, -18.55, 3.4, 1.5),
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
    },
    truckCash: { x: 4.8, z: -18.0, grid: CASH_GRID, zone: rect(4.8, -18.0, 3.7, 3.0) },
  },

  /** Background scenery (visual only). */
  highway: { z: -23, width: 4.4, minX: -90, maxX: 90 },
  tunnel: { x: 30, z: -23 },
  mountains: { z: -34 },
  /** Cosy cabin in the yard's -Z/+X corner (solid). */
  cabin: rect(7.8, -7.8, 3.6, 3.0),
} as const;

/** Distance at which world pickups / drop-offs consider the player "near" (zones handle most cases). */
export const INTERACT = {
  zoneMarkerColor: PALETTE.zoneMarker,
} as const;
