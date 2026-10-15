/** [B4] Inline SVG icons (no image files). All use a 48x48 viewBox unless noted. */
import type { BusinessId, UpgradeIdConst } from '../config';

const svg = (inner: string, vb = '0 0 48 48'): string =>
  `<svg viewBox="${vb}" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const OUT = '#1f2b46';

const UPGRADE_ICONS: Record<UpgradeIdConst, string> = {
  // sales: a smooth plank with a gold star
  plankQuality: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="4" y="16" width="40" height="19" rx="4" fill="#e0b070"/>
      <path d="M4 25h40" stroke="#c98a4b" stroke-width="2.4" fill="none"/>
      <path d="M9 20h10M27 31h12" stroke="#f6dca8" stroke-width="2.2" fill="none"/>
      <path d="M34 4l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6-4.5-4.2 6.1-.8z" fill="#ffd84a"/>
    </g>`),
  // sales: a crate tied with a red ribbon and a star
  crateQuality: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="6" y="14" width="34" height="30" rx="4" fill="#d9aa66"/>
      <path d="M6 24h34M6 34h34" stroke="#a8693a" stroke-width="2.6" fill="none"/>
      <rect x="19" y="14" width="8" height="30" fill="#e8553e"/>
      <path d="M23 14c-4-8-11-6-9-2s9 2 9 2zM23 14c4-8 11-6 9-2s-9 2-9 2z" fill="#ff7a6b"/>
      <path d="M37 3l2.4 5 5.4.7-4 3.7 1 5.3-4.8-2.6-4.8 2.6 1-5.3-4-3.7 5.4-.7z" fill="#ffd84a"/>
    </g>`),
  // sales: a log end with a red "%" price tag
  bulkDeals: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="4" y="22" width="30" height="16" rx="8" fill="#a8693a"/>
      <circle cx="34" cy="30" r="8" fill="#f3d9a4"/><circle cx="34" cy="30" r="3.4" fill="#d9aa66"/>
      <rect x="6" y="9" width="22" height="14" rx="7" fill="#b87a45"/>
      <circle cx="28" cy="16" r="7" fill="#f3d9a4"/><circle cx="28" cy="16" r="3" fill="#d9aa66"/>
      <path d="M26 31h14l6 8-6 8H26a3 3 0 0 1-3-3V34a3 3 0 0 1 3-3z" fill="#e8553e"/>
      <circle cx="29" cy="39" r="2" fill="#fff" stroke-width="1.6"/>
    </g>
    <text x="36" y="43" text-anchor="middle" font-family="Fredoka, system-ui, sans-serif" font-weight="700" font-size="11" fill="#fff">%</text>`),
  // three stacked logs
  carry: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="6" y="26" width="26" height="11" rx="5.5" fill="#a8693a"/><circle cx="32" cy="31.5" r="5.5" fill="#f3d9a4"/><circle cx="32" cy="31.5" r="2.4" fill="#d9aa66"/>
      <rect x="14" y="14" width="26" height="11" rx="5.5" fill="#b87a45"/><circle cx="40" cy="19.5" r="5.5" fill="#f3d9a4"/><circle cx="40" cy="19.5" r="2.4" fill="#d9aa66"/>
      <rect x="8" y="38" width="26" height="7" rx="3.5" fill="#8f5530"/>
    </g>`),
  // winter boot
  speed: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M14 6h13v17c0 3 2 4 5 5l9 3c2 .7 3 2 3 4v4H9V6z" fill="#3fa7ff"/>
      <rect x="12" y="6" width="17" height="8" rx="3" fill="#ffffff"/>
      <path d="M9 38h35v4a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2z" fill="#f3f7ff"/>
    </g>
    <path d="M3 22h6M2 29h7M4 15h5" stroke="#9fd0ff" stroke-width="2.6"/>`),
  // axe
  axe: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M12 42L33 14" stroke-width="7" stroke="${OUT}"/>
      <path d="M12 42L33 14" stroke-width="3.6" stroke="#c98a4b"/>
      <path d="M26 8c8-3 15 0 17 7-5 4-11 6-17 4-3-1-5-3-6-5 1-3 3-5 6-6z" fill="#cfd8e6"/>
      <path d="M30 11c4-1 8 0 10 3" fill="none" stroke="#fff" stroke-width="2"/>
    </g>`),
  // machines (not shown in the shop, but handy for toasts)
  harvester: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="6" y="22" width="36" height="16" rx="5" fill="#3fa7ff"/>
      <circle cx="24" cy="18" r="9" fill="#e8eef7"/><circle cx="24" cy="18" r="3" fill="#7d8aa3"/>
      <rect x="4" y="38" width="40" height="6" rx="3" fill="#2a3652"/>
    </g>`),
  processor: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="4" y="14" width="40" height="24" rx="6" fill="#3fa7ff"/>
      <rect x="12" y="20" width="24" height="12" rx="4" fill="#1f2b46"/>
      <rect x="18" y="38" width="12" height="6" rx="2" fill="#d9aa66"/>
    </g>`),
  megaSaw: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <circle cx="24" cy="24" r="17" fill="#e8eef7"/>
      <circle cx="24" cy="24" r="6" fill="#ff7a6b"/>
      <path d="M24 3v6M24 39v6M3 24h6M39 24h6M9 9l4 4M35 35l4 4M39 9l-4 4M13 35l-4 4" stroke="#7d8aa3" stroke-width="3.5"/>
    </g>`),
  // wooden crate with motion lines
  crateRunner: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="14" y="12" width="28" height="28" rx="4" fill="#d9aa66"/>
      <path d="M14 22h28M14 31h28" stroke="#a8693a" stroke-width="3"/>
      <path d="M14 12l28 28M42 12L14 40" stroke="#a8693a" stroke-width="2.2"/>
    </g>
    <path d="M3 20h7M2 27h8M4 34h6" stroke="#9fd0ff" stroke-width="2.8"/>`),
  // cash bill + coin
  cashier: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="4" y="12" width="34" height="20" rx="4" fill="#46c35f"/>
      <circle cx="21" cy="22" r="6" fill="#f3fff0"/>
      <circle cx="35" cy="33" r="10" fill="#ffd84a"/>
      <circle cx="35" cy="33" r="6" fill="none" stroke="#e8a21c" stroke-width="2"/>
    </g>
    <text x="21" y="26" text-anchor="middle" font-family="Fredoka, system-ui, sans-serif" font-weight="700" font-size="10" fill="#2e9c48">$</text>`),
  // pickup truck with logs
  logHauler: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="3" y="20" width="24" height="14" rx="3" fill="#a8693a"/>
      <rect x="6" y="14" width="20" height="8" rx="4" fill="#b87a45"/>
      <path d="M27 24h8l7 6v8H27z" fill="#e8553e"/>
      <path d="M31 27h4l4 4h-8z" fill="#cdeeff" stroke-width="1.5"/>
      <circle cx="13" cy="38" r="5" fill="#2a3652"/><circle cx="35" cy="38" r="5" fill="#2a3652"/>
    </g>`),
  // wave 7: a pine toppling over a round saw blade
  treeFeller: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <g transform="rotate(24 26 40)">
        <rect x="23.5" y="30" width="5" height="12" rx="1.5" fill="#a8693a"/>
        <path d="M26 2l7 9h-3.6l6.6 9h-4.5l6.5 9H13.5l6.5-9h-4.5l6.6-9H19z" fill="#2e9c48"/>
        <path d="M26 7l3.4 4.4M26 18l5 6.6" stroke="#5ee07a" stroke-width="2" fill="none"/>
      </g>
      <circle cx="15" cy="37" r="10" fill="#e8eef7"/>
      <circle cx="15" cy="37" r="3.4" fill="#ff7a6b"/>
      <path d="M15 24.5v3.5M15 46v3M2.5 37h3.5M24 37h3.5M6.2 28.2l2.4 2.4M21.4 43.4l2.4 2.4M6.2 45.8l2.4-2.4M21.4 30.6l2.4-2.4" stroke="#7d8aa3" stroke-width="3"/>
    </g>`),
  // wave 7: a glass pneumatic tube carrying a banknote up, with a base
  cashTubes: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="7" y="4" width="16" height="36" rx="8" fill="#cdeeff"/>
      <rect x="27" y="4" width="16" height="36" rx="8" fill="#cdeeff"/>
      <rect x="10" y="12" width="10" height="7" rx="2" fill="#46c35f" stroke-width="2"/>
      <rect x="30" y="24" width="10" height="7" rx="2" fill="#46c35f" stroke-width="2"/>
      <rect x="4" y="38" width="40" height="8" rx="4" fill="#3fa7ff"/>
    </g>
    <path d="M15 33v-8M12 28l3-3.5 3 3.5M35 12v8M32 17l3 3.5 3-3.5" fill="none" stroke="#3fa7ff" stroke-width="2.6"/>
    <path d="M12.5 15.5h5M32.5 27.5h5" stroke="#f3fff0" stroke-width="2"/>`),
  // wave 7: a hand cart piled with pine logs, a pine standing on the load
  pineHauler: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="4" y="27" width="31" height="9" rx="4.5" fill="#a8693a"/><circle cx="35" cy="31.5" r="4.5" fill="#f3d9a4"/><circle cx="35" cy="31.5" r="1.8" fill="#d9aa66"/>
      <rect x="15" y="18" width="22" height="9" rx="4.5" fill="#b87a45"/><circle cx="37" cy="22.5" r="4.5" fill="#f3d9a4"/><circle cx="37" cy="22.5" r="1.8" fill="#d9aa66"/>
      <path d="M10 3l6 8h-3l5 7H2l5-7H4z" fill="#2e9c48" stroke-width="2.2"/>
      <path d="M2 36h38l-3 5H5z" fill="#8f5530"/>
      <path d="M40 34l6-11" stroke-width="3.5"/>
      <circle cx="14" cy="43" r="4.8" fill="#2a3652"/><circle cx="30" cy="43" r="4.8" fill="#2a3652"/>
    </g>`),
  // wave 9: a two-wheeled hand barrow carrying a wheat sack and a log, with a teal handle
  porter: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M12 21c0-5 3-8 7-8s7 3 7 8v9H12z" fill="#e9d6a1"/>
      <path d="M15 14.5l4-3.5 4 3.5" fill="#d9aa66" stroke-width="2.2"/>
      <path d="M19 20v8M16 22.5c2 1 4 1 6 0" stroke="#c99a3c" stroke-width="2" fill="none"/>
      <rect x="25" y="21" width="17" height="9" rx="4.5" fill="#a8693a"/><circle cx="42" cy="25.5" r="4.5" fill="#f3d9a4"/><circle cx="42" cy="25.5" r="1.8" fill="#d9aa66"/>
      <rect x="6" y="30" width="30" height="6" rx="3" fill="#8f5530"/>
      <path d="M36 33H46" stroke="#2f8f83" stroke-width="4"/>
      <circle cx="21" cy="40" r="6" fill="#2a3652"/><circle cx="21" cy="40" r="2" fill="#e0a526" stroke-width="1.6"/>
    </g>`),
  // sled loader: a wooden chair riding on a small sled with curled runners
  sledLoader: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M12 6h6v20h-6z" fill="#c98a4b"/>
      <path d="M12 6h6v7h-6z" fill="#e0b070" stroke-width="0"/>
      <rect x="11" y="24" width="24" height="6" rx="2.5" fill="#e0b070"/>
      <path d="M31 30v8M15 30v8" stroke="#a8693a" stroke-width="3.6" fill="none"/>
      <path d="M12 6h6v20h-6z" fill="none"/>
      <path d="M4 40h34c4 0 6-2 6-5" fill="none" stroke="#3fa7ff" stroke-width="4.5"/>
      <path d="M4 40h34c4 0 6-2 6-5" fill="none" stroke="#f3f7ff" stroke-width="1.8"/>
      <path d="M4 44h30" fill="none" stroke="#9fd0ff" stroke-width="2.4"/>
    </g>`),
  // foreman: a yellow hard hat, a rolled blueprint and a hammer
  foreman: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M29 44L39 19" stroke-width="7" fill="none"/>
      <path d="M29 44L39 19" stroke="#c98a4b" stroke-width="3.4" fill="none"/>
      <path d="M44.5 18.3L41.5 24.7 30.5 19.7 33.5 13.3z" fill="#cfd8e6"/>
      <rect x="6" y="35" width="21" height="9" rx="4.5" fill="#cfe6ff"/>
      <path d="M11 35v9" stroke-width="2" fill="none"/>
      <circle cx="9" cy="39.5" r="3.4" fill="#f1f6ff" stroke-width="2"/>
      <path d="M6 26a13 13 0 0 1 26 0v2H6z" fill="#ffd84a"/>
      <rect x="3" y="26" width="32" height="6" rx="3" fill="#f2b61f"/>
      <path d="M16 14v12M22 14v12" stroke="#f2b61f" stroke-width="2.4" fill="none"/>
    </g>`),
  // wave 13: a husky head (placeholder until the dog builder draws the real one)
  dog: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M12 16l8 4h8l8-4-2 14c0 6-5 10-10 10S10 36 10 30z" fill="#dfe6ee"/>
      <path d="M12 16l3 10 5-6zM36 16l-3 10-5-6z" fill="#8fa3b8"/>
      <circle cx="19" cy="25" r="2" fill="#2a3652"/><circle cx="29" cy="25" r="2" fill="#2a3652"/>
      <path d="M22 30h4l-2 3z" fill="#2a3652"/>
    </g>`),
  // wave 7: a signed rail contract with a pine and a gold seal
  pineContracts: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="8" y="3" width="30" height="38" rx="4" fill="#f6ecd2"/>
      <path d="M23 8l6 8h-3.4l4.4 6H16l4.4-6H17z" fill="#2e9c48" stroke-width="2"/>
      <rect x="21.5" y="22" width="3" height="4" fill="#a8693a" stroke-width="1.6"/>
      <path d="M13 30h20M13 35h12" stroke="#b79a64" stroke-width="2.4" fill="none"/>
      <path d="M4 44h40M10 41v5M20 41v5M30 41v5M40 41v5" stroke="#7d8aa3" stroke-width="2.4" fill="none"/>
      <circle cx="35" cy="33" r="7.5" fill="#ffd84a"/>
      <path d="M31.5 33l2.6 2.8 4.4-5" fill="none" stroke="#c97a10" stroke-width="2.6"/>
    </g>`),
  // wave 8: a log cabin workshop with a red roof, a chimney and a chair standing in front
  workshop: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="31" y="6" width="7" height="12" fill="#8f5530"/>
      <rect x="4" y="21" width="40" height="22" rx="3" fill="#d9aa66"/>
      <path d="M4 28h40M4 35h40" stroke="#a8693a" stroke-width="2.2" fill="none"/>
      <path d="M1 23L24 6l23 17z" fill="#e8553e"/>
      <rect x="31" y="27" width="9" height="9" rx="1.5" fill="#cdeeff" stroke-width="2"/>
      <rect x="4" y="43" width="40" height="3" rx="1.5" fill="#8f5530" stroke-width="2"/>
      <rect x="9" y="26" width="3.6" height="17" fill="#f6dca8" stroke-width="2"/>
      <rect x="9" y="33" width="15" height="4" rx="1.5" fill="#f6dca8" stroke-width="2"/>
      <rect x="20.4" y="37" width="3.6" height="6" fill="#f6dca8" stroke-width="2"/>
    </g>`),
  // wave 8: a joined wooden chair with a gold star
  furnitureQuality: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="9" y="6" width="5" height="38" rx="1.5" fill="#a8693a"/>
      <rect x="9" y="6" width="22" height="22" rx="3" fill="#d9aa66"/>
      <path d="M14 14h12M14 21h12" stroke="#a8693a" stroke-width="2.6" fill="none"/>
      <rect x="6" y="28" width="30" height="7" rx="3" fill="#e0b070"/>
      <rect x="29" y="35" width="5" height="10" rx="1.5" fill="#a8693a"/>
      <rect x="9" y="35" width="5" height="10" rx="1.5" fill="#a8693a"/>
      <path d="M36 3l2.9 6 6.5.9-4.7 4.5 1.2 6.4-5.9-3.1-5.9 3.1 1.2-6.4-4.7-4.5 6.5-.9z" fill="#ffd84a"/>
    </g>`),
};

export function upgradeIcon(id: UpgradeIdConst): string {
  return UPGRADE_ICONS[id];
}

export const ICON_LOCK = svg(
  `<rect x="9" y="21" width="30" height="21" rx="5" fill="#ffd84a" stroke="${OUT}" stroke-width="3"/>
   <path d="M15 21v-5a9 9 0 0 1 18 0v5" fill="none" stroke="${OUT}" stroke-width="4"/>
   <circle cx="24" cy="31" r="3.2" fill="${OUT}"/>`,
);

export const ICON_CLOSE = svg(`<path d="M12 12l24 24M36 12L12 36" stroke="#fff" stroke-width="7"/>`);

export const ICON_GEAR = svg(
  `<path fill="#fff" d="M24 4l3.2 4.4 5.4-1.2 1.6 5.3 5.4 1.4-.9 5.5L43 22.7l-3.8 4 2.2 5.2-4.8 2.8-.3 5.6-5.5-.4L27.4 44l-5-2.6-5 2.6-2.8-4.9-5.5.4-.3-5.6L4 31.9l2.2-5.2-3.8-4 3.9-3.3-.9-5.5 5.4-1.4 1.6-5.3 5.4 1.2z" transform="translate(0 -1) scale(.98) translate(.5 .5)"/>
   <circle cx="24" cy="24" r="7" fill="#2a3652"/>`,
);

export const ICON_HOUSE = svg(
  `<path d="M8 24L24 8l16 16v16a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" fill="#f3d9a4" stroke="${OUT}" stroke-width="3"/>
   <path d="M3 25L24 5l21 20" fill="none" stroke="#e8553e" stroke-width="6"/>
   <rect x="19" y="28" width="10" height="14" rx="2" fill="#a8693a" stroke="${OUT}" stroke-width="2.4"/>
   <rect x="31" y="14" width="6" height="9" fill="#a8693a" stroke="${OUT}" stroke-width="2.4"/>`,
);

export const ICON_PERSON = svg(
  `<circle cx="24" cy="14" r="8" fill="#fff"/>
   <path d="M8 42c0-10 7-16 16-16s16 6 16 16z" fill="#fff"/>`,
);

export const ICON_COIN = svg(
  `<circle cx="24" cy="24" r="19" fill="#ffd84a" stroke="${OUT}" stroke-width="3"/>
   <circle cx="24" cy="24" r="12" fill="none" stroke="#e8a21c" stroke-width="3"/>`,
);

export const ICON_STAR = svg(
  `<path d="M24 4l6.2 12.8 14 1.8-10.3 9.7 2.6 13.9L24 35.6 11.5 42.2l2.6-13.9L3.8 18.6l14-1.8z" fill="#ffd84a" stroke="${OUT}" stroke-width="3"/>`,
);

// --- wave 9: town buildings (build panel) -------------------------------------------------------------

const BUILDING_ICONS: Record<BusinessId, string> = {
  // a glass greenhouse with sprouting wheat
  farm: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M5 42V22L24 8l19 14v20z" fill="#cfeaf7"/>
      <path d="M5 22L24 8l19 14" fill="none" stroke="#e8553e" stroke-width="4"/>
      <path d="M16 42V24M24 42V20M32 42V24M5 32h38" stroke="#9fd0ff" stroke-width="2" fill="none"/>
      <path d="M24 42c0-6 0-9 0-13M24 36c-3-1-4-3-4-5 3 0 4 2 4 5zM24 33c3-1 4-3 4-5-3 0-4 2-4 5z" fill="#e0b050" stroke="#a8693a" stroke-width="1.6"/>
      <rect x="3" y="41" width="42" height="4" rx="2" fill="#a8693a"/>
    </g>`),
  // a cosy shop with an oven mouth and a loaf
  bakery: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="6" y="18" width="36" height="25" rx="3" fill="#f3d9a4"/>
      <path d="M3 18l4-9h34l4 9z" fill="#e8553e"/>
      <path d="M13 9l-2 9M24 9v9M35 9l2 9" stroke="#fff" stroke-width="2.4" fill="none"/>
      <path d="M11 43V30a6 6 0 0 1 12 0v13z" fill="#7a4a2a"/>
      <path d="M14 43V31a3 3 0 0 1 6 0v12z" fill="#ffb347" stroke="none"/>
      <ellipse cx="34" cy="31" rx="6.5" ry="4.2" fill="#d98e3b"/>
      <path d="M31 30l2 2M35 29l1.5 2.5" stroke="#f6c97a" stroke-width="1.8" fill="none"/>
      <rect x="35" y="2" width="6" height="9" fill="#a8693a"/>
    </g>`),
  // a tall townhouse with lit windows
  townhouse: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="9" y="16" width="30" height="28" rx="2" fill="#8fa9c9"/>
      <path d="M5 18L24 4l19 14z" fill="#b8453a"/>
      <rect x="14" y="21" width="8" height="8" rx="1.5" fill="#ffe680"/>
      <rect x="26" y="21" width="8" height="8" rx="1.5" fill="#ffe680"/>
      <rect x="14" y="33" width="8" height="7" rx="1.5" fill="#ffe680"/>
      <rect x="27" y="31" width="8" height="13" rx="2" fill="#7a4a2a"/>
      <rect x="31" y="6" width="5" height="8" fill="#a8693a"/>
    </g>`),
  // a red barn
  ranch: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M6 44V22L24 8l18 14v22z" fill="#c9503e"/>
      <path d="M17 44V28h14v16" fill="#fff"/>
      <path d="M17 28l14 16M31 28L17 44" stroke="#c9503e" stroke-width="2.4" fill="none"/>
      <path d="M3 24L24 6l21 18" fill="none" stroke="#7a4a2a" stroke-width="4"/>
      <circle cx="24" cy="19" r="3" fill="#fff"/>
    </g>`),
  // a shop with a ham
  butcher: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="6" y="19" width="36" height="24" rx="3" fill="#f1ece0"/>
      <path d="M3 19l4-9h34l4 9z" fill="#3b7bd6"/>
      <path d="M13 10l-2 9M24 10v9M35 10l2 9" stroke="#fff" stroke-width="2.4" fill="none"/>
      <path d="M15 33c0-6 5-9 10-8s9 4 7 9-9 7-14 5c-2-1-3-3-3-6z" fill="#e0707a"/>
      <circle cx="29" cy="30" r="2.2" fill="#fff"/>
    </g>`),
  // a toy factory with a gear and a train
  toyFactory: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="5" y="22" width="38" height="21" rx="2" fill="#7a8fa3"/>
      <path d="M5 22l9-8v8l9-8v8l9-8v8" fill="#7a8fa3"/>
      <rect x="34" y="6" width="6" height="16" fill="#a8693a"/>
      <circle cx="17" cy="32" r="6" fill="#ffd84a"/><circle cx="17" cy="32" r="2" fill="${OUT}" stroke="none"/>
      <rect x="27" y="29" width="12" height="9" rx="2" fill="#e8553e"/>
      <circle cx="30" cy="39" r="2" fill="#fff"/><circle cx="36" cy="39" r="2" fill="#fff"/>
    </g>`),
};

export function buildingIcon(id: BusinessId): string {
  return BUILDING_ICONS[id];
}

export const ICON_LOG = svg(
  `<g stroke="${OUT}" stroke-width="3">
     <rect x="5" y="14" width="30" height="20" rx="10" fill="#b87a45"/>
     <circle cx="35" cy="24" r="10" fill="#f3d9a4"/><circle cx="35" cy="24" r="4.2" fill="#d9aa66"/>
   </g>`,
);

/** A worker (dark, for the light cards). */
export const ICON_WORKER = svg(
  `<circle cx="24" cy="14" r="8" fill="#5b6a8a"/>
   <path d="M8 42c0-10 7-16 16-16s16 6 16 16z" fill="#5b6a8a"/>`,
);
