/**
 * 0.9.5 eras 8-10 content (Computer Age, Nuclear Power, AI Era): every era has its two extractors, its processors and
 * a premium line (docs/EXPANSION.md §D), every recipe adds value, and the new goods have a model and an icon.
 */
import { describe, expect, it } from 'vitest';
import { MACHINES, MATERIALS, machinesOfEra, type MachineId } from '../src/eras/data';
import { createMachineModel } from '../src/assets/eraMachines';
import { createEraItemModel } from '../src/assets/eraItems';
import { materialIcon, materialLabel } from '../src/ui/materialIcons';
import type { MaterialKind } from '../src/core/kinds';

const NEW_KINDS: MaterialKind[] = ['gold', 'board', 'computer', 'graphite', 'battery', 'quantumCore'];
const LINES: Record<number, { extractors: MachineId[]; processors: MachineId[]; premium: MachineId }> = {
  8: { extractors: ['sandPit', 'goldPanner'], processors: ['chipFab', 'boardShop'], premium: 'pcAssembly' },
  9: { extractors: ['uraniumMine', 'graphitePit'], processors: ['enricher', 'reactor'], premium: 'batteryPlant' },
  10: { extractors: ['fusionPlant', 'nanoFab'], processors: ['dataCenter', 'robotWorks'], premium: 'quantumLab' },
};

describe('eras 8-10 content', () => {
  for (const [n, line] of Object.entries(LINES)) {
    it(`era ${n} has two extractors, two processors and a premium line`, () => {
      const ids = machinesOfEra(Number(n));
      for (const id of [...line.extractors, ...line.processors, line.premium]) expect(ids).toContain(id);
      for (const id of line.extractors) expect(MACHINES[id].kind).toBe('extractor');
      for (const id of [...line.processors, line.premium]) expect(MACHINES[id].kind).toBe('processor');
    });
  }

  it('every era 8-10 recipe is worth running: output beats its inputs', () => {
    for (const n of [8, 9, 10]) {
      for (const id of machinesOfEra(n)) {
        const m = MACHINES[id];
        if (m.kind !== 'processor') continue;
        const inValue = m.inputs.reduce((sum, i) => sum + MATERIALS[i.kind as MaterialKind].value * i.per, 0);
        const outValue = MATERIALS[m.output as MaterialKind].value * m.batch;
        expect(outValue, id).toBeGreaterThan(inValue * 1.15);
      }
    }
  });

  it('the premium good is the most valuable thing each era sells', () => {
    for (const [n, line] of Object.entries(LINES)) {
      const premium = MATERIALS[MACHINES[line.premium].output as MaterialKind].value;
      const others = machinesOfEra(Number(n)).filter((id) => id !== line.premium && id !== 'robotWorks').map((id) => MATERIALS[MACHINES[id].output as MaterialKind].value);
      for (const v of others) expect(premium).toBeGreaterThan(v);
    }
  });

  it('new machines build through createMachineModel', () => {
    for (const id of ['goldPanner', 'boardShop', 'pcAssembly', 'graphitePit', 'batteryPlant', 'quantumLab'] as MachineId[]) {
      const m = createMachineModel(id);
      expect(m.root.name).toBe(`machine:${id}:${MACHINES[id].era}`);
    }
  });

  it('new goods have a model, a label and their own icon', () => {
    const icons = new Set<string>();
    for (const kind of NEW_KINDS) {
      expect(createEraItemModel(kind).geometry.attributes.position!.count).toBeGreaterThan(0);
      expect(materialLabel(kind)).toBe(MATERIALS[kind].label);
      icons.add(materialIcon(kind));
    }
    expect(icons.size).toBe(NEW_KINDS.length);
  });
});
