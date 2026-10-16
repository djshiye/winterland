/**
 * [items builder] 0.9.5: inline SVG icons for the new era 8-10 materials. Same style as ui/materialIcons.ts (48x48
 * viewBox, #1f2b46 outline, round caps); spread into its MATERIAL_ICONS.
 */
const OUT = '#1f2b46';
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
  graphite: svg(
    g(`<path d="M6 34l4-14 12-6 14 3 6 11-2 10z" fill="#4a494e"/>
       <path d="M10 20l12-6 14 3-12 5z" fill="#6e6c73"/>
       <path d="M24 22l12-5 6 11-14 2z" fill="#3b3a3e"/>
       <path d="M14 27l7-2" stroke="#b8b6c0" stroke-width="2" fill="none"/>`),
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
  // 0.9.6: era 10's own raw material: a cluster of glowing data shards with a little circuit trace inside
  dataShard: svg(
    g(`<path d="M17 41l-5-15 6-17 7 16-2 16z" fill="#8fd3ff"/>
       <path d="M27 41l2-20 7-12 5 15-6 17z" fill="#c9a8ff"/>
       <path d="M20 41l3-11 4 11z" fill="#bfe8ff"/>
       <path d="M17 18v9l3 3M33 17v8l-3 3" stroke="#ffffff" stroke-width="1.8" fill="none"/>`),
  ),
};
