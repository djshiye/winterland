/**
 * 0.9.6 era chains (1.0 audit F1, F2, X1, F3, F5, F6, F11; decisions 8 and 15): every era runs on its own land, each
 * chain is balanced so one extractor feeds its processor, eras 5 and 10 mine their own raw material, buyers keep up
 * with a levelled region, and the hand node pays in proportion to the era. Pure: the real tables.
 */
import { describe, expect, it } from 'vitest';
import { ERA_NODES } from '../src/assets/eraNodes';
import { REGION_SLOTS } from '../src/core/types';
import { costAt, introEra } from '../src/core/ladder';
import { UPGRADES, type UpgradeDef } from '../src/config';
import { MACHINES, MATERIALS, MAX_ERA, isMaterial, machinesOfEra, type MachineId } from '../src/eras/data';
import { NODE_STRIKES_PER_ROW, nodeStrikeBonus } from '../src/eras/HandNode';
import { eraContent, fullBuild } from '../src/eras/template';
import { BED_MAX, buyerScale } from '../src/npc/EraBuyers';

const eras = Array.from({ length: MAX_ERA - 1 }, (_, i) => i + 2);

describe('every era runs on its own land (F1, F2, X1)', () => {
  it('every processor input of era n is made by a machine of era n', () => {
    for (const n of eras) {
      const made = new Set(machinesOfEra(n).map((id) => MACHINES[id].output));
      for (const id of machinesOfEra(n)) for (const i of MACHINES[id].inputs) expect(made.has(i.kind), `${id} needs ${i.kind}`).toBe(true);
    }
  });

  it("every machine's build material is made in its own era", () => {
    for (const n of eras) {
      const made = new Set(machinesOfEra(n).map((id) => MACHINES[id].output));
      for (const id of machinesOfEra(n)) {
        const x = MACHINES[id].extra;
        if (x) expect(made.has(x.kind), `${id} costs ${x.kind}`).toBe(true);
      }
    }
  });

  it('the fixed chains: gears from scrap, chips from 2 silicon, robots from AI cores and rare-earth magnets', () => {
    expect(MACHINES.steamWorks.inputs.map((i) => i.kind)).toEqual(['scrap', 'coal']);
    expect(MACHINES.chipFab.inputs).toEqual([{ kind: 'silicon', per: 2 }]);
    expect(MACHINES.robotWorks.inputs.map((i) => i.kind)).toEqual(['aiCore', 'rareEarth']);
  });

  it('0.9.7: every input and build material of eras 5-10 is a material of that same era (era resources v2)', () => {
    for (let n = 5; n <= MAX_ERA; n++) {
      for (const id of machinesOfEra(n)) {
        const d = MACHINES[id];
        for (const i of d.inputs) expect(MATERIALS[i.kind as keyof typeof MATERIALS]?.era, `${id} needs ${i.kind}`).toBe(n);
        if (d.extra) expect(MATERIALS[d.extra.kind as keyof typeof MATERIALS]?.era, `${id} costs ${d.extra.kind}`).toBe(n);
      }
    }
  });

  it('every step of a chain pays: a cycle makes at least 1.3 × the value of what it uses', () => {
    for (const id of Object.keys(MACHINES) as MachineId[]) {
      const d = MACHINES[id];
      if (d.kind !== 'processor' || !isMaterial(d.output)) continue;
      const used = d.inputs.reduce((s, i) => s + i.per * (isMaterial(i.kind) ? MATERIALS[i.kind].value : 0), 0);
      expect(d.batch * MATERIALS[d.output].value, id).toBeGreaterThanOrEqual(1.3 * used - 5); // values round to $5
    }
  });
});

describe('eras 5 and 10 have main resources of their own (F5, decision 15, era resources v2)', () => {
  it('era 5: iron pellets + coke make steel; era 10: rare earth + helium-3, fused into fusion cells', () => {
    for (const k of ['pellets', 'coke'] as const) expect(MATERIALS[k]).toMatchObject({ era: 5, grade: 'raw' });
    for (const k of ['rareEarth', 'helium3'] as const) expect(MATERIALS[k]).toMatchObject({ era: 10, grade: 'raw' });
    expect(MATERIALS.fusionCell).toMatchObject({ era: 10, grade: 'refined' });
    expect(MACHINES.deepMine.output).toBe('pellets');
    expect(MACHINES.cokeOven.output).toBe('coke');
    expect(MACHINES.steelMill.inputs).toEqual([{ kind: 'pellets', per: 2 }, { kind: 'coke', per: 1 }]);
    expect(MACHINES.nanoFab.output).toBe('rareEarth');
    expect(MACHINES.heliumSkimmer).toMatchObject({ era: 10, kind: 'extractor', output: 'helium3' });
    expect(MACHINES.fusionPlant).toMatchObject({ kind: 'processor', inputs: [{ kind: 'helium3', per: 1 }], output: 'fusionCell', batch: 2 });
    expect(MACHINES.dataCenter.inputs.map((i) => i.kind)).toEqual(['rareEarth', 'fusionCell']);
    expect(MACHINES.quantumLab.inputs.map((i) => i.kind)).toEqual(['aiCore', 'helium3']);
    for (const k of ['pellets', 'coke', 'rareEarth', 'helium3', 'fusionCell'] as const) expect(UPGRADES[`${k}Quality`].era).toBe(MATERIALS[k].era);
    // era 10 reuses nothing from era 9 any more
    for (const id of machinesOfEra(10)) expect(MACHINES[id].inputs.map((i) => i.kind)).not.toContain('power');
  });

  it("every era's hand node yields that era's own raw material, and its content lists it", () => {
    for (const n of eras) {
      const k = ERA_NODES[n]!.yields;
      expect(MATERIALS[k], `era ${n}`).toMatchObject({ era: n, grade: 'raw' });
      expect(eraContent(n).node.yields).toBe(k);
      expect(eraContent(n).materials).toContain(k);
      expect(machinesOfEra(n).some((id) => MACHINES[id].output === k), `era ${n}`).toBe(true);
    }
  });
});

describe('balanced chains (F3): one extractor feeds its processor', () => {
  /** Steady-state uptime of each processor of a full build (fullBuild: one of each, then extractors), supply shared. */
  function uptimes(n: number): number[] {
    const built = fullBuild(n, REGION_SLOTS[n]!) as MachineId[];
    const up = built.map(() => 1);
    for (let round = 0; round < 60; round++) {
      const supply = new Map<string, number>();
      const demand = new Map<string, number>();
      built.forEach((id, i) => {
        const d = MACHINES[id];
        supply.set(d.output, (supply.get(d.output) ?? 0) + (up[i]! * d.batch) / d.cycle);
        for (const inp of d.inputs) demand.set(inp.kind, (demand.get(inp.kind) ?? 0) + inp.per / d.cycle);
      });
      built.forEach((id, i) => {
        const d = MACHINES[id];
        if (d.kind === 'processor') up[i] = Math.min(1, ...d.inputs.map((inp) => (supply.get(inp.kind) ?? 0) / demand.get(inp.kind)!));
      });
    }
    return up.filter((_, i) => MACHINES[built[i]!].kind === 'processor');
  }

  it('a full build keeps every processor of every era at 90 % or more on paper', () => {
    for (const n of eras) for (const u of uptimes(n)) expect(u, `era ${n}`).toBeGreaterThanOrEqual(0.9);
  });
});

describe('buyers keep up with a levelled region (F6)', () => {
  it('era 2 at Dock ×1 is 0.9.5 exactly; later eras and bigger docks bring more buyers with bigger orders', () => {
    expect(buyerScale(2, 1)).toEqual({ rate: 1, size: 1 });
    for (const n of eras.slice(1)) {
      expect(buyerScale(n, 1).rate).toBeGreaterThan(buyerScale(n - 1, 1).rate);
      expect(buyerScale(n, 1).size).toBeGreaterThan(buyerScale(n - 1, 1).size);
    }
    expect(buyerScale(5, 3).size).toBeGreaterThan(buyerScale(5, 1).size);
    expect(buyerScale(5, 3).rate).toBeCloseTo(3 * buyerScale(5, 1).rate, 9);
    // a truck bed holds the biggest order an era-2 dock at Lv 10 asks for
    expect(BED_MAX).toBe(27);
    expect(Math.round(12 * buyerScale(2, 3).size)).toBeLessThanOrEqual(BED_MAX);
  });
});

describe('the hand node pays in proportion to the era (F11)', () => {
  const row = (n: number): number => {
    const defs = (Object.values(UPGRADES) as UpgradeDef[]).filter((d) => introEra(d) === n);
    return defs.reduce((s, d) => s + Array.from({ length: 10 }, (_, l) => costAt(d, l)).reduce((a, b) => a + b, 0), 0) / defs.length;
  };

  it('a strike is worth the same share of an era row in every era from 3 on, and era 2 keeps its stone', () => {
    expect(nodeStrikeBonus(2)).toBe(0);
    expect(nodeStrikeBonus(10)).toBeGreaterThan(0);
    for (const n of eras.slice(1)) {
      const unit = MATERIALS[ERA_NODES[n]!.yields].value;
      const strike = unit + nodeStrikeBonus(n);
      expect(row(n) / strike, `era ${n}`).toBeLessThanOrEqual(NODE_STRIKES_PER_ROW * 1.001);
      const prev = MATERIALS[ERA_NODES[n - 1]!.yields].value + nodeStrikeBonus(n - 1);
      expect(strike, `era ${n}`).toBeGreaterThan(prev);
    }
  });
});
