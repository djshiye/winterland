/**
 * [0.9.7 — Comfort] WCAG contrast helpers for the era colours (the colour-blind / low-vision check, READINESS D8).
 * Era accents are the eras' identity colours (eras/data.ts, part of the art); where one is used as text or a thin
 * ring on a dark card, `readableOn` lightens it just enough to read. Every era is also named by its numeral and
 * place name, so colour is never the only cue (tests/eraContrast.test.ts checks both).
 */

const channel = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance of a 0xRRGGBB colour. */
export function luminance(n: number): number {
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio of two 0xRRGGBB colours (1..21). */
export function contrast(a: number, b: number): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `n` mixed toward white by t (0..1). */
export function tint(n: number, t: number): number {
  const ch = (v: number): number => Math.round(v + (255 - v) * t);
  return (ch((n >> 16) & 255) << 16) | (ch((n >> 8) & 255) << 8) | ch(n & 255);
}

/** The colour itself when it reads on `bg` at `min`:1, else the least-lightened tint of it that does. */
export function readableOn(n: number, bg: number, min = 3): number {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = tint(n, Math.min(1, t));
    if (contrast(c, bg) >= min) return c;
  }
  return 0xffffff;
}
