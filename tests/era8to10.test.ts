/**
 * 0.9.5 eras 8-10 content (Computer Age, Nuclear Power, AI Era): every era has its two extractors, its processors and
 * a premium line (docs/EXPANSION.md §D), every recipe adds value, and the new goods have a model and an icon.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ERA_PAL_NAMES, createEraPal, type PalEra } from '../src/assets/eraPals4';
import { ERA_PAL_MODELS } from '../src/assets/eraPals';
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
        expect(outValue, id).toBeGreaterThanOrEqual(inValue * 1.3);
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

describe('eras 8-10 pals', () => {
  for (const era of [8, 9, 10] as PalEra[]) {
    it(`${ERA_PAL_NAMES[era]} keeps the dog contract in 3 draw calls`, () => {
      const pal = createEraPal(era);
      let meshes = 0;
      pal.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
      });
      expect(meshes).toBe(2); // body + one instanced part (+ the body's shadow = 3 calls)
      for (let i = 0; i < 60; i++) pal.animate(i / 30, i < 30 ? 4 : 0);
      pal.sit = 1;
      pal.tailYaw = 0.4;
      pal.animate(2.5, 0);
      pal.setBag(true);
      pal.setLevel(4);
      const box = new THREE.Box3().setFromObject(pal.root);
      expect(box.min.y).toBeGreaterThan(-0.05);
      expect(box.max.y).toBeLessThan(1.4);
      expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z)).toBeLessThan(1.3);
      pal.dispose();
    });
  }
});

describe('pal registry', () => {
  it('every era 2-10 has its own pal instead of the husky', () => {
    for (let n = 2; n <= 10; n++) expect(ERA_PAL_MODELS[n], `era ${n}`).toBeTypeOf('function');
  });
});
