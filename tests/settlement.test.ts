/**
 * Settlement levels 6..50 (docs/EXPANSION.md §B): the threshold scale (anchors under 0.8 × the city's capacity, the
 * design table with the 0.10 slot counts, monotonic, about a home per level), the city population (residents +
 * machine staff, the village excluded), best-ever saving, era 1 never past 5, Renown, the band perks (happiness,
 * investment positions, quest trios, requires.settlement) and City's announce + gift pile. Stub context, no WebGL.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SETTLEMENT, UPGRADES, VILLAGE } from '../src/config';
import {
  INVEST_POSITIONS_CAP,
  bandsWith,
  builtMachines,
  cityPopulation,
  investMaxPositions,
  machineStaff,
  refreshSettlement,
  renownMult,
  salePrice,
  settlementAnchors,
  settlementHappiness,
  settlementLevel,
  settlementLevelFor,
  settlementName,
  settlementPop,
  settlementThresholds,
} from '../src/core/demand';
import { upgradeRequirement } from '../src/core/Upgrades';
import { QUEST_DEFS, Quests } from '../src/core/quests';
import { createGameState, type GameContext, type GameEvents, type GameState } from '../src/core/types';
import { mergeState, sanitizeState } from '../src/core/Save';
import { EventBus } from '../src/core/EventBus';
import { CITY_BUILDINGS, DISTRICTS, INVEST_MAX_POSITIONS, MACHINES, MAX_ERA, REGIONS, machinesOfEra, type CityBuildingId } from '../src/eras/data';
import { eraGate, nextGoal } from '../src/eras/gate';
import { settlementPerks } from '../src/ui/EraCard';

// canvas textures (glow halos, signs) draw into a 2D context nobody looks at here
const noop: unknown = new Proxy(() => noop, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop), apply: () => noop });
vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) });

const { City } = await import('../src/city/City');

const homeOf = (n: number) => Object.values(CITY_BUILDINGS).find((d) => d.era === n && d.kind === 'home')!;
const idOf = (n: number, kind: string): CityBuildingId => Object.values(CITY_BUILDINGS).find((d) => d.era === n && d.kind === kind)!.id;

function build(s: GameState, n: number, lot: number, id: CityBuildingId): void {
  Object.assign(s.city.districts[n]!.lots[lot]!, { building: id, tier: 0, cash: 0, extra: 0 });
}
function machine(s: GameState, n: number, slot: number): void {
  Object.assign(s.eras.regions[n]!.slots[slot]!, { machine: machinesOfEra(n)[0]!, tier: 0, cash: 0, extra: 0 });
}
/** Winterland at age `age` (the Great Lodge built). */
function winterland(age: number): GameState {
  const s = createGameState();
  s.village.greatLodge.tier = 0;
  s.village.level = VILLAGE.levels.length - 1;
  s.eras.age = age;
  for (let n = 2; n <= age; n++) s.eras.regions[n]!.unlocked = true;
  return s;
}

/** Cumulative city capacity through era k as §B defines it, straight from the data tables. */
function capacity(k: number, slots: (n: number) => number = (n) => REGIONS[n]!.slots): number {
  let c = 0;
  for (let n = 2; n <= k; n++) c += (DISTRICTS[n]!.lots - 2) * homeOf(n).people + slots(n) * machineStaff(n);
  return c;
}

describe('threshold scale', () => {
  it('machine staff is a quarter of an era home: 10, 22, 48, 106 …', () => {
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10].map(machineStaff)).toEqual([10, 22, 48, 106, 234, 515, 1134, 2494, 5488]);
    for (let n = 2; n <= MAX_ERA; n++) expect(machineStaff(n) / homeOf(n).people).toBeCloseTo(0.25, 1);
  });

  it('every anchor A_k stays at or under 0.8 × the capacity through era k (today’s REGIONS slots)', () => {
    const A = settlementAnchors();
    for (let k = 2; k <= MAX_ERA; k++) {
      expect(A[k]!).toBeGreaterThan(0);
      expect(A[k]!).toBeLessThanOrEqual(0.8 * capacity(k));
    }
  });

  it('with the 0.10 slot counts (R10: 8,8,8,8,8,8,9,9,10) it is exactly the design table', () => {
    const R10 = [0, 0, 8, 8, 8, 8, 8, 8, 9, 9, 10];
    const A = settlementAnchors((n) => R10[n]!);
    expect(A.slice(2)).toEqual([180, 580, 1400, 4000, 9600, 22000, 53000, 120000, 330000]);
    for (let k = 2; k <= MAX_ERA; k++) expect(A[k]!).toBeLessThanOrEqual(0.8 * capacity(k, (n) => R10[n]!));
    const P = settlementThresholds(A);
    expect(P.slice(6)).toEqual([
      36, 72, 108, 144, 180,
      230, 290, 360, 460, 580,
      690, 830, 980, 1200, 1400,
      1700, 2100, 2600, 3200, 4000,
      4800, 5700, 6800, 8100, 9600,
      11000, 13000, 16000, 19000, 22000,
      26000, 31000, 37000, 44000, 53000,
      62000, 73000, 87000, 100000, 120000,
      150000, 180000, 220000, 270000, 330000,
    ]);
  });

  it('rises strictly from level 6 to 50, the last level of a band is its anchor', () => {
    const A = settlementAnchors();
    let prev = 0;
    for (let L = 6; L <= 50; L++) {
      const p = settlementPop(L)!;
      expect(p, `level ${L}`).toBeGreaterThan(prev);
      prev = p;
      if (L % 5 === 0) expect(p).toBe(A[L / 5]);
    }
    expect(settlementPop(5)).toBeNull();
    expect(settlementPop(51)).toBeNull();
  });

  it('each level is about one or two homes of its era (no cascades)', () => {
    for (let L = 6; L <= 50; L++) {
      const k = Math.ceil(L / 5);
      const step = settlementPop(L)! - (L === 6 ? 0 : settlementPop(L - 1)!);
      expect(step / homeOf(k).people, `level ${L}`).toBeLessThanOrEqual(2.5);
      expect(step / homeOf(k).people, `level ${L}`).toBeGreaterThan(0.3);
    }
  });

  it('45 distinct names; 6 Frontier Post, 10 Frontier Town, 50 Winterland Prime; 0..5 are the village levels', () => {
    expect(SETTLEMENT.names).toHaveLength(45);
    expect(new Set(SETTLEMENT.names).size).toBe(45);
    expect(settlementName(6)).toBe('Frontier Post');
    expect(settlementName(10)).toBe('Frontier Town');
    expect(settlementName(50)).toBe('Winterland Prime');
    for (let L = 0; L <= 5; L++) expect(settlementName(L)).toBe(VILLAGE.levels[L]!.name);
    // no settlement name repeats a village level name (the card never shows a duplicate)
    for (const n of SETTLEMENT.names) expect(VILLAGE.levels.map((l) => l.name)).not.toContain(n);
  });
});

describe('levels from the city population', () => {
  it('level 5(k − 1) + j needs age ≥ k: era 1 never passes 5, each era fills only its own band', () => {
    expect(settlementLevelFor(1e9, 1)).toBe(0);
    expect(settlementLevelFor(1e9, 2)).toBe(10);
    expect(settlementLevelFor(1e9, 3)).toBe(15);
    expect(settlementLevelFor(1e9, 10)).toBe(50);
    expect(settlementLevelFor(0, 10)).toBe(0);
    expect(settlementLevelFor(settlementPop(7)!, 2)).toBe(7);
    expect(settlementLevelFor(settlementPop(7)! - 1, 2)).toBe(6);
  });

  it('city population = district residents + machine staff; the village does not count', () => {
    const s = winterland(3);
    s.village.population = 500;
    expect(cityPopulation(s)).toBe(0);
    build(s, 2, 0, idOf(2, 'home'));
    build(s, 2, 1, idOf(2, 'work')); // jobs, no residents
    machine(s, 2, 0);
    machine(s, 3, 0);
    s.eras.regions[3]!.slots[1]!.machine = machinesOfEra(3)[1]!; // chosen, not built: no staff
    expect(builtMachines(s, 3)).toBe(1);
    expect(cityPopulation(s)).toBe(homeOf(2).people + machineStaff(2) + machineStaff(3));
  });

  it('the saved level is best-ever: demolishing never lowers it', () => {
    const s = winterland(2);
    for (let i = 0; i < 4; i++) build(s, 2, i, idOf(2, 'home'));
    expect(refreshSettlement(s)).toBe(settlementLevelFor(4 * homeOf(2).people, 2));
    const reached = s.eras.settlement;
    expect(reached).toBeGreaterThan(5);
    for (let i = 0; i < 4; i++) s.city.districts[2]!.lots[i] = { building: '', tier: -1, cash: 0, extra: 0 };
    expect(refreshSettlement(s)).toBe(reached);
    expect(settlementLevel(s)).toBe(reached);
  });

  it('settlementLevel is the village level below Winterland, then at least 5', () => {
    const s = createGameState();
    s.eras.settlement = 9; // an odd save: never read below Winterland
    for (let lvl = 0; lvl < 5; lvl++) {
      s.village.level = lvl;
      expect(settlementLevel(s)).toBe(lvl);
    }
    s.village.level = 5;
    s.eras.settlement = 0;
    expect(settlementLevel(s)).toBe(5);
    s.eras.settlement = 12;
    expect(settlementLevel(s)).toBe(12);
  });

  it('the era gate counts the real settlement: era 3 needs Settlement 10', () => {
    const s = winterland(2);
    const g = eraGate(s, 3);
    expect(g.settlement).toMatchObject({ level: 5, need: 10, cityPop: 0, nextPop: settlementPop(6) });
    for (let i = 0; i < 4; i++) build(s, 2, i, idOf(2, 'home'));
    for (let i = 0; i < REGIONS[2]!.slots; i++) machine(s, 2, i);
    refreshSettlement(s);
    expect(eraGate(s, 3).settlement.level).toBe(settlementLevelFor(cityPopulation(s), 2));
    expect(eraGate(s, 3).settlement.cityPop).toBe(cityPopulation(s));
  });

  it("nextGoal's settlement step names a home of the era's district", () => {
    const s = winterland(2);
    for (const id of Object.keys(UPGRADES) as (keyof typeof UPGRADES)[]) s.upgrades[id] = 99; // rows done, clamp irrelevant
    const goal = nextGoal(s, 0)!;
    expect(goal.action).toEqual({ kind: 'build', target: 'district:2' });
    expect(goal.text).toBe(`Build a home in ${DISTRICTS[2]!.name} (+${homeOf(2).people}) → Settlement 6`);
  });
});

describe('era 1 and saves', () => {
  it('age 1: settlement ≤ 5 and Renown = 1 whatever the save holds', () => {
    const s = createGameState();
    s.village.greatLodge.tier = 0;
    s.village.level = 5;
    mergeState(s, { eras: { settlement: 40 } });
    sanitizeState(s);
    expect(s.eras.settlement).toBeLessThanOrEqual(5);
    expect(settlementLevel(s)).toBe(5);
    expect(renownMult(s)).toBe(1);
    const plain = structuredClone(s);
    plain.eras.settlement = 0;
    expect(salePrice(s, 'plank', 5, 20)).toBe(salePrice(plain, 'plank', 5, 20));
  });

  it('a saved level loads, is clamped to the age band and never negative', () => {
    const merged = (saved: unknown) => {
      const s = createGameState();
      mergeState(s, saved);
      sanitizeState(s);
      return s.eras.settlement;
    };
    expect(merged({ eras: { age: 3, settlement: 12 } })).toBe(12);
    expect(merged({ eras: { age: 3, settlement: 40 } })).toBe(15);
    expect(merged({ eras: { age: 3, settlement: -4 } })).toBe(0);
    expect(merged({ eras: { age: 3, settlement: 'x' } })).toBe(0);
    expect(merged({ eras: { age: 3 } })).toBe(0);
  });

  it('a save may hold every position a band perk can give', () => {
    const s = createGameState();
    const inv = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, product: 'index', era: 0, principal: 1000, value: 1000, age: 0 }));
    mergeState(s, { eras: { age: 10, settlement: 50 }, market: { investments: inv } });
    expect(s.market.investments).toHaveLength(INVEST_POSITIONS_CAP);
    expect(INVEST_POSITIONS_CAP).toBe(INVEST_MAX_POSITIONS + 9);
  });
});

describe('Renown and the band perks', () => {
  it('Renown is ×1.02 per level past Winterland (×2.2 at 45)', () => {
    const s = winterland(10);
    s.eras.settlement = 6;
    expect(renownMult(s)).toBeCloseTo(1.02, 10);
    s.eras.settlement = 45;
    expect(renownMult(s)).toBeCloseTo(2.208, 3);
  });

  it('Renown multiplies buyer sales', () => {
    const s = winterland(2);
    const base = salePrice(s, 'plank', 5, 200);
    s.eras.settlement = 10;
    expect(salePrice(s, 'plank', 5, 200)).toBe(Math.round((base * 1.02 ** 5) / 5) * 5);
  });

  it('j = 3 adds city happiness and j = 4 an investment position, once per band reached', () => {
    const s = winterland(10);
    const at = (L: number) => {
      s.eras.settlement = L;
      return { happy: settlementHappiness(s), positions: investMaxPositions(s) };
    };
    expect(at(5)).toEqual({ happy: 0, positions: INVEST_MAX_POSITIONS });
    expect(at(7)).toEqual({ happy: 0, positions: INVEST_MAX_POSITIONS });
    expect(at(8).happy).toBeCloseTo(0.05, 10);
    expect(at(9)).toEqual({ happy: expect.closeTo(0.05, 10), positions: INVEST_MAX_POSITIONS + 1 });
    expect(at(14).positions).toBe(INVEST_MAX_POSITIONS + 2);
    expect(at(50)).toEqual({ happy: expect.closeTo(0.45, 10), positions: INVEST_MAX_POSITIONS + 9 });
    expect(bandsWith(10, 5)).toBe(1);
  });

  it('the card lists the perks the crossed band positions brought', () => {
    expect(settlementPerks(6, 5, 3000)).toEqual(['Renown ×1.02', '$3,000 gift on the avenue', 'New quests']);
    expect(settlementPerks(9, 7, 3000)).toEqual(['Renown ×1.08', '$3,000 gift on the avenue', 'City happiness +5%', '+1 investment slot']);
  });

  it('requires.settlement gates an upgrade until the level is reached', () => {
    const def = UPGRADES.frontierRigs as { requires?: object };
    const saved = def.requires;
    def.requires = { era: 2, settlement: 7 };
    try {
      const s = winterland(2);
      expect(upgradeRequirement(s, 'frontierRigs')).toBe('Reach Settlement 7');
      s.eras.settlement = 7;
      expect(upgradeRequirement(s, 'frontierRigs')).toBeNull();
    } finally {
      def.requires = saved;
    }
  });

  it("j = 1 unlocks the era's quest trio; a locked quest never blocks the list", () => {
    for (let n = 2; n <= MAX_ERA; n++) {
      const trio = QUEST_DEFS.filter((d) => d.id.startsWith(`trio${n}`));
      expect(trio).toHaveLength(3);
      // listed right after the quest that reaches the era
      expect(QUEST_DEFS.indexOf(trio[0]!)).toBe(QUEST_DEFS.findIndex((d) => d.id === `era${n}`) + 1);
    }
    const s = winterland(2);
    for (const d of QUEST_DEFS) if (d.id !== 'era2' && !d.id.startsWith('trio2')) s.quests[d.id] = true;
    s.quests.era2 = true;
    const q = new Quests(s, { add: () => undefined } as never, new EventBus<GameEvents>());
    expect(q.active()).toEqual([]);
    s.eras.settlement = 6;
    expect(q.active().map((a) => a.def.id)).toEqual(['trio2homes', 'trio2machines', 'trio2landmark']);
    build(s, 2, 0, idOf(2, 'landmark'));
    expect(q.active()[2]!.progress).toBe(1);
  });
});

/** Minimal context for City (no WebGL; the gift pile's bundles stay "in flight": tweens.delay never fires). */
function makeCtx(state: GameState) {
  const events = new EventBus<GameEvents>();
  const ctx = {
    scene: new THREE.Scene(),
    state,
    events,
    addUpdatable: () => undefined,
    time: { elapsed: 0 },
    camera: new THREE.PerspectiveCamera(),
    player: { position: new THREE.Vector3(), arms: { count: () => 0 }, back: {} },
    economy: { money: 1e9, spend: () => true, add: () => undefined },
    upgrades: { value: () => 1 },
    colliders: { addBounds: () => undefined, addBox: () => ({}), remove: () => undefined },
    zones: {
      add: () => ({ enabled: false, setEnabled: () => undefined }),
      addTransfer: () => ({ enabled: false, setEnabled: () => undefined }),
      isPlayerIn: () => false,
    },
    tweens: { killTweensOf: () => undefined, popIn: () => undefined, run: () => undefined, punchScale: () => undefined, delay: () => undefined },
    particles: { puff: () => undefined, ring: () => undefined },
    audio: { play: () => undefined },
    items: { release: () => undefined, create: () => ({}) },
  } as unknown as GameContext;
  return { ctx, events };
}

describe('City announces new levels', () => {
  it('raises the level on load silently, then announces a new one with its gift', () => {
    const s = winterland(2);
    for (let i = 0; i < 2; i++) build(s, 2, i, idOf(2, 'home'));
    const { ctx, events } = makeCtx(s);
    const up = vi.fn();
    const changed = vi.fn();
    events.on('settlement:levelUp', up);
    events.on('settlement:changed', changed);
    const city = new City(ctx);
    const loaded = settlementLevelFor(2 * homeOf(2).people, 2);
    expect(s.eras.settlement).toBe(loaded);
    expect(up).not.toHaveBeenCalled();
    // two machines: + 20 staff
    machine(s, 2, 0);
    machine(s, 2, 1);
    events.emit('machine:built', { era: 2, slot: 1, machine: machinesOfEra(2)[0]!, position: new THREE.Vector3(), object: new THREE.Group() });
    const now = settlementLevelFor(cityPopulation(s), 2);
    expect(now).toBeGreaterThan(loaded);
    expect(up).toHaveBeenCalledTimes(1);
    const e = up.mock.calls[0]![0];
    expect(e).toMatchObject({ level: now, from: loaded, charter: now === 10 });
    expect(e.gift).toBeGreaterThanOrEqual(SETTLEMENT.giftMin);
    expect(city.giftValue).toBe(e.gift);
    expect(changed).toHaveBeenCalledWith({ level: now, cityPopulation: cityPopulation(s) });
    // demolishing a machine does not lower it or announce anything
    s.eras.regions[2]!.slots[1] = { machine: '', tier: -1, cash: 0, extra: 0 };
    events.emit('machine:demolished', { era: 2, slot: 1, machine: machinesOfEra(2)[0]!, position: new THREE.Vector3() });
    expect(s.eras.settlement).toBe(now);
    expect(up).toHaveBeenCalledTimes(1);
  });

  it('a completed band is a Charter: + charterSeconds of income', () => {
    const s = winterland(2);
    const { ctx, events } = makeCtx(s);
    const up = vi.fn();
    events.on('settlement:levelUp', up);
    const city = new City(ctx);
    for (let i = 0; i < 6; i++) build(s, 2, i, idOf(2, 'home'));
    for (let i = 0; i < REGIONS[2]!.slots; i++) machine(s, 2, i);
    expect(city.incomeRate).toBeGreaterThan(0);
    events.emit('machine:built', { era: 2, slot: 0, machine: 'quarry', position: new THREE.Vector3(), object: new THREE.Group() });
    const e = up.mock.calls[0]![0];
    expect(e.level).toBe(10);
    expect(e.charter).toBe(true);
    // the income rate is read after the level rose (Renown and the j = 3 decor already count)
    expect(e.gift).toBe(Math.max(SETTLEMENT.giftMin, Math.round(city.incomeRate * (5 * SETTLEMENT.giftSeconds + SETTLEMENT.charterSeconds))));
    expect(MACHINES.quarry.era).toBe(2);
  });

  it('era 1 never announces a settlement level', () => {
    const s = createGameState();
    s.village.greatLodge.tier = 0;
    s.village.level = 5;
    const { ctx, events } = makeCtx(s);
    const up = vi.fn();
    events.on('settlement:levelUp', up);
    new City(ctx);
    events.emit('village:changed', { population: 200, level: 5 });
    expect(up).not.toHaveBeenCalled();
    expect(settlementLevel(s)).toBe(5);
  });
});
