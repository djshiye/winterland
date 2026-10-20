/**
 * 0.9.8 [17] Ambient beds: the sound of each place, built around its resource (R36, R37). Every bed is a few
 * continuous layers (filtered noise, low hums) breathing with slow gusts, plus sparse events (fx/ambience/sounds.ts)
 * that come and go at random intervals. Day and night are separate weights on every layer and event, so dusk slowly
 * swaps the birds for owls and the forge's tap for the embers' crackle (Ambience.setDarkness).
 *
 *  home   Era 1 woods and village: wind in the pines, chickadees, a woodpecker, cabin fires, an owl at night
 *  road   the open trail between plots: wind and the odd gust
 *  city   the districts: a soft murmur of people, sleigh bells, shop-door bells, footsteps in the snow
 *  2  Frontier   kiln roar, fieldstone chisel, hearth crackle
 *  3  Iron Age   forge roar and bellows, the anvil's double tap, ore carts on rails, embers at night
 *  4  Steam Age  boiler hum, puffs of a little engine, valve hiss, a far-off steam whistle, gas lamps at night
 *  5  Industrial plant hum, conveyor rattle, a pellet press, coke ovens, sodium-lamp buzz at night
 *  6  Electric   mains hum, wires singing, glass insulators, tesla crackle
 *  7  Oil        wind over the plains, the flare's roar, pumpjacks nodding
 *  8  Computer   server fans, soft beeps, keyboards, sand whispering
 *  9  Nuclear    cooling-tower steam, water lapping in the aqua pools, bubbles, drips
 * 10  AI Era     the fusion halo's chord-hum, glitter, a slow shimmer swell
 *
 * Gains are relative to the Ambience bus (AMB_LEVEL); scripts/music-preview.mjs renders every bed so they can be
 * balanced against each other and the music.
 */
import type { AmbientSound } from './sounds';

export type BedId = 'home' | 'road' | 'city' | 'era2' | 'era3' | 'era4' | 'era5' | 'era6' | 'era7' | 'era8' | 'era9' | 'era10';

export const BED_IDS: readonly BedId[] = ['home', 'road', 'city', 'era2', 'era3', 'era4', 'era5', 'era6', 'era7', 'era8', 'era9', 'era10'];

/** Day / night weights (multipliers; default 1). */
interface DayNight {
  day?: number;
  night?: number;
}

export interface NoiseLayer extends DayNight {
  noise: 'white' | 'pink' | 'brown';
  filter: BiquadFilterType;
  freq: number;
  q?: number;
  gain: number;
  /** Slow random gusts: how deep (0..1), how often (s), and how far the filter wanders (share of freq). */
  gust?: { depth: number; every: [number, number]; sweep?: number };
  /** Steady tremolo (a conveyor's rattle, water lapping). */
  trem?: { rate: number; depth: number };
  pan?: number;
}

export interface HumLayer extends DayNight {
  hum: number[];
  wave?: OscillatorType;
  gain: number;
  lowpass?: number;
  /** Cents between two copies of each partial (a slow beat). */
  beat?: number;
  trem?: { rate: number; depth: number };
}

export type LayerDef = NoiseLayer | HumLayer;

export interface EventDef extends DayNight {
  sound: AmbientSound;
  /** Seconds between two, at random in this range. */
  every: [number, number];
  gain: number;
  /** Stereo spread (0 centre .. 1 anywhere). Default 0.7. */
  spread?: number;
  /** Reverb send. Default 0.45. */
  verb?: number;
}

export interface BedDef {
  /** Loudness trim (linear), so every bed sits about 12 dB under the music (scripts/music-preview.mjs measures). */
  trim: number;
  layers: LayerDef[];
  events: EventDef[];
}

const wind = (gain: number, freq = 450, depth = 0.55): NoiseLayer => ({
  noise: 'pink', filter: 'bandpass', freq, q: 0.6, gain, gust: { depth, every: [4, 9], sweep: 0.45 },
});
const birds = (k = 1): EventDef[] => [
  { sound: 'chickadee', every: [12, 26], gain: 0.022 * k, night: 0 },
  { sound: 'tweet', every: [6, 16], gain: 0.016 * k, night: 0 },
];
const owl = (k = 1): EventDef => ({ sound: 'owl', every: [20, 45], gain: 0.03 * k, day: 0 });

export const BEDS: Record<BedId, BedDef> = {
  home: {
    trim: 1.8,
    layers: [wind(0.05, 420), { noise: 'white', filter: 'highpass', freq: 3800, gain: 0.007, gust: { depth: 0.7, every: [3, 7] } }],
    events: [
      ...birds(),
      { sound: 'woodpecker', every: [30, 70], gain: 0.02, day: 0.8, night: 0 },
      { sound: 'crackle', every: [3, 7], gain: 0.02, day: 0.35, night: 1 },
      owl(),
    ],
  },
  road: {
    trim: 1.6,
    layers: [wind(0.06, 380, 0.65), { noise: 'white', filter: 'highpass', freq: 4200, gain: 0.009, gust: { depth: 0.7, every: [3, 7] } }],
    events: [
      { sound: 'gust', every: [12, 25], gain: 0.015 },
      { sound: 'tweet', every: [14, 30], gain: 0.014, day: 0.5, night: 0 },
      owl(0.7),
    ],
  },
  city: {
    trim: 1.7,
    layers: [
      // the murmur of people in the streets, quieter at night
      { noise: 'pink', filter: 'bandpass', freq: 520, q: 0.9, gain: 0.028, gust: { depth: 0.35, every: [2, 5], sweep: 0.2 }, night: 0.45 },
      { noise: 'brown', filter: 'lowpass', freq: 220, gain: 0.02, night: 0.6 },
      wind(0.022, 420),
    ],
    events: [
      { sound: 'sleigh', every: [18, 40], gain: 0.018, night: 0.5 },
      { sound: 'shopBell', every: [14, 30], gain: 0.014, night: 0.15 },
      { sound: 'crunch', every: [6, 14], gain: 0.02, night: 0.4 },
      { sound: 'chickadee', every: [25, 50], gain: 0.018, day: 0.5, night: 0 },
    ],
  },
  era2: {
    trim: 1.03,
    layers: [wind(0.045, 520, 0.6), { noise: 'brown', filter: 'lowpass', freq: 170, gain: 0.045, gust: { depth: 0.3, every: [3, 6] }, night: 1.2 }],
    events: [
      { sound: 'sleigh', every: [30, 60], gain: 0.012, night: 0.7 }, // 0.9.12: the era's fliers overhead (world/life/SkyTraffic.ts)
      { sound: 'crackle', every: [2, 5], gain: 0.022, day: 0.6, night: 1 },
      { sound: 'chink', every: [5, 12], gain: 0.02, night: 0.15 },
      { sound: 'gust', every: [15, 30], gain: 0.012 },
      ...birds(0.8),
      owl(),
    ],
  },
  era3: {
    trim: 0.89,
    layers: [wind(0.035, 460), { noise: 'brown', filter: 'lowpass', freq: 230, gain: 0.05, gust: { depth: 0.35, every: [2, 5] }, night: 1.15 }],
    events: [
      { sound: 'sleigh', every: [30, 60], gain: 0.012, night: 0.7 }, // 0.9.12: the era's fliers overhead (world/life/SkyTraffic.ts)
      { sound: 'tink', every: [3, 7], gain: 0.02, night: 0.4 },
      { sound: 'bellows', every: [7, 13], gain: 0.03 },
      { sound: 'cart', every: [30, 65], gain: 0.035, night: 0.2 },
      { sound: 'crackle', every: [3, 8], gain: 0.02, day: 0.4, night: 1 },
    ],
  },
  era4: {
    trim: 1.31,
    layers: [
      wind(0.03, 480),
      { hum: [55, 110.6, 165], gain: 0.006 },
      { noise: 'white', filter: 'highpass', freq: 3000, gain: 0.004, gust: { depth: 0.7, every: [2, 5] } },
      // gas lamps fizzing after dark
      { hum: [120, 240], wave: 'sawtooth', lowpass: 500, gain: 0.0025, day: 0, night: 1 },
    ],
    events: [
      { sound: 'sleigh', every: [30, 60], gain: 0.012, night: 0.7 }, // 0.9.12: the era's fliers overhead (world/life/SkyTraffic.ts)
      { sound: 'chuffs', every: [22, 45], gain: 0.03, night: 0.4 },
      { sound: 'hiss', every: [8, 18], gain: 0.018 },
      { sound: 'clank', every: [5, 12], gain: 0.016, night: 0.3 },
      { sound: 'trainFar', every: [70, 150], gain: 0.02, night: 0.4 },
    ],
  },
  era5: {
    trim: 1.0,
    layers: [
      { hum: [60, 120, 180], wave: 'triangle', lowpass: 320, gain: 0.007 },
      { noise: 'white', filter: 'bandpass', freq: 900, q: 2.5, gain: 0.006, trem: { rate: 7, depth: 0.6 }, night: 0.6 },
      { noise: 'brown', filter: 'lowpass', freq: 200, gain: 0.03, gust: { depth: 0.3, every: [3, 6] }, night: 1.2 },
      wind(0.025, 450),
      // sodium lamps buzzing at night
      { hum: [100, 200, 300], wave: 'sawtooth', lowpass: 420, gain: 0.002, day: 0, night: 1 },
    ],
    events: [
      { sound: 'putter', every: [35, 70], gain: 0.014, night: 0.5 }, // 0.9.12: the era's fliers overhead (world/life/SkyTraffic.ts)
      { sound: 'clank', every: [4, 9], gain: 0.016, night: 0.3 },
      { sound: 'thump', every: [3.5, 6], gain: 0.02, night: 0.2 },
      { sound: 'hiss', every: [12, 25], gain: 0.012 },
    ],
  },
  era6: {
    trim: 1.59,
    layers: [{ hum: [50, 100.4, 150.2], gain: 0.007, beat: 4, night: 1.5 }, wind(0.035, 560)],
    events: [
      { sound: 'putter', every: [35, 70], gain: 0.014, night: 0.5 }, // 0.9.12: the era's fliers overhead (world/life/SkyTraffic.ts)
      { sound: 'zap', every: [10, 24], gain: 0.012, day: 0.8, night: 1.2 },
      { sound: 'wireSing', every: [9, 20], gain: 0.01 },
      { sound: 'ting', every: [12, 26], gain: 0.012 },
      { sound: 'tweet', every: [16, 34], gain: 0.012, night: 0 },
    ],
  },
  era7: {
    trim: 1.16,
    layers: [wind(0.05, 340, 0.65), { noise: 'brown', filter: 'lowpass', freq: 260, gain: 0.035, gust: { depth: 0.5, every: [1.5, 4] }, night: 1.5 }],
    events: [
      { sound: 'putter', every: [35, 70], gain: 0.014, night: 0.5 }, // 0.9.12: the era's fliers overhead (world/life/SkyTraffic.ts)
      { sound: 'creak', every: [4, 6], gain: 0.016, night: 0.7 },
      { sound: 'clank', every: [15, 30], gain: 0.012 },
      { sound: 'gust', every: [12, 25], gain: 0.014 },
    ],
  },
  era8: {
    trim: 1.36,
    layers: [
      { noise: 'pink', filter: 'lowpass', freq: 600, q: 0.5, gain: 0.028 },
      { hum: [120, 240.3], gain: 0.003 },
      { noise: 'white', filter: 'highpass', freq: 2600, gain: 0.006, gust: { depth: 0.7, every: [3, 7] } },
    ],
    events: [
      { sound: 'whirr', every: [14, 30], gain: 0.01, night: 0.6 }, // 0.9.12: the era's fliers overhead (world/life/SkyTraffic.ts)
      { sound: 'beep', every: [5, 13], gain: 0.01, night: 0.6 },
      { sound: 'keys', every: [10, 24], gain: 0.012, night: 0.2 },
      { sound: 'tweet', every: [20, 40], gain: 0.01, day: 0.6, night: 0 },
    ],
  },
  era9: {
    trim: 1.57,
    layers: [
      { noise: 'pink', filter: 'bandpass', freq: 950, q: 0.5, gain: 0.042, gust: { depth: 0.25, every: [3, 7] } },
      { noise: 'brown', filter: 'bandpass', freq: 500, q: 1, gain: 0.02, trem: { rate: 0.35, depth: 0.5 } },
      { hum: [110, 165], gain: 0.0035, night: 1.4 },
    ],
    events: [
      { sound: 'whirr', every: [14, 30], gain: 0.01, night: 0.6 }, // 0.9.12: the era's fliers overhead (world/life/SkyTraffic.ts)
      { sound: 'bubble', every: [3, 8], gain: 0.016 },
      { sound: 'drip', every: [4, 10], gain: 0.014 },
      { sound: 'tweet', every: [20, 40], gain: 0.01, day: 0.6, night: 0 },
    ],
  },
  era10: {
    trim: 2.35,
    layers: [
      { hum: [65.41, 98.0, 130.81, 196.0], gain: 0.005, beat: 6, trem: { rate: 0.12, depth: 0.4 } },
      { noise: 'white', filter: 'highpass', freq: 6000, gain: 0.004, gust: { depth: 0.6, every: [3, 7] } },
      wind(0.02, 600),
    ],
    events: [
      { sound: 'whirr', every: [14, 30], gain: 0.01, night: 0.6 }, // 0.9.12: the era's fliers overhead (world/life/SkyTraffic.ts)
      { sound: 'glitter', every: [2.5, 6], gain: 0.012, night: 1.4, verb: 0.7 },
      { sound: 'swell', every: [18, 36], gain: 0.012, verb: 0.6 },
    ],
  },
};

/** The bed for an era's region (2..10); era 1 is home. */
export const eraBed = (era: number): BedId => (era >= 2 && era <= 10 ? (`era${era}` as BedId) : 'home');
