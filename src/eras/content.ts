/**
 * [PURE] 0.9.5 per-era content table (docs/EXPANSION.md section D, docs/ERA_RESOURCES.md): what fills each era 2..10 so
 * it is as complete as Survival. Pure data, no THREE, no GameContext.
 *
 * The shared systems read their names and lists from here instead of hard-coding them:
 * - machines: the era's six machines by job (2 extractors, 2 processors, 1 premium works, 1 cash machine). The five
 *   producers are MACHINES ids (eras/data.ts); the cash machine is a front-yard facility id with its own runtime.
 * - roles: the display names of the seven worker roles (Hauler is the era's `${key}Crew` worker).
 * - player: the names of the four player upgrades in that era (Carry, Boots, Tool, Pal).
 * - sales: the four goods with their own quality (sales) upgrade, cheapest first.
 * - hand node: assets/eraNodes.ts ERA_NODES[n] (name, yield, verb, tool).
 *
 * Each content thread owns its eras' rows: 2-4, 5-7, 8-10.
 */
import type { MaterialKind } from '../core/kinds';
import type { MachineId } from './data';

export type EraRole = 'hauler' | 'feeder' | 'shipper' | 'porter' | 'clerk' | 'foreman' | 'gatherer';
export const ERA_ROLES: readonly EraRole[] = ['hauler', 'feeder', 'shipper', 'porter', 'clerk', 'foreman', 'gatherer'];

/** What each role does, for crew cards (same for every era). */
export const ROLE_JOBS: Readonly<Record<EraRole, string>> = {
  hauler: 'Does a bit of everything',
  feeder: 'Carries raw goods to the processors',
  shipper: 'Carries finished goods to the export depot',
  porter: 'Brings import dock deliveries to the machines',
  clerk: 'Banks the takings at the depot',
  foreman: 'Pays for new machines and buildings, keeping a reserve',
  gatherer: 'Hauls the hand-harvest pile to the machines',
};

export type EraPlayerUpgrade = 'carry' | 'boots' | 'tool' | 'pal';

export interface EraContent {
  n: number;
  machines: {
    extractors: readonly [MachineId, MachineId];
    processors: readonly [MachineId, MachineId];
    premium: MachineId;
    /** Cash machine (the cash tubes of this era): a facility id, not a MACHINES entry. */
    cash: string;
  };
  /** Singular display names. */
  roles: Readonly<Record<EraRole, string>>;
  player: Readonly<Record<EraPlayerUpgrade, string>>;
  /** The era's four sellable goods with a quality upgrade each. */
  sales: readonly [MaterialKind, MaterialKind, MaterialKind, MaterialKind];
  /** Cash machine display name. */
  cashLabel: string;
}

function content(c: EraContent): EraContent {
  return c;
}

/** ERA_CONTENT[n] for n = 2..10 (missing rows: that era's content thread has not landed yet). */
export const ERA_CONTENT: Readonly<Partial<Record<number, EraContent>>> = {
  // -------------------------------------------------------------------------
  // eras 2-4 (0.9.5 "Era 2 to 4 content")
  // -------------------------------------------------------------------------
  2: content({
    n: 2,
    machines: { extractors: ['quarry', 'clayPit'], processors: ['kiln', 'tileKiln'], premium: 'masonYard', cash: 'strongbox' },
    roles: { hauler: 'Quarryman', feeder: 'Kiln Feeder', shipper: 'Carter', porter: 'Dock Hand', clerk: 'Tally Clerk', foreman: 'Master Mason', gatherer: 'Stonebreaker' },
    player: { carry: "Mason's Hod", boots: 'Hobnail Boots', tool: 'Stone Pick', pal: 'Pack Mule' },
    sales: ['stone', 'brick', 'roofTile', 'hearth'],
    cashLabel: 'Strongbox',
  }),
  3: content({
    n: 3,
    machines: { extractors: ['ironMine', 'charcoalClamp'], processors: ['smelter', 'forge'], premium: 'railMill', cash: 'mintChute' },
    roles: { hauler: 'Miner', feeder: 'Ore Sorter', shipper: 'Rail Carter', porter: 'Lumper', clerk: 'Paymaster', foreman: 'Pit Boss', gatherer: 'Prospector' },
    player: { carry: 'Ore Basket', boots: "Miner's Boots", tool: 'Iron Pick', pal: 'Pit Pony' },
    sales: ['ore', 'iron', 'tools', 'rail'],
    cashLabel: 'Mint Chute',
  }),
  4: content({
    n: 4,
    machines: { extractors: ['coalPit', 'scrapYard'], processors: ['steamWorks', 'boilerShop'], premium: 'engineWorks', cash: 'pneumaticTubes' },
    roles: { hauler: 'Stoker', feeder: 'Coal Heaver', shipper: 'Engine Driver', porter: 'Navvy', clerk: 'Bookkeeper', foreman: 'Chief Engineer', gatherer: 'Coal Picker' },
    player: { carry: 'Coal Scuttle', boots: 'Steam Skates', tool: 'Coal Shovel', pal: 'Brass Terrier' },
    sales: ['coal', 'gear', 'boiler', 'steamEngine'],
    cashLabel: 'Pneumatic Tubes',
  }),
};

/** Era n's content row, or null while its content has not landed. */
export function eraContent(n: number): EraContent | null {
  return ERA_CONTENT[n] ?? null;
}

/** The five producing machines of era n in build order (extractors, processors, premium); [] without content. */
export function eraProducers(n: number): MachineId[] {
  const c = eraContent(n);
  if (!c) return [];
  return [...c.machines.extractors, ...c.machines.processors, c.machines.premium];
}
