/**
 * [0.9.8 — brief 14] One icon set. Every material, upgrade and building icon is inline SVG drawn in code (48x48 grid,
 * shown at up to 64 px); kitIcon() passes each one through the same rules once, so the ~150 hand-drawn icons from
 * waves 4-0.9.7 read as one family (DIRECTION "Icons", the guide's 64 px spec):
 * - one warm ink outline (palette INK) instead of the old navy #1f2b46 / #2a3652;
 * - no near-black fills: anything darker than the ink is lifted and warmed toward it (coal, crude, graphite,
 *   charcoal, engines read as soft cocoa-slate, never a black hole on a cream card);
 * - eraBadge() adds a small era plate (roman numeral on the era's accent) in the bottom-right corner.
 * Results are cached, so icons cost nothing after the first use.
 */
import { CREAM, INK, lightness, mixHex } from '../render/palette';
import { eraAccent, inkOn } from './theme';

const css = (n: number): string => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

/** The icons' outline colour. */
export const ICON_INK = css(INK);

/** The old navy outline colours the kit replaces. */
const OLD_INKS = /#(1f2b46|2a3652)\b/gi;

/** Fills darker than this are lifted (the ink itself sits at ~0.19). */
const DARK = 0.2;

/** [PURE] A fill colour the kit allows: near-black and cold dark greys lift toward a warm, lighter cocoa slate. */
export function liftFill(c: number): number {
  const l = lightness(c);
  if (l >= DARK) return c;
  // mix toward a warm mid tone so the hue survives (dark green stays green, dark blue stays blue) but never black
  const warm = mixHex(INK, CREAM, 0.38);
  return mixHex(c, warm, Math.min(0.6, 0.25 + (DARK - l) * 2.4));
}

const cache = new Map<string, string>();

/** [PURE] The kit's pass over one SVG string (outline ink, lifted dark fills). */
export function kitIcon(svg: string): string {
  const hit = cache.get(svg);
  if (hit !== undefined) return hit;
  const out = svg.replace(OLD_INKS, ICON_INK).replace(/fill="#([0-9a-f]{6})"/gi, (m, hex: string) => {
    const c = parseInt(hex, 16);
    const lifted = liftFill(c);
    return lifted === c ? m : `fill="${css(lifted)}"`;
  });
  cache.set(svg, out);
  return out;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** The icon with a small era plate in its bottom-right corner (eras 2..10; era 1 has none). */
export function eraBadge(svg: string, era: number): string {
  if (!(era >= 2 && era <= 10)) return svg;
  const key = `${era}|${svg}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const label = ROMAN[era]!;
  const w = 7 + label.length * 5.2;
  const x = 47 - w;
  const accent = eraAccent(era);
  const plate =
    `<g class="wl-era-badge" aria-hidden="true">` +
    `<rect x="${x.toFixed(1)}" y="35" width="${w.toFixed(1)}" height="12" rx="6" fill="${css(accent)}" stroke="${css(CREAM)}" stroke-width="2"/>` +
    `<text x="${(x + w / 2).toFixed(1)}" y="44.2" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="700" font-size="9" fill="${css(inkOn(accent))}">${label}</text>` +
    `</g>`;
  const out = svg.replace(/<\/svg>\s*$/, `${plate}</svg>`);
  cache.set(key, out);
  return out;
}
