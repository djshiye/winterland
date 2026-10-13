/**
 * [B3 — world & juice] Procedural WebAudio sound effects (no audio files). STUB: replace bodies,
 * keep the public API.
 *
 * - One AudioContext, created lazily; unlock() resumes it (called on the first user gesture).
 *   Before unlock / when muted / when WebAudio is unavailable, play() is a silent no-op — never throw.
 * - Short synthesized sounds (oscillators + noise buffers + envelopes, master compressor/gain):
 *   pop (item into stack, bright bubbly blip), drop (soft wooden knock), chop (axe thunk + crack),
 *   cash (coin/bill "ching"), pay (fast tick into a pad), unlock (rising arpeggio fanfare),
 *   build (whoosh + thump), splash, crash (heavy wooden boom), whoosh, machine (short mechanical
 *   chug), sell (cheerful two-note), full (dull "nope" buzz), step (very soft snow crunch),
 *   click (UI).
 * - combo: repeats of the same sound within ~0.35 s rise in pitch (semitone steps, capped ~1 octave)
 *   — the classic stacking pickup feel. Volume-limit rapid repeats so streams don't clip.
 * - Mute state persists in localStorage ('winterland:muted'), wrapped in try/catch.
 */

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
  | 'click';

export interface PlayOptions {
  /** Playback-rate / frequency multiplier (1 = normal). */
  pitch?: number;
  /** 0..1 (default 1). */
  volume?: number;
  /** Rising pitch for rapid repeats of the same sound. */
  combo?: boolean;
}

export class AudioFX {
  muted = false;

  unlock(): void {}

  play(_name: SfxName, _opts?: PlayOptions): void {}

  setMuted(m: boolean): void {
    this.muted = m;
  }

  /** Returns the new muted state. */
  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }
}
