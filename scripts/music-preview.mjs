#!/usr/bin/env node
/**
 * 0.9.8 [17] Renders the era themes and ambient beds to audio files, so they can be heard and balanced without
 * playing the game, and prints their loudness.
 *
 *   node scripts/music-preview.mjs [--out dir] [--secs N] [--only music|ambience|mix|xfade] [--match regex] [--mp3]
 *   WL_CHROMIUM=/path/to/chrome node scripts/music-preview.mjs
 *
 * Starts a Vite dev server, opens headless Chromium and renders on an OfflineAudioContext with the game's own code
 * (fx/Music.ts, fx/Ambience.ts): every era theme by day and by night, every bed by day and by night, a mix of each
 * era's theme over its bed (what the player hears, through the game's master level), and one walk from era 3 into
 * era 4 to hear the crossfade. Writes 16-bit WAV files (and MP3s with --mp3, if ffmpeg is installed) and a
 * loudness.json: RMS and peak in dBFS, and the biggest jump of a 50 ms window over the second before it ("sudden").
 * Never touches a save: the page runs on a throwaway profile and only imports the audio modules.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const outDir = path.resolve(opt('--out', 'music-preview'));
const secs = Number(opt('--secs', '40')) || 40;
const only = opt('--only', '');
const mp3 = args.includes('--mp3');
const match = new RegExp(opt('--match', '.'));
const SR = 44100;

fs.mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${server.config.server.port}/`;
const browser = await chromium.launch({
  executablePath: process.env.WL_CHROMIUM || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(url + '@vite/client');

/**
 * Render one clip in the page. job: { kind: 'music' | 'ambience' | 'mix' | 'xfade', era, bed, night, secs }.
 * Returns interleaved-free [left, right] arrays as plain number arrays (base64 would be faster; this is a dev tool).
 */
async function render(job) {
  const data = await page.evaluate(async ({ job, SR }) => {
    const [{ Music }, { Ambience }] = await Promise.all([import('/src/fx/Music.ts'), import('/src/fx/Ambience.ts')]);
    const { eraBed } = await import('/src/fx/ambience/beds.ts');
    const ac = new OfflineAudioContext(2, Math.round(SR * job.secs), SR);
    // the game's master: compressor-free music path, MASTER_GAIN 0.5 (fx/Audio.ts)
    const master = ac.createGain();
    master.gain.value = 0.5;
    master.connect(ac.destination);
    const parts = [];
    if (job.kind === 'music' || job.kind === 'mix' || job.kind === 'xfade') {
      const m = new Music(ac, master);
      // past the gentle intro, so the clip (and its loudness) is the full arrangement
      if (!job.intro) m.startForm = 1;
      m.setEra(job.era);
      if (job.night) m.setNight(true);
      // start() fades in and sets its timer; the timer does nothing useful offline, the suspend loop schedules
      m.start();
      parts.push({ s: (t) => m.scheduleUntil(t), m });
    }
    if (job.kind === 'ambience' || job.kind === 'mix' || job.kind === 'xfade') {
      const a = new Ambience(ac, master, 12345);
      a.setBed(job.bed ?? eraBed(job.era));
      a.setDarkness(job.night ? 1 : 0);
      a.start();
      parts.push({ s: (t) => a.scheduleUntil(t), a });
    }
    // schedule as the real-time timer would: a little ahead, every half second of audio time
    const step = 0.5;
    for (let t = step; t < job.secs; t += step) {
      const at = t;
      ac.suspend(at).then(() => {
        for (const p of parts) p.s(at + 0.7);
        if (job.kind === 'xfade' && Math.abs(at - job.secs / 2) < 1e-6) {
          for (const p of parts) {
            p.m?.setEra(job.era + 1);
            p.a?.setBed(eraBed(job.era + 1));
          }
        }
        ac.resume();
      });
    }
    for (const p of parts) p.s(0.7);
    const buf = await ac.startRendering();
    const toB64 = (f32) => {
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
      let s = '';
      const u8 = new Uint8Array(i16.buffer);
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const l = buf.getChannelData(0);
    const r = buf.getChannelData(1);
    // loudness stats on the float data
    const n = l.length;
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const m = (l[i] + r[i]) / 2;
      sum += m * m;
      peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
    }
    const win = Math.round(SR * 0.05);
    const wins = [];
    for (let i = 0; i + win <= n; i += win) {
      let e = 0;
      for (let k = i; k < i + win; k++) {
        const m = (l[k] + r[k]) / 2;
        e += m * m;
      }
      wins.push(Math.sqrt(e / win));
    }
    let sudden = 0;
    for (let i = 60; i < wins.length; i++) {
      let prev = 0;
      for (let k = i - 20; k < i; k++) prev += wins[k];
      prev /= 20;
      if (prev > 1e-4) sudden = Math.max(sudden, wins[i] / prev);
    }
    const db = (x) => (x > 0 ? Math.round(2000 * Math.log10(x)) / 100 : -120);
    return { l: toB64(l), r: toB64(r), n, rms: db(Math.sqrt(sum / n)), peak: db(peak), sudden: Math.round(db(sudden) * 10) / 10 };
  }, { job, SR });
  return data;
}

function writeWav(file, lB64, rB64, n) {
  const L = new Int16Array(Buffer.from(lB64, 'base64').buffer.slice(0));
  const R = new Int16Array(Buffer.from(rB64, 'base64').buffer.slice(0));
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(L[i] ?? 0, 44 + i * 4);
    buf.writeInt16LE(R[i] ?? 0, 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

const jobs = [];
const BEDS = ['home', 'road', 'city'];
for (let era = 1; era <= 10; era++) {
  for (const night of [false, true]) {
    const tag = `${String(era).padStart(2, '0')}-${night ? 'night' : 'day'}`;
    if (!only || only === 'music') jobs.push({ name: `music-era${tag}`, kind: 'music', era, night, secs });
    if (!only || only === 'ambience') jobs.push({ name: `ambience-era${tag}`, kind: 'ambience', era, night, secs: Math.min(secs, 30) });
    if (!only || only === 'mix') jobs.push({ name: `mix-era${tag}`, kind: 'mix', era, night, secs });
  }
}
if (!only || only === 'ambience') {
  for (const bed of BEDS) for (const night of [false, true]) jobs.push({ name: `ambience-${bed}-${night ? 'night' : 'day'}`, kind: 'ambience', era: 1, bed, night, secs: Math.min(secs, 30) });
}
if (!only || only === 'xfade') jobs.push({ name: 'xfade-era3-to-era4', kind: 'xfade', era: 3, night: false, secs: 30 });

const report = {};
let hasFfmpeg = false;
if (mp3) {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    hasFfmpeg = true;
  } catch {
    console.warn('ffmpeg not found: writing WAV only');
  }
}
for (const job of jobs.filter((j) => match.test(j.name))) {
  const t0 = Date.now();
  const d = await render(job);
  const wav = path.join(outDir, `${job.name}.wav`);
  writeWav(wav, d.l, d.r, d.n);
  if (hasFfmpeg) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '4', wav.replace(/\.wav$/, '.mp3')]);
    fs.unlinkSync(wav);
  }
  report[job.name] = { rms: d.rms, peak: d.peak, sudden: d.sudden };
  console.log(`${job.name.padEnd(26)} rms ${String(d.rms).padStart(7)} dBFS  peak ${String(d.peak).padStart(7)}  sudden +${d.sudden} dB  (${Date.now() - t0} ms)`);
}
const prevFile = path.join(outDir, 'loudness.json');
let prev = {};
try {
  prev = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
} catch {
  /* first run */
}
fs.writeFileSync(prevFile, JSON.stringify({ ...prev, ...report }, null, 2));
await browser.close();
await server.close();
