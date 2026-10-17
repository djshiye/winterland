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
  { day: day({}), night: night({}), grade: { day: grade(0xfffcfa, 0x0d0812, 1.06, 1.03, 0.2), night: grade(0xfff8ee, 0x110b18, 1.08, 1.02, 0.3) } },
  // 2 Frontier: fieldstone and clay, kiln mouths
  { day: day({}), night: night({ hemiGround: 0x644a4c }), grade: { day: grade(0xfffcfa, 0x0e0911, 1.05, 1.03, 0.2), night: grade(0xfff6ee, 0x120b16, 1.08, 1.02, 0.3) } },
  // 3 Iron Age: rust ore, forge orange
  { day: day({}), night: night({ hemiGround: 0x704a40, sky: 0x241e42 }), grade: { day: grade(0xfffbf8, 0x0f0910, 1.07, 1.05, 0.22), night: grade(0xfff4ea, 0x140b15, 1.1, 1.04, 0.32) } },
  // 4 Steam Age: coal and brass, gas lamps
  { day: day({}), night: night({ hemiGround: 0x644c44, hemiSky: 0x6674bc }), grade: { day: grade(0xfefcf8, 0x0e0a10, 1.0, 1.04, 0.24), night: grade(0xfcf4ec, 0x120d15, 1.04, 1.03, 0.34) } },
  // 5 Industrial: iron pellets and coke, sodium lamps
  { day: day({}), night: night({ hemiGround: 0x6a5040, sky: 0x221f40 }), grade: { day: grade(0xfffcf8, 0x0e0a10, 1.04, 1.05, 0.22), night: grade(0xfff8e8, 0x130d14, 1.08, 1.04, 0.32) } },
  // 6 Electric Age: copper and teal, mint bulbs
  { day: day({}), night: night({ hemiGround: 0x565250, hemiSky: 0x5e7ec4, sky: 0x1a2446 }), grade: { day: grade(0xfcfefc, 0x0a0c11, 1.06, 1.03, 0.2), night: grade(0xfafaf6, 0x0d0f16, 1.08, 1.03, 0.3) } },
  // 7 Oil: honey lanes, flare peach
  { day: day({}), night: night({ hemiGround: 0x6c4e40 }), grade: { day: grade(0xfffcf6, 0x0f0a10, 1.06, 1.04, 0.22), night: grade(0xfff6e8, 0x130c14, 1.08, 1.03, 0.32) } },
  // 8 Computer: beige terrazzo, screen mint
  { day: day({}), night: night({ hemiGround: 0x56524e, hemiSky: 0x6678c2 }), grade: { day: grade(0xfefefc, 0x0b0b10, 1.02, 1.03, 0.18), night: grade(0xfafaf6, 0x0e0e15, 1.06, 1.02, 0.28) } },
  // 9 Nuclear: mint glaze, aqua pools
  { day: day({}), night: night({ hemiGround: 0x50564c, hemiSky: 0x5c84c4, sky: 0x18264a }), grade: { day: grade(0xfcfefc, 0x0a0d10, 1.04, 1.03, 0.18), night: grade(0xf8fcfa, 0x0d1014, 1.08, 1.02, 0.28) } },
  // 10 AI: cream hex and gold seams, fusion sun-gold
  { day: day({}), night: night({ hemiGround: 0x6e5844, hemiSky: 0x6c74c0, sky: 0x221e44 }), grade: { day: grade(0xfffefa, 0x0d0b10, 1.04, 1.02, 0.16), night: grade(0xfff8ee, 0x110d15, 1.08, 1.02, 0.26) } },
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
  [0xb9ab98, 0x8f8170, 0xffb347, 0xccd4de], // fieldstone flags and mortar; hearth glow in the kiln mouths
  [0x94604c, 0xc9906b, 0xff9233, 0xd0d8e2], // rust-ore gravel; forge orange
  [0x7d7a78, 0xc77a45, 0xffbe55, 0xc5ced9], // cinder slate with warm specks; boiler doors, gas lamps
  [0xb8613f, 0x8a6a5c, 0xffd166, 0xbac4d0], // herringbone brick, pellet-grey yard; sodium lamps
  [0x5f8f86, 0x8fb0aa, 0x7ce8c8, 0xb4c0cc], // teal cobbles; mint bulbs on the wires
  [0x5e5753, 0xe2ad3c, 0xffaa5a, 0xaebac6], // warm asphalt with honey lanes; flare peach
  [0xe2d6bd, 0xd8cdb4, 0x66e0a3, 0xc2ccd6], // beige terrazzo, sand; screen mint
  [0xa9c9bb, 0xcfe3d9, 0x70f5d9, 0xcbd6e0], // mint-glazed concrete; aqua pools
  [0xf3ead8, 0xe8a848, 0xffe082, 0xcad4e0], // cream hex panels with gold seams; sun-gold fusion glow
];

/** District building colours, eras 2..10 (assets/cityBuildings.ts adds its own storey heights). */
const CITY: readonly (CityStyle | null)[] = [
  null,
  null,
  { wall: 0xb85239, wall2: 0x9a4430, roof: 0x5c4028, trim: 0xe9dfcc, accent: 0xd9a441, tint: 0xffb347 },
  { wall: 0x8a5442, wall2: 0x5e3a2c, roof: 0x3d3a3a, trim: 0x2f3538, accent: 0x7a8087, tint: 0xffb347 },
  { wall: 0xa5703f, wall2: 0x7d5330, roof: 0x4a3a2c, trim: 0x383d40, accent: 0xd49a35, tint: 0xffc05a },
  { wall: 0x93453a, wall2: 0x6f3a2f, roof: 0x333c42, trim: 0x525c63, accent: 0xe08a2b, tint: 0xffcf70 },
  { wall: 0xe3d8bc, wall2: 0xbfb08a, roof: 0x2b3b39, trim: 0xd97f38, accent: 0x4c6b68, tint: 0xffe08a },
  { wall: 0xb0a594, wall2: 0x8a8070, roof: 0x36383a, trim: 0xd99b26, accent: 0xc44536, tint: 0xffe6b0 },
  { wall: 0xe6dec8, wall2: 0x8fb3b0, roof: 0x4a5259, trim: 0xf5f0e6, accent: 0x45858c, tint: 0xd8f5e4 },
  { wall: 0xdce3e6, wall2: 0x9fb8b4, roof: 0x3d5259, trim: 0xf5f0e6, accent: 0x4ea885, tint: 0xd2fbef },
  { wall: 0xf5f0e6, wall2: 0xcdc3ae, roof: 0x526475, trim: 0xe8a848, accent: 0xe8a848, tint: 0xffe7a8 },
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
