/**
 * [0.9.8 — look foundation] THE palette: every era's colours in one module (DIRECTION V9). Before 0.9.8 the era rows
 * were copied into eras/data.ts, eraMachines2/3/4.ts and cityBuildings.ts; they all read from here now, and new art
 * code takes its colours from `palette(era)` instead of adding a hard-coded palette of its own.
 *
 * Pure data with no imports, so eras/data.ts and config.ts can read it without import cycles. The material helpers
 * built on it (`glowMaterial()`, `floorMaterial()`) live in render/paletteMaterials.ts.
 *
 * Per era (1 Survival … 10 AI):
 * - the guide row of docs/art/guide.md (ground, fence, body, accent, trim, glow, coat);
 * - `floor`: the yard / processing floor colours of DIRECTION.md and the region's `board` (the ground the whole plot
 *   stands on, world/env/eraGround.ts), each era's own base board so regions stop reading alike;
 * - `light`: the night lamp colour of the DIRECTION table;
 * - `look`: how the renderer lights and grades the era (render/Renderer.ts): its daylight (sun and sky strength, the
 *   sky and ground bounce colours: firm sun shadows, never a pale wash), a warm night (sky, hemisphere, moon, never a
 *   mauve wash) and a colour grade (tint, shadow lift, saturation, contrast, vignette) for day and night, each built
 *   around the era's main resource (R36);
 * - `city`: the district building colours (assets/cityBuildings.ts; era 1 has no district).
 * The machine files' extra material tones per era sit in MACHINE_TONES.
 */

/** Snow (the guide's #f4f7fb) and its shade. */
export const SNOW = 0xf4f7fb;
export const SNOW_SHADE = 0xd9e4f0;
/** The fixed colours every era harmonises with (guide.md). */
export const PINE = 0x2d4c3b;
export const GOLD = 0xf2b644;
/** Soft ink: outlines, UI text. Never pure black. */
export const INK = 0x3b2d26;
export const CREAM = 0xfff8ec;

/** A colour grade (applied after tone mapping, render/PostFX.ts). Colours are hex (sRGB). */
export interface Grade {
  /** Multiplied into every pixel (white = none): the era's warmth. */
  tint: number;
  /** Shadows are lifted toward this colour (black = none): plum, never grey. */
  lift: number;
  /** 1 = as rendered. */
  saturation: number;
  /** 1 = as rendered. */
  contrast: number;
  /** Corner darkening toward the lift colour, 0..1. */
  vignette: number;
}

/**
 * How the renderer lights an era by day (0.9.8 world threads; Validator note on PR #45: eras 2-10 read pale by day).
 * `sun` / `hemi` multiply config LIGHTING's sun and hemisphere intensities: a weaker sky fill and a stronger sun give
 * firm, readable shadows. The sky and ground bounce colours tint those shadows (plum-blue, never grey).
 */
export interface DayLight {
  sun: number;
  hemi: number;
  hemiSky: number;
  hemiGround: number;
}

/** How the renderer lights an era at night. */
export interface NightLight {
  sky: number;
  hemiSky: number;
  hemiGround: number;
  /** The night "sun" (moonlight) colour. */
  moon: number;
}

export interface EraLook {
  day: DayLight;
  night: NightLight;
  grade: { day: Grade; night: Grade };
}

export interface CityStyle {
  wall: number;
  wall2: number;
  roof: number;
  trim: number;
  accent: number;
  /** Window light tint. */
  tint: number;
}

export interface EraPalette {
  n: number;
  ground: number;
  fence: number;
  body: number;
  accent: number;
  trim: number;
  glow: number;
  coat: number;
  /** Yard / processing floor (DIRECTION per-era table) and the board the whole region stands on. */
  floor: { yard: number; processing: number; board: number };
  /** Night lamp light. */
  light: number;
  look: EraLook;
  /** District building colours (null for era 1, which has no district). */
  city: CityStyle | null;
}

// ---------------------------------------------------------------------------
// looks
// ---------------------------------------------------------------------------

/**
 * The shared night: a deep indigo sky and soft periwinkle moonlight over a warm, rosy-brown ground bounce, so snow reads
 * blue-violet while every window, lamp and furnace stays the warmest thing on screen (a cozy night, not a mauve wash).
 */
const NIGHT: NightLight = { sky: 0x1a2250, hemiSky: 0x6476c4, hemiGround: 0x5a4248, moon: 0xaebcf0 };

/**
 * The shared daylight: the sun a touch stronger and the sky fill well down from config LIGHTING's (1.35 hemisphere
 * washed every shadow out), with a cool periwinkle sky and a plum ground bounce so shadows read blue-violet on snow.
 */
const DAY: DayLight = { sun: 1.1, hemi: 0.72, hemiSky: 0xd4e2fa, hemiGround: 0x8f86a8 };

const day = (patch: Partial<DayLight>): DayLight => ({ ...DAY, ...patch });
const grade = (tint: number, lift: number, saturation: number, contrast: number, vignette: number): Grade => ({ tint, lift, saturation, contrast, vignette });
const night = (patch: Partial<NightLight>): NightLight => ({ ...NIGHT, ...patch });

/**
 * One look per era. Day grades stay close to neutral (the art carries the colour); nights lean on the era's resource:
 * forge orange in the Iron Age, sodium yellow for the steel mills, copper-teal for the Electric Age, honey for oil,
 * screen mint for silicon, aqua for the reactors and sun-gold for fusion.
 */
const LOOKS: readonly EraLook[] = [
  // 0: unused (era numbers start at 1)
  { day: DAY, night: NIGHT, grade: { day: grade(0xffffff, 0x000000, 1, 1, 0), night: grade(0xffffff, 0x000000, 1, 1, 0) } },
  // 1 Survival: the forest and the log, amber hearths
  { day: day({ hemi: 0.8 }), night: night({}), grade: { day: grade(0xfffcfa, 0x0d0812, 1.06, 1.03, 0.2), night: grade(0xfff8ee, 0x110b18, 1.08, 1.02, 0.3) } },
  // 0.9.11 moods (audit-1.0/cozy, Dino 2026-10-19: every area its own feel). The grades no longer sit near neutral:
  // each era's light and grade carry its mood, while the art keeps the colour. Cozy, never grim.
  // Nights (0.9.11 review V3): each era also gets its own moonlight and sky fill, so the night keeps its mood
  // instead of one shared blue-purple: warm kiln violet (2), slate (3), misty grey (4), sodium rose (5), electric cyan
  // (6), icy white (7), sea blue (8), mint (9), lavender (10). Validator on #82: eras 5 and 6 a little less saturated.
  // 2 Frontier: harvest-gold afternoon over fieldstone and clay, kiln mouths at night
  { day: day({ sun: 1.16, hemi: 0.66, hemiSky: 0xe6dcf0, hemiGround: 0x9c7c6a }), night: night({ hemiGround: 0x7a5040, hemiSky: 0x7a74b8, sky: 0x2a2040, moon: 0xd4c8e4 }), grade: { day: grade(0xfff0da, 0x1c0f08, 1.12, 1.05, 0.28), night: grade(0xffeed8, 0x1a0e0c, 1.1, 1.02, 0.32) } },
  // 3 Iron Age: forge hills at dusk: cool slate shadows, forge orange glows
  { day: day({ sun: 1.12, hemi: 0.6, hemiSky: 0xb8c4e8, hemiGround: 0x7a6a78 }), night: night({ hemiGround: 0x744838, hemiSky: 0x6a70b8, sky: 0x221c40, moon: 0xb8bce4 }), grade: { day: grade(0xeceef8, 0x141228, 1.02, 1.09, 0.34), night: grade(0xffece0, 0x180c14, 1.12, 1.05, 0.36) } },
  // 4 Steam Age: misty railway morning: pale cream, soft low contrast, lifted milky shadows
  { day: day({ sun: 1.05, hemi: 0.84, hemiSky: 0xe8ecf4, hemiGround: 0xa49a9a }), night: night({ hemiGround: 0x645048, hemiSky: 0x8088b4, sky: 0x262a40, moon: 0xc4c8dc }), grade: { day: grade(0xfcf8f0, 0x2c2a30, 0.94, 0.9, 0.18), night: grade(0xf8f2ec, 0x1e1a24, 0.98, 0.94, 0.3) } },
  // 5 Industrial: ember night-shift: copper haze even by day, sodium lamps at night
  { day: day({ sun: 1.18, hemi: 0.58, hemiSky: 0xe8cfc0, hemiGround: 0x9a6c5c }), night: night({ hemiGround: 0x765238, hemiSky: 0x7c72a8, sky: 0x2c1c28, moon: 0xd8bcc4 }), grade: { day: grade(0xfff4e6, 0x140a06, 1.06, 1.06, 0.32), night: grade(0xffe8c8, 0x1c0e0a, 0.98, 1.05, 0.36) } },
  // 6 Electric Age: twinkle-lit blue hour: cool blue light so the warm bulbs and copper pop
  { day: day({ sun: 1.12, hemi: 0.66, hemiSky: 0xbcccf4, hemiGround: 0x7a8aa0 }), night: night({ hemiGround: 0x5a5050, hemiSky: 0x5488c8, sky: 0x12264a, moon: 0xa4ccec }), grade: { day: grade(0xeef6ff, 0x081830, 1.16, 1.06, 0.3), night: grade(0xf0faff, 0x0a1422, 0.97, 1.04, 0.32) } },
  // 7 Oil: polar tundra: cold blue-white air, low pale sun, flare stacks the warmest thing on screen
  { day: day({ sun: 1.14, hemi: 0.7, hemiSky: 0xd0e0fa, hemiGround: 0x8090a8 }), night: night({ hemiGround: 0x5e4c44, hemiSky: 0x7098d4, sky: 0x141e40, moon: 0xc8dcf8 }), grade: { day: grade(0xeef4ff, 0x101a28, 0.96, 1.04, 0.26), night: grade(0xf0f4ff, 0x0c1220, 1.0, 1.03, 0.32) } },
  // 8 Computer: crisp seaside: high-key, clean, bright, a warm sand bounce
  { day: day({ sun: 1.2, hemi: 0.68, hemiSky: 0xd8e8fc, hemiGround: 0x9c8a86 }), night: night({ hemiGround: 0x56524e, hemiSky: 0x5c8cc8, sky: 0x142a48, moon: 0xb4d4f0 }), grade: { day: grade(0xfffffa, 0x0a1014, 1.14, 1.07, 0.12), night: grade(0xf6fafa, 0x0c0f16, 1.08, 1.02, 0.26) } },
  // 9 Nuclear: minty glow valley: a soft green cast, glowing nights
  { day: day({ sun: 1.16, hemi: 0.66, hemiSky: 0xc8ecdc, hemiGround: 0x7a9490 }), night: night({ hemiGround: 0x4e5a4c, hemiSky: 0x58a0bc, sky: 0x10303c, moon: 0xb0e8d8 }), grade: { day: grade(0xf5fff9, 0x0a1a16, 1.1, 1.04, 0.3), night: grade(0xeefff8, 0x081814, 1.1, 1.02, 0.34) } },
  // 10 AI: dream aurora plateau: lavender twilight even by day, sun-gold fusion
  { day: day({ sun: 1.16, hemi: 0.68, hemiSky: 0xd8c8f4, hemiGround: 0x9a86a8 }), night: night({ hemiGround: 0x6e5844, hemiSky: 0x6c74c0, sky: 0x221e44 }), grade: { day: grade(0xf6ecff, 0x1a1030, 1.12, 1.03, 0.3), night: grade(0xfff8ee, 0x120d20, 1.1, 1.03, 0.28) } },
];

// ---------------------------------------------------------------------------
// eras
// ---------------------------------------------------------------------------

type Row = [ground: number, fence: number, body: number, accent: number, trim: number, glow: number, coat: number];

/** The guide.md table, era 1..10. */
const GUIDE: readonly Row[] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0xe8eef5, 0x7a4e32, 0x8a5a3b, 0xc84b31, 0x523522, 0xffaa44, 0x9e623a],
  [0xccd4de, 0x6e5a4f, 0x8c857b, 0xb85239, 0x5c4028, 0xffb347, 0x8c4a32],
  [0xd0d8e2, 0x4f4c49, 0xa65e46, 0x4a5559, 0x2f3538, 0xff9233, 0x5c4d42],
  [0xc5ced9, 0x464b4f, 0x9e4737, 0xd49a35, 0x383d40, 0xffbe55, 0x783a2d],
  [0xbac4d0, 0x525c63, 0x5a6973, 0xe08a2b, 0x333c42, 0xffd166, 0x485866],
  [0xb4c0cc, 0x5c6b73, 0x4c6b68, 0xd97f38, 0x2b3b39, 0x7ce8c8, 0x3d606e],
  [0xaebac6, 0x575552, 0xd99b26, 0xc44536, 0x36383a, 0xffaa5a, 0xb87b28],
  [0xc2ccd6, 0x7c858e, 0xe6dec8, 0x45858c, 0x4a5259, 0x66e0a3, 0x4a7585],
  [0xcbd6e0, 0x6f828a, 0xdce3e6, 0x4ea885, 0x3d5259, 0x70f5d9, 0x468275],
  [0xcad4e0, 0x8fa1b3, 0xf5f0e6, 0xe8a848, 0x526475, 0xffe082, 0x637a91],
];

/**
 * DIRECTION per-era floors (yard / processing), the region's board and night lights. Eras 5, 8 and 10 follow resources
 * v2. The board is what the whole plot stands on (world/env/eraGround.ts); eras still on the guide's pale snow ground
 * keep it until their world thread gives them their own.
 */
const FLOORS: readonly [yard: number, processing: number, light: number, board: number][] = [
  [0, 0, 0, 0],
  [0x9c7a5c, 0xc49a6c, 0xffb347, 0x9c7a5c], // packed earth, plank walkways; amber windows and lanterns
  [0xb9ab98, 0x8f8170, 0xffb347, 0xdcc8a2], // fieldstone flags and mortar on golden straw-dusted earth (0.9.11: warmer, harvest gold); hearth glow in the kiln mouths
  [0x94604c, 0xc9906b, 0xff9233, 0xaeb0b8], // rust-ore gravel on cool slate hill rock (0.9.11: slate, so era 3 stops reading like eras 2 and 5); forge orange
  [0x7d7a78, 0xc77a45, 0xffbe55, 0xb4baaa], // cinder slate with warm specks; boiler doors, gas lamps; misty sage-grey board (0.9.11)
  [0xb8613f, 0x8a6a5c, 0xffd166, 0xa98270], // herringbone brick, pellet-grey yard; sodium lamps; deep brick-umber soot board (0.9.11)
  [0x5f8f86, 0x8fb0aa, 0x7ce8c8, 0xa9c7bf], // teal cobbles; mint bulbs on the wires; mint-teal snow board
  [0x626e7e, 0xe2ad3c, 0xffaa5a, 0xd9e3ec], // cold slate asphalt with honey lanes; flare peach; icy blue-white tundra board (0.9.11: polar tundra)
  [0xe6d4b0, 0xd2bf98, 0x66e0a3, 0xece4d6], // beige terrazzo, sand; screen mint; a warm sand-snow board
  [0x9ccbb6, 0xc8e6d8, 0x70f5d9, 0xdcece5], // mint-glazed concrete; aqua pools; a mint-snow board
  [0xf3ead8, 0xe8a848, 0xffe082, 0xe6e1f0], // cream hex panels with gold seams; sun-gold fusion glow; a lilac-snow board
];

/**
 * District building colours, eras 2..10 (assets/cityBuildings.ts adds its own storey heights). 0.9.8 (10c): read in
 * era order the city climbs taller AND lighter: warm brick and iron (2-5), cream deco (6), honey sandstone (7), then
 * silicon beige with teal glass (8), mint-glazed white (9) and cream with gold seams (10). No near-black trims.
 */
const CITY: readonly (CityStyle | null)[] = [
  null,
  null,
  { wall: 0xb85239, wall2: 0x9a4430, roof: 0x5c4028, trim: 0xe9dfcc, accent: 0xd9a441, tint: 0xffb347 },
  { wall: 0x8a5442, wall2: 0x6a4434, roof: 0x5a4a44, trim: 0x4e4846, accent: 0x8a9096, tint: 0xffb347 },
  { wall: 0xa5703f, wall2: 0x7d5330, roof: 0x4a3a2c, trim: 0x4a4644, accent: 0xd49a35, tint: 0xffc05a },
  { wall: 0x93453a, wall2: 0x6f3a2f, roof: 0x4d555c, trim: 0x5c666d, accent: 0xe08a2b, tint: 0xffcf70 },
  { wall: 0xe3d8bc, wall2: 0xbfb08a, roof: 0x3f5a56, trim: 0xd97f38, accent: 0x4c6b68, tint: 0xffe08a },
  { wall: 0xd6c4a2, wall2: 0xb39d7a, roof: 0x6a5a4e, trim: 0xd99b26, accent: 0xc44536, tint: 0xffe6b0 },
  { wall: 0xf0e8d6, wall2: 0xa9cfcb, roof: 0x5d8f94, trim: 0xfaf6ec, accent: 0x45858c, tint: 0xd8f5e4 },
  { wall: 0xeef4f0, wall2: 0xbfe0d3, roof: 0x5a8f86, trim: 0xfbfdfb, accent: 0x4ea885, tint: 0xd2fbef },
  { wall: 0xfbf4e6, wall2: 0xf0dfb8, roof: 0xe0b860, trim: 0xe8a848, accent: 0xf2c46a, tint: 0xffe7a8 },
];

const PALETTES: readonly EraPalette[] = GUIDE.map(([ground, fence, body, accent, trim, glow, coat], n) => {
  const [yard, processing, light, board] = FLOORS[n]!;
  return { n, ground, fence, body, accent, trim, glow, coat, floor: { yard, processing, board }, light, look: LOOKS[n]!, city: CITY[n] ?? null };
});

/** Number of eras. */
export const ERA_COUNT = 10;

/** Clamp anything to a valid era number 1..10 (0, NaN and out-of-range values become the nearest era; 0 → 1). */
export function eraIndex(era: number): number {
  return Number.isFinite(era) ? Math.max(1, Math.min(ERA_COUNT, Math.round(era))) : 1;
}

/** Era `era`'s palette (1..10; anything else is clamped, so the yard / town / city (0) read as era 1). */
export function palette(era: number): EraPalette {
  return PALETTES[eraIndex(era)]!;
}

/** The guide row as eras/data.ts EraDef.colors. */
export function guideColors(era: number): { ground: number; accent: number; trim: number; fence: number; body: number; glow: number; coat: number } {
  const p = palette(era);
  return { ground: p.ground, accent: p.accent, trim: p.trim, fence: p.fence, body: p.body, glow: p.glow, coat: p.coat };
}

// ---------------------------------------------------------------------------
// machine tones (the extra per-era material shades the machine files use)
// ---------------------------------------------------------------------------

/** Body / accent / trim / glow / fence of an era (eras 2-4 machines). */
const machineRow = (n: number): { body: number; accent: number; trim: number; glow: number; fence: number } => {
  const p = PALETTES[n]!;
  return { body: p.body, accent: p.accent, trim: p.trim, glow: p.glow, fence: p.fence };
};

/**
 * Machine tones per era. Eras 2-4 are the guide rows; eras 5-7 add their material shades (era 5's body and trim sit one
 * step lighter than the guide: under the toon ramp the guide values read near-black); eras 8-10 are the inputs the
 * 0.9.5 machines derive their shades from.
 */
export const MACHINE_TONES = {
  2: machineRow(2),
  3: machineRow(3),
  4: machineRow(4),
  5: {
    ground: 0xbac4d0, fence: 0x525c63, body: 0x6c7a83, accent: 0xe08a2b, trim: 0x3b4449, glow: 0xffd166,
    bodyL: 0x8794a0, brick: 0xb8613f, brickD: 0x934a32, brass: 0xd4a64a, brassL: 0xecc46a, concrete: 0xa9aeb0,
  },
  6: {
    ground: 0xb4c0cc, fence: 0x5c6b73, body: 0x4c6b68, accent: 0xd97f38, trim: 0x2b3b39, glow: 0x7ce8c8,
    bodyL: 0x6a8f8a, cream: 0xf0e4cb, creamD: 0xd8ccb2, honey: 0xe2ad3c, crimson: 0xb8473a, gravel: 0xa9a49a, quartz: 0xeed3e2,
  },
  7: {
    ground: 0xaebac6, fence: 0x575552, body: 0xd99b26, accent: 0xc44536, trim: 0x36383a, glow: 0xffaa5a,
    bodyL: 0xebb850, bodyD: 0xb27c1c, concrete: 0xb9b3a8, cream: 0xf0e4cb, steel: 0x8a8580, asphalt: 0x4a4746,
  },
  8: { ground: 0xc2ccd6, body: 0xe6dec8, accent: 0x45858c, trim: 0x4a5259, glow: 0x66e0a3 },
  9: { ground: 0xcbd6e0, body: 0xdce3e6, accent: 0x4ea885, trim: 0x3d5259, glow: 0x70f5d9 },
  10: { ground: 0xdae3ed, body: 0xf5f0e6, accent: 0xe8a848, trim: 0x526475, glow: 0xffe082 },
} as const;

/**
 * 0.9.8 (machines, eras 1-5): the toy material shades the era 1-5 machines are painted in. Every era's set is built
 * around its resource (R36): era 1 the log (timber and red lacquer instead of the ad's royal blue, D1), era 2 fieldstone
 * and terracotta clay, era 3 rust ore and forged iron, era 4 red brick, brass and coal, era 5 iron pellets, coke and
 * orange-painted steel. The darkest shade of each era is its trim warmed toward brown (V3: no near-black machines).
 */
export const MACHINE_SHADES = {
  1: {
    lacquer: 0xc84b31, lacquerD: 0x9c3826, lacquerL: 0xdc6a4c, timber: 0x8a5a3b, timberD: 0x5e3d26, plank: 0xc49a6c,
    brass: 0xd9a441, brassL: 0xefc66a, iron: 0x6a5a50, ironL: 0x8d7f74, blade: 0xcdc7bd, cream: 0xf3e4c6, felt: 0x4f6b4a,
  },
  2: {
    stone: 0xb3aca0, stoneL: 0xd2cbbe, stoneD: 0x8c857b, clay: 0xb85239, clayD: 0x8e4030, clayL: 0xd0704f,
    timber: 0x8a5a3b, timberD: 0x5c4028, plank: 0xc49a6c, iron: 0x63564d, rope: 0xcbb08a, moss: 0x7d8a5a,
  },
  3: {
    rust: 0xa65e46, rustD: 0x7e4634, ore: 0xb8613e, oreL: 0xd27a50, oreD: 0x8a4630, iron: 0x6e6259, ironD: 0x54493f,
    ironL: 0x8f8276, slate: 0x6d7a7e, stone: 0x8c8076, timber: 0x8a5a3b, timberD: 0x5c4028, brass: 0xc79c4c,
  },
  4: {
    brick: 0x9e4737, brickD: 0x7a3529, brickL: 0xb85c48, brass: 0xd49a35, brassL: 0xecbf62, iron: 0x6e635e,
    ironD: 0x564b4a, ironL: 0x8a7e78, roof: 0x5e5052, coal: 0x4e4450, coalL: 0x6c6070, timber: 0x8a5a3b, cream: 0xefe2c8,
  },
  5: {
    steel: 0x6c7a83, steelL: 0x8794a0, steelD: 0x4f5a62, orange: 0xe08a2b, orangeD: 0xb96a1e, brick: 0xb8613f,
    brickD: 0x934a32, brass: 0xd4a64a, concrete: 0xb4b1aa, concreteD: 0x938f88, pellet: 0xa8523a, pelletL: 0xc66a48,
    coke: 0x6a6266, cokeL: 0x8a8186,
  },
} as const;

// ---------------------------------------------------------------------------
// pads (0.9.8 brief 13: assets/pads.ts, fx/PadRing.ts)
// ---------------------------------------------------------------------------

/** One pad look: the tile face, its stitching / grain, the slab side and the icon medallion. */
export interface PadLook {
  /** Tile face, light and shade (a soft vertical gradient). */
  face: number;
  faceShade: number;
  /** Patches / planks / frost streaks drawn over the face. */
  patch: readonly number[];
  /** Stitches, grain lines, frost veins. */
  line: number;
  /** The slab's side under the snow rim. */
  side: number;
  /** How far the slab's foot darkens toward the ink (0..1; default 0.25): a contact shade on pale ground. */
  foot?: number;
  /** Strength (0..1) of a band of the side colour painted round the face's edge, just inside the snow rim. */
  edge?: number;
  /** The round medallion the icon sits on, and its rim. */
  medal: number;
  medalRim: number;
}

/**
 * The pads (DIRECTION D6): never the ad's grey tile with a green fill. Three looks; Dino picked the lantern as the
 * default; all sharing the honey fill, the cream price tag on twine and the wooden sign board.
 */
export const PAD = {
  /** Warm honey: the fill on the tile and the ring, its light meniscus and its deep bottom. */
  honey: 0xf2b644,
  honeyLight: 0xffdc8a,
  honeyDeep: 0xd98a2e,
  /** Icon and text ink (warm brown, never black). */
  ink: 0x4e3529,
  /** Price tag card, its edge and the twine it hangs from. */
  tag: 0xfff4de,
  tagEdge: 0xdcb98a,
  twine: 0xa87a4f,
  /** Sign board planks (light, mid, dark) and the brass of a level pad's board. */
  board: 0xa86d3e,
  boardLight: 0xc58a55,
  boardDark: 0x7a4a2a,
  brass: 0xe8b84f,
  /** Cash still to pay on the tag (deep pine), and a finished row's tick (sage). */
  cashInk: 0x2f6b4a,
  done: 0x5aa06e,
  /** Snow rim: lit top and shaded underside. */
  snow: SNOW,
  snowShade: SNOW_SHADE,
  /** The warm lamplight a pad face keeps at night (its own soft glow, scaled by the comfort Glow slider). */
  night: 0xffe2b0,
  /** A locked (preview) pad's frost wash. */
  frost: 0xc9d6e6,
  looks: {
    // stitched snow quilt: cream linen with rose, sage and butter patches, cream stitching
    quilt: { face: 0xf6ead6, faceShade: 0xe9d6bb, patch: [0xe8b4a8, 0xb9cfae, 0xf3d68e, 0xc9b8dc], line: 0xfff8ec, side: 0xc98d6c, medal: CREAM, medalRim: 0xd9a48c },
    // wooden pressure plate: honey pine planks with darker grain and nail heads
    plate: { face: 0xd59a5c, faceShade: 0xbf8048, patch: [0xdca468, 0xc98c50, 0xe2ad72], line: 0x9c6436, side: 0x8f5a33, medal: 0xfff1d6, medalRim: 0x9c6436 },
    // ice lantern: frosted periwinkle glass with a warm candle heart. 0.9.9: a deeper periwinkle side, a darker foot and
    // a frosty blue band inside the snow rim, so the palest look still stands off the snow-pale ground (village tent pads, eras 8-10)
    lantern: { face: 0xd6e4f7, faceShade: 0xa7bde6, patch: [0xeef4fc, 0xc4d5ee, 0xffe3ad], line: 0xffffff, side: 0x7690c4, foot: 0.42, edge: 0.65, medal: 0xfff2d2, medalRim: 0xf0c27a },
  } satisfies Record<'quilt' | 'plate' | 'lantern', PadLook>,
} as const;

// ---------------------------------------------------------------------------
// colour maths (hex in, hex out; sRGB values, no three needed)
// ---------------------------------------------------------------------------

const ch = (c: number, s: number): number => (c >> s) & 0xff;

/** Mix two hex colours (t = 0 → a, 1 → b), per sRGB channel. */
export function mixHex(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  let out = 0;
  for (const s of [16, 8, 0]) out |= Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k) << s;
  return out;
}

/** Relative lightness 0..1 of a hex colour (Rec. 709 weights on sRGB values: enough to compare palette steps). */
export function lightness(c: number): number {
  return (0.2126 * ch(c, 16) + 0.7152 * ch(c, 8) + 0.0722 * ch(c, 0)) / 255;
}

// ---------------------------------------------------------------------------
// 0.9.8 interface (brief 14): the UI's few base colours. ui/theme.ts writes them to CSS custom properties
// (--wl-<name>-c) and ui/tokens.css derives every card, button, chip and night shade from them.
// ---------------------------------------------------------------------------

export const UI_TONES = {
  ink: INK,
  cream: CREAM,
  gold: GOLD,
  pine: PINE,
  snow: SNOW,
  /** The night card (DIRECTION: dark variant ink #2a2230 with cream text). */
  night: 0x2a2230,
  /** Good news, "on", income. */
  leaf: 0x58a35f,
  /** Danger, close, warnings. */
  berry: 0xd2553f,
  /** Information, progress bars. */
  sky: 0x4f9ad6,
  /** Happiness hearts, festivals. */
  rose: 0xe36f8e,
  /** Colour-blind friendly pair (Okabe-Ito): go / good / on, and danger. */
  cbgood: 0x2a8ad8,
  cbbad: 0xc45f00,
} as const;

// ---------------------------------------------------------------------------
// sky (0.9.8 brief 16: world/sky, render/skyLight.ts)
// ---------------------------------------------------------------------------

/**
 * The sky's colours. The camera never sees the sky itself, so these are the colours of the light it throws: the sun
 * through the day (a peach morning and a honey afternoon around the plain LIGHTING noon), the northern lights (a low
 * green, a teal body, a violet crown) and the chimney smoke.
 */
export const SKY = {
  sunMorning: 0xffe4c8,
  sunEvening: 0xffd4a0,
  hemiMorning: 0xdce2ff,
  hemiEvening: 0xece4f0,
  auroraLow: 0x48f0a8,
  auroraBody: 0x34c8dc,
  auroraCrown: 0xa070ff,
  smoke: 0xe4e2ea,
  smokeShade: 0x9a96a8,
  smokeNight: 0x7a82a4,
  /** Bullfinches: a plum-grey back, a rosy breast, dark wing tips. */
  birdBack: 0x8c7f92,
  birdBreast: 0xe0806a,
  birdWing: 0x4a3e52,
} as const;

/** What drifts in an era's air (world/sky/motes.ts): forge sparks, steam, ash, fusion shimmer… */
export type MoteKind = 'none' | 'dust' | 'sparks' | 'steam' | 'ash' | 'zaps' | 'shimmer' | 'pixels' | 'glow' | 'fusion';

export interface EraSky {
  motes: MoteKind;
  /** Mote colour (sRGB hex). */
  mote: number;
  /** Mixed into the aurora's teal body at night (0 = classic northern lights). */
  auroraTint: number;
  auroraTintAmount: number;
  /** 0.9.11: the era's weather and light mood (world/sky/Sky.ts eases into it when you walk in). */
  mood: EraMood;
}

/**
 * How an era's sky behaves (0.9.11 moods). The global weather cycle still runs underneath (world/sky/weather.ts); the
 * mood shifts and scales it, so a forge valley clouds over more often and the tundra is windy and snowy.
 */
export interface EraMood {
  /** Multiplied into the daytime sun colour (white = none): a harvest amber, a cold tundra white… */
  sun: number;
  /** Added to the cloud cover (−1 … 1, the result is clamped to 0 … 1). */
  clouds: number;
  /** Multiplies the falling snow. */
  snow: number;
  /** Multiplies the wind (clouds, smoke and snow drift with it). */
  wind: number;
  /** Multiplies how many motes drift in the air (≤ 1.5, still calm). */
  motes: number;
  /** Multiplies the northern lights at night. */
  aurora: number;
}

const CALM: EraMood = { sun: 0xffffff, clouds: 0, snow: 1, wind: 1, motes: 1, aurora: 1 };
const mood = (patch: Partial<EraMood>): EraMood => ({ ...CALM, ...patch });

/** One sky per era, each built around the era's main resource (R36). */
const SKIES: readonly EraSky[] = [
  { motes: 'none', mote: SNOW, auroraTint: SKY.auroraBody, auroraTintAmount: 0, mood: CALM },
  // 1 Survival: the forest and the log: plain snow, classic green curtains
  { motes: 'none', mote: SNOW, auroraTint: SKY.auroraBody, auroraTintAmount: 0, mood: CALM },
  // 2 Frontier: clay and kilns: warm kiln dust drifting in the light
  { motes: 'dust', mote: 0xe9c79a, auroraTint: 0xffb347, auroraTintAmount: 0.12, mood: mood({ sun: 0xffe0b0, clouds: -0.15, snow: 0.55, wind: 0.8, motes: 1.3 }) },
  // 3 Iron Age: forge sparks rising
  { motes: 'sparks', mote: 0xff9233, auroraTint: 0xff9233, auroraTintAmount: 0.18, mood: mood({ sun: 0xf2f0ff, clouds: 0.22, snow: 0.9, wind: 0.9, motes: 1.25 }) },
  // 4 Steam Age: soft steam wisps
  { motes: 'steam', mote: 0xf6f2ec, auroraTint: 0xffbe55, auroraTintAmount: 0.1, mood: mood({ sun: 0xfff4e4, clouds: 0.12, snow: 0.6, wind: 0.45, motes: 1.5, aurora: 0.8 }) },
  // 5 Industrial: coke ash flecks and the odd sodium spark
  { motes: 'ash', mote: 0xa89c94, auroraTint: 0xffd166, auroraTintAmount: 0.12, mood: mood({ sun: 0xffead2, clouds: 0.25, snow: 0.45, wind: 0.7, motes: 1.4, aurora: 0.7 }) },
  // 6 Electric Age: little mint zaps along the wires
  { motes: 'zaps', mote: 0x7ce8c8, auroraTint: 0x7ce8c8, auroraTintAmount: 0.3, mood: mood({ sun: 0xeaf2ff, clouds: 0.08, snow: 1.15, wind: 0.6, motes: 1.2 }) },
  // 7 Oil: polar tundra (0.9.11): diamond-dust glitter in the cold air, windy and snowy, cool northern lights
  { motes: 'shimmer', mote: 0xdcecff, auroraTint: 0x9ad8ff, auroraTintAmount: 0.14, mood: mood({ sun: 0xecf2ff, clouds: 0.15, snow: 1.45, wind: 2.2, motes: 0.8, aurora: 1.2 }) },
  // 8 Computer: mint pixels drifting up like screen light
  { motes: 'pixels', mote: 0x66e0a3, auroraTint: 0x66e0a3, auroraTintAmount: 0.3, mood: mood({ sun: 0xfffcf4, clouds: -0.2, snow: 0.3, wind: 1.3 }) },
  // 9 Nuclear: aqua glow motes bobbing over the pools
  { motes: 'glow', mote: 0x70f5d9, auroraTint: 0x70f5d9, auroraTintAmount: 0.35, mood: mood({ sun: 0xf0fff2, snow: 0.6, wind: 0.5, motes: 1.3, aurora: 1.2 }) },
  // 10 AI: sun-gold fusion shimmer
  { motes: 'fusion', mote: 0xffe082, auroraTint: 0xffe082, auroraTintAmount: 0.3, mood: mood({ sun: 0xf4e8ff, clouds: -0.1, snow: 0.4, wind: 0.3, motes: 1.25, aurora: 1.2 }) },
];

/** Era `era`'s sky (clamped like palette()). */
export function eraSky(era: number): EraSky {
  return SKIES[eraIndex(era)]!;
}

// ---------------------------------------------------------------------------
// machine yard links (0.9.12: assets/yardLinks.ts, the era belts of assets/machines.ts)
// ---------------------------------------------------------------------------

/** One roller belt's colours (assets/machines.ts createRollerConveyor; era 1 keeps its own red-and-cream look). */
export interface BeltLook {
  /** The belt plate the items ride on, the side rails, the legs, their feet and the cross braces. */
  plank: number;
  rail: number;
  leg: number;
  foot: number;
  cross: number;
  roller: number;
  /** Drive motor housing, its lid and its little lamp. */
  motor: number;
  motorD: number;
  lamp: number;
}

/**
 * How the overhead links between neighbouring machines are built (assets/yardLinks.ts):
 * flume = an open timber chute with blocks sliding down it; ropeway = cables with hanging ore buckets; tube = a glass
 * tube with banded collars and capsules / orbs / gems inside; gallery = a covered steel conveyor bridge with pellets
 * riding through it; cable = power lines on insulators with bright beads running along; pipe = a fat banded pipeline
 * with glowing flow rings; tray = a cable tray with glowing data packets.
 */
export type LinkKind = 'flume' | 'ropeway' | 'tube' | 'gallery' | 'cable' | 'pipe' | 'tray';
/** What rides a link: shapes of assets/yardLinks.ts carrierGeometry. */
export type CarrierShape = 'block' | 'bucket' | 'capsule' | 'pellets' | 'bead' | 'ring' | 'packet' | 'orb' | 'gem';

export interface YardLinkLook {
  kind: LinkKind;
  carrierShape: CarrierShape;
  /** Span body (trough, tube collar, truss, pipe), its bands / flanges, the risers and their foot plates. */
  main: number;
  band: number;
  post: number;
  foot: number;
  /** Cables, ropes and wires. */
  wire: number;
  /** What rides the link, its second shade, and whether it glows (night-registered glow material). */
  carrier: number;
  carrierB: number;
  glow: boolean;
  /** The always-on lamp on every riser head (camera-facing) and, for tubes, the glass tint. */
  lamp: number;
  glass: number;
  belt: BeltLook;
}

const S2Y = MACHINE_SHADES[2];
const S3Y = MACHINE_SHADES[3];
const S4Y = MACHINE_SHADES[4];
const S5Y = MACHINE_SHADES[5];
const T6Y = MACHINE_TONES[6];
const T7Y = MACHINE_TONES[7];
const T8Y = MACHINE_TONES[8];
const T9Y = MACHINE_TONES[9];
const T10Y = MACHINE_TONES[10];

/**
 * 0.9.12 (Dino: "the era machine areas don't look as cool as the starting area"): every era's belts and machine links
 * in its own materials, built around its resource like the machines (MACHINE_SHADES / MACHINE_TONES): era 2 a timber
 * stone chute, 3 an ore ropeway, 4 brass pneumatic tubes, 5 a covered pellet gallery, 6 copper power lines, 7 a banded
 * oil pipeline, 8 data cable trays, 9 glowing coolant tubes, 10 golden light conduits. Index = era (2..10).
 */
export const YARD_LINKS: Readonly<Record<number, YardLinkLook>> = {
  2: {
    kind: 'flume', carrierShape: 'block', main: S2Y.timber, band: S2Y.rope, post: S2Y.timberD, foot: S2Y.stoneD, wire: S2Y.rope,
    carrier: S2Y.stoneL, carrierB: S2Y.clayL, glow: false, lamp: palette(2).glow, glass: SNOW,
    belt: { plank: S2Y.plank, rail: S2Y.clayL, leg: S2Y.timberD, foot: S2Y.stoneD, cross: S2Y.timber, roller: S2Y.stoneL, motor: S2Y.clay, motorD: S2Y.clayD, lamp: palette(2).glow },
  },
  3: {
    kind: 'ropeway', carrierShape: 'bucket', main: S3Y.iron, band: S3Y.brass, post: S3Y.timber, foot: S3Y.stone, wire: S3Y.ironD,
    carrier: S3Y.rust, carrierB: S3Y.oreL, glow: false, lamp: palette(3).glow, glass: SNOW,
    belt: { plank: S3Y.stone, rail: S3Y.oreL, leg: S3Y.ironD, foot: S3Y.stone, cross: S3Y.rust, roller: S3Y.ironL, motor: S3Y.rust, motorD: S3Y.rustD, lamp: palette(3).glow },
  },
  4: {
    kind: 'tube', carrierShape: 'capsule', main: S4Y.brass, band: S4Y.brassL, post: S4Y.iron, foot: S4Y.brickD, wire: S4Y.ironD,
    carrier: S4Y.brassL, carrierB: S4Y.brick, glow: false, lamp: palette(4).glow, glass: mixHex(S4Y.cream, 0xbfe8ff, 0.5),
    belt: { plank: S4Y.cream, rail: S4Y.brass, leg: S4Y.ironD, foot: S4Y.brickD, cross: S4Y.brick, roller: S4Y.ironL, motor: S4Y.brick, motorD: S4Y.brickD, lamp: palette(4).glow },
  },
  5: {
    kind: 'gallery', carrierShape: 'pellets', main: S5Y.orange, band: S5Y.steelL, post: S5Y.steel, foot: S5Y.concreteD, wire: S5Y.steelD,
    carrier: S5Y.pelletL, carrierB: S5Y.pellet, glow: false, lamp: palette(5).glow, glass: SNOW,
    belt: { plank: S5Y.concrete, rail: S5Y.orange, leg: S5Y.steelD, foot: S5Y.concreteD, cross: S5Y.steel, roller: S5Y.steelL, motor: S5Y.orange, motorD: S5Y.orangeD, lamp: palette(5).glow },
  },
  6: {
    kind: 'cable', carrierShape: 'bead', main: T6Y.body, band: T6Y.cream, post: T6Y.trim, foot: T6Y.gravel, wire: T6Y.accent,
    carrier: T6Y.glow, carrierB: T6Y.cream, glow: true, lamp: T6Y.honey, glass: SNOW,
    belt: { plank: T6Y.cream, rail: T6Y.bodyL, leg: T6Y.trim, foot: T6Y.gravel, cross: T6Y.accent, roller: T6Y.creamD, motor: T6Y.crimson, motorD: T6Y.trim, lamp: T6Y.glow },
  },
  7: {
    kind: 'pipe', carrierShape: 'ring', main: T7Y.body, band: T7Y.accent, post: T7Y.steel, foot: T7Y.concrete, wire: T7Y.trim,
    carrier: T7Y.glow, carrierB: T7Y.bodyL, glow: true, lamp: T7Y.glow, glass: SNOW,
    belt: { plank: T7Y.concrete, rail: T7Y.bodyL, leg: T7Y.asphalt, foot: T7Y.concrete, cross: T7Y.accent, roller: T7Y.steel, motor: T7Y.accent, motorD: T7Y.trim, lamp: T7Y.glow },
  },
  8: {
    kind: 'tray', carrierShape: 'packet', main: mixHex(T8Y.body, T8Y.trim, 0.15), band: T8Y.accent, post: T8Y.trim, foot: mixHex(T8Y.trim, T8Y.body, 0.4), wire: T8Y.accent,
    carrier: T8Y.glow, carrierB: T8Y.accent, glow: true, lamp: T8Y.glow, glass: SNOW,
    belt: { plank: T8Y.body, rail: T8Y.accent, leg: T8Y.trim, foot: mixHex(T8Y.trim, T8Y.body, 0.4), cross: T8Y.accent, roller: mixHex(T8Y.body, T8Y.trim, 0.35), motor: T8Y.accent, motorD: T8Y.trim, lamp: T8Y.glow },
  },
  9: {
    kind: 'tube', carrierShape: 'orb', main: T9Y.body, band: T9Y.accent, post: T9Y.trim, foot: mixHex(T9Y.trim, T9Y.body, 0.4), wire: T9Y.trim,
    carrier: T9Y.glow, carrierB: T9Y.accent, glow: true, lamp: T9Y.glow, glass: mixHex(T9Y.glow, SNOW, 0.55),
    belt: { plank: T9Y.body, rail: T9Y.accent, leg: T9Y.trim, foot: mixHex(T9Y.trim, T9Y.body, 0.4), cross: T9Y.accent, roller: mixHex(T9Y.body, T9Y.trim, 0.35), motor: T9Y.accent, motorD: T9Y.trim, lamp: T9Y.glow },
  },
  10: {
    kind: 'tube', carrierShape: 'gem', main: T10Y.body, band: T10Y.accent, post: T10Y.trim, foot: mixHex(T10Y.trim, T10Y.body, 0.4), wire: T10Y.trim,
    carrier: T10Y.glow, carrierB: T10Y.accent, glow: true, lamp: T10Y.glow, glass: mixHex(T10Y.glow, SNOW, 0.6),
    belt: { plank: T10Y.body, rail: T10Y.accent, leg: T10Y.trim, foot: mixHex(T10Y.trim, T10Y.body, 0.4), cross: T10Y.accent, roller: mixHex(T10Y.body, T10Y.trim, 0.3), motor: T10Y.accent, motorD: T10Y.trim, lamp: T10Y.glow },
  },
};
