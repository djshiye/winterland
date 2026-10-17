/**
 * 0.9.8 [17] Tiny music notation for the era themes (fx/music/themes.ts), pure so the tests can check every theme.
 *
 * - Notes: `C4`, `F#5`, `Bb3` (scientific pitch, C4 = MIDI 60).
 * - Melody lines: one token per eighth note, bars split by `|`. A note name starts a note, `-` holds the note before
 *   it (a tie), `.` is a rest. `parseLine` gives per bar an array of MIDI (note), 0 (rest) or HOLD.
 * - Chords: `C`, `Am`, `F#m7`, `Bbmaj7`, `Dm9`, `Gsus4`, `E/D` (slash bass), `C6`, `Cadd9`, `Bm7b5`. `parseChords`
 *   voices each chord close around G3..C5 with smooth voice leading from the one before, and gives its bass note.
 */

export const HOLD = -1;

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI number of a note name like `F#5` or `Bb3`; throws on anything else. */
export function noteToMidi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note "${name}"`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + PC[m[1]!]! + acc;
}

/** Pitch class (0..11) of a root like `F#` or `Bb`. */
function rootPc(name: string): number {
  const acc = name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0;
  return (PC[name[0]!]! + acc + 12) % 12;
}

/** One melody line: per bar, one entry per eighth (MIDI, 0 = rest, HOLD = tie). */
export function parseLine(src: string, slotsPerBar: number): number[][] {
  return src
    .split('|')
    .map((bar) => bar.trim())
    .filter((bar) => bar.length > 0)
    .map((bar, i) => {
      const toks = bar.split(/\s+/);
      if (toks.length !== slotsPerBar) throw new Error(`bar ${i + 1} has ${toks.length} slots, not ${slotsPerBar}: "${bar}"`);
      return toks.map((t) => (t === '.' ? 0 : t === '-' ? HOLD : noteToMidi(t)));
    });
}

/** Intervals above the root for each chord quality. */
const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '9': [0, 4, 10, 14],
  maj9: [0, 4, 11, 14],
  m9: [0, 3, 10, 14],
  add9: [0, 4, 7, 14],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim: [0, 3, 6],
};

export interface Chord {
  /** The symbol as written. */
  name: string;
  /** Close voicing, low to high (MIDI). */
  notes: number[];
  /** Bass note (MIDI, octave 2..3). */
  bass: number;
  /** Pitch classes of the chord tones (root first). */
  pcs: number[];
}

/** Pitch classes (root first) and bass pitch class of a chord symbol; throws on an unknown symbol. */
export function chordPcs(sym: string): { pcs: number[]; bassPc: number } {
  const m = /^([A-G][#b]?)([a-z0-9]*)(?:\/([A-G][#b]?))?$/.exec(sym);
  if (!m || !(m[2]! in QUALITY)) throw new Error(`bad chord "${sym}"`);
  const root = rootPc(m[1]!);
  const pcs = QUALITY[m[2]!]!.map((iv) => (root + iv) % 12);
  return { pcs, bassPc: m[3] ? rootPc(m[3]) : root };
}

const VOICE_LOW = 53; // F3
const VOICE_HIGH = 74; // D5

/** Every close voicing of these pitch classes (each inversion) that fits the pad range. */
function voicings(pcs: number[]): number[][] {
  const out: number[][] = [];
  const n = pcs.length;
  for (let inv = 0; inv < n; inv++) {
    for (let base = VOICE_LOW; base < VOICE_LOW + 12; base++) {
      if (base % 12 !== pcs[inv]) continue;
      const v = [base];
      for (let k = 1; k < n; k++) {
        const pc = pcs[(inv + k) % n]!;
        let m = v[k - 1]! + 1;
        while (m % 12 !== pc) m++;
        v.push(m);
      }
      if (v[v.length - 1]! <= VOICE_HIGH) out.push(v);
    }
  }
  return out;
}

/** Total movement between two voicings (compared low to high; a missing voice counts from the nearest). */
function distance(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < b.length; i++) d += Math.abs(b[i]! - a[Math.min(i, a.length - 1)]!);
  return d;
}

/** A progression of chord symbols (spaces or `|` between them) voiced with smooth voice leading. */
export function parseChords(src: string): Chord[] {
  const syms = src.split(/[\s|]+/).filter(Boolean);
  const out: Chord[] = [];
  let prev: number[] = [60, 64, 67];
  for (const name of syms) {
    const { pcs, bassPc } = chordPcs(name);
    const opts = voicings(pcs);
    if (!opts.length) throw new Error(`no voicing for "${name}"`);
    let best = opts[0]!;
    let bestD = Infinity;
    for (const v of opts) {
      // prefer smooth motion, and gently pull back towards the middle of the range so the pads never drift away
      const d = distance(prev, v) + Math.abs((v[0]! + v[v.length - 1]!) / 2 - 63) * 0.35;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    prev = best;
    let bass = 36 + bassPc; // C2..B2
    if (bass < 40) bass += 12; // E2..D#3: low enough to be warm, high enough for small speakers
    out.push({ name, notes: best, bass, pcs });
  }
  return out;
}
