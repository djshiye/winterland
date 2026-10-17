import { describe, expect, it } from 'vitest';
import { chordPcs, HOLD, noteToMidi, parseChords, parseLine } from '../src/fx/music/notation';
import { INSTRUMENT_IDS, INSTRUMENTS, renderInstrument, SAMPLE_RATE } from '../src/fx/music/instruments';
import { stepsPerBar, THEMES, themeFor } from '../src/fx/music/themes';
import { impulse } from '../src/fx/music/reverb';
import { themeInstruments } from '../src/fx/Music';
import { BEDS, BED_IDS, eraBed } from '../src/fx/ambience/beds';
import { AMBIENT_SOUNDS } from '../src/fx/ambience/sounds';
import { ambienceLevel, dayNightWeight } from '../src/fx/Ambience';
import { EVENT_RATE, HOME, placeAt, type Place } from '../src/fx/soundscape';
import { DISTRICTS, REGIONS } from '../src/eras/data';

describe('music notation', () => {
  it('reads note names', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('F#5')).toBe(78);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(() => noteToMidi('H2')).toThrow();
  });

  it('reads a melody line with ties and rests', () => {
    expect(parseLine('C5 - . E5 | G5 . . .', 4)).toEqual([[72, HOLD, 0, 76], [79, 0, 0, 0]]);
    expect(() => parseLine('C5 .', 4)).toThrow();
  });

  it('voices chords close, with the bass in range', () => {
    expect(chordPcs('Am7').pcs).toEqual([9, 0, 4, 7]);
    expect(chordPcs('E/D').bassPc).toBe(2);
    const prog = parseChords('C Am F G Bbmaj7 F#m7 E/D Dm9');
    for (const c of prog) {
      expect(c.notes[0]!).toBeGreaterThanOrEqual(53);
      expect(c.notes[c.notes.length - 1]!).toBeLessThanOrEqual(74);
      expect(c.bass).toBeGreaterThanOrEqual(40);
      expect(c.bass).toBeLessThanOrEqual(51);
      for (const n of c.notes) expect(c.pcs).toContain(n % 12);
    }
  });
});

describe('era themes', () => {
  it('one theme per era, in order', () => {
    expect(THEMES.map((t) => t.era)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(THEMES.map((t) => t.title)).size).toBe(10);
    expect(themeFor(99).era).toBe(1);
  });

  it('era 1 keeps the 0.9.x tune note for note', () => {
    const a = themeFor(1).sections.A;
    expect(a.chords.map((c) => c.name)).toEqual(['C', 'Am', 'F', 'G', 'C', 'Em', 'F', 'G']);
    expect(a.melody[0]).toEqual([76, 0, 79, 0, 76, 0, 74, 0]);
    expect(a.melody[7]).toEqual([74, 0, 76, 0, 74, 0, 0, 0]);
  });

  for (const t of THEMES) {
    it(`${t.era} ${t.title}: well formed, in key, gentle`, () => {
      const steps = stepsPerBar(t);
      expect(t.bpm).toBeGreaterThanOrEqual(60);
      expect(t.bpm).toBeLessThanOrEqual(110);
      for (const s of [t.sections.A, t.sections.B]) {
        expect(s.chords.length).toBe(8);
        expect(s.melody.length).toBe(8);
        if (s.counter) expect(s.counter.length).toBe(8);
        for (const line of [s.melody, s.counter ?? []]) {
          for (const bar of line) {
            expect(bar.length).toBe(t.beatsPerBar * 2);
            expect(bar[0]).not.toBe(HOLD); // ties never cross a bar line
            for (const n of bar) {
              if (n <= 0) continue;
              expect(t.scale).toContain(n % 12);
              expect(n).toBeGreaterThanOrEqual(52);
              expect(n).toBeLessThanOrEqual(90);
            }
          }
        }
      }
      expect(t.bass.pattern.length).toBe(steps);
      if (t.arp) expect(t.arp.pattern.length).toBe(steps);
      for (const p of Object.values(t.perc ?? {})) expect(p!.length).toBe(steps);
      for (const slot of t.stab?.slots ?? []) expect(slot).toBeLessThan(steps);
      expect(t.form.length).toBeGreaterThan(t.loopFrom);
      // the loop rests regularly: one section without a melody
      expect(t.form.some((f) => !f.layers.includes('melody'))).toBe(true);
      // every instrument exists
      for (const id of themeInstruments(t)) expect(INSTRUMENTS[id]).toBeDefined();
      for (const m of Object.values(t.mix)) {
        expect(m.gain).toBeLessThanOrEqual(0.6);
        expect(Math.abs(m.pan)).toBeLessThanOrEqual(0.5);
      }
    });
  }
});

describe('instruments', () => {
  for (const id of INSTRUMENT_IDS) {
    it(`${id} renders clean (no NaN, starts and ends at silence, peak 0.9)`, () => {
      const d = renderInstrument(id);
      expect(d.length).toBe(Math.round(INSTRUMENTS[id].dur * SAMPLE_RATE));
      let peak = 0;
      for (const v of d) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak).toBeCloseTo(0.9, 3);
      expect(Math.abs(d[0]!)).toBeLessThan(0.05);
      expect(Math.abs(d[d.length - 1]!)).toBeLessThan(1e-3);
    });
  }

  it('renders are deterministic', () => {
    expect(renderInstrument('guitar')).toEqual(renderInstrument('guitar'));
  });

  it('plucked strings are in tune (autocorrelation at their reference pitch)', () => {
    for (const id of ['dulcimer', 'guitar', 'harp', 'bassUpright'] as const) {
      const d = renderInstrument(id);
      const a = Math.round(0.15 * SAMPLE_RATE);
      const N = 4096;
      const ac: number[] = [];
      for (let lag = 0; lag < 1200; lag++) {
        let s = 0;
        for (let i = 0; i < N; i++) s += d[a + i]! * d[a + i + lag]!;
        ac.push(s);
      }
      // the first peak past the first dip, refined by a parabola through its neighbours
      let lag = 1;
      while (ac[lag]! > 0) lag++;
      const best = Math.max(...ac.slice(lag));
      while (!(ac[lag]! >= 0.9 * best && ac[lag]! >= ac[lag + 1]! && ac[lag]! >= ac[lag - 1]!)) lag++;
      const [y0, y1, y2] = [ac[lag - 1]!, ac[lag]!, ac[lag + 1]!];
      const period = lag + (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2);
      const want = 440 * Math.pow(2, (INSTRUMENTS[id].ref - 69) / 12);
      expect(Math.abs(1200 * Math.log2(SAMPLE_RATE / period / want))).toBeLessThan(10);
    }
  });

  it('reverb impulse is finite, stereo and fades out', () => {
    const [l, r] = impulse(8000, 1.5, 1.4);
    expect(l.length).toBe(12000);
    expect(r).not.toEqual(l);
    expect(Math.abs(l[l.length - 1]!)).toBeLessThan(1e-6);
    for (const v of l) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('ambient beds', () => {
  it('every place has a bed with calm levels and real sounds', () => {
    for (const id of BED_IDS) {
      const b = BEDS[id];
      expect(b.layers.length).toBeGreaterThan(0);
      expect(b.trim).toBeGreaterThan(0.5);
      expect(b.trim).toBeLessThanOrEqual(2.5);
      for (const l of b.layers) expect(l.gain).toBeLessThanOrEqual(0.06);
      for (const e of b.events) {
        expect(AMBIENT_SOUNDS).toContain(e.sound);
        expect(e.gain).toBeLessThanOrEqual(0.04);
        // nothing pesters: at least a couple of seconds between two of the same sound
        expect(e.every[0]).toBeGreaterThanOrEqual(2);
        expect(e.every[1]).toBeGreaterThan(e.every[0]);
      }
    }
    expect(eraBed(1)).toBe('home');
    expect(eraBed(7)).toBe('era7');
  });

  it('no two era beds are alike (each built around its own resource)', () => {
    const sig = (id: (typeof BED_IDS)[number]) => BEDS[id].events.map((e) => e.sound).sort().join(',');
    const sigs = BED_IDS.map(sig);
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it('day and night weights blend with the darkness', () => {
    expect(dayNightWeight({}, 0.5)).toBe(1);
    expect(dayNightWeight({ night: 0 }, 0)).toBe(1);
    expect(dayNightWeight({ night: 0 }, 1)).toBe(0);
    expect(dayNightWeight({ day: 0, night: 1 }, 0.25)).toBeCloseTo(0.25, 10);
    expect(dayNightWeight({ day: 0 }, 7)).toBe(1);
  });

  it('ambience level follows its slider (perceptual curve) and the hush', () => {
    expect(ambienceLevel(0, false)).toBe(0);
    expect(ambienceLevel(1, true)).toBeCloseTo(ambienceLevel(1, false) / 2, 10);
    expect(ambienceLevel(0.5, false)).toBeCloseTo(ambienceLevel(1, false) / 4, 10);
  });

  it('calmer comfort settings thin the little sounds', () => {
    expect(EVENT_RATE.full).toBe(1);
    expect(EVENT_RATE.calm).toBeLessThan(1);
    expect(EVENT_RATE.minimal).toBeLessThan(EVENT_RATE.calm);
  });
});

describe('placeAt (what the player hears where)', () => {
  const all = () => true;
  const centre = (r: { minX: number; maxX: number; minZ: number; maxZ: number }) => [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2] as const;

  it('each era plot plays its own theme and bed', () => {
    for (let n = 2; n <= 10; n++) {
      const [x, z] = centre(REGIONS[n]!.rect);
      expect(placeAt(x, z, all, HOME)).toEqual({ bed: `era${n}`, era: n });
    }
  });

  it('era 1 land is home', () => {
    expect(placeAt(0, 0, all, { bed: 'era5', era: 5 })).toEqual(HOME);
  });

  it('roads between plots keep the last theme, with the open-road bed', () => {
    // between era 2's and era 3's plots, on road R1
    const p: Place = { bed: 'era3', era: 3 };
    expect(placeAt(-27, 64, all, p)).toEqual({ bed: 'road', era: 3 });
  });

  it('open city districts play their era over the city bed; unbuilt ones are just era 1 land', () => {
    const [x, z] = centre(DISTRICTS[4]!.rect);
    expect(placeAt(x, z, all, HOME)).toEqual({ bed: 'city', era: 4 });
    expect(placeAt(x, z, (n) => n <= 2, HOME)).toEqual(HOME);
    // the street between two districts keeps the city
    const d2 = DISTRICTS[2]!.rect;
    const d3 = DISTRICTS[3]!.rect;
    expect(placeAt((d2.maxX + d3.minX) / 2, (d2.minZ + d2.maxZ) / 2, all, { bed: 'city', era: 2 })).toEqual({ bed: 'city', era: 2 });
  });
});
