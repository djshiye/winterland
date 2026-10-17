/**
 * [0.9.8 — brief 14] The picture on each era's postcard (ui/AgeCard.ts), drawn in code as inline SVG (no image files).
 * One small snowy diorama per era, built around its main resource (R36) and the DIRECTION silhouette language:
 * eras 1-2 low and round, 3-5 tall stacks and gantries, 6-7 spires and cylinders, 8-10 soft boxes with floating crowns.
 * Colours come from the era's palette row (render/palette.ts); the outline is the icon kit's warm ink.
 *
 *  1 Survival   a log cabin, pines and a log pile          6 Electric    a copper coil tower and pylons with wires
 *  2 Frontier   a domed brick kiln and fieldstone            7 Oil         a pumpjack, a round tank and honey barrels
 *  3 Iron Age   a forge stack and an ore cart on rails       8 Computer    a satellite dish, a chip and solar panels
 *  4 Steam      a steam works with a puffing stack, coal     9 Nuclear     a cooling tower with steam and soft crystals
 *  5 Industrial a sawtooth mill, a gantry and pellet heaps  10 AI          a dome under a floating gold halo, a geode
 */
import { CREAM, SNOW, SNOW_SHADE, mixHex, palette } from '../render/palette';
import { MATERIALS } from '../eras/data';
import { ICON_INK, liftFill } from './iconKit';

const M = (k: keyof typeof MATERIALS): number => MATERIALS[k].color;
/** Era 7's honey barrels (DIRECTION: honey, never black). */
const HONEY = palette(7).floor.processing;
const MA = (k: keyof typeof MATERIALS): number => MATERIALS[k].accent;

const css = (n: number): string => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
/** A palette colour safe to fill with (never near-black). */
const f = (n: number): string => css(liftFill(n));
const W = 160;
const H = 92;
/** The horizon: ground starts here. */
const Y = 64;

/** Outlined group. */
const g = (inner: string, w = 2.2): string => `<g stroke="${ICON_INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;

/** A round snowy pine at (x, base y) of height h. */
function pine(x: number, y: number, h: number, green = 0x3f6b4f): string {
  const w = h * 0.62;
  return (
    `<path d="M${x} ${y - h}l${w / 2} ${h * 0.82}h${-w}z" fill="${css(green)}"/>` +
    `<path d="M${x} ${y - h}l${w * 0.22} ${h * 0.36}c${-w * 0.14} ${h * 0.06} ${-w * 0.3} ${h * 0.06} ${-w * 0.44} 0z" fill="${css(SNOW)}"/>` +
    `<rect x="${x - 2}" y="${y - h * 0.18}" width="4" height="${h * 0.18}" rx="1" fill="${css(0x7a4e32)}"/>`
  );
}

/** A puff of steam / smoke made of three soft circles. */
function puff(x: number, y: number, k = 1, tint = SNOW): string {
  const c = css(tint);
  return `<g stroke-width="1.6"><circle cx="${x}" cy="${y}" r="${5 * k}" fill="${c}"/><circle cx="${x + 6 * k}" cy="${y - 5 * k}" r="${6.5 * k}" fill="${c}"/><circle cx="${x + 14 * k}" cy="${y - 8 * k}" r="${5 * k}" fill="${c}"/></g>`;
}

/** The era's picture frame: sky, far snowy hills, the era's ground. */
function frame(n: number, scene: string): string {
  const p = palette(n);
  const id = `wl-pc-${n}`;
  const skyTop = mixHex(p.accent, SNOW, 0.62);
  const skyLow = mixHex(CREAM, p.glow, 0.18);
  const ground = p.floor.yard;
  return (
    `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true" preserveAspectRatio="xMidYMid slice">` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${css(skyTop)}"/><stop offset="1" stop-color="${css(skyLow)}"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#${id})"/>` +
    // a low sun, the far hills in snow shade, the near snowbank
    `<circle cx="128" cy="24" r="11" fill="${css(mixHex(p.glow, CREAM, 0.45))}" opacity="0.9"/>` +
    `<path d="M0 ${Y - 6}c22-14 40-14 58-4s38 8 56-2 34-8 46 0V${H}H0z" fill="${css(SNOW_SHADE)}"/>` +
    `<path d="M0 ${Y}c30-6 60-5 90-1s50 3 70-1V${H}H0z" fill="${css(SNOW)}"/>` +
    `<path d="M0 ${Y + 10}c40-5 80-4 120 0s30 2 40 1V${H}H0z" fill="${css(ground)}" opacity="0.92"/>` +
    g(scene) +
    // a snowflake or two for the snow-globe feel
    `<g fill="${css(SNOW)}" opacity="0.9"><circle cx="18" cy="16" r="1.6"/><circle cx="54" cy="9" r="1.2"/><circle cx="96" cy="14" r="1.4"/><circle cx="150" cy="44" r="1.3"/><circle cx="8" cy="40" r="1.1"/></g>` +
    `</svg>`
  );
}

const SCENES: Record<number, () => string> = {
  // Survival: the forest and the log
  1: () => {
    const p = palette(1);
    return (
      pine(18, 70, 30) + pine(34, 66, 22) + pine(146, 70, 28) +
      // the cabin
      `<rect x="58" y="44" width="40" height="24" rx="2" fill="${f(p.body)}"/>` +
      `<path d="M58 51h40M58 58h40" fill="none" stroke-width="1.4"/>` +
      `<path d="M52 46l26-18 26 18z" fill="${f(p.accent)}"/>` +
      `<path d="M52 46l26-18 26 18c-6 2-12-2-16 1-4-3-10 1-14-1-4 2-10-2-14 1-3-1-5 0-8-1z" fill="${css(SNOW)}" stroke-width="1.4"/>` +
      `<rect x="72" y="54" width="10" height="14" rx="2" fill="${f(p.trim)}"/>` +
      `<rect x="86" y="50" width="8" height="7" rx="1.5" fill="${css(p.glow)}"/>` +
      `<rect x="88" y="30" width="6" height="10" fill="${f(p.fence)}"/>` +
      puff(91, 24, 0.8) +
      // the log pile
      `<g><rect x="106" y="62" width="26" height="8" rx="4" fill="${f(p.coat)}"/><circle cx="132" cy="66" r="4" fill="${css(0xf3d9a4)}"/>` +
      `<rect x="110" y="55" width="20" height="8" rx="4" fill="${f(p.body)}"/><circle cx="130" cy="59" r="4" fill="${css(0xf3d9a4)}"/></g>`
    );
  },
  // Frontier: stone and clay, a domed brick kiln
  2: () => {
    const p = palette(2);
    return (
      pine(16, 68, 24, 0x5f7f68) + pine(150, 70, 26, 0x5f7f68) +
      `<path d="M50 70V52a22 22 0 0 1 44 0v18z" fill="${f(p.accent)}"/>` +
      `<path d="M58 44h28M54 52h36M52 60h40" fill="none" stroke-width="1.3" opacity="0.6"/>` +
      `<path d="M64 70v-8a8 8 0 0 1 16 0v8z" fill="${css(p.glow)}"/>` +
      `<path d="M50 50a22 22 0 0 1 44 0c-8-3-14 1-22-1-8 2-14-2-22 1z" fill="${css(SNOW)}" stroke-width="1.4"/>` +
      `<rect x="84" y="24" width="8" height="16" fill="${f(p.coat)}"/>` +
      puff(88, 18, 0.8) +
      // fieldstone blocks and a clay heap
      `<rect x="104" y="58" width="16" height="12" rx="3" fill="${f(p.body)}"/><rect x="120" y="62" width="14" height="9" rx="3" fill="${css(mixHex(p.body, SNOW, 0.25))}"/>` +
      `<rect x="110" y="50" width="14" height="9" rx="3" fill="${css(mixHex(p.body, SNOW, 0.15))}"/>` +
      `<path d="M22 72c2-8 8-11 14-11s12 3 14 11z" fill="${css(M('clay'))}"/>`
    );
  },
  // Iron Age: ore, a forge stack and an ore cart on rails
  3: () => {
    const p = palette(3);
    return (
      pine(150, 68, 24, 0x52705e) +
      `<rect x="46" y="38" width="30" height="32" rx="3" fill="${f(p.body)}"/>` +
      `<rect x="54" y="16" width="12" height="24" fill="${f(p.fence)}"/>` +
      `<path d="M54 18h12" stroke-width="3" stroke="${css(SNOW)}"/>` +
      `<path d="M54 70v-10a7 7 0 0 1 14 0v10z" fill="${css(p.glow)}"/>` +
      `<path d="M44 40h34" stroke-width="4" stroke="${css(SNOW)}"/>` +
      puff(60, 10, 0.75) +
      // ore mound
      `<path d="M84 70c2-10 10-16 18-16s14 6 16 16z" fill="${f(p.coat)}"/>` +
      `<circle cx="96" cy="62" r="2.4" fill="${css(MA('ore'))}" stroke-width="1"/><circle cx="106" cy="58" r="2" fill="${css(MA('ore'))}" stroke-width="1"/>` +
      // rails and an ore cart
      `<path d="M4 78h152M4 84h152" fill="none" stroke-width="1.8"/>` +
      `<path d="M14 66h30l-4 10H18z" fill="${f(p.accent)}"/><circle cx="22" cy="78" r="3" fill="${css(SNOW)}"/><circle cx="36" cy="78" r="3" fill="${css(SNOW)}"/>` +
      `<path d="M18 66c2-5 6-6 10-5s8 0 12 5z" fill="${f(p.coat)}"/>`
    );
  },
  // Steam: coal and a steam works with a puffing stack
  4: () => {
    const p = palette(4);
    return (
      `<rect x="40" y="40" width="54" height="30" rx="3" fill="${f(p.body)}"/>` +
      `<path d="M36 42l15-10h32l15 10z" fill="${f(p.coat)}"/>` +
      `<path d="M36 42l15-10h32l15 10c-10 2-20-2-31 0s-21-2-31 0z" fill="${css(SNOW)}" stroke-width="1.4"/>` +
      `<rect x="46" y="50" width="9" height="9" rx="2" fill="${css(p.glow)}"/><rect x="62" y="50" width="9" height="9" rx="2" fill="${css(p.glow)}"/><rect x="78" y="50" width="9" height="9" rx="2" fill="${css(p.glow)}"/>` +
      `<rect x="98" y="14" width="12" height="56" rx="2" fill="${f(p.accent)}"/><path d="M98 24h12M98 34h12" stroke-width="1.4"/>` +
      puff(104, 8, 1) +
      // a big wheel of the engine and the coal heap
      `<circle cx="28" cy="62" r="10" fill="${f(p.trim)}"/><circle cx="28" cy="62" r="4" fill="${css(p.accent)}"/>` +
      `<path d="M116 72c2-8 8-12 14-12s12 4 14 12z" fill="${f(MA('coal'))}"/><circle cx="126" cy="66" r="1.6" fill="${css(SNOW)}" stroke="none"/>`
    );
  },
  // Industrial: iron pellets and coke, a sawtooth mill and a gantry crane
  5: () => {
    const p = palette(5);
    return (
      `<path d="M30 70V44l12-8v8l12-8v8l12-8v8l12-8v34z" fill="${f(p.floor.yard)}"/>` +
      `<path d="M42 36v8M54 36v8M66 36v8M78 36v8" fill="none" stroke-width="1.4"/>` +
      `<rect x="36" y="52" width="8" height="8" rx="1.5" fill="${css(p.glow)}"/><rect x="50" y="52" width="8" height="8" rx="1.5" fill="${css(p.glow)}"/><rect x="64" y="52" width="8" height="8" rx="1.5" fill="${css(p.glow)}"/>` +
      // gantry crane
      `<path d="M92 72V26M128 72V26M88 26h44" fill="none" stroke="${f(p.accent)}" stroke-width="4"/>` +
      `<path d="M92 72V26M128 72V26M88 26h44" fill="none" stroke-width="1.2"/>` +
      `<path d="M112 26v14" stroke-width="1.6"/><rect x="106" y="40" width="12" height="7" rx="2" fill="${f(p.trim)}"/>` +
      // pellet heap and coke glow
      `<path d="M96 72c3-9 8-13 14-13s11 4 14 13z" fill="${css(M('pellets'))}"/>` +
      `<g stroke-width="1"><circle cx="104" cy="66" r="2" fill="${css(mixHex(M('pellets'), SNOW, 0.2))}"/><circle cx="112" cy="63" r="2" fill="${css(mixHex(M('pellets'), SNOW, 0.2))}"/><circle cx="118" cy="68" r="2" fill="${css(mixHex(M('pellets'), SNOW, 0.2))}"/></g>` +
      `<rect x="136" y="56" width="18" height="16" rx="3" fill="${css(M('coke'))}"/><rect x="140" y="62" width="10" height="6" rx="2" fill="${css(MA('coke'))}"/>`
    );
  },
  // Electric: copper, a coil tower and pylons with wires
  6: () => {
    const p = palette(6);
    const cu = M('copper');
    return (
      // pylons and wires
      `<path d="M14 72l6-34 6 34M16 50h8M10 40h20" fill="none" stroke-width="2"/>` +
      `<path d="M132 72l6-34 6 34M134 50h8M128 40h20" fill="none" stroke-width="2"/>` +
      `<path d="M30 40c30 14 70 14 98 0" fill="none" stroke-width="1.4"/>` +
      `<g stroke-width="1"><circle cx="58" cy="47" r="2.4" fill="${css(p.glow)}"/><circle cx="80" cy="49" r="2.4" fill="${css(p.glow)}"/><circle cx="102" cy="47" r="2.4" fill="${css(p.glow)}"/></g>` +
      // the copper coil tower
      `<rect x="68" y="56" width="24" height="16" rx="3" fill="${f(p.body)}"/>` +
      `<rect x="74" y="28" width="12" height="30" rx="3" fill="${css(cu)}"/>` +
      `<path d="M74 34h12M74 40h12M74 46h12M74 52h12" fill="none" stroke="${css(MA('copper'))}" stroke-width="1.6"/>` +
      `<circle cx="80" cy="22" r="9" fill="${css(mixHex(p.glow, SNOW, 0.35))}"/>` +
      `<path d="M66 16l-5-4M94 16l5-4M80 10V5" fill="none" stroke="${css(p.glow)}" stroke-width="2.2"/>`
    );
  },
  // Oil: crude, a pumpjack, a round tank and honey barrels
  7: () => {
    const p = palette(7);
    return (
      // round tank
      `<rect x="98" y="40" width="40" height="32" rx="6" fill="${f(p.body)}"/>` +
      `<path d="M98 46c10 4 30 4 40 0" fill="none" stroke-width="1.4"/><path d="M98 42c10-6 30-6 40 0" fill="${css(SNOW)}" stroke-width="1.4"/>` +
      `<path d="M136 30v-8" stroke-width="2"/><circle cx="136" cy="18" r="4" fill="${css(p.glow)}"/>` +
      // pumpjack
      `<path d="M36 72l10-30 10 30z" fill="${f(p.accent)}"/>` +
      `<path d="M20 38l52-8" stroke-width="5" stroke="${f(p.trim)}"/><path d="M20 38l52-8" fill="none" stroke-width="1.2"/>` +
      `<path d="M14 34c0-6 10-6 10 2v10h-10z" fill="${f(p.trim)}"/>` +
      `<circle cx="46" cy="36" r="3" fill="${css(SNOW)}"/><path d="M18 48v24" stroke-width="2"/>` +
      // honey barrels
      `<rect x="70" y="58" width="11" height="14" rx="3" fill="${css(HONEY)}"/><rect x="83" y="58" width="11" height="14" rx="3" fill="${css(HONEY)}"/>` +
      `<path d="M70 63h11M83 63h11" fill="none" stroke-width="1.2"/>` +
      `<path d="M73 52c1-3 3-5 3-5s2 2 3 5a3 3 0 0 1-6 0z" fill="${css(HONEY)}" stroke-width="1.4"/>`
    );
  },
  // Computer: silicon, a satellite dish, solar panels and a chip
  8: () => {
    const p = palette(8);
    return (
      // clean room block
      `<rect x="56" y="44" width="48" height="28" rx="6" fill="${f(p.body)}"/>` +
      `<rect x="62" y="52" width="36" height="8" rx="3" fill="${css(p.glow)}"/>` +
      `<path d="M56 48c12-6 36-6 48 0" fill="${css(SNOW)}" stroke-width="1.4"/>` +
      // satellite dish
      `<path d="M30 72l6-18 6 18z" fill="${f(p.trim)}"/>` +
      `<path d="M20 40a18 18 0 0 0 30 14z" fill="${css(SNOW)}"/><path d="M35 47l8-10" stroke-width="1.8"/><circle cx="44" cy="36" r="2.4" fill="${css(p.accent)}"/>` +
      // solar panels
      `<path d="M112 70l6-14h28l-6 14z" fill="${css(mixHex(p.accent, SNOW, 0.1))}"/><path d="M122 56l-6 14M132 56l-6 14M114 63h30" fill="none" stroke-width="1.1"/>` +
      // a microchip floating over the roof
      `<rect x="72" y="20" width="16" height="16" rx="3" fill="${css(M('chip'))}"/><rect x="76" y="24" width="8" height="8" rx="1.5" fill="${css(MA('chip'))}" stroke-width="1.2"/>` +
      `<path d="M70 24h-3M70 28h-3M70 32h-3M90 24h3M90 28h3M90 32h3M76 18v-3M80 18v-3M84 18v-3" fill="none" stroke-width="1.4"/>`
    );
  },
  // Nuclear: uranium, a cooling tower with steam and rounded crystals
  9: () => {
    const p = palette(9);
    return (
      `<path d="M52 72c4-14 4-28-2-42h40c-6 14-6 28-2 42z" fill="${f(p.body)}"/>` +
      `<path d="M50 30h40" stroke-width="2.2"/><path d="M53 40c10 3 24 3 34 0" fill="none" stroke-width="1.2" opacity="0.6"/>` +
      `<path d="M58 60h24" stroke="${f(p.accent)}" stroke-width="3"/>` +
      puff(60, 22, 1.1) +
      // aqua pool and soft crystals
      `<ellipse cx="124" cy="72" rx="22" ry="5" fill="${css(p.glow)}"/>` +
      `<path d="M110 66l4-12 5 4 2-8 6 8 4-4 3 12z" fill="${css(M('uranium'))}"/>` +
      `<path d="M114 54l5 4 2-8" fill="none" stroke="${css(SNOW)}" stroke-width="1.2" opacity="0.8"/>` +
      `<rect x="16" y="54" width="20" height="18" rx="5" fill="${f(p.coat)}"/><rect x="21" y="59" width="10" height="7" rx="2" fill="${css(p.glow)}"/>`
    );
  },
  // AI: rare earths and helium-3 fusion, a dome under a floating gold halo
  10: () => {
    const p = palette(10);
    return (
      `<path d="M46 72V58a34 22 0 0 1 68 0v14z" fill="${f(p.body)}"/>` +
      `<path d="M58 52l22-6 22 6M64 62h32" fill="none" stroke="${css(p.accent)}" stroke-width="1.6"/>` +
      `<path d="M72 72v-8a8 8 0 0 1 16 0v8z" fill="${css(p.glow)}"/>` +
      // the floating halo with a fusion glow
      `<circle cx="80" cy="26" r="9" fill="${css(mixHex(p.glow, CREAM, 0.3))}" stroke="none" opacity="0.9"/>` +
      `<ellipse cx="80" cy="26" rx="20" ry="6" fill="none" stroke="${css(p.accent)}" stroke-width="4"/>` +
      `<ellipse cx="80" cy="26" rx="20" ry="6" fill="none" stroke-width="1.2"/>` +
      // a lavender geode and a helium-3 flask
      `<path d="M120 72c0-10 6-16 12-16s12 6 12 16z" fill="${css(M('rareEarth'))}"/><path d="M126 70c0-5 3-8 6-8s6 3 6 8z" fill="${css(MA('rareEarth'))}" stroke-width="1.2"/>` +
      `<path d="M20 72c-2-8 2-12 6-14v-6h6v6c4 2 8 6 6 14z" fill="${css(M('helium3'))}"/><circle cx="29" cy="66" r="3" fill="${css(MA('helium3'))}" stroke-width="1"/>`
    );
  },
};

const cache = new Map<number, string>();

/** The postcard picture for era n (1..10). */
export function eraPostcard(n: number): string {
  const k = Math.max(1, Math.min(10, Math.round(n)));
  let svg = cache.get(k);
  if (!svg) {
    svg = frame(k, SCENES[k]!());
    cache.set(k, svg);
  }
  return svg;
}
