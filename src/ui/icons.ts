/** [B4] Inline SVG icons (no image files). All use a 48x48 viewBox unless noted. */
import { ERA_ROLES, type BusinessId, type UpgradeIdConst } from '../config';
import { ERAS, MACHINES, MACHINE_IDS, MATERIALS, MATERIAL_KINDS } from '../eras/data';
import { ICON_INK, kitIcon } from './iconKit';
import { CREAM } from '../render/palette';

const svg = (inner: string, vb = '0 0 48 48'): string =>
  `<svg viewBox="${vb}" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const OUT = ICON_INK;

/** 0.9.0: era / finance upgrades may be missing here: upgradeIcon() falls back to a generic icon. */
const UPGRADE_ICONS: Partial<Record<UpgradeIdConst, string>> = {
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
  // 0.9.2 sales: a cargo tricycle with a crate stack (Tricycle Dock)
  trikeDock: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="16" y="8" width="14" height="10" rx="2" fill="#d9aa66"/>
      <rect x="14" y="18" width="18" height="10" rx="2" fill="#e0b070"/>
      <path d="M10 30h28l-3 6H13z" fill="#3fa9c9"/>
      <circle cx="11" cy="39" r="5" fill="#f3f6fb"/><circle cx="37" cy="39" r="5" fill="#f3f6fb"/>
      <path d="M38 30l4-10" fill="none"/>
    </g>`),
  // 0.9.2 sales: a pickup truck with logs in the bed (Truck Dock)
  truckDock: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="4" y="22" width="26" height="12" rx="2" fill="#e2453c"/>
      <path d="M30 34V20h8l6 8v6z" fill="#e2453c"/>
      <path d="M33 22h4l4 5h-8z" fill="#bfe6ff"/>
      <rect x="6" y="15" width="22" height="7" rx="3.5" fill="#a8693a"/>
      <circle cx="12" cy="37" r="5" fill="#f3f6fb"/><circle cx="36" cy="37" r="5" fill="#f3f6fb"/>
    </g>`),
  // 0.9.2 sales: a shop counter with a plank stack and an awning (Shop Counter)
  shopDock: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M6 16l4-8h28l4 8z" fill="#e8553e"/>
      <path d="M14 8l-2 8M24 8v8M34 8l2 8" fill="none"/>
      <rect x="8" y="28" width="32" height="12" rx="2" fill="#a8693a"/>
      <rect x="13" y="21" width="22" height="4" rx="1.5" fill="#f0c98a"/>
      <rect x="15" y="25" width="18" height="3" rx="1.5" fill="#e0b070"/>
    </g>`),
  // 0.9.2 sales: a dog sled with a chair on it (Sled Dock)
  sledDock: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M6 36h32c4 0 6-3 6-6" fill="none"/>
      <rect x="10" y="26" width="24" height="7" rx="2" fill="#d9483b"/>
      <path d="M17 26V12h10v8h-6v6" fill="#c98a4b"/>
      <path d="M14 33v3M30 33v3" fill="none"/>
    </g>`),
  // 0.9.2 sales: a flatcar on rails with pine logs (Rail Platform)
  railDock: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M4 42h40" fill="none"/>
      <rect x="6" y="28" width="36" height="7" rx="1.5" fill="#5a6b7d"/>
      <rect x="9" y="16" width="30" height="6" rx="3" fill="#a8693a"/>
      <rect x="11" y="22" width="26" height="6" rx="3" fill="#b9774a"/>
      <circle cx="13" cy="38" r="4" fill="#f3f6fb"/><circle cx="35" cy="38" r="4" fill="#f3f6fb"/>
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
      <rect x="4" y="38" width="40" height="6" rx="3" fill="${OUT}"/>
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
      <circle cx="13" cy="38" r="5" fill="${OUT}"/><circle cx="35" cy="38" r="5" fill="${OUT}"/>
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
      <circle cx="14" cy="43" r="4.8" fill="${OUT}"/><circle cx="30" cy="43" r="4.8" fill="${OUT}"/>
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
      <circle cx="21" cy="40" r="6" fill="${OUT}"/><circle cx="21" cy="40" r="2" fill="#e0a526" stroke-width="1.6"/>
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
  // wave 13: a husky head with a grey cap, white face mask, blue eyes, a pink tongue and a red scarf
  dog: svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M8 24L6 5l13 8zM40 24l2-19-13 8z" fill="#7d8ea3"/>
      <path d="M10.5 19.5L9.5 10l6 3.8zM37.5 19.5l1-9.5-6 3.8z" fill="#f3b3b0" stroke="none"/>
      <path d="M24 10c11 0 18 7 18 16 0 9-8 15-18 15S6 35 6 26c0-9 7-16 18-16z" fill="#8c9db2"/>
      <path d="M24 17c3 6 3 9 9 9 2 4 1 9-3 12-2 2-4 2-6 2s-4 0-6-2c-4-3-5-8-3-12 6 0 6-3 9-9z" fill="#f4f7fa" stroke="none"/>
      <path d="M24 10c11 0 18 7 18 16 0 9-8 15-18 15S6 35 6 26c0-9 7-16 18-16z" fill="none"/>
      <circle cx="16.5" cy="24" r="2.6" fill="#8bd3ff" stroke-width="1.8"/><circle cx="31.5" cy="24" r="2.6" fill="#8bd3ff" stroke-width="1.8"/>
      <circle cx="16.5" cy="24" r="1" fill="#1f2b46" stroke="none"/><circle cx="31.5" cy="24" r="1" fill="#1f2b46" stroke="none"/>
      <path d="M20.5 30.5h7l-3.5 4z" fill="${OUT}" stroke-width="1.8"/>
      <path d="M24 34.5v2.5M20 37c1.6 1.4 2.8 1.6 4 0 1.2 1.6 2.4 1.4 4 0" fill="none" stroke-width="1.8"/>
      <path d="M22 38c0 4 1 6 2 6s2-2 2-6z" fill="#ff8f9c" stroke-width="1.8"/>
      <path d="M12 38.5c8 3 16 3 24 0l1.5 4.5c-9 3.5-18 3.5-27 0z" fill="#e8553e"/>
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

// --- 0.9.0 Ages: era upgrades (generated from the era colours), finance, map / market buttons ----------------------

/** "#rrggbb" for a 0xrrggbb number. */
export function hexCss(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Mix a 0xrrggbb colour toward white (t > 0) or black (t < 0), as CSS. */
export function shadeCss(n: number, t: number): string {
  const to = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  const ch = (v: number): number => Math.round(v + (to - v) * k);
  return hexCss((ch((n >> 16) & 255) << 16) | (ch((n >> 8) & 255) << 8) | ch(n & 255));
}

const GEAR_PATH =
  'M24 4l3.2 4.4 5.4-1.2 1.6 5.3 5.4 1.4-.9 5.5L43 22.7l-3.8 4 2.2 5.2-4.8 2.8-.3 5.6-5.5-.4L27.4 44l-5-2.6-5 2.6-2.8-4.9-5.5.4-.3-5.6L4 31.9l2.2-5.2-3.8-4 3.9-3.3-.9-5.5 5.4-1.4 1.6-5.3 5.4 1.2z';

/** Rigs: a gear in the era's accent colour. */
function rigsIcon(accent: number): string {
  return svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="${GEAR_PATH}" fill="${hexCss(accent)}"/>
      <circle cx="24" cy="24" r="12" fill="${shadeCss(accent, 0.35)}"/>
      <circle cx="24" cy="24" r="6" fill="${OUT}"/>
    </g>`);
}

/** Crew: a hard hat in the era's accent colour. */
function crewIcon(accent: number): string {
  return svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M9 31a15 15 0 0 1 30 0z" fill="${hexCss(accent)}"/>
      <rect x="21" y="9" width="6" height="22" rx="2" fill="${shadeCss(accent, 0.3)}"/>
      <rect x="4" y="30" width="40" height="7" rx="3.5" fill="${shadeCss(accent, -0.25)}"/>
      <path d="M14 24a10 10 0 0 1 4-7" fill="none" stroke="#fff" stroke-width="2.4" opacity="0.6"/>
      <rect x="12" y="38" width="24" height="5" rx="2.5" fill="#f3d9a4"/>
    </g>`);
}

/** 0.9.5 Belts: a short roller belt with a crate riding it, the frame in the era's accent colour. */
function beltsIcon(accent: number): string {
  return svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="9" y="12" width="16" height="13" rx="2" fill="#d9aa66"/>
      <path d="M9 18.5h16" stroke="#a8693a" stroke-width="2" fill="none"/>
      <rect x="3" y="26" width="42" height="9" rx="4.5" fill="${hexCss(accent)}"/>
      <circle cx="10" cy="30.5" r="2.6" fill="${OUT}"/><circle cx="19" cy="30.5" r="2.6" fill="${OUT}"/>
      <circle cx="28" cy="30.5" r="2.6" fill="${OUT}"/><circle cx="37" cy="30.5" r="2.6" fill="${OUT}"/>
      <path d="M8 35v8M40 35v8" stroke-width="3.2"/>
    </g>`);
}

/** 0.9.5 machine level: a little factory with a "+" in the era's accent colour. */
function machineIcon(accent: number): string {
  return svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M5 42V22l10 6v-6l10 6v-6l10 6V8h7v34z" fill="${hexCss(accent)}"/>
      <rect x="11" y="33" width="6" height="5" fill="#ffe9a8"/><rect x="23" y="33" width="6" height="5" fill="#ffe9a8"/>
      <circle cx="38" cy="12" r="8" fill="#5ee07a"/>
      <path d="M38 7.5v9M33.5 12h9" stroke="#fff" stroke-width="3"/>
    </g>`);
}

/** 0.9.5 Loading Dock: a pickup truck in the era's accent backed up to a striped counter. */
function dockIcon(accent: number): string {
  return svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="3" y="24" width="24" height="11" rx="2" fill="${hexCss(accent)}"/>
      <path d="M27 35V21h7l6 7v7z" fill="${hexCss(accent)}"/>
      <path d="M30 23h3l4 5h-7z" fill="#bfe6ff"/>
      <rect x="6" y="15" width="18" height="9" rx="2" fill="${shadeCss(accent, 0.35)}"/>
      <circle cx="10" cy="38" r="5" fill="#f3f6fb"/><circle cx="33" cy="38" r="5" fill="#f3f6fb"/>
      <path d="M4 8h40" stroke="${shadeCss(accent, -0.25)}" stroke-width="4" fill="none"/>
    </g>`);
}

/** 0.9.5 Market Stall: a little stall with a striped awning in the era's accent and a shopper's bag. */
function stallIcon(accent: number): string {
  return svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M6 18l4-10h28l4 10z" fill="${hexCss(accent)}"/>
      <path d="M16 8l-2 10M24 8v10M32 8l2 10" stroke="#fff4dc" stroke-width="3" fill="none"/>
      <rect x="8" y="18" width="32" height="7" rx="2" fill="${shadeCss(accent, -0.2)}"/>
      <rect x="10" y="25" width="28" height="17" rx="2" fill="#d9aa66"/>
      <path d="M18 31h12l-1.5 9h-9z" fill="#ffd84a"/>
      <path d="M21 31c0-4 6-4 6 0" fill="none"/>
    </g>`);
}

/** 0.9.5 era cash machine: a little safe in the era's accent with a gold wheel door and a cash bundle going in. */
function vaultIcon(accent: number): string {
  return svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <rect x="18" y="4" width="16" height="9" rx="2" fill="#5ee07a"/>
      <rect x="7" y="13" width="34" height="27" rx="5" fill="${hexCss(accent)}"/>
      <circle cx="24" cy="27" r="8.5" fill="#ffd84a"/>
      <path d="M24 21v12M18 27h12" stroke-width="2.4" fill="none"/>
      <path d="M11 40v4M37 40v4" stroke-width="3.2"/>
    </g>`);
}

/** 0.9.5 Fine <material>: a gold rosette with a swatch of the material's colours. */
function qualityIcon(color: number, accent: number): string {
  return svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M14 30l-5 14 7-3 4 6 4-13zM34 30l5 14-7-3-4 6-4-13z" fill="${hexCss(accent)}"/>
      <circle cx="24" cy="21" r="16" fill="#ffd84a"/>
      <rect x="15" y="13" width="18" height="16" rx="4" fill="${hexCss(color)}"/>
      <path d="M18 18h12" stroke="${shadeCss(color, 0.4)}" stroke-width="2.6" fill="none"/>
    </g>`);
}

/** 0.9.6: era player Carry: a work satchel in the era's accent (it used to fall back to Survival's log stack). */
function satchelIcon(accent: number): string {
  return svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M17 16c0-6 14-6 14 0" fill="none" stroke-width="3.2"/>
      <rect x="7" y="16" width="34" height="26" rx="6" fill="${hexCss(accent)}"/>
      <path d="M7 25h34" stroke="${shadeCss(accent, 0.4)}" stroke-width="2.6" fill="none"/>
      <rect x="20" y="22" width="8" height="7" rx="2" fill="#ffd84a"/>
    </g>`);
}

/** 0.9.6: era player Tool: a pick with the era's accent on its head. */
function pickIcon(accent: number): string {
  return svg(`
    <g stroke="${OUT}" stroke-width="2.5">
      <path d="M14 42L32 14" stroke-width="7"/>
      <path d="M14 42L32 14" stroke-width="3.6" stroke="#c98a4b"/>
      <path d="M12 12c8-6 20-6 28 2-6-2-12-2-17 0-4 1-7 0-11-2z" fill="${hexCss(accent)}"/>
    </g>`);
}

for (const era of ERAS) {
  if (!era) continue;
  const icons: Record<string, string> = {
    [`${era.key}Carry`]: satchelIcon(era.colors.accent),
    [`${era.key}Boots`]: UPGRADE_ICONS.speed!,
    [`${era.key}Tool`]: pickIcon(era.colors.accent),
    [`${era.key}Pal`]: UPGRADE_ICONS.dog!,
    [`${era.key}Rigs`]: rigsIcon(era.colors.accent),
    [`${era.key}Crew`]: crewIcon(era.colors.accent),
    [`${era.key}Belts`]: beltsIcon(era.colors.accent),
    [`${era.key}Dock`]: dockIcon(era.colors.accent),
    [`${era.key}Stall`]: stallIcon(era.colors.accent),
    [`${era.key}Cash`]: vaultIcon(era.colors.accent),
  };
  // each crew role wears its scarf colour on the hat (config ERA_ROLES)
  for (const r of ERA_ROLES) icons[`${era.key}${r.key}`] = crewIcon(r.scarf);
  for (const m of MACHINE_IDS) if (MACHINES[m].era === era.n) icons[m] = machineIcon(era.colors.accent);
  Object.assign(UPGRADE_ICONS, icons);
}
for (const kind of MATERIAL_KINDS) {
  const m = MATERIALS[kind];
  UPGRADE_ICONS[`${kind}Quality`] ??= qualityIcon(m.color, m.accent);
}

// finance: Jack's swap cart, City Hall, the stock broker's chart
UPGRADE_ICONS.jack = svg(`
  <g stroke="${OUT}" stroke-width="2.5">
    <path d="M4 10h7l3 22h22l4-15H14" fill="none" stroke-width="3.2"/>
    <path d="M13 17h27l-3.4 15H15.4z" fill="#d9aa66"/>
    <path d="M13 24.5h26M24 17l-1 15M33 17l-1 15" stroke="#a8693a" stroke-width="2" fill="none"/>
    <circle cx="18" cy="39" r="4.2" fill="#e8553e"/><circle cx="33" cy="39" r="4.2" fill="#e8553e"/>
    <path d="M34 4l1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z" fill="#ffd84a" stroke-width="1.8"/>
  </g>`);
UPGRADE_ICONS.taxOffice = svg(`
  <g stroke="${OUT}" stroke-width="2.5">
    <path d="M24 3l20 10H4z" fill="#e8553e"/>
    <rect x="6" y="13" width="36" height="4" fill="#f1f6ff"/>
    <rect x="9" y="18" width="6" height="20" fill="#f3d9a4"/><rect x="21" y="18" width="6" height="20" fill="#f3d9a4"/><rect x="33" y="18" width="6" height="20" fill="#f3d9a4"/>
    <rect x="3" y="38" width="42" height="6" rx="2" fill="#8fa9c9"/>
    <circle cx="24" cy="9" r="2" fill="#ffd84a" stroke-width="1.6"/>
  </g>`);
UPGRADE_ICONS.broker = svg(`
  <g stroke="${OUT}" stroke-width="2.5">
    <rect x="4" y="5" width="40" height="38" rx="5" fill="#dbe8fb"/>
    <path d="M10 14v24h28" fill="none" stroke-width="2.6"/>
    <path d="M13 33l8-9 6 5 10-14" fill="none" stroke="#2e9c48" stroke-width="4"/>
    <path d="M30 15h8v8z" fill="#2e9c48" stroke-width="2"/>
  </g>`);

/** HUD "Map" button: a folded map with a pin (white on the dark button). */
export const ICON_MAP = svg(`
  <g stroke="currentColor" stroke-width="3" fill="none">
    <path d="M6 12l12-5 12 5 12-5v29l-12 5-12-5-12 5z" fill="currentColor" fill-opacity="0.14"/>
    <path d="M18 7v29M30 12v29"/>
  </g>
  <circle cx="34" cy="17" r="5.2" fill="#ffd84a" stroke="${OUT}" stroke-width="2"/>`);

/** HUD "Market" button: rising chart bars with a coin. */
export const ICON_MARKET = svg(`
  <g stroke="currentColor" stroke-width="2.6" stroke-linejoin="round">
    <rect x="6" y="28" width="8" height="14" rx="2" fill="currentColor" fill-opacity="0.16"/>
    <rect x="18" y="20" width="8" height="22" rx="2" fill="currentColor" fill-opacity="0.16"/>
    <rect x="30" y="12" width="8" height="30" rx="2" fill="currentColor" fill-opacity="0.16"/>
  </g>
  <circle cx="35" cy="9" r="6.5" fill="#ffd84a" stroke="${OUT}" stroke-width="2"/>`);

/** "You are here" / pin for the map list (dark on light). */
export const ICON_PIN = svg(`
  <path d="M24 44S9 29 9 19a15 15 0 0 1 30 0c0 10-15 25-15 25z" fill="#e8553e" stroke="${OUT}" stroke-width="3"/>
  <circle cx="24" cy="19" r="6" fill="#fff" stroke="${OUT}" stroke-width="2.4"/>`);

/** A hammer (demolish). */
export const ICON_HAMMER = svg(`
  <g stroke="${OUT}" stroke-width="2.6">
    <rect x="21" y="18" width="7" height="27" rx="3" transform="rotate(35 24 30)" fill="#a8693a"/>
    <rect x="8" y="6" width="26" height="12" rx="3" transform="rotate(35 21 12)" fill="#9aa4b4"/>
  </g>`);

export function upgradeIcon(id: UpgradeIdConst): string {
  return kitIcon(UPGRADE_ICONS[id] ?? UPGRADE_ICONS.carry!);
}

export const ICON_LOCK = svg(
  `<rect x="9" y="21" width="30" height="21" rx="5" fill="#ffd84a" stroke="${OUT}" stroke-width="3"/>
   <path d="M15 21v-5a9 9 0 0 1 18 0v5" fill="none" stroke="${OUT}" stroke-width="4"/>
   <circle cx="24" cy="31" r="3.2" fill="${OUT}"/>`,
);

export const ICON_CLOSE = svg(`<path d="M13 13l22 22M35 13L13 35" stroke="${hexCss(CREAM)}" stroke-width="7"/>`);

export const ICON_GEAR = svg(
  `<path fill="currentColor" d="M24 4l3.2 4.4 5.4-1.2 1.6 5.3 5.4 1.4-.9 5.5L43 22.7l-3.8 4 2.2 5.2-4.8 2.8-.3 5.6-5.5-.4L27.4 44l-5-2.6-5 2.6-2.8-4.9-5.5.4-.3-5.6L4 31.9l2.2-5.2-3.8-4 3.9-3.3-.9-5.5 5.4-1.4 1.6-5.3 5.4 1.2z" transform="translate(0 -1) scale(.98) translate(.5 .5)"/>
   <circle cx="24" cy="24" r="7" style="fill:var(--wl-card)"/>`,
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
  return kitIcon(BUILDING_ICONS[id]);
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
