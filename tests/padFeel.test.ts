/**
 * 0.9.8 brief 13 (pads, sound and juice): the level-note ladder and Lv 10 capstone (fx/padJuice.ts), the slow breath
 * that replaced the jiggle, PadFeel's dim and step-on thump (fx/PadRing.ts), the pad looks living in the palette, and
 * the JuiceDirector's calmer completion (a snow puff and one sparkle). Canvas-free: the pad model is a plain Group
 * carrying the face material createPadModel would put on it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { BREATH_SWELL, CAPSTONE_LEVEL, LEVEL_NOTES, PENTATONIC, isCapstone, levelNotePitch, padBreath, setReducedMotion } from '../src/fx/padJuice';
import { PadFeel, PadRing } from '../src/fx/PadRing';
import { setComfort } from '../src/fx/comfort';
import { COLORS } from '../src/config';
import { DEFAULT_PAD_STYLE, padStyle } from '../src/assets/pads';
import { PAD, lightness } from '../src/render/palette';

const src = (p: string): string => readFileSync(resolve(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

afterEach(() => {
  setReducedMotion(null);
  setComfort({ glow: 1 });
});

describe('level notes', () => {
  it('climbs one pentatonic step per level from Lv 1 to Lv 9, then the capstone takes over at Lv 10', () => {
    expect(LEVEL_NOTES.length).toBe(CAPSTONE_LEVEL - 1);
    expect(levelNotePitch(1)).toBe(1);
    for (let lv = 2; lv <= 9; lv++) expect(levelNotePitch(lv)).toBeGreaterThan(levelNotePitch(lv - 1));
    // every step is a pentatonic interval (mod the octave), and the top stays under two octaves
    for (const s of LEVEL_NOTES) expect(PENTATONIC).toContain(s % 12);
    expect(levelNotePitch(9)).toBeLessThan(4);
    expect(levelNotePitch(0)).toBe(1);
    expect(levelNotePitch(42)).toBe(levelNotePitch(9));
    expect(isCapstone(9)).toBe(false);
    expect(isCapstone(10)).toBe(true);
    expect(isCapstone(3, true)).toBe(true);
  });
});

describe('breathing', () => {
  it('swells slowly only while affordable, never below 1, and holds still with Reduce motion', () => {
    for (let t = 0; t < 8; t += 0.2) {
      expect(padBreath(t, false, 0, false)).toBe(1);
      expect(padBreath(t, true, 0, true)).toBe(1);
      const s = padBreath(t, true, 0, false);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(1 + BREATH_SWELL + 1e-9);
    }
    // slow: far less than a beat per second (the old pulse ran at ~0.9 Hz)
    let crossings = 0;
    let prev = padBreath(0, true, 0, false) > 1 + BREATH_SWELL / 2;
    for (let t = 0; t < 10; t += 0.01) {
      const up = padBreath(t, true, 0, false) > 1 + BREATH_SWELL / 2;
      if (up !== prev) crossings++;
      prev = up;
    }
    expect(crossings / 2 / 10).toBeLessThan(0.35);
  });
});

describe('PadFeel', () => {
  const make = () => {
    const played: string[] = [];
    const squashed: THREE.Object3D[] = [];
    const ctx = {
      tweens: { squash: (o: THREE.Object3D) => void squashed.push(o) },
      audio: { play: (name: string) => void played.push(name) },
    };
    const model = new THREE.Group();
    const face = new THREE.MeshToonMaterial();
    model.userData.padTop = face;
    const pulse = new THREE.Group();
    const feel = new PadFeel(ctx as never, model);
    return { played, squashed, model, face, pulse, feel };
  };

  it('thumps and squashes once when the player steps on, not while standing or for a pad appearing underfoot', () => {
    const f = make();
    f.feel.update(1 / 60, 0, f.pulse, false, true, true); // appeared under the player
    f.feel.update(1 / 60, 0.1, f.pulse, false, true, true);
    expect(f.played).toEqual([]);
    f.feel.update(1 / 60, 0.2, f.pulse, false, true, false);
    f.feel.update(1 / 60, 0.3, f.pulse, false, true, true); // steps on
    f.feel.update(1 / 60, 0.4, f.pulse, false, true, true);
    expect(f.played).toEqual(['padStep']);
    expect(f.squashed).toEqual([f.model]);
    f.feel.reset();
    f.feel.update(1 / 60, 0.5, f.pulse, false, true, true); // re-shown under the player: quiet again
    expect(f.played).toEqual(['padStep']);
  });

  it('dims the face while nothing can be paid and brightens it back, and breathes the pulse only when affordable', () => {
    const f = make();
    f.feel.update(1 / 60, 0, f.pulse, false, false, false);
    expect(f.face.color.r).toBeLessThan(0.8);
    for (let i = 0; i < 120; i++) f.feel.update(1 / 60, i / 60, f.pulse, false, true, false);
    expect(f.face.color.r).toBeGreaterThan(0.99);
    expect(f.pulse.scale.x).toBe(1);
    setReducedMotion(false);
    f.feel.update(1 / 60, 0.98, f.pulse, true, true, false);
    expect(f.pulse.scale.x).toBeGreaterThan(1);
    expect(f.pulse.scale.y).toBeLessThan(f.pulse.scale.x);
  });
});

describe('ring glow', () => {
  it('follows the Glow slider but keeps an affordable pad readable at Glow 0', () => {
    const glowAt = (g: number): number => {
      setComfort({ glow: g });
      const ring = new PadRing(2, 2);
      for (let i = 0; i < 240; i++) ring.update(1 / 60, i / 60, true);
      return (ring.mesh.material as THREE.ShaderMaterial).uniforms.uGlow.value as number;
    };
    const full = glowAt(1);
    const off = glowAt(0);
    expect(full).toBeGreaterThan(0);
    expect(off).toBeLessThan(full);
    expect(off / full).toBeCloseTo(0.35, 1);
  });
});

describe('pad look', () => {
  it("is Dino's pick, the frosted lantern, unless ?pads= previews another", () => {
    expect(DEFAULT_PAD_STYLE).toBe('lantern');
    expect(padStyle()).toBe('lantern');
  });

  it('is no longer the source ad: no grey tile, no green fill', () => {
    expect(COLORS.PAD_FILL).toBe(PAD.honey);
    expect(COLORS.PAD_FILL).not.toBe(0x2ecc71);
    expect(COLORS.PAD_BG).not.toBe(0x4a4a4a);
    for (const look of Object.values(PAD.looks)) {
      // warm, light faces with readable ink on the medallion (never pure black)
      expect(lightness(look.face)).toBeGreaterThan(0.5);
      expect(lightness(look.medal) - lightness(PAD.ink)).toBeGreaterThan(0.5);
    }
    expect(lightness(PAD.ink)).toBeGreaterThan(0.08);
  });

  it('keeps its colours in the palette module, not in the pad code', () => {
    const pads = src('src/assets/pads.ts');
    expect(pads).not.toMatch(/COLORS\.PAD_BG/);
    expect(pads).not.toMatch(/const [A-Z_]+ = \{ *face: 0x/);
    expect(src('src/fx/PadRing.ts')).not.toMatch(/0x86f0b4/);
  });

  it('completes calmly: a snow puff and one sparkle, the level note or the capstone chord', () => {
    const jd = src('src/fx/JuiceDirector.ts');
    const block = jd.slice(jd.indexOf("ev.on('pad:complete'"), jd.indexOf("ev.on('pad:unlocked'"));
    expect(block).toContain("'padStep'");
    expect(block).toContain("'padCapstone'");
    expect(block).toContain("'padNote'");
    expect(block.match(/particles\.sparkle\(/g)?.length).toBe(1);
    expect(block).toContain('particles.puff(');
    expect(block).not.toContain('particles.burst(');
  });
});
