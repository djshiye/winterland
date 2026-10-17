/**
 * 0.9.8 [17] A soft "snowy hall" reverb: a ConvolverNode with an impulse response generated in code (decaying stereo
 * noise that darkens as it fades, a short pre-delay). One per bus (music, ambience). `impulse` is pure for the tests.
 */
import { rng } from './instruments';

/** Stereo impulse response: `seconds` long, RT60 of `rt60`, the tail lowpassed from ~7 kHz down to ~1.5 kHz. */
export function impulse(sampleRate: number, seconds: number, rt60: number, seed = 7): [Float32Array, Float32Array] {
  const n = Math.max(1, Math.round(seconds * sampleRate));
  const pre = Math.round(0.018 * sampleRate);
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  out.forEach((ch, c) => {
    const r = rng(seed + c * 101);
    let y = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sampleRate;
      const env = Math.pow(10, (-3 * t) / rt60); // -60 dB at rt60
      // the tail darkens: the one-pole cutoff slides down as it decays
      const hz = 1500 + 5500 * Math.exp(-t / (rt60 * 0.25));
      const a = 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
      y += a * (r() * 2 - 1 - y);
      // a soft swell over the first 40 ms so there is no hard early slap
      ch[i] = y * env * Math.min(1, t / 0.04);
    }
    // fade the last 50 ms to zero
    const f = Math.min(n, Math.round(0.05 * sampleRate));
    for (let i = 0; i < f; i++) ch[n - 1 - i]! *= i / f;
  });
  // equal energy per channel
  for (const ch of out) {
    let e = 0;
    for (let i = 0; i < n; i++) e += ch[i]! * ch[i]!;
    const g = 1 / Math.sqrt(Math.max(1e-9, e));
    for (let i = 0; i < n; i++) ch[i]! *= g * 0.6;
  }
  return out;
}

/** A convolver with that impulse; returns null where the context can't make one. */
export function makeReverb(ac: BaseAudioContext, seconds: number, rt60: number): ConvolverNode | null {
  try {
    const conv = ac.createConvolver();
    conv.normalize = false;
    const [l, r] = impulse(ac.sampleRate, seconds, rt60);
    const buf = ac.createBuffer(2, l.length, ac.sampleRate);
    buf.getChannelData(0).set(l);
    buf.getChannelData(1).set(r);
    conv.buffer = buf;
    return conv;
  } catch {
    return null;
  }
}
