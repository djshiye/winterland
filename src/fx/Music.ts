/**
 * [B4] Procedural background music, synthesised with WebAudio (no audio files).
 *
 * 0.9.8 [17]: one cozy theme per era (fx/music/themes.ts), played by fx/music/ThemePlayer.ts with sampled-in-code
 * instruments (fx/music/instruments.ts) and a soft generated reverb (fx/music/reverb.ts). Era 1 keeps the 0.9.x tune.
 * - setEra(n) crossfades to era n's theme: the old one fades away over ~3 s with its lowpass closing (walking out of
 *   the room) while the new one comes in from its intro. fx/soundscape.ts decides the era from where the player walks.
 * - Lookahead scheduler on the AudioContext clock: one 100 ms timer queues every note due in the next 0.6 s at exact
 *   audio times, so the timer's jitter never reaches the sound.
 * - setNight(on): a softer mix (-20 %), the rhythm layers drop out, the melody thins and the pads darken, over ~2 s.
 * - setVolume(v) takes the 0..1 music slider value and applies the perceptual curve (volumeGain) itself. The volume is
 *   folded into the resting level (musicRestLevel: LEVEL * night factor * volumeGain) so setNight() and dip() both
 *   respect it.
 * - Everything routes through one level node (`duck`) -> `fade` -> the destination handed in by the caller (AudioFX's
 *   master gain, so the master mute silences music too). dip() lowers the level ~40 % for ~0.4 s under loud SFX.
 * - AudioFX owns the on/off decisions (unlocked, music switch, mute, tab visible) and calls start()/stop().
 * - scheduleUntil(t) is public so scripts/music-preview.mjs can render a theme on an OfflineAudioContext.
 */
import { SampleBank } from './music/bank';
import type { InstrumentId } from './music/instruments';
import { makeReverb } from './music/reverb';
import { ThemePlayer } from './music/ThemePlayer';
import { THEMES, themeFor, type Theme } from './music/themes';
import { clampVolume, volumeGain } from './volume';

const LOOKAHEAD = 0.6;
const TICK_MS = 100;
const LEVEL = 0.5;
const DUCK_TO = 0.6;
/** Warm-up spot: the music rests at this share of its level (eased over ~1.5 s). */
const SOFT_TO = 0.7;
/** Night: level factor while it is night. */
const NIGHT_LEVEL = 0.8;
/** Era crossfade: the old theme fades over OUT s; the new one starts IN_AT s later and swells over IN s. */
const XFADE_OUT = 3;
const XFADE_IN_AT = 1.2;
const XFADE_IN = 3;
/** Reverb return level. */
const VERB_RETURN = 0.55;

/**
 * Resting level of the `duck` node: LEVEL, a bit lower at night, times the music volume. `vol` is the 0..1 slider
 * value; the perceptual curve (volumeGain) is applied here. Pure, so the night/volume fold is unit-testable.
 */
export const musicRestLevel = (night: boolean, vol: number): number =>
  LEVEL * (night ? NIGHT_LEVEL : 1) * volumeGain(vol);

/** Every instrument a theme plays (for warming the sample bank ahead of time). */
export function themeInstruments(t: Theme): InstrumentId[] {
  const ids: (InstrumentId | undefined)[] = [t.lead, t.nightLead, t.counter, t.bass.inst, t.arp?.inst, t.stab?.inst];
  for (const k of Object.keys(t.perc ?? {})) ids.push(k as InstrumentId);
  return ids.filter((x): x is InstrumentId => !!x);
}

export class Music {
  private readonly duck: GainNode;
  private readonly fade: GainNode;
  private readonly mix: GainNode;
  private readonly verbIn: AudioNode;
  private readonly bank: SampleBank;
  private current: ThemePlayer | null = null;
  private readonly fading: { p: ThemePlayer; until: number }[] = [];
  private era = 1;
  private timer = 0;
  private running = false;
  private night = false;
  /** Music slider value 0..1 (volumeGain is applied in restLevel). */
  private vol = 1;
  /** Warm-up spot: the resting level eases to SOFT_TO of itself while the player warms up (fx/WarmUp.ts). */
  private soft = false;
  private warmed = false;

  /** Section of the arrangement a new theme starts from (0 = its intro; scripts/music-preview.mjs uses 1). */
  startForm = 0;

  constructor(
    private readonly ac: BaseAudioContext,
    dest: AudioNode,
  ) {
    this.fade = ac.createGain();
    this.fade.gain.value = 0;
    this.fade.connect(dest);
    this.duck = ac.createGain();
    this.duck.gain.value = this.restLevel;
    this.duck.connect(this.fade);
    this.mix = ac.createGain();
    this.mix.connect(this.duck);
    const verb = makeReverb(ac, 2.6, 2.3);
    if (verb) {
      const ret = ac.createGain();
      ret.gain.value = VERB_RETURN;
      verb.connect(ret);
      ret.connect(this.mix);
      this.verbIn = verb;
    } else {
      // no convolver: the wet sends just go nowhere
      this.verbIn = ac.createGain();
    }
    this.bank = new SampleBank(ac);
  }

  /** Current resting level of `duck`: day/night level times the music volume. */
  private get restLevel(): number {
    return musicRestLevel(this.night, this.vol) * (this.soft ? SOFT_TO : 1);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** The era whose theme is playing (or will play on start). */
  get currentEra(): number {
    return this.era;
  }

  /** Begin (or resume at the next bar line). Safe to call repeatedly. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const now = this.ac.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setTargetAtTime(1, now, 0.6);
    if (!this.current) this.current = this.player(this.era, now + 0.15, 0.1);
    else this.current.resync(now + 0.15);
    if (!this.warmed) {
      // render every theme's instruments in idle moments, the current era first, so era changes never stall a frame
      this.warmed = true;
      const ids = themeInstruments(themeFor(this.era));
      for (const t of THEMES) ids.push(...themeInstruments(t));
      this.bank.warm(ids);
    }
    if (typeof window !== 'undefined') this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** Fade out and stop scheduling (notes already queued ring out under the fade). */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (typeof window !== 'undefined') window.clearInterval(this.timer);
    const now = this.ac.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setTargetAtTime(0, now, 0.08);
  }

  /** Dip the music under a loud SFX: ~40 % down, back up after ~0.4 s. */
  dip(): void {
    const now = this.ac.currentTime;
    const g = this.duck.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(this.restLevel * DUCK_TO, now, 0.03);
    g.setTargetAtTime(this.restLevel, now + 0.4, 0.25);
  }

  /** Warm-up spot: ease the music to ~70 % of its resting level over ~1.5 s (on) and back (off). */
  soften(on: boolean): void {
    if (this.soft === on) return;
    this.soft = on;
    const now = this.ac.currentTime;
    const g = this.duck.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(this.restLevel, now, 0.5);
  }

  /** Music volume, the 0..1 slider value (the perceptual curve is applied here). Ramps the resting level (~0.05 s). */
  setVolume(v: number): void {
    this.vol = clampVolume(v);
    const now = this.ac.currentTime;
    const g = this.duck.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(this.restLevel, now, 0.05);
  }

  /** Night: a slow crossfade (~2 s) to a softer, sparser, darker mix and back. */
  setNight(on: boolean): void {
    this.night = on;
    const now = this.ac.currentTime;
    const g = this.duck.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(this.restLevel, now, 0.7);
    this.current?.setNight(on, now);
  }

  /** Crossfade to era n's theme (1..10). Before start() it only picks the theme. */
  setEra(n: number): void {
    const era = Math.max(1, Math.min(10, Math.round(n) || 1));
    if (era === this.era) return;
    this.era = era;
    const now = this.ac.currentTime;
    const old = this.current;
    if (!this.running) {
      old?.dispose();
      this.current = null;
      return;
    }
    if (old) {
      old.fadeOut(now, XFADE_OUT);
      this.fading.push({ p: old, until: now + XFADE_OUT + 4 });
    }
    this.current = this.player(era, now + XFADE_IN_AT, XFADE_IN);
    this.tick();
  }

  /** Queue everything due before audio time t (the real-time timer does this; offline renders call it directly). */
  scheduleUntil(t: number): void {
    if (!this.current) this.current = this.player(this.era, Math.max(0.05, this.ac.currentTime), 0.1);
    this.current.scheduleUntil(t);
    for (const f of this.fading) f.p.scheduleUntil(t);
  }

  private player(era: number, at: number, fadeIn: number): ThemePlayer {
    const p = new ThemePlayer(this.ac, this.bank, themeFor(era), this.mix, this.verbIn);
    p.begin(at, this.startForm);
    p.fadeIn(at, fadeIn);
    if (this.night) p.setNight(true, at);
    return p;
  }

  private tick(): void {
    try {
      const ac = this.ac;
      if (ac.state !== 'running' || !this.current) return;
      const now = ac.currentTime;
      // fell behind (tab throttled, context was suspended): rejoin at the next bar line
      for (const p of [this.current, ...this.fading.map((f) => f.p)]) if (p.cursor < now) p.resync(now + 0.1);
      this.scheduleUntil(now + LOOKAHEAD);
      for (let i = this.fading.length - 1; i >= 0; i--) {
        const f = this.fading[i]!;
        if (now > f.until) {
          f.p.dispose();
          this.fading.splice(i, 1);
        }
      }
    } catch {
      /* music must never break the game */
    }
  }
}
