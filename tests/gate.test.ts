/**
 * The era gate (docs/EXPANSION.md §C, order step 4): eras/gate.ts eraGate / gateMet / nextGoal and the rewritten
 * layout.expansionOffered (climb open, era next, gate met, partial pad payments grandfathered).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GATE, QUARTERS, UPGRADES, VILLAGE } from '../src/config';
import { base, introEra, stepCost } from '../src/core/ladder';
import { mergeState, sanitizeState, type SaveData } from '../src/core/Save';
import { createGameState, type GameState, type PadId, type UpgradeId } from '../src/core/types';
import { ERAS, MAX_ERA } from '../src/eras/data';
import { eraGate, gateMet, gateNote, nextGoal, padPaid, settlementLevel } from '../src/eras/gate';
import { expansionOffered, expansionPreview } from '../src/eras/layout';
import { meetGate } from './gateHelpers';

const IDS = Object.keys(UPGRADES) as UpgradeId[];

/** Winterland with the Great Lodge built: the climb is open, nothing upgraded. */
function lodge(): GameState {
  const s = createGameState();
  s.village.revealed = true;
  s.village.level = VILLAGE.levels.length - 1;
  s.village.greatLodge.tier = 0;
  return s;
}

/** Every machine pad unlocked and the top bunkhouse built: no upgrade has an unmet requirement left. */
function allBuilt(s: GameState): GameState {
  for (const k of Object.keys(s.unlocked) as PadId[]) s.unlocked[k] = true;
  s.quarters.tier = QUARTERS.tiers.length - 1;
  return s;
}

afterEach(() => {
  GATE.mode = 'offset';
});

describe('eraGate rows', () => {
  it('lists every id introduced before era n: 23 for era 2, then 23 + 2 + 3·(n − 2) in 0.9', () => {
    const s = lodge();
    expect(eraGate(s, 2).total).toBe(23);
    for (let n = 3; n <= MAX_ERA; n++) {
      s.eras.age = n - 1;
      const g = eraGate(s, n);
      expect(g.total, `era ${n}`).toBe(23 + 2 + 3 * (n - 2));
      expect(g.rows.every((r) => introEra(UPGRADES[r.id]) <= n - 1)).toBe(true);
    }
    expect(eraGate(s, MAX_ERA + 1).total).toBe(0);
  });

  it('era 2 asks shown Lv 10 of the 22 Survival ids and Jack, and settlement 5', () => {
    const g = eraGate(lodge(), 2);
    expect(g.need).toBe(10);
    expect(g.settlementNeed).toBe(5);
    expect(g.rows.map((r) => r.id).sort()).toEqual(IDS.filter((id) => introEra(UPGRADES[id]) === 1).sort());
    expect(g.rows.every((r) => r.need === 10)).toBe(true);
    expect(g.padCash).toBe(ERAS[2]!.unlock.cash);
    expect(g.padExtra).toEqual(ERAS[2]!.unlock.extra);
  });

  it('unbuilt machines and their crews are prereq rows; unhired crews show no level', () => {
    const g = eraGate(lodge(), 2);
    const row = (id: UpgradeId) => g.rows.find((r) => r.id === id)!;
    expect(row('harvester')).toMatchObject({ state: 'prereq', prereq: 'Build the Harvester first', where: 'pad' });
    expect(row('sledLoader')).toMatchObject({ state: 'prereq', prereq: 'Build the Workshop first', shown: null, where: 'shop' });
    expect(row('cashier')).toMatchObject({ state: 'low', shown: null });
    expect(row('carry')).toMatchObject({ state: 'low', shown: 0, where: 'shop' });
    expect(row('jack')).toMatchObject({ state: 'low', where: 'shop' });
    // built: the machine row turns low and reads in the pad's convention (the built machine is LV 1)
    const s = allBuilt(lodge());
    s.upgrades.harvester = 6;
    const h = eraGate(s, 2).rows.find((r) => r.id === 'harvester')!;
    expect(h).toMatchObject({ state: 'low', shown: 6, padLabel: 'pad LV 8 → LV 11' });
    s.upgrades.harvester = 10;
    const done = eraGate(s, 2).rows.find((r) => r.id === 'harvester')!;
    expect(done.state).toBe('ok');
    expect(done.padLabel).toBeUndefined(); // an ok row has no pad step left to show
    expect(eraGate(s, 2).rows.filter((r) => r.state === 'prereq')).toEqual([]);
  });

  it('costToNeed is the sum of the remaining step prices, 0 once a row is ok', () => {
    const s = allBuilt(lodge());
    s.upgrades.carry = 4;
    const g = eraGate(s, 2);
    let sum = 0;
    for (let k = 4; k < 10; k++) sum += stepCost(UPGRADES.carry, k);
    expect(g.rows.find((r) => r.id === 'carry')!.costToNeed).toBe(sum);
    s.upgrades.carry = 12;
    const ok = eraGate(s, 2).rows.find((r) => r.id === 'carry')!;
    expect(ok).toMatchObject({ state: 'ok', costToNeed: 0, shown: 12 });
    expect(eraGate(s, 2).ok).toBe(1);
  });

  it('era-2 ids read their offset: Lv 10 at stored 0, the era-3 gate needs stored 10 (Lv 20)', () => {
    const s = allBuilt(lodge());
    s.eras.age = 2;
    s.upgrades.frontierRigs = 9;
    const g = eraGate(s, 3);
    const rigs = g.rows.find((r) => r.id === 'frontierRigs')!;
    expect(rigs).toMatchObject({ shown: 19, need: 20, state: 'low', where: 'eraShop' });
    expect(g.rows.find((r) => r.id === 'frontierCrew')!.shown).toBeNull();
    expect(g.rows.find((r) => r.id === 'taxOffice')!.shown).toBe(10);
  });

  it("literal mode: every id's shown level is its stored level, so era-2 ids need stored 20 for era 3", () => {
    GATE.mode = 'literal';
    const s = allBuilt(lodge());
    s.eras.age = 2;
    s.upgrades.frontierRigs = 10;
    const g = eraGate(s, 3);
    expect(g.rows.find((r) => r.id === 'frontierRigs')).toMatchObject({ shown: 10, need: 20, state: 'low' });
    expect(base(UPGRADES.frontierRigs)).toBe(0);
    meetGate(s, 3);
    expect(s.upgrades.frontierRigs).toBe(20);
    expect(eraGate(s, 3).ready).toBe(true);
    GATE.mode = 'offset';
    expect(eraGate(s, 3).rows.find((r) => r.id === 'frontierRigs')!.shown).toBe(30);
  });
});

describe('ready and the settlement', () => {
  it('is ready only with every row ok and the settlement reached', () => {
    const s = lodge();
    expect(eraGate(s, 2).ready).toBe(false);
    meetGate(s, 2);
    const g = eraGate(s, 2);
    expect(g.ok).toBe(g.total);
    expect(g.ready).toBe(true);
    expect(gateMet(s, 2)).toBe(true);
    s.upgrades.jack = 9; // one row short
    expect(eraGate(s, 2).ready).toBe(false);
    expect(gateMet(s, 2)).toBe(false);
    s.upgrades.jack = 10;
    s.village.level = 4; // below Winterland: settlement 4 of 5
    expect(eraGate(s, 2).settlement).toMatchObject({ level: 4, need: 5 });
    expect(eraGate(s, 2).ready).toBe(false);
    expect(gateMet(s, 2)).toBe(false);
  });

  it('gateMet agrees with eraGate().ready', () => {
    for (let n = 2; n <= MAX_ERA; n++) {
      const s = lodge();
      s.eras.age = n - 1;
      expect(gateMet(s, n)).toBe(eraGate(s, n).ready);
      meetGate(s, n);
      expect(gateMet(s, n), `era ${n}`).toBe(true);
      expect(eraGate(s, n).ready).toBe(true);
    }
  });

  it('settlement is the village level below Winterland and never above 5 at age 1', () => {
    const s = createGameState();
    for (let lvl = 0; lvl < VILLAGE.levels.length; lvl++) {
      s.village.level = lvl;
      expect(settlementLevel(s)).toBe(lvl);
      expect(settlementLevel(s)).toBeLessThanOrEqual(5);
    }
  });

  it('gateNote reads "ok/total · Slevel/need"', () => {
    const s = allBuilt(lodge());
    s.upgrades.carry = 10;
    s.upgrades.speed = 10;
    expect(gateNote(eraGate(s, 2))).toBe('2/23 · S5/5');
    s.village.level = 3;
    expect(gateNote(eraGate(s, 2))).toBe('2/23 · S3/5');
  });
});

describe('expansionOffered', () => {
  it('needs the climb, the era next, and the gate met', () => {
    const s = createGameState();
    meetGate(s, 2);
    s.village.greatLodge.tier = -1;
    expect(expansionOffered(s, 2)).toBe(false); // no climb: 0.8.0 shows no pad at all
    s.village.greatLodge.tier = 0;
    expect(expansionOffered(s, 2)).toBe(true);
    expect(expansionOffered(s, 3)).toBe(false); // not next
    s.eras.age = 2;
    expect(expansionOffered(s, 2)).toBe(false); // reached
    expect(expansionOffered(s, 3)).toBe(false);
    expect(expansionPreview(s, 3)).toBe(true);
    meetGate(s, 3);
    expect(expansionOffered(s, 3)).toBe(true);
    expect(expansionPreview(s, 3)).toBe(false);
  });

  it('a partly paid pad stays offered below its gate (grandfathered), cash or material', () => {
    const s = lodge();
    expect(expansionOffered(s, 2)).toBe(false);
    s.eras.regions[2]!.cash = 5000;
    expect(padPaid(s, 2)).toBe(5000);
    expect(expansionOffered(s, 2)).toBe(true);
    expect(expansionPreview(s, 2)).toBe(false);
    s.eras.regions[2]!.cash = 0;
    s.eras.regions[2]!.extra = 3;
    expect(expansionOffered(s, 2)).toBe(true);
    s.eras.regions[2]!.extra = 0;
    expect(expansionOffered(s, 2)).toBe(false);
    expect(expansionPreview(s, 2)).toBe(true);
  });

  it('keeps the v7 save\'s half-paid era-5 pad offered', () => {
    const save = JSON.parse(readFileSync(new URL('./fixtures/save-v7-eras.json', import.meta.url), 'utf8')) as SaveData;
    const s = createGameState();
    mergeState(s, save.state);
    sanitizeState(s);
    expect(s.eras.age).toBe(4);
    expect(gateMet(s, 5)).toBe(false);
    expect(expansionOffered(s, 5)).toBe(true);
  });

  it('never offers a pad before the Great Lodge, whatever the levels (era 1 stays 0.8.0)', () => {
    const s = createGameState();
    s.village.level = 4;
    for (const id of IDS) s.upgrades[id] = 100 - base(UPGRADES[id]);
    for (let n = 2; n <= MAX_ERA; n++) expect(expansionOffered(s, n)).toBe(false);
  });
});

describe('nextGoal', () => {
  it('is null before the Great Lodge and after the last era', () => {
    expect(nextGoal(createGameState(), 1e12)).toBeNull();
    const s = lodge();
    s.eras.age = MAX_ERA;
    expect(nextGoal(s, 1e12)).toBeNull();
  });

  it('puts an unmet prereq first', () => {
    const goal = nextGoal(lodge(), 1e12)!;
    expect(goal.action).toEqual({ kind: 'build', target: 'pad:harvester' });
    expect(goal.text).toBe('Harvester: Build the Harvester first');
  });

  it('then the cheapest affordable row, bought where it lives', () => {
    const s = allBuilt(lodge());
    const open = eraGate(s, 2).rows.filter((r) => r.state !== 'ok');
    const price = (id: UpgradeId) => stepCost(UPGRADES[id], s.upgrades[id]);
    const cheapest = open.map((r) => r.id).sort((a, b) => price(a) - price(b))[0]!;
    const goal = nextGoal(s, 1e12)!;
    expect(goal.action.target).toBe(UPGRADES[cheapest].group === 'machine' ? `pad:${cheapest}` : cheapest);
    expect(goal.text).toContain(UPGRADES[cheapest].label);
    // a machine row sends the player to its level pad
    for (const id of IDS) if (introEra(UPGRADES[id]) === 1 && UPGRADES[id].group !== 'machine') s.upgrades[id] = 10;
    expect(nextGoal(s, 1e12)!.action).toMatchObject({ kind: 'go', target: expect.stringMatching(/^pad:/) });
  });

  it('then the settlement, then saving up ("to go"), then the pad', () => {
    const s = allBuilt(lodge());
    s.village.level = 4;
    expect(nextGoal(s, 0)!.action).toEqual({ kind: 'build', target: 'village' });
    s.village.level = VILLAGE.levels.length - 1;
    const saving = nextGoal(s, 0)!;
    expect(saving.text).toMatch(/to go$/);
    meetGate(s, 2);
    expect(nextGoal(s, 0)).toEqual({ text: `${ERAS[2]!.region} is for sale!`, action: { kind: 'go', target: 'region:2' } });
  });
});
