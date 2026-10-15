/**
 * [MAIN] Quests (wave 8): short goals with cash rewards, shown three at a time in list order (ui/QuestPanel, B4).
 * Progress is read from state each check, so restore needs nothing but state.quests (ids done). A goal met while
 * it is not yet shown completes the moment it is shown. At most one completes per COMPLETE_GAP seconds, so a
 * burst reads as a sequence of toasts. Rewards go straight to the money; 'quest:done' drives the juice.
 */
import { AMENITY_IDS } from '../config';
import { CITY_BUILDINGS, DISTRICTS, ERAS, REGIONS, unlockCash, type CityBuildingKind } from '../eras/data';
import { settlementLevel, townHappiness } from './demand';
import type { Economy } from './Economy';
import type { EventBus } from './EventBus';
import type { GameEvents, GameState } from './types';

export interface QuestDef {
  readonly id: string;
  readonly title: string;
  readonly target: number;
  readonly reward: number;
  /** Current progress toward `target` (clamped by the caller). */
  progress(s: GameState): number;
  /** Shown only once this is true (absent = always); a locked quest is skipped, it never blocks the list. */
  unlocked?(s: GameState): boolean;
}

const flag = (b: boolean) => (b ? 1 : 0);
const townBuilt = (s: GameState, pred: (id: string) => boolean = () => true) =>
  s.town.lots.filter((l) => l.tier >= 0 && l.building !== '' && pred(l.building)).length;
const amenitiesBuilt = (s: GameState) => AMENITY_IDS.filter((id) => s.town.amenities[id].tier >= 0).length;
const hiredAny = (s: GameState) => flag(s.upgrades.crateRunner > 0 || s.upgrades.cashier > 0 || s.upgrades.logHauler > 0);

export const QUEST_DEFS: readonly QuestDef[] = [
  { id: 'planks10', title: 'Sell 10 plank bundles', target: 10, reward: 20, progress: (s) => s.stats.planksSold },
  { id: 'harvester', title: 'Build the harvester', target: 1, reward: 30, progress: (s) => flag(s.unlocked.harvester) },
  { id: 'chop150', title: 'Chop 150 logs', target: 150, reward: 40, progress: (s) => s.stats.logsChopped },
  { id: 'hamlet', title: 'Grow the camp into a Hamlet', target: 1, reward: 60, progress: (s) => s.village.level },
  { id: 'processor', title: 'Build the processor', target: 1, reward: 100, progress: (s) => flag(s.unlocked.processor) },
  { id: 'crates40', title: 'Sell 40 crates', target: 40, reward: 150, progress: (s) => s.stats.cratesSold },
  { id: 'hire', title: 'Hire your first helper', target: 1, reward: 250, progress: hiredAny },
  { id: 'conveyors', title: 'Build both conveyors', target: 2, reward: 300, progress: (s) => flag(s.unlocked.westConveyor) + flag(s.unlocked.eastConveyor) },
  { id: 'upgrades12', title: 'Buy 12 upgrades', target: 12, reward: 400, progress: (s) => s.stats.upgradesBought },
  { id: 'megaSaw', title: 'Build the mega sawmill', target: 1, reward: 600, progress: (s) => flag(s.unlocked.megaSaw) },
  { id: 'trucks20', title: 'Fill 20 trucks', target: 20, reward: 1000, progress: (s) => s.stats.trucksServed },
  { id: 'town', title: 'Grow the village into a Town', target: 3, reward: 1500, progress: (s) => s.village.level },
  { id: 'ridge', title: 'Open Timber Ridge', target: 1, reward: 2000, progress: (s) => flag(s.unlocked.ridge) },
  // Wave 9: the Market Town.
  { id: 'marketTown', title: 'Open the Market Town', target: 1, reward: 1500, progress: (s) => flag(s.town.revealed) },
  { id: 'firstBusiness', title: 'Open a farm or a bakery', target: 1, reward: 2000, progress: (s) => townBuilt(s, (id) => id === 'farm' || id === 'bakery') },
  { id: 'bunkhouse', title: 'Build the crew bunkhouse', target: 1, reward: 2500, progress: (s) => flag(s.quarters.tier >= 0) },
  { id: 'logs400', title: 'Sell 400 logs to trucks and trains', target: 400, reward: 3000, progress: (s) => s.stats.logsSold },
  { id: 'workshop', title: 'Open the furniture workshop', target: 1, reward: 3000, progress: (s) => flag(s.unlocked.workshop) },
  { id: 'goods50', title: 'Sell 50 loaves to the townsfolk', target: 50, reward: 3000, progress: (s) => s.stats.goodsSold },
  { id: 'furniture60', title: 'Sell 60 chairs to the dog sleds', target: 60, reward: 4000, progress: (s) => s.stats.furnitureSold },
  { id: 'shelters20', title: 'Complete 20 shelter builds', target: 20, reward: 4000, progress: (s) => s.stats.sheltersBuilt },
  { id: 'town4', title: 'Fill 4 town lots', target: 4, reward: 5000, progress: (s) => townBuilt(s) },
  { id: 'winterCity', title: 'Grow the town into a Winter City', target: 4, reward: 6000, progress: (s) => s.village.level },
  { id: 'earn150k', title: 'Earn $150,000 in total', target: 150000, reward: 6000, progress: (s) => s.stats.moneyEarned },
  { id: 'greatLodge', title: 'Build the Great Lodge', target: 1, reward: 10000, progress: (s) => flag(s.village.greatLodge.tier >= 0) },
  // Wave 12: amenities and town happiness.
  { id: 'amenity1', title: 'Build something cosy on the square', target: 1, reward: 1500, progress: amenitiesBuilt },
  { id: 'happy50', title: 'Reach 50% town happiness', target: 50, reward: 3000, progress: (s) => Math.round(townHappiness(s) * 100) },
  { id: 'amenity4', title: 'Build every amenity', target: 4, reward: 12000, progress: amenitiesBuilt },
  // 0.9.0: the ages (after every Survival quest above, so era 1 reads exactly as before).
  ...eraQuests(),
];

/** 0.9.0: a few goals per era (the first machine, Jack, the market, the city) and one per era reached. */
function eraQuests(): QuestDef[] {
  const age = (s: GameState) => s.eras.age;
  const reach = (n: number): QuestDef => ({
    id: `era${n}`,
    title: n === 2 ? `Expand to ${ERAS[2]!.region}` : `Reach the ${ERAS[n]!.name} era`,
    target: n,
    reward: Math.round(unlockCash(n) * 0.1),
    progress: age,
  });
  const out: QuestDef[] = [
    reach(2),
    ...questTrio(2),
    { id: 'machine1', title: 'Build your first era machine', target: 1, reward: 25000, progress: (s) => s.stats.machinesBuilt },
    { id: 'jack1', title: "Sell something at Jack's cart", target: 1, reward: 5000, progress: (s) => flag(s.stats.jackEarned > 0) },
    { id: 'materials100', title: 'Make 100 era materials', target: 100, reward: 40000, progress: (s) => s.stats.materialsMade },
    { id: 'city1', title: 'Build in the city', target: 1, reward: 50000, progress: (s) => s.stats.cityBuilt },
    { id: 'invest1', title: 'Make an investment at the market', target: 1, reward: 30000, progress: (s) => flag(s.market.investments.length > 0 || s.stats.investEarned > 0) },
    reach(3),
    ...questTrio(3),
    { id: 'machines6', title: 'Run 6 era machines', target: 6, reward: 120000, progress: (s) => s.eras.regions.reduce((n, r) => n + r.slots.filter((x) => x.machine !== '' && x.tier >= 0).length, 0) },
    { id: 'city12', title: 'Build 12 city buildings', target: 12, reward: 250000, progress: (s) => s.stats.cityBuilt },
  ];
  for (let n = 4; n <= 10; n++) {
    out.push(reach(n), ...questTrio(n));
    out.push({ id: `materials${n}`, title: `Make ${(n * 250).toLocaleString('en-US')} era materials`, target: n * 250, reward: Math.round(unlockCash(n) * 0.05), progress: (s) => s.stats.materialsMade });
  }
  out.push({ id: 'city60', title: 'Build 60 city buildings', target: 60, reward: Math.round(unlockCash(10) * 0.2), progress: (s) => s.stats.cityBuilt });
  return out;
}

/** Built city buildings of `kind` in district n. */
const districtBuilt = (s: GameState, n: number, kind: CityBuildingKind): number =>
  (s.city.districts[n]?.lots ?? []).filter((l) => l.tier >= 0 && l.building !== '' && CITY_BUILDINGS[l.building].kind === kind).length;

/**
 * Settlement perk j = 1 (docs/EXPANSION.md §B): era n's quest trio unlocks at the first level of its band
 * (settlement 5·(n − 1) + 1): homes in its district, every machine slot of its region, its landmark.
 */
function questTrio(n: number): QuestDef[] {
  const e = ERAS[n]!;
  const homes = Math.max(1, (DISTRICTS[n]?.lots ?? 2) - 2);
  const slots = REGIONS[n]?.slots ?? 1;
  const landmark = Object.values(CITY_BUILDINGS).find((d) => d.era === n && d.kind === 'landmark');
  const unlocked = (s: GameState): boolean => settlementLevel(s) >= 5 * (n - 1) + 1;
  const reward = (share: number): number => Math.round((unlockCash(n) * share) / 1000) * 1000;
  return [
    { id: `trio${n}homes`, title: `Build ${homes} homes in ${e.district}`, target: homes, reward: reward(0.04), unlocked, progress: (s) => districtBuilt(s, n, 'home') },
    { id: `trio${n}machines`, title: `Fill all ${slots} machine slots in ${e.region}`, target: slots, reward: reward(0.06), unlocked, progress: (s) => s.eras.regions[n]?.slots.filter((x) => x.machine !== '' && x.tier >= 0).length ?? 0 },
    { id: `trio${n}landmark`, title: `Raise the ${landmark?.label ?? 'landmark'} in ${e.district}`, target: 1, reward: reward(0.08), unlocked, progress: (s) => districtBuilt(s, n, 'landmark') },
  ];
}

/** The era-1 quests (everything before the first era quest). */
const SURVIVAL_QUESTS: readonly QuestDef[] = QUEST_DEFS.slice(0, QUEST_DEFS.findIndex((d) => d.id === 'era2'));

/** How many quests are shown (and checked) at once. */
export const ACTIVE_QUESTS = 3;
const COMPLETE_GAP = 1.5;
const CHECK_EVERY = 0.25;

export interface ActiveQuest {
  def: QuestDef;
  /** 0..target */
  progress: number;
}

export class Quests {
  private check = 0;
  private gap = 0;

  constructor(
    private readonly state: GameState,
    private readonly economy: Economy,
    private readonly events: EventBus<GameEvents>,
  ) {}

  /** The quests on show right now (first ACTIVE_QUESTS not done, in list order). */
  active(): ActiveQuest[] {
    const out: ActiveQuest[] = [];
    for (const def of QUEST_DEFS) {
      if (this.state.quests[def.id] || (def.unlocked && !def.unlocked(this.state))) continue;
      out.push({ def, progress: Math.min(def.target, Math.max(0, def.progress(this.state))) });
      if (out.length >= ACTIVE_QUESTS) break;
    }
    return out;
  }

  /** Quests counted on the panel: era 1 counts the Survival list only (as in 0.8.0) until the ages are in play. */
  private counted(): readonly QuestDef[] {
    const survivalDone = SURVIVAL_QUESTS.every((d) => this.state.quests[d.id]);
    return this.state.eras.age >= 2 || survivalDone ? QUEST_DEFS : SURVIVAL_QUESTS;
  }

  get doneCount(): number {
    return this.counted().filter((d) => this.state.quests[d.id]).length;
  }

  get total(): number {
    return this.counted().length;
  }

  update(dt: number): void {
    this.gap -= dt;
    this.check -= dt;
    if (this.check > 0 || this.gap > 0) return;
    this.check = CHECK_EVERY;
    const ready = this.active().find((q) => q.progress >= q.def.target);
    if (!ready) return;
    this.complete(ready.def);
  }

  private complete(def: QuestDef): void {
    this.state.quests[def.id] = true;
    this.gap = COMPLETE_GAP;
    this.economy.add(def.reward);
    this.events.emit('quest:done', { id: def.id, title: def.title, reward: def.reward });
  }
}
