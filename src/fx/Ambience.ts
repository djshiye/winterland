/**
 * 0.9.8 [17] Ambient beds (fx/ambience/beds.ts): the sound of the place the player stands in, crossfading as they walk
 * (fx/soundscape.ts picks the bed) and slowly turning from day to night with the sky (setDarkness).
 *
 * - One bed plays at a time; on setBed the old one fades out over ~4 s while the new one fades in, so walking through
 *   a gate feels like stepping into another room.
 * - Layers are looping noise buffers (white, pink, brown; made once, seeded) through a filter, a gust gain that wanders
 *   slowly (scheduled ahead on the audio clock) and a day/night gain; hums are a few sine or soft saw partials.
 * - Events are scheduled ahead like the music's notes, each at a random interval, weighted by day/night and by the
 *   comfort Effects setting (calm 60 %, minimal 35 %: fewer little sounds for players who find them busy).
 * - Its own volume channel (the Ambience slider), the master gain above it, its own short reverb. setHush(on) halves it
 *   during the ending's hush (core/quiet.ts).
 * - AudioFX starts and stops it with the sound (not with the music switch). Never throws.
 */
import { BEDS, type BedDef, type BedId, type EventDef, type HumLayer, type LayerDef, type NoiseLayer } from './ambience/beds';
import { playAmbient, type SoundKit } from './ambience/sounds';
import { rng } from './music/instruments';
import { makeReverb } from './music/reverb';
import { clampVolume, volumeGain } from './volume';

const LOOKAHEAD = 1.2;
const TICK_MS = 200;
/** Ambience bus level at full volume (before the master gain). */
export const AMB_LEVEL = 0.9;
const XFADE = 4;
const HUSH = 0.5;

/** Resting level of the ambience bus: AMB_LEVEL x the slider's perceptual curve x the hush. Pure (tested). */
export const ambienceLevel = (vol: number, hushed: boolean): number => AMB_LEVEL * volumeGain(vol) * (hushed ? HUSH : 1);

/** Day / night weight of a layer or event at this darkness (0 day .. 1 night). Pure (tested). */
export const dayNightWeight = (w: { day?: number; night?: number }, darkness: number): number => {
  const d = Math.max(0, Math.min(1, darkness));
  return (w.day ?? 1) * (1 - d) + (w.night ?? 1) * d;
};

const isHum = (l: LayerDef): l is HumLayer => 'hum' in l;

interface LiveLayer {
  def: LayerDef;
  gust: GainNode;
  dn: GainNode;
  filter: BiquadFilterNode | null;
  sources: AudioScheduledSourceNode[];
  nextGust: number;
}

class Bed {
  readonly out: GainNode;
  private readonly events: GainNode;
  private readonly layers: LiveLayer[] = [];
  private readonly nextEvent: number[];
  private stopAt = Infinity;
  private disposed = false;
  private readonly trimNode: GainNode;

  constructor(
    private readonly kit: SoundKit,
    private readonly noises: Record<NoiseLayer['noise'], AudioBuffer>,
    readonly id: BedId,
    private readonly def: BedDef,
    dest: AudioNode,
    private readonly verb: AudioNode,
    start: number,
    darkness: number,
  ) {
    const ac = kit.ac;
    this.out = ac.createGain();
    this.out.gain.value = 0;
    const trim = ac.createGain();
    trim.gain.value = def.trim;
    this.out.connect(trim);
    trim.connect(dest);
    this.trimNode = trim;
    this.events = ac.createGain();
    this.events.connect(this.out);
    for (const l of def.layers) this.layers.push(this.layer(l, start, darkness));
    // first events come a little after arriving, never all at once
    this.nextEvent = def.events.map((e) => start + 1.5 + kit.rand() * e.every[1] * 0.6);
  }

  private layer(def: LayerDef, t: number, darkness: number): LiveLayer {
    const ac = this.kit.ac;
    const gust = ac.createGain();
    gust.gain.value = def.gain;
    const dn = ac.createGain();
    dn.gain.value = dayNightWeight(def, darkness);
    gust.connect(dn);
    let tail: AudioNode = dn;
    const pan = (def as NoiseLayer).pan;
    if (pan && typeof ac.createStereoPanner === 'function') {
      const p = ac.createStereoPanner();
      p.pan.value = pan;
      dn.connect(p);
      tail = p;
    }
    tail.connect(this.out);
    const sources: AudioScheduledSourceNode[] = [];
    let filter: BiquadFilterNode | null = null;
    if (isHum(def)) {
      let into: AudioNode = gust;
      if (def.lowpass) {
        filter = ac.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = def.lowpass;
        filter.connect(gust);
        into = filter;
      }
      def.hum.forEach((f, i) => {
        const copies = def.beat ? [-def.beat / 2, def.beat / 2] : [0];
        for (const c of copies) {
          const o = ac.createOscillator();
          o.type = def.wave ?? 'sine';
          o.frequency.value = f;
          o.detune.value = c;
          const g = ac.createGain();
          // upper partials softer
          g.gain.value = 1 / (1 + i * 0.8) / copies.length;
          o.connect(g);
          g.connect(into);
          o.start(t);
          sources.push(o);
        }
      });
    } else {
      const src = ac.createBufferSource();
      src.buffer = this.noises[def.noise];
      src.loop = true;
      filter = ac.createBiquadFilter();
      filter.type = def.filter;
      filter.frequency.value = def.freq;
      filter.Q.value = def.q ?? 0.7;
      src.connect(filter);
      filter.connect(gust);
      src.start(t, this.kit.rand() * 4);
      sources.push(src);
    }
    if (def.trem) {
      const lfo = ac.createOscillator();
      lfo.frequency.value = def.trem.rate;
      const depth = ac.createGain();
      depth.gain.value = def.gain * def.trem.depth * 0.5;
      lfo.connect(depth);
      depth.connect(gust.gain);
      gust.gain.value = def.gain * (1 - def.trem.depth * 0.5);
      lfo.start(t);
      sources.push(lfo);
    }
    return { def, gust, dn, filter, sources, nextGust: t + this.kit.rand() * 2 };
  }

  fadeIn(t: number, dur: number): void {
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1, t + dur);
  }

  fadeOut(t: number, dur: number): void {
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0, t, dur / 4);
    this.stopAt = t + dur;
  }

  get done(): boolean {
    return this.disposed;
  }

  /** The stop time once faded out (Infinity while playing). */
  get endsAt(): number {
    return this.stopAt;
  }

  setDarkness(d: number, t: number): void {
    for (const l of this.layers) l.dn.gain.setTargetAtTime(dayNightWeight(l.def, d), t, 2.5);
  }

  /** Plan gusts and events up to audio time `horizon`. */
  scheduleUntil(horizon: number, darkness: number, rate: number): void {
    if (this.disposed) return;
    const r = this.kit.rand;
    for (const l of this.layers) {
      const def = l.def;
      if (isHum(def) || !def.gust || def.trem) continue;
      const gust = def.gust;
      while (l.nextGust < horizon) {
        const t = l.nextGust;
        const span = gust.every[0] + r() * (gust.every[1] - gust.every[0]);
        l.gust.gain.setTargetAtTime(def.gain * (1 - gust.depth + gust.depth * r()), t, span / 3);
        if (gust.sweep && l.filter) l.filter.frequency.setTargetAtTime(def.freq * (1 + gust.sweep * (r() - 0.5)), t, span / 3);
        l.nextGust = t + span;
      }
    }
    this.def.events.forEach((e: EventDef, i) => {
      while (this.nextEvent[i]! < horizon) {
        const t = this.nextEvent[i]!;
        const w = dayNightWeight(e, darkness) * rate;
        if (t < this.stopAt && r() < Math.min(1, w)) this.event(e, t);
        // rarer events wait longer instead of only being skipped, so a calm setting thins them evenly
        this.nextEvent[i] = t + (e.every[0] + r() * (e.every[1] - e.every[0])) / Math.max(0.35, Math.min(1, rate));
      }
    });
  }

  private event(e: EventDef, t: number): void {
    const ac = this.kit.ac;
    const g = ac.createGain();
    g.gain.value = 1;
    let tail: AudioNode = g;
    if (typeof ac.createStereoPanner === 'function') {
      const p = ac.createStereoPanner();
      p.pan.value = (this.kit.rand() * 2 - 1) * (e.spread ?? 0.7);
      g.connect(p);
      tail = p;
    }
    tail.connect(this.events);
    const send = ac.createGain();
    send.gain.value = e.verb ?? 0.45;
    tail.connect(send);
    send.connect(this.verb);
    playAmbient(this.kit, e.sound, t, g, e.gain * (0.75 + this.kit.rand() * 0.35));
    // the event bus nodes live a few seconds (the longest sound is ~4 s)
    const end = ac.createConstantSource?.();
    if (end) {
      const sink = ac.createGain();
      sink.gain.value = 0;
      end.connect(sink);
      sink.connect(this.events);
      end.start(t);
      end.stop(t + 6);
      end.onended = () => {
        for (const n of [g, tail, send, sink]) {
          try {
            n.disconnect();
          } catch {
            /* already */
          }
        }
      };
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const l of this.layers) {
      for (const s of l.sources) {
        try {
          s.stop();
        } catch {
          /* not started / already */
        }
      }
    }
    for (const n of [this.out, this.trimNode]) {
      try {
        n.disconnect();
      } catch {
        /* already */
      }
    }
  }
}

export class Ambience {
  private readonly level: GainNode;
  private readonly fade: GainNode;
  private readonly mix: GainNode;
  private readonly verbIn: AudioNode;
  private readonly kit: SoundKit;
  private readonly noises: Record<NoiseLayer['noise'], AudioBuffer>;
  private bed: Bed | null = null;
  private readonly fading: Bed[] = [];
  private bedId: BedId = 'home';
  private darkness = 0;
  private rate = 1;
  private vol = 1;
  private hushed = false;
  private running = false;
  private timer = 0;

  constructor(
    private readonly ac: BaseAudioContext,
    dest: AudioNode,
    seed = (Math.random() * 1e9) | 0,
  ) {
    this.fade = ac.createGain();
    this.fade.gain.value = 0;
    this.fade.connect(dest);
    this.level = ac.createGain();
    this.level.gain.value = ambienceLevel(this.vol, this.hushed);
    this.level.connect(this.fade);
    this.mix = ac.createGain();
    this.mix.connect(this.level);
    const verb = makeReverb(ac, 2.2, 1.9);
    if (verb) {
      const ret = ac.createGain();
      ret.gain.value = 0.6;
      verb.connect(ret);
      ret.connect(this.mix);
      this.verbIn = verb;
    } else {
      this.verbIn = ac.createGain();
    }
    const noise = noiseBuffers(ac, seed);
    this.noises = noise;
    this.kit = { ac, noise: noise.white, brown: noise.brown, rand: rng(seed ^ 0x5eed) };
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentBed(): BedId {
    return this.bedId;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const now = this.ac.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setTargetAtTime(1, now, 0.8);
    if (!this.bed) this.bed = this.makeBed(this.bedId, now + 0.05, 2.5);
    if (typeof window !== 'undefined') this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** Fade out and drop the beds (they rebuild on start: no noise sources run while silent). */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (typeof window !== 'undefined') window.clearInterval(this.timer);
    const now = this.ac.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setTargetAtTime(0, now, 0.1);
    const old = [this.bed, ...this.fading];
    this.bed = null;
    this.fading.length = 0;
    setTimeoutSafe(() => old.forEach((b) => b?.dispose()), 800);
  }

  setVolume(v: number): void {
    this.vol = clampVolume(v);
    this.level.gain.setTargetAtTime(ambienceLevel(this.vol, this.hushed), this.ac.currentTime, 0.05);
  }

  setHush(on: boolean): void {
    if (on === this.hushed) return;
    this.hushed = on;
    this.level.gain.setTargetAtTime(ambienceLevel(this.vol, this.hushed), this.ac.currentTime, 1.2);
  }

  /** 0..1 share of the little events (comfort Effects: full 1, calm 0.6, minimal 0.35). */
  setEventRate(r: number): void {
    this.rate = Math.max(0, Math.min(1, r));
  }

  /** 0 day .. 1 night, from the sky; layers follow over a few seconds. */
  setDarkness(d: number): void {
    const v = Math.max(0, Math.min(1, d));
    if (Math.abs(v - this.darkness) < 0.02) return;
    this.darkness = v;
    this.bed?.setDarkness(v, this.ac.currentTime);
  }

  /** Crossfade to another place's bed. */
  setBed(id: BedId): void {
    if (id === this.bedId || !BEDS[id]) return;
    this.bedId = id;
    if (!this.running) return;
    const now = this.ac.currentTime;
    if (this.bed) {
      this.bed.fadeOut(now, XFADE);
      this.fading.push(this.bed);
    }
    this.bed = this.makeBed(id, now + 0.05, XFADE);
  }

  /** Plan everything up to audio time t (the timer does this; offline renders call it directly). */
  scheduleUntil(t: number): void {
    if (!this.bed) this.bed = this.makeBed(this.bedId, Math.max(0.02, this.ac.currentTime), 1.5);
    this.bed.scheduleUntil(t, this.darkness, this.rate);
    for (const b of this.fading) b.scheduleUntil(t, this.darkness, this.rate);
  }

  private makeBed(id: BedId, t: number, fadeIn: number): Bed {
    const b = new Bed(this.kit, this.noises, id, BEDS[id], this.mix, this.verbIn, t, this.darkness);
    b.fadeIn(t, fadeIn);
    return b;
  }

  private tick(): void {
    try {
      const ac = this.ac;
      if (ac.state !== 'running') return;
      const now = ac.currentTime;
      this.scheduleUntil(now + LOOKAHEAD);
      for (let i = this.fading.length - 1; i >= 0; i--) {
        const b = this.fading[i]!;
        if (now > b.endsAt + 0.5) {
          b.dispose();
          this.fading.splice(i, 1);
        }
      }
    } catch {
      /* ambience must never break the game */
    }
  }
}

function setTimeoutSafe(fn: () => void, ms: number): void {
  try {
    setTimeout(fn, ms);
  } catch {
    fn();
  }
}

/** Six seconds each of white, pink (Paul Kellet's filter) and brown noise, seeded, with seamless loop points. */
function noiseBuffers(ac: BaseAudioContext, seed: number): Record<NoiseLayer['noise'], AudioBuffer> {
  const sr = ac.sampleRate;
  const n = Math.round(sr * 6);
  const f = Math.round(sr * 0.05);
  const r = rng(seed);
  // f extra samples up front: the loop's last f samples crossfade into them, so the wrap back to 0 is continuous
  const g = { white: new Float32Array(n + f), pink: new Float32Array(n + f), brown: new Float32Array(n + f) };
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < n + f; i++) {
    const x = r() * 2 - 1;
    g.white[i] = x * 0.5;
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    g.pink[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    br = (br + 0.02 * x) / 1.02;
    g.brown[i] = br * 3.5;
  }
  const out = {} as Record<NoiseLayer['noise'], AudioBuffer>;
  for (const k of ['white', 'pink', 'brown'] as const) {
    const src = g[k];
    const buf = ac.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = src[f + i]!;
    for (let i = 0; i < f; i++) {
      const w = i / f;
      d[n - f + i] = src[n + i]! * (1 - w) + src[i]! * w;
    }
    out[k] = buf;
  }
  return out;
}
