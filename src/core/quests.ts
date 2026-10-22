/**
 * [MAIN] Quests (wave 8): short goals with cash rewards, shown three at a time in list order (ui/QuestPanel, B4).
 * Progress is read from state each check, so restore needs nothing but state.quests (ids done). A goal met while
 * it is not yet shown completes the moment it is shown. At most one completes per COMPLETE_GAP seconds, so a
 * burst reads as a sequence of toasts. Rewards go straight to the money; 'quest:done' drives the juice.
 *
 * 0.9.6 (F9): from era 2 on, the quests of the era the player is in come first (then older leftovers, then later
 * ones), so "Sell 60 chairs to the dog sleds" no longer sits above the era's own goals; and a reward is at least
 * QUEST_INCOME_SECONDS of the recent sales rate (core/incomeWindow.ts), fixed the moment the quest shows, so no
 * quest pays pocket change in a later era. Era 1 (age 1) is untouched.
 * 0.9.10 (READINESS C7): a small "first trade" quest (trade1) next to the first investment.
 */
import { AMENITY_IDS, GATE } from '../config';
import { CITY_BUILDINGS, DISTRICTS, ERAS, ERA_NAMES, eraNoun, ERA_SCALE, REGIONS, unlockCash, type CityBuildingKind } from '../eras/data';
import { IncomeWindow, sig2Money } from './incomeWindow';
import { settlementLevel, townHappiness } from './demand';
import { climbOpen, FINAL_GATE, FINAL_NAME, gateCount, gateNeed, gateSize } from '../eras/gate';
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
/** 0.9.10: set on the first buy or sell at the market ('market:trade'), so a sale at a loss still counts. */
export const TRADE_FLAG = 'seen:trade' as const;
const townBuilt = (s: GameState, pred: (id: string) => boolean = () => true) =>
  s.town.lots.filter((l) => l.tier >= 0 && l.building !== '' && pred(l.building)).length;
const amenitiesBuilt = (s: GameState) => AMENITY_IDS.filter((id) => s.town.amenities[id].tier >= 0).length;
const hiredAny = (s: GameState) => flag(s.upgrades.crateRunner > 0 || s.upgrades.cashier > 0 || s.upgrades.logHauler > 0);

export const QUEST_DEFS: readonly QuestDef[] = [
  { id: 'planks10', title: 'Sell 10 planks', target: 10, reward: 20, progress: (s) => s.stats.planksSold },
  { id: 'harvester', title: 'Build the harvester', target: 1, reward: 30, progress: (s) => flag(s.unlocked.harvester) },
  { id: 'chop150', title: 'Chop 150 logs', target: 150, reward: 40, progress: (s) => s.stats.logsChopped },
  { id: 'hamlet', title: 'Grow your camp into a Hamlet', target: 1, reward: 60, progress: (s) => s.village.level },
  { id: 'processor', title: 'Build the processor', target: 1, reward: 100, progress: (s) => flag(s.unlocked.processor) },
  { id: 'crates40', title: 'Sell 40 crates', target: 40, reward: 150, progress: (s) => s.stats.cratesSold },
  { id: 'hire', title: 'Hire your first helper', target: 1, reward: 250, progress: hiredAny },
  { id: 'conveyors', title: 'Build both conveyors', target: 2, reward: 300, progress: (s) => flag(s.unlocked.westConveyor) + flag(s.unlocked.eastConveyor) },
  { id: 'upgrades12', title: 'Buy 12 upgrades', target: 12, reward: 400, progress: (s) => s.stats.upgradesBought },
  { id: 'megaSaw', title: 'Build the mega sawmill', target: 1, reward: 600, progress: (s) => flag(s.unlocked.megaSaw) },
  { id: 'trucks20', title: 'Fill 20 trucks', target: 20, reward: 1000, progress: (s) => s.stats.trucksServed },
  { id: 'town', title: 'Grow your village into a Town', target: 3, reward: 1500, progress: (s) => s.village.level },
  { id: 'ridge', title: 'Open Timber Ridge', target: 1, reward: 2000, progress: (s) => flag(s.unlocked.ridge) },
  // Wave 9: the Market Town.
  { id: 'marketTown', title: 'Open the Market Town', target: 1, reward: 1500, progress: (s) => flag(s.town.revealed) },
  { id: 'firstBusiness', title: 'Open a farm or a bakery', target: 1, reward: 2000, progress: (s) => townBuilt(s, (id) => id === 'farm' || id === 'bakery') },
  { id: 'bunkhouse', title: 'Build the crew bunkhouse', target: 1, reward: 2500, progress: (s) => flag(s.quarters.tier >= 0) },
  { id: 'logs400', title: 'Sell 400 logs to trucks and trains', target: 400, reward: 3000, progress: (s) => s.stats.logsSold },
  { id: 'workshop', title: 'Open the furniture workshop', target: 1, reward: 3000, progress: (s) => flag(s.unlocked.workshop) },
  { id: 'goods50', title: 'Sell 50 goods to the townsfolk', target: 50, reward: 3000, progress: (s) => s.stats.goodsSold },
  { id: 'furniture60', title: 'Sell 60 chairs to the dog sleds', target: 60, reward: 4000, progress: (s) => s.stats.furnitureSold },
  { id: 'shelters20', title: 'Complete 20 shelter builds', target: 20, reward: 4000, progress: (s) => s.stats.sheltersBuilt },
  { id: 'town4', title: 'Fill 4 lots in Market Town', target: 4, reward: 5000, progress: (s) => townBuilt(s) },
  { id: 'winterCity', title: 'Grow your Town into a Winter City', target: 4, reward: 6000, progress: (s) => s.village.level },
  { id: 'earn150k', title: 'Earn $150,000 in total', target: 150000, reward: 6000, progress: (s) => s.stats.moneyEarned },
  { id: 'greatLodge', title: 'Build the Great Lodge', target: 1, reward: 10000, progress: (s) => flag(s.village.greatLodge.tier >= 0) },
  // Wave 12: amenities and town happiness.
  { id: 'amenity1', title: 'Build something cozy on the square', target: 1, reward: 1500, progress: amenitiesBuilt },
  { id: 'happy50', title: 'Reach 50% town happiness', target: 50, reward: 3000, progress: (s) => Math.round(townHappiness(s) * 100) },
  { id: 'amenity4', title: 'Build every amenity', target: 4, reward: 12000, progress: amenitiesBuilt },
  // 0.9.0: the ages (after every Survival quest above, so era 1 reads exactly as before).
  ...eraQuests(),
];

/**
 * 0.9.0: a few goals per era (the first machine, Jack, the market, the city), one per era gate and one per era reached. Rewards are era
 * economy (× ERA_SCALE, or a share of unlockCash); Jack's stays a Survival-sized tip.
 */
function eraQuests(): QuestDef[] {
  const age = (s: GameState) => s.eras.age;
  const reach = (n: number): QuestDef => ({
    id: `era${n}`,
    title: n === 2 ? `Expand to ${ERAS[2]!.region}` : `Reach the ${eraNoun(n)}`,
    target: n,
    reward: Math.round(unlockCash(n) * 0.1),
    progress: age,
  });
  // 0.9.0 climb (docs/EXPANSION.md §C): one quest per gate, before the era it opens; only once the Great Lodge opens the
  // climb (era 1 below it reads exactly as 0.8.0). An era already reached counts its gate as met.
  const gate = (n: number): QuestDef => ({
    id: `gate${n}`,
    // literal mode: the previous era's own upgrades, named by era (0.9.6: "All Granite Hollow upgrades" read as only
    // that region's, though the era's finance is bought at the cabin; "All upgrades" meant Survival's only)
    title: GATE.mode === 'literal' ? `All ${ERAS[n - 1]?.region ?? ERA_NAMES[n - 1]} upgrades Lv ${gateNeed(n)}` : `All upgrades Lv ${gateNeed(n)}`,
    target: gateSize(n),
    reward: Math.round((unlockCash(n) * 0.05) / 1000) * 1000,
    unlocked: climbOpen,
    progress: (s) => (s.eras.age >= n ? gateSize(n) : gateCount(s, n).ok),
  });
  const out: QuestDef[] = [
    gate(2),
    reach(2),
    ...questTrio(2),
    { id: 'machine1', title: 'Build your first era machine', target: 1, reward: 25000 * ERA_SCALE, progress: (s) => s.stats.machinesBuilt },
    { id: 'jack1', title: "Sell something at Jack's cart", target: 1, reward: 5000, progress: (s) => flag(s.stats.jackEarned > 0) },
    { id: 'materials100', title: 'Make 100 era materials', target: 100, reward: 40000 * ERA_SCALE, progress: (s) => s.stats.materialsMade },
    { id: 'city1', title: 'Build in the city', target: 1, reward: 50000 * ERA_SCALE, progress: (s) => s.stats.cityBuilt },
    { id: 'invest1', title: 'Make an investment at the market', target: 1, reward: 30000 * ERA_SCALE, progress: (s) => flag(s.market.investments.length > 0 || s.stats.investEarned > 0) },
    // 0.9.10 (READINESS C7): a small first trade, paid like Jack's tip (the era-2 floor below still applies)
    { id: 'trade1', title: 'Buy or sell a good at the market', target: 1, reward: 5000, progress: (s) => flag(!!s.flags[TRADE_FLAG] || s.stats.tradeProfit > 0 || Object.keys(s.market.holdings).length > 0) },
    gate(3),
    reach(3),
    ...questTrio(3),
    { id: 'machines6', title: 'Run 6 era machines', target: 6, reward: 120000 * ERA_SCALE, progress: (s) => s.eras.regions.reduce((n, r) => n + r.slots.filter((x) => x.machine !== '' && x.tier >= 0).length, 0) },
    { id: 'city12', title: 'Build 12 city buildings', target: 12, reward: 250000 * ERA_SCALE, progress: (s) => s.stats.cityBuilt },
  ];
  for (let n = 4; n <= 10; n++) {
    out.push(gate(n), reach(n), ...questTrio(n));
    out.push({ id: `materials${n}`, title: `Make ${(n * 250).toLocaleString('en-US')} era materials`, target: n * 250, reward: Math.round(unlockCash(n) * 0.05), progress: (s) => s.stats.materialsMade });
  }
  out.push({ id: 'city60', title: 'Build 60 city buildings', target: 60, reward: Math.round(unlockCash(10) * 0.2), progress: (s) => s.stats.cityBuilt });
  // 0.9.7: the last goal, the final gate (era 10's own things at Lv 10; the 100 % award, core/completion.ts, counts it)
  out.push({
    id: `gate${FINAL_GATE}`,
    title: `${FINAL_NAME}: all ${ERAS[FINAL_GATE - 1]?.region ?? ERA_NAMES[FINAL_GATE - 1]} upgrades Lv ${gateNeed(FINAL_GATE)}`,
    target: gateSize(FINAL_GATE),
    reward: Math.round((unlockCash(10) * 0.1) / 1000) * 1000,
    unlocked: (s) => s.eras.age >= FINAL_GATE - 1,
    progress: (s) => gateCount(s, FINAL_GATE).ok,
  });
  // the new land, pad and machines stay hidden until the Great Lodge: no era quest shows before it (era 1 reads as 0.8.0)
  const open = (s: GameState): boolean => climbOpen(s) || s.eras.age >= 2;
  // 0.9.9: a later era's goal waits for its era. "Make 2,500 era materials" counts every era's materials, so from era 2
  // it paid era 4-10 rewards (about 740M) long before those eras, more than era 2 and 3 cost to finish (Dino: "a
  // million every couple of minutes")
  const inEra = (d: QuestDef) => (s: GameState): boolean => open(s) && s.eras.age >= questEra(d.id);
  return out.map((d) => (d.unlocked ? d : { ...d, unlocked: questEra(d.id) <= 2 ? open : inEra(d) }));
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
const SURVIVAL_QUESTS: readonly QuestDef[] = QUEST_DEFS.slice(0, QUEST_DEFS.findIndex((d) => d.id === 'gate2'));

/** The era a quest belongs to: Survival's are 1, a gate or reach quest the era it is earned in, a trio its era. */
export function questEra(id: string): number {
  const m = /^(gate|era|trio|materials)(\d+)/.exec(id);
  if (m) {
    const n = Number(m[2]);
    if (m[1] === 'materials' && n === 100) return 2;
    return m[1] === 'gate' || m[1] === 'era' ? n - 1 : n;
  }
  if (id === 'machines6' || id === 'city12') return 3;
  if (id === 'city60') return 10;
  if (['machine1', 'jack1', 'city1', 'invest1', 'trade1'].includes(id)) return 2;
  return 1;
}

/** Seconds of the recent sales rate every quest reward is worth at least, from era 2 on. */
export const QUEST_INCOME_SECONDS = 60;

/** How many quests are shown (and checked) at once. */
export const ACTIVE_QUESTS = 3;
const COMPLETE_GAP = 1.5;
const CHECK_EVERY = 0.25;

export interface ActiveQuest {
  def: QuestDef;
  /** 0..target */
  progress: number;
  /** What completing it pays (def.reward in era 1; at least QUEST_INCOME_SECONDS of sales from era 2 on). */
  reward: number;
}

export class Quests {
  private check = 0;
  private gap = 0;
  private readonly income: IncomeWindow;

  /** `carried`: the saved sales rate ($/s), so a quest first shown just after a load is not priced from an empty window. */
  constructor(
    private readonly state: GameState,
    private readonly economy: Economy,
    private readonly events: EventBus<GameEvents>,
    carried = 0,
  ) {
    this.income = new IncomeWindow(carried);
    events.on('sale', (e) => {
      if (e.buyer !== 'jack') this.income.add(e.amount);
    });
    events.on('market:trade', () => {
      state.flags[TRADE_FLAG] = true;
    });
  }

  /**
   * The quests on show right now: the first ACTIVE_QUESTS not done, in list order; from era 2 on the current era's
   * first (after any already met), then older ones, then later ones (stable within each).
   */
  active(): ActiveQuest[] {
    const age = this.state.eras.age;
    const open = QUEST_DEFS.filter((def) => !this.state.quests[def.id] && !(def.unlocked && !def.unlocked(this.state)));
    // a goal already met comes first, so it pays out at once instead of waiting for a free row
    const rank = (def: QuestDef): number => {
      if (def.progress(this.state) >= def.target) return -1;
      const e = questEra(def.id);
      return e === age ? 0 : e < age ? 1 : 2;
    };
    const ordered = age >= 2 ? open.map((d, i) => ({ d, i })).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i).map((x) => x.d) : open;
    return ordered.slice(0, ACTIVE_QUESTS).map((def) => ({ def, progress: Math.min(def.target, Math.max(0, def.progress(this.state))), reward: this.rewardOf(def) }));
  }

  /**
   * def.reward in era 1; from era 2 on at least QUEST_INCOME_SECONDS of recent sales, fixed when first asked.
   * 0.9.12 (E4): the fixed reward is saved (state.questRewards), so a reload no longer turns $120,000 into $5,000.
   */
  private rewardOf(def: QuestDef): number {
    if (this.state.eras.age < 2) return def.reward;
    let r = this.state.questRewards[def.id];
    if (r === undefined) {
      r = Math.max(def.reward, sig2Money(this.income.rate * QUEST_INCOME_SECONDS));
      this.state.questRewards[def.id] = r;
    }
    return r;
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
    this.income.tick(dt);
    this.gap -= dt;
    this.check -= dt;
    if (this.check > 0 || this.gap > 0) return;
    this.check = CHECK_EVERY;
    const ready = this.active().find((q) => q.progress >= q.def.target);
    if (!ready) return;
    this.complete(ready.def, ready.reward);
  }

  private complete(def: QuestDef, reward: number): void {
    this.state.quests[def.id] = true;
    this.gap = COMPLETE_GAP;
    delete this.state.questRewards[def.id];
    this.economy.add(reward);
    this.events.emit('quest:done', { id: def.id, title: def.title, reward });
  }
}

/** What era n's quest trio still wants in its district, ignoring lot `skip`: homes and the landmark, and the empty lots left. */
function trioNeeds(s: GameState, n: number, skip: number): { homes: number; landmark: number; free: number } | null {
  const lots = s.city.districts[n]?.lots;
  if (!lots) return null;
  const others = lots.filter((_, i) => i !== skip);
  const chosen = (k: CityBuildingKind): number => others.filter((l) => l.building !== '' && CITY_BUILDINGS[l.building].kind === k).length;
  const target = Math.max(1, (DISTRICTS[n]?.lots ?? 2) - 2);
  return {
    homes: s.quests[`trio${n}homes`] ? 0 : Math.max(0, target - chosen('home')),
    landmark: s.quests[`trio${n}landmark`] || chosen('landmark') > 0 ? 0 : 1,
    free: others.filter((l) => l.building === '').length,
  };
}

const wantText = (homes: number, landmark: number): string =>
  [homes > 0 ? `${homes} more home${homes === 1 ? '' : 's'}` : '', landmark ? 'the landmark' : ''].filter(Boolean).join(' and ');

/**
 * 0.9.12 (R4): a heads-up on the city choose card. Era n's quest trio wants (lots − 2) homes and the landmark in its
 * district, so a park or a workplace on lot `lot` can leave too few lots and force a demolish later. Returns the
 * warning when picking a building of `kind` there would do that (undefined when it is fine or both goals are done).
 * When even this lot can't make room any more (a district already full of workplaces), it says what has to come down.
 */
export function trioRoomWarning(s: GameState, n: number, lot: number, kind: CityBuildingKind): string | undefined {
  if (kind === 'home' || kind === 'landmark') return undefined;
  const t = trioNeeds(s, n, lot);
  if (!t || t.homes + t.landmark <= t.free) return undefined;
  const want = wantText(t.homes, t.landmark);
  if (t.homes + t.landmark > t.free + 1) return `Your quests need ${want} here, more than the empty lots. Take down a workplace or park to make room`;
  return `Leaves too few lots for your quests: ${want} here`;
}

/**
 * 0.9.12 (R4, Validator note): the manage card of a built workplace or park, when the district has no room left for
 * its quest trio (more homes and landmark wanted than empty lots), says this building can make room.
 */
export function trioMakeRoomNote(s: GameState, n: number, lot: number, kind: CityBuildingKind): string | undefined {
  if (kind === 'home' || kind === 'landmark') return undefined;
  const t = trioNeeds(s, n, lot);
  if (!t || t.homes + t.landmark <= t.free) return undefined;
  return `Your quests need ${wantText(t.homes, t.landmark)} here. Taking this down makes room`;
}
