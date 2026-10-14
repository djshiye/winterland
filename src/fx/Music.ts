/**
 * [B4] Procedural background music: a cosy winter loop synthesized with WebAudio (no audio files).
 *
 * - 8 bars of 4/4 at 78 BPM in C major (C Am F G | C Em F G): soft triangle pads, a light sine bass on beats 1 and 3
 *   and a bell-pluck melody on the pentatonic scale through a small feedback echo. Every loop the melody is lightly
 *   mutated (neighbour steps, dropped notes, passing notes, timing jitter) so it never feels canned.
 * - Lookahead scheduler on the AudioContext clock: a single 100 ms timer schedules every note due in the next 0.6 s
 *   at exact audio times, so the timer's jitter never reaches the sound. Few voices (≈ 12 nodes per bar), no convolution.
 * - Everything routes through one level node (`duck`) -> `fade` -> the destination handed in by AudioFX (its master gain,
 *   so the master mute silences music too). duck() dips the level ~40 % for ~0.4 s under loud SFX.
 * - AudioFX owns the on/off decisions (unlocked, music switch, mute, tab visible) and calls start()/stop().
 */

const BPM = 78;
const BEAT = 60 / BPM;
const EIGHTH = BEAT / 2;
const BAR = BEAT * 4;
const BARS = 8;
const LOOKAHEAD = 0.6;
const TICK_MS = 100;
const LEVEL = 0.5;
const DUCK_TO = 0.6;

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Pad voicings (close, around C4) and bass roots per bar: C Am F G | C Em F G. */
const PADS: number[][] = [
  [60, 64, 67], [60, 64, 69], [60, 65, 69], [59, 62, 67],
  [60, 64, 67], [59, 64, 67], [60, 65, 69], [59, 62, 67],
];
const BASS = [48, 45, 41, 43, 48, 40, 41, 43];

/** The tune: one MIDI note per eighth (0 = rest), 8 slots per bar. */
const MELODY: number[][] = [
  [76, 0, 79, 0, 76, 0, 74, 0],
  [72, 0, 76, 0, 81, 0, 79, 0],
  [76, 0, 81, 0, 79, 0, 76, 0],
  [74, 0, 79, 0, 74, 0, 0, 79],
  [79, 0, 76, 0, 79, 0, 84, 0],
  [79, 0, 76, 0, 74, 0, 76, 0],
  [81, 0, 79, 0, 76, 0, 72, 0],
  [74, 0, 76, 0, 74, 0, 0, 0],
];

/** C major pentatonic across the melody's range, for neighbour / passing notes. */
const PENTA = [67, 69, 72, 74, 76, 79, 81, 84, 86];

export class Music {
  private readonly duck: GainNode;
  private readonly fade: GainNode;
  private readonly pad: BiquadFilterNode;
  private readonly echoIn: GainNode;
  private timer = 0;
  private running = false;
  private next = 0;
  private step = 0;
  private tune: number[][] = MELODY;

  constructor(
    private readonly ac: AudioContext,
    dest: AudioNode,
  ) {
    this.fade = ac.createGain();
    this.fade.gain.value = 0;
    this.fade.connect(dest);
    this.duck = ac.createGain();
    this.duck.gain.value = LEVEL;
    this.duck.connect(this.fade);

    this.pad = ac.createBiquadFilter();
    this.pad.type = 'lowpass';
    this.pad.frequency.value = 1300;
    this.pad.connect(this.duck);

    // melody echo: dotted eighth, 35 % feedback, darkened each repeat
    const delay = ac.createDelay(1);
    delay.delayTime.value = EIGHTH * 1.5;
    const fb = ac.createGain();
    fb.gain.value = 0.35;
    const tone = ac.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    const wet = ac.createGain();
    wet.gain.value = 0.4;
    this.echoIn = ac.createGain();
    this.echoIn.connect(delay);
    delay.connect(tone);
    tone.connect(fb);
    fb.connect(delay);
    tone.connect(wet);
    wet.connect(this.duck);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Begin (or resume at the next bar line). Safe to call repeatedly. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const now = this.ac.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setTargetAtTime(1, now, 0.6);
    this.step = Math.ceil(this.step / 8) * 8 % (BARS * 8);
    this.next = now + 0.15;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** Fade out and stop scheduling (notes already queued ring out under the fade). */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    window.clearInterval(this.timer);
    const now = this.ac.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setTargetAtTime(0, now, 0.08);
  }

  /** Dip the music under a loud SFX: ~40 % down, back up after ~0.4 s. */
  dip(): void {
    const now = this.ac.currentTime;
    const g = this.duck.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(LEVEL * DUCK_TO, now, 0.03);
    g.setTargetAtTime(LEVEL, now + 0.4, 0.25);
  }

  private tick(): void {
    try {
      const ac = this.ac;
      if (ac.state !== 'running') return;
      const now = ac.currentTime;
      if (this.next < now) {
        // fell behind (tab throttled, context was suspended): rejoin at the next bar line
        this.step = Math.ceil((this.step + 1) / 8) * 8 % (BARS * 8);
        this.next = now + 0.1;
      }
      while (this.next < now + LOOKAHEAD) {
        this.schedule(this.step, this.next);
        this.next += EIGHTH;
        this.step = (this.step + 1) % (BARS * 8);
      }
    } catch {
      /* music must never break the game */
    }
  }

  private schedule(step: number, t: number): void {
    const bar = (step / 8) | 0;
    const slot = step % 8;
    if (step === 0) this.tune = this.variation();
    if (slot === 0) this.bar(bar, t);
    if (slot === 0 || slot === 4) this.bass(BASS[bar]!, t, slot === 0 ? 0.16 : 0.1);
    const n = this.tune[bar]![slot]!;
    if (n) this.bell(n, t + (Math.random() - 0.5) * 0.012, 0.07 + Math.random() * 0.025);
  }

  /** A fresh take on the tune: neighbour steps, dropped notes, passing notes. */
  private variation(): number[][] {
    return MELODY.map((bar, b) =>
      bar.map((n, i) => {
        if (b === BARS - 1 && i >= 4) return 0; // keep the cadence breathing
        if (n) {
          const r = Math.random();
          if (r < 0.1) return 0;
          if (r < 0.28) {
            const k = PENTA.indexOf(n);
            return k < 0 ? n : PENTA[Math.max(0, Math.min(PENTA.length - 1, k + (Math.random() < 0.5 ? -1 : 1)))]!;
          }
          return n;
        }
        // rest on an off-eighth: sometimes a quiet passing note
        if (i % 2 === 1 && i < 7 && Math.random() < 0.14) {
          const prev = bar[i - 1] || bar[i + 1] || 76;
          const k = PENTA.indexOf(prev);
          return k < 0 ? 0 : PENTA[Math.max(0, Math.min(PENTA.length - 1, k + (Math.random() < 0.6 ? 1 : -1)))]!;
        }
        return 0;
      }),
    );
  }

  /** Soft pad chord for the whole bar. */
  private bar(bar: number, t: number): void {
    const ac = this.ac;
    const end = t + BAR + 0.5;
    for (const m of PADS[bar]!) {
      const osc = ac.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = mtof(m);
      osc.detune.value = (Math.random() - 0.5) * 8;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.7);
      g.gain.setValueAtTime(0.03, t + BAR - 0.1);
      g.gain.linearRampToValueAtTime(0.0001, end);
      osc.connect(g);
      g.connect(this.pad);
      osc.start(t);
      osc.stop(end + 0.02);
      this.release(osc, g);
    }
  }

  private bass(m: number, t: number, vol: number): void {
    const ac = this.ac;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = mtof(m);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + BEAT * 1.9);
    osc.connect(g);
    g.connect(this.duck);
    osc.start(t);
    osc.stop(t + BEAT * 1.9 + 0.02);
    this.release(osc, g);
  }

  /** Bell-pluck: a sine with an inharmonic overtone, quick attack, soft decay; part of it feeds the echo. */
  private bell(m: number, t: number, vol: number): void {
    const ac = this.ac;
    const f = mtof(m);
    const dur = 1.1;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.duck);
    g.connect(this.echoIn);
    const a = ac.createOscillator();
    a.type = 'sine';
    a.frequency.value = f;
    a.connect(g);
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * 2.76;
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.22, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(og);
    og.connect(g);
    a.start(t);
    a.stop(t + dur + 0.02);
    o.start(t);
    o.stop(t + 0.3);
    this.release(a, g);
    this.release(o, og);
  }

  private release(src: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    src.onended = () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    };
  }
}
