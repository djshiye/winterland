/**
 * [PURE] 0.9.7 the 100 % completionist award (REQUIREMENTS R11; plan decision 4): how much of Winterland this season
 * has done, as one number that is a pure function of the save, and the next thing still missing. No THREE.
 *
 * What counts (COMPLETION, the one table; tests/completion.test.ts pins every row and count):
 * - Upgrades (40 %): every upgrade id of every era at Lv 10. Each level counts (min(level, 10)), so every pad press
 *   moves the bar.
 * - Builds (20 %): Survival's ten machine pads, the eight village plots up to Lodge, the Great Lodge, the bunkhouse up
 *   to Crew Hall, the Market Town lots, its amenities and the Grand Market, every era region's machine slots and every
 *   city district lot.
 * - Quests (15 %): every quest (core/quests.ts), the last one being "Winterland Complete".
 * - Settlement (15 %): level / 50.
 * - Eras (10 %): eras reached / 10.
 * Left out on purpose: money, contracts, random events, investments (random or unbounded).
 *
 * 100 % only when every row is full: anything short reads at most 99 %.
 */
import { AMENITY_IDS, PADS, QUARTERS, UPGRADES, VILLAGE, type PadIdConst } from '../config';
import { CITY_BUILDINGS, DISTRICTS, ERAS, MAX_ERA } from '../eras/data';
import { QUEST_DEFS, type QuestDef } from './quests';
import { settlementLevel } from './demand';
import { ERA_AT_LENGTH, type GameState, type RunRecord, type UpgradeId } from './types';

/** The level every upgrade finishes at (the per-era Lv 10 rule, R17). */
export const COMPLETE_LEVEL = 10;
/** The settlement level 100 % asks. */
export const COMPLETE_SETTLEMENT = 50;

/** One thing that counts: `have` of `need` (a flag is 0 / 1; an upgrade is its level of 10). */
export interface CompletionItem {
  id: string;
  /** What to do, as the era chip says it after "Next: ". */
  label: string;
  have: number;
  need: number;
  /** Where Go takes the player (ui/GateCard.ts goTarget ids), if anywhere. */
  target?: string;
}

export type CompletionKey = 'upgrades' | 'builds' | 'quests' | 'settlement' | 'eras';

export interface CompletionCategory {
  key: CompletionKey;
  label: string;
  /** Share of the 100 % (the weights add up to 1). */
  weight: number;
  items(s: GameState): CompletionItem[];
}

const flag = (b: boolean): number => (b ? 1 : 0);
const built = (p: { building: string; tier: number }): boolean => p.building !== '' && p.tier >= 0;

function upgradeItems(s: GameState): CompletionItem[] {
  return (Object.keys(UPGRADES) as UpgradeId[]).map((id) => ({
    id: `upgrade:${id}`,
    label: `${UPGRADES[id].label} → Lv ${COMPLETE_LEVEL}`,
    have: Math.max(0, Math.min(COMPLETE_LEVEL, s.upgrades[id] ?? 0)),
    need: COMPLETE_LEVEL,
  }));
}

function buildItems(s: GameState): CompletionItem[] {
  const out: CompletionItem[] = [];
  // the era regions and districts first: the chip points at the newest land before old Survival leftovers
  for (let n = MAX_ERA; n >= 2; n--) {
    const e = ERAS[n];
    if (!e) continue;
    const slots = s.eras.regions[n]?.slots ?? [];
    slots.forEach((slot, i) => {
      out.push({ id: `slot:${n}:${i}`, label: `Fill a machine slot in ${e.region}`, have: flag(slot.machine !== '' && slot.tier >= 0), need: 1, target: `region:${n}` });
    });
    const d = DISTRICTS[n];
    const lots = s.city.districts[n]?.lots ?? [];
    lots.forEach((lot, i) => {
      out.push({ id: `lot:${n}:${i}`, label: `Build on an empty lot in ${d?.name ?? e.district}`, have: flag(built(lot) && lot.building in CITY_BUILDINGS), need: 1, target: `district:${n}` });
    });
  }
  for (const id of Object.keys(PADS) as PadIdConst[]) {
    out.push({ id: `pad:${id}`, label: `Build the ${PADS[id].label.toLowerCase()}`, have: flag(!!s.unlocked[id]), need: 1, target: `pad:${id}` });
  }
  const top = VILLAGE.tiers.length;
  s.village.plots.forEach((p, i) => {
    out.push({ id: `plot:${i}`, label: `Grow a village shelter into a ${VILLAGE.tiers[top - 1]!.label}`, have: Math.max(0, Math.min(top, p.tier + 1)), need: top, target: 'village' });
  });
  out.push({ id: 'greatLodge', label: 'Build the Great Lodge', have: flag(s.village.greatLodge.tier >= 0), need: 1, target: 'village' });
  const qt = QUARTERS.tiers.length;
  out.push({ id: 'quarters', label: `Grow the bunkhouse into a ${QUARTERS.tiers[qt - 1]!.label}`, have: Math.max(0, Math.min(qt, s.quarters.tier + 1)), need: qt, target: 'quarters' });
  s.town.lots.forEach((lot, i) => {
    out.push({ id: `town:${i}`, label: 'Open a business in the Market Town', have: flag(built(lot)), need: 1, target: 'town' });
  });
  for (const id of AMENITY_IDS) out.push({ id: `amenity:${id}`, label: 'Build every amenity on the square', have: flag(s.town.amenities[id].tier >= 0), need: 1, target: 'town' });
  out.push({ id: 'grandMarket', label: 'Open the Grand Market', have: flag(s.town.grandMarket.tier >= 0), need: 1, target: 'town' });
  return out;
}

/** Survival quests that are done at one place (the rest are sales goals, done anywhere). */
const SURVIVAL_QUEST_TARGETS: Readonly<Record<string, string>> = {
  harvester: 'pad:harvester', processor: 'pad:processor', megaSaw: 'pad:megaSaw', workshop: 'pad:workshop',
  conveyors: 'pad:westConveyor', ridge: 'pad:ridge', hire: 'shop', upgrades12: 'shop',
  hamlet: 'village', town: 'village', winterCity: 'village', shelters20: 'village', greatLodge: 'village',
  marketTown: 'village', firstBusiness: 'town', town4: 'town', amenity1: 'town', amenity4: 'town', happy50: 'town', goods50: 'town',
  bunkhouse: 'quarters',
};

/**
 * Where a quest is done, for the Go button once quests are all the chip has left (validator #41 note 3): an era
 * trio's district or region, a gate's region, a city goal the newest district; null for goals done anywhere.
 */
export function questTarget(s: GameState, id: string): string | undefined {
  const trio = /^trio(\d+)(homes|machines|landmark)$/.exec(id);
  if (trio) return `${trio[2] === 'machines' ? 'region' : 'district'}:${trio[1]}`;
  const gate = /^gate(\d+)$/.exec(id);
  if (gate) return Number(gate[1]) >= 3 ? `region:${Number(gate[1]) - 1}` : 'shop';
  const newest = Math.max(2, Math.min(MAX_ERA, s.eras.age));
  if (/^(city\d+|city1)$/.test(id)) return `district:${newest}`;
  if (/^(materials\d+|machine1|machines6)$/.test(id)) return `region:${newest}`;
  if (id === 'invest1') return 'town';
  return SURVIVAL_QUEST_TARGETS[id];
}

/** A district quest that needs a lot of its kind while every lot is taken by something else: say to free one. */
function questLabel(s: GameState, d: QuestDef): string {
  const trio = /^trio(\d+)(homes|landmark)$/.exec(d.id);
  if (trio && d.progress(s) < d.target) {
    const lots = s.city.districts[Number(trio[1])]?.lots ?? [];
    if (lots.length > 0 && lots.every(built)) return `Quest: ${d.title} (demolish a building to free a lot)`;
  }
  return `Quest: ${d.title}`;
}

function questItems(s: GameState): CompletionItem[] {
  return QUEST_DEFS.map((d) => ({ id: `quest:${d.id}`, label: questLabel(s, d), have: flag(!!s.quests[d.id]), need: 1, target: questTarget(s, d.id) }));
}

function settlementItems(s: GameState): CompletionItem[] {
  const level = settlementLevel(s);
  const age = Math.max(2, Math.min(MAX_ERA, s.eras.age));
  return [{ id: 'settlement', label: `Grow the city → Settlement ${Math.min(COMPLETE_SETTLEMENT, level + 1)}`, have: Math.min(COMPLETE_SETTLEMENT, level), need: COMPLETE_SETTLEMENT, target: `district:${age}` }];
}

function eraItems(s: GameState): CompletionItem[] {
  return [{ id: 'eras', label: `Reach the ${ERAS[Math.min(MAX_ERA, s.eras.age + 1)]?.name ?? 'next'} era`, have: Math.max(1, Math.min(MAX_ERA, s.eras.age)), need: MAX_ERA }];
}

/** The one table: what 100 % is made of, in the order the stats page and the gate card list it. */
export const COMPLETION: readonly CompletionCategory[] = [
  { key: 'upgrades', label: 'Upgrades', weight: 0.4, items: upgradeItems },
  { key: 'builds', label: 'Builds', weight: 0.2, items: buildItems },
  { key: 'quests', label: 'Quests', weight: 0.15, items: questItems },
  { key: 'settlement', label: 'Settlement', weight: 0.15, items: settlementItems },
  { key: 'eras', label: 'Eras', weight: 0.1, items: eraItems },
];

export interface CompletionPart {
  key: CompletionKey;
  label: string;
  weight: number;
  /** Sum of the items' have / need. */
  have: number;
  need: number;
  /** have / need, 0..1. */
  frac: number;
  /** Items done of items (what the bars print: "Builds 112/176"). */
  done: number;
  total: number;
}

export interface Completion {
  /** Whole percent, 0..100; 100 only when every part is full. */
  pct: number;
  parts: CompletionPart[];
  complete: boolean;
}

/** This season's completion (cheap enough to run a few times a second: ~600 small items). */
export function completion(s: GameState): Completion {
  let sum = 0;
  let full = true;
  const parts = COMPLETION.map((c) => {
    const items = c.items(s);
    let have = 0;
    let need = 0;
    let done = 0;
    for (const it of items) {
      const h = Math.max(0, Math.min(it.need, it.have));
      have += h;
      need += it.need;
      if (h >= it.need) done++;
    }
    const frac = need > 0 ? have / need : 1;
    if (done < items.length) full = false;
    sum += c.weight * frac;
    return { key: c.key, label: c.label, weight: c.weight, have, need, frac, done, total: items.length };
  });
  const raw = Math.floor(sum * 100 + 1e-9);
  const pct = full ? 100 : Math.max(0, Math.min(99, raw));
  return { pct, parts, complete: full };
}

/**
 * The next thing still missing, for the era chip once the climb's goal line is done (eras/gate.ts nextGoal returns
 * null after the final gate): the settlement first, then builds (newest land first), quests, upgrades and eras.
 * Null at 100 %.
 */
export function nextMissing(s: GameState): CompletionItem | null {
  const order: CompletionKey[] = ['settlement', 'builds', 'quests', 'upgrades', 'eras'];
  for (const key of order) {
    const cat = COMPLETION.find((c) => c.key === key)!;
    for (const it of cat.items(s)) if (it.have < it.need) return it;
  }
  return null;
}

/** "★ 63%" (the era chip's tag). */
export function completionTag(pct: number): string {
  return `★ ${pct}%`;
}

/**
 * Seconds spent in each era this season, index = era (1..10; 0 unused). The current era runs to `now` (playTime) or to
 * the 100 % moment; −1 where no record exists (eras reached before 0.9.7) or the era is not reached yet.
 */
export function eraTimes(s: Pick<GameState, 'eraAt' | 'eras' | 'playTime'>): number[] {
  const at = s.eraAt;
  const out = Array.from({ length: MAX_ERA + 1 }, () => -1);
  const end = at[MAX_ERA + 1] ?? -1;
  for (let n = 1; n <= MAX_ERA; n++) {
    if (n > s.eras.age) break;
    const from = at[n] ?? -1;
    if (from < 0) continue;
    // the era ends when the next one was reached; the last era reached runs to the 100 % moment, else to now
    const next = n < s.eras.age ? at[n + 1] ?? -1 : end >= 0 ? end : s.playTime;
    out[n] = next >= from ? next - from : -1;
  }
  return out;
}

/** This season as a finished run (pushed to state.trophies.runs at 100 %). */
export function runRecord(s: GameState): RunRecord {
  return { season: s.prestige.season, playTime: s.playTime, moneyEarned: s.stats.moneyEarned, eraSeconds: eraTimes(s) };
}

/** Lifetime totals: every finished season plus this one (when it is not already among them). */
export function lifetime(s: GameState): { playTime: number; moneyEarned: number; seasons: number } {
  const runs = s.trophies.runs;
  const counted = runs.some((r) => r.season === s.prestige.season);
  let playTime = counted ? 0 : s.playTime;
  let moneyEarned = counted ? 0 : s.stats.moneyEarned;
  for (const r of runs) {
    playTime += r.playTime;
    moneyEarned += r.moneyEarned;
  }
  return { playTime, moneyEarned, seasons: runs.length };
}

/** A clean eraAt array (sanitize): ERA_AT_LENGTH finite numbers ≥ −1, era 1 at 0. */
export function cleanEraAt(v: unknown): number[] {
  const src = Array.isArray(v) ? v : [];
  return Array.from({ length: ERA_AT_LENGTH }, (_, n) => {
    if (n === 1) return 0;
    const x = src[n];
    return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : -1;
  });
}
