/**
 * 0.9.8 [17] Plays one era theme (fx/music/themes.ts) on a WebAudio clock.
 *
 * - `scheduleUntil(t)` queues every note due before t at exact audio times; the real-time Music director calls it from
 *   a 100 ms timer with a 0.6 s lookahead, and the preview renderer calls it once on an OfflineAudioContext.
 * - Each part (lead, counter, bass, pad, arp, stab, perc) has its own bus: gain, stereo position and a reverb send.
 *   Everything meets in `tone` (a lowpass that closes when the theme fades away, like walking out of a room) and `out`
 *   (the fade).
 * - The tune is lightly re-played every pass (neighbour steps, dropped and passing notes, tiny timing and velocity
 *   drift), except the intro, so it is always recognisable but never canned.
 * - Night (setNight): no percussion or stabs, the arpeggio plays only on the beat, the melody thins (Theme.night.keep),
 *   a softer lead where the theme has one, and the pad darkens.
 */
import { SampleBank } from './bank';
import { INSTRUMENTS, type InstrumentId } from './instruments';
import { HOLD, type Chord } from './notation';
import { heldEighths, sixteenth, stepsPerBar, type Layer, type PartMix, type Section, type Theme } from './themes';

type Part = 'lead' | 'counter' | 'bass' | 'pad' | 'arp' | 'stab' | 'perc';
const PARTS: readonly Part[] = ['lead', 'counter', 'bass', 'pad', 'arp', 'stab', 'perc'];

/** Most notes ringing at once (a safety net; a busy bar uses about 25). */
const MAX_SOURCES = 64;
/** Pad oscillator gain per voice, by style (balanced against each other). */
const PAD_GAIN = { warm: 0.022, strings: 0.0095, choir: 0.011, glass: 0.022, reed: 0.0075 } as const;
const PAD_ATTACK = { warm: 0.7, strings: 1.0, choir: 1.3, glass: 1.1, reed: 0.35 } as const;
const PAD_WAVE = { warm: 'triangle', strings: 'sawtooth', choir: 'sawtooth', glass: 'sine', reed: 'square' } as const;

export class ThemePlayer {
  readonly out: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly trim: GainNode;
  private readonly bus: Record<Part, GainNode>;
  private readonly padFilter: BiquadFilterNode;
  private next = 0;
  private step = 0;
  private bar = 0;
  private formIdx = 0;
  private tune: number[][] = [];
  private counterTune: number[][] | undefined;
  private night = false;
  private sources = 0;
  private stopped = false;
  private lastLead = 0;
  private rand: () => number;

  constructor(
    private readonly ac: BaseAudioContext,
    private readonly bank: SampleBank,
    readonly theme: Theme,
    dest: AudioNode,
    verb: AudioNode,
    rand: () => number = Math.random,
  ) {
    this.rand = rand;
    this.out = ac.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.tone = ac.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 16000;
    this.tone.Q.value = 0.5;
    // loudness trim: every theme (and its night mix) sits at the same level (scripts/music-preview.mjs measures them)
    this.trim = ac.createGain();
    this.trim.gain.value = theme.trim;
    this.tone.connect(this.trim);
    this.trim.connect(this.out);

    this.padFilter = ac.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = theme.pad.cutoff;
    this.padFilter.Q.value = 0.3;

    const bus = {} as Record<Part, GainNode>;
    for (const p of PARTS) {
      const m: PartMix = theme.mix[p];
      const g = ac.createGain();
      g.gain.value = m.gain * (p === 'pad' ? theme.pad.level : 1);
      let tail: AudioNode = g;
      if (typeof ac.createStereoPanner === 'function' && m.pan) {
        const pan = ac.createStereoPanner();
        pan.pan.value = m.pan;
        g.connect(pan);
        tail = pan;
      }
      tail.connect(this.tone);
      const wet = ac.createGain();
      wet.gain.value = m.verb;
      tail.connect(wet);
      wet.connect(this.wetIn(verb));
      bus[p] = g;
    }
    this.bus = bus;
    // pad chain: voices -> padFilter (-> formants for the choir) -> pad bus
    if (theme.pad.style === 'choir') {
      // two vowel formants ("ah"-"oh"), in parallel, plus a little of the plain pad
      for (const [f, q, gain] of [[700, 4, 1], [1150, 5, 0.6], [0, 0, 0.25]] as const) {
        const g = ac.createGain();
        g.gain.value = gain;
        if (f) {
          const bp = ac.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = f;
          bp.Q.value = q;
          this.padFilter.connect(bp);
          bp.connect(g);
        } else {
          this.padFilter.connect(g);
        }
        g.connect(bus.pad);
      }
      bus.pad.gain.value *= 2.2;
    } else {
      this.padFilter.connect(bus.pad);
    }
  }

  /** The reverb input, through one gain node owned by this player so dispose() can cut it. */
  private wetBus: GainNode | null = null;
  private wetIn(verb: AudioNode): GainNode {
    if (!this.wetBus) {
      // the wet signal fades with the theme: it runs through its own copy of the fade
      const g = this.ac.createGain();
      g.gain.value = 0;
      g.connect(verb);
      this.wetBus = g;
    }
    return this.wetBus;
  }

  /** Start the theme at audio time t (from its intro, or from section `form` of its arrangement). */
  begin(t: number, form = 0): void {
    this.next = t;
    this.step = 0;
    this.bar = 0;
    this.formIdx = Math.max(0, Math.min(this.theme.form.length - 1, form));
    this.prepareSection();
  }

  /** After a pause: carry on from the next bar line at audio time t. */
  resync(t: number): void {
    this.next = t;
    if (this.step !== 0) this.advanceBar();
    this.step = 0;
  }

  /** Fade in over `dur` seconds from t. */
  fadeIn(t: number, dur: number): void {
    for (const g of [this.out.gain, this.wetBus!.gain]) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(1, t + dur);
    }
    this.tone.frequency.cancelScheduledValues(t);
    this.tone.frequency.setTargetAtTime(16000, t, dur / 3);
  }

  /** Fade away over `dur` seconds from t (the lowpass closes as it goes), then stop queuing notes. */
  fadeOut(t: number, dur: number): void {
    for (const g of [this.out.gain, this.wetBus!.gain]) {
      g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, dur / 3.5);
    }
    this.tone.frequency.cancelScheduledValues(t);
    this.tone.frequency.setTargetAtTime(380, t, dur / 3);
    this.stopAt = t + dur;
  }

  private stopAt = Infinity;

  get finished(): boolean {
    return this.stopped;
  }

  setNight(on: boolean, t: number): void {
    this.night = on;
    const f = this.padFilter.frequency;
    f.cancelScheduledValues(t);
    f.setTargetAtTime(this.theme.pad.cutoff * (on ? this.theme.night.cutoff : 1), t, 0.9);
    this.trim.gain.setTargetAtTime(this.theme.trim * (on ? this.theme.night.trim : 1), t, 0.9);
  }

  /** Disconnect everything (call once the fade has finished and the tails have rung out). */
  dispose(): void {
    this.stopped = true;
    for (const n of [this.out, this.wetBus]) {
      try {
        n?.disconnect();
      } catch {
        /* already */
      }
    }
  }

  /** Queue every note due before audio time `horizon`. */
  scheduleUntil(horizon: number): void {
    if (this.stopped) return;
    const dt = sixteenth(this.theme);
    while (this.next < horizon) {
      if (this.next >= this.stopAt) {
        this.stopped = true;
        return;
      }
      this.schedule(this.step, this.next, dt);
      this.next += dt;
      this.step++;
      if (this.step >= stepsPerBar(this.theme)) {
        this.step = 0;
        this.advanceBar();
      }
    }
  }

  /** Audio time of the next queued sixteenth. */
  get cursor(): number {
    return this.next;
  }

  private get form(): Theme['form'][number] {
    return this.theme.form[this.formIdx]!;
  }

  private get section(): Section {
    return this.theme.sections[this.form.section];
  }

  private advanceBar(): void {
    this.bar++;
    if (this.bar >= this.section.chords.length) {
      this.bar = 0;
      this.formIdx++;
      if (this.formIdx >= this.theme.form.length) this.formIdx = this.theme.loopFrom;
      this.prepareSection();
    }
  }

  private prepareSection(): void {
    const s = this.section;
    const plain = this.formIdx === 0;
    this.tune = plain ? s.melody : this.vary(s.melody);
    this.counterTune = s.counter;
  }

  private has(layer: Layer): boolean {
    return this.form.layers.includes(layer);
  }

  private schedule(slot: number, t0: number, dt: number): void {
    const th = this.theme;
    const chord: Chord = this.section.chords[this.bar]!;
    const swing = slot % 4 === 2 ? th.swing * dt : 0;
    const t = t0 + swing;
    const night = this.night;

    if (slot === 0 && this.has('pad')) this.pad(chord, t0, dt * stepsPerBar(th));

    if (this.has('bass')) {
      const iv = th.bass.pattern[slot];
      if (iv !== null && iv !== undefined) this.note(th.bass.inst, chord.bass + iv, t, slot === 0 ? 0.85 : 0.62, 'bass', dt * 6);
    }

    if (slot % 2 === 0) {
      const e = slot / 2;
      if (this.has('melody')) {
        const n = this.tune[this.bar]?.[e] ?? 0;
        if (n > 0 && (!night || this.rand() < th.night.keep)) {
          const lead = night ? th.nightLead ?? th.lead : th.lead;
          const len = heldEighths(this.tune[this.bar]!, e) * dt * 2;
          // at night a touch softer (the swapped night lead brings its own level)
          const nightVel = night ? (th.nightLead ? th.night.lead ?? 1 : 0.85) : 1;
          const vel = (e % 4 === 0 ? 0.95 : 0.82) * (0.9 + this.rand() * 0.12) * nightVel;
          let glide = 0;
          if (lead === 'slide' && this.lastLead && Math.abs(n - this.lastLead) <= 4 && this.rand() < 0.5) glide = this.lastLead - n;
          this.note(lead, n, t + (this.rand() - 0.5) * 0.012, vel, 'lead', len, glide);
          this.lastLead = n;
        }
      }
      if (this.has('counter') && th.counter && this.counterTune && !night) {
        const n = this.counterTune[this.bar]?.[e] ?? 0;
        if (n > 0) this.note(th.counter, n, t + 0.004, 0.62, 'counter', heldEighths(this.counterTune[this.bar]!, e) * dt * 2);
      }
    }

    if (th.arp && this.has('arp')) {
      const idx = th.arp.pattern[slot] ?? -1;
      if (idx >= 0 && (!night || slot % 4 === 0)) {
        const tones = chord.notes;
        const m = tones[idx % tones.length]! + 12 * (Math.floor(idx / tones.length) + th.arp.octave);
        this.note(th.arp.inst, m, t, th.arp.vel * (slot % 4 === 0 ? 1 : 0.8) * (0.9 + this.rand() * 0.15), 'arp', dt * 2);
      }
    }

    if (th.stab && this.has('stab') && !night && th.stab.slots.includes(slot)) {
      chord.notes.forEach((m, i) => this.note(th.stab!.inst, m, t + i * 0.009, th.stab!.vel, 'stab', th.stab!.len));
    }

    if (th.perc && this.has('perc') && !night) {
      for (const [inst, pat] of Object.entries(th.perc) as [InstrumentId, string][]) {
        const c = pat[slot];
        if (c === 'x' || c === 'o') this.note(inst, 60, t, (c === 'x' ? 1 : 0.6) * (0.88 + this.rand() * 0.2), 'perc', 0);
      }
    }
  }

  /** One sampled note. `len` is the held length (held instruments) in seconds; `glide` slides in from that many semitones. */
  private note(inst: InstrumentId, midi: number, t: number, vel: number, part: Part, len: number, glide = 0): void {
    if (this.sources >= MAX_SOURCES) return;
    const ac = this.ac;
    const def = INSTRUMENTS[inst];
    const buf = this.bank.get(inst);
    const rate = SampleBank.rate(inst, midi);
    const src = ac.createBufferSource();
    src.buffer = buf;
    if (glide) {
      src.playbackRate.setValueAtTime(rate * Math.pow(2, glide / 12), t);
      src.playbackRate.linearRampToValueAtTime(rate, t + 0.11);
    } else {
      src.playbackRate.value = rate;
    }
    const g = ac.createGain();
    const level = Math.max(0, vel) * def.gain;
    g.gain.setValueAtTime(level, t);
    const playable = buf.duration / rate;
    let end = t + playable;
    if (def.held) {
      const rel = def.release ?? 0.15;
      const hold = Math.max(0.05, Math.min(len, playable - rel * 2));
      g.gain.setValueAtTime(level, t + hold);
      g.gain.setTargetAtTime(0, t + hold, rel / 3);
      end = Math.min(end, t + hold + rel * 2);
    }
    src.connect(g);
    g.connect(this.bus[part]);
    src.start(t);
    src.stop(end + 0.01);
    this.sources++;
    src.onended = () => {
      this.sources = Math.max(0, this.sources - 1);
      try {
        g.disconnect();
      } catch {
        /* already */
      }
    };
  }

  /** The bar's pad chord: two detuned oscillators per note, a slow swell, overlapping into the next bar. */
  private pad(chord: Chord, t: number, barLen: number): void {
    const ac = this.ac;
    const style = this.theme.pad.style;
    const peak = PAD_GAIN[style];
    const att = Math.min(PAD_ATTACK[style], barLen * 0.4);
    const end = t + barLen + 0.6;
    for (const m of chord.notes) {
      const f = 440 * Math.pow(2, (m - 69) / 12);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + att);
      g.gain.setValueAtTime(peak, t + barLen - 0.1);
      g.gain.linearRampToValueAtTime(0.0001, end);
      g.connect(this.padFilter);
      const oscs: OscillatorNode[] = [];
      for (const cents of [-5, 5]) {
        const o = ac.createOscillator();
        o.type = PAD_WAVE[style];
        o.frequency.value = f;
        o.detune.value = cents + (this.rand() - 0.5) * 3;
        o.connect(g);
        oscs.push(o);
      }
      if (style === 'glass') {
        // a quiet octave shimmer
        const o = ac.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * 2;
        const og = ac.createGain();
        og.gain.value = 0.25;
        o.connect(og);
        og.connect(g);
        oscs.push(o);
      }
      for (const o of oscs) {
        o.start(t);
        o.stop(end + 0.02);
      }
      oscs[0]!.onended = () => {
        try {
          g.disconnect();
        } catch {
          /* already */
        }
      };
    }
  }

  /** A fresh take on the tune: neighbour steps in the key, a few dropped notes, a few passing notes. */
  private vary(melody: number[][]): number[][] {
    const scale = this.theme.scale;
    const inKey: number[] = [];
    for (let m = 48; m <= 96; m++) if (scale.includes(m % 12)) inKey.push(m);
    const r = this.rand;
    return melody.map((bar, b) => {
      const out = bar.slice();
      let dropping = false;
      for (let i = 0; i < out.length; i++) {
        const n = out[i]!;
        if (n === HOLD) {
          if (dropping) out[i] = 0;
          continue;
        }
        dropping = false;
        if (n > 0) {
          const x = r();
          if (x < 0.07 && i > 0 && b !== melody.length - 1) {
            out[i] = 0;
            dropping = true;
          } else if (x < 0.22) {
            const k = inKey.indexOf(n);
            if (k > 0 && k < inKey.length - 1) out[i] = inKey[k + (r() < 0.5 ? -1 : 1)]!;
          }
        } else if (i % 2 === 1 && i < out.length - 1 && out[i + 1] !== HOLD && r() < 0.1) {
          // a quiet passing note into the next one
          const prev = bar[i - 1]! > 0 ? bar[i - 1]! : bar[i + 1]! > 0 ? bar[i + 1]! : 0;
          const k = inKey.indexOf(prev);
          if (k > 0 && k < inKey.length - 1) out[i] = inKey[k + (r() < 0.6 ? 1 : -1)]!;
        }
      }
      return out;
    });
  }
}
