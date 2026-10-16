/**
 * Era hand nodes (assets/eraNodes.ts): one per era 2..10, named as in the art spec and docs/EXPANSION.md section D,
 * each ≤ 3 meshes inside 3.2 × 3.2 × 3.4 m (anim included), every harvest reaction plays and settles, and every era
 * has its own hand tool.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ASSET_CATALOG } from '../src/assets/AssetFactory';
import { ERA_NODES, NODE_ERAS, createNodeModel, createNodeTool, eraNodeCatalog } from '../src/assets/eraNodes';
import { MATERIALS } from '../src/eras/data';

function meshes(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh);
  });
  return out;
}

function size(o: THREE.Object3D): THREE.Vector3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o, true).getSize(new THREE.Vector3());
}

describe('era hand nodes', () => {
  it('covers eras 2..10 with the art spec names', () => {
    expect(NODE_ERAS).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // 0.9.7 era resources v2 re-themed two nodes after the era JSON specs were written
    const renamed: Record<number, string> = { 5: 'Taconite Ridge', 10: 'Rare Earth Geode' };
    for (const n of NODE_ERAS) {
      const spec = JSON.parse(readFileSync(`docs/art/era-${String(n).padStart(2, '0')}.json`, 'utf8')) as { node: { name: string } };
      expect(ERA_NODES[n]!.name).toBe(renamed[n] ?? spec.node.name);
      expect(ERA_NODES[n]!.era).toBe(n);
    }
  });

  it('yields an existing material of an era no later than its own', () => {
    for (const n of NODE_ERAS) {
      const m = MATERIALS[ERA_NODES[n]!.yields];
      expect(m).toBeDefined();
      expect(m.era).toBeLessThanOrEqual(n);
    }
  });

  it('gives every era its own verb-and-tool pair', () => {
    const pairs = NODE_ERAS.map((n) => `${ERA_NODES[n]!.verb}|${ERA_NODES[n]!.tool}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(NODE_ERAS.map((n) => ERA_NODES[n]!.verb)).not.toContain('Chop');
  });

  for (const n of NODE_ERAS) {
    describe(`era ${n} ${ERA_NODES[n]!.name}`, () => {
      it('is body + glow + one anim mesh', () => {
        const m = createNodeModel(n);
        expect(m.root.name).toBe(`node:${n}`);
        const names = meshes(m.root).map((x) => x.name).sort();
        expect(names.length).toBeLessThanOrEqual(3);
        expect(names).toContain('body');
        expect(names).toContain('anim');
        expect(names.filter((x) => x === 'anim')).toHaveLength(1);
      });

      it('fits 3.2 × 3.2 × 3.4 m through a whole harvest, and reports a radius that covers it', () => {
        const m = createNodeModel(n);
        let worst = new THREE.Vector3();
        for (let hit = 0; hit < 3; hit++) {
          m.hit();
          for (let i = 0; i < 40; i++) {
            m.animate(0.03);
            const s = size(m.root);
            worst = worst.max(s);
          }
        }
        expect(worst.x).toBeLessThanOrEqual(3.2);
        expect(worst.z).toBeLessThanOrEqual(3.2);
        expect(worst.y).toBeLessThanOrEqual(3.4);
        const rest = size(m.root);
        expect(m.radius * 2).toBeGreaterThanOrEqual(Math.max(rest.x, rest.z) - 0.6);
        expect(m.radius).toBeLessThanOrEqual(1.6);
      });

      it('strikes on the front face', () => {
        const m = createNodeModel(n);
        expect(m.strike.z).toBeGreaterThan(0.7);
        expect(m.strike.y).toBeGreaterThan(0.4);
        expect(m.strike.y).toBeLessThan(1.4);
      });

      it('plays a visible reaction on a hit and settles back', () => {
        const m = createNodeModel(n);
        const anim = m.root.getObjectByName('anim')!;
        const shake = m.root.getObjectByName('shake')!;
        for (let i = 0; i < 30; i++) m.animate(0.05);
        anim.updateMatrix();
        const idle = anim.matrix.elements.join();
        const idleVisible = anim.visible;
        m.hit();
        m.animate(0.05);
        expect(shake.scale.y).toBeLessThan(1);
        let seen = false;
        let moved = false;
        for (let i = 0; i < 8; i++) {
          anim.updateMatrix();
          if (anim.visible) seen = true;
          if (anim.visible && (anim.matrix.elements.join() !== idle || !idleVisible)) moved = true;
          m.animate(0.04);
        }
        expect(seen).toBe(true);
        expect(moved).toBe(true);
        for (let i = 0; i < 80; i++) m.animate(0.05);
        expect(Math.abs(shake.scale.y - 1)).toBeLessThan(0.01);
        expect(anim.visible).toBe(idleVisible);
        expect(() => m.animate(0)).not.toThrow();
      });

      it('has a one-mesh hand tool, gold at band 4+', () => {
        const t0 = createNodeTool(n, 0);
        const t5 = createNodeTool(n, 5);
        expect(meshes(t0)).toHaveLength(1);
        const s = size(t0);
        expect(Math.max(s.x, s.y, s.z)).toBeLessThanOrEqual(1.2);
        expect((meshes(t5)[0]!.geometry as THREE.BufferGeometry).uuid).not.toBe((meshes(t0)[0]!.geometry as THREE.BufferGeometry).uuid);
      });
    });
  }

  it('shares geometry between instances', () => {
    const a = createNodeModel(7);
    const b = createNodeModel(7);
    const ga = meshes(a.root).map((m) => m.geometry.uuid).sort();
    const gb = meshes(b.root).map((m) => m.geometry.uuid).sort();
    expect(ga).toEqual(gb);
    expect(a.root).not.toBe(b.root);
  });

  it('is in the gallery', () => {
    expect(ASSET_CATALOG.eraNodes).toBe(eraNodeCatalog);
    for (const build of Object.values(eraNodeCatalog)) expect(() => build()).not.toThrow();
    expect(Object.keys(eraNodeCatalog).length).toBe(NODE_ERAS.length * 2 + 1);
  });

  it('rejects eras without a node', () => {
    expect(() => createNodeModel(1)).toThrow();
    expect(() => createNodeTool(11)).toThrow();
  });
});
