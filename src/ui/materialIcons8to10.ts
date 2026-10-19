/**
 * [items builder] 0.9.5: inline SVG icons for the new era 8-10 materials. Same style as ui/materialIcons.ts (48x48
 * viewBox, warm ink outline (ui/iconKit.ts), round caps); spread into its MATERIAL_ICONS.
 */
import { ICON_INK } from './iconKit';

const OUT = ICON_INK;
const svg = (inner: string): string => `<svg viewBox="0 0 48 48" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const g = (inner: string, w = 2.5): string => `<g stroke="${OUT}" stroke-width="${w}">${inner}</g>`;

export const ERA8_10_ICONS: Record<string, string> = {
  gold: svg(
    g(`<path d="M7 36l4-10 9-5 8 3 6-4 8 7-1 9z" fill="#e8b341"/>
       <path d="M20 21l8 3-5 6-7-2z" fill="#f2cd6a"/><path d="M34 20l8 7-6 2-4-5z" fill="#b8862e"/>
       <path d="M14 30l3-2" stroke="#fff6d8" stroke-width="2.4" fill="none"/>`),
  ),
  board: svg(
    g(`<rect x="5" y="10" width="38" height="28" rx="3" fill="#3a7d5a"/>
       <rect x="10" y="15" width="10" height="10" rx="1.5" fill="#1b1c22"/><rect x="26" y="15" width="12" height="7" rx="1.5" fill="#1b1c22"/>
       <path d="M20 20h6M15 25v7h14M32 22v10" stroke="#e8c650" stroke-width="2" fill="none"/>
       <circle cx="29" cy="32" r="2" fill="#e8c650" stroke-width="1.4"/><circle cx="32" cy="32" r="2" fill="#e8c650" stroke-width="1.4"/>`),
  ),
  computer: svg(
    g(`<rect x="8" y="5" width="32" height="26" rx="3" fill="#e6dec8"/>
       <rect x="12" y="9" width="24" height="16" rx="2" fill="#45858c"/>
       <path d="M15 14h12M15 18h8" stroke="#bff0e2" stroke-width="2" fill="none"/>
       <rect x="5" y="34" width="38" height="9" rx="2" fill="#d4ccb5"/>
       <path d="M10 38h28" stroke-width="2" fill="none"/><circle cx="34" cy="28" r="1.4" fill="#7ce8a3" stroke-width="0"/>`),
  ),
  // 0.9.11: a bundle of pencil-lead rods (was a dark slab, too close to stone and coal)
  graphite: svg(
    g(`<path d="M8 14h28l6 4-6 4H8z" fill="#5a5960"/><path d="M8 24h28l6 4-6 4H8z" fill="#4a494e"/><path d="M8 34h28l6 4-6 4H8z" fill="#5a5960"/>
       <path d="M36 14v8M36 24v8M36 34v8" fill="none"/>
       <path d="M12 17h18M12 27h18M12 37h18" stroke="#b8b6c0" stroke-width="1.8" fill="none"/>`),
  ),
  battery: svg(
    g(`<rect x="9" y="10" width="30" height="33" rx="5" fill="#e8b341"/>
       <rect x="9" y="18" width="30" height="17" fill="#4ea885"/>
       <rect x="14" y="5" width="7" height="6" rx="2" fill="#dfe6ee"/><rect x="27" y="5" width="7" height="6" rx="2" fill="#dfe6ee"/>
       <path d="M18 26h5M20.5 23.5v5M27 26h4" stroke="#fffbef" stroke-width="2.2" fill="none"/>`),
  ),
  quantumCore: svg(
    g(`<circle cx="24" cy="24" r="18" fill="#526475"/>
       <ellipse cx="24" cy="24" rx="15" ry="6" fill="none" stroke="#e8a848" stroke-width="2.2" transform="rotate(30 24 24)"/>
       <ellipse cx="24" cy="24" rx="15" ry="6" fill="none" stroke="#e8a848" stroke-width="2.2" transform="rotate(-30 24 24)"/>
       <circle cx="24" cy="24" r="7" fill="#b9a6e0"/><circle cx="24" cy="24" r="3" fill="#fff0c8" stroke-width="1.4"/>`),
  ),
  // 0.9.7 era resources v2: era 10's rare earth (a cut-open geode, lavender crystals in a pale rind with gold flecks),
  // helium-3 (a chubby cream cryo flask with a peach window) and the fusion cell (a cream puck with a glowing ring on
  // top).
  rareEarth: svg(
    g(`<path d="M5 30c0-10 8-17 19-17s19 7 19 17l-3 10H8z" fill="#d8cfc0"/>
       <path d="M10 30c1-7 7-12 14-12s13 5 14 12z" fill="#8f78bd"/>
       <path d="M15 30l3-10 3 10M21 30l3-14 3 14M27 30l3-9 3 9" fill="#b9a0e0" stroke-width="2"/>
       <circle cx="24" cy="17" r="1.4" fill="#e8c46a" stroke-width="0"/><circle cx="31" cy="22" r="1.2" fill="#e8c46a" stroke-width="0"/>
       <path d="M6 34h36" stroke="#b4aa9a" stroke-width="2" fill="none"/>`),
  ),
  helium3: svg(
    g(`<rect x="11" y="13" width="26" height="29" rx="11" fill="#f5efe2"/>
       <rect x="18" y="5" width="12" height="9" rx="2.5" fill="#e8b341"/>
       <path d="M21 5h6" stroke="#526475" stroke-width="3" fill="none"/>
       <path d="M11 22h26M11 35h26" stroke="#e8b341" stroke-width="3" fill="none"/>
       <circle cx="24" cy="28.5" r="5" fill="#ffc69a" stroke-width="2"/><circle cx="22.5" cy="27" r="1.3" fill="#ffffff" stroke-width="0"/>`),
  ),
  fusionCell: svg(
    g(`<path d="M6 18v16c0 4 8 7 18 7s18-3 18-7V18z" fill="#f5f0e6"/>
       <path d="M6 30c0 4 8 7 18 7s18-3 18-7" fill="none" stroke="#f2b644" stroke-width="3"/>
       <ellipse cx="24" cy="18" rx="18" ry="7" fill="#e8b341"/>
       <ellipse cx="24" cy="18" rx="11" ry="4" fill="#526475" stroke-width="2"/>
       <ellipse cx="24" cy="18" rx="7" ry="2.4" fill="none" stroke="#fff0c8" stroke-width="2.4"/>`),
  ),
};
