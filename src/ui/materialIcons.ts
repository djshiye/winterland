/**
 * [items builder] 0.9.0 inline SVG icons (no image files) for every ItemKind: the eighteen era materials plus sensible
 * versions of the Survival goods, and their labels. Same style as ui/icons.ts (48x48 viewBox, warm ink outline (ui/iconKit.ts), round
 * caps). Used by the market panel, the choose panel and anywhere an item kind needs a picture or a name.
 */
import { MATERIALS, isMaterial } from '../eras/data';
import type { ItemKind } from '../core/types';
import { ERA2_4_ICONS } from './materialIcons2to4';
import { ERA5_7_ICONS } from './materialIcons5to7';
import { ERA8_10_ICONS } from './materialIcons8to10';
import { ICON_INK, kitIcon } from './iconKit';

const OUT = ICON_INK;

const svg = (inner: string): string => `<svg viewBox="0 0 48 48" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
/** Outlined group: every shape below sits in one with a 2.5 stroke. */
const g = (inner: string, w = 2.5): string => `<g stroke="${OUT}" stroke-width="${w}">${inner}</g>`;

/** Gear outline path (n teeth) around (cx, cy). */
function gearPath(cx: number, cy: number, rIn: number, rOut: number, n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const s = (Math.PI * 2) / n;
    for (const [da, r] of [[-0.28, rIn], [-0.16, rOut], [0.16, rOut], [0.28, rIn]] as const) {
      const t = a + da * s * 1.8;
      pts.push(`${(cx + Math.cos(t) * r).toFixed(1)} ${(cy + Math.sin(t) * r).toFixed(1)}`);
    }
  }
  return `M${pts.join('L')}z`;
}

const MATERIAL_ICONS: Record<string, string> = {
  stone: svg(
    g(`<path d="M6 36l3-16 10-8 14 2 9 10 1 12z" fill="#a7a39b"/>
       <path d="M9 20l10-8 14 2-6 8z" fill="#c4c0b8"/>
       <path d="M27 22l15 2 1 12H6l21-4z" fill="#8a857c"/>
       <path d="M14 30l8-3" stroke-width="2" fill="none"/>`),
  ),
  brick: svg(
    g(`<rect x="5" y="26" width="38" height="14" rx="2" fill="#d9cfc0"/>
       <rect x="6" y="28" width="17" height="10" rx="1.5" fill="#b5543c"/><rect x="25" y="28" width="17" height="10" rx="1.5" fill="#b5543c"/>
       <rect x="5" y="9" width="38" height="14" rx="2" fill="#d9cfc0"/>
       <rect x="6" y="11" width="9" height="10" rx="1.5" fill="#c4634a"/><rect x="17" y="11" width="17" height="10" rx="1.5" fill="#b5543c"/><rect x="36" y="11" width="6" height="10" rx="1.5" fill="#c4634a"/>`),
  ),
  ore: svg(
    g(`<path d="M6 36l2-12 8-10 12-2 11 8 3 16z" fill="#7c5a4a"/>
       <path d="M16 14l12-2 4 6-8 4-8-2z" fill="#9a6e58"/>
       <path d="M24 26l6-4 5 4-4 6z" fill="#e3a070"/><path d="M12 28l4-3 3 3-3 4z" fill="#e3a070"/>`),
  ),
  iron: svg(
    g(`<path d="M5 34l6-14h26l6 14z" fill="#8d949c"/>
       <path d="M11 20h26l2 5H9z" fill="#c4cad1"/>
       <rect x="5" y="34" width="38" height="6" rx="1.5" fill="#5d6268"/>
       <path d="M18 27h12" stroke-width="2" fill="none"/>`),
  ),
  coal: svg(
    g(`<path d="M5 36l4-13 9-6 9 4 9-3 7 9 1 9z" fill="#2c2b2e"/>
       <path d="M18 17l9 4-6 6-8-3z" fill="#4a484d"/>
       <path d="M30 18l9-3 5 9-8 4z" fill="#3a393d"/>
       <path d="M21 21l3 1" stroke="#fff" stroke-width="2.4" fill="none"/>`),
  ),
  gear: svg(
    g(`<path d="${gearPath(24, 24, 14, 20, 9)}" fill="#b08a3e"/><circle cx="24" cy="24" r="10" fill="#6f5a2c"/><circle cx="24" cy="24" r="4.5" fill="#e0c37a"/>`),
  ),
  steel: svg(
    g(`<rect x="4" y="9" width="40" height="9" rx="2" fill="#a0acba"/>
       <rect x="4" y="30" width="40" height="9" rx="2" fill="#7f8b99"/>
       <rect x="19" y="17" width="10" height="14" fill="#4b5562"/>
       <path d="M9 13h30" stroke="#dfe6ee" stroke-width="2" fill="none"/>
       <circle cx="10" cy="34.5" r="1.4" fill="#dfe6ee" stroke-width="0"/><circle cx="24" cy="34.5" r="1.4" fill="#dfe6ee" stroke-width="0"/><circle cx="38" cy="34.5" r="1.4" fill="#dfe6ee" stroke-width="0"/>`),
  ),
  copper: svg(
    g(`<path d="M6 36l2-12 8-10 12-2 11 8 3 16z" fill="#c9773a"/>
       <path d="M16 14l12-2 4 6-8 4-8-2z" fill="#e3935a"/>
       <path d="M24 26l6-4 5 4-4 6z" fill="#5fc9a4"/><path d="M12 28l4-3 3 3-3 4z" fill="#5fc9a4"/>`),
  ),
  wire: svg(
    g(`<ellipse cx="24" cy="38" rx="16" ry="5" fill="#5a3a20"/>
       <rect x="8" y="14" width="32" height="24" fill="#d88a45" stroke-width="0"/>
       <path d="M8 14v24M40 14v24" fill="none"/>
       <ellipse cx="24" cy="14" rx="16" ry="5" fill="#5a3a20"/>
       <ellipse cx="24" cy="14" rx="5" ry="1.8" fill="#2a1a0c" stroke-width="1.6"/>
       <path d="M10 22c10 4 18 4 28 0M10 30c10 4 18 4 28 0" fill="none" stroke="#8f4f25"/>
       <path d="M34 36c4 2 7 0 8-4" fill="none" stroke="#e3935a" stroke-width="3"/>`),
  ),
  crude: svg(
    g(`<rect x="12" y="6" width="24" height="36" rx="5" fill="#2a2d33"/>
       <rect x="12" y="13" width="24" height="7" fill="#e0b03a"/><rect x="12" y="29" width="24" height="7" fill="#e0b03a"/>
       <path d="M13 6h22" stroke="#5a606b" stroke-width="3" fill="none"/>
       <circle cx="30" cy="9.5" r="1.8" fill="#e0b03a" stroke-width="1.4"/>
       <path d="M8 30c3 3 3 7 0 8-3-1-3-5 0-8z" fill="#2a2d33" stroke-width="1.8"/>`),
  ),
  // 0.9.11: a tied sack of plastic pellets (was a bowl of balls, like uranium and iron pellets apart from colour)
  plastic: svg(
    g(`<path d="M14 16l-3 6c-4 8-3 18 13 18s17-10 13-18l-3-6z" fill="#e9f0f6"/>
       <path d="M17 8l7 6 7-6" fill="none"/><path d="M14 16h20" stroke-width="3" fill="none"/>
       <circle cx="18" cy="27" r="3.2" fill="#4fb3e8" stroke-width="1.6"/><circle cx="26" cy="31" r="3.2" fill="#f2c14e" stroke-width="1.6"/>
       <circle cx="31" cy="24" r="3.2" fill="#e8665a" stroke-width="1.6"/><circle cx="21" cy="35" r="2.6" fill="#7cc28a" stroke-width="1.6"/>`),
  ),
  // 0.9.11: a round silicon wafer ruled into dies (was a crystal, the same shape as quartz)
  silicon: svg(
    g(`<path d="M24 5a19 19 0 1 1-12 4.3L15 13h18l3-3.7A19 19 0 0 0 24 5z" fill="#8fa3c8"/>
       <circle cx="24" cy="24" r="19" fill="#8fa3c8"/>
       <path d="M16 6.8h16" stroke-width="3" fill="none"/>
       <path d="M10 18h28M8 24h32M10 30h28M17 9v30M24 6v36M31 9v30" stroke="#5f7298" stroke-width="1.6" fill="none"/>
       <path d="M14 13c3-3 6-4 10-4" stroke="#dce6f6" stroke-width="2.4" fill="none"/>`),
  ),
  chip: svg(
    g(`<rect x="10" y="10" width="28" height="28" rx="3" fill="#2f6f4e"/>
       <rect x="17" y="17" width="14" height="14" rx="1.5" fill="#1b1c22"/>
       <path d="M15 6v4M22 6v4M29 6v4M36 6v4M15 38v4M22 38v4M29 38v4M36 38v4M6 15h4M6 22h4M6 29h4M6 36h4M38 15h4M38 22h4M38 29h4M38 36h4" stroke="#e8c650" stroke-width="3" fill="none"/>
       <circle cx="19.5" cy="19.5" r="1.6" fill="#e8c650" stroke-width="0"/>`),
  ),
  // 0.9.11: a lead canister with the radiation trefoil (was a bowl of glowing balls, like plastic and iron pellets)
  uranium: svg(
    g(`<rect x="11" y="8" width="26" height="34" rx="5" fill="#6b6f78"/><rect x="9" y="6" width="30" height="6" rx="2" fill="#8a8f99"/>
       <circle cx="24" cy="26" r="9" fill="#f2d24e"/>
       <path d="M24 26l-4.5-7.8a9 9 0 0 1 9 0zM24 26l9 0a9 9 0 0 1-4.5 7.8zM24 26l-4.5 7.8a9 9 0 0 1-4.5-7.8z" fill="#2a2a2e" stroke-width="0"/>
       <circle cx="24" cy="26" r="2" fill="#f2d24e" stroke-width="1.2"/>`),
  ),
  fuelRod: svg(
    g(`<rect x="6" y="10" width="36" height="9" rx="4.5" fill="#8fdcb4"/><rect x="6" y="10" width="7" height="9" rx="3" fill="#5a6470"/><rect x="35" y="10" width="7" height="9" rx="3" fill="#5a6470"/>
       <rect x="6" y="29" width="36" height="9" rx="4.5" fill="#8fdcb4"/><rect x="6" y="29" width="7" height="9" rx="3" fill="#5a6470"/><rect x="35" y="29" width="7" height="9" rx="3" fill="#5a6470"/>
       <path d="M16 13h18M16 32h18" stroke="#d4f7e6" stroke-width="2" fill="none"/>
       <rect x="21" y="6" width="6" height="36" rx="2" fill="#5a6470"/>`),
  ),
  power: svg(
    g(`<rect x="13" y="9" width="22" height="34" rx="5" fill="#3d5259"/>
       <rect x="13" y="19" width="22" height="14" fill="#70f5d9"/>
       <rect x="19" y="4" width="10" height="6" rx="2" fill="#dfe6ee"/>
       <path d="M26 20l-6 8h5l-3 8 8-10h-5z" fill="#fffbef" stroke-width="1.6"/>`),
  ),
  aiCore: svg(
    g(`<path d="M24 5l17 8v22l-17 8-17-8V13z" fill="#526475"/>
       <path d="M24 5l17 8-17 8-17-8z" fill="#6f8296"/>
       <path d="M24 13l9 4v10l-9 4-9-4V17z" fill="#e8a848"/>
       <path d="M24 17l4 2v6l-4 2-4-2v-6z" fill="#ffe9b8" stroke-width="1.6"/>
       <path d="M24 31v12" fill="none"/>`),
  ),
  robot: svg(
    g(`<rect x="12" y="6" width="24" height="17" rx="4" fill="#f5f0e6"/>
       <rect x="15" y="11" width="18" height="7" rx="2" fill="#526475"/>
       <rect x="18" y="13" width="4" height="3" fill="#ffe082" stroke-width="0"/><rect x="26" y="13" width="4" height="3" fill="#ffe082" stroke-width="0"/>
       <path d="M24 6V2" fill="none"/><circle cx="24" cy="2.5" r="1.6" fill="#e8a848" stroke-width="1.4"/>
       <rect x="14" y="25" width="20" height="14" rx="3" fill="#f5f0e6"/>
       <rect x="19" y="28" width="10" height="6" rx="1.5" fill="#e8a848"/>
       <rect x="6" y="26" width="6" height="11" rx="2" fill="#d8cfbd"/><rect x="36" y="26" width="6" height="11" rx="2" fill="#d8cfbd"/>
       <rect x="15" y="39" width="7" height="6" rx="2" fill="#e8a848"/><rect x="26" y="39" width="7" height="6" rx="2" fill="#e8a848"/>`),
  ),
  ...ERA2_4_ICONS,
  ...ERA5_7_ICONS,
  ...ERA8_10_ICONS,
};

/** Survival goods (Era 1) and cash, in the same style. */
const SURVIVAL_ICONS: Record<string, string> = {
  log: svg(
    g(`<rect x="5" y="14" width="30" height="20" rx="10" fill="#b87a45"/>
       <circle cx="35" cy="24" r="10" fill="#f3d9a4"/><circle cx="35" cy="24" r="4.2" fill="#d9aa66"/>`, 3),
  ),
  plank: svg(
    g(`<rect x="5" y="9" width="38" height="8" rx="2" fill="#e0b070"/><rect x="5" y="19" width="38" height="8" rx="2" fill="#d9a35f"/><rect x="5" y="29" width="38" height="8" rx="2" fill="#e0b070"/>
       <rect x="12" y="7" width="5" height="32" rx="1.5" fill="#8a5a36"/><rect x="31" y="7" width="5" height="32" rx="1.5" fill="#8a5a36"/>`),
  ),
  crate: svg(
    g(`<rect x="6" y="6" width="36" height="36" rx="4" fill="#d9aa66"/>
       <rect x="9" y="9" width="30" height="30" fill="none" stroke="#a8693a" stroke-width="3.5"/>
       <path d="M10 10l28 28M38 10L10 38" stroke="#a8693a" stroke-width="3" fill="none"/>`),
  ),
  furniture: svg(
    g(`<rect x="12" y="5" width="6" height="36" rx="2" fill="#8f5530"/><rect x="30" y="5" width="6" height="36" rx="2" fill="#8f5530"/>
       <rect x="12" y="9" width="24" height="5" fill="#e0b070"/><rect x="12" y="17" width="24" height="5" fill="#e0b070"/>
       <rect x="8" y="26" width="32" height="7" rx="2" fill="#d9453d"/>
       <rect x="9" y="33" width="5" height="10" rx="2" fill="#8f5530"/><rect x="34" y="33" width="5" height="10" rx="2" fill="#8f5530"/>`),
  ),
  wheat: svg(
    g(`<path d="M10 40c-3-10 0-18 6-22h16c6 4 9 12 6 22z" fill="#cfa66a"/>
       <rect x="16" y="14" width="16" height="5" rx="2" fill="#7a4a2a"/>
       <path d="M20 14c-2-5-1-8 1-10M24 14V3M28 14c2-5 1-8-1-10" fill="none" stroke="#d9a441" stroke-width="3"/>
       <rect x="18" y="26" width="12" height="7" rx="1.5" fill="#4fa64f" stroke-width="1.8"/>`),
  ),
  bread: svg(
    g(`<ellipse cx="24" cy="30" rx="19" ry="12" fill="#d9954b"/>
       <path d="M13 26l5-5M22 24l5-5M31 26l5-5" stroke="#f4d08a" stroke-width="3.2" fill="none"/>`),
  ),
  meat: svg(
    g(`<ellipse cx="22" cy="26" rx="15" ry="12" fill="#d9707a"/>
       <ellipse cx="18" cy="21" rx="8" ry="5" fill="#f2c9c4" stroke-width="0"/>
       <rect x="33" y="22" width="11" height="6" rx="3" fill="#f5ecd9"/>
       <circle cx="44" cy="22" r="3" fill="#f5ecd9" stroke-width="1.8"/><circle cx="44" cy="28" r="3" fill="#f5ecd9" stroke-width="1.8"/>
       <rect x="26" y="14" width="6" height="24" fill="#f0e4cc" stroke-width="1.8"/><rect x="27.5" y="14" width="3" height="24" fill="#d2413a" stroke-width="0"/>`),
  ),
  sausage: svg(
    g(`<path d="M8 32c0-12 8-20 16-20s16 8 16 20" fill="none" stroke="${OUT}" stroke-width="13"/>
       <path d="M8 32c0-12 8-20 16-20s16 8 16 20" fill="none" stroke="#a5503a" stroke-width="9"/>
       <path d="M16 36c0-6 3-9 8-9s8 3 8 9" fill="none" stroke="${OUT}" stroke-width="11"/>
       <path d="M16 36c0-6 3-9 8-9s8 3 8 9" fill="none" stroke="#7a3528" stroke-width="7"/>
       <path d="M14 18l5 4M34 18l-5 4" stroke="#e6d8b0" stroke-width="2.4" fill="none"/>`, 0.001),
  ),
  toy: svg(
    g(`<rect x="22" y="14" width="18" height="22" rx="3" fill="#d8432f"/>
       <rect x="8" y="22" width="20" height="14" rx="4" fill="#3f86c8"/>
       <rect x="11" y="10" width="6" height="12" fill="#2a2a2e"/>
       <rect x="26" y="18" width="9" height="8" fill="#fff0b0" stroke-width="1.8"/>
       <circle cx="14" cy="38" r="5" fill="#f2c23a"/><circle cx="26" cy="38" r="5" fill="#f2c23a"/><circle cx="36" cy="38" r="5" fill="#f2c23a"/>`),
  ),
  cash: svg(
    g(`<rect x="4" y="12" width="40" height="24" rx="5" fill="#3dae5a"/>
       <rect x="19" y="12" width="10" height="24" fill="#e9f7ea"/>
       <circle cx="24" cy="24" r="5" fill="#2b7a42" stroke-width="2"/>`),
  ),
};

/** Inline SVG (48x48 viewBox) for any item kind: era materials, Survival goods and cash. */
export function materialIcon(kind: ItemKind): string {
  return kitIcon(MATERIAL_ICONS[kind] ?? SURVIVAL_ICONS[kind] ?? svg(g(`<rect x="8" y="10" width="32" height="28" rx="6" fill="#c9c9d4"/>`)));
}

const SURVIVAL_LABELS: Record<string, string> = {
  log: 'Logs',
  plank: 'Planks',
  crate: 'Crates',
  cash: 'Cash',
  furniture: 'Furniture',
  wheat: 'Wheat',
  bread: 'Bread',
  meat: 'Meat',
  sausage: 'Sausages',
  toy: 'Toys',
};

/** Plural display name of an item kind ("Stone", "Logs", "Crates", "Fuel Rods"). */
export function materialLabel(kind: ItemKind): string {
  if (isMaterial(kind)) return MATERIALS[kind].label;
  return SURVIVAL_LABELS[kind] ?? kind;
}
