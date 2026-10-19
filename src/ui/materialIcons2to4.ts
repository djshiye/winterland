/**
 * [items builder] 0.9.5: inline SVG icons for the new era 2-4 materials. Same style as ui/materialIcons.ts (48x48
 * viewBox, warm ink outline (ui/iconKit.ts), round caps); spread into its MATERIAL_ICONS.
 */
import { ICON_INK } from './iconKit';

const OUT = ICON_INK;
const svg = (inner: string): string => `<svg viewBox="0 0 48 48" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const g = (inner: string, w = 2.5): string => `<g stroke="${OUT}" stroke-width="${w}">${inner}</g>`;

export const ERA2_4_ICONS: Record<string, string> = {
  // 0.9.11: a wooden pail heaped with wet clay (was a red dome, too close to the roof tiles at tag size)
  clay: svg(
    g(`<path d="M9 22h30l-4 20H13z" fill="#a0703f"/>
       <path d="M10.5 28h27M12 36h24" stroke="#5d6268" stroke-width="2.4" fill="none"/>
       <path d="M8 23c1-8 7-13 16-13s15 5 16 13z" fill="#c26a4a"/>
       <path d="M15 16c3-2 6-3 9-3" stroke="#e0a07c" stroke-width="2.4" fill="none"/>`),
  ),
  // 0.9.11: a little roof of scalloped tiles under a ridge (was three red domes)
  roofTile: svg(
    g(`<path d="M4 38L14 12h20l10 26z" fill="#c0583a"/>
       <path d="M8 29c3 3 6 3 8 0 2 3 6 3 8 0 2 3 6 3 8 0 2 3 6 3 8 0M11 21c2 3 5 3 7 0 2 3 5 3 6 0 2 3 5 3 7 0 2 3 5 3 6 0" stroke="#7d3322" stroke-width="2" fill="none"/>
       <path d="M12 12h24" stroke="#e8c9a8" stroke-width="4" fill="none"/>`),
  ),
  hearth: svg(
    g(`<rect x="8" y="12" width="32" height="28" rx="2" fill="#a7a39b"/>
       <rect x="6" y="9" width="36" height="5" rx="1.5" fill="#c4c0b8"/><rect x="28" y="3" width="7" height="7" fill="#8a857c"/>
       <path d="M15 40V26a9 9 0 0 1 18 0v14z" fill="#b5543c"/><path d="M18 40V27a6 6 0 0 1 12 0v13z" fill="#3a2a24"/>
       <path d="M20 39c0-4 2-6 4-9 2 3 4 5 4 9z" fill="#ffa040" stroke-width="1.6"/>`),
  ),
  // 0.9.11: three charred sticks with glowing ends (was a black lump, too close to coal)
  charcoal: svg(
    g(`<rect x="5" y="28" width="30" height="10" rx="5" fill="#3a3330"/>
       <rect x="13" y="16" width="30" height="10" rx="5" fill="#46403b"/>
       <rect x="9" y="5" width="26" height="10" rx="5" fill="#3a3330" transform="rotate(8 22 10)"/>
       <circle cx="35" cy="33" r="3.2" fill="#ff8a3a" stroke-width="1.6"/><circle cx="41" cy="21" r="3.2" fill="#ffb060" stroke-width="1.6"/>`),
  ),
  tools: svg(
    g(`<path d="M10 40L36 12" stroke-width="5" stroke="#1f2b46"/><path d="M10 40L36 12" stroke-width="2.5" stroke="#9a6a42"/>
       <path d="M24 8c6 0 12 3 16 8l-4 1c-3-3-7-5-12-5z" fill="#8d949c"/>
       <path d="M38 40L14 14" stroke-width="5" stroke="#1f2b46"/><path d="M38 40L14 14" stroke-width="2.5" stroke="#b07a4c"/>
       <rect x="6" y="7" width="12" height="9" rx="1.5" fill="#8d949c" transform="rotate(-42 12 11.5)"/>`),
  ),
  rail: svg(
    g(`<rect x="6" y="30" width="8" height="10" rx="1" fill="#5c4028"/><rect x="34" y="30" width="8" height="10" rx="1" fill="#5c4028"/>
       <path d="M4 30h40v-4H30v-8h4v-6H14v6h4v8H4z" fill="#7a8088"/>
       <path d="M15 14h18" stroke="#dfe6ee" stroke-width="2" fill="none"/>`),
  ),
  scrap: svg(
    g(`<path d="M6 38l3-12 9-4 6 4 8-6 8 6 2 12z" fill="#8a7a6a"/>
       <circle cx="19" cy="30" r="5" fill="#a89888"/><circle cx="19" cy="30" r="1.8" fill="#5a4e44" stroke-width="0"/>
       <path d="M28 22l8 10" stroke="#c0763a" stroke-width="3" fill="none"/><rect x="30" y="31" width="8" height="5" fill="#a89888"/>`),
  ),
  boiler: svg(
    g(`<rect x="11" y="14" width="26" height="28" rx="5" fill="#9e4737"/>
       <path d="M11 18a13 8 0 0 1 26 0z" fill="#b8584a"/><rect x="28" y="5" width="5" height="10" fill="#383d40"/>
       <rect x="10" y="22" width="28" height="4" fill="#d49a35"/><rect x="10" y="34" width="28" height="4" fill="#d49a35"/>
       <circle cx="24" cy="30" r="4" fill="#f2ead8" stroke-width="2"/>`),
  ),
  steamEngine: svg(
    g(`<rect x="4" y="36" width="40" height="6" rx="1.5" fill="#6a7074"/>
       <rect x="6" y="22" width="16" height="12" rx="3" fill="#383d40"/><rect x="9" y="8" width="5" height="14" fill="#383d40"/>
       <circle cx="32" cy="24" r="11" fill="#d49a35"/><circle cx="32" cy="24" r="7" fill="#383d40"/><circle cx="32" cy="24" r="2.5" fill="#d49a35"/>
       <path d="M22 28l10-4" stroke-width="2" fill="none"/>`),
  ),
};
