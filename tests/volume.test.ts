import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clampVolume, readVolume, volumeGain, volumeKey, writeVolume } from '../src/fx/volume';
import { musicRestLevel } from '../src/fx/Music';

function stubStorage(): Map<string, string> {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  });
  return m;
}

describe('volume helpers', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = stubStorage();
  });

  it('clampVolume', () => {
    expect(clampVolume(NaN)).toBe(1);
    expect(clampVolume('0.3')).toBe(0.3);
    expect(clampVolume(2)).toBe(1);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume('abc')).toBe(1);
    expect(clampVolume(undefined)).toBe(1);
  });

  it('volumeGain is the squared perceptual curve', () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(1)).toBe(1);
    expect(volumeGain(0.5)).toBe(0.25);
    expect(volumeGain(5)).toBe(1);
  });

  it('readVolume defaults to 1 and round-trips through writeVolume', () => {
    expect(readVolume('master')).toBe(1);
    writeVolume('sfx', 0.35);
    expect(readVolume('sfx')).toBeCloseTo(0.35, 5);
    expect(readVolume('music')).toBe(1);
    writeVolume('music', 0);
    expect(readVolume('music')).toBe(0);
  });

  it('writeVolume stores 2-decimal strings under winterland:vol:<ch>', () => {
    writeVolume('master', 0.3333);
    expect(store.get('winterland:vol:master')).toBe('0.33');
    writeVolume('sfx', 1);
    expect(store.get(volumeKey('sfx'))).toBe('1.00');
    writeVolume('music', 7);
    expect(store.get('winterland:vol:music')).toBe('1.00');
  });
});

describe('musicRestLevel (night/volume fold)', () => {
  it('full volume: day 0.5, night 0.4', () => {
    expect(musicRestLevel(false, 1)).toBeCloseTo(0.5, 10);
    expect(musicRestLevel(true, 1)).toBeCloseTo(0.4, 10);
  });

  it('volume scales both day and night by volumeGain', () => {
    expect(musicRestLevel(false, 0.5)).toBeCloseTo(0.5 * 0.25, 10);
    expect(musicRestLevel(true, 0.5)).toBeCloseTo(0.4 * 0.25, 10);
    expect(musicRestLevel(false, 0)).toBe(0);
    expect(musicRestLevel(true, 0)).toBe(0);
  });

  it('dusk then dawn keeps the slider: the ratio night/day is constant at any volume', () => {
    for (const v of [0.1, 0.5, 0.9, 1]) {
      expect(musicRestLevel(true, v) / musicRestLevel(false, v)).toBeCloseTo(0.8, 10);
    }
  });
});
