/**
 * 0.9.8 [17] The music's instruments, synthesised in code into small sample buffers (no audio files, S8).
 *
 * Each instrument is rendered once, on first use, at one reference pitch and played at any pitch through the buffer
 * source's playback rate (a pitch an octave up plays twice as fast, which is how real plucked and struck notes behave
 * anyway). Renders are pure functions on Float32Array (seeded noise), so the tests can check them without WebAudio.
 *
 * - Struck and plucked (they ring out by themselves): bell, felt piano, music box, kalimba, marimba, celesta, vibes
 *   (with its motor tremolo), glass (FM bell), electric piano (FM tine), dulcimer, nylon guitar, harp (Karplus-Strong
 *   strings), upright and round basses, and soft percussion (shaker, brush, felt kick, woodblock, anvil tink).
 * - Held (a long sustain the player cuts with a release): wooden flute, harmonium reed, soft horn, slide guitar and a
 *   rounded chiptune square.
 * Every render starts and ends at zero (a 2 ms fade-in where needed, a 30 ms fade-out), so nothing ever clicks, and
 * is peak-normalised; INSTRUMENTS[id].gain then balances them by ear.
 */

/** Sample rate of the rendered buffers (the AudioContext resamples them). 32 kHz keeps memory small and tops warm. */
export const SAMPLE_RATE = 32000;

export type InstrumentId =
  | 'bell'
  | 'felt'
  | 'musicbox'
  | 'kalimba'
  | 'marimba'
  | 'celesta'
  | 'vibes'
  | 'glass'
  | 'epiano'
  | 'dulcimer'
  | 'guitar'
  | 'harp'
  | 'flute'
  | 'reed'
  | 'horn'
  | 'slide'
  | 'chip'
  | 'chipPluck'
  | 'bassRound'
  | 'bassUpright'
  | 'bassTri'
  | 'tuba'
  | 'shaker'
  | 'brush'
  | 'kick'
  | 'block'
  | 'tink';

export interface InstrumentDef {
  /** MIDI note the buffer is rendered at. */
  ref: number;
  /** Seconds rendered. */
  dur: number;
  /** Held instruments sustain until the note's release; the rest ring out. */
  held?: boolean;
  /** Release time (s) at the end of a held note. */
  release?: number;
  /** Mix trim (peak-normalised renders differ a lot in loudness). */
  gain: number;
  /** Percussion plays at its own pitch (no MIDI note). */
  unpitched?: boolean;
}

export const INSTRUMENTS: Record<InstrumentId, InstrumentDef> = {
  bell: { ref: 72, dur: 1.6, gain: 0.55 },
  felt: { ref: 60, dur: 3.2, gain: 0.6 },
  musicbox: { ref: 79, dur: 1.8, gain: 0.42 },
  kalimba: { ref: 67, dur: 1.9, gain: 0.55 },
  marimba: { ref: 60, dur: 1.4, gain: 0.6 },
  celesta: { ref: 72, dur: 2.0, gain: 0.45 },
  vibes: { ref: 65, dur: 3.2, gain: 0.5 },
  glass: { ref: 72, dur: 3.2, gain: 0.42 },
  epiano: { ref: 60, dur: 3.0, gain: 0.55 },
  dulcimer: { ref: 64, dur: 2.4, gain: 0.45 },
  guitar: { ref: 55, dur: 3.0, gain: 0.6 },
  harp: { ref: 60, dur: 3.0, gain: 0.5 },
  flute: { ref: 74, dur: 3.0, held: true, release: 0.18, gain: 0.32 },
  reed: { ref: 60, dur: 3.0, held: true, release: 0.12, gain: 0.26 },
  horn: { ref: 53, dur: 3.0, held: true, release: 0.25, gain: 0.34 },
  slide: { ref: 64, dur: 3.2, held: true, release: 0.3, gain: 0.34 },
  chip: { ref: 72, dur: 2.0, held: true, release: 0.08, gain: 0.2 },
  chipPluck: { ref: 72, dur: 0.6, gain: 0.22 },
  bassRound: { ref: 40, dur: 2.2, gain: 0.85 },
  bassUpright: { ref: 40, dur: 2.4, gain: 0.85 },
  bassTri: { ref: 40, dur: 0.9, gain: 0.55 },
  tuba: { ref: 41, dur: 1.4, gain: 0.7 },
  shaker: { ref: 60, dur: 0.16, gain: 0.11, unpitched: true },
  brush: { ref: 60, dur: 0.4, gain: 0.1, unpitched: true },
  kick: { ref: 60, dur: 0.45, gain: 0.5, unpitched: true },
  block: { ref: 60, dur: 0.25, gain: 0.16, unpitched: true },
  tink: { ref: 60, dur: 1.4, gain: 0.12, unpitched: true },
};

export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS) as InstrumentId[];

const TAU = Math.PI * 2;
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Small seeded RNG (mulberry32), so every render is the same on every machine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Partial: frequency ratio, amplitude, decay time constant (s). */
type Partial = readonly [number, number, number];

/** Sum of exponentially decaying sines (struck bars, tines and bells), with a soft attack of `att` seconds. */
function modal(out: Float32Array, f: number, partials: readonly Partial[], att = 0.002, detune = 0): void {
  const sr = SAMPLE_RATE;
  for (const [ratio, amp, tau] of partials) {
    const fr = f * ratio * (1 + detune);
    if (fr >= sr / 2) continue;
    const w = (TAU * fr) / sr;
    const k = Math.exp(-1 / (tau * sr));
    let env = amp;
    for (let i = 0; i < out.length; i++) {
      out[i]! += Math.sin(w * i) * env;
      env *= k;
      if (env < 1e-5) break;
    }
  }
  attack(out, att);
}

/** Linear fade-in over `s` seconds. */
function attack(out: Float32Array, s: number): void {
  const n = Math.min(out.length, Math.max(1, Math.round(s * SAMPLE_RATE)));
  for (let i = 0; i < n; i++) out[i]! *= i / n;
}

/** Fade-out over the last 30 ms, then peak-normalise to 0.9. */
function finish(out: Float32Array): Float32Array {
  const n = Math.min(out.length, Math.round(0.03 * SAMPLE_RATE));
  for (let i = 0; i < n; i++) out[out.length - 1 - i]! *= i / n;
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]!));
  if (peak > 0) {
    const g = 0.9 / peak;
    for (let i = 0; i < out.length; i++) out[i]! *= g;
  }
  return out;
}

/** One-pole lowpass in place (cutoff in Hz). */
function lowpass(out: Float32Array, hz: number): void {
  const a = 1 - Math.exp((-TAU * hz) / SAMPLE_RATE);
  let y = 0;
  for (let i = 0; i < out.length; i++) {
    y += a * (out[i]! - y);
    out[i] = y;
  }
}

/**
 * Karplus-Strong string: a noise burst (softened by `soft`, 0..1) circulating in a tuned delay line with an averaging
 * filter. `damp` 0..1 darkens it faster, `decay` is roughly the seconds to fade. Two slightly detuned strings
 * (`chorus` cents apart) give the shimmer of a doubled course.
 */
function pluck(out: Float32Array, f: number, soft: number, damp: number, decay: number, seed: number, chorus = 0): void {
  const sr = SAMPLE_RATE;
  const strings = chorus ? [-chorus / 2, chorus / 2] : [0];
  for (const cents of strings) {
    const fr = f * Math.pow(2, cents / 1200);
    // averaging filter weight (how much of the older sample is kept: higher is darker); its delay is ~s samples,
    // taken off the delay line so the string stays in tune
    const s = 0.5 + damp * 0.45;
    const D = sr / fr - s;
    const N = Math.floor(D);
    const frac = D - N;
    const size = N + 2;
    const buf = new Float32Array(size);
    const r = rng(seed + Math.round(cents * 10));
    for (let i = 0; i < size; i++) buf[i] = r() * 2 - 1;
    // soften the excitation (a thumb, not a pick)
    for (let pass = 0; pass < Math.round(soft * 6); pass++) {
      for (let i = 1; i < size; i++) buf[i] = (buf[i]! + buf[i - 1]!) * 0.5;
    }
    let mean = 0;
    for (const v of buf) mean += v;
    mean /= size;
    for (let i = 0; i < size; i++) buf[i]! -= mean;
    // loss per period so the string fades in about `decay` seconds
    const loss = Math.pow(0.001, 1 / (decay * fr));
    let w = 0;
    let prev = 0;
    for (let i = 0; i < out.length; i++) {
      const r0 = buf[(w - N + size * 2) % size]!;
      const r1 = buf[(w - N - 1 + size * 2) % size]!;
      const v = r0 + (r1 - r0) * frac;
      const y = loss * (v * (1 - s) + prev * s);
      prev = v;
      buf[w] = y;
      w = (w + 1) % size;
      out[i]! += y / strings.length;
    }
  }
  attack(out, 0.002);
}

/** Additive held tone: harmonics (ratio, amp), vibrato after `vibDelay`, attack `att`, optional breath noise. */
function held(
  out: Float32Array, f: number, harmonics: readonly (readonly [number, number])[], opts: {
    att: number; vibRate: number; vibDepth: number; vibDelay: number; breath?: number; breathHz?: number; seed: number; detune?: number;
  },
): void {
  const sr = SAMPLE_RATE;
  const r = rng(opts.seed);
  const voices = opts.detune ? [-opts.detune / 2, opts.detune / 2] : [0];
  for (const cents of voices) {
    const fr = f * Math.pow(2, cents / 1200);
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const vib = Math.min(1, Math.max(0, (t - opts.vibDelay) / 0.6)) * opts.vibDepth;
      const fi = fr * (1 + vib * Math.sin(TAU * opts.vibRate * t));
      phase += (TAU * fi) / sr;
      let v = 0;
      for (const [k, a] of harmonics) if (fr * k < sr / 2) v += Math.sin(phase * k) * a;
      out[i]! += v / voices.length;
    }
  }
  if (opts.breath) {
    // band-limited breath: lowpassed noise that is strongest in the attack and stays as a faint air
    const nb = new Float32Array(out.length);
    for (let i = 0; i < nb.length; i++) nb[i] = r() * 2 - 1;
    lowpass(nb, opts.breathHz ?? 2500);
    lowpass(nb, opts.breathHz ?? 2500);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const e = 0.35 + 0.65 * Math.exp(-t / 0.08);
      out[i]! += nb[i]! * opts.breath * e;
    }
  }
  attack(out, opts.att);
}

/** Two-operator FM: carrier at f, modulator at f * ratio, index decaying from i0 with time constant tauI. */
function fm(out: Float32Array, f: number, ratio: number, i0: number, i1: number, tauI: number, tauA: number): void {
  const sr = SAMPLE_RATE;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const idx = i1 + (i0 - i1) * Math.exp(-t / tauI);
    const mod = Math.sin(TAU * f * ratio * t) * idx;
    out[i]! += Math.sin(TAU * f * t + mod) * Math.exp(-t / tauA);
  }
}

/** Noise burst through a one-pole high and low pass, with an attack and an exponential decay. */
function noiseHit(out: Float32Array, seed: number, hp: number, lp: number, att: number, tau: number): void {
  const r = rng(seed);
  const sr = SAMPLE_RATE;
  const ah = 1 - Math.exp((-TAU * hp) / sr);
  let lo = 0;
  for (let i = 0; i < out.length; i++) {
    const x = r() * 2 - 1;
    lo += ah * (x - lo);
    out[i] = x - lo; // highpassed
  }
  lowpass(out, lp);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i]! *= Math.min(1, t / att) * Math.exp(-t / tau);
  }
}

/** Render one instrument at its reference pitch (pure; the same samples on every call). */
export function renderInstrument(id: InstrumentId): Float32Array {
  const def = INSTRUMENTS[id];
  const out = new Float32Array(Math.round(def.dur * SAMPLE_RATE));
  const f = mtof(def.ref);
  switch (id) {
    case 'bell':
      // era 1's bell-pluck (the 0.9.x tune's voice): a sine with an inharmonic glassy partial that fades fast
      modal(out, f, [[1, 1, 0.42], [2.76, 0.22, 0.07], [2, 0.08, 0.2], [5.4, 0.04, 0.03]], 0.004);
      break;
    case 'felt': {
      // felt piano: slightly stretched harmonics, the upper ones dying first, a soft hammer thump, then a warm lowpass
      const B = 0.0004;
      const parts: Partial[] = [];
      for (let k = 1; k <= 9; k++) parts.push([k * Math.sqrt(1 + B * k * k), 0.9 / Math.pow(k, 1.6), 1.6 / Math.pow(k, 0.7)]);
      modal(out, f, parts, 0.006);
      modal(out, f * 1.0015, parts.slice(0, 3).map(([r, a, t]) => [r, a * 0.4, t] as const), 0.006);
      const thump = new Float32Array(out.length);
      noiseHit(thump, 11, 80, 600, 0.002, 0.02);
      for (let i = 0; i < out.length; i++) out[i]! += thump[i]! * 0.25;
      lowpass(out, 2600);
      break;
    }
    case 'musicbox':
      // a tiny steel comb: bright fundamental, a strong second-mode ping, quick high partials
      modal(out, f, [[1, 1, 0.55], [3.0, 0.18, 0.12], [5.9, 0.08, 0.05], [2.0, 0.05, 0.25]], 0.0015);
      break;
    case 'kalimba':
      // thumb piano: round fundamental and the tine's characteristic high, fast "tick" partials
      modal(out, f, [[1, 1, 0.6], [5.95, 0.16, 0.06], [12.2, 0.05, 0.02], [2.01, 0.04, 0.2]], 0.002);
      lowpass(out, 5000);
      break;
    case 'marimba':
      // rosewood bar: fundamental, the tuned 4th partial, a thin 10th, a tiny mallet tap
      modal(out, f, [[1, 1, 0.38], [3.93, 0.25, 0.08], [9.2, 0.06, 0.02]], 0.003);
      lowpass(out, 4000);
      break;
    case 'celesta':
      modal(out, f, [[1, 1, 0.65], [2.76, 0.12, 0.14], [5.4, 0.05, 0.05], [2, 0.08, 0.4]], 0.002);
      break;
    case 'vibes': {
      // aluminium bar with the motor's tremolo (5.5 Hz, gentle) baked in
      modal(out, f, [[1, 1, 1.2], [4, 0.18, 0.15], [10, 0.04, 0.03]], 0.003);
      for (let i = 0; i < out.length; i++) out[i]! *= 1 - 0.28 * (0.5 + 0.5 * Math.sin((TAU * 5.5 * i) / SAMPLE_RATE));
      break;
    }
    case 'glass':
      // FM glass bell (era 10's halo): non-integer ratio, the brightness melting away
      fm(out, f, 3.5, 2.2, 0.15, 0.35, 1.1);
      for (let i = 0; i < out.length; i++) out[i]! += Math.sin((TAU * f * 2 * i) / SAMPLE_RATE) * 0.12 * Math.exp(-i / SAMPLE_RATE / 0.8);
      attack(out, 0.004);
      break;
    case 'epiano': {
      // tine electric piano: 1:1 FM bark that softens, plus a faint high tine ping
      fm(out, f, 1, 1.6, 0.25, 0.25, 1.4);
      const tine = new Float32Array(out.length);
      modal(tine, f, [[14, 0.05, 0.03]], 0.001);
      for (let i = 0; i < out.length; i++) out[i]! += tine[i]!;
      lowpass(out, 4200);
      attack(out, 0.003);
      break;
    }
    case 'dulcimer':
      pluck(out, f, 0.15, 0.25, 2.0, 21, 7);
      break;
    case 'guitar':
      pluck(out, f, 0.55, 0.55, 2.6, 22, 3);
      lowpass(out, 3800);
      break;
    case 'harp':
      pluck(out, f, 0.4, 0.4, 2.8, 23, 0);
      lowpass(out, 4500);
      break;
    case 'flute':
      held(out, f, [[1, 1], [2, 0.18], [3, 0.06]], { att: 0.07, vibRate: 4.8, vibDepth: 0.004, vibDelay: 0.25, breath: 0.05, breathHz: 2200, seed: 31 });
      break;
    case 'reed':
      // harmonium / squeezebox: a reedy odd-heavy stack, two reeds a few cents apart (the musette beat)
      held(out, f, [[1, 1], [2, 0.45], [3, 0.42], [4, 0.2], [5, 0.18], [6, 0.08], [7, 0.06]], { att: 0.05, vibRate: 0, vibDepth: 0, vibDelay: 0, seed: 32, detune: 9 });
      lowpass(out, 2000);
      break;
    case 'horn':
      held(out, f, [[1, 1], [2, 0.5], [3, 0.25], [4, 0.1]], { att: 0.12, vibRate: 4.2, vibDepth: 0.002, vibDelay: 0.5, seed: 33 });
      lowpass(out, 1400);
      break;
    case 'slide':
      // lap steel: a rich string tone that sustains, with a slow vibrato from the bar
      held(out, f, [[1, 1], [2, 0.5], [3, 0.3], [4, 0.16], [5, 0.08]], { att: 0.02, vibRate: 5, vibDepth: 0.005, vibDelay: 0.35, seed: 34 });
      for (let i = 0; i < out.length; i++) out[i]! *= 0.55 + 0.45 * Math.exp(-i / SAMPLE_RATE / 0.6);
      lowpass(out, 2600);
      break;
    case 'chip':
    case 'chipPluck': {
      // a rounded square (odd harmonics, gently rolled off): chiptune with the edges sanded down
      const harm: [number, number][] = [];
      for (let k = 1; k <= 9; k += 2) harm.push([k, 1 / (k * k * 0.6 + 0.4)]);
      held(out, f, harm, { att: 0.006, vibRate: id === 'chip' ? 5.5 : 0, vibDepth: 0.003, vibDelay: 0.3, seed: 35 });
      if (id === 'chipPluck') for (let i = 0; i < out.length; i++) out[i]! *= Math.exp(-i / SAMPLE_RATE / 0.12);
      lowpass(out, 3200);
      break;
    }
    case 'bassRound':
      modal(out, f, [[1, 1, 0.9], [2, 0.3, 0.3], [3, 0.08, 0.12]], 0.012);
      break;
    case 'bassUpright':
      pluck(out, f, 0.85, 0.7, 2.0, 41, 0);
      lowpass(out, 900);
      attack(out, 0.006);
      break;
    case 'bassTri': {
      // NES-ish triangle bass, softened
      const sr = SAMPLE_RATE;
      for (let i = 0; i < out.length; i++) {
        const ph = ((f * i) / sr) % 1;
        out[i] = (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph) * Math.exp(-i / sr / 0.4);
      }
      lowpass(out, 1800);
      attack(out, 0.004);
      break;
    }
    case 'tuba':
      held(out, f, [[1, 1], [2, 0.55], [3, 0.3], [4, 0.12]], { att: 0.04, vibRate: 0, vibDepth: 0, vibDelay: 0, seed: 42 });
      for (let i = 0; i < out.length; i++) out[i]! *= Math.exp(-i / SAMPLE_RATE / 0.45);
      lowpass(out, 700);
      break;
    case 'shaker':
      noiseHit(out, 51, 4500, 9000, 0.012, 0.035);
      break;
    case 'brush':
      noiseHit(out, 52, 1800, 6000, 0.03, 0.09);
      break;
    case 'kick': {
      // a felt-wrapped low drum: a sine dropping 75 -> 48 Hz, no click
      const sr = SAMPLE_RATE;
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        ph += (TAU * (48 + 27 * Math.exp(-t / 0.04))) / sr;
        out[i] = Math.sin(ph) * Math.exp(-t / 0.13);
      }
      attack(out, 0.004);
      break;
    }
    case 'block':
      modal(out, 820, [[1, 1, 0.05], [2.6, 0.3, 0.02]], 0.001);
      break;
    case 'tink':
      // a far-off anvil: three inharmonic partials, rounded off so it reads as a ting, not a clang
      modal(out, 1650, [[1, 1, 0.5], [2.71, 0.45, 0.25], [5.2, 0.18, 0.1]], 0.002);
      lowpass(out, 5000);
      break;
  }
  return finish(out);
}
