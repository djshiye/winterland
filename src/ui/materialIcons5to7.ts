/**
 * [items builder] 0.9.5: inline SVG icons for the new era 5–7 materials. Same style as ui/materialIcons.ts (48x48
 * viewBox, #1f2b46 outline, round caps); spread into its MATERIAL_ICONS.
 */
const OUT = '#1f2b46';
const svg = (inner: string): string => `<svg viewBox="0 0 48 48" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const g = (inner: string, w = 2.5): string => `<g stroke="${OUT}" stroke-width="${w}">${inner}</g>`;

export const ERA5_7_ICONS: Record<string, string> = {
  girder: svg(
    g(`<rect x="4" y="12" width="40" height="6" rx="1.5" fill="#97a2ae"/><rect x="4" y="30" width="40" height="6" rx="1.5" fill="#7f8b99"/>
       <rect x="20" y="18" width="8" height="12" fill="#5f6a76"/>
       <rect x="4" y="12" width="4" height="24" rx="1" fill="#e08a2b"/><rect x="40" y="12" width="4" height="24" rx="1" fill="#e08a2b"/>
       <circle cx="14" cy="15" r="1.4" fill="#d9e0e6" stroke-width="0"/><circle cx="24" cy="15" r="1.4" fill="#d9e0e6" stroke-width="0"/><circle cx="34" cy="15" r="1.4" fill="#d9e0e6" stroke-width="0"/>`),
  ),
  snowplow: svg(
    g(`<rect x="14" y="20" width="22" height="12" rx="2.5" fill="#485866"/><rect x="20" y="10" width="13" height="11" rx="2" fill="#5d6f7e"/>
       <rect x="22.5" y="12.5" width="8" height="5" rx="1" fill="#bfe3f2" stroke-width="1.8"/>
       <rect x="24.5" y="6" width="4" height="4" rx="1" fill="#ffc23d" stroke-width="1.8"/>
       <path d="M4 40c2-8 2-16 0-22l8 2c1 6 1 13 0 20z" fill="#e08a2b"/>
       <circle cx="20" cy="36" r="5" fill="#2d3033"/><circle cx="32" cy="36" r="5" fill="#2d3033"/>`),
  ),
  quartz: svg(
    g(`<path d="M8 42l4-14 6-8 4 12-2 10z" fill="#e4c2d6"/>
       <path d="M18 42l2-22 6-12 6 12 1 22z" fill="#eed3e2"/>
       <path d="M30 42l2-16 6-6 4 10-2 12z" fill="#dcb6cc"/>
       <path d="M26 8v34" stroke="#f9ecf3" stroke-width="2" fill="none"/>
       <path d="M6 42h36" fill="none"/>`),
  ),
  bulb: svg(
    g(`<circle cx="24" cy="18" r="12" fill="#fff1c4"/>
       <path d="M18 27c1 3 2 4 2 7h8c0-3 1-4 2-7" fill="#fff1c4"/>
       <rect x="19" y="34" width="10" height="3.5" rx="1.2" fill="#c9a14a"/><rect x="19.5" y="37.5" width="9" height="3.5" rx="1.2" fill="#a88437"/>
       <path d="M24 41v3" fill="none"/>
       <path d="M20 20l2-4 2 4 2-4 2 4" stroke="#ffb347" stroke-width="2" fill="none"/>
       <circle cx="19" cy="13" r="2.4" fill="#ffffff" stroke-width="0"/>`),
  ),
  radio: svg(
    g(`<path d="M6 40V20c0-8 8-12 18-12s18 4 18 12v20z" fill="#a8673c"/>
       <rect x="11" y="17" width="26" height="13" rx="3" fill="#f0e4cb"/>
       <path d="M13 21h22M13 25h22" stroke="#c9b48e" stroke-width="2" fill="none"/>
       <rect x="13" y="33" width="14" height="4" rx="1.2" fill="#ffe2a0" stroke-width="1.8"/>
       <circle cx="34" cy="35" r="2.6" fill="#5a3a20" stroke-width="1.8"/>`),
  ),
  gas: svg(
    g(`<rect x="13" y="14" width="22" height="28" rx="6" fill="#4f7fa8"/>
       <rect x="13" y="20" width="22" height="5" fill="#f2f2f2"/>
       <rect x="20" y="7" width="8" height="7" rx="2" fill="#c9a14a"/>
       <path d="M16 6h16" stroke-width="3" fill="none"/>
       <rect x="18" y="29" width="12" height="7" rx="1.5" fill="#d7e4ee" stroke-width="1.8"/>`),
  ),
  fuel: svg(
    g(`<path d="M8 14h28l4 4v24H8z" fill="#c44536"/>
       <path d="M12 18l20 20M32 18L12 38" stroke="#962f24" stroke-width="2.4" fill="none"/>
       <rect x="12" y="6" width="16" height="8" rx="2" fill="none" stroke-width="3"/>
       <rect x="34" y="8" width="6" height="7" rx="1.5" fill="#e2ad3c"/>`),
  ),
  snowmobile: svg(
    g(`<path d="M8 32l6-10h16l10 4 2 6z" fill="#d99b26"/>
       <path d="M18 22l4-8h6l-2 8" fill="#bfe3f2"/>
       <rect x="9" y="31" width="22" height="6" rx="2" fill="#2d3033"/>
       <path d="M30 40h14c1 0 2-1 2-3" fill="none" stroke-width="3"/>
       <path d="M36 32v8" fill="none"/>
       <rect x="8" y="27" width="34" height="3" rx="1" fill="#c44536" stroke-width="1.6"/>`),
  ),
};
