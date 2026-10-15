/**
 * [MAIN] Quests (wave 8): short goals with cash rewards, shown three at a time in list order (ui/QuestPanel, B4).
 * Progress is read from state each check, so restore needs nothing but state.quests (ids done). A goal met while
 * it is not yet shown completes the moment it is shown. At most one completes per COMPLETE_GAP seconds, so a
 * burst reads as a sequence of toasts. Rewards go straight to the money; 'quest:done' drives the juice.
 */
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
}

const flag = (b: boolean) => (b ? 1 : 0);
const townBuilt = (s: GameState, pred: (id: string) => boolean = () => true) =>
  s.town.lots.filter((l) => l.tier >= 0 && l.building !== '' && pred(l.building)).length;
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
  { id: 'winterCity', title: 'Reach the Winter City era', target: 4, reward: 6000, progress: (s) => s.village.level },
  { id: 'earn150k', title: 'Earn $150,000 in total', target: 150000, reward: 6000, progress: (s) => s.stats.moneyEarned },
  { id: 'greatLodge', title: 'Build the Great Lodge', target: 1, reward: 10000, progress: (s) => flag(s.village.greatLodge.tier >= 0) },
];

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
      if (this.state.quests[def.id]) continue;
      out.push({ def, progress: Math.min(def.target, Math.max(0, def.progress(this.state))) });
      if (out.length >= ACTIVE_QUESTS) break;
    }
    return out;
  }

  get doneCount(): number {
    return QUEST_DEFS.filter((d) => this.state.quests[d.id]).length;
  }

  get total(): number {
    return QUEST_DEFS.length;
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
