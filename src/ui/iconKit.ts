/**
 * [0.9.8 — brief 14] One icon set. Every material, upgrade and building icon is inline SVG drawn in code (48x48 grid,
 * shown at up to 64 px); kitIcon() passes each one through the same rules once, so the ~150 hand-drawn icons from
 * waves 4-0.9.7 read as one family (DIRECTION "Icons", the guide's 64 px spec):
 * - one warm ink outline (palette INK) instead of the old navy #1f2b46 / #2a3652;
 * - no near-black fills: anything darker than the ink is lifted and warmed toward it (coal, crude, graphite,
 *   charcoal, engines read as soft cocoa-slate, never a black hole on a cream card);
 * Results are cached, so icons cost nothing after the first use.
 */
import { CREAM, INK, lightness, mixHex } from '../render/palette';

const css = (n: number): string => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

/** The icons' outline colour. */
export const ICON_INK = css(INK);

/** The old navy outline colours the kit replaces. */
const OLD_INKS = /#(1f2b46|2a3652)\b/gi;

/** Fills darker than this are lifted (the ink itself sits at ~0.186 and stays as it is). */
const DARK = 0.18;

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
