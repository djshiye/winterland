/**
 * [0.9.11] The Guidebook's pages: every good, machine, crew role, upgrade, building and rule of the game, one chapter
 * per era. Pure: built from the game's own data (eras/data.ts, eras/template.ts, config UPGRADES / BUSINESSES /
 * AMENITIES), so the book never drifts from what the game does. Only Survival's hand-built yard and the "How it works"
 * pages are written here.
 *
 * Spoiler rule (Dino, 2026-10-19): the book shows only eras the player has reached this season (state.eras.age).
 * `bookEntries(age)` never returns anything from a later era; the panel shows one locked "???" tab for the next one.
 * Read-only: nothing here buys, upgrades or moves anything (upgrades stay hands-on on pads).
 */
import { AMENITIES, AMENITY_IDS, BUSINESSES, eraCashMachine, UPGRADES, VILLAGE, type BusinessId, type UpgradeDef, type UpgradeIdConst } from '../config';
import { introEra } from '../core/ladder';
import type { ItemKind } from '../core/types';
import { cityBuildingsOfEra, CITY_BUILDINGS, ERAS, ERA_NAMES, isMaterial, lowerLabel, MACHINES, MATERIALS, MAX_ERA, type MachineDef, type MachineId } from '../eras/data';
import { contentMachines, eraContent } from '../eras/template';
import { ERA_KEYS } from '../core/kinds';

export type BookSection = 'goods' | 'machines' | 'crew' | 'upgrades' | 'town' | 'tips';

export const BOOK_SECTIONS: readonly { id: BookSection; label: string }[] = [
  { id: 'goods', label: 'Goods' },
  { id: 'machines', label: 'Machines' },
  { id: 'crew', label: 'Crew' },
  { id: 'upgrades', label: 'Upgrades' },
  { id: 'town', label: 'Town' },
  { id: 'tips', label: 'How to' },
];

export type BookGlyph = 'house' | 'star' | 'coin' | 'hammer' | 'map' | 'market' | 'log' | 'worker' | 'gear' | 'pin';

/** What the panel draws as the entry's picture (resolved to an SVG there, so this module stays DOM-free). */
export type BookIcon = { item: ItemKind } | { upgrade: UpgradeIdConst } | { business: BusinessId } | { glyph: BookGlyph };

export interface BookEntry {
  /** Stable across builds (the search and the tests key on it). */
  id: string;
  era: number;
  section: BookSection;
  name: string;
  /** One friendly line (or two). */
  text: string;
  icon: BookIcon;
  /** What one cycle takes and makes (machines, shops). */
  needs?: readonly { kind: ItemKind; per: number }[];
  makes?: { kind: ItemKind; count: number };
  /** Where to find it in the world. */
  where?: string;
}

/** The highest era a chapter can have (Survival = 1). */
export const BOOK_ERAS = MAX_ERA;

const label = (kind: ItemKind): string => (isMaterial(kind) ? MATERIALS[kind].label : SURVIVAL_GOODS[kind as SurvivalGood]?.name ?? kind);
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const list = (names: string[]): string => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// ---------------------------------------------------------------------------
// Survival (era 1): hand-built, so its pages are written here
// ---------------------------------------------------------------------------

type SurvivalGood = 'log' | 'plank' | 'crate' | 'furniture' | 'wheat' | 'bread' | 'meat' | 'sausage' | 'toy';

const SURVIVAL_GOODS: Record<SurvivalGood, { name: string; text: string }> = {
  log: { name: 'Logs', text: 'Chop them off the giant log, or let the Harvester and Mega Sawmill cut them. Trucks and trains buy logs, and shelters are built with them.' },
  plank: { name: 'Planks', text: 'Logs you drop on the shop counter become planks. Walk-in customers buy them.' },
  crate: { name: 'Crates', text: 'The Processor turns logs into crates. Tricycles come by to buy them.' },
  furniture: { name: 'Furniture', text: 'The Workshop builds chairs out of logs. Dog sleds carry them away and pay well.' },
  wheat: { name: 'Wheat', text: 'Grown by the Farm. The Bakery needs it.' },
  bread: { name: 'Bread', text: 'Baked from wheat and firewood. Townsfolk buy it at the Bakery.' },
  meat: { name: 'Meat', text: 'Comes from the Ranch. The Butcher needs it.' },
  sausage: { name: 'Sausages', text: 'Smoked from meat and wood. Townsfolk buy them at the Butcher.' },
  toy: { name: 'Toys', text: 'The Toy Factory makes toy trains from crates. The Grand Market needs 20.' },
};

const SURVIVAL_MACHINES: readonly {
  id: string;
  name: string;
  text: string;
  icon: BookIcon;
  needs?: { kind: ItemKind; per: number }[];
  makes?: { kind: ItemKind; count: number };
  where: string;
}[] = [
  { id: 'harvester', name: 'Harvester', text: 'A saw on rails that cuts logs off the giant log all by itself.', icon: { upgrade: 'harvester' }, makes: { kind: 'log', count: 1 }, where: 'By the giant log on the river' },
  { id: 'processor', name: 'Processor', text: 'Feed it logs and it packs them into crates.', icon: { upgrade: 'processor' }, needs: [{ kind: 'log', per: 1 }], makes: { kind: 'crate', count: 1 }, where: 'In the yard' },
  { id: 'conveyor', name: 'Conveyors', text: 'Belts that carry logs across the yard for you.', icon: { item: 'log' }, where: 'In the yard' },
  { id: 'megaSaw', name: 'Mega Sawmill', text: 'A giant river saw that slices several logs off the giant log at once.', icon: { upgrade: 'megaSaw' }, makes: { kind: 'log', count: 3 }, where: 'Across the river, upstream of the giant log' },
  { id: 'truckLoader', name: 'Truck Loader', text: 'A belt from the drop zone to the truck counter, so trucks load without you.', icon: { upgrade: 'truckDock' }, where: 'In the north yard' },
  { id: 'treeFeller', name: 'Tree Feller', text: 'Fells pines on Timber Ridge and stacks them on the log deck.', icon: { upgrade: 'treeFeller' }, makes: { kind: 'log', count: 1 }, where: 'On Timber Ridge, through the east gate' },
  { id: 'cashTubes', name: 'Cash Tubes', text: 'Pneumatic tubes that bank every cash pile for you.', icon: { upgrade: 'cashTubes' }, where: 'Beside the cabin' },
  { id: 'workshop', name: 'Workshop', text: 'Turns logs into chairs for the dog sleds.', icon: { upgrade: 'workshop' }, needs: [{ kind: 'log', per: 1 }], makes: { kind: 'furniture', count: 1 }, where: 'On Timber Ridge' },
];

function survivalEntries(): BookEntry[] {
  const out: BookEntry[] = [];
  for (const [kind, g] of Object.entries(SURVIVAL_GOODS) as [SurvivalGood, { name: string; text: string }][]) {
    out.push({ id: `good:${kind}`, era: 1, section: 'goods', name: g.name, text: g.text, icon: { item: kind } });
  }
  for (const m of SURVIVAL_MACHINES) {
    const lv = m.icon && 'upgrade' in m.icon && UPGRADES[m.icon.upgrade]?.group === 'machine' ? ' Level it up on its pad.' : '';
    out.push({ id: `machine:${m.id}`, era: 1, section: 'machines', name: m.name, text: m.text + lv, icon: m.icon, ...(m.needs ? { needs: m.needs } : {}), ...(m.makes ? { makes: m.makes } : {}), where: m.where });
  }
  const shelters = VILLAGE.tiers.map((s) => s.label);
  out.push({ id: 'town:shelters', era: 1, section: 'town', name: 'Shelters', text: `Village plots grow ${shelters.join(' → ')}. Each step costs logs and cash and brings more villagers.`, icon: { glyph: 'house' }, where: 'Along the village street, through the south gate' });
  for (const b of Object.values(BUSINESSES)) {
    const text = b.kind === 'home' ? `${b.blurb}.` : `${b.blurb.replace(/ \(.*\)$/, '')}.`;
    out.push({
      id: `town:${b.id}`, era: 1, section: 'town', name: b.label, text, icon: { business: b.id }, where: 'Market Town',
      ...(b.inputs.length ? { needs: b.inputs } : {}),
      ...(b.output ? { makes: { kind: b.output, count: b.batch ?? 1 } } : {}),
    });
  }
  for (const id of AMENITY_IDS) {
    const a = AMENITIES[id];
    out.push({ id: `town:${id}`, era: 1, section: 'town', name: a.label, text: `${a.blurb}. A happier town makes your mill and Market Town sales pay more.`, icon: { glyph: 'star' }, where: 'Market Town square' });
  }
  out.push({ id: 'town:greatLodge', era: 1, section: 'town', name: 'Great Lodge', text: 'The crown of the village. Build it at Winter City to finish Survival and open the road to the next era.', icon: { glyph: 'star' }, where: 'At the end of the village street' });
  out.push({ id: 'town:grandMarket', era: 1, section: 'town', name: 'Grand Market', text: 'A great market hall for the town. It needs logs, cash and toy trains from the Toy Factory.', icon: { glyph: 'market' }, where: 'Market Town' });
  return out;
}

// ---------------------------------------------------------------------------
// Eras 2..10: straight from the era data
// ---------------------------------------------------------------------------

function machineDef(id: string): MachineDef | undefined {
  return (MACHINES as Record<string, MachineDef>)[id];
}

function goodText(n: number, kind: ItemKind): string {
  const ids = contentMachines(n).map(machineDef).filter((d): d is MachineDef => !!d);
  const makers = ids.filter((d) => d.output === kind);
  const users = ids.filter((d) => d.inputs.some((i) => i.kind === kind));
  const parts: string[] = [];
  if (makers.length) parts.push(`${makers[0]!.kind === 'extractor' ? 'Comes from' : 'Made at'} the ${list(makers.map((d) => d.label))}.`);
  const node = eraContent(n).node;
  if (node.yields === kind) parts.push(`You can also ${lower(node.verb)} it from the ${node.label} by hand.`);
  if (users.length) parts.push(`The ${list(users.map((d) => d.label))} ${users.length > 1 ? 'need' : 'needs'} it.`);
  if (eraContent(n).sales.includes(kind) || !users.length) parts.push('Sells at the market.');
  return parts.join(' ');
}

function eraEntries(n: number): BookEntry[] {
  const out: BookEntry[] = [];
  const era = ERAS[n]!;
  const key = ERA_KEYS[n - 2]!;
  const c = eraContent(n);
  const region = era.region;
  for (const kind of c.materials) {
    if (!isMaterial(kind as ItemKind)) continue;
    out.push({ id: `good:${kind}`, era: n, section: 'goods', name: MATERIALS[kind as keyof typeof MATERIALS].label, text: goodText(n, kind as ItemKind), icon: { item: kind as ItemKind }, where: region });
  }
  for (const id of contentMachines(n)) {
    const d = machineDef(id);
    if (d) {
      out.push({
        id: `machine:${id}`, era: n, section: 'machines', name: d.label, text: `${d.blurb}. Build it on an empty slot, then level it up on its pad.`,
        icon: { upgrade: id as MachineId }, ...(d.inputs.length ? { needs: d.inputs } : {}), makes: { kind: d.output, count: d.batch }, where: region,
      });
    } else if (eraCashMachine(n)?.id === id) {
      out.push({ id: `machine:${id}`, era: n, section: 'machines', name: eraCashMachine(n)!.label, text: 'Banks the market cash pile for you. Lv 1 builds it on its pad, and every level banks faster.', icon: { upgrade: `${key}Cash` as UpgradeIdConst }, where: `By the ${region} market` });
    }
  }
  const crew = [`${key}Crew`, `${key}Feeder`, `${key}Shipper`, `${key}Porter`, `${key}Gatherer`, `${key}Foreman`, `${key}Clerk`];
  for (const id of crew) {
    const d = (UPGRADES as Record<string, UpgradeDef>)[id];
    if (!d) continue;
    const s = d.requires?.settlement;
    out.push({ id: `crew:${id}`, era: n, section: 'crew', name: d.label, text: `${d.blurb}.${s ? ` Hire from Settlement ${s}.` : ''}`, icon: { upgrade: d.id }, where: `${region} shop mat` });
  }
  out.push(...upgradeEntries(n, `${region} shop mat`));
  for (const id of cityBuildingsOfEra(n)) {
    const b = CITY_BUILDINGS[id];
    out.push({ id: `town:${id}`, era: n, section: 'town', name: b.label, text: `${b.blurb}. Built with cash and ${lowerLabel(label(b.extra.kind))}.`, icon: { glyph: b.kind === 'home' ? 'house' : b.kind === 'park' ? 'star' : b.kind === 'landmark' ? 'pin' : 'worker' }, where: `${era.district} district` });
  }
  return out;
}

const UPGRADE_GROUPS = ['lumberjack', 'industry', 'sales', 'finance'] as const;

/** The era's own upgrades a shop mat sells (machine levels live on the machine pages, crews on the crew pages). */
function upgradeEntries(n: number, where: string): BookEntry[] {
  const out: BookEntry[] = [];
  const defs = (Object.values(UPGRADES) as UpgradeDef[]).filter((d) => introEra(d) === n);
  for (const g of UPGRADE_GROUPS) {
    for (const d of defs) {
      if (d.group !== g) continue;
      const at = d.id === 'jack' ? "Jack's cart in the yard" : g === 'finance' ? 'Cabin shop mat' : where;
      out.push({ id: `upgrade:${d.id}`, era: n, section: 'upgrades', name: d.label, text: `${d.blurb}.`, icon: { upgrade: d.id }, where: at });
    }
  }
  return out;
}

function survivalUpgrades(): BookEntry[] {
  const crew = (Object.values(UPGRADES) as UpgradeDef[]).filter((d) => introEra(d) === 1 && d.group === 'crew');
  return [
    ...crew.map((d): BookEntry => ({ id: `crew:${d.id}`, era: 1, section: 'crew', name: d.label, text: `${d.blurb}.`, icon: { upgrade: d.id }, where: 'Cabin shop mat' })),
    ...upgradeEntries(1, 'Cabin shop mat'),
  ];
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------

const TIPS: readonly { id: string; era: number; name: string; text: string; icon: BookIcon }[] = [
  { id: 'chop', era: 1, name: 'Chop and carry', text: 'Stand by the giant log and you chop by yourself. To pick up a pile, stand on it (with a keyboard or controller, hold E or A). Walk to a counter or hopper to drop things off: no key needed.', icon: { glyph: 'log' } },
  { id: 'cash', era: 1, name: 'Collect your cash', text: 'Buyers leave cash piles by their counters. Walk over a pile to bank it.', icon: { glyph: 'coin' } },
  { id: 'pads', era: 1, name: 'Pads', text: 'Stand on a pad to pay for it, a little at a time (with a keyboard or controller, hold E or A). Walking across pays nothing. A built machine comes back as a level pad.', icon: { glyph: 'hammer' } },
  { id: 'shop', era: 1, name: 'The shop', text: "Stand on the cabin's doormat to open the shop. Tap an upgrade's price to buy one level. Upgrades go up to Lv 10 once the Great Lodge is built. Each era's own Carry, Boots, Tool and Pal upgrades work only inside that era's region.", icon: { glyph: 'gear' } },
  { id: 'crew', era: 1, name: 'Crew', text: 'Hire helpers in the shop. Each one takes a job off your hands, and levels make them faster.', icon: { glyph: 'worker' } },
  { id: 'village', era: 1, name: 'The village', text: 'Shelters bring villagers. More villagers raise the village level: Camp, Hamlet, Village, Town and Winter City. Every level brings better prices and new things to build.', icon: { glyph: 'house' } },
  { id: 'quests', era: 1, name: 'Quests and contracts', text: 'The quest card lists small goals with a reward. Contracts ask for a batch of goods and pay a bonus.', icon: { glyph: 'star' } },
  { id: 'away', era: 1, name: 'While you were away', text: 'The game saves by itself. While it is closed, you earn a quarter of your usual sales and rent, for up to 2 hours, and never more than a fifth of everything you have earned so far. Quests, contracts and Jack do not count. The desktop game keeps playing at full speed while it is minimised; in a browser, a hidden tab pauses the game.', icon: { glyph: 'coin' } },
  { id: 'eras', era: 2, name: 'Eras and the gate', text: 'To open the next era, raise everything this era added to Lv 10, grow to its settlement level, then buy the expansion pad. The era chip at the top shows your next goal.', icon: { glyph: 'pin' } },
  { id: 'slots', era: 2, name: 'Building machines', text: 'Choose a machine for an empty slot, then pay on its construction pad with cash and the materials it asks for.', icon: { glyph: 'hammer' } },
  { id: 'eraShop', era: 2, name: "The era's own shop", text: "Each era has its own shop mat in its region, with that era's crew, gear and upgrades.", icon: { glyph: 'gear' } },
  { id: 'belts', era: 2, name: 'Belts', text: 'The Belts upgrade links machines that feed each other, so goods roll along by themselves.', icon: { glyph: 'gear' } },
  { id: 'market', era: 2, name: 'Selling in the regions', text: 'Each region has a loading dock for buyer vehicles and a market stall for shoppers. They pay the same price as the export depot: bigger docks and stalls bring buyers more often, and Quality raises the price everywhere. Town happiness and the northern lights lift only mill and Market Town sales.', icon: { glyph: 'market' } },
  { id: 'settlement', era: 2, name: 'Settlement and the city', text: "Build homes in the era's city district to grow your settlement; machine staff count too. Workplaces and landmarks earn money once residents fill their jobs, and residents from every district count. Parks only make the city happier. Each new settlement level leaves a gift on the avenue: walk over it to collect.", icon: { glyph: 'house' } },
  { id: 'map', era: 2, name: 'Map and travel', text: 'Press T or tap the map button to see every region and travel there in a moment.', icon: { glyph: 'map' } },
  { id: 'trade', era: 2, name: 'The Market', text: 'Press B or tap the market button to watch prices, trade goods and invest your savings.', icon: { glyph: 'market' } },
  { id: 'foreman', era: 2, name: 'Foremen', text: 'A foreman brings materials to what you chose to build, then pays for it. They never choose for you. They always leave you some of your cash (40% in the eras, at least $500 at the mill), so a build can wait while you still have money.', icon: { glyph: 'worker' } },
];

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

let cache: BookEntry[] | null = null;

/** Every page of the book, all eras (the data is static, so it is built once). */
export function allBookEntries(): readonly BookEntry[] {
  if (cache) return cache;
  const out: BookEntry[] = [...survivalEntries(), ...survivalUpgrades()];
  for (let n = 2; n <= MAX_ERA; n++) if (ERAS[n]) out.push(...eraEntries(n));
  for (const t of TIPS) out.push({ id: `tip:${t.id}`, era: t.era, section: 'tips', name: t.name, text: t.text, icon: t.icon });
  cache = out;
  return out;
}

/** The pages a player who reached era `age` may see (never one from a later era). */
export function bookEntries(age: number): BookEntry[] {
  const top = Math.max(1, Math.min(MAX_ERA, Math.floor(age) || 1));
  return allBookEntries().filter((e) => e.era <= top);
}

/** One chapter's pages of one section. */
export function chapterEntries(age: number, era: number, section: BookSection): BookEntry[] {
  if (era > age) return [];
  return bookEntries(age).filter((e) => e.era === era && e.section === section);
}

/** Pages whose name or text holds every word of `query` (case-insensitive), reached eras only. */
export function searchBook(age: number, query: string): BookEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return bookEntries(age).filter((e) => {
    const hay = `${e.name} ${e.text}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Chapter heading for era n. */
export function chapterTitle(n: number): { name: string; line: string; place: string } {
  if (n <= 1) return { name: ERA_NAMES[1]!, line: 'A snowy river, a giant log and a little mill', place: 'The mill, the village and Market Town' };
  const d = ERAS[n]!;
  return { name: d.name, line: d.tagline, place: `${d.region} · ${d.district}` };
}

/** Item label for the needs / makes row. */
export function goodLabel(kind: ItemKind): string {
  return label(kind);
}

/** Flag that marks chapter n as read (the "new" leaf). Survival is never new: the book opens on it. */
export const chapterFlag = (n: number): `seen:${string}` => `seen:book${n}`;

/** Chapters 2..age the player has not opened yet. */
export function newChapters(age: number, flags: Readonly<Partial<Record<string, boolean>>>): number[] {
  const out: number[] = [];
  for (let n = 2; n <= Math.min(age, MAX_ERA); n++) if (!flags[chapterFlag(n)]) out.push(n);
  return out;
}
