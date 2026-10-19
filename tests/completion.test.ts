/**
 * 0.9.7 the ending (plan decisions 3-6): the 100 % table (core/completion.ts), the final gate (eras/gate.ts), the
 * trophies and era dates in the save (core/Save.ts '0.9.7-trophies'), the finale tracker and New Season's honest list.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AMENITY_IDS, BUSINESSES, PADS, PRESTIGE, QUARTERS, SAVE, UPGRADES, VILLAGE, type BusinessId } from '../src/config';
import { COMPLETION, COMPLETE_LEVEL, completion, completionTag, eraTimes, lifetime, nextMissing, questTarget, runRecord } from '../src/core/completion';
import { finaleQuiet, QUIET_MAX, releaseFinale } from '../src/core/quiet';
import { RushHours } from '../src/core/Rush';
import { WorldEvents } from '../src/core/WorldEvents';
import { EventBus } from '../src/core/EventBus';
import { QUEST_DEFS } from '../src/core/quests';
import { mergeState, migrateState, MIGRATIONS, newSeasonSave, parseSave, RUNS_CAP, sanitizeState, type SaveData } from '../src/core/Save';
import { createGameState, DISTRICT_LOTS, ERA_AT_LENGTH, LOT_COUNT, PLOT_COUNT, REGION_SLOTS, type GameContext, type GameEvents, type GameState, type PadId, type UpgradeId } from '../src/core/types';
import { introEra } from '../src/core/ladder';
import { CITY_BUILDINGS, ERAS, MACHINES, MAX_ERA, type CityBuildingId, type MachineId } from '../src/eras/data';
import { eraGate, FINAL_GATE, FINAL_NAME, gateMet, gateRuleShort, gateRuleText, gateSize, hasGate, nextGoal } from '../src/eras/gate';
import { CompletionTracker, TROPHY_SCALE, TROPHY_SPOT } from '../src/progression/CompletionTracker';
import { LAYOUT } from '../src/config';
import { villageLamps } from '../src/world/env/village';
import { SEASON_KEEPS, SEASON_RESETS } from '../src/ui/SeasonConfirm';

const IDS = Object.keys(UPGRADES) as UpgradeId[];
const sum = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0);
const load = (name: string): SaveData => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));

/** A season with everything done: every id at Lv 10, every build, every quest, Settlement 50, era 10. */
function complete(): GameState {
  const s = createGameState();
  s.flags.introDone = true;
  s.village.revealed = true;
  s.village.level = VILLAGE.levels.length - 1;
  for (const p of s.village.plots) p.tier = VILLAGE.tiers.length - 1;
  s.village.greatLodge.tier = 0;
  s.quarters.tier = QUARTERS.tiers.length - 1;
  for (const k of Object.keys(s.unlocked) as PadId[]) s.unlocked[k] = true;
  s.town.revealed = true;
  const biz = Object.keys(BUSINESSES) as BusinessId[];
  s.town.lots.forEach((l, i) => Object.assign(l, { building: biz[i % biz.length], tier: 0 }));
  for (const id of AMENITY_IDS) s.town.amenities[id].tier = 0;
  s.town.grandMarket.tier = 0;
  s.eras.age = MAX_ERA;
  s.eras.settlement = 50;
  for (let n = 2; n <= MAX_ERA; n++) {
    const r = s.eras.regions[n]!;
    r.unlocked = true;
    const m = (Object.keys(MACHINES) as MachineId[]).find((id) => MACHINES[id].era === n)!;
    for (const slot of r.slots) Object.assign(slot, { machine: m, tier: 0 });
    const b = (Object.keys(CITY_BUILDINGS) as CityBuildingId[]).find((id) => CITY_BUILDINGS[id].era === n)!;
    for (const lot of s.city.districts[n]!.lots) Object.assign(lot, { building: b, tier: 0 });
  }
  for (const id of IDS) s.upgrades[id] = COMPLETE_LEVEL;
  for (const q of QUEST_DEFS) s.quests[q.id] = true;
  return s;
}

describe('the 100 % table (core/completion.ts)', () => {
  it('is five parts that add up to 100 %, in this order', () => {
    expect(COMPLETION.map((c) => [c.key, c.weight])).toEqual([
      ['upgrades', 0.4],
      ['builds', 0.2],
      ['quests', 0.15],
      ['settlement', 0.15],
      ['eras', 0.1],
    ]);
    expect(sum(COMPLETION.map((c) => c.weight))).toBeCloseTo(1, 12);
  });

  it('counts every upgrade id, every build and slot, every quest, Settlement 50 and all ten eras', () => {
    const c = completion(createGameState());
    const part = (k: string) => c.parts.find((p) => p.key === k)!;
    expect(part('upgrades').total).toBe(IDS.length);
    expect(part('upgrades').need).toBe(IDS.length * 10);
    const builds = Object.keys(PADS).length + PLOT_COUNT + 1 /* Great Lodge */ + 1 /* bunkhouse */ + LOT_COUNT + AMENITY_IDS.length + 1 /* Grand Market */ + sum(REGION_SLOTS) + sum(DISTRICT_LOTS);
    expect(part('builds').total).toBe(builds);
    expect(part('quests').total).toBe(QUEST_DEFS.length);
    expect(part('settlement').need).toBe(50);
    expect(part('eras').need).toBe(MAX_ERA);
    // the final quest is part of it
    expect(QUEST_DEFS.some((q) => q.id === `gate${FINAL_GATE}`)).toBe(true);
  });

  it('a fresh game is at 1 % (era 1 of 10), with Settlement next', () => {
    const s = createGameState();
    expect(completion(s).pct).toBe(1);
    expect(completion(s).complete).toBe(false);
    expect(nextMissing(s)?.id).toBe('settlement');
  });

  it('everything done is exactly 100 %, and nothing is missing', () => {
    const s = complete();
    const c = completion(s);
    expect(c.pct).toBe(100);
    expect(c.complete).toBe(true);
    for (const p of c.parts) expect(p.frac, p.key).toBe(1);
    expect(nextMissing(s)).toBeNull();
    expect(completionTag(c.pct)).toBe('★ 100%');
  });

  it('any single missing piece reads 99 % at most and is the next missing piece', () => {
    const cases: Array<[string, (s: GameState) => void, RegExp]> = [
      ['one upgrade at Lv 9', (s) => (s.upgrades.aiRigs = 9), /^upgrade:aiRigs$/],
      ['one unbuilt city lot', (s) => Object.assign(s.city.districts[10]!.lots[3]!, { building: '', tier: -1 }), /^lot:10:3$/],
      ['one empty machine slot', (s) => Object.assign(s.eras.regions[4]!.slots[0]!, { machine: '', tier: -1 }), /^slot:4:0$/],
      ['the bunkhouse below Crew Hall', (s) => (s.quarters.tier = 1), /^quarters$/],
      ['one quest', (s) => delete s.quests.invest1, /^quest:invest1$/],
      ['Settlement 49', (s) => (s.eras.settlement = 49), /^settlement$/],
      ['the Grand Market', (s) => (s.town.grandMarket.tier = -1), /^grandMarket$/],
    ];
    for (const [name, change, id] of cases) {
      const s = complete();
      change(s);
      const c = completion(s);
      expect(c.complete, name).toBe(false);
      expect(c.pct, name).toBeLessThanOrEqual(99);
      expect(c.pct, name).toBeGreaterThanOrEqual(98);
      expect(nextMissing(s)?.id, name).toMatch(id);
    }
  });

  it('every pad press moves it: a level is worth a share of the upgrades part', () => {
    const s = createGameState();
    s.eras.age = 5;
    const a = completion(s).parts[0]!.have;
    s.upgrades.carry = 3;
    expect(completion(s).parts[0]!.have).toBe(a + 3);
  });

  it('the next missing piece always has somewhere to go when it is a build', () => {
    const s = complete();
    for (let n = 2; n <= MAX_ERA; n++) for (const lot of s.city.districts[n]!.lots) Object.assign(lot, { building: '', tier: -1 });
    const m = nextMissing(s)!;
    expect(m.target).toBe('district:10');
    expect(m.label).toContain(ERAS[10]!.district);
  });
});

describe('the final gate: "Winterland Complete" (eras/gate.ts)', () => {
  it('is gate 11: era 10 own ids at Lv 10 and Settlement 50, with no pad', () => {
    expect(FINAL_GATE).toBe(MAX_ERA + 1);
    expect(hasGate(FINAL_GATE)).toBe(true);
    expect(hasGate(FINAL_GATE + 1)).toBe(false);
    expect(gateSize(FINAL_GATE)).toBe(IDS.filter((id) => introEra(UPGRADES[id]) === MAX_ERA).length);
    const s = complete();
    expect(gateMet(s, FINAL_GATE)).toBe(true);
    const g = eraGate(s, FINAL_GATE);
    expect(g.ready).toBe(true);
    expect(g.padCash).toBe(0);
    expect(gateRuleText(FINAL_GATE)).toContain(FINAL_NAME);
    expect(gateRuleShort(FINAL_GATE)).toContain(FINAL_NAME);
  });

  it('era 10 always has a goal until the final gate is met', () => {
    const s = complete();
    s.upgrades.aiRigs = 4;
    const goal = nextGoal(s, 1e30);
    expect(goal?.text).toMatch(/Lv 10/);
    s.upgrades.aiRigs = 10;
    expect(nextGoal(s, 1e30)).toBeNull();
  });
});

describe('era dates and runs', () => {
  it('times each era from the play time it was reached; unknown eras read −1', () => {
    const s = createGameState();
    s.eras.age = 3;
    s.playTime = 5000;
    s.eraAt[2] = 1200;
    s.eraAt[3] = 3000;
    expect(eraTimes(s).slice(1, 5)).toEqual([1200, 1800, 2000, -1]);
    s.eraAt[2] = -1; // reached before 0.9.7: no record
    expect(eraTimes(s).slice(1, 4)).toEqual([-1, -1, 2000]);
  });

  it('the last era runs to the 100 % moment, not to now', () => {
    const s = complete();
    for (let n = 2; n <= MAX_ERA; n++) s.eraAt[n] = n * 1000;
    s.eraAt[MAX_ERA + 1] = 12_500;
    s.playTime = 99_999;
    expect(eraTimes(s)[MAX_ERA]).toBe(2500);
    const r = runRecord(s);
    expect(r.eraSeconds[1]).toBe(2000);
    expect(r.playTime).toBe(99_999);
  });

  it('lifetime adds every finished season and this one once', () => {
    const s = createGameState();
    s.prestige.season = 1;
    s.playTime = 100;
    s.stats.moneyEarned = 5;
    s.trophies.runs.push({ season: 0, playTime: 1000, moneyEarned: 50, eraSeconds: [] });
    expect(lifetime(s)).toEqual({ playTime: 1100, moneyEarned: 55, seasons: 1 });
    s.trophies.runs.push({ season: 1, playTime: 100, moneyEarned: 5, eraSeconds: [] });
    expect(lifetime(s)).toEqual({ playTime: 1100, moneyEarned: 55, seasons: 2 });
  });
});

describe('save: trophies and era dates (migration 0.9.7-trophies)', () => {
  const loadSave = (name: string) => {
    const save = load(name);
    const r = parseSave(JSON.stringify(save));
    expect(r.kind).toBe('ok');
    const state = createGameState();
    mergeState(state, save.state);
    sanitizeState(state);
    const report = migrateState(state, false, { salesRate: save.salesRate, upgrades: save.state.upgrades });
    return { state, report };
  };

  it('a 0.9.6 save gets its Great Lodge and Grand Market trophies once; its eras keep no dates', () => {
    const { state, report } = loadSave('save-v9-0.9.6-era10.json');
    expect(report.applied).toEqual(['0.9.7-era-resources', '0.9.7-trophies', '0.9.11-guidebook', '0.9.11-bond-promise', '0.9.12-bigger-towns']);
    expect(report.refund).toBe(0);
    expect(state.trophies).toEqual({ lodge: 1, market: 1, complete: 0, runs: [] });
    expect(state.eraAt).toHaveLength(ERA_AT_LENGTH);
    expect(state.eraAt[1]).toBe(0);
    for (let n = 2; n < ERA_AT_LENGTH; n++) expect(state.eraAt[n]).toBe(-1);
    expect(state.flags.complete).toBeUndefined();
    // the second load changes nothing
    const again = createGameState();
    mergeState(again, JSON.parse(JSON.stringify(state)));
    sanitizeState(again);
    expect(migrateState(again, false).applied).toEqual([]);
    expect(again).toEqual(state);
  });

  it('a 0.9.7 save keeps its trophies, finished seasons and era dates', () => {
    const save = load('save-v9-0.9.7-season2.json');
    const { state, report } = loadSave('save-v9-0.9.7-season2.json');
    // only migrations newer than 0.9.7 run (the 0.9.11 Guidebook marks its reached chapters read; old bonds keep their rate)
    expect(report.applied).toEqual(['0.9.11-guidebook', '0.9.11-bond-promise', '0.9.12-bigger-towns']);
    expect(state.trophies.lodge).toBe(2);
    expect(state.trophies.complete).toBe(1);
    expect(state.trophies.runs).toHaveLength(1);
    expect(state.trophies.runs[0]!.eraSeconds).toEqual((save.state as unknown as GameState).trophies.runs[0]!.eraSeconds);
    expect(state.eraAt).toEqual((save.state as unknown as GameState).eraAt);
    expect(eraTimes(state)[2]).toBe(9000 - 3600);
  });

  it('every older save still loads with the new fields at their defaults', () => {
    for (const name of ['save-v1-town.json', 'save-v7-eras.json', 'save-v9-0.9.5-era4-lv10.json']) {
      const { state } = loadSave(name);
      expect(state.trophies.complete, name).toBe(0);
      expect(state.trophies.runs, name).toEqual([]);
      expect(state.eraAt[1], name).toBe(0);
    }
  });

  it('cleans a tampered save: bad numbers, too many runs, short arrays', () => {
    const state = createGameState();
    const runs = Array.from({ length: RUNS_CAP + 10 }, (_, i) => ({ season: i, playTime: -5, moneyEarned: 'x', eraSeconds: [1, -9, 'a'] }));
    mergeState(state, { trophies: { lodge: -3, market: 1e12, complete: 2.7, runs }, eraAt: [5, 7, Number.NaN, -40, 100] });
    sanitizeState(state);
    expect(state.trophies.lodge).toBe(0);
    expect(state.trophies.market).toBe(1_000_000);
    expect(state.trophies.complete).toBe(2);
    expect(state.trophies.runs).toHaveLength(RUNS_CAP);
    expect(state.trophies.runs[0]!.season).toBe(10);
    expect(state.trophies.runs[0]!.playTime).toBe(0);
    expect(state.trophies.runs[0]!.moneyEarned).toBe(0);
    expect(state.trophies.runs[0]!.eraSeconds).toHaveLength(MAX_ERA + 1);
    expect(state.trophies.runs[0]!.eraSeconds.slice(0, 3)).toEqual([1, -1, -1]);
    expect(state.eraAt).toHaveLength(ERA_AT_LENGTH);
    expect(state.eraAt.slice(0, 5)).toEqual([5, 0, -1, -1, 100]);
  });

  it('a fresh game marks the migration applied without running it', () => {
    const s = createGameState();
    s.flags.finale = true;
    migrateState(s, true);
    expect(s.migrations['0.9.7-trophies']).toBe(true);
    expect(s.trophies.lodge).toBe(0);
    expect(MIGRATIONS.map((m) => m.id)).toContain('0.9.7-trophies');
  });
});

describe('New Season (decision 5)', () => {
  it('keeps trophies and finished seasons; everything the confirm lists starts over', () => {
    const prev = complete();
    prev.prestige.season = 2;
    prev.flags['seen:moveHand'] = true;
    prev.flags.complete = true;
    prev.trophies = { lodge: 3, market: 3, complete: 3, runs: [runRecord(prev)] };
    prev.legacy.masteryMult = 1.1;
    prev.stats.moneyEarned = 1e12;
    prev.playTime = 1e6;
    prev.market.holdings = { iron: 5 } as GameState['market']['holdings'];
    const next = newSeasonSave(prev, 1).state;
    // kept
    expect(next.trophies).toEqual(prev.trophies);
    expect(next.trophies).not.toBe(prev.trophies);
    expect(next.prestige.season).toBe(3);
    expect(next.flags['seen:moveHand']).toBe(true);
    expect(next.legacy.masteryMult).toBe(1.1);
    // reset (SEASON_RESETS, in order of the list)
    const fresh = createGameState();
    expect(newSeasonSave(prev, 1).money).toBe(PRESTIGE.startMoneyPerSeason * 3);
    expect(next.upgrades).toEqual(fresh.upgrades);
    expect(next.unlocked).toEqual(fresh.unlocked);
    expect(next.village).toEqual(fresh.village);
    expect(next.quarters).toEqual(fresh.quarters);
    expect(next.town).toEqual(fresh.town);
    expect(next.eras).toEqual(fresh.eras);
    expect(next.city).toEqual(fresh.city);
    expect(next.market).toEqual(fresh.market);
    expect(next.quests).toEqual({});
    expect(next.contract).toEqual(fresh.contract);
    expect(next.stats).toEqual(fresh.stats);
    expect(next.eraAt).toEqual(fresh.eraAt);
    expect(next.flags.complete).toBeUndefined();
    expect(completion(next).pct).toBe(1);
    expect(SEASON_RESETS).toHaveLength(9);
    expect(SEASON_RESETS.join(' ')).toMatch(/money.*upgrade.*Great Lodge.*Grand Market.*ten eras.*district.*investments.*quests.*stats/);
    expect(SEASON_KEEPS.join(' ')).toMatch(/trophies.*season's stats.*season count/);
    expect(SAVE.version).toBe(newSeasonSave(prev, 1).v);
  });
});

describe('the finale tracker (progression/CompletionTracker.ts)', () => {
  const make = (state: GameState) => {
    const events = new EventBus<GameEvents>();
    const scene = new THREE.Scene();
    const ups: { update(dt: number): void }[] = [];
    const ctx = { events, state, scene, addUpdatable: (u: { update(dt: number): void }) => ups.push(u) } as unknown as GameContext;
    const t = new CompletionTracker(ctx);
    const seen: GameEvents['complete:start'][] = [];
    events.on('complete:start', (e) => seen.push(e));
    return { t, events, scene, seen, tick: (dt = 1) => ups.forEach((u) => u.update(dt)) };
  };

  it('stamps an era with the play time it was reached', () => {
    const s = createGameState();
    s.playTime = 777;
    const { events } = make(s);
    events.emit('era:unlocked', { era: 4, position: new THREE.Vector3() });
    expect(s.eraAt[4]).toBe(777);
    s.playTime = 900;
    events.emit('era:unlocked', { era: 4, position: new THREE.Vector3() });
    expect(s.eraAt[4]).toBe(777); // never moved once stamped
  });

  it('at 100 %: once per season, the trophy, the run and the finale at the Great Lodge', () => {
    const s = complete();
    s.playTime = 4321;
    const { t, seen, tick, scene } = make(s);
    expect(t.trophyObject).toBeNull();
    tick();
    expect(s.flags.complete).toBe(true);
    expect(s.trophies.complete).toBe(1);
    expect(s.trophies.runs).toHaveLength(1);
    expect(s.trophies.runs[0]!.playTime).toBe(4321);
    expect(s.eraAt[MAX_ERA + 1]).toBe(4321);
    expect(seen).toHaveLength(1);
    expect(t.trophyObject?.parent).toBe(scene);
    expect(t.trophyObject?.position.x).toBe(TROPHY_SPOT.x);
    tick();
    tick();
    expect(seen).toHaveLength(1);
    expect(s.trophies.complete).toBe(1);
  });

  it('never during the intro, never below 100 %', () => {
    const s = complete();
    s.flags.introDone = false;
    const a = make(s);
    a.tick();
    expect(a.seen).toHaveLength(0);
    const u = complete();
    u.upgrades.carry = 9;
    const b = make(u);
    b.tick();
    expect(b.seen).toHaveLength(0);
    expect(u.flags.complete).toBeUndefined();
  });

  it('a restored save with a trophy shows it on the plaza from the start', () => {
    const s = createGameState();
    s.trophies.complete = 2;
    const { t } = make(s);
    expect(t.trophyObject).not.toBeNull();
  });
});

describe('validator #41 polish', () => {
  it('the ending hushes rush hours, world events and new ones until the card closes (or QUIET_MAX)', () => {
    releaseFinale();
    const s = complete();
    const events = new EventBus<GameEvents>();
    const ends: string[] = [];
    events.on('rush:end', () => ends.push('rush'));
    events.on('event:end', () => ends.push('event'));
    const rush = new RushHours(s, events);
    const world = new WorldEvents(s, events, () => 0);
    rush.start(60);
    world.start('festival', 60);
    const ups: { update(dt: number): void }[] = [];
    const ctx = { events, state: s, scene: new THREE.Scene(), addUpdatable: (u: { update(dt: number): void }) => ups.push(u) } as unknown as GameContext;
    new CompletionTracker(ctx);
    ups.forEach((u) => u.update(1));
    expect(finaleQuiet()).toBe(true);
    rush.update(0.1);
    world.update(0.1);
    expect(ends.sort()).toEqual(['event', 'rush']);
    expect(rush.active).toBe(false);
    expect(world.active).toBeNull();
    // nothing new starts while hushed, however long the gap
    for (let i = 0; i < 2000; i++) {
      rush.update(1);
      world.update(1);
      if (i === 0) expect(finaleQuiet()).toBe(true);
    }
    expect(rush.active).toBe(false);
    expect(world.active).toBeNull();
    releaseFinale();
    expect(finaleQuiet()).toBe(false);
  });

  it('the hush never outlasts QUIET_MAX seconds', () => {
    const s = complete();
    const events = new EventBus<GameEvents>();
    const ups: { update(dt: number): void }[] = [];
    const ctx = { events, state: s, scene: new THREE.Scene(), addUpdatable: (u: { update(dt: number): void }) => ups.push(u) } as unknown as GameContext;
    new CompletionTracker(ctx);
    ups.forEach((u) => u.update(0.5));
    expect(finaleQuiet()).toBe(true);
    for (let t = 0; t < QUIET_MAX + 1; t++) ups.forEach((u) => u.update(1));
    expect(finaleQuiet()).toBe(false);
  });

  it('every era quest and every place-bound Survival quest has a Go target the chip can use', () => {
    const s = complete();
    for (const d of QUEST_DEFS) {
      const t = questTarget(s, d.id);
      if (/^(trio|gate|city|materials|machine)/.test(d.id) || d.id === 'invest1' || d.id === 'trade1') expect(t, d.id).toBeTruthy();
      if (t?.startsWith('pad:')) expect(PADS[t.slice(4) as PadId], d.id).toBeTruthy();
      if (t?.startsWith('region:') || t?.startsWith('district:')) {
        const n = Number(t.split(':')[1]);
        expect(n >= 2 && n <= MAX_ERA, d.id).toBe(true);
      }
    }
    expect(questTarget(s, 'trio4landmark')).toBe('district:4');
    expect(questTarget(s, 'trio4machines')).toBe('region:4');
    expect(questTarget(s, 'gate5')).toBe('region:4');
    expect(questTarget(s, 'trade1')).toBe('town');
    expect(questTarget(s, 'harvester')).toBe('pad:harvester');
    expect(questTarget(s, 'planks10')).toBeUndefined(); // a sales goal: done anywhere
  });

  it("the chip's next quest carries the target, and says to free a lot when every lot is taken", () => {
    const s = complete();
    delete s.quests.trio4landmark;
    const it4 = nextMissing(s)!;
    expect(it4.id).toBe('quest:trio4landmark');
    expect(it4.target).toBe('district:4');
    // complete() fills every district lot with one non-landmark building: the landmark needs a lot freed first
    expect(it4.label).toMatch(/demolish a building to free a lot/);
    s.city.districts[4]!.lots[0]!.building = '' as CityBuildingId;
    s.city.districts[4]!.lots[0]!.tier = -1;
    expect(nextMissing(s)!.label).not.toMatch(/demolish/);
  });

  it('the trophy is a landmark: 2x or more, clear of the village lamps, the Lodge and the town corridor', () => {
    expect(TROPHY_SCALE).toBeGreaterThanOrEqual(2);
    const half = 0.45 * TROPHY_SCALE; // the plinth's half width
    for (const l of villageLamps()) expect(Math.hypot(l.x - TROPHY_SPOT.x, l.z - TROPHY_SPOT.z), `lamp ${l.x},${l.z}`).toBeGreaterThan(half + 1.5);
    const g = LAYOUT.village.greatLodge;
    expect(TROPHY_SPOT.x - half).toBeGreaterThanOrEqual(g.x + g.w / 2);
    expect(TROPHY_SPOT.x + half).toBeLessThanOrEqual(LAYOUT.village.area.maxX);
    expect(TROPHY_SPOT.z - half).toBeGreaterThan(LAYOUT.town.gate.maxZ); // south of the corridor mouth
    const s = createGameState();
    s.trophies.complete = 1;
    const ctx = { events: new EventBus<GameEvents>(), state: s, scene: new THREE.Scene(), addUpdatable: () => undefined } as unknown as GameContext;
    expect(new CompletionTracker(ctx).trophyObject?.scale.x).toBe(TROPHY_SCALE);
  });
});
