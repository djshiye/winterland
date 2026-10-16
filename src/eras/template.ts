/**
 * [eras] 0.9.5: the per-era content template (docs/EXPANSION.md section D, docs/ERA_RESOURCES.md). Pure data, no
 * runtime imports, so every shared system (upgrade generator, pads, crews, customers, layout) can read it.
 *
 * Every era 2..10 is the same size as Survival: 6 machines (2 extractors, 2 processors, a premium machine, a cash
 * machine), 7 worker roles, 4 player upgrades (carry, boots, tool, pal) with a hand node, and 4 sales products
 * (each with its "Fine" `${material}Quality` upgrade). 0.9.6: every era's chain runs on its own land (eras 4, 8 and 10
 * no longer need older eras' goods). 0.9.7 era resources v2: era 5 runs on iron pellets + coke and era 10 on rare
 * earth + helium-3 with fusion; era 10, the finale, has one more processor (`more`), so it uses its bigger region.
 *
 * Ownership: each content thread edits only its own eras' rows (2-4, 5-7, 8-10). Ids are plain strings here so a
 * row can name a machine or material before it is added to eras/data.ts; readers skip ids that do not exist yet
 * (`isMachineId` / `isMaterialKind` in eras/data.ts), and tests/template.test.ts checks every row once wired.
 */

/** The seven worker roles of every era (Survival counterpart in brackets). */
export const ERA_ROLES = ['hauler', 'feeder', 'shipper', 'porter', 'clerk', 'foreman', 'gatherer'] as const;
export type EraRole = (typeof ERA_ROLES)[number];

/**
 * What each role does (one EraWorker class, a role mask in pickJob):
 * hauler: everything (today's worker) · feeder: raw → processors (logHauler) · shipper: finished goods → depot
 * (crateRunner) · porter: import dock → machines (porter) · clerk: banks the depot cash pile (cashier) · foreman: pays
 * this era's slots and district lots, keeping a reserve (foreman) · gatherer: hand-node pile → machines (pineHauler).
 */
export const ERA_ROLE_JOBS: Readonly<Record<EraRole, string>> = {
  hauler: 'Hauls anything that needs moving',
  feeder: 'Feeds raw materials to the processors',
  shipper: 'Ships finished goods to the depot',
  porter: 'Carries imports from the dock to the machines',
  clerk: 'Banks the takings',
  foreman: 'Pays for new machines and buildings',
  gatherer: 'Hauls the hand-node pile to the machines',
};

export interface EraContent {
  n: number;
  /** Section D order: two extractors, two processors, the premium machine and the cash machine. */
  machines: { ext: readonly [string, string]; proc: readonly [string, string]; premium: string; cash: string; more?: readonly string[] };
  /** The era's materials, raw first (new ones are added to core/kinds.ts MATERIAL_KINDS by the era's thread). */
  materials: readonly string[];
  /** Role → { label, plural }. `hauler` keeps the era's old worker name (eras/data.ts ERAS[n].worker). */
  roles: Readonly<Record<EraRole, { label: string; plural: string }>>;
  /** Player upgrade labels (`${key}Carry`, `${key}Boots`, `${key}Tool`, `${key}Pal`). */
  player: { carry: string; boots: string; tool: string; pal: string };
  /** The hand node (giant-log analog, assets/eraNodes.ts ERA_NODES[n]) and the raw material a strike yields. */
  node: { label: string; yields: string; verb: string };
  /** The four products with their own `${material}Quality` ("Fine") sales upgrade. */
  sales: readonly [string, string, string, string];
}

const roles = (r: [string, string][]): EraContent['roles'] => {
  const out = {} as Record<EraRole, { label: string; plural: string }>;
  ERA_ROLES.forEach((role, i) => (out[role] = { label: r[i]![0], plural: r[i]![1] }));
  return out;
};

/** ERA_CONTENT[n] for n = 2..10 (indices 0 and 1 are null: Survival is hand-built). */
export const ERA_CONTENT: readonly (EraContent | null)[] = [
  null,
  null,
  // ---- era 2-4: "Era 2 to 4 content" thread ----
  {
    n: 2,
    machines: { ext: ['quarry', 'clayPit'], proc: ['kiln', 'tileKiln'], premium: 'masonYard', cash: 'strongbox' },
    materials: ['stone', 'clay', 'brick', 'roofTile', 'hearth'],
    roles: roles([['Quarryman', 'Quarrymen'], ['Kiln Feeder', 'Kiln Feeders'], ['Carter', 'Carters'], ['Dock Hand', 'Dock Hands'], ['Tally Clerk', 'Tally Clerks'], ['Master Mason', 'Master Masons'], ['Stonebreaker', 'Stonebreakers']]),
    player: { carry: "Mason's Hod", boots: 'Hobnail Boots', tool: 'Stone Pick', pal: 'Pack Mule' },
    node: { label: 'Great Boulder', yields: 'stone', verb: 'Chip' },
    sales: ['stone', 'brick', 'roofTile', 'hearth'],
  },
  {
    n: 3,
    machines: { ext: ['ironMine', 'charcoalClamp'], proc: ['smelter', 'forge'], premium: 'railMill', cash: 'mintChute' },
    materials: ['ore', 'charcoal', 'iron', 'tools', 'rail'],
    roles: roles([['Miner', 'Miners'], ['Ore Sorter', 'Ore Sorters'], ['Rail Carter', 'Rail Carters'], ['Lumper', 'Lumpers'], ['Paymaster', 'Paymasters'], ['Pit Boss', 'Pit Bosses'], ['Prospector', 'Prospectors']]),
    player: { carry: 'Ore Basket', boots: "Miner's Boots", tool: 'Iron Pick', pal: 'Pit Pony' },
    node: { label: 'Ore Vein', yields: 'ore', verb: 'Pick' },
    sales: ['ore', 'iron', 'tools', 'rail'],
  },
  {
    n: 4,
    machines: { ext: ['coalPit', 'scrapYard'], proc: ['steamWorks', 'boilerShop'], premium: 'engineWorks', cash: 'pneumaticTubes' },
    materials: ['coal', 'scrap', 'gear', 'boiler', 'steamEngine'],
    roles: roles([['Stoker', 'Stokers'], ['Coal Heaver', 'Coal Heavers'], ['Engine Driver', 'Engine Drivers'], ['Navvy', 'Navvies'], ['Bookkeeper', 'Bookkeepers'], ['Chief Engineer', 'Chief Engineers'], ['Coal Picker', 'Coal Pickers']]),
    player: { carry: 'Coal Scuttle', boots: 'Steam Skates', tool: 'Coal Shovel', pal: 'Brass Terrier' },
    node: { label: 'Coal Seam', yields: 'coal', verb: 'Shovel' },
    sales: ['coal', 'gear', 'boiler', 'steamEngine'],
  },
  // ---- era 5-7: "Era 5 to 7 content" thread ----
  {
    n: 5,
    machines: { ext: ['deepMine', 'cokeOven'], proc: ['steelMill', 'rollingMill'], premium: 'plowWorks', cash: 'bankVault' },
    materials: ['pellets', 'coke', 'steel', 'girder', 'snowplow'],
    roles: roles([['Steelworker', 'Steelworkers'], ['Crane Hand', 'Crane Hands'], ['Teamster', 'Teamsters'], ['Stevedore', 'Stevedores'], ['Payroll Clerk', 'Payroll Clerks'], ['Plant Manager', 'Plant Managers'], ['Pellet Raker', 'Pellet Rakers']]),
    player: { carry: 'Steel Barrow', boots: 'Work Boots', tool: 'Rivet Hammer', pal: 'Draft Horse' },
    node: { label: 'Taconite Ridge', yields: 'pellets', verb: 'Hammer' },
    sales: ['pellets', 'steel', 'girder', 'snowplow'],
  },
  {
    n: 6,
    machines: { ext: ['copperMine', 'quartzPit'], proc: ['wireMill', 'bulbWorks'], premium: 'radioWorks', cash: 'tillLine' },
    materials: ['copper', 'quartz', 'wire', 'bulb', 'radio'],
    roles: roles([['Lineman', 'Linemen'], ['Coil Winder', 'Coil Winders'], ['Tram Driver', 'Tram Drivers'], ['Freight Hand', 'Freight Hands'], ['Switchboard Clerk', 'Switchboard Clerks'], ['Electrical Foreman', 'Electrical Foremen'], ['Copper Scrapper', 'Copper Scrappers']]),
    player: { carry: 'Spool Rack', boots: 'E-Scooter', tool: 'Power Drill', pal: 'Lamp Cat' },
    node: { label: 'Copper Vein', yields: 'copper', verb: 'Drill' },
    sales: ['copper', 'wire', 'bulb', 'radio'],
  },
  {
    n: 7,
    machines: { ext: ['oilPump', 'gasWell'], proc: ['refinery', 'cracker'], premium: 'snowmobileWorks', cash: 'driveThruVault' },
    materials: ['crude', 'gas', 'plastic', 'fuel', 'snowmobile'],
    roles: roles([['Roughneck', 'Roughnecks'], ['Pipefitter', 'Pipefitters'], ['Tanker Driver', 'Tanker Drivers'], ['Dockworker', 'Dockworkers'], ['Accountant', 'Accountants'], ['Toolpusher', 'Toolpushers'], ['Seep Skimmer', 'Seep Skimmers']]),
    player: { carry: 'Barrel Dolly', boots: 'Snow Treads', tool: 'Ice Auger', pal: 'Snow Fox' },
    node: { label: 'Oil Seep', yields: 'crude', verb: 'Drill' },
    sales: ['crude', 'plastic', 'fuel', 'snowmobile'],
  },
  // ---- era 8-10: "Era 8 to 10 content" thread ----
  {
    n: 8,
    machines: { ext: ['sandPit', 'goldPanner'], proc: ['chipFab', 'boardShop'], premium: 'pcAssembly', cash: 'atmNetwork' },
    materials: ['silicon', 'gold', 'chip', 'board', 'computer'],
    roles: roles([['Technician', 'Technicians'], ['Wafer Handler', 'Wafer Handlers'], ['Courier', 'Couriers'], ['Logistics Tech', 'Logistics Techs'], ['Data Clerk', 'Data Clerks'], ['Project Lead', 'Project Leads'], ['Sand Sifter', 'Sand Sifters']]),
    player: { carry: 'Smart Cart', boots: 'E-Bike', tool: 'Laser Sieve', pal: 'Rover Bot' },
    node: { label: 'Sand Dune', yields: 'silicon', verb: 'Sift' },
    sales: ['silicon', 'chip', 'board', 'computer'],
  },
  {
    n: 9,
    machines: { ext: ['uraniumMine', 'graphitePit'], proc: ['enricher', 'reactor'], premium: 'batteryPlant', cash: 'atomicVault' },
    materials: ['uranium', 'graphite', 'fuelRod', 'power', 'battery'],
    roles: roles([['Atom Tech', 'Atom Techs'], ['Rod Handler', 'Rod Handlers'], ['Hazmat Driver', 'Hazmat Drivers'], ['Decon Porter', 'Decon Porters'], ['Auditor', 'Auditors'], ['Shift Supervisor', 'Shift Supervisors'], ['Crystal Cutter', 'Crystal Cutters']]),
    player: { carry: 'Lead Tote', boots: 'Hover Boots', tool: 'Geiger Tongs', pal: 'Rad Drone' },
    node: { label: 'Uranium Crystal', yields: 'uranium', verb: 'Cut' },
    sales: ['fuelRod', 'power', 'graphite', 'battery'],
  },
  {
    n: 10,
    machines: { ext: ['nanoFab', 'heliumSkimmer'], proc: ['fusionPlant', 'dataCenter'], more: ['robotWorks'], premium: 'quantumLab', cash: 'quantumBank' },
    materials: ['rareEarth', 'helium3', 'fusionCell', 'aiCore', 'robot', 'quantumCore'],
    roles: roles([['Robot', 'Robots'], ['Feeder Bot', 'Feeder Bots'], ['Courier Drone', 'Courier Drones'], ['Dock Bot', 'Dock Bots'], ['Ledger AI', 'Ledger AIs'], ['Builder Bot', 'Builder Bots'], ['Prospector Drone', 'Prospector Drones']]),
    player: { carry: 'Exo Suit', boots: 'Jet Boots', tool: 'Nano Wand', pal: 'Robo Pup' },
    node: { label: 'Rare Earth Geode', yields: 'rareEarth', verb: 'Tune' },
    sales: ['rareEarth', 'aiCore', 'robot', 'quantumCore'],
  },
];

/** ERA_CONTENT[n] for n = 2..10; throws on other numbers. */
export function eraContent(n: number): EraContent {
  const c = ERA_CONTENT[n];
  if (!c) throw new Error(`no era content ${n}`);
  return c;
}

/** Every machine id of era n in section D order (ext, ext, proc, proc, any `more` processors, premium, cash). */
export function contentMachines(n: number): string[] {
  const m = eraContent(n).machines;
  return [...m.ext, ...m.proc, ...(m.more ?? []), m.premium, m.cash];
}
