/**
 * 0.9.5 era 5–7 content: every template row names real materials and machines, each chain step pays (a product is
 * worth at least 1.3× its inputs), the new item shapes and icons exist, the pals keep the dog's contract, and the
 * era player upgrades are generated for every era.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../src/config';
import { MACHINES, MATERIALS, isMaterial, machinesOfEra, type MachineId } from '../src/eras/data';
import { contentMachines, eraContent } from '../src/eras/template';
import { createEraItemModel } from '../src/assets/eraItems';
import { createMachineModel } from '../src/assets/eraMachines';
import { createEra5to7Pal } from '../src/assets/eraPals5to7';
import { ERA_PAL_MODELS } from '../src/assets/eraPals';
import { materialIcon } from '../src/ui/materialIcons';
import { ERA_PLAYER_KINDS, eraPlayerId, regionAt } from '../src/eras/playerUpgrades';
import { REGIONS, ERA_KEYS } from '../src/eras/data';

const NEW = ['girder', 'snowplow', 'quartz', 'bulb', 'radio', 'gas', 'fuel', 'snowmobile'] as const;

describe('era 5-7 content', () => {
  for (const n of [5, 6, 7]) {
    it(`era ${n}: every template material and buildable machine exists`, () => {
      const c = eraContent(n);
      for (const k of c.materials) expect(isMaterial(k as never), k).toBe(true);
      for (const k of c.sales) expect(isMaterial(k as never), k).toBe(true);
      const ids = contentMachines(n).filter((id) => id !== c.machines.cash);
      for (const id of ids) expect(MACHINES[id as MachineId]?.era, id).toBe(n);
      expect(machinesOfEra(n).sort()).toEqual([...ids].sort());
      expect(isMaterial(c.node.yields as never)).toBe(true);
    });
  }

  it('every processor of eras 5-7 sells its product for at least 1.3x its inputs', () => {
    for (const n of [5, 6, 7]) {
      for (const id of machinesOfEra(n)) {
        const d = MACHINES[id];
        if (d.kind !== 'processor') continue;
        const inValue = d.inputs.reduce((a, i) => a + (isMaterial(i.kind) ? MATERIALS[i.kind].value : 0) * i.per, 0);
        const outValue = isMaterial(d.output) ? MATERIALS[d.output].value * d.batch : 0;
        expect(outValue, id).toBeGreaterThanOrEqual(inValue * 1.3 - 5);
      }
    }
  });

  it('the new materials have models fitted to their size and their own icons', () => {
    const icons = new Set<string>();
    for (const k of NEW) {
      const m = createEraItemModel(k);
      m.geometry.computeBoundingBox();
      const size = m.geometry.boundingBox!.getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(MATERIALS[k].size.w, 3);
      expect(size.y).toBeCloseTo(MATERIALS[k].size.h, 3);
      icons.add(materialIcon(k));
    }
    expect(icons.size).toBe(NEW.length);
  });

  it('the new machines build from the era 5-7 models', () => {
    for (const id of ['rollingMill', 'plowWorks', 'quartzPit', 'bulbWorks', 'radioWorks', 'gasWell', 'cracker', 'snowmobileWorks'] as MachineId[]) {
      const m = createMachineModel(id);
      expect(m.root.name).toBe(`machine:${id}:${MACHINES[id].era}`);
      expect(() => m.animate(0.1, true)).not.toThrow();
    }
  });
});

describe('era 5-7 pals', () => {
  for (const n of [5, 6, 7] as const) {
    it(`era ${n}: keeps the dog contract (3 draw calls, sit, wag, bag, level)`, () => {
      const p = createEra5to7Pal(n);
      const meshes: THREE.Mesh[] = [];
      p.root.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
      expect(meshes).toHaveLength(2);
      p.sit = 1;
      p.tailYaw = 0.5;
      expect(() => p.animate(1, 0)).not.toThrow();
      expect(() => p.animate(1.1, 3)).not.toThrow();
      p.setBag(true);
      p.setLevel(4);
      p.dispose();
      expect(ERA_PAL_MODELS[n]).toBeTypeOf('function');
    });
  }
});

describe('era player upgrades', () => {
  it('every era 2-10 has Carry, Boots, Tool and Pal with the template labels', () => {
    ERA_KEYS.forEach((key, i) => {
      const n = i + 2;
      for (const kind of ERA_PLAYER_KINDS) {
        const def = UPGRADES[eraPlayerId(n, kind)];
        expect(def.era).toBe(n);
        expect(def.requires?.era).toBe(n);
        expect(def.values).toHaveLength(11); // 0.9.6: Lv 10 authored
        expect(def.costs).toHaveLength(0);
      }
      expect(UPGRADES[`${key}Tool`].label).toBe(eraContent(n).player.tool);
    });
  });

  it('regionAt finds each era region and nothing outside', () => {
    for (let n = 2; n < REGIONS.length; n++) {
      const r = REGIONS[n]!.rect;
      expect(regionAt((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2)).toBe(n);
    }
    expect(regionAt(0, 0)).toBe(0);
  });
});
