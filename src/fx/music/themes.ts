/**
 * 0.9.8 [17] One cozy theme per era, each built around the era's main resource and look (R36, R37):
 *
 *  1 Survival     "Cabin Hearth"    C major 78     the 0.9.x tune kept: bell pluck over felt piano, logs and lanterns
 *  2 Frontier     "Kiln Road"       G major 3/4    a wooden flute over a hammered dulcimer: fieldstone and kiln hearths
 *  3 Iron Age     "Forge Glow"      D dorian 72    kalimba and harp over dark strings, a far-off anvil ting
 *  4 Steam Age    "Brass & Bellows" F major waltz  music box, harmonium "oom-pah-pah" and a soft tuba: boilers, gas lamps
 *  5 Industrial   "Pellet Yard"     A minor 88     a felt-piano ostinato like a calm conveyor, celesta, shaker: pellets, coke
 *  6 Electric Age "Copper Lights"   Bb major 82    swung electric piano and vibes, brushes: copper wire, mint bulbs
 *  7 Oil Age      "Honey Flare"     E major 76     fingerpicked guitar and a lap-steel slide: pumpjacks, honey barrels
 *  8 Computer Age "Silicon Snow"    A major 92     soft chiptune arps over a warm pad: silicon chips, mint screens
 *  9 Nuclear      "Aqua Glow"       D lydian 66    vibes and harp, glassy pad, lots of air: cooling towers, aqua pools
 * 10 AI Era       "Golden Halo"     C lydian 74    FM glass bells, celesta shimmer, a choir pad: rare earths, helium-3 fusion
 *
 * Each theme is two 8-bar sections (A, B) played as an arrangement with an intro and a "breath" (only pad and a soft
 * arpeggio), so the loop runs about two minutes and rests regularly: never fatiguing (S4). At night the rhythm layers
 * drop out, the melody thins and the pads darken (Music.setNight). All data, checked by tests/music.test.ts.
 */
import type { InstrumentId } from './instruments';
import { HOLD, parseChords, parseLine, type Chord } from './notation';

export type PadStyle = 'warm' | 'strings' | 'choir' | 'glass' | 'reed';
/** Layers a section can switch on. */
export type Layer = 'pad' | 'bass' | 'melody' | 'counter' | 'arp' | 'stab' | 'perc';

export interface PartMix {
  /** Linear gain of the part bus. */
  gain: number;
  /** Stereo position -1..1. */
  pan: number;
  /** Reverb send 0..1. */
  verb: number;
}

export interface Theme {
  era: number;
  title: string;
  bpm: number;
  beatsPerBar: 3 | 4;
  /** Late off-beat eighths (0 = straight, 0.33 = triplet swing), as a share of a sixteenth... of an eighth. */
  swing: number;
  /** Pitch classes of the key (for melody variations). */
  scale: number[];
  sections: { A: Section; B: Section };
  /** Section order; the loop restarts at `loopFrom`. */
  form: { section: 'A' | 'B'; layers: Layer[] }[];
  loopFrom: number;
  lead: InstrumentId;
  /** A softer lead for the night, if the day one is too bright. */
  nightLead?: InstrumentId;
  counter?: InstrumentId;
  bass: { inst: InstrumentId; /** Per sixteenth of the bar: semitones above the chord's bass, or null. */ pattern: (number | null)[] };
  pad: { style: PadStyle; cutoff: number; level: number };
  /** Broken-chord figure: per sixteenth, an index into the chord tones (+ n for octaves up), or -1. */
  arp?: { inst: InstrumentId; pattern: number[]; octave: number; vel: number };
  /** Chord stabs (e-piano comping, harmonium "pah"): sixteenths where the whole chord plays. */
  stab?: { inst: InstrumentId; slots: number[]; vel: number; len: number };
  /** Soft percussion: per instrument a pattern string over the bar's sixteenths (`x` hit, `o` softer hit, `.` rest). */
  perc?: Partial<Record<InstrumentId, string>>;
  mix: Record<'lead' | 'counter' | 'bass' | 'pad' | 'arp' | 'stab' | 'perc', PartMix>;
  /** Loudness trim (linear), so every theme plays at the same level. */
  trim: number;
  /** Night: pad cutoff factor, melody notes kept (0..1), loudness trim on top of `trim`, night lead level. */
  night: { cutoff: number; keep: number; trim: number; lead?: number };
}

export interface Section {
  chords: Chord[];
  /** Per bar, one entry per eighth (MIDI, 0 rest, HOLD tie). */
  melody: number[][];
  counter?: number[][];
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const key = (root: number, steps: number[]): number[] => steps.map((s) => (s + root) % 12);

const sec = (beats: 3 | 4, chords: string, melody: string, counter?: string): Section => ({
  chords: parseChords(chords),
  melody: parseLine(melody, beats * 2),
  counter: counter ? parseLine(counter, beats * 2) : undefined,
});

/** Bass pattern helper: hits at these sixteenths with these intervals. */
const bassAt = (steps: number, hits: Record<number, number>): (number | null)[] =>
  Array.from({ length: steps }, (_, i) => (i in hits ? hits[i]! : null));

const STD_FORM: Theme['form'] = [
  { section: 'A', layers: ['pad', 'bass', 'melody'] }, // intro: gentle
  { section: 'A', layers: ['pad', 'bass', 'melody', 'arp', 'stab', 'perc'] },
  { section: 'B', layers: ['pad', 'bass', 'melody', 'arp', 'stab', 'perc', 'counter'] },
  { section: 'A', layers: ['pad', 'bass', 'melody', 'counter', 'arp', 'stab', 'perc'] },
  { section: 'A', layers: ['pad', 'arp', 'bass'] }, // the breath: no tune, just the room
];

const mix = (p: Partial<Theme['mix']>): Theme['mix'] => ({
  lead: { gain: 0.5, pan: 0.12, verb: 0.35 },
  counter: { gain: 0.32, pan: -0.3, verb: 0.35 },
  bass: { gain: 0.42, pan: 0, verb: 0.08 },
  pad: { gain: 0.5, pan: 0, verb: 0.45 },
  arp: { gain: 0.26, pan: -0.25, verb: 0.3 },
  stab: { gain: 0.3, pan: 0.2, verb: 0.3 },
  perc: { gain: 0.35, pan: 0.15, verb: 0.15 },
  ...p,
});

export const THEMES: readonly Theme[] = [
  {
    era: 1,
    title: 'Cabin Hearth',
    bpm: 78,
    beatsPerBar: 4,
    swing: 0,
    scale: key(0, MAJOR),
    sections: {
      // the original 0.9.x tune, note for note
      A: sec(4, 'C Am F G C Em F G',
        'E5 . G5 . E5 . D5 . | C5 . E5 . A5 . G5 . | E5 . A5 . G5 . E5 . | D5 . G5 . D5 . . G5 | ' +
        'G5 . E5 . G5 . C6 . | G5 . E5 . D5 . E5 . | A5 . G5 . E5 . C5 . | D5 . E5 . D5 . . .',
        'C4 . . . E4 . . . | A3 . . . C4 . . . | F3 . . . A3 . . . | G3 . . . B3 . . . | ' +
        'C4 . . . G4 . . . | B3 . . . G3 . . . | A3 . . . C4 . . . | B3 . . . D4 . . .'),
      B: sec(4, 'Am F C G Am F Gsus4 G',
        'E5 . . C5 D5 . E5 . | F5 . E5 . C5 . A4 . | G4 . C5 . E5 . G5 . | D5 - - . B4 . . . | ' +
        'E5 . . C5 D5 . E5 . | A5 . G5 . F5 . E5 . | D5 . E5 . D5 . C5 . | D5 - - - . . . .',
        'A3 . . . C4 . . . | F3 . . . A3 . . . | E4 . . . C4 . . . | D4 . . . B3 . . . | ' +
        'A3 . . . E4 . . . | F3 . . . C4 . . . | C4 . . . G3 . . . | B3 . . . . . . .'),
    },
    form: STD_FORM,
    loopFrom: 1,
    lead: 'bell',
    counter: 'felt',
    bass: { inst: 'bassRound', pattern: bassAt(16, { 0: 0, 8: 0 }) },
    pad: { style: 'warm', cutoff: 1300, level: 1 },
    arp: { inst: 'felt', pattern: [0, -1, -1, -1, 2, -1, -1, -1, 1, -1, -1, -1, 3, -1, -1, -1], octave: 0, vel: 0.5 },
    mix: mix({ arp: { gain: 0.18, pan: -0.2, verb: 0.35 } }),
    night: { cutoff: 0.62, keep: 0.8, trim: 0.935 },
    trim: 0.594,
  },
  {
    era: 2,
    title: 'Kiln Road',
    bpm: 96,
    beatsPerBar: 3,
    swing: 0,
    scale: key(7, MAJOR),
    sections: {
      A: sec(3, 'G C G D Em C D G',
        'D5 - - B4 C5 D5 | E5 - D5 C5 - B4 | D5 - B4 G4 - - | A4 - B4 C5 - A4 | ' +
        'B4 - - E5 - D5 | C5 - E5 G5 - E5 | D5 - C5 A4 - F#4 | G4 - - - - .'),
      B: sec(3, 'Em C G D Em C Am D',
        'G5 - F#5 E5 - B4 | C5 - D5 E5 - G5 | D5 - - B4 - - | A4 - B4 D5 - A4 | ' +
        'B4 - E5 G5 - F#5 | E5 - D5 C5 - E5 | A4 - B4 C5 - E5 | D5 - - - - .',
        'E4 . . G4 . . | E4 . . C4 . . | B3 . . D4 . . | F#4 . . A4 . . | ' +
        'G4 . . B4 . . | G4 . . E4 . . | E4 . . A4 . . | F#4 . . . . .'),
    },
    form: STD_FORM,
    loopFrom: 1,
    lead: 'flute',
    counter: 'harp',
    bass: { inst: 'bassUpright', pattern: bassAt(12, { 0: 0 }) },
    pad: { style: 'warm', cutoff: 1100, level: 0.7 },
    // dulcimer: low, high, middle, high, middle, high (in eighths)
    arp: { inst: 'dulcimer', pattern: [0, -1, 3, -1, 1, -1, 3, -1, 2, -1, 3, -1], octave: 0, vel: 0.55 },
    perc: { kick: 'x...........' },
    mix: mix({ lead: { gain: 0.48, pan: 0.15, verb: 0.38 }, perc: { gain: 0.3, pan: 0, verb: 0.1 } }),
    night: { cutoff: 0.6, keep: 0.75, trim: 1.0 },
    trim: 0.791,
  },
  {
    era: 3,
    title: 'Forge Glow',
    bpm: 72,
    beatsPerBar: 4,
    swing: 0,
    scale: key(2, [0, 2, 3, 5, 7, 9, 10]),
    sections: {
      A: sec(4, 'Dm7 G Fmaj7 C Dm7 Em7 Fmaj7 G',
        'A4 . D5 . E5 . F5 . | D5 - - . B4 . . . | C5 . F5 . A5 . G5 . | E5 - - . . . G4 . | ' +
        'A4 . D5 . E5 . F5 E5 | D5 . B4 . G4 . B4 . | C5 . E5 . F5 . A5 . | G5 - - . D5 . . .'),
      B: sec(4, 'Am7 Fmaj7 C G Am7 Fmaj7 Em7 G',
        'E5 - - . A5 . G5 . | F5 . E5 . C5 - - . | E5 . G5 . C6 . B5 . | B5 - - . G5 . D5 . | ' +
        'C5 . E5 . A5 - - G5 | A5 . F5 . E5 . C5 . | B4 . D5 . E5 . G5 . | D5 - - - . . . .',
        'A3 . . . E4 . . . | F3 . . . C4 . . . | E4 . . . G4 . . . | D4 . . . B3 . . . | ' +
        'A3 . . . C4 . . . | F3 . . . A3 . . . | G3 . . . B3 . . . | B3 . . . . . . .'),
    },
    form: STD_FORM,
    loopFrom: 1,
    lead: 'kalimba',
    counter: 'harp',
    bass: { inst: 'bassRound', pattern: bassAt(16, { 0: 0, 10: 7 }) },
    pad: { style: 'strings', cutoff: 950, level: 0.9 },
    arp: { inst: 'harp', pattern: [0, -1, -1, -1, 1, -1, -1, -1, 2, -1, -1, -1, 1, -1, -1, -1], octave: -1, vel: 0.5 },
    // a soft felt drum on 1 and a far-off anvil ting on 3: the forge breathing
    perc: { kick: 'x...............', tink: '........o.......' },
    mix: mix({ perc: { gain: 0.3, pan: 0.35, verb: 0.55 } }),
    night: { cutoff: 0.6, keep: 0.7, trim: 0.984 },
    trim: 0.639,
  },
  {
    era: 4,
    title: 'Brass & Bellows',
    bpm: 108,
    beatsPerBar: 3,
    swing: 0,
    scale: key(5, MAJOR),
    sections: {
      A: sec(3, 'F Dm Bb C F Am Gm7 C7',
        'C5 - - A4 - C5 | F5 - - E5 - D5 | D5 - - F5 - D5 | C5 - - - G4 - | ' +
        'A4 - - C5 - F5 | E5 - - A5 - G5 | F5 - - D5 - Bb4 | C5 - - - - .'),
      B: sec(3, 'Bb F Gm C Dm Bb C7 F',
        'D5 - F5 Bb5 - A5 | A5 - - F5 - C5 | Bb4 - D5 G5 - F5 | E5 - - C5 - - | ' +
        'D5 - F5 A5 - G5 | F5 - D5 Bb4 - D5 | C5 - E5 G5 - Bb5 | A5 - - - - .',
        'F4 - - D4 - - | F4 - - A4 - - | D4 - - Bb3 - - | C4 - - E4 - - | ' +
        'F4 - - A4 - - | D4 - - F4 - - | E4 - - C4 - - | C4 - - - - .'),
    },
    form: STD_FORM,
    loopFrom: 1,
    lead: 'musicbox',
    counter: 'horn',
    bass: { inst: 'tuba', pattern: bassAt(12, { 0: 0 }) },
    pad: { style: 'reed', cutoff: 1000, level: 0.55 },
    // the waltz "pah-pah" on beats 2 and 3, on a harmonium
    stab: { inst: 'reed', slots: [4, 8], vel: 0.42, len: 0.24 },
    mix: mix({ counter: { gain: 0.26, pan: -0.3, verb: 0.4 }, stab: { gain: 0.24, pan: -0.15, verb: 0.3 } }),
    night: { cutoff: 0.6, keep: 0.75, trim: 1.03 },
    trim: 0.642,
  },
  {
    era: 5,
    title: 'Pellet Yard',
    bpm: 88,
    beatsPerBar: 4,
    swing: 0,
    scale: key(9, [0, 2, 3, 5, 7, 8, 10, 11]),
    sections: {
      A: sec(4, 'Am F C G Am F Dm E',
        'E5 . . . . . A5 . | G5 . . . F5 . E5 . | E5 . . . . . G5 . | D5 - - - . . . . | ' +
        'E5 . . . . . C6 . | B5 . . . A5 . . . | F5 . . . E5 . D5 . | G#5 - - - B5 . . .'),
      B: sec(4, 'F G Em Am Dm G C E',
        'A5 . . . C6 . . . | B5 . . . G5 . . . | G5 . . . E5 . . . | A5 - - - . . . . | ' +
        'F5 . . . A5 . . . | G5 . . . D5 . . . | E5 . . . G5 . . . | G#5 - - - . . . .',
        'C4 . . . A3 . . . | D4 . . . B3 . . . | B3 . . . G3 . . . | C4 . . . E4 . . . | ' +
        'A3 . . . F3 . . . | B3 . . . D4 . . . | C4 . . . E4 . . . | B3 . . . . . . .'),
    },
    form: STD_FORM,
    loopFrom: 1,
    lead: 'celesta',
    counter: 'kalimba',
    bass: { inst: 'bassUpright', pattern: bassAt(16, { 0: 0, 6: 0, 8: 7, 12: 0 }) },
    pad: { style: 'strings', cutoff: 1100, level: 0.75 },
    // the felt-piano ostinato: a calm conveyor of eighths
    arp: { inst: 'felt', pattern: [0, -1, 2, -1, 1, -1, 2, -1, 0, -1, 2, -1, 1, -1, 3, -1], octave: 0, vel: 0.5 },
    perc: { shaker: '..o...o...o...o.', kick: 'x.......x.......' },
    mix: mix({ arp: { gain: 0.24, pan: -0.25, verb: 0.3 } }),
    night: { cutoff: 0.6, keep: 0.7, trim: 1.135 },
    trim: 0.92,
  },
  {
    era: 6,
    title: 'Copper Lights',
    bpm: 82,
    beatsPerBar: 4,
    swing: 0.32,
    scale: key(10, MAJOR),
    sections: {
      A: sec(4, 'Bbmaj7 Gm7 Cm7 F7 Bbmaj7 Gm7 Ebmaj7 F7',
        'D5 . F5 . A5 - - G5 | F5 . D5 . Bb4 - - . | Eb5 . G5 . Bb5 . A5 . | G5 . F5 - - - . . | ' +
        'D5 . F5 . A5 . C6 . | Bb5 . A5 . G5 . D5 . | Eb5 . G5 . Bb5 . G5 . | F5 - - - . . . .'),
      B: sec(4, 'Ebmaj7 Dm7 Gm7 Cm7 Ebmaj7 Dm7 Cm7 F7',
        'G5 . . Bb5 - . G5 . | F5 . . A5 - . F5 . | D5 . F5 . Bb5 . A5 . | G5 - - . Eb5 . . . | ' +
        'Bb4 . D5 . G5 . Bb5 . | A5 - - . F5 . D5 . | Eb5 . D5 . C5 . Bb4 . | C5 - - - . . . .'),
    },
    form: STD_FORM,
    loopFrom: 1,
    lead: 'vibes',
    bass: { inst: 'bassUpright', pattern: bassAt(16, { 0: 0, 8: 7 }) },
    pad: { style: 'warm', cutoff: 900, level: 0.5 },
    // e-piano comping: on 1 and the "and" of 2
    stab: { inst: 'epiano', slots: [0, 6], vel: 0.42, len: 0.6 },
    perc: { brush: '....x.......x...' },
    mix: mix({ stab: { gain: 0.34, pan: -0.2, verb: 0.32 } }),
    night: { cutoff: 0.65, keep: 0.75, trim: 1.21 },
    trim: 0.799,
  },
  {
    era: 7,
    title: 'Honey Flare',
    bpm: 76,
    beatsPerBar: 4,
    swing: 0.18,
    scale: key(4, MAJOR),
    sections: {
      A: sec(4, 'E A E B C#m A B E',
        'B4 - - G#4 B4 - C#5 - | E5 - - - C#5 - - . | B4 - G#4 - E4 - - . | F#4 - G#4 - B4 - - . | ' +
        'G#4 - - B4 C#5 - E5 - | E5 - C#5 - A4 - - . | B4 - - A4 F#4 - - . | E4 - - - - - - .'),
      B: sec(4, 'A E B C#m A E F#m B',
        'A4 - C#5 - E5 - - . | G#5 - - E5 - - - . | F#5 - - D#5 B4 - - . | C#5 - E5 - G#5 - - . | ' +
        'A5 - - - E5 - C#5 - | B4 - - G#4 B4 - E5 - | C#5 - - A4 F#4 - - . | F#4 - - - D#5 - - .'),
    },
    form: STD_FORM,
    loopFrom: 1,
    lead: 'slide',
    bass: { inst: 'bassUpright', pattern: bassAt(16, { 0: 0, 8: 7 }) },
    pad: { style: 'warm', cutoff: 900, level: 0.55 },
    // fingerpicked guitar (Travis-ish: thumb on 1 and 3, fingers between)
    arp: { inst: 'guitar', pattern: [0, -1, 2, -1, 1, -1, 3, -1, 0, -1, 2, -1, 1, -1, 3, -1], octave: 0, vel: 0.6 },
    perc: { brush: '....o.......o...' },
    mix: mix({ arp: { gain: 0.3, pan: -0.25, verb: 0.28 }, lead: { gain: 0.46, pan: 0.18, verb: 0.4 } }),
    night: { cutoff: 0.62, keep: 0.75, trim: 1.0 },
    trim: 1.212,
  },
  {
    era: 8,
    title: 'Silicon Snow',
    bpm: 92,
    beatsPerBar: 4,
    swing: 0,
    scale: key(9, MAJOR),
    sections: {
      A: sec(4, 'Amaj7 F#m7 Dmaj7 E Amaj7 C#m7 Dmaj7 E',
        'E5 . C#5 . E5 . A5 . | G#5 . F#5 - - . C#5 . | D5 . F#5 . A5 . G#5 . | E5 - - . B4 . . . | ' +
        'E5 . C#5 . E5 . B5 . | A5 . G#5 . E5 - - . | F#5 . A5 . C#6 . B5 . | B5 - - - . . . .'),
      B: sec(4, 'D E C#m F#m D E Bm7 E',
        'F#5 - - . A5 . F#5 . | G#5 - - . E5 . . . | E5 . G#5 . C#6 . B5 . | A5 - - . F#5 . . . | ' +
        'D5 . F#5 . A5 - - F#5 | G#5 - - . B5 . . . | A5 . F#5 . D5 . B4 . | E5 - - - . . . .',
        'A4 . . . F#4 . . . | B4 . . . G#4 . . . | G#4 . . . E4 . . . | F#4 . . . C#4 . . . | ' +
        'F#4 . . . D4 . . . | E4 . . . G#4 . . . | D4 . . . F#4 . . . | G#4 . . . . . . .'),
    },
    form: STD_FORM,
    loopFrom: 1,
    lead: 'chip',
    nightLead: 'celesta',
    counter: 'chipPluck',
    bass: { inst: 'bassTri', pattern: bassAt(16, { 0: 0, 4: 0, 8: 7, 12: 0 }) },
    pad: { style: 'warm', cutoff: 1000, level: 0.7 },
    // the arpeggiator: up and down the chord in sixteenths, quietly
    arp: { inst: 'chipPluck', pattern: [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1], octave: 1, vel: 0.35 },
    perc: { kick: 'x.......x.......', shaker: '....o.......o...' },
    mix: mix({ arp: { gain: 0.2, pan: -0.3, verb: 0.3 }, lead: { gain: 0.4, pan: 0.12, verb: 0.32 } }),
    night: { cutoff: 0.6, keep: 0.7, trim: 1.0 },
    trim: 0.991,
  },
  {
    era: 9,
    title: 'Aqua Glow',
    bpm: 66,
    beatsPerBar: 4,
    swing: 0,
    scale: key(2, [0, 2, 4, 6, 7, 9, 11]),
    sections: {
      A: sec(4, 'Dmaj7 E/D Dmaj7 E/D Bm7 C#m7 Dmaj7 E',
        'F#5 - - . A5 - - . | G#5 - - . E5 - - . | F#5 - - . C#6 - - . | B5 - - . G#5 - - . | ' +
        'F#5 - - . D5 - - . | E5 - - . G#5 - - . | A5 - - . F#5 - - . | E5 - - - - - . .'),
      B: sec(4, 'Bm7 E/D F#m7 E Bm7 E/D C#m7 E',
        'D6 - - . B5 - - . | G#5 - - . B5 - - . | A5 - - . F#5 . C#5 . | E5 - - - - - . . | ' +
        'F#5 - - . B5 - - . | G#5 - - . E5 - - . | E5 - - . G#5 . B5 . | A5 - - - - - . .',
        'B3 . . . . . . . | D4 . . . . . . . | C#4 . . . . . . . | B3 . . . . . . . | ' +
        'D4 . . . . . . . | B3 . . . . . . . | E4 . . . . . . . | C#4 . . . . . . .'),
    },
    form: STD_FORM,
    loopFrom: 1,
    lead: 'vibes',
    counter: 'harp',
    bass: { inst: 'bassRound', pattern: bassAt(16, { 0: 0 }) },
    pad: { style: 'glass', cutoff: 1600, level: 0.9 },
    // harp ripples like light on water
    arp: { inst: 'harp', pattern: [0, -1, 1, -1, 2, -1, 3, -1, 4, -1, 3, -1, 2, -1, 1, -1], octave: 0, vel: 0.36 },
    mix: mix({ arp: { gain: 0.22, pan: -0.3, verb: 0.5 }, lead: { gain: 0.46, pan: 0.15, verb: 0.5 } }),
    night: { cutoff: 0.65, keep: 0.75, trim: 0.96 },
    trim: 0.875,
  },
  {
    era: 10,
    title: 'Golden Halo',
    bpm: 74,
    beatsPerBar: 4,
    swing: 0,
    scale: key(0, [0, 2, 4, 6, 7, 9, 11]),
    sections: {
      A: sec(4, 'Cmaj9 D/C Em7 D Cmaj9 D/C Am7 Bm7',
        'G5 - - E5 D5 - - . | F#5 - - . A5 - - . | G5 - - . B5 - - . | A5 - - . F#5 - - . | ' +
        'E5 - - G5 B5 - - . | A5 - - . F#5 . D5 . | E5 - - . C6 - - . | B5 - - - - - . .'),
      B: sec(4, 'Am7 D Gmaj7 Cmaj7 Am7 D Em7 D',
        'C6 - - . A5 - - . | F#5 - - . A5 - - . | B5 - - . D6 - - . | E6 - - - - - . . | ' +
        'C6 - - . A5 . E5 . | F#5 - - . D5 - - . | E5 - - . G5 . B5 . | A5 - - - - - . .',
        'E4 . . . C4 . . . | D4 . . . F#4 . . . | D4 . . . B3 . . . | G4 . . . E4 . . . | ' +
        'E4 . . . A4 . . . | F#4 . . . A4 . . . | G4 . . . E4 . . . | F#4 . . . . . . .'),
    },
    form: STD_FORM,
    loopFrom: 1,
    lead: 'glass',
    counter: 'vibes',
    bass: { inst: 'bassRound', pattern: bassAt(16, { 0: 0, 12: 7 }) },
    pad: { style: 'choir', cutoff: 1800, level: 0.85 },
    // the fusion shimmer: celesta sixteenths, up two octaves of the chord and back
    arp: { inst: 'celesta', pattern: [0, 2, 4, 6, 4, 2, 1, 3, 5, 3, 1, 2, 4, 6, 4, 2], octave: 1, vel: 0.26 },
    mix: mix({ arp: { gain: 0.2, pan: -0.32, verb: 0.55 }, lead: { gain: 0.48, pan: 0.15, verb: 0.5 } }),
    night: { cutoff: 0.65, keep: 0.75, trim: 1.0 },
    trim: 0.691,
  },
];

/** The theme of era n (1..10; anything else falls back to era 1). */
export function themeFor(era: number): Theme {
  return THEMES.find((t) => t.era === era) ?? THEMES[0]!;
}

/** Sixteenths per bar. */
export const stepsPerBar = (t: Theme): number => t.beatsPerBar * 4;

/** Seconds per sixteenth. */
export const sixteenth = (t: Theme): number => 60 / t.bpm / 4;

/**
 * Held length of the melody note starting at `slot` of `bar` (in eighths, counting its ties). Ties never cross the bar
 * line in these themes.
 */
export function heldEighths(bar: number[], slot: number): number {
  let n = 1;
  while (slot + n < bar.length && bar[slot + n] === HOLD) n++;
  return n;
}
