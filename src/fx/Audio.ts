/**
 * [B4 — juice & HUD] Procedural WebAudio sound effects (no audio files).
 *
 * - One AudioContext, created lazily; unlock() resumes it (called on the first user gesture).
 *   Before unlock / when muted / when WebAudio is unavailable, play() is a silent no-op — never throws.
 * - Short synthesized sounds (oscillators + noise buffers + envelopes) through a master
 *   compressor + gain (~0.5):
 *   pop (item into stack, bright bubbly blip), drop (soft wooden knock), chop (axe thunk + crack),
 *   cash (coin "ching"), pay (fast tick into a pad), unlock (rising arpeggio fanfare),
 *   build (whoosh + thump), splash, crash (heavy wooden boom), whoosh, machine (mechanical chug),
 *   sell (cheerful two-note), full (dull "nope" buzz), step (soft snow crunch), click (UI),
 *   upgrade (bright rising "level up" sweep), chime (soft bell triad: reveals, shelters), fanfare (brass-ish
 *   major arpeggio: village level-up, finale), cheer (crowd "yay" for a new hire), thunk (light wood knock: a log
 *   into a construction pad), firework (crackle + thud), timber (a pine falling: wood crack + soft thud), whistle
 *   (two-tone freight-train horn), wave 8: quest (bright rising chime + coin ping), bell (rush hour: three
 *   service-bell dings), sparkle (VIP tip: glittering high arpeggio), saw (the furniture workshop's saw-whirr: a
 *   rising blade whine with a wood bite, ending in a knock), woof (a dog sled's cheerful two-bark "wuff wuff").
 * - Pads (fx/padJuice.ts): tick (a soft wood-and-glass tick per cash bundle into a pad; the JuiceDirector walks its
 *   pitch up a pentatonic ladder), padDone (a warm, low strummed major chord with a glassy top: a pad completes),
 *   ding (a tiny two-note "ding-ding": an era-gate row turns green). These are kept quiet and soft-edged (lowpassed,
 *   no sharp attacks) so hundreds of repeats never fatigue, and each has a per-sound cap on overlapping voices
 *   (VOICE_CAP), on top of the global MAX_VOICES.
 * - combo: repeats of the same sound within ~0.35 s rise in pitch (semitone steps, capped at +12)
 *   — the classic stacking pickup feel. Rapid repeats are rate-limited per sound and the number of
 *   simultaneous voices is capped, so streams never clip.
 * - Wave 10: three volume channels (fx/volume.ts), each 0..1, persisted in 'winterland:vol:master' / ':sfx' / ':music'
 *   (default 1) and passed through the perceptual curve volumeGain (v^2). Graph: voices -> compressor -> sfxGain ->
 *   master -> destination, music -> master. master gain = MASTER_GAIN * volumeGain(master), or 0 while muted; sfxGain
 *   = volumeGain(sfx); music volume is folded into Music's resting level (Music.setVolume). setVolume before the
 *   first unlock() only stores and persists; init() applies all three.
 * - Mute state persists in localStorage ('winterland:muted'), wrapped in try/catch.
 * - Background music (fx/Music.ts) shares the AudioContext and the master gain: it starts after unlock(), runs only
 *   while the music switch is on, sound isn't muted and the tab is visible, and dips ~40 % under loud SFX. Its own
 *   on/off persists in 'winterland:music' (default on).
 */
import { Music } from './Music';
import { admitVoice } from './padJuice';
import { clampVolume, readVolume, volumeGain, writeVolume, type VolumeChannel } from './volume';

export type SfxName =
  | 'pop'
  | 'drop'
  | 'chop'
  | 'cash'
  | 'pay'
  | 'unlock'
  | 'build'
  | 'splash'
  | 'crash'
  | 'whoosh'
  | 'machine'
  | 'sell'
  | 'full'
  | 'step'
  | 'click'
  | 'upgrade'
  | 'chime'
  | 'fanfare'
  | 'cheer'
  | 'thunk'
  | 'firework'
  | 'timber'
  | 'whistle'
  | 'quest'
  | 'bell'
  | 'sparkle'
  | 'saw'
  | 'woof'
  | 'bellToll'
  | 'tick'
  | 'padDone'
  | 'ding';

export interface PlayOptions {
  /** Playback-rate / frequency multiplier (1 = normal). */
  pitch?: number;
  /** 0..1 (default 1). */
  volume?: number;
  /** Rising pitch for rapid repeats of the same sound. */
  combo?: boolean;
}

const STORAGE_KEY = 'winterland:muted';
const MUSIC_KEY = 'winterland:music';
/** SFX loud enough to dip the music under them. */
const DUCKS = new Set<SfxName>(['fanfare', 'unlock', 'upgrade', 'cheer', 'crash', 'whistle']);
const MASTER_GAIN = 0.5;
const COMBO_WINDOW = 0.35;
const COMBO_MAX = 12;
const MAX_VOICES = 28;

/** Minimum seconds between two instances of the same sound (voice-steal / rate limit). */
const MIN_GAP: Record<SfxName, number> = {
  pop: 0.035,
  drop: 0.07,
  chop: 0.08,
  cash: 0.04,
  pay: 0.03,
  unlock: 0.5,
  build: 0.3,
  splash: 0.3,
  crash: 0.5,
  whoosh: 0.12,
  machine: 0.15,
  sell: 0.08,
  full: 0.25,
  step: 0.12,
  click: 0.05,
  upgrade: 0.15,
  chime: 0.25,
  fanfare: 1.0,
  cheer: 0.6,
  thunk: 0.05,
  firework: 0.07,
  timber: 0.5,
  /** A train sale can fire per item in a burst: one whistle per ~3 s. */
  whistle: 3,
  quest: 0.3,
  bell: 1.5,
  sparkle: 0.2,
  /** A workshop chair every ~2-3 s: one whirr per ~0.7 s even if two sources ask for it. */
  saw: 0.7,
  woof: 0.5,
  /** One church-bell strike every ~0.9 s at most (the dawn / dusk peal). */
  bellToll: 0.8,
  tick: 0.055,
  padDone: 0.3,
  ding: 0.12,
};

/** Per-sound cap on overlapping voices, with each sound's length in seconds (sounds not listed: global cap only). */
const VOICE_CAP: Partial<Record<SfxName, { max: number; len: number }>> = {
  tick: { max: 3, len: 0.16 },
  padDone: { max: 2, len: 1.3 },
  ding: { max: 3, len: 0.6 },
};

type AudioCtor = typeof AudioContext;

export class AudioFX {
  muted = false;
  /** Music switch (independent of `muted`, which silences everything). */
  musicOn = true;
  /** Wave 10: per-channel volumes 0..1 (see fx/volume.ts). Read at construction, persisted by setVolume. */
  private readonly volumes: Record<VolumeChannel, number> = {
    master: readVolume('master'),
    sfx: readVolume('sfx'),
    music: readVolume('music'),
  };

  /** Current volume of a channel, 0..1. */
  getVolume(ch: VolumeChannel): number {
    return this.volumes[ch];
  }

  /**
   * Set a channel volume (0..1), live and persisted. master scales everything (MASTER_GAIN * volumeGain(master)),
   * sfx scales the effects bus only, music scales the music's resting level (Music.setVolume).
   * Before init() (no unlock yet) it only stores and persists; init() then applies all three channels.
   */
  setVolume(ch: VolumeChannel, v: number): void {
    const vol = clampVolume(v);
    this.volumes[ch] = vol;
    writeVolume(ch, vol);
    try {
      const ac = this.ac;
      if (!ac) return;
      const now = ac.currentTime;
      if (ch === 'master') {
        if (this.master && !this.muted) this.master.gain.setTargetAtTime(this.masterLevel(), now, 0.03);
      } else if (ch === 'sfx') {
        this.sfxGain?.gain.setTargetAtTime(volumeGain(vol), now, 0.03);
      } else {
        this.music?.setVolume(vol);
      }
    } catch {
      /* audio must never break the game */
    }
  }

  /** Master gain when not muted. */
  private masterLevel(): number {
    return MASTER_GAIN * volumeGain(this.volumes.master);
  }

  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private compIn: DynamicsCompressorNode | null = null;
  private sfxGain: GainNode | null = null;
  private music: Music | null = null;
  private failed = false;
  private night = false;
  private voices = 0;
  private readonly lastCall = new Map<SfxName, number>();
  private readonly lastSound = new Map<SfxName, number>();
  private readonly comboStep = new Map<SfxName, number>();
  /** End times (AudioContext clock) of the live voices of the VOICE_CAP sounds. */
  private readonly capped = new Map<SfxName, number[]>();

  constructor() {
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === '1';
      this.musicOn = localStorage.getItem(MUSIC_KEY) !== '0';
    } catch {
      /* storage unavailable */
    }
    try {
      document.addEventListener('visibilitychange', () => this.syncMusic());
    } catch {
      /* no document */
    }
  }

  /** Create (first call) and resume the AudioContext. Safe to call repeatedly and never throws. */
  unlock(): void {
    try {
      if (this.failed) return;
      if (!this.ac) this.init();
      const ac = this.ac;
      if (ac && ac.state !== 'running') void ac.resume().then(() => this.syncMusic()).catch(() => undefined);
      this.syncMusic();
    } catch {
      this.failed = true;
    }
  }

  /** Play a sound. No-op before unlock(), when muted or when WebAudio is unavailable. */
  play(name: SfxName, opts?: PlayOptions): void {
    try {
      const ac = this.ac;
      if (this.muted || this.failed || !ac || !this.master || ac.state !== 'running') return;
      const now = ac.currentTime;

      let pitch = opts?.pitch ?? 1;
      const last = this.lastCall.get(name);
      this.lastCall.set(name, now);
      if (opts?.combo) {
        // The combo clock advances on every call, even rate-limited ones, so a fast stream keeps rising.
        const prev = this.comboStep.get(name) ?? 0;
        const step = last !== undefined && now - last < COMBO_WINDOW ? Math.min(COMBO_MAX, prev + 1) : 0;
        this.comboStep.set(name, step);
        pitch *= Math.pow(2, step / 12);
      }
      const played = this.lastSound.get(name);
      if (played !== undefined && now - played < MIN_GAP[name]) return;
      if (this.voices >= MAX_VOICES) return;
      const cap = VOICE_CAP[name];
      if (cap) {
        let ends = this.capped.get(name);
        if (!ends) this.capped.set(name, (ends = []));
        if (!admitVoice(ends, now, cap.max, cap.len)) return;
      }
      this.lastSound.set(name, now);
      if (DUCKS.has(name)) this.music?.dip();
      this.synth(name, now + 0.005, pitch, Math.max(0, Math.min(1, opts?.volume ?? 1)));
    } catch {
      /* audio must never break the game */
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(STORAGE_KEY, m ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (this.master && this.ac) {
      this.master.gain.setTargetAtTime(m ? 0 : this.masterLevel(), this.ac.currentTime, 0.02);
    }
    this.syncMusic();
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    try {
      localStorage.setItem(MUSIC_KEY, on ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    this.syncMusic();
  }

  /** Night ambience: the music softens (about -20 %, duller pad) while it is night, back at day:start. */
  setNight(on: boolean): void {
    this.night = on;
    this.music?.setNight(on);
  }

  /** Returns the new music state. */
  toggleMusic(): boolean {
    this.setMusic(!this.musicOn);
    return this.musicOn;
  }

  /** Returns the new muted state. */
  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  /** Start / stop the music to match: unlocked, switched on, not muted, tab visible. */
  private syncMusic(): void {
    try {
      const m = this.music;
      if (!m) return;
      const want = this.musicOn && !this.muted && !this.failed && !document.hidden && this.ac?.state === 'running';
      if (want) m.start();
      else m.stop();
    } catch {
      /* music must never break the game */
    }
  }

  private init(): void {
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      this.failed = true;
      return;
    }
    const ac = new Ctor({ latencyHint: 'interactive' });
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.16;
    const master = ac.createGain();
    master.gain.value = this.muted ? 0 : this.masterLevel();
    const sfxGain = ac.createGain();
    sfxGain.gain.value = volumeGain(this.volumes.sfx);
    comp.connect(sfxGain);
    sfxGain.connect(master);
    master.connect(ac.destination);

    // 1 s of white noise, shared by every noise voice.
    const len = ac.sampleRate;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.ac = ac;
    this.master = master;
    this.noise = buf;
    this.compIn = comp;
    this.sfxGain = sfxGain;
    try {
      // music goes straight to the master gain (not through the SFX compressor) so it never pumps the SFX
      this.music = new Music(ac, master);
      this.music.setVolume(this.volumes.music);
      if (this.night) this.music.setNight(true);
      ac.onstatechange = () => this.syncMusic();
    } catch {
      this.music = null;
    }
  }

  /** Track a voice's end so MAX_VOICES stays honest, and release its nodes. */
  private track(src: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    this.voices++;
    src.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    };
  }

  /** Oscillator voice with an attack/decay envelope and optional frequency glide. */
  private tone(
    t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number,
    attack = 0.004, lowpass = 0,
  ): void {
    const ac = this.ac!;
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    let f: BiquadFilterNode | null = null;
    if (lowpass > 0) {
      f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      g.connect(f);
      f.connect(this.compIn!);
    } else {
      g.connect(this.compIn!);
    }
    osc.start(t);
    osc.stop(t + dur + 0.02);
    if (f) this.track(osc, g, f);
    else this.track(osc, g);
  }

  /** Filtered noise voice; the filter sweeps f0 -> f1 over `dur`. */
  private hiss(
    t: number, ftype: BiquadFilterType, f0: number, f1: number, dur: number, vol: number,
    attack = 0.005, q = 0.8,
  ): void {
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = ftype;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.compIn!);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.02);
    this.track(src, f, g);
  }

  private synth(name: SfxName, t: number, p: number, v: number): void {
    switch (name) {
      case 'pop':
        this.tone(t, 'sine', 520 * p, 980 * p, 0.09, 0.3 * v);
        this.tone(t, 'triangle', 1040 * p, 1500 * p, 0.05, 0.08 * v);
        break;
      case 'drop':
        this.tone(t, 'sine', 210 * p, 95 * p, 0.09, 0.3 * v);
        this.hiss(t, 'bandpass', 1100 * p, 700 * p, 0.04, 0.12 * v, 0.002, 1.2);
        break;
      case 'chop':
        this.hiss(t, 'lowpass', 2600 * p, 380 * p, 0.14, 0.5 * v, 0.002);
        this.tone(t, 'sine', 170 * p, 55 * p, 0.16, 0.45 * v, 0.002);
        this.hiss(t, 'highpass', 3200, 2200, 0.03, 0.18 * v, 0.001);
        break;
      case 'cash':
        this.tone(t, 'triangle', 1318 * p, 1318 * p, 0.2, 0.2 * v, 0.003);
        this.tone(t + 0.055, 'triangle', 1760 * p, 1760 * p, 0.26, 0.17 * v, 0.003);
        this.tone(t + 0.055, 'sine', 3520 * p, 3520 * p, 0.12, 0.04 * v, 0.003);
        break;
      case 'pay':
        this.tone(t, 'triangle', 760 * p, 1100 * p, 0.05, 0.2 * v, 0.002);
        this.hiss(t, 'highpass', 4000, 4000, 0.015, 0.05 * v, 0.001);
        break;
      case 'unlock': {
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i]! * p;
          const at = t + i * 0.085;
          const last = i === notes.length - 1;
          this.tone(at, 'triangle', n, n, last ? 0.7 : 0.28, 0.2 * v, 0.006);
          this.tone(at, 'sine', n * 2, n * 2, last ? 0.5 : 0.18, 0.06 * v, 0.006);
        }
        this.tone(t, 'sine', 261.6 * p, 261.6 * p, 0.7, 0.14 * v, 0.01);
        break;
      }
      case 'build':
        this.hiss(t, 'bandpass', 260 * p, 2200 * p, 0.32, 0.3 * v, 0.1, 0.9);
        this.tone(t + 0.22, 'sine', 140 * p, 42 * p, 0.3, 0.5 * v, 0.004);
        this.hiss(t + 0.22, 'lowpass', 900, 200, 0.12, 0.25 * v, 0.003);
        break;
      case 'splash':
        this.hiss(t, 'bandpass', 1500 * p, 500 * p, 0.55, 0.4 * v, 0.02, 0.6);
        this.hiss(t, 'highpass', 4500, 2500, 0.3, 0.14 * v, 0.01);
        this.tone(t, 'sine', 300 * p, 110 * p, 0.2, 0.2 * v, 0.004);
        break;
      case 'crash':
        this.hiss(t, 'lowpass', 1100 * p, 120 * p, 0.9, 0.7 * v, 0.003);
        this.tone(t, 'sine', 100 * p, 32 * p, 0.7, 0.7 * v, 0.003);
        this.tone(t, 'sawtooth', 130 * p, 50 * p, 0.35, 0.2 * v, 0.003, 700);
        this.tone(t + 0.09, 'triangle', 90 * p, 45 * p, 0.3, 0.25 * v, 0.003);
        this.hiss(t, 'highpass', 3000, 1500, 0.06, 0.25 * v, 0.001);
        break;
      case 'whoosh':
        this.hiss(t, 'bandpass', 450 * p, 1800 * p, 0.16, 0.22 * v, 0.07, 0.8);
        this.hiss(t + 0.16, 'bandpass', 1800 * p, 500 * p, 0.2, 0.18 * v, 0.01, 0.8);
        break;
      case 'machine':
        for (let i = 0; i < 3; i++) {
          this.tone(t + i * 0.075, 'sawtooth', 95 * p, 70 * p, 0.07, 0.18 * v, 0.003, 520);
          this.hiss(t + i * 0.075, 'bandpass', 700, 500, 0.04, 0.07 * v, 0.002, 1.5);
        }
        break;
      case 'sell':
        this.tone(t, 'sine', 659 * p, 659 * p, 0.16, 0.26 * v, 0.004);
        this.tone(t + 0.09, 'sine', 988 * p, 988 * p, 0.3, 0.26 * v, 0.004);
        this.tone(t + 0.09, 'triangle', 1976 * p, 1976 * p, 0.15, 0.06 * v, 0.004);
        break;
      case 'full':
        this.tone(t, 'sawtooth', 170 * p, 120 * p, 0.2, 0.22 * v, 0.006, 620);
        this.tone(t + 0.09, 'sawtooth', 150 * p, 100 * p, 0.2, 0.2 * v, 0.006, 560);
        break;
      case 'step':
        this.hiss(t, 'bandpass', 2400 * p, 1400 * p, 0.06, 0.07 * v, 0.003, 0.7);
        break;
      case 'click':
        this.tone(t, 'sine', 900 * p, 600 * p, 0.05, 0.2 * v, 0.002);
        break;
      case 'upgrade':
        // quick rising two-step with a shimmer on top
        this.tone(t, 'triangle', 600 * p, 900 * p, 0.12, 0.24 * v, 0.004);
        this.tone(t + 0.09, 'triangle', 900 * p, 1350 * p, 0.14, 0.24 * v, 0.004);
        this.tone(t + 0.18, 'triangle', 1350 * p, 1350 * p, 0.34, 0.24 * v, 0.004);
        this.tone(t + 0.18, 'sine', 2700 * p, 2700 * p, 0.22, 0.07 * v, 0.004);
        this.hiss(t + 0.14, 'highpass', 6000, 8000, 0.25, 0.04 * v, 0.02);
        break;
      case 'chime': {
        // soft bell triad (C6 E6 G6), slightly staggered, long tail
        const bells = [1046.5, 1318.5, 1568];
        for (let i = 0; i < bells.length; i++) {
          const n = bells[i]! * p;
          const at = t + i * 0.07;
          this.tone(at, 'sine', n, n, 0.7, 0.16 * v, 0.004);
          this.tone(at, 'sine', n * 2.76, n * 2.76, 0.25, 0.04 * v, 0.004);
        }
        break;
      }
      case 'fanfare': {
        // brass-ish: filtered saws on a rising major figure, ending on a held chord
        const seq: Array<[number, number, number]> = [
          [392, 0, 0.14], [523.25, 0.14, 0.14], [659.25, 0.28, 0.14], [783.99, 0.42, 0.14],
        ];
        for (const [f, at, dur] of seq) {
          this.tone(t + at, 'sawtooth', f * p, f * p, dur + 0.05, 0.16 * v, 0.01, 1800);
          this.tone(t + at, 'triangle', f * p * 2, f * p * 2, dur, 0.06 * v, 0.01);
        }
        for (const f of [523.25, 659.25, 783.99, 1046.5]) {
          this.tone(t + 0.58, 'sawtooth', f * p, f * p, 1.1, 0.12 * v, 0.02, 2200);
          this.tone(t + 0.58, 'sine', f * p, f * p, 1.1, 0.08 * v, 0.02);
        }
        this.tone(t + 0.58, 'sine', 261.6 * p, 261.6 * p, 1.1, 0.16 * v, 0.02);
        this.hiss(t + 0.58, 'highpass', 5000, 7000, 0.4, 0.04 * v, 0.01);
        break;
      }
      case 'cheer':
        // crowd "yay": band-passed noise swelling upward + a few vowel-ish rising tones
        this.hiss(t, 'bandpass', 900 * p, 1800 * p, 0.55, 0.28 * v, 0.06, 1.4);
        this.hiss(t + 0.03, 'bandpass', 1500 * p, 2600 * p, 0.45, 0.16 * v, 0.05, 1.8);
        this.tone(t, 'sawtooth', 320 * p, 520 * p, 0.45, 0.07 * v, 0.05, 1500);
        this.tone(t + 0.04, 'sawtooth', 410 * p, 640 * p, 0.4, 0.06 * v, 0.05, 1500);
        this.tone(t + 0.1, 'triangle', 880 * p, 1320 * p, 0.3, 0.1 * v, 0.02);
        this.tone(t + 0.2, 'triangle', 1320 * p, 1760 * p, 0.3, 0.1 * v, 0.02);
        break;
      case 'thunk':
        // light wooden knock
        this.tone(t, 'sine', 330 * p, 150 * p, 0.07, 0.3 * v, 0.002);
        this.hiss(t, 'bandpass', 1500 * p, 800 * p, 0.035, 0.1 * v, 0.001, 1.4);
        break;
      case 'timber':
        // trunk cracking through, then a soft muffled thud as the pine lands in the snow
        this.hiss(t, 'bandpass', 1800 * p, 500 * p, 0.09, 0.32 * v, 0.002, 1.6);
        this.tone(t, 'sawtooth', 240 * p, 90 * p, 0.12, 0.12 * v, 0.002, 900);
        this.tone(t + 0.22, 'sine', 110 * p, 40 * p, 0.32, 0.5 * v, 0.004);
        this.hiss(t + 0.22, 'lowpass', 700, 150, 0.22, 0.28 * v, 0.004);
        break;
      case 'whistle':
        // freight horn: a minor-third pair, a short toot then a long one that sags a little at the end
        for (const [f, at, dur] of [[311, 0, 0.3], [311, 0.38, 1.0]] as const) {
          for (const m of [1, 1.26]) {
            const n = f * m * p;
            this.tone(t + at, 'sawtooth', n * 0.96, n, dur, 0.1 * v, 0.04, 1500);
            this.tone(t + at, 'triangle', n * 2, n * 2, dur * 0.8, 0.03 * v, 0.04);
          }
        }
        this.hiss(t, 'bandpass', 1200, 1200, 0.5, 0.025 * v, 0.05, 1.2);
        break;
      case 'quest': {
        // quest complete: rising bell triad plus a coin ping on top
        const notes = [783.99, 987.77, 1174.66, 1567.98];
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i]! * p;
          const at = t + i * 0.075;
          const last = i === notes.length - 1;
          this.tone(at, 'triangle', n, n, last ? 0.65 : 0.22, 0.17 * v, 0.004);
          this.tone(at, 'sine', n * 2.76, n * 2.76, last ? 0.3 : 0.1, 0.035 * v, 0.003);
        }
        this.tone(t + 0.34, 'sine', 3136 * p, 3136 * p, 0.35, 0.05 * v, 0.003);
        break;
      }
      case 'bell':
        // rush hour: a counter service bell, three dings with inharmonic partials
        for (let i = 0; i < 3; i++) {
          const at = t + i * 0.2;
          const f = 1568 * p;
          this.tone(at, 'sine', f, f, 0.55, 0.2 * v, 0.002);
          this.tone(at, 'sine', f * 2.76, f * 2.76, 0.22, 0.07 * v, 0.002);
          this.tone(at, 'sine', f * 5.4, f * 5.4, 0.1, 0.03 * v, 0.002);
        }
        this.tone(t + 0.62, 'triangle', 2093 * p, 2093 * p, 0.8, 0.12 * v, 0.004);
        break;
      case 'sparkle': {
        // VIP tip: glittering high arpeggio
        const gl = [1568, 1976, 2349, 2637, 3136];
        for (let i = 0; i < gl.length; i++) {
          const n = gl[i]! * p;
          const at = t + i * 0.045;
          this.tone(at, 'sine', n, n, 0.3, 0.12 * v, 0.002);
          this.tone(at, 'triangle', n * 2, n * 2, 0.12, 0.03 * v, 0.002);
        }
        this.hiss(t + 0.05, 'highpass', 7000, 9000, 0.25, 0.03 * v, 0.02);
        break;
      }
      case 'saw':
        // woodworking: the blade spins up (sawtooth sweep + a detuned second), a gritty bite into the board, a final knock
        this.tone(t, 'sawtooth', 210 * p, 760 * p, 0.3, 0.09 * v, 0.03, 2600);
        this.tone(t, 'sawtooth', 316 * p, 1140 * p, 0.3, 0.05 * v, 0.03, 2600);
        this.tone(t + 0.3, 'sawtooth', 760 * p, 640 * p, 0.14, 0.07 * v, 0.01, 2400);
        this.hiss(t + 0.05, 'bandpass', 2600 * p, 4200 * p, 0.34, 0.14 * v, 0.04, 1.1);
        this.hiss(t + 0.18, 'highpass', 5000, 7000, 0.18, 0.05 * v, 0.03);
        this.tone(t + 0.46, 'sine', 300 * p, 140 * p, 0.08, 0.2 * v, 0.002);
        this.hiss(t + 0.46, 'bandpass', 1500 * p, 800 * p, 0.04, 0.1 * v, 0.001, 1.4);
        break;
      case 'woof':
        // a happy double bark: each "wuff" is a falling voiced growl through a lowpass plus a breathy burst
        for (const [at, f] of [[0, 430], [0.2, 500]] as const) {
          this.tone(t + at, 'sawtooth', f * p, f * 0.55 * p, 0.13, 0.22 * v, 0.008, 1300);
          this.tone(t + at, 'square', f * 0.5 * p, f * 0.3 * p, 0.12, 0.08 * v, 0.008, 700);
          this.hiss(t + at, 'bandpass', 1100 * p, 600 * p, 0.09, 0.12 * v, 0.004, 1.2);
        }
        break;
      case 'bellToll': {
        // dawn / dusk church bell: a deep fundamental with a slightly detuned twin (a slow beat), a fifth above, a faint
        // inharmonic hum, all with a long decay, and a short noise strike for the clapper
        this.tone(t, 'sine', 220 * p, 220 * p, 2.5, 0.3 * v, 0.004);
        this.tone(t, 'sine', 221.6 * p, 221.6 * p, 2.3, 0.18 * v, 0.004);
        this.tone(t, 'sine', 330 * p, 330 * p, 1.9, 0.16 * v, 0.004);
        this.tone(t, 'sine', 607 * p, 607 * p, 0.9, 0.05 * v, 0.003);
        this.hiss(t, 'bandpass', 1800 * p, 700 * p, 0.09, 0.1 * v, 0.002, 1.1);
        break;
      }
      case 'tick':
        // soft wood-and-glass tick: a short rounded knock, a faint glassy partial above it and a breath of grain
        this.tone(t, 'sine', 620 * p, 560 * p, 0.07, 0.14 * v, 0.003);
        this.tone(t, 'sine', 620 * 2.76 * p, 620 * 2.76 * p, 0.05, 0.025 * v, 0.002);
        this.tone(t, 'triangle', 1240 * p, 1240 * p, 0.04, 0.03 * v, 0.003, 2600);
        this.hiss(t, 'bandpass', 2200, 1800, 0.018, 0.025 * v, 0.002, 1.6);
        break;
      case 'padDone': {
        // warm chord: a low root + a gently strummed major triad (lowpassed triangles over sines), a glassy top note
        const chord = [261.63, 329.63, 392, 523.25];
        this.tone(t, 'sine', 130.81 * p, 130.81 * p, 1.1, 0.09 * v, 0.02);
        for (let i = 0; i < chord.length; i++) {
          const n = chord[i]! * p;
          const at = t + i * 0.035;
          this.tone(at, 'triangle', n, n, 1.0, 0.06 * v, 0.018, 1800);
          this.tone(at, 'sine', n, n, 0.9, 0.06 * v, 0.015);
        }
        this.tone(t + 0.16, 'sine', 1046.5 * p, 1046.5 * p, 0.8, 0.035 * v, 0.01);
        this.tone(t + 0.16, 'sine', 1046.5 * 2.76 * p, 1046.5 * 2.76 * p, 0.3, 0.008 * v, 0.01);
        break;
      }
      case 'ding':
        // tiny "ding-ding": two soft bell notes a major sixth apart, the second a hair quieter
        for (const [at, f, g] of [[0, 1318.5, 1], [0.11, 1760, 0.8]] as const) {
          const n = f * p;
          this.tone(t + at, 'sine', n, n, 0.42, 0.09 * g * v, 0.004);
          this.tone(t + at, 'sine', n * 2.76, n * 2.76, 0.14, 0.015 * g * v, 0.003);
        }
        break;
      case 'firework':
        // distant crackle + soft thud
        this.tone(t, 'sine', 120 * p, 45 * p, 0.28, 0.4 * v, 0.003);
        this.hiss(t, 'lowpass', 2400, 400, 0.3, 0.3 * v, 0.003);
        for (let i = 0; i < 4; i++) {
          this.hiss(t + 0.08 + i * 0.07 + Math.random() * 0.04, 'highpass', 4500 + Math.random() * 2500, 3500, 0.03, 0.1 * v, 0.001);
        }
        break;
    }
  }
}
