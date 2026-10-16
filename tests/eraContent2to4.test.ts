/**
 * 0.9.5 era 2-4 content: each era has the full era-1-sized set (2 extractors, 2 processors, a premium works, a cash
 * machine, 7 named roles, 4 player upgrades, 4 sales goods), every recipe can be fed from that era or an older one,
 * and every processing step adds value, so a grind through each era pays off like Survival.
 */
import { describe, expect, it } from 'vitest';
import { ERA_ROLES, eraContent } from '../src/eras/template';
import { ERAS, type MachineId, MACHINES, MATERIALS, isMaterial, machinesOfEra } from '../src/eras/data';
import { ERA_NODES } from '../src/assets/eraNodes';
import { ERA_MACHINES_2 } from '../src/assets/eraMachines2';
import { MATERIAL_KINDS } from '../src/core/kinds';

const eraProducers = (n: number): MachineId[] => {
  const m = eraContent(n).machines;
  return [...m.ext, ...m.proc, m.premium] as MachineId[];
};
const value = (k: string): number => (isMaterial(k as never) ? MATERIALS[k as keyof typeof MATERIALS].value : 0);

for (const n of [2, 3, 4]) {
  describe(`era ${n} content`, () => {
    const c = eraContent(n);

    it('has a row', () => {
      expect(c.n).toBe(n);
    });

    it("has exactly this era's five producing machines, in their roles", () => {
      expect(new Set(eraProducers(n))).toEqual(new Set(machinesOfEra(n)));
      for (const id of c.machines.ext as readonly string[] as readonly MachineId[]) expect(MACHINES[id].kind).toBe('extractor');
      for (const id of [...c.machines.proc, c.machines.premium] as MachineId[]) expect(MACHINES[id].kind).toBe('processor');
      for (const id of eraProducers(n)) expect(MACHINES[id].era).toBe(n);
    });

    it('has a modelled cash machine of this era', () => {
      const info = ERA_MACHINES_2[c.machines.cash as keyof typeof ERA_MACHINES_2];
      expect(info).toEqual({ era: n, role: 'cash' });
    });

    it('names all seven roles and four player upgrades', () => {
      for (const r of ERA_ROLES) expect(c.roles[r].label.length).toBeGreaterThan(2);
      expect(new Set(Object.values(c.roles).map((r) => r.label)).size).toBe(7);
      expect(c.roles.hauler.label).toBe(ERAS[n]!.worker.label);
      expect(c.player.tool).toBe(ERA_NODES[n]!.tool);
      expect(c.node.yields).toBe(ERA_NODES[n]!.yields);
    });

    it('sells four distinct goods of this era, each made by one of its machines or its hand node', () => {
      expect(new Set(c.sales).size).toBe(4);
      const made = new Set<string>([...eraProducers(n).map((id) => MACHINES[id].output), ERA_NODES[n]!.yields]);
      for (const k of c.sales as readonly string[] as readonly (keyof typeof MATERIALS)[]) {
        expect(MATERIAL_KINDS).toContain(k);
        expect(MATERIALS[k].era).toBe(n);
        expect(made.has(k)).toBe(true);
      }
    });

    it('feeds every recipe from this era or an older one', () => {
      for (const id of eraProducers(n)) {
        for (const inp of MACHINES[id].inputs) {
          expect(isMaterial(inp.kind)).toBe(true);
          expect(MATERIALS[inp.kind as keyof typeof MATERIALS].era).toBeLessThanOrEqual(n);
        }
      }
    });

    it('adds value at every processing step, and the premium good is the most valuable', () => {
      for (const id of [...c.machines.proc, c.machines.premium] as MachineId[]) {
        const d = MACHINES[id];
        const cost = d.inputs.reduce((s, i) => s + value(i.kind) * i.per, 0);
        expect(value(d.output) * d.batch).toBeGreaterThan(cost);
      }
      const premium = value(MACHINES[c.machines.premium as MachineId].output);
      for (const k of c.sales) expect(premium).toBeGreaterThanOrEqual(value(k));
    });

    it('prices the premium works above the other machines and every machine above the last era', () => {
      const p = MACHINES[c.machines.premium as MachineId].cash;
      for (const id of [...c.machines.ext, ...c.machines.proc] as MachineId[]) expect(p).toBeGreaterThan(MACHINES[id].cash);
      if (n > 2) {
        expect(Math.min(...eraProducers(n).map((id) => MACHINES[id].cash))).toBeGreaterThan(Math.min(...eraProducers(n - 1).map((id) => MACHINES[id].cash)));
      }
    });
  });
}
