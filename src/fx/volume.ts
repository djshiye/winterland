/**
 * Volume settings, pure helpers shared by AudioFX and the Settings panel (no WebAudio here, so they are unit-testable).
 * Three channels, each 0..1, persisted in localStorage ('winterland:vol:master' etc., default 1). The master mute and
 * the music switch stay separate booleans ('winterland:muted', 'winterland:music').
 */
export type VolumeChannel = 'master' | 'sfx' | 'music';

export const VOLUME_CHANNELS: readonly VolumeChannel[] = ['master', 'sfx', 'music'];

export const volumeKey = (ch: VolumeChannel): string => `winterland:vol:${ch}`;

/** Clamp to 0..1; NaN and non-numbers become the default (1). */
export function clampVolume(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

/** Read one channel from storage (default 1; storage errors are swallowed). */
export function readVolume(ch: VolumeChannel): number {
  try {
    const raw = localStorage.getItem(volumeKey(ch));
    return raw === null ? 1 : clampVolume(raw);
  } catch {
    return 1;
  }
}

export function writeVolume(ch: VolumeChannel, v: number): void {
  try {
    localStorage.setItem(volumeKey(ch), clampVolume(v).toFixed(2));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Perceptual curve for a gain multiplier: a linear slider feels "all loud" with linear gain, so square it
 * (0.5 on the slider is about half as loud). 0 stays 0, 1 stays 1.
 */
export const volumeGain = (v: number): number => {
  const c = clampVolume(v);
  return c * c;
};
