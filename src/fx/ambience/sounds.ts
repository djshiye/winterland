/**
 * 0.9.8 [17] The little ambient events that live in each region's bed (fx/ambience/beds.ts): birds, a far-off anvil,
 * steam puffs, a pumpjack's creak, server beeps, bubbles, fusion glitter... Each is a handful of WebAudio nodes built
 * at an exact audio time, soft-edged (no attack under 3 ms) and quiet: they sit far back in the world, never in your ear.
 * `play(sound, ...)` returns nothing and never throws; every node disconnects itself when it ends.
 */

export type AmbientSound =
  | 'chickadee'
  | 'tweet'
  | 'owl'
  | 'woodpecker'
  | 'crackle'
  | 'chink'
  | 'tink'
  | 'bellows'
  | 'cart'
  | 'chuffs'
  | 'hiss'
  | 'clank'
  | 'trainFar'
  | 'thump'
  | 'zap'
  | 'wireSing'
  | 'ting'
  | 'creak'
  | 'beep'
  | 'keys'
  | 'bubble'
  | 'drip'
  | 'glitter'
  | 'swell'
  | 'sleigh'
  | 'shopBell'
  | 'crunch'
  | 'gust';

export const AMBIENT_SOUNDS: readonly AmbientSound[] = [
  'chickadee', 'tweet', 'owl', 'woodpecker', 'crackle', 'chink', 'tink', 'bellows', 'cart', 'chuffs', 'hiss', 'clank',
  'trainFar', 'thump', 'zap', 'wireSing', 'ting', 'creak', 'beep', 'keys', 'bubble', 'drip', 'glitter', 'swell',
  'sleigh', 'shopBell', 'crunch', 'gust',
];

/** C-lydian-ish high notes for the AI era's glitter (matches the Golden Halo theme). */
const GLITTER = [2093, 2349.3, 2637, 2960, 3136, 3520, 3951];
/** Pentatonic for the computer beeps (A major, matches Silicon Snow). */
const BEEPS = [1318.5, 1480, 1661.2, 1760, 2217.5];

export interface SoundKit {
  ac: BaseAudioContext;
  /** White noise, a few seconds, looping. */
  noise: AudioBuffer;
  /** Brown noise (deep rumble). */
  brown: AudioBuffer;
  rand: () => number;
}

export function playAmbient(kit: SoundKit, sound: AmbientSound, t: number, out: AudioNode, vol: number): void {
  try {
    new Voice(kit, t, out, vol).play(sound);
  } catch {
    /* ambience must never break the game */
  }
}

class Voice {
  private readonly ac: BaseAudioContext;
  private readonly r: () => number;

  constructor(
    private readonly kit: SoundKit,
    private readonly t: number,
    private out: AudioNode,
    private readonly v: number,
  ) {
    this.ac = kit.ac;
    this.r = kit.rand;
  }

  /** A random number in [a, b). */
  private rr(a: number, b: number): number {
    return a + (b - a) * this.r();
  }

  /** An oscillator with a glide and an attack / decay envelope. */
  private tone(at: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, att = 0.01, lp = 0): void {
    const ac = this.ac;
    const t = this.t + at;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol * this.v, t + Math.max(0.003, att));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    let tail: AudioNode = g;
    if (lp) {
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      g.connect(f);
      tail = f;
    }
    tail.connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.release(o, g, tail);
  }

  /**
   * Filtered noise with an envelope: rises over `att`, holds for `hold`, then decays over the rest of `dur`.
   * The filter sweeps f0 -> f1.
   */
  private noise(
    at: number, ftype: BiquadFilterType, f0: number, f1: number, q: number, dur: number, vol: number, att = 0.004,
    hold = 0, brown = false,
  ): AudioBufferSourceNode {
    const ac = this.ac;
    const t = this.t + at;
    const src = ac.createBufferSource();
    src.buffer = brown ? this.kit.brown : this.kit.noise;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = ftype;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol * this.v, t + Math.max(0.003, att));
    if (hold > 0) g.gain.setValueAtTime(vol * this.v, t + att + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.out);
    src.start(t, this.r() * 2);
    src.stop(t + dur + 0.02);
    this.release(src, f, g);
    return src;
  }

  /** Inharmonic struck partials (bells, anvils, glass): [ratio, amp, decay s]. */
  private struck(at: number, f: number, partials: readonly (readonly [number, number, number])[], vol: number): void {
    for (const [ratio, amp, dec] of partials) this.tone(at, 'sine', f * ratio, f * ratio, dec, vol * amp, 0.003);
  }

  private release(src: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    src.onended = () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already */
        }
      }
    };
  }

  play(sound: AmbientSound): void {
    const rr = (a: number, b: number) => this.rr(a, b);
    switch (sound) {
      case 'chickadee': {
        // "fee-bee": a high whistle, then one a tone lower
        const p = rr(0.96, 1.04);
        this.tone(0, 'sine', 3950 * p, 3880 * p, 0.3, 1, 0.04);
        this.tone(0.38, 'sine', 3480 * p, 3420 * p, 0.34, 0.85, 0.04);
        break;
      }
      case 'tweet': {
        const n = 2 + Math.floor(this.r() * 3);
        const up = this.r() < 0.5;
        const base = rr(3800, 5000);
        for (let i = 0; i < n; i++) {
          const f = base * rr(0.95, 1.08);
          this.tone(i * rr(0.08, 0.12), 'sine', up ? f : f * 1.35, up ? f * 1.35 : f, 0.07, rr(0.6, 1), 0.008);
        }
        break;
      }
      case 'owl': {
        // a tawny "hoo... hoo-hoo" far across the snow
        const p = rr(0.95, 1.05);
        this.tone(0, 'sine', 405 * p, 372 * p, 0.42, 1, 0.09, 1200);
        this.tone(0.78, 'sine', 410 * p, 385 * p, 0.2, 0.7, 0.05, 1200);
        this.tone(1.05, 'sine', 400 * p, 352 * p, 0.55, 0.9, 0.07, 1200);
        this.noise(0, 'bandpass', 600, 500, 1, 0.4, 0.08, 0.08);
        break;
      }
      case 'woodpecker': {
        const n = 9 + Math.floor(this.r() * 5);
        for (let i = 0; i < n; i++) {
          const a = 1 - (i / n) * 0.6;
          this.tone(i * 0.058, 'sine', 1250, 850, 0.035, 0.6 * a, 0.003);
          this.noise(i * 0.058, 'bandpass', 1600, 1300, 2, 0.025, 0.35 * a, 0.003);
        }
        break;
      }
      case 'crackle': {
        const n = 4 + Math.floor(this.r() * 6);
        for (let i = 0; i < n; i++) this.noise(rr(0, 0.9), 'bandpass', rr(2200, 6000), rr(1500, 4000), 1.4, rr(0.012, 0.028), rr(0.35, 1), 0.003);
        break;
      }
      case 'chink':
        // a mason's chisel on fieldstone, far off
        this.tone(0, 'triangle', 2450 * rr(0.95, 1.05), 2300, 0.09, 0.8, 0.003, 4000);
        this.tone(0, 'sine', 3700 * rr(0.95, 1.05), 3650, 0.06, 0.3, 0.003);
        this.noise(0, 'bandpass', 3000, 2000, 1.5, 0.03, 0.3, 0.003);
        break;
      case 'tink': {
        // the smith's double tap on the anvil: tap-ting, the second softer
        const f = 1650 * rr(0.94, 1.06);
        const anvil = [[1, 1, 0.7], [2.71, 0.45, 0.3], [5.2, 0.16, 0.12]] as const;
        this.struck(0, f, anvil, 0.8);
        this.struck(0.32, f, anvil, 0.45);
        break;
      }
      case 'bellows':
        // the forge breathing in and out
        this.noise(0, 'bandpass', 320, 420, 0.7, 2.4, 1, 0.9, 0.3, true);
        break;
      case 'cart': {
        // an ore cart rumbling past on its rails, left to right
        const ac = this.ac;
        const pan = typeof ac.createStereoPanner === 'function' ? ac.createStereoPanner() : null;
        if (pan) {
          pan.pan.setValueAtTime(-0.7, this.t);
          pan.pan.linearRampToValueAtTime(0.7, this.t + 4);
          pan.connect(this.out);
          this.out = pan;
        }
        for (let i = 0; i < 10; i++) this.noise(0.6 + i * rr(0.25, 0.35), 'bandpass', 900, 800, 2, 0.04, 0.25, 0.004);
        // the rumble is the longest voice, so the panner goes with it
        const rumble = this.noise(0, 'lowpass', 240, 300, 0.7, 4.2, 1, 1.5, 0.6, true);
        if (pan) {
          const done = rumble.onended;
          rumble.onended = (e) => {
            done?.call(rumble, e);
            try {
              pan.disconnect();
            } catch {
              /* already */
            }
          };
        }
        break;
      }
      case 'chuffs': {
        // a little engine pulling away: puffs slowing and fading
        const n = 6 + Math.floor(this.r() * 4);
        let at = 0;
        for (let i = 0; i < n; i++) {
          const a = 1 - (i / n) * 0.8;
          this.noise(at, 'bandpass', 1300, 700, 0.8, 0.26, a, 0.02);
          at += 0.4 + i * 0.03;
        }
        break;
      }
      case 'hiss':
        // a valve letting off a little steam
        this.noise(0, 'highpass', 2600, 3400, 0.6, 1.6, 1, 0.25, 0.6);
        break;
      case 'clank': {
        const f = 420 * rr(0.9, 1.1);
        this.struck(0, f, [[1, 1, 0.45], [2.4, 0.5, 0.22], [4.1, 0.25, 0.1]], 0.6);
        this.tone(0, 'triangle', 210, 160, 0.09, 0.5, 0.003, 800);
        break;
      }
      case 'trainFar':
        // a steam whistle miles away (minor third, lowpassed, mostly room)
        for (const m of [1, 1.26]) this.tone(0, 'sawtooth', 311 * m, 305 * m, 1.8, 0.35, 0.25, 700);
        break;
      case 'thump':
        // a press stamping pellets, two halls away
        this.tone(0, 'sine', 72, 44, 0.4, 1, 0.006);
        this.noise(0, 'lowpass', 420, 200, 0.7, 0.14, 0.4, 0.004);
        break;
      case 'zap': {
        // a tesla coil's soft crackle
        const n = 4 + Math.floor(this.r() * 6);
        for (let i = 0; i < n; i++) this.noise(rr(0, 0.28), 'highpass', rr(4000, 6500), 5000, 0.7, 0.012, rr(0.4, 1), 0.003);
        this.tone(0.02, 'sine', 1800, 2500, 0.14, 0.15, 0.01);
        break;
      }
      case 'wireSing': {
        // wind singing in the copper lines
        const ac = this.ac;
        const t = this.t;
        const o = ac.createOscillator();
        o.type = 'sine';
        o.frequency.value = rr(1050, 1500);
        const lfo = ac.createOscillator();
        lfo.frequency.value = rr(4, 6);
        const lg = ac.createGain();
        lg.gain.value = 9;
        lfo.connect(lg);
        lg.connect(o.detune);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(this.v, t + 1.3);
        g.gain.linearRampToValueAtTime(0.0001, t + 3.2);
        o.connect(g);
        g.connect(this.out);
        o.start(t);
        lfo.start(t);
        o.stop(t + 3.3);
        lfo.stop(t + 3.3);
        this.release(o, g, lg);
        break;
      }
      case 'ting':
        // a glass insulator touched by a wire
        this.struck(0, 2900 * rr(0.95, 1.05), [[1, 1, 0.8], [2.76, 0.3, 0.3]], 0.7);
        break;
      case 'creak':
        // a pumpjack's nod: the walking beam creaks up, the counterweight swishes down
        this.tone(0, 'sawtooth', 96, 72, 1.1, 0.5, 0.35, 480);
        this.noise(0.1, 'bandpass', 520, 680, 3, 0.9, 0.25, 0.3);
        this.noise(1.9, 'bandpass', 300, 600, 0.8, 1.2, 0.5, 0.4);
        break;
      case 'beep': {
        const n = 1 + Math.floor(this.r() * 3);
        for (let i = 0; i < n; i++) {
          const f = BEEPS[Math.floor(this.r() * BEEPS.length)]!;
          this.tone(i * 0.11, 'sine', f, f, 0.09, 0.8, 0.006);
        }
        break;
      }
      case 'keys': {
        const n = 6 + Math.floor(this.r() * 9);
        let at = 0;
        for (let i = 0; i < n; i++) {
          this.noise(at, 'bandpass', 3400, 3000, 2.2, 0.014, rr(0.5, 1), 0.003);
          at += rr(0.07, 0.15);
        }
        break;
      }
      case 'bubble': {
        const n = 2 + Math.floor(this.r() * 4);
        let at = 0;
        for (let i = 0; i < n; i++) {
          const f = rr(360, 620);
          this.tone(at, 'sine', f, f * rr(1.8, 2.4), rr(0.05, 0.09), rr(0.5, 1), 0.005);
          at += rr(0.07, 0.22);
        }
        break;
      }
      case 'drip':
        this.tone(0, 'sine', 1350 * rr(0.9, 1.1), 2300, 0.05, 1, 0.003);
        break;
      case 'glitter': {
        const n = 1 + Math.floor(this.r() * 3);
        for (let i = 0; i < n; i++) {
          const f = GLITTER[Math.floor(this.r() * GLITTER.length)]!;
          this.tone(i * rr(0.12, 0.25), 'sine', f, f, 1.3, rr(0.6, 1), 0.012);
        }
        break;
      }
      case 'swell':
        // the reactor's halo breathing: a soft chord that swells and fades
        for (const f of [523.25, 659.25, 783.99]) this.tone(0, 'sine', f * 2, f * 2, 4, 0.4, 1.8);
        break;
      case 'sleigh': {
        // sleigh bells passing down a street
        const n = 9 + Math.floor(this.r() * 7);
        for (let i = 0; i < n; i++) {
          const at = rr(0, 1.1);
          const f = rr(4800, 5800);
          this.struck(at, f, [[1, 0.8, 0.12], [1.48, 0.4, 0.08]], rr(0.4, 0.9));
        }
        break;
      }
      case 'shopBell':
        // a shop door's bell
        this.struck(0, 2093, [[1, 1, 0.8], [2.76, 0.25, 0.25]], 0.8);
        this.struck(0.16, 2093, [[1, 0.6, 0.6], [2.76, 0.15, 0.2]], 0.6);
        break;
      case 'crunch': {
        // someone walking past in the snow
        const n = 2 + Math.floor(this.r() * 3);
        for (let i = 0; i < n; i++) this.noise(i * rr(0.42, 0.5), 'bandpass', 1900, 1300, 0.8, 0.08, rr(0.6, 1), 0.006);
        break;
      }
      case 'gust':
        // a whistling gust over the open snow
        this.noise(0, 'bandpass', 800, 1300, 3, 2.8, 1, 1.1, 0.4);
        break;
    }
  }
}
