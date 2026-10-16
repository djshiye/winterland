/**
 * [PURE] Pacing model of the ten-era climb (docs/EXPANSION.md §E): a greedy, event-driven integrator over the real
 * tables (UPGRADES through core/ladder.ts, MACHINES, MATERIALS, CITY_BUILDINGS, the settlement scale), so the band
 * prices can be tuned without a bot run. No THREE, no GameContext; tests/pacing.test.ts asserts its minutes and prints
 * them with PACING_REPORT=1.
 *
 * Start: the Great Lodge is built (0.8.0's finale, about 67 bot minutes, frozen and not modelled), every era-1 upgrade
 * sits at its authored max, no money. Each era ends when the next era's expansion pad is paid; era 10 ends at the
 * finale (0.9.5 'literal' gate: era 10's own upgrades at Lv 10, settlement 50).
 *
 * Income ($/s, constant between two purchases, so time advances exactly to the next affordable buy):
 * - Survival: PACING.survivalLateRate × the Survival sales upgrades' mean gain over their authored max × Renown ×
 *   Mastery (era-1 throughput past the tables is capped by its belts and buyers; only prices keep rising).
 * - Each reached region: its built machines as a steady flow (extractors feed the region's processors, inputs from
 *   other eras are imported at the order price), cycle = max(minCycle, cycle ÷ Rigs) like eras/Machine.ts; what is
 *   left over is exported at value × Trade × (1 − the steady supply pressure) × Renown × Mastery. Hauling is free.
 * - The city: rent + staffed business × happiness × City Hall × Renown × Mastery (city/rules.ts incomeSplit), plus
 *   each settlement level's gift pile (SETTLEMENT.giftSeconds of city income, a Charter + charterSeconds).
 *
 * Each step buys, in order: the best machine or city building by payback while it pays back within
 * PACING.paybackMax → the cheaper of the cheapest open gate step and (while the settlement is short) the build with
 * the most city population per dollar → the expansion pad. Material extras are bought at the order price
 * (value × (1 + MARKET.delivery)).
 *
 * The buyer walks (upgrades are hands-on: every level is bought standing on a level pad or a shop mat, one at a time;
 * nothing buys remotely or on its own): each purchase takes at least PACING.walkPerBuy seconds (the walk to the next
 * pad or mat and the stand on it), with income still flowing, so a step costs max(walk, wait for the money).
 */
import { CLIMB, GATE, SETTLEMENT, UPGRADES, type UpgradeDef } from '../config';
import { CITY_BUILDINGS, ERAS, MACHINES, MARKET, MATERIALS, MAX_ERA, SURVIVAL_VALUE, cityBuildingsOfEra, isMaterial, machinesOfEra, type CityBuildingId, type MachineId } from '../eras/data';
import { incomeSplit, landmarkTaken } from '../city/rules';
import { cityPopulation, climbMult, refreshSettlement, settledCityTotals, settlementLevel } from './demand';
import { authoredMax, base, costAt, introEra, maxStored, valueAt } from './ladder';
import { createGameState, type GameState, type ItemKind, type UpgradeId } from './types';

export interface PacingKnobs {
  survivalLateRate: number;
  paybackMax: number;
  minCycle: number;
  walkPerBuy: number;
}

export const PACING: PacingKnobs = {
  /**
   * The one calibration constant: late-Survival income ($/s) at the Great Lodge with every Survival sales upgrade at
   * its authored max (the judges' unverified 1.2–2k/s; docs/EXPANSION.md §E). Measure with a bot log before trusting
   * the era-1 climb minutes.
   */
  survivalLateRate: 1500,
  /** A machine or city building is bought first while it pays back within this many seconds. */
  paybackMax: 900,
  /** Shortest machine cycle (eras/Machine.ts cycleTime). */
  minCycle: 0.3,
  /** Seconds per purchase spent walking to the next level pad / shop mat and standing on it (hands-on buying). */
  walkPerBuy: 8,
};

/** One stretch of the climb: era 1's climb (n = 1) or era n (2..10), from its start to the next pad (era 10: finale). */
export interface PacingEra {
  n: number;
  minutes: number;
  /** Purchases made in the stretch (gate steps + machines + city buildings + the pad). */
  buys: number;
  gateSteps: number;
  machines: number;
  buildings: number;
  /** Dollars spent on gate steps / everything else (machines, buildings, pad). */
  gateCost: number;
  otherCost: number;
  /** Income at the end of the stretch ($/s). */
  income: number;
}

export interface PacingResult {
  eras: PacingEra[];
  /** Minutes from the Great Lodge at which settlement level L (6..50) was first reached (index = level). */
  settlement: (number | null)[];
  /** Total minutes from the Great Lodge to the finale. */
  minutes: number;
}

type Buy =
  | { kind: 'gate'; id: UpgradeId; cost: number }
  | { kind: 'machine'; era: number; slot: number; id: MachineId; cost: number }
  | { kind: 'building'; era: number; lot: number; id: CityBuildingId; cost: number }
  | { kind: 'pad'; era: number; cost: number };

const IDS = Object.keys(UPGRADES) as UpgradeId[];
const value = (s: GameState, id: UpgradeId): number => valueAt(UPGRADES[id], s.upgrades[id]);
/** Survival price upgrades (0.9.2: the delivery docks are throughput, not price, so they stay out of the mean gain). */
const SURVIVAL_SALES = IDS.map((id) => UPGRADES[id]).filter((d) => d.group === 'sales' && introEra(d) === 1 && d.display !== 'boost');

/** What one unit of a kind costs to order in (material extras on pads; imported processor inputs). */
function orderPrice(kind: ItemKind): number {
  const v = isMaterial(kind) ? MATERIALS[kind].value : SURVIVAL_VALUE[kind];
  return v * (1 + MARKET.delivery);
}

/** Steady export of region n ($/s before Renown and Mastery): the built machines as a flow, imports paid. */
function regionIncome(s: GameState, n: number, k: PacingKnobs): number {
  const key = ERAS[n]!.key;
  const rigs = Math.max(0.25, value(s, `${key}Rigs`));
  const own = new Set<ItemKind>(machinesOfEra(n).map((id) => MACHINES[id].output));
  const counts = new Map<MachineId, number>();
  for (const slot of s.eras.regions[n]!.slots) if (slot.machine !== '' && slot.tier >= 0) counts.set(slot.machine, (counts.get(slot.machine) ?? 0) + 1);
  const supply = new Map<ItemKind, number>();
  let imports = 0;
  // MACHINES lists every era's extractors before its processors, in chain order (fuel rods before the reactor …)
  for (const id of machinesOfEra(n)) {
    const c = counts.get(id) ?? 0;
    if (c === 0) continue;
    const def = MACHINES[id];
    // 0.9.5: each machine type's own level (its level pad) speeds it up like eras/Machine.ts cycleTime
    let cycles = c / Math.max(k.minCycle, def.cycle / (rigs * Math.max(1, value(s, id))));
    for (const inp of def.inputs) if (own.has(inp.kind)) cycles = Math.min(cycles, (supply.get(inp.kind) ?? 0) / inp.per);
    for (const inp of def.inputs) {
      if (own.has(inp.kind)) supply.set(inp.kind, (supply.get(inp.kind) ?? 0) - cycles * inp.per);
      else imports += cycles * inp.per * orderPrice(inp.kind);
    }
    supply.set(def.output, (supply.get(def.output) ?? 0) + cycles * def.batch);
  }
  let sales = 0;
  for (const [kind, units] of supply) {
    if (units <= 1e-9 || !isMaterial(kind)) continue;
    const m = MATERIALS[kind];
    // supply pressure: each unit adds pressurePerUnit (raw half), decaying linearly; a smooth steady-state estimate
    const inflow = units * MARKET.pressurePerUnit * (m.grade === 'raw' ? 0.5 : 1);
    const pressure = Math.min(MARKET.pressureMax, (MARKET.pressureMax * inflow) / MARKET.pressureDecay);
    // 0.9.5: the region market's buyers pay the export price × the material's Quality (eras/RegionMarket.ts); the dock
    // and stall keep up with the machines, so every unit sells there
    sales += units * m.value * (1 - pressure) * value(s, `${ERAS[m.era]!.key}Trade`) * Math.max(1, value(s, `${kind}Quality`));
  }
  return sales - imports;
}

/** City income ($/s before Renown and Mastery). */
const cityIncome = (s: GameState): number => incomeSplit(settledCityTotals(s), value(s, 'taxOffice')).total;

/** Survival income ($/s before Renown and Mastery): the late rate × the sales upgrades' mean gain past their max. */
function survivalIncome(s: GameState, k: PacingKnobs): number {
  let gain = 0;
  for (const d of SURVIVAL_SALES) gain += valueAt(d, s.upgrades[d.id]) / valueAt(d, authoredMax(d));
  return k.survivalLateRate * (SURVIVAL_SALES.length ? gain / SURVIVAL_SALES.length : 1);
}

/** Total income of a state ($/s). */
export function pacingIncome(s: GameState, k: PacingKnobs = PACING): number {
  let regions = 0;
  for (let n = 2; n <= s.eras.age; n++) regions += regionIncome(s, n, k);
  return (survivalIncome(s, k) + regions + cityIncome(s)) * climbMult(s);
}

/** The model's start: the Great Lodge built, every era-1 upgrade at its authored max. */
export function pacingStart(): GameState {
  const s = createGameState();
  s.village.level = 5;
  s.village.greatLodge.tier = 0;
  for (const id of IDS) if (introEra(UPGRADES[id]) === 1) s.upgrades[id] = authoredMax(UPGRADES[id]);
  return s;
}

/**
 * Stored level gate n asks of an id, 0 when the id is not one of its rows. 'literal' mode (0.9.5): the previous era's
 * own ids at Lv 10 (n = MAX_ERA + 1, the finale: era 10's own at Lv 10). 'offset' mode: every id introduced before era
 * n at shown 10 · (n − 1) (the finale: shown level 100).
 */
function storedNeed(def: UpgradeDef, n: number): number {
  if (GATE.mode === 'literal') return introEra(def) === n - 1 ? Math.min(maxStored(def, true), CLIMB.bandSize) : 0;
  return introEra(def) <= n - 1 ? Math.min(maxStored(def, true), 10 * (n - 1) - base(def)) : 0;
}
/** Settlement gate n asks (the finale: 50). */
const settlementGoal = (n: number): number => Math.min(SETTLEMENT.max, 5 * (n - 1));

/** The cheapest open gate step of gate n, or null when every row is at need. */
function cheapestGateStep(s: GameState, n: number): Buy | null {
  let best: Buy | null = null;
  for (const id of IDS) {
    const def = UPGRADES[id];
    if (s.upgrades[id] >= storedNeed(def, n)) continue;
    const cost = costAt(def, s.upgrades[id]);
    if (!best || cost < best.cost) best = { kind: 'gate', id, cost };
  }
  return best;
}

/** Every machine and city building that could be built now. */
function buildOptions(s: GameState): Buy[] {
  const out: Buy[] = [];
  for (let n = 2; n <= s.eras.age; n++) {
    const slot = s.eras.regions[n]!.slots.findIndex((x) => x.machine === '');
    if (slot >= 0) {
      for (const id of machinesOfEra(n)) {
        const d = MACHINES[id];
        out.push({ kind: 'machine', era: n, slot, id, cost: d.cash + (d.extra ? d.extra.count * orderPrice(d.extra.kind) : 0) });
      }
    }
    const lots = s.city.districts[n]!.lots;
    const lot = lots.findIndex((l) => l.building === '');
    if (lot >= 0) {
      // the settlement anchors assume (lots − 2) homes per district: keep two lots for the rest (work, park, landmark)
      const others = lots.filter((l) => l.building !== '' && CITY_BUILDINGS[l.building].kind !== 'home').length;
      for (const id of cityBuildingsOfEra(n)) {
        const d = CITY_BUILDINGS[id];
        if (d.kind !== 'home' && others >= 2) continue;
        if (d.kind === 'landmark' && landmarkTaken(lots)) continue;
        out.push({ kind: 'building', era: n, lot, id, cost: d.cash + d.extra.count * orderPrice(d.extra.kind) });
      }
    }
  }
  return out;
}

/** Apply a build (refreshing the settlement); returns the undo. */
function applyBuild(s: GameState, b: Buy): () => void {
  const settlement = s.eras.settlement;
  if (b.kind === 'machine') {
    const slot = s.eras.regions[b.era]!.slots[b.slot]!;
    slot.machine = b.id;
    slot.tier = 0;
    refreshSettlement(s);
    return () => {
      slot.machine = '';
      slot.tier = -1;
      s.eras.settlement = settlement;
    };
  }
  if (b.kind === 'building') {
    const lot = s.city.districts[b.era]!.lots[b.lot]!;
    lot.building = b.id;
    lot.tier = 0;
    refreshSettlement(s);
    return () => {
      lot.building = '';
      lot.tier = -1;
      s.eras.settlement = settlement;
    };
  }
  return () => undefined;
}

/** The build with the shortest payback, with its payback in seconds. */
function bestByPayback(s: GameState, income: number, k: PacingKnobs): { buy: Buy; payback: number } | null {
  let best: { buy: Buy; payback: number } | null = null;
  for (const b of buildOptions(s)) {
    const undo = applyBuild(s, b);
    const gain = pacingIncome(s, k) - income;
    undo();
    if (gain <= 0) continue;
    const payback = b.cost / gain;
    if (!best || payback < best.payback) best = { buy: b, payback };
  }
  return best;
}

/** The build adding the most city population per dollar (for a settlement that is short). */
function bestByPopulation(s: GameState): Buy | null {
  const pop = cityPopulation(s);
  let best: { buy: Buy; perDollar: number } | null = null;
  for (const b of buildOptions(s)) {
    const undo = applyBuild(s, b);
    const gain = cityPopulation(s) - pop;
    undo();
    if (gain <= 0) continue;
    const perDollar = gain / b.cost;
    if (!best || perDollar > best.perDollar) best = { buy: b, perDollar };
  }
  return best?.buy ?? null;
}

/** Most purchases the model makes before it gives up (a stuck economy). */
const MAX_BUYS = 50_000;

/** Run the model from the Great Lodge to the finale (`knobs` override PACING, e.g. a slower Survival rate). */
export function runPacing(knobs: Partial<PacingKnobs> = {}): PacingResult {
  const k: PacingKnobs = { ...PACING, ...knobs };
  const s = pacingStart();
  let t = 0;
  let money = 0;
  let buys = 0;
  const eras: PacingEra[] = [];
  const settlement: (number | null)[] = Array.from({ length: SETTLEMENT.max + 1 }, () => null);

  for (let n = 2; n <= MAX_ERA + 1; n++) {
    const stretch: PacingEra = { n: n - 1, minutes: 0, buys: 0, gateSteps: 0, machines: 0, buildings: 0, gateCost: 0, otherCost: 0, income: 0 };
    const t0 = t;
    for (;;) {
      if (++buys > MAX_BUYS) throw new Error(`pacing: stuck in era ${n - 1}`);
      const income = pacingIncome(s, k);
      let buy: Buy | null = null;
      const invest = bestByPayback(s, income, k);
      if (invest && invest.payback <= k.paybackMax) buy = invest.buy;
      if (!buy) {
        // what the gate still needs, cheapest first: a gate step or a build for a short settlement
        const step = cheapestGateStep(s, n);
        const grow = settlementLevel(s) < settlementGoal(n) ? bestByPopulation(s) : null;
        if (!step && !grow && settlementLevel(s) < settlementGoal(n)) throw new Error(`pacing: settlement ${settlementGoal(n)} out of reach in era ${n - 1}`);
        buy = step && grow ? (grow.cost <= step.cost ? grow : step) : (step ?? grow);
      }
      if (!buy && n > MAX_ERA) break; // the finale: every row at 100, settlement 50
      if (!buy) {
        const u = ERAS[n]!.unlock;
        buy = { kind: 'pad', era: n, cost: u.cash + u.extra.count * orderPrice(u.extra.kind) };
      }
      // walk there (earning on the way), wait for the money if it is still short, then pay
      if (income <= 0) throw new Error(`pacing: no income in era ${n - 1}`);
      const wait = Math.max(k.walkPerBuy, (buy.cost - money) / income);
      t += wait;
      money += income * wait - buy.cost;
      stretch.buys++;
      if (buy.kind === 'gate') {
        s.upgrades[buy.id]++;
        stretch.gateSteps++;
        stretch.gateCost += buy.cost;
        continue;
      }
      stretch.otherCost += buy.cost;
      if (buy.kind === 'pad') {
        s.eras.age = buy.era;
        s.eras.regions[buy.era]!.unlocked = true;
        break;
      }
      if (buy.kind === 'machine') stretch.machines++;
      else stretch.buildings++;
      const from = settlementLevel(s);
      applyBuild(s, buy);
      const to = settlementLevel(s);
      // each level crossed: its time, and the gift pile (city income × giftSeconds; a Charter + charterSeconds)
      let seconds = 0;
      for (let L = Math.max(from, SETTLEMENT.band) + 1; L <= to; L++) {
        settlement[L] = t / 60;
        seconds += SETTLEMENT.giftSeconds + (L % SETTLEMENT.band === 0 ? SETTLEMENT.charterSeconds : 0);
      }
      if (seconds > 0) money += Math.max(SETTLEMENT.giftMin, cityIncome(s) * climbMult(s) * seconds);
    }
    stretch.minutes = (t - t0) / 60;
    stretch.income = pacingIncome(s, k);
    eras.push(stretch);
  }
  return { eras, settlement, minutes: t / 60 };
}
