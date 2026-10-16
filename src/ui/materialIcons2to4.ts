/**
 * [items builder] 0.9.5: inline SVG icons for the new era 2-4 materials. Same style as ui/materialIcons.ts (48x48
 * viewBox, #1f2b46 outline, round caps); spread into its MATERIAL_ICONS.
 */
const OUT = '#1f2b46';
const svg = (inner: string): string => `<svg viewBox="0 0 48 48" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const g = (inner: string, w = 2.5): string => `<g stroke="${OUT}" stroke-width="${w}">${inner}</g>`;

export const ERA2_4_ICONS: Record<string, string> = {
  clay: svg(
    g(`<path d="M6 36c0-9 6-16 18-16s18 7 18 16z" fill="#c26a4a"/>
       <path d="M13 26c3-3 7-4 11-4" stroke="#e0a07c" stroke-width="2.4" fill="none"/>
       <path d="M8 36h32" fill="none"/><circle cx="31" cy="29" r="2" fill="#e0a07c" stroke-width="0"/>`),
  ),
  roofTile: svg(
    g(`<path d="M5 34c0-6 4-10 9-10s9 4 9 10z" fill="#c0583a"/><path d="M25 34c0-6 4-10 9-10s9 4 9 10z" fill="#c0583a"/>
       <path d="M15 22c0-6 4-10 9-10s9 4 9 10z" fill="#d46a48"/>
       <path d="M5 38h38" stroke="#e8c9a8" stroke-width="3" fill="none"/>`),
  ),
  hearth: svg(
    g(`<rect x="8" y="12" width="32" height="28" rx="2" fill="#a7a39b"/>
       <rect x="6" y="9" width="36" height="5" rx="1.5" fill="#c4c0b8"/><rect x="28" y="3" width="7" height="7" fill="#8a857c"/>
       <path d="M15 40V26a9 9 0 0 1 18 0v14z" fill="#b5543c"/><path d="M18 40V27a6 6 0 0 1 12 0v13z" fill="#3a2a24"/>
       <path d="M20 39c0-4 2-6 4-9 2 3 4 5 4 9z" fill="#ffa040" stroke-width="1.6"/>`),
  ),
  charcoal: svg(
    g(`<path d="M5 36l4-12 9-5 9 3 9-2 7 8 1 8z" fill="#3a3330"/>
       <path d="M18 19l9 3-6 6-8-3z" fill="#54493f"/>
       <path d="M14 30l4-2 3 3" stroke="#d8703a" stroke-width="2" fill="none"/><path d="M28 28l5-2" stroke="#d8703a" stroke-width="2" fill="none"/>`),
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
