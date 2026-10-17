/**
 * 0.9.8 look foundation: one palette module for all ten eras (DIRECTION V9), the snow fixed to the guide's #f4f7fb, and
 * the three graphics tiers (V13).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLORS, PALETTE } from '../src/config';
import { ERAS } from '../src/eras/data';
import { ERA_COUNT, MACHINE_TONES, SNOW, eraIndex, guideColors, lightness, mixHex, palette } from '../src/render/palette';
import { QUALITIES, TIERS, parseQuality } from '../src/render/Renderer';
import { RAMP } from '../src/render/materials';

const src = (p: string): string => readFileSync(resolve(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

/** Channel distance (0..255) between two hex colours. */
const dist = (a: number, b: number): number => Math.max(...[16, 8, 0].map((s) => Math.abs(((a >> s) & 0xff) - ((b >> s) & 0xff))));

describe('palette module', () => {
  it('has all ten eras, era 1 included, and clamps anything else', () => {
    for (let n = 1; n <= ERA_COUNT; n++) expect(palette(n).n).toBe(n);
    expect(palette(0).n).toBe(1);
    expect(palette(NaN).n).toBe(1);
    expect(palette(42).n).toBe(10);
    expect(eraIndex(3.4)).toBe(3);
  });

  it('is the snow of the guide everywhere', () => {
    expect(SNOW).toBe(0xf4f7fb);
    expect(COLORS.SNOW_WHITE).toBe(SNOW);
    expect(PALETTE.snow).toBe(SNOW);
  });

  it('eras/data.ts reads its era colours from it (no copy of the guide table there)', () => {
    for (let n = 2; n <= 10; n++) expect(ERAS[n]!.colors).toEqual(guideColors(n));
    expect(src('src/eras/data.ts')).not.toMatch(/ground: 0x[0-9a-f]{6}, accent: 0x/);
  });

  it('the machine and city files keep no palette copies of their own', () => {
    expect(src('src/assets/eraMachines2.ts')).not.toMatch(/const E[234] = \{/);
    expect(src('src/assets/eraMachines3.ts')).not.toMatch(/const [IEO] = \{/);
    expect(src('src/assets/eraMachines4.ts')).not.toMatch(/const E(8|9|10) = pal\(0x/);
    expect(src('src/assets/cityBuildings.ts')).not.toMatch(/\{ wall: 0x/);
    for (const f of ['src/assets/eraKit.ts', 'src/assets/cityBuildings.ts', 'src/city/District.ts', 'src/assets/eraMachines3.ts']) {
      expect(src(f)).not.toMatch(/const SNOW = 0x/);
    }
    expect(MACHINE_TONES[2]).toEqual({ body: palette(2).body, accent: palette(2).accent, trim: palette(2).trim, glow: palette(2).glow, fence: palette(2).fence });
  });

  it('gives every era its own floor (no two base boards read alike) and a night light', () => {
    for (let a = 1; a <= 10; a++) {
      for (let b = a + 1; b <= 10; b++) expect(dist(palette(a).floor.yard, palette(b).floor.yard), `eras ${a} and ${b}`).toBeGreaterThan(24);
      expect(palette(a).light).toBeGreaterThan(0);
    }
  });

  it('never uses pure black, and nights stay warmer underfoot than overhead', () => {
    for (let n = 1; n <= 10; n++) {
      const p = palette(n);
      for (const c of [p.ground, p.fence, p.body, p.accent, p.trim, p.glow, p.coat, p.floor.yard, p.floor.processing]) expect(lightness(c)).toBeGreaterThan(0.08);
      const { night, grade } = p.look;
      // the ground bounce carries the warmth (red over blue), the sky the moonlight (blue over red)
      expect((night.hemiGround >> 16) & 0xff).toBeGreaterThanOrEqual(night.hemiGround & 0xff);
      expect(night.hemiSky & 0xff).toBeGreaterThan((night.hemiSky >> 16) & 0xff);
      // shadows lift toward plum, never to grey or black
      expect(grade.night.lift).not.toBe(0);
      expect(grade.day.vignette).toBeLessThan(0.4);
      expect(grade.night.vignette).toBeLessThan(0.4);
    }
  });

  it('mixes colours per channel', () => {
    expect(mixHex(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixHex(0x102030, 0x102030, 0.7)).toBe(0x102030);
  });
});

describe('light ramp and tiers', () => {
  it('lights warm and shades cool (V7)', () => {
    const [shadow, , lit] = RAMP;
    expect(lit![0]).toBeGreaterThan(lit![2]); // warm: more red than blue
    expect(shadow![2]).toBeGreaterThan(shadow![0]); // cool: more blue than red
    expect(Math.min(...shadow!)).toBeGreaterThan(0.2); // never black
  });

  it('has three tiers that add cost step by step', () => {
    expect(QUALITIES).toEqual(['low', 'medium', 'high']);
    expect(TIERS.low.post).toBe(false);
    expect(TIERS.low.shadows).toBe(0);
    expect(TIERS.medium.shadows).toBeGreaterThan(0);
    expect(TIERS.high.shadows).toBeGreaterThan(TIERS.medium.shadows);
    expect(TIERS.high.bloomLevels).toBeGreaterThan(TIERS.medium.bloomLevels);
    expect(TIERS.high.dof).toBe(true);
    expect(TIERS.medium.dof).toBe(false);
  });

  it("reads 0.9.7's stored 'high' / 'low' as before and ignores junk", () => {
    expect(parseQuality('high')).toBe('high');
    expect(parseQuality('low')).toBe('low');
    expect(parseQuality('medium')).toBe('medium');
    expect(parseQuality('ultra')).toBeNull();
    expect(parseQuality(null)).toBeNull();
  });

  it('CI runs the 950 draw-call gate on every tier', () => {
    expect(src('.github/workflows/ci.yml')).toContain('perf-scenario.mjs --frames 2 --tiers low,medium,high --gate 950');
  });
});
